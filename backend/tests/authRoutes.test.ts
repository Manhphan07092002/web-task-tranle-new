import express from 'express';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { authRoutes } from '../routes/auth.js';

describe('login failure behavior', () => {
  it('uses the same response for unknown, locked, and incorrect credentials', async () => {
    const passwordHash = await bcrypt.hash('CorrectPassword1', 4);
    const db = {
      get: vi.fn(async (_sql: string, [email]: string[]) => {
        if (email === 'missing@example.com') return undefined;
        return {
          id: 'user-1', email, password: passwordHash, failedLogins: 14,
          lockedUntil: email === 'locked@example.com' ? new Date(Date.now() + 60_000).toISOString() : null,
          isLocked: 0, tokenVersion: 7,
        };
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    const app = express();
    app.use(express.json());
    app.use(authRoutes(db));

    const responses = await Promise.all([
      request(app).post('/login').send({ email: 'missing@example.com', password: 'WrongPassword1' }),
      request(app).post('/login').send({ email: 'locked@example.com', password: 'WrongPassword1' }),
      request(app).post('/login').send({ email: 'user@example.com', password: 'WrongPassword1' }),
    ]);

    expect(responses.map(({ status, body }) => [status, body])).toEqual(
      Array(3).fill([401, { error: 'Invalid credentials' }]),
    );
    expect(db.run.mock.calls.every(([sql]) => !String(sql).includes('failedLogins ='))).toBe(true);
  });

  it('does not allow successful credentials to bypass a manual account lock', async () => {
    const passwordHash = await bcrypt.hash('CorrectPassword1', 4);
    const db = {
      get: vi.fn().mockResolvedValue({
        id: 'user-1', email: 'user@example.com', password: passwordHash,
        lockedUntil: null, isLocked: 1, tokenVersion: 7,
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    const app = express();
    app.use(express.json());
    app.use(authRoutes(db));

    await request(app).post('/login')
      .send({ email: 'user@example.com', password: 'CorrectPassword1' })
      .expect(401, { error: 'Invalid credentials' });
  });
});
