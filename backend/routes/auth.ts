import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import crypto from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { validate } from '../middleware/validate.js';
import { createRequireAuth } from '../middleware/auth.js';
import { sanitizeActivityValue } from '../utils/activityPrivacy.js';

const LoginSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
  password: z.string().min(6, 'Mật khẩu phải ít nhất 6 ký tự'),
});

const ChangePasswordSchema = z.object({
  userId: z.string().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6, 'Mật khẩu mới phải ít nhất 6 ký tự'),
});
const ForgotPasswordSchema = z.object({ email: z.string().email() });
const ResetPasswordSchema = z.object({
  token: z.string().min(32).max(191),
  newPassword: z.string().min(6).max(128).refine((value) => value.trim().length >= 6, 'Password must contain at least 6 non-whitespace characters'),
});

const hashResetToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const dummyPasswordHash = bcrypt.hash('invalid-login-timing-equalizer', 10);


export function authRoutes(db: any) {
  const router = Router();
  const getSecret = () => {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
    return process.env.JWT_SECRET;
  };

  const generateToken = (userPayload: any) => {
    return jwt.sign(userPayload, getSecret(), { expiresIn: '7d' });
  };

  router.post('/login', validate(LoginSchema), async (req, res) => {
    const { email, password } = req.body;
    try {
      const user = await db.get('SELECT * FROM users WHERE lower(email) = lower(?)', [email]);
      const passwordHash = user?.password || await dummyPasswordHash;
      const isMatch = await bcrypt.compare(password, passwordHash);
      const temporarilyLocked = user?.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now();

      if (!user || !user.password || !isMatch || user.isLocked || temporarilyLocked) {
        try {
          await db.run(
            `INSERT INTO activity_logs (id, userId, action, entityId, entityType, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [crypto.randomUUID(), user?.id || 'system', 'Đăng nhập thất bại', user?.id || null, 'user', String(sanitizeActivityValue('Thông tin đăng nhập không hợp lệ')), new Date().toISOString()]
          );
        } catch (e) {}
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const role = await db.get('SELECT permissions FROM roles WHERE name = ?', [user.role]);
      
      const userClientData = {
        id: user.id, name: user.name, email: user.email, role: user.role, 
        department: user.department, avatar: user.avatar, 
        permissions: role?.permissions ? JSON.parse(role.permissions) : []
      };
      const jwtPayload = { sub: user.id, tokenVersion: Number(user.tokenVersion || 0) };
      const token = generateToken(jwtPayload);
      
      try {
        await db.run(
          `INSERT INTO activity_logs (id, userId, action, entityId, entityType, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), user.id, 'Đăng nhập', user.id, 'user', 'Người dùng đăng nhập thành công qua Email', new Date().toISOString()]
        );
      } catch (logErr) {
        console.error('Failed to log login activity', logErr);
      }

      return res.json({ token, user: userClientData });
    } catch (e) { console.error('LOGIN ROUTE EXCEPTION:', e); res.status(500).json({ error: 'Failed' }); }
  });

  router.post('/change-password', createRequireAuth(db), validate(ChangePasswordSchema), async (req, res) => {
    const { userId, currentPassword, newPassword } = req.body;
    try {
      const targetUserId = req.user?.id || userId;
      if (!targetUserId) return res.status(401).json({ error: 'Unauthorized' });
      const user = await db.get('SELECT id, password FROM users WHERE id = ?', [targetUserId]);
      if (!user || !user.password) return res.status(404).json({ error: 'User not found' });
      const isMatch = await bcrypt.compare(currentPassword || '', user.password);
      if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await db.run('UPDATE users SET password = ?, failedLogins = 0, lockedUntil = NULL, tokenVersion = tokenVersion + 1 WHERE id = ?', [hashedPassword, targetUserId]);
      await db.run('DELETE FROM password_reset_tokens WHERE userId = ? AND usedAt IS NULL', [targetUserId]);
      return res.json({ success: true });
    } catch (e) { console.error('CHANGE PASSWORD ROUTE EXCEPTION:', e); res.status(500).json({ error: 'Failed' }); }
  });


  return router;
}

