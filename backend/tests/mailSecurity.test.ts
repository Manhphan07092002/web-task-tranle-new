import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decrypt, encrypt } from '../utils/cryptoUtils.js';
import { mailTlsOptions } from '../utils/mailTls.js';
import { createMailer } from '../mailer.js';
import { migrateMailCredentials } from '../db_mysql.js';

const originalEncryptionKey = process.env.MAIL_ENCRYPTION_KEY;
const originalLegacyKey = process.env.MAIL_ENCRYPTION_LEGACY_KEY;
const originalNodeEnv = process.env.NODE_ENV;
const originalInsecureTls = process.env.MAIL_ALLOW_INSECURE_TLS;

beforeEach(() => {
  process.env.MAIL_ENCRYPTION_KEY = 'test-current-encryption-key';
  delete process.env.MAIL_ENCRYPTION_LEGACY_KEY;
});

afterEach(() => {
  if (originalEncryptionKey === undefined) delete process.env.MAIL_ENCRYPTION_KEY;
  else process.env.MAIL_ENCRYPTION_KEY = originalEncryptionKey;
  if (originalLegacyKey === undefined) delete process.env.MAIL_ENCRYPTION_LEGACY_KEY;
  else process.env.MAIL_ENCRYPTION_LEGACY_KEY = originalLegacyKey;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalInsecureTls === undefined) delete process.env.MAIL_ALLOW_INSECURE_TLS;
  else process.env.MAIL_ALLOW_INSECURE_TLS = originalInsecureTls;
  vi.restoreAllMocks();
});

describe('mail credential security', () => {
  it('migrates a legacy CBC value to authenticated versioned GCM', () => {
    const legacyKey = 'previous-mail-key';
    process.env.MAIL_ENCRYPTION_LEGACY_KEY = legacyKey;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(legacyKey.padEnd(32, '0').slice(0, 32)), iv);
    const legacy = `${iv.toString('hex')}:${Buffer.concat([cipher.update('smtp-secret'), cipher.final()]).toString('hex')}`;

    const plaintext = decrypt(legacy);
    expect(plaintext).toBe('smtp-secret');
    const migrated = encrypt(plaintext!);
    expect(migrated).toMatch(/^v2:/);
    expect(decrypt(migrated!)).toBe('smtp-secret');
  });

  it('can read the former built-in CBC key for one-time migration only', () => {
    const legacyKey = 'TranLe-Task-Secure-Key-123456789';
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(legacyKey.padEnd(32, '0').slice(0, 32)), iv);
    const legacy = `${iv.toString('hex')}:${Buffer.concat([cipher.update('old-secret'), cipher.final()]).toString('hex')}`;
    expect(decrypt(legacy)).toBe('old-secret');
  });

  it('migrates stored user mail credentials and legacy plaintext SMTP_PASS with compare-and-swap updates', async () => {
    const legacyKey = 'previous-mail-key';
    process.env.MAIL_ENCRYPTION_LEGACY_KEY = legacyKey;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(legacyKey.padEnd(32, '0').slice(0, 32)), iv);
    const legacyUserValue = `${iv.toString('hex')}:${Buffer.concat([cipher.update(JSON.stringify({ email: 'u@example.test', password: 'mail-secret' })), cipher.final()]).toString('hex')}`;
    let userValue = legacyUserValue;
    let smtpValue = 'legacy-plaintext-smtp-secret';
    const db = {
      all: vi.fn(async () => userValue.startsWith('v2:') ? [] : [{ id: 'user-1', mailPassword: userValue }]),
      get: vi.fn(async () => ({ value: smtpValue })),
      run: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes('UPDATE users')) {
          if (userValue !== params[2]) return { changes: 0 };
          userValue = params[0];
          return { changes: 1 };
        }
        if (smtpValue !== params[2]) return { changes: 0 };
        smtpValue = params[0];
        return { changes: 1 };
      }),
    };

    await migrateMailCredentials(db as any);
    expect(userValue).toMatch(/^v2:/);
    expect(decrypt(userValue)).toBe(JSON.stringify({ email: 'u@example.test', password: 'mail-secret' }));
    expect(smtpValue).toMatch(/^v2:/);
    expect(decrypt(smtpValue)).toBe('legacy-plaintext-smtp-secret');
    expect(db.run).toHaveBeenCalledTimes(2);
  });

  it('refuses new encryption without MAIL_ENCRYPTION_KEY', () => {
    delete process.env.MAIL_ENCRYPTION_KEY;
    expect(() => encrypt('smtp-secret')).toThrow(/MAIL_ENCRYPTION_KEY/);
  });

  it('decrypts SMTP_PASS only for the internal mailer config', async () => {
    const secret = encrypt('smtp-secret')!;
    const db = { all: vi.fn().mockResolvedValue([{ key: 'SMTP_PASS', value: secret }]) };
    const config = await createMailer(db).getSystemConfig();
    expect(config.SMTP_PASS).toBe('smtp-secret');
    expect(secret).not.toBe(config.SMTP_PASS);
  });
});

describe('mail TLS policy', () => {
  it('verifies certificates by default', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.MAIL_ALLOW_INSECURE_TLS;
    expect(mailTlsOptions()).toEqual({ rejectUnauthorized: true });
  });

  it('rejects insecure TLS in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.MAIL_ALLOW_INSECURE_TLS = 'true';
    expect(mailTlsOptions).toThrow(/forbidden in production/);
  });

  it('allows insecure TLS only when explicitly enabled outside production and warns', () => {
    process.env.NODE_ENV = 'development';
    process.env.MAIL_ALLOW_INSECURE_TLS = 'true';
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mailTlsOptions()).toEqual({ rejectUnauthorized: false });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('verification is disabled'));
  });
});
