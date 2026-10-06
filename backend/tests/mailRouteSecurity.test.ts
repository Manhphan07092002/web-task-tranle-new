import express from 'express';
import tls from 'tls';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mailRoutes } from '../routes/mail.js';

const jwtSecret = 'mail-route-security-test-secret-with-sufficient-entropy';
const userId = 'mail-user-1';

function makeApp(db: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/mail', mailRoutes(db));
  return app;
}

function token() {
  return jwt.sign({ sub: userId, tokenVersion: 0 }, jwtSecret, { algorithm: 'HS256', expiresIn: '5m' });
}

describe('mail route security boundaries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('blocks private system-configured mail endpoints before opening a TLS connection', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', jwtSecret);
    vi.stubEnv('MAIL_ALLOWED_CUSTOM_HOSTS', '');
    const db = {
      get: vi.fn(async () => ({
        id: userId, name: 'Mail User', email: 'user@example.test', role: 'Employee', department: 'Sales',
        avatar: '', isLocked: 0, lockedUntil: null, tokenVersion: 0, permissions: '[]',
      })),
      all: vi.fn(async () => [
        { key: 'IMAP_HOST', value: '169.254.169.254' },
        { key: 'IMAP_PORT', value: '993' },
        { key: 'SMTP_HOST', value: '127.0.0.1' },
        { key: 'SMTP_PORT', value: '587' },
      ]),
      run: vi.fn(),
    };
    const tlsConnect = vi.spyOn(tls, 'connect');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await request(makeApp(db)).post('/api/mail/connect')
      .set('Authorization', `Bearer ${token()}`)
      .send({ email: 'user@example.test', password: 'mail-password' })
      .expect(401);

    expect(tlsConnect).not.toHaveBeenCalled();
    expect(db.run).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
  });
});
