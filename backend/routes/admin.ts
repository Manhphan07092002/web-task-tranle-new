import os from 'os';
import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { fileURLToPath } from 'url';
import multer from 'multer';
import crypto from 'crypto';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { invalidateAiKeyCache } from './ai.js';
import { encrypt, decrypt } from '../utils/cryptoUtils.js';
import { assertMailEndpointsSafe, assertPublicMailHost, configuredMailHostAllowlist } from '../utils/mailHostSecurity.js';
import { sanitizeActivityLog, sanitizeActivityValue } from '../utils/activityPrivacy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADMIN_TABLES = new Set([
  'activity_logs', 'clients', 'contract_links', 'contracts', 'departments', 'documents',
  'events', 'mail_quotas', 'mail_tracking', 'meeting_participants', 'meetings', 'notes',
  'notifications', 'password_reset_requests', 'password_reset_tokens', 'products',
  'project_milestones', 'project_reports', 'projects', 'reports', 'revenue_reports', 'roles',
  'scheduled_emails', 'signals', 'system_config', 'uploaded_files', 'task_assignees', 'task_comments',
  'task_subtasks', 'task_tags', 'tasks', 'users'
]);
const sensitiveColumn = /password|secret|token|api.?key|private.?key|credential/i;
const redactDatabaseRow = (table: string, row: Record<string, unknown>) => Object.fromEntries(
  Object.entries(row).map(([key, value]) => {
    if (sensitiveColumn.test(key)) return [key, '[REDACTED]'];
    if (table === 'system_config' && /smtp_pass|poste_api_pass|api_keys|secret/i.test(String(row.key || key))) {
      return [key, '[REDACTED]'];
    }
    return [key, value];
  })
);

