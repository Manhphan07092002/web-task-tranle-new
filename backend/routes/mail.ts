import { Router } from 'express';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
// @ts-ignore
import MailComposer from 'nodemailer/lib/mail-composer';
import { encrypt, decrypt } from '../utils/cryptoUtils.js';
import { createRequireAuth } from '../middleware/auth.js';
import { createMailer } from '../mailer.js';
import { assertMailEndpointsSafe, configuredMailHostAllowlist } from '../utils/mailHostSecurity.js';
import { mailTlsOptions } from '../utils/mailTls.js';
import { validate } from '../middleware/validate.js';
import { TRANLE_WEBMAIL } from '../utils/tranleWebmail.js';
import { connectImapMailbox } from '../utils/imapConnection.js';

const MailConnectSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(4096).refine((value) => !/[\r\n\0]/.test(value), 'Invalid mail password'),
  provider: z.enum(['poste', 'vnpt', 'webmail', 'custom']).optional(),
  customImapHost: z.string().max(253).optional(),
  customImapPort: z.coerce.number().int().min(1).max(65535).optional(),
  customSmtpHost: z.string().max(253).optional(),
  customSmtpPort: z.coerce.number().int().min(1).max(65535).optional(),
});
const MailComposeSchema = z.object({
  to: z.string().trim().min(1).max(4000),
  subject: z.string().trim().min(1).max(998),
  body: z.string().max(5 * 1024 * 1024),
  cc: z.string().max(4000).optional(),
  bcc: z.string().max(4000).optional(),
  track: z.enum(['true', 'false']).optional(),
});
const MailScheduleSchema = MailComposeSchema.extend({
  scheduledAt: z.string().datetime({ offset: true }),
});
const MailFolderSchema = z.string().trim().min(1).max(255).refine((folder) => !/[\r\n\0]/.test(folder));
const MailFlagSchema = z.object({ folder: MailFolderSchema.optional().default('INBOX'), starred: z.boolean() });
const MailReadSchema = z.object({ folder: MailFolderSchema.optional().default('INBOX'), isRead: z.boolean() });
const MailBulkSchema = z.object({
  uids: z.array(z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER)).max(5000).optional(),
  action: z.enum(['delete', 'restore']),
  folder: MailFolderSchema.optional().default('INBOX'),
  allInFolder: z.boolean().optional().default(false),
}).refine((body) => body.allInFolder || Boolean(body.uids?.length), 'uids are required unless allInFolder is true');

function isTranleWebmailEndpoint(host: unknown, port: unknown, expectedPort: number): boolean {
  const normalizedHost = String(host || '').trim().toLowerCase();
  return (normalizedHost === TRANLE_WEBMAIL.host || normalizedHost === 'share-mail05.nhanhoa.com')
    && Number(port) === expectedPort;
}

/** Convert older custom records that match the company Webmail endpoint to its preset. */
export function resolveMailProvider(userConfig: any, systemSmtpHost: unknown): 'poste' | 'custom' | 'webmail' {
  const usesTranleWebmail = isTranleWebmailEndpoint(userConfig?.imapHost, userConfig?.imapPort, TRANLE_WEBMAIL.imapPort)
    && isTranleWebmailEndpoint(userConfig?.smtpHost, userConfig?.smtpPort, TRANLE_WEBMAIL.smtpPort);
  if (userConfig?.provider === 'webmail' || (userConfig?.provider === 'custom' && usesTranleWebmail)) return 'webmail';
  if (userConfig?.provider === 'poste' || userConfig?.provider === 'custom') return userConfig.provider;

  const host = String(systemSmtpHost || '').toLowerCase();
  const isPoste = host === 'tranle_mailserver' || host.includes('localhost') || host.includes('mailserver') || host.includes('127.0.0.1');
  return isPoste ? 'poste' : 'webmail';
}

export function isSafeMailHeaders(to: unknown, subject: unknown, cc: unknown, bcc: unknown, body: unknown): boolean {
  const hasInjection = (value: unknown): boolean => {
    if (typeof value === 'string') return /[\r\n]/.test(value);
    if (Array.isArray(value)) return value.some(hasInjection);
    if (value && typeof value === 'object') return Object.values(value).some(hasInjection);
    return false;
  };
  const validAddressHeader = (value: unknown) => value == null || (
    typeof value === 'string' && value.length <= 4000
  ) || (
    Array.isArray(value) && value.length <= 100 && value.every((item) => typeof item === 'string' && item.length <= 320)
  );
  return validAddressHeader(to) && Boolean(to) && validAddressHeader(cc) && validAddressHeader(bcc)
    && typeof subject === 'string' && subject.trim().length > 0 && subject.length <= 998
    && (body === undefined || body === null || (typeof body === 'string' && body.length <= 5 * 1024 * 1024))
    && ![to, subject, cc, bcc].some(hasInjection);
}

