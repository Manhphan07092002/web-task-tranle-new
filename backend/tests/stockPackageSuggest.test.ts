import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { stockRoutes } from '../routes/stock.js';
import { suggestPackages } from '../services/packageService.js';

/**
 * Gợi ý kiện khi lập phiếu xuất (§R3 FIFO/FEFO): thuật toán cộng dồn chạy trong
 * JS, còn thứ tự ứng viên do MySQL sắp. Test khóa cả hai — câu ORDER BY/WHERE
 * đúng nghiệp vụ và phần cộng dồn không bao giờ lấy quá phần khả dụng.
 */

const manager = { id: 'mgr', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
const director = { id: 'dir', role: 'Director', department: 'Ban', managementLevel: 40, permissions: [] };
const admin = { id: 'adm', role: 'Admin', department: 'IT', managementLevel: 99, permissions: [] };

const norm = (sql: unknown) => String(sql).trim().replace(/\s+/g, ' ');

/** SELECT luôn lấy pl.expiryDate để trả về FE, nên muốn kiểm tra thứ tự phải cắt riêng mệnh đề ORDER BY. */
const orderBy = (sql: string) => sql.slice(sql.indexOf('ORDER BY'));

const candidate = (id: string, packageCode: string, opts: Record<string, any> = {}) => ({
  packageId: id, packageCode, packageLineId: opts.packageLineId ?? `${id}-l1`, productId: 'p1',
  status: opts.status ?? 'IN_STOCK', warehouseId: 'wh-1', locationId: opts.locationId ?? null,
  qtyRemaining: opts.remaining ?? 10, qtyHeld: opts.held ?? 0,
  receivedAt: opts.receivedAt ?? '2026-01-01 08:00:00', createdAt: opts.createdAt ?? '2026-01-01 08:00:00',
  expiryDate: opts.expiryDate ?? null,
});

function suggestDb(opts: { rows?: any[]; product?: any } = {}) {
  const calls: [string, any[]][] = [];
  const db: any = {
    calls,
    sqlFor: (needle: string) => calls.find(([sql]) => sql.includes(needle))?.[0] ?? '',
    all: vi.fn(async (sql: string, params: any[] = []) => {
      const s = norm(sql);
      calls.push([s, params]);
      if (s.includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-1' }, { warehouseId: 'wh-2' }];
      if (s.includes('FROM stock_package_lines')) return opts.rows ?? [];
      return [];
    }),
    get: vi.fn(async (sql: string, params: any[] = []) => {
      const s = norm(sql);
      calls.push([s, params]);
      if (s.includes('FROM products')) return opts.product ?? { id: 'p1', suggestionRule: null };
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

const suggest = (db: any, args: any = {}) => suggestPackages(db, { productId: 'p1', warehouseId: 'wh-1', quantity: 6, ...args });

describe('suggestPackages — ứng viên và thứ tự', () => {
  it('chỉ nhận kiện đang nằm trong kho và chưa bị xuất hết', async () => {
    const db = suggestDb();
    await suggest(db);
    const sql = db.sqlFor('FROM stock_package_lines');
    expect(sql).toContain("WHERE pl.productId = ? AND p.warehouseId = ? AND p.status IN ('IN_STOCK', 'PARTIAL_ISSUED')");
    expect(db.calls[0][1]).toEqual(['p1', 'wh-1']);
    for (const skipped of ['HELD', 'PENDING', 'ISSUED', 'IN_TRANSIT', 'CANCELLED']) {
      expect(sql).not.toContain(`'${skipped}'`);
    }
  });

  it('FIFO: kiện đã mở trước, rồi receivedAt cũ nhất, NULL mốc xuống cuối', async () => {
    const db = suggestDb();
    await suggest(db, { rule: 'FIFO' });
    const order = orderBy(db.sqlFor('ORDER BY CASE WHEN p.status'));
    expect(order).toContain("CASE WHEN p.status = 'PARTIAL_ISSUED' THEN 0 ELSE 1 END");
    expect(order).toContain('CASE WHEN p.receivedAt IS NULL THEN 1 ELSE 0 END, p.receivedAt');
    expect(order).toContain('CASE WHEN p.createdAt IS NULL THEN 1 ELSE 0 END, p.createdAt');
    expect(order).toContain('p.id, pl.id');
    expect(order).not.toContain('pl.expiryDate');
  });

  it('FEFO: hết hạn sớm nhất trước, expiryDate NULL xuống cuối, vẫn dọn kiện đã mở', async () => {
    const db = suggestDb();
    await suggest(db, { rule: 'FEFO' });
    const order = db.sqlFor('ORDER BY CASE WHEN p.status');
    expect(order).toContain("CASE WHEN p.status = 'PARTIAL_ISSUED' THEN 0 ELSE 1 END");
    expect(order).toContain('CASE WHEN pl.expiryDate IS NULL THEN 1 ELSE 0 END, pl.expiryDate');
    expect(order).toContain('CASE WHEN p.receivedAt IS NULL THEN 1 ELSE 0 END, p.receivedAt');
  });

  it('mặc định là FIFO khi caller không truyền rule', async () => {
    const db = suggestDb();
    const out = await suggest(db, { rule: null });
    expect(out.rule).toBe('FIFO');
    expect(orderBy(db.sqlFor('ORDER BY CASE WHEN p.status'))).not.toContain('pl.expiryDate');
  });
});

describe('suggestPackages — cộng dồn số lượng', () => {
  it('trải nhiều kiện, không bao giờ lấy quá phần khả dụng của từng dòng', async () => {
    const db = suggestDb({ rows: [
      candidate('pkg-a', 'KIEN-A', { remaining: 4 }),
      candidate('pkg-b', 'KIEN-B', { remaining: 10 }),
    ] });
    const out = await suggest(db, { quantity: 6 });
    expect(out).toMatchObject({ rule: 'FIFO', requestedQty: 6, suggestedQty: 6, missingQty: 0, sufficient: true });
    expect(out.lines.map((line) => [line.packageCode, line.suggestedQty])).toEqual([['KIEN-A', 4], ['KIEN-B', 2]]);
    expect(out.lines[1].qtyAvailable).toBe(10);
  });

  it('trừ phần đang bị giữ (qtyHeld) khỏi lượng khả dụng', async () => {
    const db = suggestDb({ rows: [
      candidate('pkg-a', 'KIEN-A', { remaining: 10, held: 7 }),
      candidate('pkg-b', 'KIEN-B', { remaining: 10 }),
    ] });
    const out = await suggest(db, { quantity: 5 });
    expect(out.lines.map((line) => [line.packageCode, line.suggestedQty])).toEqual([['KIEN-A', 3], ['KIEN-B', 2]]);
    expect(out.sufficient).toBe(true);
  });

  it('bỏ dòng kiện đã bị giữ kín hoặc còn 0, không đưa vào gợi ý', async () => {
    const db = suggestDb({ rows: [
      candidate('pkg-full', 'KIEN-FULL', { remaining: 5, held: 5 }),
      candidate('pkg-empty', 'KIEN-EMPTY', { remaining: 0 }),
      candidate('pkg-ok', 'KIEN-OK', { remaining: 3 }),
    ] });
    const out = await suggest(db, { quantity: 3 });
    expect(out.lines.map((line) => line.packageCode)).toEqual(['KIEN-OK']);
  });

  it('thiếu hàng vẫn trả đủ thông tin: suggestedQty, missingQty, sufficient=false', async () => {
    const db = suggestDb({ rows: [
      candidate('pkg-a', 'KIEN-A', { remaining: 2 }),
      candidate('pkg-b', 'KIEN-B', { remaining: 3 }),
    ] });
    const out = await suggest(db, { quantity: 8 });
    expect(out).toMatchObject({ suggestedQty: 5, missingQty: 3, sufficient: false });
    expect(out.lines).toHaveLength(2);
  });

  it('dừng ngay khi đủ, không duyệt hết danh sách', async () => {
    const db = suggestDb({ rows: [
      candidate('pkg-a', 'KIEN-A', { remaining: 100 }),
      candidate('pkg-b', 'KIEN-B', { remaining: 100 }),
    ] });
    const out = await suggest(db, { quantity: 6 });
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].suggestedQty).toBe(6);
  });

  it('làm tròn theo DECIMAL(18,3), lệch do float không sinh ra 5.999999', async () => {
    const db = suggestDb({ rows: [
      candidate('pkg-a', 'KIEN-A', { remaining: 2.333 }),
      candidate('pkg-b', 'KIEN-B', { remaining: 2.333 }),
      candidate('pkg-c', 'KIEN-C', { remaining: 2.334 }),
    ] });
    const out = await suggest(db, { quantity: 7 });
    expect(out.lines.map((line) => line.suggestedQty)).toEqual([2.333, 2.333, 2.334]);
    expect(out.suggestedQty).toBe(7);
    expect(out.missingQty).toBe(0);
    expect(out.sufficient).toBe(true);
  });
});

describe('GET /packages/suggest', () => {
  const url = '/packages/suggest?productId=p1&warehouseId=wh-1&quantity=6';

  it('trả gợi ý kèm thông tin dòng phiếu cần để FE thêm dòng', async () => {
    const db = suggestDb({ rows: [candidate('pkg-a', 'KIEN-A', { remaining: 4, locationId: 'loc-1' })] });
    const res = await request(appFor(db)).get(url).expect(200);
    expect(res.body).toMatchObject({
      productId: 'p1', warehouseId: 'wh-1', rule: 'FIFO', requestedQty: 6, suggestedQty: 4, missingQty: 2, sufficient: false,
    });
    expect(res.body.lines[0]).toMatchObject({
      packageId: 'pkg-a', packageCode: 'KIEN-A', packageLineId: 'pkg-a-l1', productId: 'p1',
      status: 'IN_STOCK', locationId: 'loc-1', qtyAvailable: 4, suggestedQty: 4,
    });
  });

  it('lấy rule mặc định từ products.suggestionRule, ?rule= được ưu tiên', async () => {
    const withFefo = suggestDb({ product: { id: 'p1', suggestionRule: 'FEFO' } });
    await request(appFor(withFefo)).get(url).expect(200);
    expect(withFefo.sqlFor('ORDER BY CASE WHEN p.status')).toContain('pl.expiryDate');

    const overridden = suggestDb({ product: { id: 'p1', suggestionRule: 'FEFO' } });
    const res = await request(appFor(overridden)).get(`${url}&rule=FIFO`).expect(200);
    expect(res.body.rule).toBe('FIFO');
    expect(orderBy(overridden.sqlFor('ORDER BY CASE WHEN p.status'))).not.toContain('pl.expiryDate');
  });

  it('từ chối yêu cầu thiếu hiện ngữ thay vì gợi ý rỗng', async () => {
    const missingScope = await request(appFor(suggestDb())).get('/packages/suggest?quantity=6').expect(400);
    expect(missingScope.body.code).toBe('PACKAGE_INVALID');

    for (const bad of ['0', '-5', 'abc']) {
      const res = await request(appFor(suggestDb())).get(`/packages/suggest?productId=p1&warehouseId=wh-1&quantity=${bad}`).expect(400);
      expect(res.body.error).toContain('quantity');
    }
  });

  it('quyền kho áp dụng như các endpoint kiện khác: ngoài scope 403, Admin 403, Director tự do', async () => {
    await request(appFor(suggestDb())).get('/packages/suggest?productId=p1&warehouseId=wh-9&quantity=6').expect(403);
    await request(appFor(suggestDb(), admin)).get(url).expect(403);

    const asDirector = suggestDb();
    await request(appFor(asDirector, director)).get(url).expect(200);
    expect(asDirector.sqlFor('FROM stock_package_lines')).toContain('p.warehouseId = ?');
  });
});
