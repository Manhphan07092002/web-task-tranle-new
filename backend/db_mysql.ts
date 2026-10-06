import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { decrypt, encrypt, isLegacyCbcCiphertext, isVersionedCiphertext } from './utils/cryptoUtils.js';
import { runVersionedMigration, withMigrationLock } from './utils/dbMigrations.js';
import { DatabaseTransactionGate } from './utils/dbTransactionGate.js';

// ─── SQL normalizer ──────────────────────────────────────────────────────────
// Converts the SQLite-flavoured SQL used throughout the routes to MySQL,
// so route files need no changes. mysql2 already uses `?` placeholders and
// backtick identifiers natively, so the work here is limited to the handful of
// SQLite-specific constructs the codebase actually emits.

function normalizeSql(sql: string): string {
  let s = sql;

  // SQLite `BEGIN TRANSACTION` → MySQL `START TRANSACTION`
  s = s.replace(/\bBEGIN\s+TRANSACTION\b/gi, 'START TRANSACTION');

  // SQLite `INSERT OR IGNORE INTO` → MySQL `INSERT IGNORE INTO`
  s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT IGNORE INTO');

  // SQLite/PG upsert `ON CONFLICT(col) DO UPDATE SET x=excluded.x`
  //   → MySQL `ON DUPLICATE KEY UPDATE x=VALUES(x)`
  // Used by system_config / mail_quotas upserts in routes/admin.ts.
  s = s.replace(
    /ON\s+CONFLICT\s*\([^)]*\)\s+DO\s+UPDATE\s+SET\s+(.+?)$/gi,
    (_m, assignments: string) => {
      const converted = assignments.replace(/\bexcluded\.(\w+)/gi, 'VALUES($1)');
      return `ON DUPLICATE KEY UPDATE ${converted}`;
    },
  );

  // Double-quoted reserved-word identifiers ("to", "from") → backticks.
  // These appear in db.ts DDL and routes/mail.ts. MySQL (default mode) treats
  // double quotes as string literals, so they must become backticks.
  s = s.replace(/"(to|from|key|value)"/gi, '`$1`');

  // SQLite catalog access → MySQL information_schema.
  // routes/admin.ts lists tables for the Admin panel.
  s = s.replace(
    /SELECT\s+name\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s+NOT\s+LIKE\s+'sqlite_%'\s+ORDER\s+BY\s+name\s+ASC/gi,
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name ASC",
  );

  // Reserved-word `key` in system_config queries.
  s = s.replace(/\bFROM\s+system_config\s+WHERE\s+key\b/gi, 'FROM system_config WHERE `key`');
  s = s.replace(/\bSELECT\s+key\s*,\s*value\s+FROM\s+system_config\b/gi, 'SELECT `key`, `value` FROM system_config');
  s = s.replace(/\bINSERT\s+INTO\s+system_config\s*\(\s*key\s*,\s*value\s*\)/gi, 'INSERT INTO system_config (`key`, `value`)');

  return s;
}

// ─── Row wrapper ─────────────────────────────────────────────────────────────
// mysql2 can return BIGINT/DECIMAL (e.g. from COUNT(*)) as BigInt or string
// depending on server/driver config. Coerce those to Number so routes that read
// `row.count` keep working. Property access is case-insensitive as a safety net
// for any identifier case differences, matching the PostgreSQL adapter.

function wrapRow(row: Record<string, any>): any {
  const normalized: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    normalized[k] = typeof v === 'bigint' ? Number(v) : v;
  }

  return new Proxy(normalized, {
    get(target, prop: string | symbol) {
      if (typeof prop !== 'string') return (target as any)[prop];
      if (prop in target) return (target as any)[prop];
      const lower = prop.toLowerCase();
      for (const k of Object.keys(target)) {
        if (k.toLowerCase() === lower) return (target as any)[k];
      }
      return undefined;
    },
    has(target, prop) {
      if (prop in target) return true;
      if (typeof prop === 'string') {
        const lower = prop.toLowerCase();
        for (const k of Object.keys(target)) {
          if (k.toLowerCase() === lower) return true;
        }
      }
      return false;
    },
  });
}

// ─── MysqlDb class ───────────────────────────────────────────────────────────
// Drop-in replacement for the sqlite `db` object used throughout the codebase.
// IMPORTANT: uses a single long-lived connection (not a pool). Routes run
// transactions as separate db.run('BEGIN TRANSACTION') / db.run(...) / COMMIT
// calls; a pool would hand each call a different connection and break atomicity.
// A single connection preserves the SQLite single-writer semantics the routes
// were written against.

class MysqlDb {
  private readonly transactionGate = new DatabaseTransactionGate();

  constructor(private conn: mysql.Connection, private connectionConfig: mysql.ConnectionOptions) {}

  private async query(sql: string, params?: any[]): Promise<any> {
    const normalizedSql = normalizeSql(sql);
    return this.transactionGate.run(normalizedSql, async () => {
      try {
        const [rows] = await this.conn.query(normalizedSql, params ?? []);
        return rows;
      } catch (err: any) {
        // Reconnect once on a dropped connection, then retry.
        if (err && (err.code === 'PROTOCOL_CONNECTION_LOST' || err.fatal)) {
          console.warn('[MySQL] Connection lost, reconnecting...');
          this.conn = await mysql.createConnection(this.connectionConfig);
          const [rows] = await this.conn.query(normalizedSql, params ?? []);
          return rows;
        }
        throw err;
      }
    });
  }

  runWithRequestContext<T>(callback: () => T): T {
    return this.transactionGate.runWithRequestContext(callback);
  }

  async get(sql: string, params?: any[]): Promise<any> {
    const rows = await this.query(sql, params);
    if (Array.isArray(rows) && rows.length > 0) return wrapRow(rows[0]);
    return undefined;
  }

  async all(sql: string, params?: any[]): Promise<any[]> {
    const rows = await this.query(sql, params);
    return Array.isArray(rows) ? rows.map(wrapRow) : [];
  }

  /** Returns { changes } so routes relying on affected-row counts keep working. */
  async run(sql: string, params?: any[]): Promise<{ changes: number }> {
    const result = await this.query(sql, params);
    const affected = result && typeof result.affectedRows === 'number' ? result.affectedRows : 0;
    return { changes: affected };
  }

  /** Executes multi-statement DDL (e.g. CREATE TABLE blocks). */
  async exec(sql: string): Promise<void> {
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    for (const stmt of statements) {
      await this.query(stmt);
    }
  }

  async close(): Promise<void> {
    await this.conn.end();
  }
}

// ─── Schema (MySQL) ──────────────────────────────────────────────────────────
// Derived from the FINAL SQLite schema in db.ts (base DDL + all 30 migrations
// flattened). Type mapping:
//   TEXT PRIMARY KEY / TEXT UNIQUE → VARCHAR (MySQL cannot index bare TEXT)
//   REAL → DOUBLE
//   INTEGER-as-boolean → TINYINT
//   date columns stay VARCHAR (ISO strings, compared as strings by routes)
//   JSON columns stay TEXT (app does JSON.parse/stringify)
// Reserved-word identifiers use backticks. All tables utf8mb4 for Vietnamese.