export function mailRoutes(db: any) {
  const router = Router();
  const requireAuth = createRequireAuth(db);
  const tlsOptions = mailTlsOptions();
  const mailConnectLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      const resetTime = (req as any).rateLimit?.resetTime?.getTime() || Date.now() + 15 * 60 * 1000;
      const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        code: 'MAIL_RATE_LIMITED',
        error: 'Bạn đã thử kết nối quá nhiều lần. Vui lòng chờ trước khi thử lại.',
        retryAfterSeconds,
      });
    },
  });
  const allowedCustomMailHosts = configuredMailHostAllowlist();
  const getDynamicConfig = async () => {
    const mailer = createMailer(db);
    return await mailer.getSystemConfig();
  };

  // Get active system mail config provider (to let user profiles adapt settings texts)
  router.get('/provider', requireAuth, async (req: any, res: any) => {
    try {
      let userConfig: any = {};
      const user = await db.get('SELECT mailPassword FROM users WHERE id = ?', [req.user.id]);
      if (user && user.mailPassword) {
        try {
          userConfig = JSON.parse(decrypt(user.mailPassword) || '{}');
        } catch(e) {}
      }
      const config = await getDynamicConfig();
      const provider = resolveMailProvider(userConfig, config.SMTP_HOST);
      res.json({
        provider,
        imapHost: userConfig.imapHost || config.IMAP_HOST,
        smtpHost: userConfig.smtpHost || config.SMTP_HOST
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 1. Connect and Save Credentials
  router.post('/connect', requireAuth, mailConnectLimiter, validate(MailConnectSchema), async (req: any, res: any) => {
    const { email, password, provider, customImapHost, customImapPort, customSmtpHost, customSmtpPort } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    let stage: 'config' | 'connect' | 'save' = 'config';
    try {
      if (!process.env.MAIL_ENCRYPTION_KEY?.trim()) {
        return res.status(503).json({ code: 'MAIL_CONFIG_ERROR', error: 'Máy chủ chưa cấu hình khóa mã hóa email. Vui lòng liên hệ quản trị viên.' });
      }
      const config = await getDynamicConfig();
      let targetImapHost = config.IMAP_HOST;
      let targetImapPort = Number(config.IMAP_PORT);
      let targetSmtpHost = config.SMTP_HOST;
      let targetSmtpPort = Number(config.SMTP_PORT);

      if (provider === 'webmail' || provider === 'vnpt') {
        targetImapHost = TRANLE_WEBMAIL.host;
        targetImapPort = TRANLE_WEBMAIL.imapPort;
        targetSmtpHost = TRANLE_WEBMAIL.host;
        targetSmtpPort = TRANLE_WEBMAIL.smtpPort;
      } else if (provider === 'poste') {
        targetImapHost = 'tranle_mailserver';
        targetImapPort = 993;
        targetSmtpHost = 'tranle_mailserver';
        targetSmtpPort = 587;
      } else if (provider === 'custom') {
        targetImapHost = customImapHost || config.IMAP_HOST;
        targetImapPort = Number(customImapPort) || Number(config.IMAP_PORT);
        targetSmtpHost = customSmtpHost || config.SMTP_HOST;
        targetSmtpPort = Number(customSmtpPort) || Number(config.SMTP_PORT);
        if (process.env.NODE_ENV === 'production') {
          for (const host of new Set([String(targetImapHost), String(targetSmtpHost)])) {
            const normalizedHost = host.trim().toLowerCase().replace(/\.$/, '');
            if (!allowedCustomMailHosts.has(normalizedHost)) {
              return res.status(400).json({ error: 'Custom mail hosts must be explicitly configured in MAIL_ALLOWED_CUSTOM_HOSTS in production' });
            }
          }
        }
      }

      try {
        await assertMailEndpointsSafe({
          imapHost: String(targetImapHost), imapPort: targetImapPort,
          smtpHost: String(targetSmtpHost), smtpPort: targetSmtpPort,
        }, allowedCustomMailHosts);
      } catch {
        return res.status(400).json({ code: 'MAIL_ENDPOINT_INVALID', error: 'Máy chủ hoặc cổng email không hợp lệ hoặc không được phép kết nối.' });
      }

      stage = 'connect';
      const client = await connectImapMailbox({
        host: targetImapHost, port: targetImapPort, email, password,
        allowUsernameFallback: !isTranleWebmailEndpoint(targetImapHost, targetImapPort, TRANLE_WEBMAIL.imapPort),
      });
      client.close();

      stage = 'save';
      // If successful, encrypt and save both email and password
      const mailAuthData = JSON.stringify({
        email,
        password,
        provider,
        imapHost: targetImapHost,
        imapPort: targetImapPort,
        smtpHost: targetSmtpHost,
        smtpPort: targetSmtpPort
      });
      const encryptedData = encrypt(mailAuthData);
      await db.run('UPDATE users SET mailPassword = ? WHERE id = ?', [encryptedData, req.user.id]);
      smtpCache.delete(req.user.id);

      res.json({ success: true, message: 'Connected successfully' });
    } catch (error: any) {
      let status = 500;
      let code = stage === 'save' ? 'MAIL_SAVE_FAILED' : 'MAIL_CONFIG_ERROR';
      let message = stage === 'save'
        ? 'Đăng nhập hộp thư thành công nhưng không lưu được cấu hình. Vui lòng liên hệ quản trị viên.'
        : 'Không đọc được cấu hình email trên máy chủ. Vui lòng liên hệ quản trị viên.';
      if (stage === 'connect') {
        status = 502;
        code = 'MAIL_CONNECTION_FAILED';
        message = 'Không kết nối được máy chủ email. Vui lòng kiểm tra máy chủ và đường truyền.';
        const upstreamCode = String(error.code || '');
        if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(upstreamCode)) {
          code = 'MAIL_TLS_ERROR';
          message = 'Không xác minh được chứng chỉ bảo mật của máy chủ email. Vui lòng liên hệ quản trị viên.';
        } else if (/TIMEOUT|TIMEDOUT/.test(upstreamCode)) {
          status = 504;
          code = 'MAIL_TIMEOUT';
          message = 'Máy chủ email phản hồi quá chậm. Vui lòng thử lại sau.';
        } else if (error.authenticationFailed === true) {
          status = 401;
          code = 'MAIL_AUTH_FAILED';
          message = 'Máy chủ từ chối đăng nhập hộp thư. Kiểm tra đầy đủ địa chỉ email và mật khẩu của chính hộp thư đó.';
        }
      }
      console.warn(`[Mail connect] ${code}`);
      res.status(status).json({ code, error: message });
    }
  });

  // 2. Helper to get IMAP client
  const getImapClient = async (userId: string, defaultEmail: string) => {
    const user = await db.get('SELECT mailPassword FROM users WHERE id = ?', [userId]);
    if (!user || !user.mailPassword) throw new Error('No mail credentials found');

    const decryptedStr = decrypt(user.mailPassword);
    if (!decryptedStr) throw new Error('Failed to decrypt password');

    let email = defaultEmail;
    let password = decryptedStr;
    let targetImapHost = null;
    let targetImapPort = null;
    try {
      const parsed = JSON.parse(decryptedStr);
      if (parsed.email && parsed.password) {
        email = parsed.email;
        password = parsed.password;
        targetImapHost = parsed.imapHost;
        targetImapPort = parsed.imapPort;
      }
    } catch (e) {
      // It's a raw password from old format
    }

    const config = await getDynamicConfig();
    const finalImapHost = targetImapHost || config.IMAP_HOST;
    const finalImapPort = Number(targetImapPort || config.IMAP_PORT);
    await assertMailEndpointsSafe({ imapHost: finalImapHost, imapPort: finalImapPort });

    return connectImapMailbox({
      host: finalImapHost, port: finalImapPort, email, password,
      allowUsernameFallback: !isTranleWebmailEndpoint(finalImapHost, finalImapPort, TRANLE_WEBMAIL.imapPort),
    });
  };

  // 3. Helper to get SMTP transporter (cached per user for performance)
  const smtpCache = new Map<string, any>();

  const getSmtpTransporter = async (userId: string, defaultEmail: string) => {
    // Return cached transporter if available
    if (smtpCache.has(userId)) {
      return smtpCache.get(userId);
    }

    const user = await db.get('SELECT mailPassword FROM users WHERE id = ?', [userId]);
    if (!user || !user.mailPassword) throw new Error('No mail credentials found');

    const decryptedStr = decrypt(user.mailPassword);
    if (!decryptedStr) throw new Error('Failed to decrypt password');

    let email = defaultEmail;
    let password = decryptedStr;
    let targetSmtpHost = null;
    let targetSmtpPort = null;
    try {
      const parsed = JSON.parse(decryptedStr);
      if (parsed.email && parsed.password) {
        email = parsed.email;
        password = parsed.password;
        targetSmtpHost = parsed.smtpHost;
        targetSmtpPort = parsed.smtpPort;
      }
    } catch (e) {
      // It's a raw password from old format
    }

    const config = await getDynamicConfig();
    const hasUserSmtpConfig = Boolean(targetSmtpHost || targetSmtpPort);
    const finalSmtpHost = targetSmtpHost || config.SMTP_HOST || TRANLE_WEBMAIL.host;
    const finalSmtpPort = Number(targetSmtpPort || config.SMTP_PORT || TRANLE_WEBMAIL.smtpPort);
    await assertMailEndpointsSafe({ smtpHost: finalSmtpHost, smtpPort: finalSmtpPort });

    const makeTransporter = (user: string) => nodemailer.createTransport({
      host: finalSmtpHost,
      port: finalSmtpPort,
      // Per-user hosts only store their port; do not inherit TLS mode from the system host.
      secure: finalSmtpPort === 465 || (!hasUserSmtpConfig && config.SMTP_SECURE === 'true'),
      auth: { user, pass: password },
      tls: tlsOptions,
      connectionTimeout: 60000,
      greetingTimeout: 60000,
      socketTimeout: 60000,
    });

    let transporter = makeTransporter(email);

    // Verify connection once; retry with username only if auth fails
    try {
      await transporter.verify();
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('Invalid login') || msg.includes('AuthError') || msg.includes('535')) {
        const usernameOnly = email.split('@')[0];
        console.log(`[SMTP] Retrying with username only: ${usernameOnly}`);
        transporter = makeTransporter(usernameOnly);
        await transporter.verify();
      } else {
        throw err;
      }
    }

    // Cache for future sends (invalidate after 10 minutes)
    smtpCache.set(userId, transporter);
    setTimeout(() => smtpCache.delete(userId), 10 * 60 * 1000);

    return transporter;
  };

  // Helper: detect IMAP/SMTP auth errors (ImapFlow throws 'Command failed' with authenticationFailed=true)
  const isMailAuthError = (error: any): boolean => {
    if (!error) return false;
    if (error.authenticationFailed === true) return true;
    const msg = (error.message || '').toLowerCase();
    const responseText = (error.responseText || '').toLowerCase();
    const response = (error.response || '').toLowerCase();
    return (
      msg.includes('no mail credentials') ||
      msg.includes('authenticate failed') ||
      msg.includes('authentication failed') ||
      responseText.includes('authenticate failed') ||
      response.includes('authenticate failed') ||
      msg.includes('invalid login') ||
      msg.includes('autherror')
    );
  };

  // 3a. Fetch company contacts (all users in DB + IMAP history)
  router.get('/contacts', requireAuth, async (req: any, res: any) => {
    try {
      // 1) Get all company users from DB
      const dbUsers = await db.all('SELECT id, name, email, department, avatar FROM users ORDER BY name ASC');
      
      // 2) Try to get recent IMAP contacts (best-effort)
      let imapContacts: { email: string; name: string; source: string }[] = [];
      try {
        const client = await getImapClient(req.user.id, req.user.email);
        const contactSet = new Map<string, { email: string; name: string; count: number }>();

        // Scan sent folder
        const sentCandidates = ['Sent', 'Sent Items', 'Sent Messages', 'INBOX.Sent'];
        let sentFolder = '';
        for (const name of sentCandidates) {
          try { const l = await client.getMailboxLock(name); l.release(); sentFolder = name; break; } catch (_) {}
        }

        if (sentFolder) {
          const lock = await client.getMailboxLock(sentFolder);
          try {
            const mailbox = client.mailbox;
            if (mailbox !== false && (mailbox as any).exists > 0) {
              const count = (mailbox as any).exists as number;
              const start = Math.max(1, count - 199);
              for await (const msg of client.fetch(`${start}:${count}`, { envelope: true })) {
                const toList = [...(msg.envelope?.to || []), ...(msg.envelope?.cc || [])];
                for (const addr of toList) {
                  if (!addr.address) continue;
                  const key = addr.address.toLowerCase();
                  const existing = contactSet.get(key);
                  if (existing) existing.count++;
                  else contactSet.set(key, { email: addr.address, name: addr.name || '', count: 1 });
                }
              }
            }
          } finally { lock.release(); }
        }

        // Scan inbox (From addresses)
        const inboxLock = await client.getMailboxLock('INBOX');
        try {
          const mailbox = client.mailbox;
          if (mailbox !== false && (mailbox as any).exists > 0) {
            const count = (mailbox as any).exists as number;
            const start = Math.max(1, count - 199);
            for await (const msg of client.fetch(`${start}:${count}`, { envelope: true })) {
              const fromList = msg.envelope?.from || [];
              for (const addr of fromList) {
                if (!addr.address) continue;
                const key = addr.address.toLowerCase();
                const existing = contactSet.get(key);
                if (existing) existing.count++;
                else contactSet.set(key, { email: addr.address, name: addr.name || '', count: 1 });
              }
            }
          }
        } finally { inboxLock.release(); await client.logout(); }

        imapContacts = Array.from(contactSet.values())
          .sort((a, b) => b.count - a.count)
          .map(c => ({ email: c.email, name: c.name, source: 'imap' }));
      } catch (imapErr: any) {
        console.warn('[Contacts] IMAP scan skipped:', imapErr.message);
      }

      // 3) Build response: company users first, then external IMAP contacts not already in company
      const companyEmails = new Set(dbUsers.map((u: any) => u.email?.toLowerCase()));
      
      const companyContacts = dbUsers.map((u: any) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        department: u.department || '',
        avatar: u.avatar || '',
        source: 'company',
      }));

      const externalContacts = imapContacts
        .filter(c => !companyEmails.has(c.email.toLowerCase()))
        .slice(0, 50)
        .map(c => ({ id: null, name: c.name, email: c.email, department: '', avatar: '', source: 'external' }));

      res.json({ company: companyContacts, external: externalContacts });
    } catch (error: any) {
      console.error('Contacts error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 3b. Fetch recent recipients (for autocomplete)
  router.get('/recipients', requireAuth, async (req: any, res: any) => {
    try {
      const client = await getImapClient(req.user.id, req.user.email);
      // Try to open Sent folder
      const sentCandidates = ['Sent', 'Sent Items', 'Sent Messages', 'INBOX.Sent'];
      let sentFolder = '';
      for (const name of sentCandidates) {
        try {
          const testLock = await client.getMailboxLock(name);
          testLock.release();
          sentFolder = name;
          break;
        } catch (_) { /* try next */ }
      }
      if (!sentFolder) {
        await client.logout();
        return res.json([]);
      }

      const lock = await client.getMailboxLock(sentFolder);
      try {
        const recipientSet = new Map<string, { email: string; name: string; count: number }>();
        const mailbox = client.mailbox;
        if (mailbox !== false) {
          const count = mailbox.exists || 0;
          const start = Math.max(1, count - 99); // last 100 sent
          const seq = count > 0 ? `${start}:${count}` : '1:*';
          if (count > 0) {
            for await (const msg of client.fetch(seq, { envelope: true, uid: true })) {
              const toList = msg.envelope?.to || [];
              for (const addr of toList) {
                if (!addr.address) continue;
                const key = addr.address.toLowerCase();
                if (recipientSet.has(key)) {
                  recipientSet.get(key)!.count++;
                } else {
                  recipientSet.set(key, {
                    email: addr.address,
                    name: addr.name || '',
                    count: 1
                  });
                }
              }
            }
          }
        }
        // Sort by frequency, return top 30
        const sorted = Array.from(recipientSet.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 30);
        res.json(sorted);
      } finally {
        lock.release();
        await client.logout();
      }
    } catch (error: any) {
      console.error('Fetch recipients error:', error);
      res.json([]); // Return empty on error, not 500
    }
  });

  // Disconnect mail - clear saved credentials
  router.post('/disconnect', requireAuth, async (req: any, res: any) => {
    try {
      await db.run('UPDATE users SET mailPassword = NULL WHERE id = ?', [req.user.id]);
      res.json({ success: true, message: 'Đã ngắt kết nối email.' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // IMAP folder name resolver
  const resolveFolder = async (client: any, folderKey: string): Promise<string> => {
    // Try to list mailboxes to find real folder names
    const folderMap: Record<string, string[]> = {
      sent: ['Sent', 'Sent Items', 'Sent Messages', 'INBOX.Sent'],
      trash: ['Trash', 'Deleted Items', 'Deleted Messages', 'INBOX.Trash'],
      starred: ['Starred', 'Flagged', 'INBOX.Starred'],
      inbox: ['INBOX'],
    };
    const candidates = folderMap[folderKey] || ['INBOX'];
    for (const name of candidates) {
      try {
        const lock = await client.getMailboxLock(name);
        lock.release();
        return name;
      } catch (_) { /* try next */ }
    }
    return 'INBOX';
  };

  // 3b. Get total unread count for INBOX
  router.get('/unread-count', requireAuth, async (req: any, res: any) => {
    try {
      const client = await getImapClient(req.user.id, req.user.email);
      const folderName = await resolveFolder(client, 'inbox');
      const lock = await client.getMailboxLock(folderName);
      try {
        const uids = await client.search({ seen: false }, { uid: true });
        res.json({ count: uids ? uids.length : 0 });
      } finally {
        lock.release();
        await client.logout();
      }
    } catch (error: any) {
      res.status(isMailAuthError(error) ? 401 : 500).json({ error: error.message });
    }
  });

  // 3c. Check for new unseen mail globally
  router.get('/check-new', requireAuth, async (req: any, res: any) => {
    try {
      const client = await getImapClient(req.user.id, req.user.email);
      const folderName = await resolveFolder(client, 'inbox');
      const lock = await client.getMailboxLock(folderName);
      try {
        const mailbox = client.mailbox;
        if (mailbox !== false && mailbox.exists > 0) {
          const count = mailbox.exists;
          for await (let msg of client.fetch(count.toString(), { envelope: true, flags: true, uid: true })) {
            const isRead = msg.flags ? msg.flags.has('\\Seen') : false;
            return res.json({ 
              uid: msg.uid, 
              subject: msg.envelope?.subject, 
              fromName: msg.envelope?.from?.[0]?.name,
              from: msg.envelope?.from?.[0]?.address,
              isRead 
            });
          }
        }
        res.json({ uid: null });
      } finally {
        lock.release();
        await client.logout();
      }
    } catch (error: any) {
      res.status(isMailAuthError(error) ? 401 : 500).json({ error: error.message });
    }
  });

  // 4. Fetch Folder (inbox / sent / trash / starred)

  router.get('/inbox', requireAuth, async (req: any, res: any) => {
    const folderKey = (req.query.folder as string || 'inbox').toLowerCase();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    try {
      const client = await getImapClient(req.user.id, req.user.email);
      const folderName = await resolveFolder(client, folderKey);
      const lock = await client.getMailboxLock(folderName);

      try {
        const messages: any[] = [];
        const seenMessageIds = new Set<string>();
        const mailbox = client.mailbox;
        if (mailbox !== false) {
          const count = mailbox.exists || 0;
          const end = count - (page - 1) * limit;
          const start = Math.max(1, end - limit + 1);

          if (end > 0) {
            const seq = `${start}:${end}`;
            for await (let msg of client.fetch(seq, { envelope: true, flags: true, uid: true })) {
              const envelope = msg.envelope;
              const flags = msg.flags ? Array.from(msg.flags) : [];
              const isRead = msg.flags ? msg.flags.has('\\Seen') : false;
              const isStarred = msg.flags ? msg.flags.has('\\Flagged') : false;

              if (folderKey === 'starred' && !isStarred) continue;

              // Deduplicate by Message-ID to fix duplicate email display issue
              const msgId = envelope?.messageId || msg.uid.toString();
              if (seenMessageIds.has(msgId)) continue;
              seenMessageIds.add(msgId);

              const fromAddress = envelope?.from?.[0]?.address || envelope?.from?.[0]?.name || 'Unknown';
              const fromName = envelope?.from?.[0]?.name || '';
              const toAddress = envelope?.to?.[0]?.address || '';
              const toName = envelope?.to?.[0]?.name || '';

              messages.push({
                id: msg.uid,
                subject: envelope?.subject || '',
                from: fromAddress,
                fromName: fromName,
                to: toAddress,
                toName: toName,
                date: envelope?.date || new Date(),
                flags,
                isRead,
                isStarred,
                folder: folderName,
              });
            }
          }
        }
        res.json(messages.reverse());
      } finally {
        lock.release();
        await client.logout();
      }
    } catch (error: any) {
      console.error('Fetch folder error:', error);
      res.status(isMailAuthError(error) ? 401 : 500).json({ error: error.message || 'Failed to fetch folder' });
    }
  });

  // 4b. Star / Unstar email
  router.patch('/message/:uid/star', requireAuth, validate(MailFlagSchema), async (req: any, res: any) => {
    const { folder = 'INBOX', starred } = req.body;
    try {
      const client = await getImapClient(req.user.id, req.user.email);
      const lock = await client.getMailboxLock(folder);
      try {
        const uid = req.params.uid;
        if (starred) {
          await client.messageFlagsAdd(uid, ['\\Flagged'], { uid: true });
        } else {
          await client.messageFlagsRemove(uid, ['\\Flagged'], { uid: true });
        }
        res.json({ success: true });
      } finally {
        lock.release();
        await client.logout();
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 4b2. Mark read / unread
  router.patch('/message/:uid/read', requireAuth, validate(MailReadSchema), async (req: any, res: any) => {
    const { folder = 'INBOX', isRead } = req.body;
    try {
      const client = await getImapClient(req.user.id, req.user.email);
      const lock = await client.getMailboxLock(folder);
      try {
        const uid = req.params.uid;
        if (isRead) {
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
        } else {
          await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
        }
        res.json({ success: true });
      } finally {
        lock.release();
        await client.logout();
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 4c. Move to Trash or Permanent Delete
  router.delete('/message/:uid', requireAuth, async (req: any, res: any) => {
    const { folder = 'INBOX' } = req.query;
    try {
      const client = await getImapClient(req.user.id, req.user.email);
      const actualTrashName = await resolveFolder(client, 'trash');
      const lock = await client.getMailboxLock(folder as string);
      
      try {
        const uid = req.params.uid;
        
        // If the email is already in the Trash folder, delete it permanently
        if (folder.toLowerCase() === actualTrashName.toLowerCase() || folder.toLowerCase() === 'trash') {
          await client.messageDelete(uid, { uid: true });
        } else {
          // Otherwise, move it to the Trash folder
          await client.messageMove(uid, actualTrashName, { uid: true }).catch(() => {
            // Fallback: If MOVE command fails or isn't supported, just mark as deleted
            client.messageFlagsAdd(uid, ['\\Deleted'], { uid: true });
          });
        }
        res.json({ success: true });
      } finally {
        lock.release();
        await client.logout();
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 4d. Bulk Actions (Delete / Restore)
  router.post('/bulk', requireAuth, validate(MailBulkSchema), async (req: any, res: any) => {
    const { uids, action, folder = 'INBOX', allInFolder = false } = req.body;
    if (!allInFolder && (!uids || !Array.isArray(uids) || uids.length === 0)) {
      return res.status(400).json({ error: 'uids array is required' });
    }
    
    try {
      const client = await getImapClient(req.user.id, req.user.email);
      const actualTrashName = await resolveFolder(client, 'trash');
      const lock = await client.getMailboxLock(folder as string);
      
      try {
        // If allInFolder, use 1:* to target every message in the mailbox
        const sequence = allInFolder ? '1:*' : uids.join(',');
        const useUid = !allInFolder; // 1:* is a seq range, not UID
        
        if (action === 'delete') {
          if (folder.toLowerCase() === actualTrashName.toLowerCase() || folder.toLowerCase() === 'trash') {
            await client.messageDelete(sequence, { uid: useUid });
          } else {
            await client.messageMove(sequence, actualTrashName, { uid: useUid }).catch(() => {
              client.messageFlagsAdd(sequence, ['\\Deleted'], { uid: useUid });
            });
          }
        } else if (action === 'restore') {
          // Restore to Inbox
          const actualInboxName = await resolveFolder(client, 'inbox');
          await client.messageMove(sequence, actualInboxName, { uid: useUid }).catch(() => {
            throw new Error('Move to Inbox failed');
          });
        } else {
          return res.status(400).json({ error: 'Invalid action' });
        }
        
        res.json({ success: true });
      } finally {
        lock.release();
        await client.logout();
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 5. Read Single Email (folder-aware)
  router.get('/message/:uid', requireAuth, async (req: any, res: any) => {
    const folder = (req.query.folder as string) || 'INBOX';
    try {
      const client = await getImapClient(req.user.id, req.user.email);
      const lock = await client.getMailboxLock(folder);

      try {
        const uid = parseInt(req.params.uid, 10);
        const msg = await client.fetchOne(uid.toString(), { source: true }, { uid: true });

        if (!msg || !msg.source) return res.status(404).json({ error: 'Message not found' });

        const parsed = await simpleParser(msg.source);

        // Mark as read
        await client.messageFlagsAdd(uid.toString(), ['\\Seen'], { uid: true });

        res.json({
          id: uid,
          subject: parsed.subject,
          from: parsed.from?.text,
          to: Array.isArray(parsed.to) ? parsed.to.map((a: any) => a.text).join(', ') : (parsed.to as any)?.text,
          date: parsed.date,
          html: parsed.html || parsed.textAsHtml || parsed.text,
          attachments: parsed.attachments.map((a: any) => ({
            filename: a.filename,
            contentType: a.contentType,
            size: a.size,
            content: a.size < 5 * 1024 * 1024 ? a.content.toString('base64') : null
          }))
        });
      } finally {
        lock.release();
        await client.logout();
      }
    } catch (error: any) {
      console.error('Fetch message error:', error);
      res.status(isMailAuthError(error) ? 401 : 500).json({ error: error.message || 'Failed to fetch message' });
    }
  });

  // Setup multer for file uploads in memory
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 10, fields: 30 },
  });

  // 6. Send Email + Save to Sent folder
  router.post('/send', requireAuth, upload.array('attachments', 10), validate(MailComposeSchema), async (req: any, res: any) => {
    const { to, subject, body, cc, bcc } = req.body;
    if (!isSafeMailHeaders(to, subject, cc, bcc, body)) return res.status(400).json({ error: 'Invalid recipient, subject, body, or email header value' });

    try {
      // Fetch full user from DB (name for display) + VNPT email from mailPassword
      const dbUser = await db.get('SELECT id, name, mailPassword FROM users WHERE id = ?', [req.user.id]);
      if (!dbUser || !dbUser.mailPassword) return res.status(400).json({ error: 'Chưa cấu hình tài khoản mail. Vui lòng vào Cài đặt → Mail để kết nối.' });

      // Extract VNPT email from encrypted mailPassword JSON
      let mailEmail = req.user.email;
      try {
        const decrypted = decrypt(dbUser.mailPassword);
        if (decrypted) {
          const parsed = JSON.parse(decrypted);
          if (parsed.email) mailEmail = parsed.email;
        }
      } catch (_) { }

      const transporter = await getSmtpTransporter(req.user.id, mailEmail);

      const fromLabel = dbUser.name
        ? `"${dbUser.name}" <${mailEmail}>`
        : mailEmail;

      // Also pass mailEmail to IMAP appender later
      const senderEmail = mailEmail;

      console.info('[SMTP] Sending email');

      // Map multer files to nodemailer attachments
      let totalSize = 0;
      console.info(`[SMTP] Received ${(req.files as any[] | undefined)?.length || 0} attachment(s)`);
      const mailAttachments = req.files ? (req.files as any[]).map(f => {
        totalSize += f.size;
        const decodedName = Buffer.from(f.originalname, 'latin1').toString('utf8');
        return {
          filename: decodedName.replace(/[\r\n]/g, '').slice(0, 255),
          content: f.buffer,
          contentType: f.mimetype
        };
      }) : [];

      if (totalSize > 25 * 1024 * 1024) {
        return res.status(400).json({ error: 'Tổng dung lượng đính kèm không được vượt quá 25MB.' });
      }

      let finalHtml = body || '';
      let trackingId = null;
      if (req.body.track === 'true' || req.body.track === true) {
        trackingId = Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        const trackingUrl = `${req.protocol}://${req.get('host')}/api/mail/track/${trackingId}.gif`;
        finalHtml += `<img src="${trackingUrl}" width="1" height="1" style="display:none;" alt="" />`;
        
        await db.run(
          'INSERT INTO mail_tracking (id, userId, messageId, subject, "to", opens, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)',
          [trackingId, req.user.id, '', subject, to, new Date().toISOString()]
        );
      }

      const mailOptions: any = {
        from: fromLabel,
        to,
        subject,
        html: finalHtml,
        text: body ? body.replace(/<[^>]*>/g, '') : '',
        attachments: mailAttachments
      };
      if (cc) mailOptions.cc = cc;
      if (bcc) mailOptions.bcc = bcc;

      // Return response immediately for instant UI feedback
      res.json({
        success: true,
        message: `Đang gửi email...`,
      });

      // Run SMTP send and IMAP append in background
      transporter.sendMail(mailOptions).then(async (info: any) => {
        if (trackingId && info.messageId) {
          await db.run('UPDATE mail_tracking SET messageId = ? WHERE id = ?', [info.messageId, trackingId]);
        }

        console.info('[SMTP] Message sent');

        if (info.rejected && info.rejected.length > 0) {
          console.warn(`[SMTP] Partially rejected by server: ${info.rejected.join(', ')}`);
        }

        // Try to append to Sent folder via IMAP
        try {
          const client = await getImapClient(req.user.id, senderEmail);
          const sentFolderCandidates = ['Sent', 'Sent Items', 'Sent Messages', 'INBOX.Sent'];
          let sentFolder = 'Sent';
          for (const name of sentFolderCandidates) {
            try {
              const lock = await client.getMailboxLock(name);
              lock.release();
              sentFolder = name;
              break;
            } catch (_) { /* try next */ }
          }

          const composer = new (MailComposer as any)(mailOptions);
          const rawMessageBuffer = await composer.compile().build();

          const lock = await client.getMailboxLock(sentFolder);
          try {
            await client.append(sentFolder, rawMessageBuffer, ['\\Seen']);
            console.log('[IMAP] Background appended to Sent folder');
          } finally {
            lock.release();
            await client.logout();
          }
        } catch (imapErr: any) {
          console.error('[IMAP] Background append failed:', imapErr.message);
        }
      }).catch(() => {
        console.error('[SMTP] Background send failed.');
      });

    } catch {
      console.error('[SMTP] Send email failed.');
      res.status(502).json({ error: 'Failed to send email' });
    }
  });

  // 7. Schedule Email
  router.post('/schedule', requireAuth, upload.array('attachments', 10), validate(MailScheduleSchema), async (req: any, res: any) => {
    const { to, subject, body, cc, bcc, scheduledAt } = req.body;
    if (!isSafeMailHeaders(to, subject, cc, bcc, body) || !scheduledAt || Number.isNaN(Date.parse(scheduledAt))) return res.status(400).json({ error: 'Invalid recipient, subject, body, or schedule date' });

    try {
      const dbUser = await db.get('SELECT id, mailPassword FROM users WHERE id = ?', [req.user.id]);
      if (!dbUser || !dbUser.mailPassword) return res.status(400).json({ error: 'Chưa cấu hình tài khoản mail.' });

      let senderEmail = '';
      let password = '';
      try {
        const parsed = JSON.parse(decrypt(dbUser.mailPassword) || '{}');
        senderEmail = parsed.email || '';
        password = parsed.password || '';
      } catch (e) {
        return res.status(400).json({ error: 'Vui lòng kết nối lại tài khoản Mail.' });
      }

      const config = await getDynamicConfig();
      // 1. Configure Nodemailer
      const scheduledSmtpPort = Number(config.SMTP_PORT || TRANLE_WEBMAIL.smtpPort);
      await assertMailEndpointsSafe({ smtpHost: config.SMTP_HOST || TRANLE_WEBMAIL.host, smtpPort: scheduledSmtpPort });
      const transporter = nodemailer.createTransport({
        host: config.SMTP_HOST || TRANLE_WEBMAIL.host,
        port: scheduledSmtpPort,
        secure: scheduledSmtpPort === 465 || config.SMTP_SECURE === 'true',
        auth: { user: senderEmail, pass: password },
        tls: tlsOptions
      });

      const mailAttachments = req.files ? (req.files as any[]).map(f => ({
        filename: Buffer.from(f.originalname, 'latin1').toString('utf8').replace(/[\r\n]/g, '').slice(0, 255),
        content: f.buffer.toString('base64'),
        contentType: f.mimetype
      })) : [];

      const id = Math.random().toString(36).substr(2, 9);
      await db.run(
        'INSERT INTO scheduled_emails (id, userId, "to", cc, bcc, subject, body, attachments, scheduledAt, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, req.user.id, to, cc || null, bcc || null, subject, body || '', JSON.stringify(mailAttachments), scheduledAt, 'pending', new Date().toISOString()]
      );

      res.json({ success: true, message: 'Đã lên lịch gửi email.' });
    } catch {
      console.error('[SMTP] Schedule email failed.');
      res.status(502).json({ error: 'Failed to schedule email' });
    }
  });

  // 8. Tracking Pixel Route
  router.get('/track/:trackingId.gif', async (req: any, res: any) => {
    const { trackingId } = req.params;
    try {
      await db.run(
        'UPDATE mail_tracking SET opens = opens + 1, lastOpen = ? WHERE id = ?',
        [new Date().toISOString(), trackingId]
      );
    } catch (err) {
      console.error('Tracking error:', err);
    }
    // 1x1 transparent GIF
    const img = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': img.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(img);
  });

  // 9. Get Tracking Stats
  router.get('/tracking-stats', requireAuth, async (req: any, res: any) => {
    try {
      const stats = await db.all(
        'SELECT id, subject, "to", opens, lastOpen, createdAt FROM mail_tracking WHERE userId = ? ORDER BY createdAt DESC',
        [req.user.id]
      );
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