export function forgotPasswordRoutes(db: any, mailer: any) {
  const router = Router();
  const resetIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many password reset attempts. Please try again later.' },
  });
  const resetEmailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email = String((req as any).resetThrottleEmail || 'unknown').trim().toLowerCase();
      return crypto.createHash('sha256').update(`${ipKeyGenerator(req.ip || 'unknown')}:${email}`).digest('hex');
    },
    message: { error: 'Too many password reset attempts. Please try again later.' },
  });
  const resolveResetEmail = async (req: any, _res: any, next: any) => {
    try {
      const candidate = req.method === 'GET' ? req.params.token : req.body?.token;
      if (typeof candidate === 'string' && candidate.length >= 32 && candidate.length <= 191) {
        const tokenRow = await db.get('SELECT email FROM password_reset_tokens WHERE tokenHash = ?', [hashResetToken(candidate)]);
        req.resetThrottleEmail = tokenRow?.email || 'unknown';
      } else {
        req.resetThrottleEmail = 'unknown';
      }
      next();
    } catch (error) {
      next(error);
    }
  };
  const forgotIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many password reset requests. Please try again later.' },
  });
  const forgotEmailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => crypto.createHash('sha256')
      .update(`${ipKeyGenerator(req.ip || 'unknown')}:${String(req.body?.email || '').trim().toLowerCase()}`)
      .digest('hex'),
    message: { error: 'Too many password reset requests. Please try again later.' },
  });
  const genericResetResponse = { success: true, message: 'If an account matches that email, password reset instructions will be sent.' };

  router.post('/forgot-password', forgotIpLimiter, forgotEmailLimiter, validate(ForgotPasswordSchema), async (req, res) => {
    const { email } = req.body;
    try {
      const user = await db.get('SELECT id, email, isLocked FROM users WHERE lower(email) = lower(?)', [email]);
      if (!user) return res.json(genericResetResponse);

      if (user.isLocked) {
        return res.json(genericResetResponse);
      }

      const recentPending = await db.get("SELECT id, createdAt FROM password_reset_requests WHERE userId = ? AND status = 'pending' ORDER BY createdAt DESC LIMIT 1", [user.id]);
      if (recentPending) {
        const elapsed = Date.now() - new Date(recentPending.createdAt).getTime();
        if (elapsed < 10 * 60 * 1000) return res.json(genericResetResponse);
      }

      const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
      const tokenHash = hashResetToken(token);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const appBaseUrl = process.env.APP_BASE_URL || 'https://ai.hieuhomecloud.online';
      const resetLink = `${appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;

      await db.run('DELETE FROM password_reset_tokens WHERE userId = ? AND usedAt IS NULL', [user.id]);
      await db.run('INSERT INTO password_reset_tokens (id, userId, email, token, tokenHash, expiresAt, usedAt) VALUES (?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), user.id, user.email, tokenHash, tokenHash, expiresAt, null]);

      if (recentPending) {
        await db.run('UPDATE password_reset_requests SET email = ?, emailStatus = ?, emailSentAt = ?, createdAt = ? WHERE id = ?', [user.email, 'pending', null, new Date().toISOString(), recentPending.id]);
      } else {
        await db.run("INSERT INTO password_reset_requests (id, userId, email, status, emailStatus, emailSentAt, createdAt) VALUES (?, ?, ?, 'pending', 'pending', NULL, ?)", [crypto.randomUUID(), user.id, user.email, new Date().toISOString()]);
      }

      let emailSent = false;
      try {
        emailSent = await mailer.sendResetLinkEmail(user.email, resetLink);
      } catch (mailError: any) {
        console.error('forgot-password mail error', mailError);
      }

      await db.run("UPDATE password_reset_requests SET emailStatus = ?, emailSentAt = ? WHERE userId = ? AND status = 'pending'", [emailSent ? 'sent' : 'failed', emailSent ? new Date().toISOString() : null, user.id]);
      return res.json(genericResetResponse);
    } catch (e) { console.error('forgot-password error', e); res.status(500).json({ error: 'Failed' }); }
  });

  router.get('/reset-password/:token', resetIpLimiter, resolveResetEmail, resetEmailLimiter, async (req, res) => {
    try {
      const token = String(req.params.token || '');
      const rt = await db.get('SELECT userId, email, expiresAt, usedAt FROM password_reset_tokens WHERE tokenHash = ?', [hashResetToken(token)]);
      if (!rt) return res.status(404).json({ error: 'Link đặt lại mật khẩu không tồn tại' });
      if (rt.usedAt) return res.status(400).json({ error: 'Link này đã được sử dụng' });
      if (new Date(rt.expiresAt).getTime() < Date.now()) return res.status(400).json({ error: 'Link đặt lại mật khẩu đã hết hạn' });
      return res.json({ success: true, expiresAt: rt.expiresAt });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.post('/reset-password', resetIpLimiter, validate(ResetPasswordSchema), resolveResetEmail, resetEmailLimiter, async (req, res) => {
    const { token, newPassword } = req.body;
    try {
      const tokenHash = hashResetToken(token);
      const rt = await db.get('SELECT id, userId, email, expiresAt, usedAt FROM password_reset_tokens WHERE tokenHash = ?', [tokenHash]);
      if (!rt) return res.status(404).json({ error: 'Link đặt lại mật khẩu không tồn tại' });
      if (rt.usedAt) return res.status(400).json({ error: 'Link này đã được sử dụng' });
      if (new Date(rt.expiresAt).getTime() < Date.now()) return res.status(400).json({ error: 'Link đặt lại mật khẩu đã hết hạn' });
      const now = new Date().toISOString();
      const hashedPassword = await bcrypt.hash(newPassword.trim(), 10);
      let transactionStarted = false;
      try {
        await db.run('START TRANSACTION');
        transactionStarted = true;
        const claimed = await db.run('UPDATE password_reset_tokens SET usedAt = ? WHERE id = ? AND usedAt IS NULL AND expiresAt >= ?', [now, rt.id, now]);
        if (!claimed?.changes) {
          await db.run('ROLLBACK');
          transactionStarted = false;
          return res.status(400).json({ error: 'Link đặt lại mật khẩu đã hết hạn hoặc đã được sử dụng' });
        }

        const passwordUpdate = await db.run('UPDATE users SET password = ?, failedLogins = 0, lockedUntil = NULL, tokenVersion = tokenVersion + 1 WHERE id = ?', [hashedPassword, rt.userId]);
        if (!passwordUpdate?.changes) throw new Error('Password reset user update did not affect a row');
        await db.run('DELETE FROM password_reset_tokens WHERE userId = ? AND usedAt IS NULL', [rt.userId]);
        await db.run("UPDATE password_reset_requests SET status = 'resolved', emailStatus = 'reset_done', emailSentAt = COALESCE(emailSentAt, ?) WHERE userId = ? AND status = 'pending'", [now, rt.userId]);
        await db.run('COMMIT');
        transactionStarted = false;
      } catch (error) {
        if (transactionStarted) {
          try { await db.run('ROLLBACK'); } catch {}
        }
        throw error;
      }
      return res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  return router;
}
