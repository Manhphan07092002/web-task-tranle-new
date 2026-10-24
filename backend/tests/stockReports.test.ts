import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { stockReportRoutes } from '../routes/stockReports.js';

// Execute the aggregation SQL against an isolated SQL database, including more
// rows than the activity feed limit. Production MySQL integration is separate.
function fixture(level = 20) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE products (id TEXT, name TEXT, unit TEXT, importPrice REAL);
    CREATE TABLE warehouses (id TEXT, name TEXT, isActive INTEGER);
    CREATE TABLE user_warehouse_scopes (userId TEXT, warehouseId TEXT);
    CREATE TABLE stock_balances (productId TEXT, warehouseId TEXT, onHand REAL);
    CREATE TABLE stock_moves (productId TEXT, warehouseId TEXT, quantity REAL, moveType TEXT, createdAt TEXT);
    INSERT INTO products VALUES ('p1', 'Panel', 'Tấm', 0);
    INSERT INTO warehouses VALUES ('w1', 'Kho 1', 1), ('w2', 'Kho 2', 1);
    INSERT INTO user_warehouse_scopes VALUES ('u1', 'w1');
    INSERT INTO stock_balances VALUES ('p1', 'w1', 692), ('p1', 'w2', 900);`);
  const insert = sql.prepare('INSERT INTO stock_moves VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < 600; i++) insert.run('p1','w1',1,'RECEIPT','2026-10-05T00:00:00.000Z');
  insert.run('p1','w1',-10,'ISSUE','2026-10-06T00:00:00.000Z');
  insert.run('p1','w1',-3,'ADJUSTMENT','2026-10-07T00:00:00.000Z');
  insert.run('p1','w1',5,'RECEIPT','2026-10-10T00:00:00.000Z');
  const app = express();
  app.use((req: any, _res, next) => { req.user = { id: 'u1', managementLevel: level }; next(); });
  app.use(stockReportRoutes({ all: async (query: string, params: any[] = []) => sql.prepare(query).all(...params) }));
  return { app, close: () => sql.close() };
}
const period = 'from=2026-10-01T00:00:00.000Z&to=2026-10-10T00:00:00.000Z';

describe('complete warehouse period report', () => {
  it('includes over 500 moves, separates adjustments and excludes the end boundary', async () => {
    const f = fixture();
    try {
      const response = await request(f.app).get(`/reports?${period}`).expect(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({ productId: 'p1', warehouseId: 'w1', opening: 100, inbound: 600, outbound: 10, adjustment: -3, closing: 687 });
    } finally { f.close(); }
  });
  it.each([10,99])('denies level %s', async level => {
    const f = fixture(level);
    try { await request(f.app).get(`/reports?${period}`).expect(403); } finally { f.close(); }
  });
  it('denies foreign warehouses and malformed periods', async () => {
    const f = fixture();
    try {
      await request(f.app).get(`/reports?${period}&warehouseId=w2`).expect(403);
      await request(f.app).get('/reports?from=bad&to=bad').expect(400);
    } finally { f.close(); }
  });
});
