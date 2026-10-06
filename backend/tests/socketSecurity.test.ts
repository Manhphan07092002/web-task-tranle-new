import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  middleware: undefined as any,
  connection: undefined as any,
  options: undefined as any,
}));

vi.mock('socket.io', () => ({
  Server: class {
    constructor(_server: any, options: any) { harness.options = options; }
    use(callback: any) { harness.middleware = callback; }
    on(event: string, callback: any) { if (event === 'connection') harness.connection = callback; }
  },
}));

import { initSocket } from '../socket.js';

const secret = 'socket-test-secret-long-enough-for-signing-123456';
const issueToken = (payload: Record<string, unknown>) => jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: '5m' });

function runHandshake(token: string, db: any) {
  initSocket({} as any, db);
  const socket: any = { handshake: { auth: { token } }, data: {}, join: vi.fn(), on: vi.fn() };
  return new Promise<{ error?: Error; socket: any }>((resolve) => {
    harness.middleware(socket, (error?: Error) => resolve({ error, socket }));
  });
}

describe('Socket.IO security', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    harness.middleware = undefined;
    harness.connection = undefined;
    harness.options = undefined;
  });

  it('loads the authenticated user from DB and joins only that user room', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    vi.stubEnv('ALLOWED_ORIGIN', 'https://app.example.com, https://admin.example.com');
    const db = { get: vi.fn().mockResolvedValue({ id: 'db-user', isLocked: 0, lockedUntil: null, tokenVersion: 4 }) };
    const { error, socket } = await runHandshake(issueToken({ sub: 'db-user', tokenVersion: 4, id: 'attacker', role: 'Admin' }), db);

    expect(error).toBeUndefined();
    expect(socket.data.userId).toBe('db-user');
    expect(db.get).toHaveBeenCalledWith(expect.any(String), ['db-user']);
    expect(harness.options.cors.origin).toEqual(['https://app.example.com', 'https://admin.example.com']);
    harness.connection(socket);
    expect(socket.join).toHaveBeenCalledWith('db-user');
  });

  it('rejects legacy id claims, stale token versions, and temporarily locked users', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    const legacy = await runHandshake(issueToken({ id: 'user-1', tokenVersion: 0 }), { get: vi.fn() });
    expect(legacy.error).toBeTruthy();

    const stale = await runHandshake(issueToken({ sub: 'user-1', tokenVersion: 3 }), {
      get: vi.fn().mockResolvedValue({ id: 'user-1', isLocked: 0, lockedUntil: null, tokenVersion: 4 }),
    });
    expect(stale.error).toBeTruthy();

    const temporarilyLocked = await runHandshake(issueToken({ sub: 'user-1', tokenVersion: 4 }), {
      get: vi.fn().mockResolvedValue({ id: 'user-1', isLocked: 0, lockedUntil: new Date(Date.now() + 60_000).toISOString(), tokenVersion: 4 }),
    });
    expect(temporarilyLocked.error).toBeTruthy();
  });

  it('fails closed when production has no Socket.IO origin allowlist', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOWED_ORIGIN', '');
    expect(() => initSocket({} as any, { get: vi.fn() })).toThrow('ALLOWED_ORIGIN');
  });
});
