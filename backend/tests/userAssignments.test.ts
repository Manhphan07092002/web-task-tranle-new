import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { userRoutes } from '../routes/users.js';

const manager = { id: 'mgr-1', role: 'Manager', permissions: ['manage_users'] };
const employee = { id: 'nv-1', role: 'Employee', permissions: [] };

function appFor(db: any, user: any = manager) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(userRoutes(db, {}));
  return app;
}

describe('GET /:id/assignments (user_assignments, added to bootstrap DDL)', () => {
  it('returns assignments with boolean isPrimary', async () => {
    const rows = [
      { id: 'a1', departmentId: 'd1', departmentName: 'Kho vận', title: 'NV', isPrimary: 1, confirmationStatus: 'ok', effectiveFrom: '2026-01-01', note: null },
      { id: 'a2', departmentId: 'd2', departmentName: 'KD', title: 'TV', isPrimary: 0, confirmationStatus: 'ok', effectiveFrom: null, note: '' },
    ];
    const db = { all: vi.fn(async () => rows) };
    const res = await request(appFor(db)).get('/u1/assignments').expect(200);
    expect(res.body).toEqual([
      { ...rows[0], isPrimary: true },
      { ...rows[1], isPrimary: false },
    ]);
    const calls = db.all.mock.calls as unknown as [string, any[]][];
    expect(calls[0][0]).toContain('FROM user_assignments');
  });

  it('rejects without manage_users permission', async () => {
    const db = { all: vi.fn(async () => []) };
    await request(appFor(db, employee)).get('/u1/assignments').expect(403);
    expect(db.all).not.toHaveBeenCalled();
  });

  it('returns [] when the table is missing (DBs created before the DDL fix)', async () => {
    const db = { all: vi.fn(async () => { throw new Error("Table 'x.user_assignments' doesn't exist"); }) };
    await request(appFor(db)).get('/u1/assignments').expect(200, []);
  });
});