const MailPortSchema = z.union([z.number().int(), z.string().regex(/^\d{1,5}$/)]).optional();
const SmtpConfigSchema = z.object({
  IMAP_HOST: z.string().max(253).optional(), IMAP_PORT: MailPortSchema,
  SMTP_HOST: z.string().max(253).optional(), SMTP_PORT: MailPortSchema,
  SMTP_SECURE: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  SMTP_USER: z.string().max(320).optional(), SMTP_PASS: z.string().max(4096).optional(),
  SMTP_FROM: z.string().max(320).optional(),
});
const AiKeyConfigSchema = z.object({
  provider: z.enum(['gemini', 'groq', 'deepseek', 'openrouter', 'openai']).optional(),
  keysMap: z.record(z.string().max(32), z.array(z.union([
    z.string().max(2048), z.object({ fingerprint: z.string().regex(/^[a-f0-9]{12}$/) }).strict(),
  ])).max(25)).optional(),
}).superRefine((body, context) => {
  for (const provider of Object.keys(body.keysMap || {})) {
    if (!['gemini', 'groq', 'deepseek', 'openrouter', 'openai'].includes(provider)) {
      context.addIssue({ code: 'custom', path: ['keysMap', provider], message: 'Unsupported provider' });
    }
  }
});
const PosteConfigSchema = z.object({
  POSTE_API_URL: z.string().url().max(2048).optional(),
  POSTE_API_USER: z.string().max(320).optional(),
  POSTE_API_PASS: z.string().max(4096).optional(),
}).superRefine((body, context) => {
  if (!body.POSTE_API_URL) return;
  try {
    const url = new URL(body.POSTE_API_URL);
    if (url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
      context.addIssue({ code: 'custom', path: ['POSTE_API_URL'], message: 'Must be a credential-free HTTPS URL in production' });
    }
  } catch {
    context.addIssue({ code: 'custom', path: ['POSTE_API_URL'], message: 'Invalid URL' });
  }
});
const ConfirmActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('import') }),
  z.object({
    action: z.literal('delete-row'),
    table: z.string().min(1).max(64).refine((name) => ADMIN_TABLES.has(name)),
    id: z.string().min(1).max(191),
  }),
]);
const ConfirmTokenSchema = z.object({ confirmToken: z.string().max(64).optional() });
const MailboxCreateSchema = z.object({
  name: z.string().trim().max(300).optional(),
  email: z.string().trim().email().max(320),
  passwordPlaintext: z.string().min(12).max(4096),
  quota: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
const MailboxUpdateSchema = z.object({
  name: z.string().trim().max(300).optional(),
  passwordPlaintext: z.string().min(12).max(4096).optional(),
  disabled: z.boolean().optional(),
  quota: z.coerce.number().int().min(0).max(1_000_000).optional(),
}).refine((body) => Object.keys(body).length > 0, 'At least one field is required');
const MailAliasSchema = z.object({
  name: z.string().trim().max(300).optional(),
  email: z.string().trim().email().max(320),
  goto: z.string().trim().min(1).max(2000).refine((value) => value.split(',').every((item) => z.string().email().safeParse(item.trim()).success)),
});
const MailAliasUpdateSchema = z.object({
  goto: MailAliasSchema.shape.goto,
});
const MailDomainSchema = z.object({ name: z.string().trim().min(1).max(253).regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i) });
const SmtpTestSchema = z.object({ testEmail: z.string().email().max(320).optional() });

export function adminRoutes(db: any, mailer: any) {
  const router = Router();
  const allowedAiProviders = new Set(['gemini', 'groq', 'deepseek', 'openrouter', 'openai']);
  const upload = multer({ dest: path.join(__dirname, '../../tmp'), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
  const destructiveTokens = new Map<string, { userId: string; action: string; resource: string; expiresAt: number }>();
  const maskSecret = (value: string) => value.length <= 8 ? '********' : `${value.slice(0, 4)}...${value.slice(-4)}`;
  const keyFingerprint = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
  const parseStoredKeys = (value?: string) => {
    if (!value) return [];
    const plaintext = decrypt(value) || value;
    try {
      const parsed = JSON.parse(plaintext);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const isAllowedTable = (name: string) => ADMIN_TABLES.has(name);
  const auditDatabaseAction = async (userId: string, action: string, entityId: string, metadata: object) => {
    await db.run(
      'INSERT INTO activity_logs (id, userId, action, entityId, entityType, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), userId, action, entityId, 'database', JSON.stringify(sanitizeActivityValue(metadata)), new Date().toISOString()]
    );
  };
  const consumeDestructiveToken = (token: unknown, userId: string, action: string, resource: string) => {
    if (typeof token !== 'string') return false;
    const pending = destructiveTokens.get(token);
    destructiveTokens.delete(token);
    return Boolean(pending && pending.userId === userId && pending.action === action
      && pending.resource === resource && pending.expiresAt >= Date.now());
  };

  router.post('/database/confirm', validate(ConfirmActionSchema), async (req, res) => {
    const { action, table, id } = req.body || {};
    if (action !== 'import' && action !== 'delete-row') return res.status(400).json({ error: 'Invalid confirmation action' });
    if (action === 'delete-row' && (typeof table !== 'string' || !isAllowedTable(table) || typeof id !== 'string' || !id || id.length > 191)) {
      return res.status(400).json({ error: 'Invalid database row target' });
    }
    for (const [token, pending] of destructiveTokens) if (pending.expiresAt < Date.now()) destructiveTokens.delete(token);
    if (destructiveTokens.size >= 1000) return res.status(429).json({ error: 'Too many pending confirmations' });
    const token = crypto.randomBytes(32).toString('hex');
    const resource = action === 'import' ? '*' : `${table}:${id}`;
    destructiveTokens.set(token, { userId: req.user!.id, action, resource, expiresAt: Date.now() + 5 * 60 * 1000 });
    res.json({ token, expiresInSeconds: 300 });
  });

  // --- Password Reset Requests ---
  router.get('/password-reset-requests', async (req, res) => {
    try {
      const includeResolved = String(req.query.includeResolved || '') === '1';
      const requests = includeResolved
        ? await db.all('SELECT * FROM password_reset_requests ORDER BY createdAt DESC')
        : await db.all("SELECT * FROM password_reset_requests WHERE status = 'pending' ORDER BY createdAt DESC");
      res.json(requests);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.delete('/password-reset-requests/:id', async (req, res) => {
    try {
      await db.run('DELETE FROM password_reset_tokens WHERE userId = (SELECT userId FROM password_reset_requests WHERE id = ?)', [req.params.id]);
      await db.run('DELETE FROM password_reset_requests WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  // --- Database Management ---
  router.get('/database/tables', async (_req, res) => {
    try {
      const tables = await db.all(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name ASC`);
      const data = [] as { name: string; count: number | null }[];
      for (const table of tables.filter((table: any) => isAllowedTable(table.name))) {
        try {
          const row = await db.get(`SELECT COUNT(*) as count FROM ${table.name}`);
          data.push({ name: table.name, count: row?.count ?? 0 });
        } catch { data.push({ name: table.name, count: null }); }
      }
      res.json(data);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.get('/database/table/:table', async (req, res) => {
    try {
      const { table } = req.params;
      if (!isAllowedTable(table)) return res.status(400).json({ error: 'Unsupported table' });
      if (!/^[a-zA-Z0-9_]+$/.test(table)) return res.status(400).json({ error: 'Tên bảng không hợp lệ' });

      const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
      const offset = Math.max(Number(req.query.offset || 0), 0);
      const totalRow = await db.get(`SELECT COUNT(*) as count FROM ${table}`);
      const rows = await db.all(`SELECT * FROM ${table} LIMIT ? OFFSET ?`, [limit, offset]);
      res.json({ table, total: totalRow?.count ?? 0, rows: rows.map((row: Record<string, unknown>) => redactDatabaseRow(table, row)) });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.delete('/database/table/:table/row/:id', validate(ConfirmTokenSchema), async (req, res) => {
    try {
      const table = String(req.params.table);
      const rowId = String(req.params.id);
      if (!isAllowedTable(table)) return res.status(400).json({ error: 'Unsupported table' });
      if (!/^[a-zA-Z0-9_]+$/.test(table)) return res.status(400).json({ error: 'Tên bảng không hợp lệ' });

      if (!consumeDestructiveToken(req.body?.confirmToken, req.user!.id, 'delete-row', `${table}:${rowId}`)) {
        return res.status(403).json({ error: 'A valid one-time confirmation token is required' });
      }
      await db.run('START TRANSACTION');
      const result = await db.run(`DELETE FROM \`${table}\` WHERE id = ?`, [rowId]);
      if (!result.changes) {
        await db.run('ROLLBACK');
        return res.status(404).json({ error: 'Row not found' });
      }
      await auditDatabaseAction(req.user!.id, 'database.row_deleted', rowId, { table });
      await db.run('COMMIT');
      res.json({ success: true });
    } catch (e) {
      try { await db.run('ROLLBACK'); } catch {}
      res.status(500).json({ error: 'Failed' });
    }
  });

  // Helper: read/write db_history JSON file
  const HISTORY_FILE = path.join(__dirname, '../db_history.json');
  const readHistory = (): any[] => {
    try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return []; }
  };
  const appendHistory = (entry: object) => {
    const list = readHistory();
    list.unshift(entry);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(list.slice(0, 200), null, 2));
  };

  router.get('/database/export', async (req: any, res) => {
    try {
      // MySQL: xuất dữ liệu dạng JSON (không hỗ trợ file export như SQLite)
      const tables = await db.all(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name ASC`);
      const exportData: Record<string, any[]> = {};
      for (const t of tables.filter((table: any) => isAllowedTable(table.name))) {
        const rows = await db.all(`SELECT * FROM \`${t.name}\``);
        exportData[t.name] = rows.map((row: Record<string, unknown>) => redactDatabaseRow(t.name, row));
      }

      appendHistory({
        id: Math.random().toString(36).slice(2) + Date.now().toString(36),
        action: 'export',
        filename: 'database-export.json',
        performedBy: req.user?.id || 'admin',
        note: 'Xuất toàn bộ database (MySQL JSON)',
        createdAt: new Date().toISOString(),
      });

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="database-export.json"');
      res.json(exportData);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.post('/database/import', upload.single('file'), validate(ConfirmTokenSchema), async (req: any, res) => {
    let transactionStarted = false;
    try {
      if (!consumeDestructiveToken(req.body?.confirmToken, req.user!.id, 'import', '*')) {
        return res.status(403).json({ error: 'A valid one-time confirmation token is required' });
      }
      if (!req.file) return res.status(400).json({ error: 'Thiếu file import' });
      const originalName = req.file ? Buffer.from((req.file as any).originalname, 'latin1').toString('utf8') : 'unknown.json';

      // Read uploaded JSON
      const rawData = fs.readFileSync(req.file.path, 'utf8');
      const importData = JSON.parse(rawData);
      if (!importData || typeof importData !== 'object' || Array.isArray(importData)) {
        return res.status(400).json({ error: 'Import must be a table-to-rows JSON object' });
      }
      const tableNames = Object.keys(importData);
      if (!tableNames.length || tableNames.some(tableName => !isAllowedTable(tableName))) {
        return res.status(400).json({ error: 'Import contains unsupported tables' });
      }
      let totalRows = 0;
      for (const [tableName, rows] of Object.entries(importData)) {
        if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
          return res.status(400).json({ error: `Invalid rows for table ${tableName}` });
        }
        totalRows += rows.length;
        if (totalRows > 50000) return res.status(413).json({ error: 'Import exceeds the 50000-row limit' });
      }

      appendHistory({
        id: Math.random().toString(36).slice(2) + Date.now().toString(36),
        action: 'import',
        filename: originalName,
        performedBy: req.user?.id || 'admin',
        note: 'Nhập database từ file ' + originalName,
        createdAt: new Date().toISOString(),
      });

      // Import data table by table
      await db.run('START TRANSACTION');
      transactionStarted = true;
      for (const [tableName, rows] of Object.entries(importData)) {
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const columns = await db.all(`SHOW COLUMNS FROM \`${tableName}\``);
        const allowedColumns = new Set(columns.map((column: any) => column.Field));
        // Clear existing data
        await db.run(`DELETE FROM \`${tableName}\``);
        // Insert rows
        for (const row of rows) {
          const cols = Object.keys(row as object).filter(column => allowedColumns.has(column));
          if (!cols.length) continue;
          const placeholders = cols.map(() => '?').join(', ');
          const values = cols.map(c => (row as Record<string, unknown>)[c]);
          await db.run(`INSERT INTO \`${tableName}\` (${cols.map(c => '\`' + c + '\`').join(', ')}) VALUES (${placeholders})`, values);
        }
      }

      await auditDatabaseAction(req.user!.id, 'database.import', crypto.randomUUID(), {
        filename: originalName,
        tables: Object.entries(importData).map(([tableName, rows]) => ({ table: tableName, rowCount: (rows as any[]).length })),
      });
      await db.run('COMMIT');
      transactionStarted = false;
      await fs.promises.unlink(req.file.path).catch(() => { });
      res.json({ success: true, message: 'Import thành công.' });
    } catch (e: any) {
      if (transactionStarted) {
        try { await db.run('ROLLBACK'); } catch {}
      }
      console.error('[Admin DB] Import failed:', e?.message);
      res.status(500).json({ error: 'Import failed; no changes were committed.' });
    } finally {
      if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
    }
  });

  // --- DB History (stored in JSON file, survives database replacement) ---
  router.get('/database/history', async (_req, res) => {
    try {
      res.json(readHistory());
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  // --- SMTP Config ---
  router.get('/system-config/smtp', async (_req, res) => {
    try {
      const smtp = await mailer.getSystemConfig();
      res.json({ 
        IMAP_HOST: smtp.IMAP_HOST, IMAP_PORT: smtp.IMAP_PORT,
        SMTP_HOST: smtp.SMTP_HOST, SMTP_PORT: smtp.SMTP_PORT, 
        SMTP_SECURE: smtp.SMTP_SECURE, SMTP_USER: smtp.SMTP_USER, 
        SMTP_PASS: smtp.SMTP_PASS ? '********' : '', SMTP_FROM: smtp.SMTP_FROM 
      });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.post('/system-config/smtp', validate(SmtpConfigSchema), async (req, res) => {
    try {
      const { IMAP_HOST, IMAP_PORT, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM } = req.body;
      const validText = (value: unknown, max: number) => value === undefined || (typeof value === 'string' && value.length <= max && !/[\r\n]/.test(value));
      if (!validText(IMAP_HOST, 253) || !validText(SMTP_HOST, 253) || !validText(SMTP_USER, 320)
        || !validText(SMTP_FROM, 320) || !validText(IMAP_PORT, 8) || !validText(SMTP_PORT, 8)
        || (SMTP_SECURE !== undefined && !['true', 'false', true, false].includes(SMTP_SECURE))) {
        return res.status(400).json({ error: 'Invalid mail server configuration' });
      }
      try {
        await assertMailEndpointsSafe({
          imapHost: IMAP_HOST || '', imapPort: IMAP_PORT || 993,
          smtpHost: SMTP_HOST || '', smtpPort: SMTP_PORT || 587,
        });
      } catch {
        return res.status(400).json({ error: 'Mail hosts must be valid, public, and use a supported mail port' });
      }
      const entries: [string, string][] = [
        ['IMAP_HOST', IMAP_HOST || ''], ['IMAP_PORT', String(IMAP_PORT || '993')],
        ['SMTP_HOST', SMTP_HOST || ''], ['SMTP_PORT', String(SMTP_PORT || '587')],
        ['SMTP_SECURE', String(SMTP_SECURE || 'false')], ['SMTP_USER', SMTP_USER || ''], ['SMTP_FROM', SMTP_FROM || ''],
      ];
      if (SMTP_PASS && SMTP_PASS !== '********') {
        if (typeof SMTP_PASS !== 'string' || SMTP_PASS.length > 4096 || /[\r\n]/.test(SMTP_PASS)) {
          return res.status(400).json({ error: 'Invalid SMTP password value' });
        }
        entries.push(['SMTP_PASS', encrypt(SMTP_PASS)!]);
      }
      for (const [key, value] of entries) {
        await db.run('INSERT INTO system_config (`key`, `value`) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.post('/system-config/smtp/test', validate(SmtpTestSchema), async (req, res) => {
    try {
      const { testEmail } = req.body;
      if (testEmail !== undefined && (typeof testEmail !== 'string' || testEmail.length > 320 || /[\r\n\s]/.test(testEmail) || !/^[^@]+@[^@]+\.[^@]+$/.test(testEmail))) {
        return res.status(400).json({ error: 'Invalid test email address' });
      }
      const { transporter, smtp } = await mailer.createTransporter();
      if (!transporter) return res.status(400).json({ error: 'SMTP chưa được cấu hình đầy đủ' });
      await transporter.sendMail({ from: smtp.SMTP_FROM, to: testEmail || smtp.SMTP_USER, subject: 'Tran Le Tasks - Test cấu hình SMTP', text: 'Chúc mừng, cấu hình SMTP của bạn đã hoạt động.', html: '<div style="font-family:Arial,sans-serif"><h3>Tran Le Electricity</h3><p>Chúc mừng, cấu hình SMTP của bạn đã hoạt động.</p></div>' });
      res.json({ success: true });
    } catch { console.warn('[MAIL] SMTP test failed'); res.status(502).json({ error: 'SMTP test failed' }); }
  });

  // --- AI Config ---
  router.get('/system-config/ai-keys', async (_req, res) => {
    try {
      const providers = ['gemini', 'groq', 'deepseek', 'openrouter', 'openai'];
      const keysMap: Record<string, { fingerprint: string; masked: string }[]> = {};
      
      for (const p of providers) {
        const config = await db.get(`SELECT \`value\` FROM system_config WHERE \`key\` = ?`, [`${p}_api_keys`]);
        const keys = parseStoredKeys(config?.value);
        keysMap[p] = keys.map((key: string) => ({
          fingerprint: keyFingerprint(key),
          masked: maskSecret(key),
        }));
      }

      const providerConfig = await db.get(`SELECT \`value\` FROM system_config WHERE \`key\` = 'ai_provider'`);
      const provider = providerConfig && providerConfig.value ? providerConfig.value : 'gemini';
      
      res.json({ keysMap, provider });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.post('/system-config/ai-keys', validate(AiKeyConfigSchema), async (req, res) => {
    try {
      const { keysMap, provider } = req.body;
      if (provider !== undefined && (typeof provider !== 'string' || !allowedAiProviders.has(provider))) {
        return res.status(400).json({ error: 'Invalid AI provider' });
      }

      if (keysMap !== undefined && (!keysMap || typeof keysMap !== 'object' || Array.isArray(keysMap))) {
        return res.status(400).json({ error: 'Invalid AI keys configuration' });
      }

      if (keysMap) {
         for (const [p, keys] of Object.entries(keysMap)) {
           if (!allowedAiProviders.has(p) || !Array.isArray(keys) || keys.length > 25) {
             return res.status(400).json({ error: 'Invalid AI keys configuration' });
           }
           const existing = await db.get('SELECT `value` FROM system_config WHERE `key` = ?', [`${p}_api_keys`]);
           const existingKeys: string[] = parseStoredKeys(existing?.value);
           const resolvedKeys: string[] = [];
           for (const key of keys as any[]) {
             if (typeof key === 'string') {
               if (key.trim() && (key.length < 8 || key.length > 2048)) return res.status(400).json({ error: 'Invalid AI key value' });
               if (key.trim()) resolvedKeys.push(key.trim());
             } else if (key && typeof key === 'object' && typeof key.fingerprint === 'string' && /^[a-f0-9]{12}$/.test(key.fingerprint)) {
               const existingKey = existingKeys.find((candidate) => keyFingerprint(candidate) === key.fingerprint);
               if (!existingKey) return res.status(400).json({ error: 'Unknown AI key fingerprint' });
               resolvedKeys.push(existingKey);
             } else {
               return res.status(400).json({ error: 'Invalid AI key value' });
             }
           }
           await db.run('INSERT INTO system_config (`key`, `value`) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [`${p}_api_keys`, encrypt(JSON.stringify(resolvedKeys))]);
         }
      }
      
      if (provider) {
        await db.run('INSERT INTO system_config (`key`, `value`) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', ['ai_provider', provider]);
      }
      invalidateAiKeyCache(); // Force reload next AI request
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  // --- Poste.io Mail Server Config & Proxy ---
  router.get('/system-config/poste-api', async (_req, res) => {
    try {
      const urlConfig = await db.get(`SELECT \`value\` FROM system_config WHERE \`key\` = 'POSTE_API_URL'`);
      const userConfig = await db.get(`SELECT \`value\` FROM system_config WHERE \`key\` = 'POSTE_API_USER'`);
      const passConfig = await db.get(`SELECT \`value\` FROM system_config WHERE \`key\` = 'POSTE_API_PASS'`);
      res.json({
        POSTE_API_URL: urlConfig?.value || '',
        POSTE_API_USER: userConfig?.value || '',
        POSTE_API_PASS: passConfig?.value ? '********' : ''
      });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.post('/system-config/poste-api', validate(PosteConfigSchema), async (req, res) => {
    try {
      const { POSTE_API_URL, POSTE_API_USER, POSTE_API_PASS } = req.body;
      const entries: [string, string][] = [
        ['POSTE_API_URL', POSTE_API_URL || ''],
        ['POSTE_API_USER', POSTE_API_USER || '']
      ];
      if (POSTE_API_PASS && POSTE_API_PASS !== '********') entries.push(['POSTE_API_PASS', POSTE_API_PASS]);
      for (const [key, value] of entries) {
        await db.run('INSERT INTO system_config (`key`, `value`) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  const getPosteAuth = async () => {
    const urlConfig = await db.get(`SELECT \`value\` FROM system_config WHERE \`key\` = 'POSTE_API_URL'`);
    const userConfig = await db.get(`SELECT \`value\` FROM system_config WHERE \`key\` = 'POSTE_API_USER'`);
    const passConfig = await db.get(`SELECT \`value\` FROM system_config WHERE \`key\` = 'POSTE_API_PASS'`);
    if (!urlConfig?.value || !userConfig?.value || !passConfig?.value) return null;
    const posteUrl = new URL(String(urlConfig.value));
    if (posteUrl.username || posteUrl.password || (process.env.NODE_ENV === 'production' && posteUrl.protocol !== 'https:')) {
      throw new Error('Poste.io endpoint must be a credential-free HTTPS URL in production');
    }
    if (process.env.NODE_ENV === 'production' || process.env.MAIL_ENFORCE_PUBLIC_HOSTS === 'true') {
      await assertPublicMailHost(posteUrl.hostname, configuredMailHostAllowlist());
    }
    return {
      url: posteUrl.toString().replace(/\/$/, ''),
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${userConfig.value}:${passConfig.value}`).toString('base64'),
        'Content-Type': 'application/json'
      }
    };
  };

  router.get('/mail-server/boxes', async (_req, res) => {
    try {
      const auth = await getPosteAuth();
      if (!auth) return res.status(400).json({ error: 'Poste.io API chưa được cấu hình' });
      // Poste API uses /boxes path
      const [response, quotas] = await Promise.all([
        fetch(`${auth.url}/boxes`, { headers: auth.headers }),
        db.all('SELECT email, quota FROM mail_quotas')
      ]);
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      const quotaMap = new Map((quotas || []).map((q: any) => [q.email, q.quota]));
      const results = (data.results || data).map((box: any) => {
        let boxEmail = box.email || box.emailAddress || box.address || box.name || box.login || box.id || '';
        if (typeof boxEmail === 'string' && boxEmail.includes('<') && boxEmail.includes('>')) {
            const match = boxEmail.match(/<([^>]+)>/);
            if (match) boxEmail = match[1];
        }
        return {
          ...box,
          email: boxEmail,
          quota: quotaMap.get(boxEmail) || 0
        };
      });
      res.json(results);
    } catch (e: any) { 
        console.error('Lỗi GET /domains:', e);
        res.status(500).json({ error: e.message || 'Lỗi kết nối Poste.io' }); 
    }
  });

  router.post('/mail-server/boxes', validate(MailboxCreateSchema), async (req, res) => {
    try {
      const auth = await getPosteAuth();
      if (!auth) return res.status(400).json({ error: 'Poste.io API chưa được cấu hình' });
      const { name, email, passwordPlaintext, quota } = req.body;
      const formattedName = name ? `${name} <${email}>` : email;
      const bodyParams: any = { name: formattedName, passwordPlaintext };
      
      const response = await fetch(`${auth.url}/boxes`, {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify(bodyParams)
      });
      if (!response.ok) throw new Error(await response.text());
      if (quota !== undefined) {
         try { await db.run('INSERT INTO mail_quotas (email, quota) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET quota=excluded.quota', [email, Number(quota) || 0]); } catch (e) { console.error('POST quota error:', e); }
      }
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message || 'Lỗi tạo hộp thư' }); }
  });

  router.patch('/mail-server/boxes/:email', validate(MailboxUpdateSchema), async (req, res) => {
    try {
      const auth = await getPosteAuth();
      if (!auth) return res.status(400).json({ error: 'Poste.io API chưa được cấu hình' });
      const mailboxEmail = String(req.params.email);
      const { passwordPlaintext, disabled, name, quota } = req.body;
      const updates: any = {};
      if (name) updates.name = `${name} <${mailboxEmail}>`;
      if (passwordPlaintext) updates.passwordPlaintext = passwordPlaintext;
      if (disabled !== undefined) updates.disabled = disabled;

      if (Object.keys(updates).length > 0) {
        const response = await fetch(`${auth.url}/boxes/${encodeURIComponent(mailboxEmail)}`, {
          method: 'PATCH',
          headers: auth.headers,
          body: JSON.stringify(updates)
        });
        if (!response.ok) throw new Error(await response.text());
      }
      if (quota !== undefined) {
         try { await db.run('INSERT INTO mail_quotas (email, quota) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET quota=excluded.quota', [mailboxEmail, Number(quota) || 0]); } catch (e) { console.error('PATCH quota error:', e); }
      }
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message || 'Lỗi cập nhật hộp thư' }); }
  });

  router.delete('/mail-server/boxes/:email', async (req, res) => {
    try {
      const auth = await getPosteAuth();
      if (!auth) return res.status(400).json({ error: 'Poste.io API chưa được cấu hình' });
      const response = await fetch(`${auth.url}/boxes/${encodeURIComponent(req.params.email)}`, {
        method: 'DELETE',
        headers: auth.headers
      });
      if (!response.ok) throw new Error(await response.text());
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message || 'Lỗi xóa hộp thư' }); }
  });

  // --- Poste.io Aliases ---
  router.get('/mail-server/aliases', async (req, res) => {
    try {
      const auth = await getPosteAuth();
      if (!auth) return res.status(400).json({ error: 'Poste.io API chưa được cấu hình' });
      const response = await fetch(`${auth.url}/boxes`, { headers: auth.headers });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      const allBoxes = data.results || data;
      const aliases = allBoxes.filter((b: any) => b.redirect_only).map((b: any) => ({
         name: b.name,
         email: b.address || b.email || b.login,
         goto: (b.redirect_to || []).join(',')
      }));
      res.json(aliases);
    } catch (e: any) { 
        console.error('Lỗi GET /aliases:', e);
        res.status(500).json({ error: e.message || 'Lỗi kết nối Poste.io' }); 
    }
  });

  router.post('/mail-server/aliases', validate(MailAliasSchema), async (req, res) => {
    try {
      const auth = await getPosteAuth();
      if (!auth) return res.status(400).json({ error: 'Poste.io API chưa được cấu hình' });
      const { name, email, goto } = req.body;
      const redirectTo = goto.split(',').map((s: string) => s.trim()).filter(Boolean);
      const payload = {
        name: name || email.split('@')[0],
        email: email,
        passwordPlaintext: '',
        redirectTo: redirectTo
      };
      const response = await fetch(`${auth.url}/boxes`, {
        method: 'POST',
        headers: { ...auth.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await response.text());
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message || 'Lỗi tạo alias' }); }
  });

  router.patch('/mail-server/aliases/:email', validate(MailAliasUpdateSchema), async (req, res) => {
    try {
      const auth = await getPosteAuth();
      if (!auth) return res.status(400).json({ error: 'Poste.io API chưa được cấu hình' });
      const emailToEdit = String(req.params.email);
      const { goto } = req.body;
      const redirectTo = goto.split(',').map((s: string) => s.trim()).filter(Boolean);
      
      // Poste.io API không cho phép PATCH trường redirectTo, 
      // Do đó ta xóa Alias cũ và tạo lại Alias mới (Bởi vì redirect_only không lưu trữ data nên an toàn)
      await fetch(`${auth.url}/boxes/${encodeURIComponent(emailToEdit)}`, {
        method: 'DELETE',
        headers: auth.headers
      });

      const payload = {
        name: emailToEdit.split('@')[0],
        email: emailToEdit,
        passwordPlaintext: '',
        redirectTo: redirectTo
      };
      const response = await fetch(`${auth.url}/boxes`, {
        method: 'POST',
        headers: { ...auth.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await response.text());
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message || 'Lỗi cập nhật alias' }); }
  });

  router.delete('/mail-server/aliases/:email', async (req, res) => {
    try {
      const auth = await getPosteAuth();
      if (!auth) return res.status(400).json({ error: 'Poste.io API chưa được cấu hình' });
      const response = await fetch(`${auth.url}/boxes/${encodeURIComponent(req.params.email)}`, { method: 'DELETE', headers: auth.headers });
      if (!response.ok) throw new Error(await response.text());
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message || 'Lỗi xóa alias' }); }
  });

  // --- Poste.io Domains ---
  router.get('/mail-server/domains', async (_req, res) => {
    try {
      const auth = await getPosteAuth();
      if (!auth) return res.status(400).json({ error: 'Poste.io API chưa được cấu hình' });
      const response = await fetch(`${auth.url}/domains`, { headers: auth.headers });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      res.json(data.results || data);
    } catch (e: any) { res.status(500).json({ error: e.message || 'Lỗi lấy danh sách Domain' }); }
  });

  router.post('/mail-server/domains', validate(MailDomainSchema), async (req, res) => {
    try {
      const auth = await getPosteAuth();
      if (!auth) return res.status(400).json({ error: 'Poste.io API chưa được cấu hình' });
      const { name } = req.body;
      const response = await fetch(`${auth.url}/domains`, {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({ name })
      });
      if (!response.ok) throw new Error(await response.text());
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message || 'Lỗi tạo Domain' }); }
  });

  router.delete('/mail-server/domains/:name', async (req, res) => {
    try {
      const auth = await getPosteAuth();
      if (!auth) return res.status(400).json({ error: 'Poste.io API chưa được cấu hình' });
      const response = await fetch(`${auth.url}/domains/${encodeURIComponent(req.params.name)}`, { method: 'DELETE', headers: auth.headers });
      if (!response.ok) throw new Error(await response.text());
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message || 'Lỗi xóa Domain' }); }
  });

  // --- Stats ---
  router.get('/stats', async (_req, res) => {
    try {
      const userCountDesc = await db.get('SELECT COUNT(*) as count FROM users');
      const taskCountDesc = await db.get('SELECT COUNT(*) as count FROM tasks');
      const reportCountDesc = await db.get('SELECT COUNT(*) as count FROM reports');
      const meetingCountDesc = await db.get("SELECT COUNT(*) as count FROM meetings WHERE status != 'ended'");
      const roleBreakdown = await db.all('SELECT role, COUNT(*) as count FROM users GROUP BY role');
      const taskStatusBreakdown = await db.all('SELECT status, COUNT(*) as count FROM tasks GROUP BY status');
      const taskDeptBreakdown = await db.all('SELECT department, COUNT(*) as count FROM tasks GROUP BY department');
      const reportStatusBreakdown = await db.all('SELECT status, COUNT(*) as count FROM reports GROUP BY status');
      
      const logsCountResult = await db.get('SELECT COUNT(*) as count FROM activity_logs');
      const emailsCountResult = await db.get('SELECT COUNT(*) as count FROM scheduled_emails');
      const sentEmailsCountResult = await db.get('SELECT COUNT(*) as count FROM mail_tracking');
      const resetRequestsCountResult = await db.get("SELECT COUNT(*) as count FROM password_reset_requests WHERE status='pending'");
      let dbSize = 0;
      try {
        const sizeResult = await db.get(`SELECT SUM(data_length + index_length) AS size FROM information_schema.tables WHERE table_schema = DATABASE()`);
        dbSize = sizeResult?.size || 0;
      } catch (e) {}

      const systemInfo = {
        nodeVersion: process.version,
        platform: os.platform(),
        memoryUsage: process.memoryUsage().rss,
        uptime: process.uptime(),
        dbSize
      };

      res.json({ 
        totalUsers: userCountDesc.count, totalTasks: taskCountDesc.count, 
        totalReports: reportCountDesc.count, activeMeetings: meetingCountDesc.count, 
        totalLogs: logsCountResult ? logsCountResult.count : 0,
        scheduledEmails: emailsCountResult ? emailsCountResult.count : 0,
        sentEmails: sentEmailsCountResult ? sentEmailsCountResult.count : 0,
        pendingResets: resetRequestsCountResult ? resetRequestsCountResult.count : 0,
        roleBreakdown, taskStatusBreakdown, taskDeptBreakdown, reportStatusBreakdown,
        systemInfo
      });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch admin stats' }); }
  });

  // --- Detailed Logs & Emails ---
  router.get('/activity-logs', async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);
      const logs = await db.all('SELECT * FROM activity_logs ORDER BY createdAt DESC LIMIT ?', [limit]);
      res.json(logs.map(sanitizeActivityLog));
    } catch (e) { res.status(500).json({ error: 'Failed to fetch logs' }); }
  });

  router.get('/scheduled-emails', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const emails = await db.all('SELECT * FROM scheduled_emails ORDER BY scheduledAt ASC LIMIT ?', [limit]);
      res.json(emails);
    } catch (e) { res.status(500).json({ error: 'Failed to fetch emails' }); }
  });

  return router;
}
