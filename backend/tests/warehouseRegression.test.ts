import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { stockRoutes } from '../routes/stock.js';
import { DatabaseTransactionGate } from '../utils/dbTransactionGate.js';
import { releaseExpiredReservations } from '../schedulers/reservationExpiry.js';

function fixture(options: { type?: string; quantities?: number[]; onHand?: number; reserved?: number; location?: string; counting?: boolean; level?: number; status?: string } = {}) {
  const gate = new DatabaseTransactionGate();
  const doc: any = { id: 'd1', docType: options.type || 'ISSUE', status: options.status || 'DRAFT', warehouseId: 'w1', sourceWarehouseId: 'w1', destWarehouseId: 'w2' };
  const lines = (options.quantities || [6]).map((quantity, i) => ({ id: `l${i}`, productId: 'p1', locationId: options.location || '', quantity }));
  const balance = { onHand: options.onHand ?? 10, reserved: options.reserved ?? 0 };
  const reservation: any = { id: 'r1', productId: 'p1', warehouseId: 'w1', locationId: '', status: 'HELD', quantity: 4 };
  const writes: { sql: string; params: any[] }[] = [];
  let snapshot: any;
  const db: any = {
    runWithRequestContext: (fn: () => any) => gate.runWithRequestContext(fn),
    all: (sql: string, params: any[] = []) => gate.run(sql, async () => {
      if (sql.includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'w1' }, { warehouseId: 'w2' }];
      if (sql.includes('FROM stock_document_lines')) return structuredClone(lines);
      if (sql.includes('FROM reservations')) return [structuredClone(reservation)];
      if (sql.includes('FROM warehouses')) return [{ id: 'w1' }, { id: 'w2' }];
      if (sql.includes('FROM stock_balances')) return [];
      return [];
    }),
    get: (sql: string, params: any[] = []) => gate.run(sql, async () => {
      if (sql.includes('FROM stock_documents')) return structuredClone(doc);
      if (sql.includes('FROM products')) return { id: 'p1' };
      if (sql.includes('FROM stock_balances')) return { ...balance };
      if (sql.includes('FROM reservations')) return structuredClone(reservation);
      if (sql.includes('FROM stock_counts')) return options.counting ? { id: 'count1' } : undefined;
      if (sql.includes('FROM stock_locations')) return { warehouseId: params[0] === 'dest' ? 'w2' : 'w1', isActive: 1, purpose: params[0] === 'damaged' ? 'DAMAGED' : 'SALEABLE' };
      return undefined;
    }),
    run: (sql: string, params: any[] = []) => gate.run(sql, async () => {
      writes.push({ sql, params });
      if (sql === 'START TRANSACTION') snapshot = structuredClone({ doc, balance, reservation });
      if (sql === 'ROLLBACK' && snapshot) { Object.assign(doc, snapshot.doc); Object.assign(balance, snapshot.balance); Object.assign(reservation, snapshot.reservation); }
      if (sql.includes('INSERT INTO stock_balances')) {
        if (sql.includes('reserved = reserved +')) balance.reserved += Number(params[3]);
        else balance.onHand += Number(params[3]);
      }
      if (sql.includes('UPDATE stock_documents SET status')) doc.status = params[0];
      if (sql.includes('UPDATE reservations SET status')) reservation.status = params[0];
      if (sql.includes('UPDATE stock_balances SET reserved')) balance.reserved -= Number(params[0]);
      if (sql.includes('UPDATE stock_balances SET onHand')) { balance.onHand -= Number(params[0]); balance.reserved -= Number(params[1]); }
      return { changes: 1 };
    }),
  };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = { id: 'u1', managementLevel: options.level ?? 20 }; db.runWithRequestContext(next); });
  app.use(stockRoutes(db));
  return { app, db, balance, doc, reservation, writes };
}