const DDL = `
CREATE TABLE IF NOT EXISTS meetings (
  id VARCHAR(191) PRIMARY KEY, title TEXT NOT NULL, description TEXT,
  hostId VARCHAR(191) NOT NULL, startTime TEXT NOT NULL, endTime TEXT NOT NULL,
  meetingLink TEXT NOT NULL, status VARCHAR(64) NOT NULL, participants TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meeting_participants (
  meetingId VARCHAR(191) NOT NULL, userId VARCHAR(191) NOT NULL,
  PRIMARY KEY (meetingId, userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS signals (
  id VARCHAR(191) PRIMARY KEY, meetingId VARCHAR(191) NOT NULL,
  \`from\` VARCHAR(191) NOT NULL, \`to\` VARCHAR(191) NOT NULL,
  type VARCHAR(64) NOT NULL, data TEXT NOT NULL, timestamp BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(191) PRIMARY KEY, name TEXT NOT NULL, email VARCHAR(255) NOT NULL,
  password TEXT, role VARCHAR(64) NOT NULL, department VARCHAR(191) NOT NULL, avatar TEXT NOT NULL,
  mailPassword TEXT,
  failedLogins INT NOT NULL DEFAULT 0, lockedUntil TEXT, isLocked TINYINT NOT NULL DEFAULT 0,
  tokenVersion INT NOT NULL DEFAULT 0,
  phone TEXT, dob TEXT, hometown TEXT, bio TEXT, cccd TEXT, gender TEXT,
  preferences TEXT DEFAULT ('{}')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(191) PRIMARY KEY, title TEXT NOT NULL, description TEXT,
  startDate TEXT, dueDate TEXT, estimatedEndAt TEXT, priority VARCHAR(64), status VARCHAR(64),
  createdBy VARCHAR(191), department VARCHAR(191), recurrence VARCHAR(64), contractId VARCHAR(191), projectId VARCHAR(191)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_assignees (
  taskId VARCHAR(191) NOT NULL, userId VARCHAR(191) NOT NULL,
  PRIMARY KEY (taskId, userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_tags (
  taskId VARCHAR(191) NOT NULL, tag VARCHAR(191) NOT NULL,
  PRIMARY KEY (taskId, tag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_subtasks (
  id VARCHAR(191) PRIMARY KEY, taskId VARCHAR(191) NOT NULL, title TEXT NOT NULL,
  isCompleted TINYINT NOT NULL DEFAULT 0, sortOrder INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_comments (
  id VARCHAR(191) PRIMARY KEY, taskId VARCHAR(191) NOT NULL, userId VARCHAR(191) NOT NULL,
  content TEXT NOT NULL, createdAt TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notes (
  id VARCHAR(191) PRIMARY KEY, title TEXT NOT NULL, content TEXT,
  color VARCHAR(64), createdAt TEXT, reminderAt TEXT,
  userId VARCHAR(191)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reports (
  id VARCHAR(191) PRIMARY KEY, title TEXT NOT NULL, content TEXT,
  authorId VARCHAR(191) NOT NULL, department VARCHAR(191) NOT NULL, status VARCHAR(64) NOT NULL,
  createdAt TEXT NOT NULL, submittedAt TEXT, approvedAt TEXT, approvedBy VARCHAR(191),
  directorFeedback TEXT, managerFeedback TEXT, deletedAt TEXT, isDeleted TINYINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(191) PRIMARY KEY, name VARCHAR(191) NOT NULL UNIQUE, description TEXT,
  color VARCHAR(64) NOT NULL DEFAULT '#6366f1', permissions TEXT NOT NULL,
  isSystem TINYINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS departments (
  id VARCHAR(191) PRIMARY KEY, name VARCHAR(191) NOT NULL UNIQUE, description TEXT,
  color VARCHAR(64) NOT NULL DEFAULT '#6366f1', managerId VARCHAR(191)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id VARCHAR(191) PRIMARY KEY, userId VARCHAR(191) NOT NULL, email VARCHAR(255) NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'pending', emailStatus VARCHAR(64) NOT NULL DEFAULT 'unknown',
  emailSentAt TEXT, createdAt TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id VARCHAR(191) PRIMARY KEY, userId VARCHAR(191) NOT NULL, email VARCHAR(255) NOT NULL,
  token VARCHAR(191) NOT NULL UNIQUE, tokenHash VARCHAR(191) UNIQUE, expiresAt TEXT NOT NULL, usedAt TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_config (
  \`key\` VARCHAR(191) PRIMARY KEY, \`value\` TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(191) PRIMARY KEY, userId VARCHAR(191) NOT NULL, type VARCHAR(64) NOT NULL,
  title TEXT NOT NULL, message TEXT NOT NULL, relatedId VARCHAR(191),
  dedupeKey VARCHAR(64) UNIQUE, isRead TINYINT NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(191) PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, endDate TEXT,
  type VARCHAR(64) NOT NULL DEFAULT 'holiday', color VARCHAR(64) NOT NULL DEFAULT '#ef4444',
  description TEXT, isRecurringYearly TINYINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_logs (
  id VARCHAR(191) PRIMARY KEY, userId VARCHAR(191) NOT NULL, action VARCHAR(191) NOT NULL,
  entityId VARCHAR(191), entityType VARCHAR(64), metadata TEXT, createdAt TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS db_history (
  id VARCHAR(191) PRIMARY KEY, action VARCHAR(191) NOT NULL, filename TEXT,
  performedBy VARCHAR(191), note TEXT, createdAt TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduled_emails (
  id VARCHAR(191) PRIMARY KEY, userId VARCHAR(191) NOT NULL, \`to\` TEXT NOT NULL, cc TEXT, bcc TEXT,
  subject TEXT NOT NULL, body TEXT NOT NULL, attachments TEXT,
  scheduledAt TEXT NOT NULL, status VARCHAR(64) NOT NULL DEFAULT 'pending', createdAt TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mail_tracking (
  id VARCHAR(191) PRIMARY KEY, userId VARCHAR(191) NOT NULL, messageId VARCHAR(191) NOT NULL,
  subject TEXT NOT NULL, \`to\` TEXT NOT NULL, opens INT NOT NULL DEFAULT 0,
  lastOpen TEXT, createdAt TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contracts (
  id VARCHAR(191) PRIMARY KEY, contractNumber TEXT NOT NULL, clientName TEXT NOT NULL,
  contractName TEXT NOT NULL, preTaxValue DOUBLE DEFAULT 0, invoiceDate TEXT, invoiceNumber TEXT,
  department VARCHAR(191) NOT NULL, createdBy VARCHAR(191) NOT NULL,
  docSentDate TEXT, docReceivedDate TEXT, docAccountantDate TEXT, docReceiver TEXT,
  docAccountantUserId VARCHAR(191), docAccountantStatus VARCHAR(64) DEFAULT 'pending',
  approvalFeedback TEXT, createdAt TEXT NOT NULL, updatedAt TEXT, isDeleted TINYINT DEFAULT 0,
  status VARCHAR(64) DEFAULT 'draft', attachments TEXT, products TEXT,
  vatRate DOUBLE DEFAULT 10, postTaxValue DOUBLE DEFAULT 0, paidAmount DOUBLE DEFAULT 0,
  projectId VARCHAR(191), contractType VARCHAR(64) DEFAULT 'output', supplierName TEXT,
  documentChecklist TEXT, signedDate TEXT, startDate TEXT, endDate TEXT,
  warrantyMonths INT DEFAULT 0, payments TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS revenue_reports (
  id VARCHAR(191) PRIMARY KEY, title TEXT NOT NULL, reportType VARCHAR(64) NOT NULL,
  periodStart TEXT NOT NULL, periodEnd TEXT NOT NULL, content TEXT,
  totalPreTax DOUBLE DEFAULT 0, totalDelivered DOUBLE DEFAULT 0, totalCumulative DOUBLE DEFAULT 0,
  authorId VARCHAR(191) NOT NULL, department VARCHAR(191) NOT NULL, status VARCHAR(64) NOT NULL DEFAULT 'Draft',
  approvedBy VARCHAR(191), approvedAt TEXT, managerFeedback TEXT, directorFeedback TEXT,
  createdAt TEXT NOT NULL, submittedAt TEXT, isDeleted TINYINT DEFAULT 0,
  generationMode VARCHAR(64) DEFAULT 'manual'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(191) PRIMARY KEY, projectCode TEXT NOT NULL, name TEXT NOT NULL, clientName TEXT,
  department VARCHAR(191), managerId VARCHAR(191), status VARCHAR(64) DEFAULT 'planning',
  startDate TEXT, endDate TEXT, budget DOUBLE DEFAULT 0, description TEXT,
  biddingCode TEXT, biddingDate TEXT, procurementMethod TEXT, investor TEXT,
  biddingPrice DOUBLE DEFAULT 0, winningPrice DOUBLE DEFAULT 0,
  createdAt TEXT NOT NULL, updatedAt TEXT, isDeleted TINYINT DEFAULT 0,
  priority VARCHAR(64) DEFAULT 'medium', phase VARCHAR(64) DEFAULT 'initiation'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_reports (
  id VARCHAR(191) PRIMARY KEY, projectId VARCHAR(191) NOT NULL, title TEXT NOT NULL, content TEXT,
  progress INT DEFAULT 0, authorId VARCHAR(191) NOT NULL, status VARCHAR(64) DEFAULT 'draft',
  createdAt TEXT NOT NULL, updatedAt TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_milestones (
  id VARCHAR(191) PRIMARY KEY, projectId VARCHAR(191) NOT NULL, title TEXT NOT NULL,
  dueDate TEXT, completedAt TEXT, status VARCHAR(64) DEFAULT 'pending',
  sortOrder INT DEFAULT 0, createdAt TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contract_links (
  id VARCHAR(191) PRIMARY KEY, outputContractId VARCHAR(191) NOT NULL, inputContractId VARCHAR(191) NOT NULL,
  linkType VARCHAR(64) DEFAULT 'related', description TEXT, createdBy VARCHAR(191), createdAt TEXT NOT NULL,
  UNIQUE(outputContractId, inputContractId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS documents (
  id VARCHAR(191) PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, size INT, type VARCHAR(191),
  category VARCHAR(191) NOT NULL, linkedId VARCHAR(191), createdBy VARCHAR(191) NOT NULL,
  createdAt TEXT NOT NULL, isDeleted TINYINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS uploaded_files (
  filename VARCHAR(255) PRIMARY KEY, ownerId VARCHAR(191) NOT NULL,
  originalName TEXT NOT NULL, size BIGINT NOT NULL, mimeType VARCHAR(191) NOT NULL,
  entityType VARCHAR(64), entityId VARCHAR(191),
  createdAt TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clients (
  id VARCHAR(191) PRIMARY KEY, name VARCHAR(191) NOT NULL UNIQUE, region TEXT, createdAt TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(191) PRIMARY KEY, name VARCHAR(191) NOT NULL, unit TEXT, origin TEXT,
  defaultPrice DOUBLE DEFAULT 0, createdAt TEXT NOT NULL, category VARCHAR(191),
  importQuantity INT DEFAULT 0, remainingQuantity INT DEFAULT 0,
  importPrice DOUBLE DEFAULT 0, salePrice DOUBLE DEFAULT 0, importCode VARCHAR(191), invoiceDate TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mail_quotas (
  email VARCHAR(255) PRIMARY KEY, quota INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

export async function initDbMysql(): Promise<MysqlDb> {
  const url = process.env.DATABASE_URL || 'mysql://root:@127.0.0.1:3306/tranletask';
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, '') || 'tranletask';
  const host = parsed.hostname || '127.0.0.1';
  const port = parseInt(parsed.port || '3306', 10);
  const user = decodeURIComponent(parsed.username || 'root');
  const password = decodeURIComponent(parsed.password || '');

  // Step 1: Connect to server without database to ensure database exists
  try {
    const serverConn = await mysql.createConnection({
      host,
      port,
      user,
      password,
      connectTimeout: 20000,
    });
    await serverConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await serverConn.end();
  } catch (err: any) {
    console.warn(`[MySQL] Notice while ensuring database exists:`, err.message);
  }

  // Step 2: Connect to the specific database
  const connectionConfig: mysql.ConnectionOptions = {
    host,
    port,
    user,
    password,
    database: dbName,
    connectTimeout: 20000,
    charset: 'utf8mb4',
    timezone: 'Z',
  };

  let conn = await mysql.createConnection(connectionConfig);
  const db = new MysqlDb(conn, connectionConfig);

  // Serialize schema creation, additive migrations, and bootstrap seeds across
  // application instances. MySQL DDL is not transactional; each migration is
  // idempotent and records its version only after all of its steps complete.
  await withMigrationLock(db, async () => {
    await db.exec(DDL);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INT PRIMARY KEY,
        name VARCHAR(191) NOT NULL,
        appliedAt TEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const ensureColumn = async (table: string, column: string, definition: string) => {
      const existing = await db.get(
        'SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
        [table, column]
      );
      if (!existing || Number(existing.count) === 0) {
        await db.run(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
      }
    };

    await runVersionedMigration(db, 1, 'security_columns_and_reset_token_hashes', async () => {
      await ensureColumn('users', 'tokenVersion', '`tokenVersion` INT NOT NULL DEFAULT 0');
      await ensureColumn('password_reset_tokens', 'tokenHash', '`tokenHash` VARCHAR(191) UNIQUE');
      await ensureColumn('uploaded_files', 'entityType', '`entityType` VARCHAR(64) NULL');
      await ensureColumn('uploaded_files', 'entityId', '`entityId` VARCHAR(191) NULL');
      await db.run(`
        UPDATE password_reset_tokens
        SET tokenHash = LOWER(SHA2(token, 256)), token = LOWER(SHA2(token, 256))
        WHERE tokenHash IS NULL OR tokenHash = '' OR tokenHash <> token
      `);
    });

    await runVersionedMigration(db, 2, 'notification_deduplication', async () => {
      await ensureColumn('notifications', 'dedupeKey', '`dedupeKey` VARCHAR(64) NULL UNIQUE');
    });

    await seedIfEmpty(db);
    await migrateMailCredentials(db);
  });

  return db;
}

export async function migrateMailCredentials(db: MysqlDb) {
  if (!process.env.MAIL_ENCRYPTION_KEY?.trim()) {
    // Development installs without configured mail credentials should still boot.
    console.warn('[SECURITY] Skipping mail credential encryption migration: MAIL_ENCRYPTION_KEY is not configured.');
    return;
  }

  let migrated = 0;
  let skipped = 0;
  const users = await db.all('SELECT id, mailPassword FROM users WHERE mailPassword IS NOT NULL AND mailPassword <> ? AND mailPassword NOT LIKE ?', ['', 'v2:%']);
  for (const user of users) {
    const legacyValue = String(user.mailPassword);
    let plaintext = legacyValue;
    if (isVersionedCiphertext(legacyValue)) continue;
    if (isLegacyCbcCiphertext(legacyValue)) {
      const decrypted = decrypt(legacyValue);
      if (decrypted === null) { skipped++; continue; }
      plaintext = decrypted;
    }
    const result = await db.run('UPDATE users SET mailPassword = ? WHERE id = ? AND mailPassword = ?', [encrypt(plaintext), user.id, legacyValue]);
    if (result.changes) migrated++;
  }

  const smtp = await db.get('SELECT `value` FROM system_config WHERE `key` = ?', ['SMTP_PASS']);
  if (smtp?.value) {
    const legacyValue = String(smtp.value);
    if (!isVersionedCiphertext(legacyValue)) {
      let plaintext = legacyValue;
      if (isLegacyCbcCiphertext(legacyValue)) {
        const decrypted = decrypt(legacyValue);
        if (decrypted === null) skipped++;
        else plaintext = decrypted;
      }
      if (!isLegacyCbcCiphertext(legacyValue) || plaintext !== legacyValue) {
        const result = await db.run('UPDATE system_config SET `value` = ? WHERE `key` = ? AND `value` = ?', [encrypt(plaintext), 'SMTP_PASS', legacyValue]);
        if (result.changes) migrated++;
      }
    }
  }

  if (migrated || skipped) console.info(`[SECURITY] Mail credential encryption migration: ${migrated} migrated, ${skipped} skipped.`);
}

async function seedIfEmpty(db: MysqlDb) {
  const now = new Date().toISOString();
  const todayStr = now.split('T')[0];

  // ── 1. System Config (Company Profile & Design Tokens) ─────────────────────
  const COMPANY_CONFIGS: [string, string][] = [
    ['company_name', 'Công ty Cổ phần Tư vấn xây dựng Điện Trần Lê'],
    ['brand_name', 'Tran Le Electricity'],
    ['company_website', 'https://tranlecorp.com/'],
    ['company_email', 'info@tranlecorp.com.vn'],
    ['company_hotline', '0939 792 428'],
    ['company_founded', '2015'],
    ['company_anniversary', '25/11/2015 – 25/11/2025 (Kỷ niệm 10 năm thành lập)'],
    ['company_industry', 'Năng lượng tái tạo, điện mặt trời và các giải pháp năng lượng'],
    ['company_mission', 'Mang năng lượng sạch đến mọi nhà.'],
    ['company_vision', 'Dẫn đầu thị trường năng lượng tái tạo.'],
    ['company_core_values', 'Uy tín – Chất lượng – Bền vững.'],
    ['company_headquarter', '275-277-279 Diên Hồng, phường Hoà Xuân, Quận Cẩm Lệ, TP. Đà Nẵng, Việt Nam'],
    ['company_southern_office', 'Số 2 Đường số 27, Khu Dân Cư Vạn Phúc, Phường Hiệp Bình, TP.HCM'],
    ['company_warehouse_hanoi', 'Kho Cầu Nhật Tân, Xã Vân Nội, Huyện Đông Anh, TP. Hà Nội'],
    ['company_warehouse_danang_1', 'Kho 1: 275–279 Diên Hồng, Phường Hoà Xuân, Quận Cẩm Lệ, TP. Đà Nẵng'],
    ['company_warehouse_danang_2', 'Kho 2: Đường Võ An Ninh – Phan Triêm, Phường Hoà Xuân, Quận Cẩm Lệ, TP. Đà Nẵng'],
    ['company_warehouse_hcm', 'Kho 1: 02 Nguyễn Ảnh Thủ, Phường Trung Mỹ Tây, Quận 12, TP.HCM'],
    ['company_warehouse_vungtau', 'Kho 2: Phú Mỹ, Thị xã Phú Mỹ, Tỉnh Bà Rịa – Vũng Tàu'],
    ['saj_partnership_date', '08/03/2026'],
    ['saj_service_center', 'Trung Tâm Dịch Vụ & Bảo Hành Ủy Quyền SAJ tại Việt Nam'],
    ['brand_primary_color', '#16A34A'],
    ['brand_secondary_color', '#F59E0B'],
    ['brand_dark_color', '#0F172A'],
    // Quy mô công bố trong PROFILE TLEC VN - 2026.pdf
    ['company_scale_staff', '50+ nhân sự'],
    ['company_scale_certificates', '20+ chứng chỉ năng lực'],
    ['company_scale_partners', '30+ đối tác quốc tế'],
    ['company_scale_customers', '2000+ khách hàng'],
    ['company_capital', '20 tỷ đồng vốn điều lệ'],
    ['company_revenue_2020', 'Doanh thu trước thuế vượt mốc 1000 tỷ đồng (2020)'],
  ];

  for (const [key, value] of COMPANY_CONFIGS) {
    await db.run(
      'INSERT IGNORE INTO system_config (`key`, `value`) VALUES (?, ?)',
      [key, value]
    );
  }

  // ── 2. Roles (Design System Color Tokens) ──────────────────────────────────
  const INITIAL_ROLES = [
    {
      id: 'role-admin',
      name: 'Admin',
      description: 'Toàn quyền quản trị hệ thống Tran Le Electricity.',
      color: '#ef4444',
      permissions: JSON.stringify([
        'admin_panel', 'manage_users', 'manage_meetings', 'view_all_tasks',
        'manage_dept_tasks', 'view_own_tasks', 'view_all_reports', 'approve_dept_reports',
        'director_feedback', 'create_report', 'view_dept_users', 'join_meetings',
        'create_revenue_report', 'approve_dept_revenue', 'approve_all_revenue', 'manage_warehouse'
      ]),
      isSystem: 1
    },
    {
      id: 'role-director',
      name: 'Director',
      description: 'Ban Giám đốc — Phê duyệt dự án điện mặt trời, kế hoạch tài chính và chiến lược phát triển.',
      color: '#0f172a', // Design System Dark / Navy
      permissions: JSON.stringify([
        'view_all_reports', 'director_feedback', 'view_all_tasks', 'manage_meetings',
        'join_meetings', 'approve_all_revenue', 'manage_warehouse'
      ]),
      isSystem: 1
    },
    {
      id: 'role-manager',
      name: 'Manager',
      description: 'Quản lý khối kỹ thuật/phòng ban, điều phối dự án EPC/O&M, phân công nhiệm vụ và duyệt báo cáo.',
      color: '#16a34a', // Design System Primary Energy Green
      permissions: JSON.stringify([
        'manage_dept_tasks', 'approve_dept_reports', 'view_dept_users', 'manage_meetings',
        'join_meetings', 'create_report', 'create_revenue_report', 'approve_dept_revenue', 'manage_warehouse'
      ]),
      isSystem: 1
    },
    {
      id: 'role-employee',
      name: 'Employee',
      description: 'Kỹ sư & nhân viên thực thi dự án, tư vấn thiết kế, thi công lắp đặt, O&M và báo cáo tiến độ.',
      color: '#f59e0b', // Design System Solar Gold
      permissions: JSON.stringify([
        'view_own_tasks', 'create_report', 'join_meetings', 'create_revenue_report'
      ]),
      isSystem: 1
    },
  ];

  for (const r of INITIAL_ROLES) {
    await db.run(
      'INSERT IGNORE INTO roles (id, name, description, color, permissions, isSystem) VALUES (?, ?, ?, ?, ?, ?)',
      [r.id, r.name, r.description, r.color, r.permissions, r.isSystem]
    );
  }

  // ── 3. Departments (Tran Le Organizational Structure) ──────────────────────
  const TRANLE_DEPTS = [
    { id: 'dept-board', name: 'Ban Lãnh Đạo', description: 'Hội đồng quản trị & Ban Tổng Giám đốc định hướng chiến lược năng lượng tái tạo.', color: '#0f172a' },
    { id: 'dept-epc', name: 'Khối Tổng Thầu EPC & Thi Công', description: 'Khảo sát, thiết kế kỹ thuật, mua sắm và thi công lắp đặt dự án điện mặt trời.', color: '#16a34a' },
    { id: 'dept-om', name: 'Trung Tâm Dịch Vụ & Bảo Hành O&M (SAJ Center)', description: 'Vận hành, bảo trì O&M 24/7 và Trung tâm Dịch vụ Bảo hành ủy quyền SAJ tại Việt Nam.', color: '#0ea5e9' },
    { id: 'dept-sales', name: 'Phòng Kinh Doanh & Phân Phối Thiết Bị', description: 'Kinh doanh giải pháp điện mặt trời (Residential, Commercial, Utility) và phân phối thiết bị chính hãng.', color: '#f59e0b' },
    { id: 'dept-design', name: 'Phòng Tư Vấn & Thiết Kế Kỹ Thuật', description: 'Khảo sát hiện trạng, mô phỏng PVSyst/AutoCAD và tối ưu hóa giải pháp kỹ thuật.', color: '#8b5cf6' },
    { id: 'dept-finance', name: 'Phòng Kế Toán & Tài Chính', description: 'Quản lý hợp đồng EPC, thanh quyết toán, dòng tiền và báo cáo doanh thu tài chính.', color: '#14b8a6' },
    { id: 'dept-hr', name: 'Phòng Hành Chính & Nhân Sự', description: 'Quản trị nguồn nhân lực, phát triển văn hóa doanh nghiệp xanh và hành chính văn phòng.', color: '#ec4899' },
    // Compatibility aliases
    { id: 'dept-product', name: 'Product', description: 'Quản lý danh mục sản phẩm thiết bị năng lượng mặt trời.', color: '#16a34a' },
    { id: 'dept-board-en', name: 'Board', description: 'Ban Giám đốc & Hội đồng quản trị.', color: '#0f172a' },
    { id: 'dept-marketing', name: 'Marketing', description: 'Tiếp thị và truyền thông thương hiệu Tran Le Electricity.', color: '#f59e0b' },
    { id: 'dept-sales-en', name: 'Sales', description: 'Kinh doanh và phát triển thị trường năng lượng sạch.', color: '#16a34a' },
    { id: 'dept-it', name: 'IT', description: 'Hạ tầng số, nền tảng giám sát IoT Solar và hệ thống nội bộ.', color: '#8b5cf6' },
    { id: 'dept-hr-en', name: 'HR', description: 'Nhân sự và tuyển dụng.', color: '#ec4899' },
    { id: 'dept-finance-en', name: 'Finance', description: 'Tài chính và kế toán.', color: '#14b8a6' },
  ];

  for (const d of TRANLE_DEPTS) {
    await db.run(
      'INSERT IGNORE INTO departments (id, name, description, color) VALUES (?, ?, ?, ?)',
      [d.id, d.name, d.description, d.color]
    );
  }

  // ── 4. Users ───────────────────────────────────────────────────────────────
  const userCount = await db.get('SELECT COUNT(*) as count FROM users');
  if (userCount && Number(userCount.count) === 0) {
    const adminPwd = process.env.ADMIN_DEFAULT_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'TranLe@dmin2026!');
    if (!adminPwd) throw new Error('ADMIN_DEFAULT_PASSWORD is required before seeding initial accounts in production.');
    const INITIAL_USERS = [
      { id: 'u1', name: 'Admin Tran Le', email: 'admin@tranlecorp.com.vn', password: await bcrypt.hash(adminPwd, 10), role: 'Admin', department: 'Ban Lãnh Đạo', avatar: 'https://i.pravatar.cc/150?u=u1', phone: '0939792428', dob: '1990-01-01', hometown: 'Đà Nẵng', bio: 'Quản trị viên hệ thống Tran Le Electricity.' },
      { id: 'u2', name: 'Nguyễn Văn Đạt', email: 'vandat@tranlecorp.com.vn', password: await bcrypt.hash(adminPwd, 10), role: 'Manager', department: 'Khối Tổng Thầu EPC & Thi Công', avatar: 'https://i.pravatar.cc/150?u=u2', phone: '0987654321', dob: '1985-06-15', hometown: 'Đà Nẵng', bio: 'Chỉ huy trưởng thi công & Quản lý dự án EPC Điện mặt trời.' },
      { id: 'u3', name: 'Phan Xuân Mạnh', email: 'xuanmanh@tranlecorp.com.vn', password: await bcrypt.hash(adminPwd, 10), role: 'Employee', department: 'Khối Tổng Thầu EPC & Thi Công', avatar: 'https://i.pravatar.cc/150?u=u3', phone: '0123456789', dob: '2002-09-07', hometown: 'Đà Nẵng', bio: 'Kỹ sư giải pháp năng lượng tái tạo & O&M Solar.' },
      { id: 'u4', name: 'Nguyễn Văn Duy', email: 'vanduy@tranlecorp.com.vn', password: await bcrypt.hash(adminPwd, 10), role: 'Director', department: 'Ban Lãnh Đạo', avatar: 'https://i.pravatar.cc/150?u=u4', phone: '0939792428', dob: '1980-02-20', hometown: 'Đà Nẵng', bio: 'Ban Giám đốc Công ty Cổ phần Tư vấn xây dựng Điện Trần Lê.' },
    ];
    console.log('[SECURITY] Initial accounts seeded. Configure unique credentials immediately after first login.');
    // Production must not create demo employee accounts that share the bootstrap password.
    const usersToSeed = process.env.NODE_ENV === 'production' ? INITIAL_USERS.slice(0, 1) : INITIAL_USERS;
    for (const u of usersToSeed) {
      await db.run(
        'INSERT INTO users (id, name, email, password, role, department, avatar, phone, dob, hometown, bio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [u.id, u.name, u.email, u.password, u.role, u.department, u.avatar, u.phone, u.dob, u.hometown, u.bio]
      );
    }
  }

  // Catalog, projects, clients, contracts, tasks, notes, and events below are
  // demo/bootstrap content. Production starts with configuration, system
  // roles/departments, and a single operator-controlled admin account only.
  if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO_DATA !== 'true') return;

  // ── 5. Products (Catalog from Ho_so_tong_hop_Tran_Le_Electricity.md) ───────
  const prodCount = await db.get('SELECT COUNT(*) as count FROM products');
  if (prodCount && Number(prodCount.count) === 0) {
    const INITIAL_PRODUCTS = [
      // Tấm pin Solar
      { id: 'prod-pin-01', name: 'Tấm pin AIKO 650Wp N-Type ABC Dual-Glass Stellar 1N+', category: 'Tấm pin', unit: 'Tấm', origin: 'AIKO', defaultPrice: 2850000, importPrice: 2250000, salePrice: 2850000, importCode: 'NK-PIN-0001', importQuantity: 1000, remainingQuantity: 850, invoiceDate: '2026-01-15' },
      { id: 'prod-pin-02', name: 'Tấm pin Jinko Solar Tiger Pro 585Wp N-Type TOPCon', category: 'Tấm pin', unit: 'Tấm', origin: 'Jinko Solar', defaultPrice: 2490000, importPrice: 1950000, salePrice: 2490000, importCode: 'NK-PIN-0002', importQuantity: 800, remainingQuantity: 620, invoiceDate: '2026-01-20' },
      { id: 'prod-pin-03', name: 'Tấm pin Canadian Solar HiKu7 660Wp Mono PERC', category: 'Tấm pin', unit: 'Tấm', origin: 'Canadian Solar', defaultPrice: 2750000, importPrice: 2150000, salePrice: 2750000, importCode: 'NK-PIN-0003', importQuantity: 600, remainingQuantity: 480, invoiceDate: '2026-02-05' },
      { id: 'prod-pin-04', name: 'Tấm pin JA Solar DeepBlue 3.0 550Wp', category: 'Tấm pin', unit: 'Tấm', origin: 'JA Solar', defaultPrice: 2320000, importPrice: 1800000, salePrice: 2320000, importCode: 'NK-PIN-0004', importQuantity: 500, remainingQuantity: 390, invoiceDate: '2026-02-12' },
      { id: 'prod-pin-05', name: 'Tấm pin LONGi Hi-MO 6 Explorer 580Wp', category: 'Tấm pin', unit: 'Tấm', origin: 'LONGi', defaultPrice: 2450000, importPrice: 1920000, salePrice: 2450000, importCode: 'NK-PIN-0005', importQuantity: 400, remainingQuantity: 310, invoiceDate: '2026-02-18' },
      // Biến tần Inverters
      { id: 'prod-inv-01', name: 'Biến tần hòa lưới SAJ R5-5K-S2 (1 pha 5kW)', category: 'Biến tần', unit: 'Bộ', origin: 'SAJ', defaultPrice: 14500000, importPrice: 11200000, salePrice: 14500000, importCode: 'NK-INV-0001', importQuantity: 50, remainingQuantity: 38, invoiceDate: '2026-02-01' },
      { id: 'prod-inv-02', name: 'Biến tần hòa lưới SAJ R6-10K-T2 (3 pha 10kW)', category: 'Biến tần', unit: 'Bộ', origin: 'SAJ', defaultPrice: 23900000, importPrice: 18500000, salePrice: 23900000, importCode: 'NK-INV-0002', importQuantity: 40, remainingQuantity: 28, invoiceDate: '2026-02-01' },
      { id: 'prod-inv-03', name: 'Biến tần Hybrid lưu trữ SAJ H2-10K-T2 (3 pha 10kW)', category: 'Biến tần', unit: 'Bộ', origin: 'SAJ', defaultPrice: 36000000, importPrice: 28500000, salePrice: 36000000, importCode: 'NK-INV-0003', importQuantity: 30, remainingQuantity: 22, invoiceDate: '2026-02-10' },
      { id: 'prod-inv-04', name: 'Biến tần công nghiệp SAJ C6-100K-HV (3 pha 100kW)', category: 'Biến tần', unit: 'Bộ', origin: 'SAJ', defaultPrice: 119000000, importPrice: 96000000, salePrice: 119000000, importCode: 'NK-INV-0004', importQuantity: 20, remainingQuantity: 14, invoiceDate: '2026-02-15' },
      { id: 'prod-inv-05', name: 'Biến tần công nghiệp Huawei SUN2000-100KTL-M2 (3 pha 100kW)', category: 'Biến tần', unit: 'Bộ', origin: 'Huawei', defaultPrice: 132000000, importPrice: 108000000, salePrice: 132000000, importCode: 'NK-INV-0005', importQuantity: 15, remainingQuantity: 9, invoiceDate: '2026-02-20' },
      // Pin lưu trữ
      { id: 'prod-bat-01', name: 'Pin lưu trữ SAJ B2-HV5 LiFePO4 Module 7.3kWh (Cao áp)', category: 'Pin lưu trữ', unit: 'Bộ', origin: 'SAJ', defaultPrice: 53500000, importPrice: 43000000, salePrice: 53500000, importCode: 'NK-BAT-0001', importQuantity: 25, remainingQuantity: 18, invoiceDate: '2026-02-10' },
      { id: 'prod-bat-02', name: 'Hệ thống pin lưu trữ Dyness Tower T14 14.2kWh', category: 'Pin lưu trữ', unit: 'Bộ', origin: 'Dyness', defaultPrice: 96000000, importPrice: 79000000, salePrice: 96000000, importCode: 'NK-BAT-0002', importQuantity: 15, remainingQuantity: 11, invoiceDate: '2026-02-25' },
      // Phụ kiện
      { id: 'prod-acc-01', name: 'Cáp năng lượng mặt trời DC Solar Cable 4.0mm² Cu/XLPO 1500V', category: 'Phụ kiện', unit: 'Mét', origin: 'Chính hãng', defaultPrice: 19500, importPrice: 14500, salePrice: 19500, importCode: 'NK-ACC-0001', importQuantity: 15000, remainingQuantity: 11200, invoiceDate: '2026-01-10' },
      { id: 'prod-acc-02', name: 'Đầu nối chuyên dụng MC4 1500V 30A IP68', category: 'Phụ kiện', unit: 'Cặp', origin: 'Chính hãng', defaultPrice: 39000, importPrice: 26000, salePrice: 39000, importCode: 'NK-ACC-0002', importQuantity: 3000, remainingQuantity: 2400, invoiceDate: '2026-01-10' },
      { id: 'prod-acc-03', name: 'Thanh ray nhôm định hình Anodized 6005-T5 (4.2m)', category: 'Phụ kiện', unit: 'Thanh', origin: 'Việt Nam', defaultPrice: 295000, importPrice: 225000, salePrice: 295000, importCode: 'NK-ACC-0003', importQuantity: 1200, remainingQuantity: 950, invoiceDate: '2026-01-15' },
    ];
    for (const p of INITIAL_PRODUCTS) {
      await db.run(
        'INSERT INTO products (id, name, unit, origin, defaultPrice, createdAt, category, importQuantity, remainingQuantity, importPrice, salePrice, importCode, invoiceDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [p.id, p.name, p.unit, p.origin, p.defaultPrice, now, p.category, p.importQuantity, p.remainingQuantity, p.importPrice, p.salePrice, p.importCode, p.invoiceDate]
      );
    }
  }

  // ── 6. Projects (Section 7 from Ho_so_tong_hop_Tran_Le_Electricity.md) ──────
  const projCount = await db.get('SELECT COUNT(*) as count FROM projects');
  if (projCount && Number(projCount.count) === 0) {
    const INITIAL_PROJECTS = [
      {
        id: 'proj-01',
        projectCode: 'DA-COCOTEX-4.5M',
        name: 'Dự án Điện mặt trời Công ty TNHH Cocotex (4,5 MWp)',
        clientName: 'Công ty TNHH Cocotex',
        department: 'Khối Tổng Thầu EPC & Thi Công',
        managerId: 'u2',
        status: 'completed',
        phase: 'closing',
        priority: 'high',
        budget: 65000000000,
        biddingPrice: 66000000000,
        winningPrice: 65000000000,
        description: 'Tổng thầu EPC hệ thống điện mặt trời áp mái 4,5 MWp tại TP. Hồ Chí Minh. Tiết kiệm chi phí năng lượng và giảm ~5.400 tấn CO2/năm cho nhà máy Cocotex.',
        startDate: '2024-03-01',
        endDate: '2024-11-30',
        createdAt: '2024-03-01T08:00:00.000Z',
      },
      {
        id: 'proj-02',
        projectCode: 'DA-NAMLY-3.0M',
        name: 'Dự án Điện mặt trời áp mái 3 MWp Nam Lý',
        clientName: 'Công ty Cổ phần Nam Lý',
        department: 'Khối Tổng Thầu EPC & Thi Công',
        managerId: 'u2',
        status: 'completed',
        phase: 'closing',
        priority: 'high',
        budget: 43500000000,
        biddingPrice: 45000000000,
        winningPrice: 43500000000,
        description: 'Thi công lắp đặt và đấu nối hệ thống điện mặt trời áp mái công nghiệp 3 MWp tại tỉnh Ninh Bình.',
        startDate: '2024-06-15',
        endDate: '2025-01-20',
        createdAt: '2024-06-15T08:00:00.000Z',
      },
      {
        id: 'proj-03',
        projectCode: 'DA-GIOLINH-4.0M',
        name: 'Dự án Điện năng lượng mặt trời nông trại tại Gio Linh (4 MWp)',
        clientName: 'Nông trại Công nghệ cao Gio Linh',
        department: 'Khối Tổng Thầu EPC & Thi Công',
        managerId: 'u2',
        status: 'completed',
        phase: 'closing',
        priority: 'high',
        budget: 58000000000,
        biddingPrice: 59500000000,
        winningPrice: 58000000000,
        description: 'Hệ thống điện mặt trời kết hợp mô hình nông nghiệp công nghệ cao 4 MWp tại huyện Gio Linh, tỉnh Quảng Trị.',
        startDate: '2024-08-01',
        endDate: '2025-04-15',
        createdAt: '2024-08-01T08:00:00.000Z',
      },
      {
        id: 'proj-04',
        projectCode: 'DA-THIENHOANG-1.5M',
        name: 'Dự án Điện mặt trời áp mái Nhà máy Thiện Hoàng (1,5 MWp)',
        clientName: 'Nhà máy May mặc Thiện Hoàng',
        department: 'Khối Tổng Thầu EPC & Thi Công',
        managerId: 'u2',
        status: 'completed',
        phase: 'closing',
        priority: 'medium',
        budget: 21800000000,
        biddingPrice: 22500000000,
        winningPrice: 21800000000,
        description: 'Giải pháp điện mặt trời tự dùng hòa lưới bám tải 1,5 MWp cho nhà xưởng may mặc tại tỉnh Bình Định.',
        startDate: '2025-02-10',
        endDate: '2025-08-30',
        createdAt: '2025-02-10T08:00:00.000Z',
      },
      {
        id: 'proj-05',
        projectCode: 'DA-SAJ-SERVICE-2026',
        name: 'Phát triển Trung tâm Dịch vụ & Bảo hành SAJ Service Center tại Việt Nam',
        clientName: 'SAJ Electric Technology Co., Ltd',
        department: 'Trung Tâm Dịch Vụ & Bảo Hành O&M (SAJ Center)',
        managerId: 'u2',
        status: 'in_progress',
        phase: 'execution',
        priority: 'high',
        budget: 8500000000,
        description: 'Triển khai thỏa thuận hợp tác chiến lược ngày 08/03/2026 giữa Tran Le và SAJ: Xây dựng trung tâm bảo hành ủy quyền, đào tạo kỹ thuật chuyên sâu và kho linh kiện thay thế chính hãng trên toàn quốc.',
        startDate: '2026-03-08',
        endDate: '2026-12-31',
        createdAt: '2026-03-08T08:00:00.000Z',
      },
    ];

    for (const pr of INITIAL_PROJECTS) {
      await db.run(
        `INSERT INTO projects (id, projectCode, name, clientName, department, managerId, status, startDate, endDate, budget, description, biddingPrice, winningPrice, priority, phase, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE projectCode = VALUES(projectCode), name = VALUES(name), clientName = VALUES(clientName),
           department = VALUES(department), managerId = VALUES(managerId), status = VALUES(status),
           startDate = VALUES(startDate), endDate = VALUES(endDate), budget = VALUES(budget),
           description = VALUES(description), biddingPrice = VALUES(biddingPrice), winningPrice = VALUES(winningPrice),
           priority = VALUES(priority), phase = VALUES(phase)`,
        [pr.id, pr.projectCode, pr.name, pr.clientName, pr.department, pr.managerId, pr.status, pr.startDate, pr.endDate, pr.budget, pr.description, pr.biddingPrice || 0, pr.winningPrice || 0, pr.priority, pr.phase, pr.createdAt]
      );
    }
  }

  // ── 6b. Đồng bộ dự án từ PROFILE TLEC VN - 2026.pdf (idempotent, chạy mọi lần) ─
  {
    const EPC = 'Khối Tổng Thầu EPC & Thi Công';
    const PDF_PROJECTS = [
      { id: 'proj-01', projectCode: 'DA-COCOTEX-4.5M', name: 'Dự án Điện mặt trời áp mái Công ty TNHH Cocotex (4,5 MWp)', clientName: 'Công ty TNHH Cocotex', department: EPC, managerId: 'u2', status: 'completed', startDate: '2024-03-01', endDate: '2024-11-30', budget: 65000000000, biddingPrice: 66000000000, winningPrice: 65000000000, priority: 'high', phase: 'closing', description: 'Tổng thầu EPC áp mái 4,5 MWp tại KCN Đất Đỏ, TP. Hồ Chí Minh (vốn FDI).', createdAt: '2024-03-01T08:00:00.000Z' },
      { id: 'proj-02', projectCode: 'DA-CHAUGIANG-3.0M', name: 'Dự án Điện mặt trời áp mái NM Dệt may Châu Giang (3 MWp)', clientName: 'NM Dệt may Châu Giang', department: EPC, managerId: 'u2', status: 'completed', startDate: '2024-06-15', endDate: '2025-01-20', budget: 43500000000, biddingPrice: 45000000000, winningPrice: 43500000000, priority: 'high', phase: 'closing', description: 'Áp mái công nghiệp 3 MWp tại Nam Lý, Ninh Bình.', createdAt: '2024-06-15T08:00:00.000Z' },
      { id: 'proj-03', projectCode: 'DA-GIOLINH-4.0M', name: 'Dự án Điện năng lượng mặt trời nông trại tại Gio Linh (4 MWp)', clientName: 'Nông trại Công nghệ cao Gio Linh', department: EPC, managerId: 'u2', status: 'completed', startDate: '2024-08-01', endDate: '2025-04-15', budget: 58000000000, biddingPrice: 59500000000, winningPrice: 58000000000, priority: 'high', phase: 'closing', description: 'Farm solar kết hợp nông nghiệp công nghệ cao 4 MWp tại Gio Linh, Quảng Trị.', createdAt: '2024-08-01T08:00:00.000Z' },
      { id: 'proj-04', projectCode: 'DA-THIENHOANG-1.5M', name: 'Dự án Điện mặt trời áp mái NM Thiện Hoàng (1,5 MWp)', clientName: 'Nhà máy May mặc Thiện Hoàng', department: EPC, managerId: 'u2', status: 'completed', startDate: '2025-02-10', endDate: '2025-08-30', budget: 21800000000, biddingPrice: 22500000000, winningPrice: 21800000000, priority: 'medium', phase: 'closing', description: 'Áp mái tự dùng hòa lưới bám tải 1,5 MWp tại Nhơn Hòa, Bình Định.', createdAt: '2025-02-10T08:00:00.000Z' },
      { id: 'proj-pdf-vinhlinh-1m', projectCode: 'DA-VINHLINH-1.0M', name: 'Dự án Điện mặt trời Solar Farm Vĩnh Linh (1 MWp)', clientName: 'Chủ đầu tư Vĩnh Linh', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'medium', phase: 'closing', description: 'Solar farm 1 MWp tại Vĩnh Linh, Quảng Trị (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-hoangha-1m', projectCode: 'DA-HOANGHA-1.0M', name: 'Dự án Điện mặt trời áp mái Hoàng Hà (1 MWp)', clientName: 'Hoàng Hà', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'medium', phase: 'closing', description: 'Áp mái 1 MWp tại Quảng Nam (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-thienhoang-2m', projectCode: 'DA-THIENHOANG-2.0M', name: 'Dự án Điện mặt trời áp mái Thiện Hoàng (2 MWp)', clientName: 'Nhà máy May mặc Thiện Hoàng', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'medium', phase: 'closing', description: 'Áp mái 2 MWp tại Bình Định (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-maxpack-06', projectCode: 'DA-MAXPACK-0.6M', name: 'Dự án Điện mặt trời áp mái NM Max Packaging (600 kWp)', clientName: 'NM Max Packaging', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'medium', phase: 'closing', description: 'Áp mái 600 kWp tại Núi Thành, Quảng Nam - KCN Bắc Chu Lai (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-hvnn-026', projectCode: 'DA-HVNN-0.26M', name: 'Dự án Điện mặt trời áp mái Học viện Nông nghiệp Việt Nam (260 kWp)', clientName: 'Học viện Nông nghiệp Việt Nam', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'medium', phase: 'closing', description: 'Áp mái 260 kWp tại Gia Lâm, Hà Nội (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-hyundai-0139', projectCode: 'DA-HYUNDAI-0.14M', name: 'Dự án Điện mặt trời áp mái nhà xưởng Hyundai (138,8 kWp)', clientName: 'Hyundai Thanh Hóa', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'medium', phase: 'closing', description: 'Áp mái 138,8 kWp tại Đông Hải, Thanh Hóa (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-lumphat-7m', projectCode: 'DA-LUMPHAT-7.0M', name: 'Dự án Điện mặt trời Farm Solar Lumphat (7 MWp)', clientName: 'Chủ đầu tư Lumphat', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'medium', phase: 'closing', description: 'Farm solar 7 MWp tại Lumphat, Campuchia (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-duchoa-5m', projectCode: 'DA-DUHOA-5.0M', name: 'Dự án Điện mặt trời Farm Solar Đức Hòa (5 MWp)', clientName: 'Chủ đầu tư Đức Hòa', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'medium', phase: 'closing', description: 'Farm solar 5 MWp tại Đức Hòa, Quảng Ngãi (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-vanphat-3m', projectCode: 'DA-VANPHAT-3.0M', name: 'Dự án Điện mặt trời áp mái NM Vạn Phát (3 MWp)', clientName: 'NM Vạn Phát', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'medium', phase: 'closing', description: 'Áp mái 3 MWp tại Gia Lai (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-tanlong-2m', projectCode: 'DA-TANLONG-2.0M', name: 'Dự án Điện mặt trời áp mái NM Tân Long (2 MWp)', clientName: 'NM Tân Long', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'medium', phase: 'closing', description: 'Áp mái 2 MWp tại Tân Long, Đà Nẵng (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-thai-1m', projectCode: 'DA-THAI-1.0M', name: 'Dự án Solar Power Plant Thái Lan (1 MWp, thầu phụ)', clientName: 'Đối tác Thái Lan', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'low', phase: 'closing', description: 'Vai trò nhà thầu phụ, 1 MWp tại Thái Lan (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-thaiboat-02', projectCode: 'DA-THAIBOAT-0.2M', name: 'Dự án Solarboat Floating Thái Lan (200 kWp, thầu phụ)', clientName: 'Đối tác Thái Lan', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'low', phase: 'closing', description: 'Hệ nổi Solarboat floating mounting 200 kWp, vai trò thầu phụ (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-indo-1m', projectCode: 'DA-INDO-1.0M', name: 'Dự án Solar Power Plant Indonesia (1 MWp, thầu phụ)', clientName: 'Đối tác Indonesia', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'low', phase: 'closing', description: 'Vai trò nhà thầu phụ, 1 MWp tại Indonesia (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-indo-5m', projectCode: 'DA-INDO-5.0M', name: 'Dự án Solar Power Plant Indonesia (5 MWp, thầu phụ)', clientName: 'Đối tác Indonesia', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'low', phase: 'closing', description: 'Vai trò nhà thầu phụ, 5 MWp tại Indonesia (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-cam-12m', projectCode: 'DA-CAM-1.2M', name: 'Dự án Solar Power Plant Campuchia (1,2 MWp)', clientName: 'Đối tác Campuchia', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'low', phase: 'closing', description: '1,2 MWp tại Campuchia (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-phil-187m', projectCode: 'DA-PHIL-1.87M', name: 'Dự án Solar Power Plant Philippines (1,87 MWp)', clientName: 'Đối tác Philippines', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'low', phase: 'closing', description: '1,87 MWp tại Philippines (PROFILE TLEC VN - 2026).', createdAt: now },
      { id: 'proj-pdf-malay-1m', projectCode: 'DA-MALAY-1.0M', name: 'Dự án Solar Power Plant Malaysia (1 MWp)', clientName: 'Đối tác Malaysia', department: EPC, managerId: 'u2', status: 'completed', startDate: null, endDate: null, budget: 0, biddingPrice: 0, winningPrice: 0, priority: 'low', phase: 'closing', description: '1 MWp tại Malaysia (PROFILE TLEC VN - 2026).', createdAt: now },
    ];
    for (const pr of PDF_PROJECTS) {
      await db.run(
        `INSERT INTO projects (id, projectCode, name, clientName, department, managerId, status, startDate, endDate, budget, description, biddingPrice, winningPrice, priority, phase, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE projectCode = VALUES(projectCode), name = VALUES(name), clientName = VALUES(clientName),
           department = VALUES(department), managerId = VALUES(managerId), status = VALUES(status),
           startDate = VALUES(startDate), endDate = VALUES(endDate), budget = VALUES(budget),
           description = VALUES(description), biddingPrice = VALUES(biddingPrice), winningPrice = VALUES(winningPrice),
           priority = VALUES(priority), phase = VALUES(phase)`,
        [pr.id, pr.projectCode, pr.name, pr.clientName, pr.department, pr.managerId, pr.status, pr.startDate, pr.endDate, pr.budget, pr.description, pr.biddingPrice, pr.winningPrice, pr.priority, pr.phase, pr.createdAt]
      );
    }
  }

  // ── 7. Clients (Partners & Project Owners) ──────────────────────────────────
  const clientCount = await db.get('SELECT COUNT(*) as count FROM clients');
  if (clientCount && Number(clientCount.count) === 0) {
    const INITIAL_CLIENTS = [
      { id: 'client-cocotex', name: 'Công ty TNHH Cocotex', region: 'TP. Hồ Chí Minh' },
      { id: 'client-namly', name: 'Công ty Cổ phần Nam Lý', region: 'Ninh Bình' },
      { id: 'client-giolinh', name: 'Nông trại Công nghệ cao Gio Linh', region: 'Quảng Trị' },
      { id: 'client-thienhoang', name: 'Nhà máy May mặc Thiện Hoàng', region: 'Bình Định' },
      { id: 'client-saj', name: 'SAJ Electric Technology Co., Ltd', region: 'Đối tác Chiến lược Quốc tế' },
      { id: 'client-aiko', name: 'AIKO Solar Energy Technology', region: 'Đối tác Sản phẩm Quốc tế' },
      { id: 'client-jinko', name: 'Jinko Solar Holding Co., Ltd', region: 'Đối tác Sản phẩm Quốc tế' },
      { id: 'client-canadian', name: 'Canadian Solar Inc.', region: 'Đối tác Sản phẩm Quốc tế' },
      { id: 'client-huawei', name: 'Huawei Digital Power Technologies', region: 'Đối tác Quốc tế' },
      { id: 'client-dyness', name: 'Dyness Renewable Energy', region: 'Đối tác Quốc tế' },
      // VNPT Branches
      { id: 'client-1', name: 'VNPT Hà Nội', region: 'Hà Nội' },
      { id: 'client-15', name: 'VNPT Ninh Bình', region: 'Ninh Bình + Nam Định + Hà Nam' },
      { id: 'client-19', name: 'VNPT Quảng Trị', region: 'Quảng Trị + Quảng Bình' },
      { id: 'client-20', name: 'VNPT Huế', region: 'Thành phố Huế' },
      { id: 'client-21', name: 'VNPT Đà Nẵng', region: 'Đà Nẵng + Quảng Nam' },
      { id: 'client-23', name: 'VNPT Gia Lai', region: 'Gia Lai + Bình Định' },
      { id: 'client-27', name: 'VNPT TP. Hồ Chí Minh', region: 'TP.HCM + Bình Dương + Bà Rịa - Vũng Tàu' },
      { id: 'client-30', name: 'VNPT Cần Thơ', region: 'Cần Thơ + Hậu Giang + Sóc Trăng' },
    ];
    for (const c of INITIAL_CLIENTS) {
      await db.run('INSERT INTO clients (id, name, region, createdAt) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), region = VALUES(region)', [c.id, c.name, c.region, now]);
    }
  }

  // ── 7b. Đồng bộ khách hàng/đối tác từ PROFILE TLEC VN - 2026.pdf (idempotent) ──
  {
    const PDF_CLIENTS = [
      { id: 'client-chaugiang', name: 'NM Dệt may Châu Giang', region: 'Ninh Bình' },
      { id: 'client-vinhlinh', name: 'Chủ đầu tư Vĩnh Linh', region: 'Quảng Trị' },
      { id: 'client-hoangha', name: 'Hoàng Hà', region: 'Quảng Nam' },
      { id: 'client-maxpack', name: 'NM Max Packaging', region: 'Quảng Nam' },
      { id: 'client-hvnn', name: 'Học viện Nông nghiệp Việt Nam', region: 'Hà Nội' },
      { id: 'client-hyundai', name: 'Hyundai Thanh Hóa', region: 'Thanh Hóa' },
      { id: 'client-lumphat', name: 'Chủ đầu tư Lumphat', region: 'Campuchia' },
      { id: 'client-duhoa', name: 'Chủ đầu tư Đức Hòa', region: 'Quảng Ngãi' },
      { id: 'client-vanphat', name: 'NM Vạn Phát', region: 'Gia Lai' },
      { id: 'client-tanlong', name: 'NM Tân Long', region: 'Đà Nẵng' },
      { id: 'client-thai', name: 'Đối tác Thái Lan', region: 'Thái Lan (thầu phụ)' },
      { id: 'client-indo', name: 'Đối tác Indonesia', region: 'Indonesia (thầu phụ)' },
      { id: 'client-cam', name: 'Đối tác Campuchia', region: 'Campuchia' },
      { id: 'client-phil', name: 'Đối tác Philippines', region: 'Philippines' },
      { id: 'client-malay', name: 'Đối tác Malaysia', region: 'Malaysia' },
      { id: 'client-tcl', name: 'TCL Solar', region: 'Đối tác Sản phẩm Quốc tế' },
      { id: 'client-sunpower', name: 'SunPower', region: 'Đối tác Sản phẩm Quốc tế' },
      { id: 'client-sigenergy', name: 'Sigenergy', region: 'Đối tác Sản phẩm Quốc tế' },
    ];
    for (const c of PDF_CLIENTS) {
      await db.run('INSERT INTO clients (id, name, region, createdAt) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), region = VALUES(region)', [c.id, c.name, c.region, now]);
    }
  }

  // ── 8. Contracts (EPC, O&M, Equipment Distribution) ─────────────────────────
  const contractCount = await db.get('SELECT COUNT(*) as count FROM contracts');
  if (contractCount && Number(contractCount.count) === 0) {
    const INITIAL_CONTRACTS = [
      {
        id: 'ctr-01',
        contractNumber: 'TL-EPC-2024/001',
        clientName: 'Công ty TNHH Cocotex',
        contractName: 'Hợp đồng Tổng thầu EPC Điện mặt trời áp mái 4.5 MWp Cocotex',
        contractType: 'output',
        preTaxValue: 59090909091,
        vatRate: 10,
        postTaxValue: 65000000000,
        paidAmount: 65000000000,
        department: 'Khối Tổng Thầu EPC & Thi Công',
        createdBy: 'u2',
        status: 'completed',
        projectId: 'proj-01',
        signedDate: '2024-03-05',
        startDate: '2024-03-10',
        endDate: '2024-11-25',
        warrantyMonths: 60,
        createdAt: '2024-03-05T09:00:00.000Z',
      },
      {
        id: 'ctr-02',
        contractNumber: 'TL-OM-2025/008',
        clientName: 'Nhà máy May mặc Thiện Hoàng',
        contractName: 'Hợp đồng Dịch vụ Vận hành & Bảo trì O&M Hệ thống 1.5 MWp Thiện Hoàng',
        contractType: 'output',
        preTaxValue: 450000000,
        vatRate: 10,
        postTaxValue: 495000000,
        paidAmount: 495000000,
        department: 'Trung Tâm Dịch Vụ & Bảo Hành O&M (SAJ Center)',
        createdBy: 'u3',
        status: 'approved',
        projectId: 'proj-04',
        signedDate: '2025-09-01',
        startDate: '2025-09-01',
        endDate: '2027-08-31',
        warrantyMonths: 24,
        createdAt: '2025-09-01T09:00:00.000Z',
      },
      {
        id: 'ctr-03',
        contractNumber: 'TL-PO-2026/012',
        supplierName: 'SAJ Electric Technology Co., Ltd',
        clientName: 'Tran Le Electricity',
        contractName: 'Hợp đồng Nhập khẩu Thiết bị Biến tần & Pin lưu trữ SAJ Quý 1/2026',
        contractType: 'input',
        preTaxValue: 12500000000,
        vatRate: 10,
        postTaxValue: 13750000000,
        paidAmount: 13750000000,
        department: 'Phòng Kinh Doanh & Phân Phối Thiết Bị',
        createdBy: 'u2',
        status: 'completed',
        signedDate: '2026-03-10',
        startDate: '2026-03-10',
        endDate: '2026-04-15',
        warrantyMonths: 60,
        createdAt: '2026-03-10T09:00:00.000Z',
      },
    ];

    for (const c of INITIAL_CONTRACTS) {
      await db.run(
        `INSERT INTO contracts (id, contractNumber, clientName, supplierName, contractName, contractType, preTaxValue, vatRate, postTaxValue, paidAmount, department, createdBy, status, projectId, signedDate, startDate, endDate, warrantyMonths, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.id, c.contractNumber, c.clientName, c.supplierName || null, c.contractName, c.contractType, c.preTaxValue, c.vatRate, c.postTaxValue, c.paidAmount, c.department, c.createdBy, c.status, c.projectId || null, c.signedDate, c.startDate, c.endDate, c.warrantyMonths, c.createdAt]
      );
    }
  }

  // ── 9. Tasks (Solar Operations & Technical Projects) ────────────────────────
  const taskCount = await db.get('SELECT COUNT(*) as count FROM tasks');
  if (taskCount && Number(taskCount.count) === 0) {
    const INITIAL_TASKS = [
      {
        id: 't1',
        title: 'Khảo sát & Mô phỏng PVSyst hệ thống Hybrid 10kWp Biệt thự KĐT Vạn Phúc',
        description: 'Khảo sát hướng mái, độ nghiêng, đo đạc mặt bằng lắp đặt ~16 tấm AIKO 650Wp và Inverter SAJ H2-10K kèm pin lưu trữ 7.3kWh.',
        startDate: todayStr,
        estimatedEndAt: null,
        priority: 'High',
        status: 'In Progress',
        createdBy: 'u2',
        department: 'Phòng Tư Vấn & Thiết Kế Kỹ Thuật',
        recurrence: 'None',
        assignees: ['u2', 'u3'],
        tags: ['Solar Hybrid', 'Khảo sát', 'PVSyst'],
        subtasks: [
          { id: 'st1', title: 'Thu thập hóa đơn tiền điện 12 tháng gần nhất', isCompleted: 1, sortOrder: 0 },
          { id: 'st2', title: 'Đo đạc kết cấu giàn khung và độ dốc mái', isCompleted: 1, sortOrder: 1 },
          { id: 'st3', title: 'Mô phỏng sản lượng PVSyst và xuất bảng ROI', isCompleted: 0, sortOrder: 2 },
        ]
      },
      {
        id: 't2',
        title: 'Vận hành quy trình tiếp nhận kỹ thuật tại SAJ Service Center miền Nam',
        description: 'Triển khai quy trình bảo hành ủy quyền, đào tạo kiểm tra lỗi Inverter SAJ (R5, R6, C6, H2) và chuẩn bị kho linh kiện bo mạch chính hãng.',
        startDate: todayStr,
        estimatedEndAt: null,
        priority: 'Urgent',
        status: 'In Progress',
        createdBy: 'u1',
        department: 'Trung Tâm Dịch Vụ & Bảo Hành O&M (SAJ Center)',
        recurrence: 'None',
        assignees: ['u2', 'u3'],
        tags: ['SAJ Service Center', 'Bảo hành', 'Kỹ thuật'],
        subtasks: [
          { id: 'st4', title: 'Thiết lập bàn test tải và công cụ chẩn đoán chuyên dụng', isCompleted: 1, sortOrder: 0 },
          { id: 'st5', title: 'Kiểm kê linh kiện thay thế bo mạch SAJ', isCompleted: 0, sortOrder: 1 },
        ]
      },
      {
        id: 't3',
        title: 'Bảo dưỡng định kỳ O&M & Quét nhiệt hồng ngoại Nhà máy Thiện Hoàng 1.5 MWp',
        description: 'Vệ sinh chuỗi tấm pin solar, kiểm tra điểm phát nhiệt (hotspot) bằng camera nhiệt FLIR, siết lực bu-lông khung nhôm và kiểm tra tủ điện DC/AC.',
        startDate: todayStr,
        estimatedEndAt: null,
        priority: 'Medium',
        status: 'Todo',
        createdBy: 'u2',
        department: 'Khối Tổng Thầu EPC & Thi Công',
        recurrence: 'None',
        assignees: ['u3'],
        tags: ['O&M', 'Thiện Hoàng', 'Bảo trì'],
        subtasks: [
          { id: 'st6', title: 'Kiểm tra đo điện trở cách điện DC', isCompleted: 0, sortOrder: 0 },
          { id: 'st7', title: 'Lập báo cáo tình trạng vận hành sau bảo dưỡng', isCompleted: 0, sortOrder: 1 },
        ]
      },
      {
        id: 't4',
        title: 'Đồng bộ hóa Design System Tran Le Electricity (#16A34A, #F59E0B)',
        description: 'Áp dụng toàn diện bảng mã màu nhận diện thương hiệu chuẩn: Energy Green (#16A34A), Solar Gold (#F59E0B) và Slate Navy (#0F172A).',
        startDate: todayStr,
        estimatedEndAt: null,
        priority: 'High',
        status: 'Done',
        createdBy: 'u1',
        department: 'Ban Lãnh Đạo',
        recurrence: 'None',
        assignees: ['u1', 'u3'],
        tags: ['Design System', 'UI/UX', 'Thương hiệu'],
        subtasks: [
          { id: 'st8', title: 'Cập nhật CSS variables & design tokens', isCompleted: 1, sortOrder: 0 },
          { id: 'st9', title: 'Kiểm tra độ tương phản chuẩn WCAG', isCompleted: 1, sortOrder: 1 },
        ]
      }
    ];

    for (const t of INITIAL_TASKS) {
      await db.run(
        'INSERT INTO tasks (id, title, description, startDate, estimatedEndAt, priority, status, createdBy, department, recurrence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [t.id, t.title, t.description, t.startDate, t.estimatedEndAt, t.priority, t.status, t.createdBy, t.department, t.recurrence]
      );
      for (const uid of t.assignees) {
        await db.run('INSERT INTO task_assignees (taskId, userId) VALUES (?, ?)', [t.id, uid]);
      }
      for (const tag of t.tags) {
        await db.run('INSERT INTO task_tags (taskId, tag) VALUES (?, ?)', [t.id, tag]);
      }
      for (const st of t.subtasks) {
        await db.run('INSERT INTO task_subtasks (id, taskId, title, isCompleted, sortOrder) VALUES (?, ?, ?, ?, ?)', [st.id, t.id, st.title, st.isCompleted, st.sortOrder]);
      }
    }
  }

  // ── 10. Notes ───────────────────────────────────────────────────────────────
  const noteCount = await db.get('SELECT COUNT(*) as count FROM notes');
  if (noteCount && Number(noteCount.count) === 0) {
    const INITIAL_NOTES = [
      {
        id: 'n1',
        title: 'Thông số kỹ thuật Tấm pin AIKO 650Wp N-Type ABC',
        content: '• Công nghệ: N-Type ABC Stellar 1N+ (Dual-Glass)\n• Hiệu suất module: 24,1%\n• Suy hao năm đầu: < 1,0%, suy hao hàng năm: < 0,35%\n• Bảo hành vật lý: 15 năm | Bảo hành hiệu suất: 30 năm (trên 88,85%)\n• Ứng dụng: Dự án điện mặt trời áp mái dân dụng & công nghiệp cao cấp.',
        color: 'bg-emerald-100',
        userId: 'u1',
        createdAt: now
      },
      {
        id: 'n2',
        title: 'Thông tin Trung Tâm Bảo Hành SAJ Service Center',
        content: '• Hợp tác chiến lược: 08/03/2026\n• Địa điểm: Số 2 Đường số 27, KDC Vạn Phúc, P. Hiệp Bình, TP.HCM\n• Hotline: 0939 792 428 | Email: info@tranlecorp.com.vn\n• Hỗ trợ kỹ thuật chuyên sâu các dòng biến tần SAJ R5, R6, H2, C6 và pin lưu trữ B2-HV5 LiFePO4.',
        color: 'bg-amber-100',
        userId: 'u2',
        createdAt: now
      }
    ];
    for (const n of INITIAL_NOTES) {
      await db.run(
        'INSERT INTO notes (id, title, content, color, userId, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [n.id, n.title, n.content, n.color, n.userId, n.createdAt]
      );
    }
  }

  // ── 11. Events (Vietnamese National Holidays) ────────────────────────────────
  const eventCount = await db.get('SELECT COUNT(*) as count FROM events');
  if (eventCount && Number(eventCount.count) === 0) {
    const year = new Date().getFullYear();
    const holidays = [
      { id: 'evt-01', title: 'Tết Dương Lịch', date: `${year}-01-01`, type: 'holiday', color: '#ef4444', description: 'Ngày đầu năm mới dương lịch', isRecurringYearly: 1 },
      { id: 'evt-02', title: 'Tết Nguyên Đán', date: `${year}-01-28`, endDate: `${year}-02-02`, type: 'holiday', color: '#f97316', description: 'Tết Nguyên Đán – nghỉ Tết cổ truyền', isRecurringYearly: 0 },
      { id: 'evt-03', title: 'Giỗ Tổ Hùng Vương', date: `${year}-04-07`, type: 'holiday', color: '#8b5cf6', description: 'Ngày Giỗ Tổ Hùng Vương (10/3 âm lịch)', isRecurringYearly: 0 },
      { id: 'evt-04', title: 'Ngày Giải phóng Miền Nam', date: `${year}-04-30`, type: 'holiday', color: '#ef4444', description: 'Ngày Giải phóng Miền Nam – thống nhất đất nước', isRecurringYearly: 1 },
      { id: 'evt-05', title: 'Ngày Quốc tế Lao động', date: `${year}-05-01`, type: 'holiday', color: '#ef4444', description: 'Ngày Quốc tế Lao động 1/5', isRecurringYearly: 1 },
      { id: 'evt-06', title: 'Ngày Quốc khánh', date: `${year}-09-02`, endDate: `${year}-09-03`, type: 'holiday', color: '#ef4444', description: 'Quốc khánh nước CHXHCN Việt Nam', isRecurringYearly: 1 },
      { id: 'evt-07', title: 'Kỷ niệm 10 năm thành lập Tran Le Electricity', date: `${year}-11-25`, type: 'company', color: '#16a34a', description: 'Ngày kỷ niệm 10 năm thành lập Công ty Cổ phần Tư vấn xây dựng Điện Trần Lê (25/11/2015 – 25/11/2025)', isRecurringYearly: 1 },
    ];
    for (const h of holidays) {
      await db.run(
        'INSERT INTO events (id, title, date, endDate, type, color, description, isRecurringYearly) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [h.id, h.title, h.date, h.endDate || null, h.type, h.color, h.description, h.isRecurringYearly]
      );
    }
  }
}


