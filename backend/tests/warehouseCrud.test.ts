import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { warehouseRoutes } from '../routes/warehouses.js';

const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
const nv = { id: 'nv', role: 'Employee', department: 'Kho', managementLevel: 10, permissions: [] };
const admin = { id: 'a', role: 'Admin', department: 'B', managementLevel: 99, permissions: ['admin_panel'] };
const director = { id: 'gd', role: 'Director', department: 'BQL', managementLevel: 40, permissions: [] };

const CATALOG = [
  { id: 'w1', code: 'HN', name: 'Kho Hà Nội', region: 'Bắc', address: null, isActive: 1 },
  { id: 'w2', code: 'HCM', name: 'Kho Sài Gòn', region: 'Nam', address: null, isActive: 1 },
];

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
  scopes?: string[]; serials?: any[]; lots?: any[]; policies?: any[]; misaMappings?: any[];
} = {}) {
  const runs: string[] = [];
  const db: any = {
    runs,
    all: vi.fn(async (sql: string, params: any[] = []) => {
      if (String(sql).includes('FROM user_warehouse_scopes')) return (opts.scopes ?? []).map((warehouseId) => ({ warehouseId }));
      if (String(sql).includes('FROM stock_documents')) return opts.docs ?? [];
      if (String(sql).includes('FROM stock_moves')) return opts.moves ?? [];
      if (String(sql).includes('FROM stock_balances')) return opts.balances ?? [];
      if (String(sql).includes('FROM reservations')) return opts.holds ?? [];
      if (String(sql).includes('FROM stock_counts')) return opts.counts ?? [];
      if (String(sql).includes('FROM stock_serials')) return opts.serials ?? [];
      if (String(sql).includes('FROM stock_lots')) return opts.lots ?? [];
      if (String(sql).includes('FROM product_warehouse_policies')) return opts.policies ?? [];
      if (String(sql).includes('FROM misa_mappings')) return opts.misaMappings ?? [];
      if (String(sql).includes('FROM users')) return opts.khoStaff ?? [];
      if (String(sql).includes('FROM warehouses')) {
        const all = opts.warehouses ?? [];
        return String(sql).includes('WHERE id IN') ? all.filter((w: any) => params.includes(w.id)) : all;
      }
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
    // Guard đã chắc mọi dòng tồn bằng 0; xóa nốt để không còn row mồ côi.
    expect(db.runs.some((s: string) => s === 'DELETE FROM stock_balances WHERE warehouseId = ?')).toBe(true);
  });

  it.each([
    { name: 'serials', opts: { serials: [{ id: 's1' }] } },
    { name: 'lots', opts: { lots: [{ id: 'lot1' }] } },
    { name: 'stock policies', opts: { policies: [{ productId: 'p1' }] } },
    { name: 'MISA mappings', opts: { misaMappings: [{ id: 'm1' }] } },
  ])('refuses to delete a warehouse that still has $name', async ({ opts }) => {
    const db = mockDb({ warehouse: { id: 'w' }, ...opts });
    const res = await request(appFor(tp, db)).delete('/w').expect(400);
    expect(db.runs.some((s: string) => s.includes('DELETE FROM'))).toBe(false);
    expect(res.body.error).toContain('không thể xóa');
  });
});

describe('warehouse catalog scope', () => {
  it('lists only the warehouses assigned to the user', async () => {
    const db = mockDb({ warehouses: CATALOG, scopes: ['w1'] });
    const res = await request(appFor(nv, db)).get('/').expect(200);
    expect(res.body.map((w: any) => w.id)).toEqual(['w1']);
    const query = db.all.mock.calls.find(([s]: [string, any[]]) => String(s).includes('FROM warehouses'));
    expect(query?.[0]).toContain('WHERE id IN (?)');
    expect(query?.[1]).toEqual(['w1']);
  });

  it('lists nothing for staff without a warehouse scope', async () => {
    const db = mockDb({ warehouses: CATALOG });
    const res = await request(appFor(nv, db)).get('/').expect(200);
    expect(res.body).toEqual([]);
    expect(db.all.mock.calls.some(([s]: [string, any[]]) => String(s).includes('FROM warehouses'))).toBe(false);
  });

  it('lists the full catalog for Director and Admin', async () => {
    // Admin không có business scope (D4) nhưng UI gán scope cho nhân sự
    // (UserManagement) phải đọc được danh mục kho.
    for (const user of [director, admin]) {
      const db = mockDb({ warehouses: CATALOG });
      const res = await request(appFor(user, db)).get('/').expect(200);
      expect(res.body.map((w: any) => w.id), user.role).toEqual(['w1', 'w2']);
      const query = db.all.mock.calls.find(([s]: [string, any[]]) => String(s).includes('FROM warehouses'));
      expect(query?.[0], user.role).not.toContain('WHERE id IN');
    }
  });

  it('requires authentication', async () => {
    const app = express();
    app.use(warehouseRoutes(mockDb({ warehouses: CATALOG })));
    await request(app).get('/').expect(401);
  });
});
