import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { warehouseRoutes } from '../routes/warehouses.js';

const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
const nv = { id: 'nv', role: 'Employee', department: 'Kho', managementLevel: 10, permissions: [] };
const admin = { id: 'a', role: 'Admin', department: 'B', managementLevel: 99, permissions: ['admin_panel'] };

function appFor(user: any, db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(warehouseRoutes(db));
  return app;
}

function mockDb(opts: {
  warehouse?: any; dupCode?: any; docs?: any[]; moves?: any[]; balances?: any[];
  holds?: any[]; counts?: any[]; khoStaff?: any[]; warehouses?: any[];
} = {}) {
  const runs: string[] = [];
  const db: any = {
    runs,
    all: vi.fn(async (sql: string) => {
      if (String(sql).includes('FROM stock_documents')) return opts.docs ?? [];
      if (String(sql).includes('FROM stock_moves')) return opts.moves ?? [];
      if (String(sql).includes('FROM stock_balances')) return opts.balances ?? [];
      if (String(sql).includes('FROM reservations')) return opts.holds ?? [];
      if (String(sql).includes('FROM stock_counts')) return opts.counts ?? [];
      if (String(sql).includes('FROM users')) return opts.khoStaff ?? [];
      if (String(sql).includes('FROM warehouses')) return opts.warehouses ?? [];
      return [];
    }),
    get: vi.fn(async (sql: string, params?: any[]) => {
      if (String(sql).includes('FROM warehouses WHERE code')) return opts.dupCode;
      if (String(sql).includes('FROM warehouses WHERE id')) {
        return opts.warehouse && (!params || params[0] === opts.warehouse.id) ? opts.warehouse : undefined;
      }
      return undefined;
    }),
    run: vi.fn(async (sql: string) => { runs.push(sql); return { changes: 1 }; }),
  };
  return db;
}

describe('warehouse CRUD (TP+ only)', () => {
  it('creates warehouses with default locations and Kho staff scopes', async () => {
    const db = mockDb({ khoStaff: [{ id: 'nv013' }] });
    const res = await request(appFor(tp, db)).post('/')
      .send({ code: 'hn2', name: 'Kho Hà Nội 2', region: 'Bắc', address: 'Đông Anh' })
      .expect(201);
    expect(res.body.id).toMatch(/^wh-/);
    const sqls = db.runs;
    expect(sqls.some((s: string) => s.includes('INSERT INTO warehouses'))).toBe(true);
    const locInserts = sqls.filter((s: string) => s.includes('INSERT INTO stock_locations'));
    expect(locInserts).toHaveLength(1);
    expect(locInserts[0].split('?').length - 1).toBe(7 * 6);
    expect(sqls.some((s: string) => s.includes('INSERT IGNORE INTO user_warehouse_scopes'))).toBe(true);
    // code normalized to uppercase
    const calls = db.run.mock.calls as unknown as [string, any[]][];
    const whCall = calls.find(([s]) => String(s).includes('INSERT INTO warehouses'));
    expect(whCall?.[1]?.[1]).toBe('HN2');
  });

  it('rejects duplicate codes and invalid payloads', async () => {
    const db = mockDb({ dupCode: { id: 'wh-hn' } });
    await request(appFor(tp, db)).post('/').send({ code: 'HN', name: 'X' }).expect(409);
    await request(appFor(tp, db)).post('/').send({ code: '', name: '' }).expect(400);
  });

  it('blocks employees and Admin', async () => {
    const db = mockDb({});
    await request(appFor(nv, db)).post('/').send({ code: 'X', name: 'X' }).expect(403);
    await request(appFor(admin, db)).post('/').send({ code: 'X', name: 'X' }).expect(403);
    await request(appFor(nv, db)).put('/wh-hn').send({ name: 'X' }).expect(403);
    await request(appFor(nv, db)).delete('/wh-hn').expect(403);
  });

  it('updates warehouses and guards duplicate codes', async () => {
    const db = mockDb({ warehouse: { id: 'wh-hn', code: 'HN', name: 'Kho HN', region: 'Bắc', address: null, isActive: 1 } });
    await request(appFor(tp, db)).put('/wh-hn').send({ name: 'Kho Hà Nội Mới' }).expect(200);
    expect(db.runs.some((s: string) => s.includes('UPDATE warehouses SET'))).toBe(true);
    await request(appFor(tp, db)).put('/missing').send({ name: 'X' }).expect(404);
    const dbDup = mockDb({
      warehouse: { id: 'wh-hn', code: 'HN', name: 'Kho HN', region: null, address: null, isActive: 1 },
      dupCode: { id: 'wh-hcm' },
    });
    await request(appFor(tp, dbDup)).put('/wh-hn').send({ code: 'hcm', name: 'X' }).expect(409);
  });

  it('refuses to delete warehouses with live data', async () => {
    const cases = [
      mockDb({ warehouse: { id: 'w' }, docs: [{ kind: 'documents' }] }),
      mockDb({ warehouse: { id: 'w' }, moves: [{ productId: 'p' }] }),
      mockDb({ warehouse: { id: 'w' }, balances: [{ productId: 'p' }] }),
      mockDb({ warehouse: { id: 'w' }, holds: [{ id: 'r' }] }),
      mockDb({ warehouse: { id: 'w' }, counts: [{ id: 'c' }] }),
    ];
    for (const db of cases) {
      await request(appFor(tp, db)).delete('/w').expect(400);
      expect(db.runs.some((s: string) => s.includes('DELETE FROM'))).toBe(false);
    }
    await request(appFor(tp, mockDb({}))).delete('/missing').expect(404);
  });

  it('deletes empty warehouses with locations and scopes', async () => {
    const db = mockDb({ warehouse: { id: 'wh-old' } });
    await request(appFor(tp, db)).delete('/wh-old').expect(200);
    expect(db.runs.some((s: string) => s.includes('DELETE FROM stock_locations'))).toBe(true);
    expect(db.runs.some((s: string) => s.includes('DELETE FROM user_warehouse_scopes'))).toBe(true);
    expect(db.runs.some((s: string) => s.includes('DELETE FROM warehouses'))).toBe(true);
  });
});
