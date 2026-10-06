import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canAccessUploadedEntity, uploadRoutes } from '../routes/upload.js';

const secret = 'test-upload-auth-secret-with-at-least-32-chars';
const user = { id: 'owner-1', name: 'Owner', email: 'owner@example.test', role: 'Employee', department: 'Sales', avatar: '', permissions: [], isLocked: 0, lockedUntil: null, tokenVersion: 0 };

function uploadApp(db: any) {
  const app = express();
  app.use('/api/upload', uploadRoutes(db));
  return app;
}

function bearer() {
  return `Bearer ${jwt.sign({ sub: user.id, tokenVersion: user.tokenVersion }, secret, { algorithm: 'HS256' })}`;
}

afterEach(() => vi.unstubAllEnvs());

describe('private upload access controls', () => {
  it('requires authentication for the download endpoint', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    const db = { get: vi.fn() };
    await request(uploadApp(db)).get('/api/upload/files/0123456789abcdef01234567.pdf').expect(401);
    expect(db.get).not.toHaveBeenCalled();
  });

  it('denies another authenticated user access to an unlinked private file', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    const filename = '0123456789abcdef01234567.pdf';
    const currentFile = fileURLToPath(import.meta.url);
    const filePath = path.resolve(path.dirname(currentFile), '../../uploads/reports', filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '%PDF-1.7\n%%EOF');
    const db = {
      get: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT u.id')) return { ...user, permissions: '[]' };
        if (sql.includes('FROM uploaded_files')) return { filename, ownerId: 'someone-else', originalName: 'private.pdf', mimeType: 'application/pdf' };
        return undefined;
      }),
    };
    try {
      await request(uploadApp(db)).get(`/api/upload/files/${filename}`).set('Authorization', bearer()).expect(403);
    } finally {
      await fs.unlink(filePath).catch(() => {});
    }
  });

  it('allows the uploader and an authorized linked-entity viewer only', async () => {
    expect(await canAccessUploadedEntity({}, { ownerId: 'user-a' }, { id: 'user-a', permissions: [] })).toBe(true);
    const db = { get: vi.fn().mockResolvedValue({ createdBy: 'user-a', department: 'Sales', docAccountantUserId: null }) };
    const uploaded = { ownerId: 'user-a', entityType: 'contracts', entityId: 'contract-1' };
    expect(await canAccessUploadedEntity(db, uploaded, { id: 'user-b', department: 'Sales', permissions: [] })).toBe(true);
    expect(await canAccessUploadedEntity(db, uploaded, { id: 'user-b', department: 'Engineering', permissions: [] })).toBe(false);
  });

  it('rejects dangerous extensions and content that does not match an allowed magic type', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    const db = {
      get: vi.fn().mockResolvedValue({ ...user, permissions: '[]' }),
      run: vi.fn(),
    };
    const app = uploadApp(db);
    await request(app).post('/api/upload').set('Authorization', bearer())
      .attach('files', Buffer.from('not an executable'), { filename: 'payload.exe', contentType: 'application/pdf' })
      .expect(400);
    await request(app).post('/api/upload').set('Authorization', bearer())
      .attach('files', Buffer.from('not a pdf document'), { filename: 'fake.pdf', contentType: 'application/pdf' })
      .expect(400);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('stores a valid PDF privately with owner metadata and returns only the authorized API URL', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    const db = {
      get: vi.fn().mockResolvedValue({ ...user, permissions: '[]' }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    const response = await request(uploadApp(db)).post('/api/upload').set('Authorization', bearer())
      .attach('files', Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF'), { filename: 'report.pdf', contentType: 'image/png' })
      .expect(200);

    expect(response.body.files[0].url).toMatch(/^\/api\/upload\/files\/[a-f0-9]{24}\.pdf$/);
    expect(db.run.mock.calls[0][0]).toContain('ownerId, originalName, size, mimeType, entityType, entityId');
    expect(db.run.mock.calls[0][1][1]).toBe(user.id);
    const filename = db.run.mock.calls[0][1][0];
    const currentFile = fileURLToPath(import.meta.url);
    await fs.unlink(path.resolve(path.dirname(currentFile), '../../uploads/reports', filename)).catch(() => {});
  });
});