describe('warehouse stock integrity regressions', () => {
  it.each(['ISSUE', 'TRANSFER'])('rejects repeated lines totaling more than available: %s', async type => {
    const f = fixture({ type, quantities: [6,6] });
    await request(f.app).post(type === 'ISSUE' ? '/issues/d1/complete' : '/transfers/d1/ship').send({}).expect(400);
    expect(f.balance.onHand).toBe(10);
    expect(f.writes.some(write => write.sql.includes('INSERT INTO stock_moves'))).toBe(false);
    expect(f.writes.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('serializes concurrent completion and posts a document only once', async () => {
    const f = fixture({ type: 'RECEIPT', quantities: [5] });
    const responses = await Promise.all([1,2].map(() => request(f.app).post('/receipts/d1/complete').send({})));
    expect(responses.map(response => response.status).sort()).toEqual([200,400]);
    expect(f.balance.onHand).toBe(15);
    expect(f.writes.filter(write => write.sql.includes('INSERT INTO stock_moves'))).toHaveLength(1);
  });

  it('serializes competing holds so they cannot exceed available stock', async () => {
    const f = fixture();
    const responses = await Promise.all([1,2].map(() => request(f.app).post('/reservations').send({ productId: 'p1', warehouseId: 'w1', quantity: 6 })));
    expect(responses.map(response => response.status).sort()).toEqual([201,400]);
    expect(f.balance.reserved).toBe(6);
  });

  it('cannot release the same reservation twice concurrently', async () => {
    const f = fixture({ reserved: 4 });
    const responses = await Promise.all([1,2].map(() => request(f.app).post('/reservations/r1/release').send({})));
    expect(responses.map(response => response.status).sort()).toEqual([200,400]);
    expect(f.balance.reserved).toBe(0);
  });

  it('runs expiry under a real transaction context and does not repeat it', async () => {
    const f = fixture({ reserved: 4 });
    expect(await releaseExpiredReservations(f.db)).toBe(1);
    expect(await releaseExpiredReservations(f.db)).toBe(0);
    expect(f.balance.reserved).toBe(0);
  });

  it('receives into the destination location, never the source location', async () => {
    const f = fixture({ type: 'TRANSFER', status: 'IN_TRANSIT', location: 'source' });
    await request(f.app).post('/transfers/d1/receive').send({ locationId: 'source' }).expect(400);
    await request(f.app).post('/transfers/d1/receive').send({ locationId: 'dest' }).expect(200);
    const move = f.writes.find(write => write.sql.includes('INSERT INTO stock_moves'))!;
    expect(move.params.slice(2,4)).toEqual(['w2','dest']);
  });

  it('legacy receive without a location goes to an unlocated destination balance', async () => {
    const f = fixture({ type: 'TRANSFER', status: 'IN_TRANSIT', location: 'source' });
    await request(f.app).post('/transfers/d1/receive').send({}).expect(200);
    const balance = f.writes.find(write => write.sql.includes('INSERT INTO stock_balances'))!;
    expect(balance.params.slice(1,3)).toEqual(['w2','']);
  });

  it('blocks stock posting while a count is open', async () => {
    const f = fixture({ counting: true });
    await request(f.app).post('/issues/d1/complete').send({}).expect(409);
    expect(f.balance.onHand).toBe(10);
  });

  it('does not reserve or issue damaged stock', async () => {
    const f = fixture({ location: 'damaged' });
    await request(f.app).post('/reservations').send({ productId: 'p1', warehouseId: 'w1', locationId: 'damaged', quantity: 1 }).expect(400);
    await request(f.app).post('/issues/d1/complete').send({}).expect(400);
    expect(f.balance.onHand).toBe(10);
  });

  it.each([10,99])('rejects reservation changes and MISA reads for level %s', async level => {
    const f = fixture({ level });
    await request(f.app).post('/reservations').send({ productId: 'p1', warehouseId: 'w1', quantity: 1 }).expect(403);
    await request(f.app).post('/reservations/r1/consume').send({}).expect(403);
    await request(f.app).get('/misa-mappings').expect(403);
    await request(f.app).get('/misa-logs').expect(403);
  });
});
