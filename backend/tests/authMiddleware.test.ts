import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequireAuth, requireAdmin } from '../middleware/auth.js';

const secret = 'test-only-auth-secret-with-sufficient-randomness-1234567890';

function authApp(db: any, token: string) {
  const app = express();
  app.use((req, _res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use(createRequireAuth(db));
  app.get('/', (req: any, res) => res.json(req.user));
  app.get('/admin', requireAdmin, (_req, res) => res.json({ success: true }));
  return app;
}

function issueToken(payload: Record<string, unknown>) {
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: '5m' });
}

describe('database-backed authentication', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('uses current database identity and permissions instead of token claims', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    const token = issueToken({ sub: 'user-1', tokenVersion: 3, role: 'Admin', permissions: ['admin_panel'], department: 'Other' });
    const db = { get: vi.fn().mockResolvedValue({
      id: 'user-1', name: 'Employee', email: 'employee@example.com', role: 'Employee', department: 'Sales',
      avatar: null, isLocked: 0, lockedUntil: null, tokenVersion: 3, permissions: '[]',
    }) };

    const app = authApp(db, token);
    const identity = await request(app).get('/').expect(200);
    expect(identity.body).toMatchObject({ id: 'user-1', role: 'Employee', department: 'Sales', permissions: [] });
    await request(app).get('/admin').expect(403);
  });

  it('rejects missing subject and legacy identity claims instead of skipping database identity lookup', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    const db = { get: vi.fn() };
    const app = authApp(db, issueToken({ id: 'user-1', tokenVersion: 0, role: 'Admin' }));
    await request(app).get('/').expect(401);
    expect(db.get).not.toHaveBeenCalled();
  });

  it('rejects revoked, locked, and temporarily locked accounts', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    const token = issueToken({ sub: 'user-1', tokenVersion: 2 });
    const revokedApp = authApp({ get: vi.fn().mockResolvedValue({ id: 'user-1', isLocked: 0, tokenVersion: 3 }) }, token);
    await request(revokedApp).get('/').expect(401);

    const lockedApp = authApp({ get: vi.fn().mockResolvedValue({ id: 'user-1', isLocked: 1, tokenVersion: 2 }) }, token);
    await request(lockedApp).get('/').expect(401);

    const temporarilyLockedApp = authApp({ get: vi.fn().mockResolvedValue({
      id: 'user-1', isLocked: 0, lockedUntil: new Date(Date.now() + 60_000).toISOString(), tokenVersion: 2,
    }) }, token);
    await request(temporarilyLockedApp).get('/').expect(401);
  });

  it('fails closed when the database identity lookup fails', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const token = issueToken({ sub: 'user-1', tokenVersion: 0, role: 'Admin' });
    const app = authApp({ get: vi.fn().mockRejectedValue(new Error('database unavailable')) }, token);

    await request(app).get('/').expect(401);
  });
});
