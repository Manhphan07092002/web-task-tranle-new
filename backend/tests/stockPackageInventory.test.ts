import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { stockRoutes } from '../routes/stock.js';
import { ON_HAND_PACKAGE_STATUSES, fetchPackageDrift } from '../services/packageService.js';

/**
 * AC9 "tồn SP = tồn rời + tồn kiện": /balances và /available-inventory expose
 * packagedQty/looseQty, /reconciliation expose packageDrift. Hai con số đều do
 * SQL tính, nên test khóa câu SQL (khớp khóa, danh sách trạng thái, bộ lọc scope
 * đẩy xuống subquery) chứ không chỉ khóa shape response.
 */

const manager = { id: 'mgr', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
const director = { id: 'dir', role: 'Director', department: 'Ban', managementLevel: 40, permissions: [] };
const admin = { id: 'adm', role: 'Admin', department: 'IT', managementLevel: 99, permissions: [] };

const norm = (sql: unknown) => String(sql).trim().replace(/\s+/g, ' ');

function readDb(opts: { scopes?: string[]; balances?: any[]; drift?: any[]; moves?: any[] } = {}) {
  const calls: [string, any[]][] = [];
  const db: any = {
    calls,
    sqlFor: (needle: string) => calls.find(([sql]) => sql.includes(needle))?.[0] ?? '',
    paramsFor: (needle: string) => calls.find(([sql]) => sql.includes(needle))?.[1] ?? [],
    touches: (needle: string) => calls.some(([sql]) => sql.includes(needle)),
    all: vi.fn(async (sql: string, params: any[] = []) => {
      const s = norm(sql);
      calls.push([s, params]);
      if (s.includes('FROM user_warehouse_scopes')) return (opts.scopes ?? ['wh-hn', 'wh-hcm']).map((id) => ({ warehouseId: id }));
      // /balances cũng JOIN stock_package_lines, nên phải bắt query ngoài cùng trước.
      if (s.includes('FROM stock_balances b')) return opts.balances ?? [];
      if (s.includes('FROM stock_package_lines')) return opts.drift ?? [];
      if (s.includes('FROM stock_moves')) return opts.moves ?? [];
      return [];
    }),
    get: vi.fn(async (sql: string, params: any[] = []) => {
      const s = norm(sql);
      calls.push([s, params]);
      if (s.includes('COUNT(*) AS total')) return { total: 0 };
      return undefined;
    }),
    run: vi.fn(async () => ({ changes: 1 })),
  };
  return db;
}

function appFor(db: any, user: any = manager) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(stockRoutes(db));
  return app;
}

describe('packagedQty / looseQty trên tồn kho', () => {
  it('/balances nối kiện theo đúng (sản phẩm, kho, vị trí) và trừ ra looseQty', async () => {
    const db = readDb({ balances: [{ productId: 'p1', warehouseId: 'wh-hn', locationId: '', onHand: 12, packagedQty: 10, looseQty: 2 }] });
    const res = await request(appFor(db)).get('/balances?warehouseId=wh-hn').expect(200);
    expect(res.body[0]).toMatchObject({ packagedQty: 10, looseQty: 2 });

    const sql = db.sqlFor('FROM stock_balances b');
    expect(sql).toContain('SELECT pl.productId, p.warehouseId, COALESCE(p.locationId, \'\') AS locationId, SUM(pl.qtyRemaining) AS packagedQty');
    expect(sql).toContain("ON pkg.productId = b.productId AND pkg.warehouseId = b.warehouseId AND pkg.locationId = COALESCE(b.locationId, '')");
    expect(sql).toContain('COALESCE(pkg.packagedQty, 0) AS packagedQty');
    expect(sql).toContain('b.onHand - COALESCE(pkg.packagedQty, 0) AS looseQty');
  });

  it('chỉ kiện còn trong kho được tính; PENDING/ISSUED/IN_TRANSIT/CANCELLED loại khỏi tổng', async () => {
    const db = readDb();
    await request(appFor(db)).get('/balances').expect(200);
    const sql = db.sqlFor('FROM stock_balances b');
    expect(ON_HAND_PACKAGE_STATUSES).toEqual(['IN_STOCK', 'HELD', 'PARTIAL_ISSUED']);
    for (const status of ON_HAND_PACKAGE_STATUSES) expect(sql).toContain(`'${status}'`);
    for (const excluded of ['\'PENDING\'', '\'ISSUED\'', '\'IN_TRANSIT\'', '\'CANCELLED\'']) expect(sql).not.toContain(excluded);
  });

  it('scope kho vẫn là bộ lọc ngoài cùng — kiện không được nới quyền xem', async () => {
    const scoped = readDb();
    await request(appFor(scoped)).get('/balances').expect(200);
    const sql = scoped.sqlFor('FROM stock_balances b');
    expect(sql).toContain('AND b.warehouseId IN (?, ?)');
    expect(scoped.paramsFor('FROM stock_balances b')).toEqual(['wh-hn', 'wh-hcm', 500, 0]);

    const unscoped = readDb({ scopes: [] });
    await request(appFor(unscoped)).get('/balances').expect(200, []);
    expect(unscoped.touches('FROM stock_balances')).toBe(false);

    await request(appFor(readDb(), admin)).get('/balances').expect(403);
  });

  it('/available-inventory gộp packagedQty mọi vị trí trong kho, vẫn giữ HAVING available > 0', async () => {
    const db = readDb();
    await request(appFor(db)).get('/available-inventory?warehouseId=wh-hn').expect(200);
    const sql = db.sqlFor('FROM stock_balances b');
    expect(sql).toContain('SELECT pl.productId, p.warehouseId, SUM(pl.qtyRemaining) AS packagedQty');
    expect(sql).toContain('ON pkg.productId = b.productId AND pkg.warehouseId = b.warehouseId');
    // packagedQty đã gộp theo (product, kho) nên một giá trị cho cả nhóm → MAX là đủ.
    expect(sql).toContain('COALESCE(MAX(pkg.packagedQty), 0) AS packagedQty');
    expect(sql).toContain('SUM(b.onHand) - COALESCE(MAX(pkg.packagedQty), 0) AS looseQty');
    expect(sql).toContain('HAVING available > 0');
    expect(db.sqlFor('COUNT(*) AS total')).toContain('FROM stock_balances b');
  });
});

