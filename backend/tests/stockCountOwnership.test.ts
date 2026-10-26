import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { stockRoutes } from '../routes/stock.js';

const nvA = { id: 'nv-a', role: 'Employee', department: 'Kho', managementLevel: 10, permissions: [] };
const nvB = { id: 'nv-b', role: 'Employee', department: 'Kho', managementLevel: 10, permissions: [] };
const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };

const OPEN = { id: 'c1', warehouseId: 'wh-hn', status: 'COUNTING', blindCount: 1 };

function appFor(user: any, db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(stockRoutes(db));
  return app;
}

function db(existingLine: any) {
  const calls: [string, any[]][] = [];
  return {
    calls,
    mock: {
      all: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }];
        return [];
      }),
      get: vi.fn(async (sql: string, params?: any[]) => {
        if (String(sql).includes('FROM products')) return { id: params?.[0] };
        if (String(sql).includes('FROM stock_counts')) return OPEN;
        if (String(sql).includes('FROM stock_count_lines')) return existingLine;
        if (String(sql).includes('FROM stock_balances')) return { onHand: 5, reserved: 0 };
        return undefined;
      }),
      run: vi.fn(async (sql: string, params?: any[]) => { calls.push([String(sql), params ?? []]); return { changes: 1 }; }),
    } as any,
  };
}

const submit = (user: any, d: ReturnType<typeof db>) =>
  request(appFor(user, d.mock)).post('/counts/c1/lines').send({ lines: [{ productId: 'p1', actualQty: 9 }] });

const wroteLine = (d: ReturnType<typeof db>) =>
  d.calls.some(([sql]) => sql.includes('INSERT INTO stock_count_lines'));

describe('stock count line ownership', () => {
  it('refuses to let another employee overwrite a counted line', async () => {
    const d = db({ id: 'l1', actualQty: 5, countedBy: 'nv-a' });
    const res = await submit(nvB, d);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('người đã đếm');
    expect(wroteLine(d)).toBe(false);
    expect(d.calls.some(([sql]) => sql.includes('COMMIT'))).toBe(false);
    expect(d.calls.some(([sql]) => sql.includes('ROLLBACK'))).toBe(true);
  });

  it('lets the counter amend their own line', async () => {
    const d = db({ id: 'l1', actualQty: 5, countedBy: 'nv-a' });
    await submit(nvA, d).expect(200);
    expect(wroteLine(d)).toBe(true);
  });

  it('lets a warehouse manager amend anyone line', async () => {
    const d = db({ id: 'l1', actualQty: 5, countedBy: 'nv-a' });
    await submit(tp, d).expect(200);
    expect(wroteLine(d)).toBe(true);
  });

  it('lets any employee take a line nobody has counted yet', async () => {
    const d = db({ id: 'l1', actualQty: null, countedBy: null });
    await submit(nvB, d).expect(200);
    expect(wroteLine(d)).toBe(true);
  });
});
