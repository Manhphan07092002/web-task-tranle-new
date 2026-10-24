import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { stockRoutes } from '../routes/stock.js';

const director = { id: 'd', role: 'Director', department: 'B', managementLevel: 40, permissions: [] };

function appFor(user: any, db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(stockRoutes(db));
  return app;
}

describe('stock report summary', () => {
  it('aggregates slow stock without referring to a derived-table alias in HAVING', async () => {
    const calls: { sql: string; params?: any[] }[] = [];
    const db = {
      all: vi.fn(async (sql: string, params?: any[]) => {
        calls.push({ sql, params });
        if (String(sql).includes('FROM warehouses')) return [{ id: 'wh-hn' }];
        if (String(sql).includes('DATE(m.createdAt)')) return [{ day: '2026-10-01', inbound: 5, outbound: 2 }];
        return [];
      }),
      get: vi.fn(async (sql: string, params?: any[]) => {
        calls.push({ sql, params });
        if (String(sql).includes('AS inbound')) {
          return { inbound: 5, outbound: 2, adjustment: 0, inboundDocuments: 1, outboundDocuments: 1 };
        }
        if (String(sql).includes('AS onHand')) return { onHand: 10, reserved: 2, stockValue: 100 };
        if (String(sql).includes('slow_rows')) return { count: 1 };
        return undefined;
      }),
    };

    const res = await request(appFor(director, db))
      .get('/reports/summary?from=2026-09-23T00:00:00.000Z&to=2026-10-23T00:00:00.000Z')
      .expect(200);

    expect(res.body.totals).toMatchObject({
      inbound: 5, outbound: 2, adjustment: 0, inboundDocuments: 1, outboundDocuments: 1,
      onHand: 10, reserved: 2, stockValue: 100, slowCount: 1,
    });
    expect(res.body.daily).toEqual([{ day: '2026-10-01', inbound: 5, outbound: 2 }]);

    const slow = calls.find((call) => call.sql.includes('slow_rows'));
    expect(slow?.sql).toContain('MAX(m.lastMoveAt) IS NULL');
    expect(slow?.sql).toContain('MAX(m.lastMoveAt) < ?');
  });
});