describe('packageDrift trong /reconciliation', () => {
  it('so tổng kiện với onHand cùng mã hàng/kho và bắt dòng kiện tự mâu thuẫn', async () => {
    const db = readDb();
    await fetchPackageDrift(db, { warehouseId: 'wh-hn', productId: 'p1' });
    const sql = db.sqlFor('FROM stock_package_lines');
    expect(sql).toContain('SUM(pl.qtyRemaining) AS packagedQty');
    expect(sql).toContain('CASE WHEN pl.qtyRemaining > pl.qtyInitial THEN 1 ELSE 0 END) AS overInitialLines');
    expect(sql).toContain('CASE WHEN pl.qtyHeld > pl.qtyRemaining THEN pl.qtyHeld - pl.qtyRemaining ELSE 0 END) AS heldOverQty');
    expect(sql).toContain('WHERE pkg.packagedQty - COALESCE(bal.onHand, 0) > 0.000001');
    expect(sql).toContain('OR pkg.overInitialLines > 0 OR pkg.heldOverQty > 0.000001');
    expect(db.paramsFor('FROM stock_package_lines')).toEqual(['wh-hn', 'p1', 'wh-hn', 'p1']);
  });

  it('trả kèm packageDrift mà không đổi shape rows/total cũ', async () => {
    const drift = [{ productId: 'p1', warehouseId: 'wh-hn', packagedQty: 14, onHand: 12, excessQty: 2, overInitialLines: 0, heldOverQty: 0 }];
    const db = readDb({ drift, moves: [] });
    const res = await request(appFor(db)).get('/reconciliation').expect(200);
    expect(res.body).toEqual({ rows: [], total: 0, packageDrift: drift });
    expect(db.sqlFor('FROM stock_package_lines')).toContain('p.warehouseId IN (?, ?)');
    expect(db.sqlFor('SUM(onHand) AS onHand')).toContain('FROM stock_balances WHERE warehouseId IN (?, ?)');
  });

  it('lọc theo một kho thì cả hai subquery chỉ quét kho đó', async () => {
    const db = readDb();
    await request(appFor(db)).get('/reconciliation?warehouseId=wh-hn&productId=p1').expect(200);
    expect(db.paramsFor('FROM stock_package_lines')).toEqual(['wh-hn', 'p1', 'wh-hn', 'p1']);
  });

  it('Director không bị giam scope, Admin vẫn bị chặn, user không scope không chạm bảng kiện', async () => {
    const asDirector = readDb();
    await request(appFor(asDirector, director)).get('/reconciliation').expect(200);
    expect(asDirector.sqlFor('FROM stock_package_lines')).not.toContain('p.warehouseId IN');

    await request(appFor(readDb(), admin)).get('/reconciliation').expect(403);

    const none = readDb({ scopes: [] });
    const res = await request(appFor(none)).get('/reconciliation').expect(200);
    expect(res.body).toEqual({ rows: [], total: 0, packageDrift: [] });
    expect(none.touches('FROM stock_package_lines')).toBe(false);
  });
});
