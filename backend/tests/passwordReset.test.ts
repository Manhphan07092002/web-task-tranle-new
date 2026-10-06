import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authRoutes, forgotPasswordRoutes } from '../routes/auth.js';

const validToken = 'reset-token-' + 'a'.repeat(60);

function appFor(db: any) {
  const app = express();
  app.use(express.json());
  app.use(forgotPasswordRoutes(db, {}));
  return app;
}

describe('password reset token handling', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('looks up only the token hash, atomically consumes it, and revokes existing sessions', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({ id: 'reset-1', userId: 'user-1', email: 'user@example.com', expiresAt: new Date(Date.now() + 60_000).toISOString(), usedAt: null }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };

    await request(appFor(db)).post('/reset-password')
      .send({ token: validToken, newPassword: 'StrongPassword1' })
      .expect(200);

    const expectedHash = crypto.createHash('sha256').update(validToken).digest('hex');
    expect(db.get.mock.calls[0][0]).toContain('WHERE tokenHash = ?');
    expect(db.get.mock.calls[0][0]).not.toContain('OR token = ?');
    expect(db.get.mock.calls[0][1]).toEqual([expectedHash]);
    expect(db.run.mock.calls[0][0]).toBe('START TRANSACTION');
    expect(db.run.mock.calls[1][0]).toContain('usedAt IS NULL AND expiresAt >= ?');
    const passwordUpdate = db.run.mock.calls.find(([sql]) => String(sql).includes('UPDATE users SET password'));
    expect(passwordUpdate?.[0]).toContain('tokenVersion = tokenVersion + 1');
    expect(await bcrypt.compare('StrongPassword1', passwordUpdate?.[1][0])).toBe(true);
    expect(db.run.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM password_reset_tokens WHERE userId = ? AND usedAt IS NULL'))).toBe(true);
    expect(db.run.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('does not update the password when another request already consumed the token', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({ id: 'reset-1', userId: 'user-1', email: 'user@example.com', expiresAt: new Date(Date.now() + 60_000).toISOString(), usedAt: null }),
      run: vi.fn(async (sql: string) => sql === 'UPDATE password_reset_tokens SET usedAt = ? WHERE id = ? AND usedAt IS NULL AND expiresAt >= ?' ? { changes: 0 } : { changes: 1 }),
    };

    await request(appFor(db)).post('/reset-password')
      .send({ token: validToken, newPassword: 'StrongPassword1' })
      .expect(400);
    expect(db.run.mock.calls.some(([sql]) => String(sql) === 'ROLLBACK')).toBe(true);
    expect(db.run.mock.calls.some(([sql]) => String(sql).includes('UPDATE users SET password'))).toBe(false);
  });

  it('rolls back token consumption when updating the password fails', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({ id: 'reset-1', userId: 'user-1', email: 'user@example.com', expiresAt: new Date(Date.now() + 60_000).toISOString(), usedAt: null }),
      run: vi.fn(async (sql: string) => {
        if (sql.includes('UPDATE users SET password')) throw new Error('database write failed');
        return { changes: 1 };
      }),
    };

    await request(appFor(db)).post('/reset-password')
      .send({ token: validToken, newPassword: 'StrongPassword1' })
      .expect(500);

    expect(db.run.mock.calls.some(([sql]) => String(sql) === 'ROLLBACK')).toBe(true);
    expect(db.run.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(false);
  });

  it('validates reset tokens without returning account email', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({ userId: 'user-1', email: 'private@example.com', expiresAt: new Date(Date.now() + 60_000).toISOString(), usedAt: null }),
      run: vi.fn(),
    };

    const response = await request(appFor(db)).get(`/reset-password/${validToken}`).expect(200);
    expect(response.body.email).toBeUndefined();
    expect(response.body).toEqual({ success: true, expiresAt: expect.any(String) });
  });

  it('rejects malformed reset payloads before querying for a token', async () => {
    const db = { get: vi.fn(), run: vi.fn() };
    await request(appFor(db)).post('/reset-password')
      .send({ token: validToken, newPassword: '      ' })
      .expect(400);
    expect(db.get).not.toHaveBeenCalled();
    expect(db.run).not.toHaveBeenCalled();
  });

  it('rate-limits verification attempts by IP and the email bound to the token', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({ email: 'user@example.com', expiresAt: new Date(Date.now() + 60_000).toISOString(), usedAt: null }),
      run: vi.fn(),
    };
    const app = appFor(db);
    for (let attempt = 0; attempt < 5; attempt++) {
      await request(app).get(`/reset-password/${validToken}`).expect(200);
    }
    await request(app).get(`/reset-password/${validToken}`).expect(429);
  });

  it('invalidates pending reset links after an authenticated password change', async () => {
    const secret = 'test-password-reset-auth-secret-1234567890';
    vi.stubEnv('JWT_SECRET', secret);
    const oldPassword = await bcrypt.hash('OldPassword1', 4);
    const db = {
      get: vi.fn(async (sql: string) => sql.includes('SELECT u.id')
        ? { id: 'user-1', name: 'User', email: 'user@example.com', role: 'Employee', department: 'Sales', isLocked: 0, lockedUntil: null, tokenVersion: 4, permissions: '[]' }
        : { id: 'user-1', password: oldPassword }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.headers.authorization = `Bearer ${jwt.sign({ sub: 'user-1', tokenVersion: 4 }, secret, { expiresIn: '5m' })}`;
      next();
    });
    app.use(authRoutes(db));

    await request(app).post('/change-password')
      .send({ currentPassword: 'OldPassword1', newPassword: 'NewPassword1' })
      .expect(200);
    expect(db.run.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM password_reset_tokens WHERE userId = ? AND usedAt IS NULL'))).toBe(true);
  });
});
