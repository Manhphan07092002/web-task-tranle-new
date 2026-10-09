import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const hashResetToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const UserBodySchema = z.object({
  id: z.string().trim().min(1).max(191).optional(),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128).optional().or(z.literal('')),
  role: z.string().trim().min(1).max(100),
  department: z.string().trim().max(191).nullable().optional(),
  avatar: z.string().max(2000).nullable().optional(),
  bio: z.string().max(5000).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  dob: z.string().max(64).nullable().optional(),
  hometown: z.string().max(300).nullable().optional(),
  cccd: z.string().max(50).nullable().optional(),
  gender: z.string().max(50).nullable().optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

export function userRoutes(db: any, mailer: any) {
  const router = Router();
  const canAssignRole = async (roleName: string, actor: any): Promise<boolean> => {
    if (actor?.role === 'Admin' || actor?.permissions?.includes('admin_panel')) return true;
    const role = await db.get('SELECT permissions FROM roles WHERE name = ?', [roleName]);
    if (!role) return false;
    try {
      const targetPermissions = JSON.parse(role.permissions || '[]');
      return Array.isArray(targetPermissions) && targetPermissions.every((permission) => actor?.permissions?.includes(permission));
    } catch {
      return false;
    }
  };

  router.get('/', async (req, res) => {
    try {
      const isAdmin = req.user?.role === 'Admin' || req.user?.permissions?.includes('admin_panel') || req.user?.permissions?.includes('manage_users');
      const query = isAdmin
        ? `SELECT u.id, u.name, u.email, u.role, u.department, u.managementLevel, u.primaryDepartmentId, u.avatar, u.bio, u.phone, u.dob, u.hometown, u.cccd, u.gender, u.preferences, u.isLocked, u.jobTitle, r.permissions FROM users u LEFT JOIN roles r ON u.role = r.name`
        : `SELECT u.id, u.name, u.email, u.role, u.department, u.managementLevel, u.primaryDepartmentId, u.avatar FROM users u`;
      const users = await db.all(query);
      res.json(users.map((u: any) => ({
        ...u,
        isLocked: Boolean(u.isLocked),
        permissions: u.permissions ? JSON.parse(u.permissions) : [],
        preferences: u.preferences ? JSON.parse(u.preferences) : {}
      })));
    } catch (e) { console.error('GET /api/users error:', e); res.status(500).json({ error: 'Failed' }); }
  });

  router.post('/', requirePermission('manage_users'), validate(UserBodySchema), async (req, res) => {
    const { id, name, email, password, role, department, avatar, bio, phone, dob, hometown, cccd, gender, preferences } = req.body;
    try {
      if (!(await canAssignRole(role, req.user))) return res.status(403).json({ error: 'You cannot assign this role' });
      const hashedPassword = password ? await bcrypt.hash(password, 10) : null;
      await db.run('INSERT INTO users (id, name, email, password, role, department, avatar, bio, phone, dob, hometown, cccd, gender, preferences) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, name, email, hashedPassword, role, department, avatar, bio || '', phone || '', dob || '', hometown || '', cccd || '', gender || '', preferences ? JSON.stringify(preferences) : '{}']);
      res.json({ id });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.put('/:id', requirePermission('manage_users'), validate(UserBodySchema.omit({ id: true })), async (req, res) => {
    const { name, email, password, role, department, avatar, bio, phone, dob, hometown, cccd, gender, preferences } = req.body;
    try {
      if (!(await canAssignRole(role, req.user))) return res.status(403).json({ error: 'You cannot assign this role' });
      const existingUser = await db.get('SELECT id, email FROM users WHERE id = ?', [req.params.id]);
      if (!existingUser) return res.status(404).json({ error: 'User not found' });
      const emailChanged = String(existingUser.email || '').trim().toLowerCase() !== email.trim().toLowerCase();
      if (password) {
        const hashed = await bcrypt.hash(password, 10);
        await db.run('UPDATE users SET name=?, email=?, password=?, role=?, department=?, avatar=?, bio=?, phone=?, dob=?, hometown=?, cccd=?, gender=?, preferences=?, tokenVersion = tokenVersion + 1 WHERE id=?', [name, email, hashed, role, department, avatar, bio || '', phone || '', dob || '', hometown || '', cccd || '', gender || '', preferences ? JSON.stringify(preferences) : '{}', req.params.id]);
      } else {
        await db.run('UPDATE users SET name=?, email=?, role=?, department=?, avatar=?, bio=?, phone=?, dob=?, hometown=?, cccd=?, gender=?, preferences=?, tokenVersion = tokenVersion + 1 WHERE id=?', [name, email, role, department, avatar, bio || '', phone || '', dob || '', hometown || '', cccd || '', gender || '', preferences ? JSON.stringify(preferences) : '{}', req.params.id]);
      }
      if (password || emailChanged) {
        await db.run('DELETE FROM password_reset_tokens WHERE userId = ? AND usedAt IS NULL', [req.params.id]);
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.delete('/:id', requirePermission('manage_users'), async (req, res) => {
    try {
      await db.run('DELETE FROM users WHERE id=?', [req.params.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.post('/:id/reset-password', requirePermission('manage_users'), async (req, res) => {
    try {
      const user = await db.get('SELECT id, email, name FROM users WHERE id = ?', [req.params.id]);
      if (!user) return res.status(404).json({ error: 'User not found' });
      const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
      const tokenHash = hashResetToken(token);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const appBaseUrl = process.env.APP_BASE_URL || 'https://ai.hieuhomecloud.online';
      const resetLink = `${appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
      await db.run('DELETE FROM password_reset_tokens WHERE userId = ? AND usedAt IS NULL', [req.params.id]);
      await db.run('INSERT INTO password_reset_tokens (id, userId, email, token, tokenHash, expiresAt, usedAt) VALUES (?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), req.params.id, user.email, tokenHash, tokenHash, expiresAt, null]);
      await db.run("UPDATE password_reset_requests SET status = 'resolved' WHERE userId = ? AND status = 'pending'", [req.params.id]);
      const emailSent = await mailer.sendResetLinkEmail(user.email, resetLink);
      return res.json({ success: true, emailSent, expiresAt });
    } catch (e) { console.error('reset-password error', e); res.status(500).json({ error: 'Failed' }); }
  });

  router.put('/:id/lock', requirePermission('manage_users'), async (req, res) => {
    try {
      await db.run('UPDATE users SET isLocked = 1, lockedUntil = NULL, failedLogins = 0, tokenVersion = tokenVersion + 1 WHERE id = ?', [req.params.id]);
      try {
        await db.run(
          `INSERT INTO activity_logs (id, userId, action, entityId, entityType, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), req.params.id, 'Khóa tài khoản', req.params.id, 'user', 'Admin chủ động khóa tài khoản', new Date().toISOString()]
        );
      } catch (e) {}
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.put('/:id/unlock', requirePermission('manage_users'), async (req, res) => {
    try {
      await db.run('UPDATE users SET isLocked = 0, lockedUntil = NULL, failedLogins = 0, tokenVersion = tokenVersion + 1 WHERE id = ?', [req.params.id]);
      try {
        await db.run(
          `INSERT INTO activity_logs (id, userId, action, entityId, entityType, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), req.params.id, 'Mở khóa tài khoản', req.params.id, 'user', 'Admin mở khóa tài khoản', new Date().toISOString()]
        );
      } catch (e) {}
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  return router;
}
