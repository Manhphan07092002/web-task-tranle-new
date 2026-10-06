import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiRoutes, invalidateAiKeyCache } from '../routes/ai.js';
import { encrypt } from '../utils/cryptoUtils.js';

const secret = 'provider-secret-test-key-123456789';

function appFor(user: { id: string; role: string; permissions: string[] }, db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use('/api/ai', aiRoutes(db));
  return app;
}

function dbWithStoredKey() {
  const encryptedKeys = encrypt(JSON.stringify([secret]));
  return {
    get: vi.fn(async (_sql: string, params?: string[]) => {
      if (params?.[0] === 'gemini_api_keys') return { value: encryptedKeys };
      if (!params) return { value: 'gemini' };
      return undefined;
    }),
  };
}

describe('AI configuration security', () => {
  beforeEach(() => vi.stubEnv('MAIL_ENCRYPTION_KEY', 'ai-config-test-encryption-key'));

  afterEach(() => {
    invalidateAiKeyCache();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('limits key status to admins and returns fingerprints, never configured secrets', async () => {
    const db = dbWithStoredKey();
    const employeeApp = appFor({ id: 'employee-1', role: 'Employee', permissions: [] }, db);
    await request(employeeApp).get('/api/ai/keys-status').expect(403);

    const adminApp = appFor({ id: 'admin-1', role: 'Admin', permissions: [] }, db);
    const response = await request(adminApp).get('/api/ai/keys-status').expect(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(secret);
    expect(Object.keys(response.body.statuses)).toEqual([expect.stringMatching(/^[a-f0-9]{12}$/)]);
    expect(response.body.statuses).not.toHaveProperty(secret);
  });

  it('requires admin and validates test-key input before making provider calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('should not call provider'));
    const db = dbWithStoredKey();
    await request(appFor({ id: 'employee-1', role: 'Employee', permissions: [] }, db))
      .post('/api/ai/test-key').send({ provider: 'openai', apiKey: secret }).expect(403);
    await request(appFor({ id: 'admin-1', role: 'Admin', permissions: [] }, db))
      .post('/api/ai/test-key').send({ provider: 'not-a-provider', apiKey: secret }).expect(400);
    await request(appFor({ id: 'admin-1', role: 'Admin', permissions: [] }, db))
      .post('/api/ai/test-key').send({ provider: 'openai', apiKey: 'short' }).expect(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
