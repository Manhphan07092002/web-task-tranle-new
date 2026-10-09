import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mailRoutes } from '../routes/mail.js';
import { connectImapMailbox } from '../utils/imapConnection.js';
import { decrypt } from '../utils/cryptoUtils.js';

vi.mock('../utils/imapConnection.js', () => ({ connectImapMailbox: vi.fn() }));

const jwtSecret = 'test-only-mail-connect-jwt-secret';
const userId = 'mail-test-user';
const credentials = { email: 'user@example.test', password: 'dummy"pass\\word@', provider: 'webmail' };
const connect = vi.mocked(connectImapMailbox);

function fixture() {
  const db = {
    get: vi.fn().mockResolvedValue({
      id: userId, name: 'Test', email: 'app-user@example.test', role: 'Employee', department: 'Sales',
      avatar: '', isLocked: 0, tokenVersion: 0, permissions: '[]',
    }),
    all: vi.fn().mockResolvedValue([]),
    run: vi.fn().mockResolvedValue({ changes: 1 }),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/mail', mailRoutes(db));
  const token = jwt.sign({ sub: userId, tokenVersion: 0 }, jwtSecret, { algorithm: 'HS256', expiresIn: '5m' });
  const post = (body = credentials) => request(app).post('/api/mail/connect').set('Authorization', `Bearer ${token}`).send(body);
  return { db, app, post };
}

describe('mail connect API', () => {
  beforeEach(() => {
    connect.mockReset();
    connect.mockResolvedValue({ close: vi.fn() } as any);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', jwtSecret);
    vi.stubEnv('MAIL_ENCRYPTION_KEY', 'test-only-mail-connect-encryption-key');
    vi.stubEnv('MAIL_ALLOW_INSECURE_TLS', 'false');
    vi.stubEnv('MAIL_ALLOWED_CUSTOM_HOSTS', 'mail.tranlecorp.com.vn');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('authenticates the full mailbox email before saving encrypted credentials', async () => {
    const { db, post } = fixture();
    const client = { close: vi.fn() };
    connect.mockImplementation(async () => {
      expect(db.run).not.toHaveBeenCalled();
      return client as any;
    });
    const response = await post().expect(200);
    expect(response.body).toMatchObject({ success: true });
    expect(connect).toHaveBeenCalledWith({
      host: 'mail.tranlecorp.com.vn', port: 993,
      email: credentials.email, password: credentials.password, allowUsernameFallback: false,
    });
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(db.run).toHaveBeenCalledTimes(1);
    const [sql, [encrypted, storedUserId]] = db.run.mock.calls[0];
    expect(sql).toBe('UPDATE users SET mailPassword = ? WHERE id = ?');
    expect(storedUserId).toBe(userId);
    expect(encrypted).toMatch(/^v2:/);
    expect(encrypted).not.toContain(credentials.password);
    expect(JSON.parse(decrypt(encrypted)!)).toMatchObject({
      ...credentials, imapHost: 'mail.tranlecorp.com.vn', imapPort: 993,
      smtpHost: 'mail.tranlecorp.com.vn', smtpPort: 465,
    });
    expect(response.text).not.toContain(credentials.password);
  });

  it.each([
    [{ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }, 502, 'MAIL_TLS_ERROR'],
    [{ code: 'CERT_HAS_EXPIRED' }, 502, 'MAIL_TLS_ERROR'],
    [{ code: 'ECONNREFUSED' }, 502, 'MAIL_CONNECTION_FAILED'],
    [{ code: 'ETIMEDOUT' }, 504, 'MAIL_TIMEOUT'],
    [{ authenticationFailed: true }, 401, 'MAIL_AUTH_FAILED'],
  ] as const)('maps upstream failure %j to HTTP %i / %s without leaking details', async (details, status, code) => {
    const { db, post } = fixture();
    connect.mockRejectedValue(Object.assign(new Error('private upstream credential detail'), details));
    const response = await post().expect(status);
    expect(response.body.code).toBe(code);
    expect(response.text).not.toContain('private upstream');
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private upstream');
    expect(db.run).not.toHaveBeenCalled();
  });

  it('reports successful authentication but failed persistence as a server error', async () => {
    const { db, post } = fixture();
    db.run.mockRejectedValue(new Error('private database detail'));
    const response = await post().expect(500);
    expect(response.body.code).toBe('MAIL_SAVE_FAILED');
    expect(response.text).not.toContain('private database');
  });

  it('does not contact the mailbox when the encryption key is missing', async () => {
    vi.stubEnv('MAIL_ENCRYPTION_KEY', '');
    const { db, post } = fixture();
    const response = await post().expect(503);
    expect(response.body.code).toBe('MAIL_CONFIG_ERROR');
    expect(connect).not.toHaveBeenCalled();
    expect(db.run).not.toHaveBeenCalled();
  });

  it('does not mislabel a configuration lookup failure as a password failure', async () => {
    const { db, post } = fixture();
    db.all.mockRejectedValue(new Error('private config detail'));
    const response = await post().expect(500);
    expect(response.body.code).toBe('MAIL_CONFIG_ERROR');
    expect(connect).not.toHaveBeenCalled();
  });

  it('requires app authentication before contacting the mail server', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, db } = fixture();
    await request(app).post('/api/mail/connect').send(credentials).expect(401);
    expect(connect).not.toHaveBeenCalled();
    expect(db.run).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it.each(['bad\r\nA2 LOGOUT', 'bad\0value'])('rejects unsafe password input before connecting', async (password) => {
    const { db, post } = fixture();
    await post({ ...credentials, password }).expect(400);
    expect(connect).not.toHaveBeenCalled();
    expect(db.run).not.toHaveBeenCalled();
  });

  it('keeps the eight-attempt limit and returns a usable retry deadline', async () => {
    const { post } = fixture();
    connect.mockRejectedValue({ authenticationFailed: true });
    for (let attempt = 0; attempt < 8; attempt++) await post().expect(401);
    const response = await post().expect(429);
    expect(response.body.code).toBe('MAIL_RATE_LIMITED');
    expect(response.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(response.body.retryAfterSeconds).toBeLessThanOrEqual(900);
    expect(Number(response.headers['retry-after'])).toBe(response.body.retryAfterSeconds);
    expect(connect).toHaveBeenCalledTimes(8);
  });
});
