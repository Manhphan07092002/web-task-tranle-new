import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { stockRoutes } from '../routes/stock.js';
import { releaseExpiredReservations } from '../schedulers/reservationExpiry.js';

const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };

function appFor(user: any, db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(stockRoutes(db));
  return app;
}

function issueDoc(overrides: Record<string, any> = {}) {
  return {
    id: 'doc1', code: 'PXK-26-0001', docType: 'ISSUE', status: 'READY',
    warehouseId: 'wh-hn', referenceType: null, ...overrides,
  };
}

function issueLine(overrides: Record<string, any> = {}) {
  return {
    id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 4, locationId: '',
    serialRequired: 0, serialLot: null, processingStatus: 'PENDING', ...overrides,
  };
}

function reservation(overrides: Record<string, any> = {}) {
  return {
    id: 'r1', productId: 'p1', warehouseId: 'wh-hn', locationId: '', quantity: 4,
    consumedQuantity: 0, status: 'HELD', sourceType: 'INTERNAL', sourceId: null,
    expiresAt: null, ...overrides,
  };
}

function link(overrides: Record<string, any> = {}) {
  return {
    linkId: 'link1', documentLineId: 'l1', reservationId: 'r1',
    allocatedQuantity: 4, productId: 'p1', warehouseId: 'wh-hn', locationId: '',
    quantity: 4, consumedQuantity: 0, status: 'HELD', ...overrides,
  };
}

function makeDb(opts: {
  doc?: any;
  lines?: any[];
  balance?: { onHand: number; reserved: number };
  links?: any[];
  oldLinks?: any[];
  reservations?: any[];
  products?: string[];
} = {}) {
  const runs: [string, any[]][] = [];
  const db: any = {
    runs,
    all: vi.fn(async (sql: string) => {
      const text = String(sql);
      if (text.includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }];
      if (text.includes('stock_document_line_reservations') && text.includes('INNER JOIN stock_documents d')) return [];
      if (text.includes('stock_document_line_reservations') && !text.includes('INNER JOIN reservations r')) {
        return opts.oldLinks ?? [];
      }
      if (text.includes('stock_document_line_reservations')) return opts.links ?? [];
      if (text.includes('FROM stock_document_lines')) return opts.lines ?? [];
      if (text.includes('FROM products')) {
        return (opts.products ?? ['p1']).map((id) => ({ id, tracking: 'QUANTITY' }));
      }
      if (text.includes('FROM stock_balances')) {
        return opts.balance ? [{ productId: 'p1', locationId: '', ...opts.balance }] : [];
      }
      if (text.includes('FROM reservations')) return opts.reservations ?? [];
      return [];
    }),
    get: vi.fn(async (sql: string) => {
      const text = String(sql);
      if (text.includes('FROM stock_documents')) return opts.doc;
      if (text.includes('FROM stock_balances')) return opts.balance;
      if (text.includes('FROM stock_locations')) return { warehouseId: 'wh-hn', isActive: 1, purpose: 'SALEABLE' };
      if (text.includes('FROM products')) return { id: 'p1', tracking: 'QUANTITY' };
      if (text.includes('FROM reservations')) return opts.reservations?.[0];
      return undefined;
    }),
    run: vi.fn(async (sql: string, params: any[] = []) => {
      runs.push([String(sql), params]);
      return { changes: 1 };
    }),
  };
  return db;
}

function sqls(db: any): string[] {
  return db.runs.map(([sql]: [string, any[]]) => sql);
}

describe('Phase 6B reservation links on issue documents', () => {
  it('credits the reservation held for this issue when checking availability', async () => {
    const blocked = makeDb({
      doc: issueDoc(), lines: [issueLine()], balance: { onHand: 4, reserved: 4 },
    });
    await request(appFor(tp, blocked)).post('/issues/doc1/complete').send({}).expect(400);

    const allowed = makeDb({
      doc: issueDoc(), lines: [issueLine()], balance: { onHand: 4, reserved: 4 },
      links: [link()], reservations: [reservation()],
    });
    await request(appFor(tp, allowed)).post('/issues/doc1/complete').send({}).expect(200);
  });

  it('uses the reservation credit when moving an issue to READY', async () => {
    const blocked = makeDb({
      doc: issueDoc({ status: 'DRAFT' }), lines: [issueLine()], balance: { onHand: 4, reserved: 4 },
    });
    await request(appFor(tp, blocked)).post('/documents/doc1/processing-complete').send({}).expect(400);

    const allowed = makeDb({
      doc: issueDoc({ status: 'DRAFT' }), lines: [issueLine()], balance: { onHand: 4, reserved: 4 },
      links: [link()], reservations: [reservation()],
    });
    await request(appFor(tp, allowed)).post('/documents/doc1/processing-complete').send({}).expect(200);
  });

  it('consumes reserved quantity without posting a second reservation move', async () => {
    const db = makeDb({
      doc: issueDoc(), lines: [issueLine()], balance: { onHand: 4, reserved: 4 },
      links: [link()], reservations: [reservation()],
    });
    await request(appFor(tp, db)).post('/issues/doc1/complete').send({}).expect(200);

    const reservationUpdate = db.runs.find(([sql]: [string, any[]]) => sql.includes('UPDATE reservations SET consumedQuantity'));
    expect(reservationUpdate?.[1]).toEqual([4, 'CONSUMED', 'r1']);
    const reservedUpdate = db.runs.find(([sql]: [string, any[]]) => sql.includes('UPDATE stock_balances SET reserved = GREATEST'));
    expect(reservedUpdate?.[1]?.[0]).toBe(4);
    const moves = db.runs.filter(([sql]: [string, any[]]) => sql.includes('INSERT INTO stock_moves'));
    expect(moves).toHaveLength(1);
    expect(moves[0][1]?.[4]).toBe(-4);
    expect(sqls(db).some((sql) => sql.includes('DELETE rl FROM stock_document_line_reservations'))).toBe(true);
  });

  it('supports partial consumption and leaves the rest of the reservation held', async () => {
    const db = makeDb({
      doc: issueDoc(), lines: [issueLine({ quantity: 4 })],
      balance: { onHand: 10, reserved: 10 },
      links: [link({ allocatedQuantity: 4, quantity: 10 })],
      reservations: [reservation({ quantity: 10 })],
    });
    await request(appFor(tp, db)).post('/issues/doc1/complete').send({}).expect(200);

    const reservationUpdate = db.runs.find(([sql]: [string, any[]]) => sql.includes('UPDATE reservations SET consumedQuantity'));
    expect(reservationUpdate?.[1]).toEqual([4, 'HELD', 'r1']);
    const reservedUpdate = db.runs.find(([sql]: [string, any[]]) => sql.includes('UPDATE stock_balances SET reserved = GREATEST'));
    expect(reservedUpdate?.[1]?.[0]).toBe(4);
  });

  it('stores reservation links when creating an issue and validates quantity', async () => {
    const db = makeDb({
      reservations: [reservation()],
      products: ['p1'],
    });
    await request(appFor(tp, db)).post('/issues').send({
      warehouseId: 'wh-hn',
      lines: [{ productId: 'p1', quantity: 4, locationId: '', reservationIds: ['r1'] }],
    }).expect(201);

    const insert = db.runs.find(([sql]: [string, any[]]) => sql.includes('INSERT INTO stock_document_line_reservations'));
    expect(insert).toBeTruthy();
    expect(insert?.[1]?.[2]).toBe('r1');
    expect(insert?.[1]?.[3]).toBe(4);
  });

  it('replaces links on PUT and keeps them when the client sends reservationIds', async () => {
    const db = makeDb({
      doc: issueDoc({ status: 'DRAFT' }),
      lines: [issueLine({ id: 'old-line' })],
      oldLinks: [{ productId: 'p1', locationId: '', reservationId: 'r1' }],
      reservations: [reservation()],
      products: ['p1'],
    });
    await request(appFor(tp, db)).put('/documents/doc1').send({
      lines: [{ productId: 'p1', quantity: 4, locationId: '', reservationIds: ['r1'] }],
    }).expect(200);

    expect(sqls(db).some((sql) => sql.includes('DELETE rl FROM stock_document_line_reservations'))).toBe(true);
    const insert = db.runs.find(([sql]: [string, any[]]) => sql.includes('INSERT INTO stock_document_line_reservations'));
    expect(insert?.[1]?.[2]).toBe('r1');
  });

  it('removes links when the client explicitly sends an empty reservationIds array', async () => {
    const db = makeDb({
      doc: issueDoc({ status: 'DRAFT' }),
      lines: [issueLine({ id: 'old-line' })],
      oldLinks: [{ productId: 'p1', locationId: '', reservationId: 'r1' }],
      reservations: [reservation()],
      products: ['p1'],
    });
    await request(appFor(tp, db)).put('/documents/doc1').send({
      lines: [{ productId: 'p1', quantity: 4, locationId: '', reservationIds: [] }],
    }).expect(200);

    expect(sqls(db).some((sql) => sql.includes('DELETE rl FROM stock_document_line_reservations'))).toBe(true);
    expect(db.runs.some(([sql]: [string, any[]]) => sql.includes('INSERT INTO stock_document_line_reservations'))).toBe(false);
  });

  it('drops links on cancel/delete without releasing the held reservation', async () => {
    const cancelDb = makeDb({ doc: issueDoc({ status: 'DRAFT' }), lines: [issueLine()] });
    await request(appFor(tp, cancelDb)).post('/documents/doc1/cancel').send({}).expect(200);
    expect(sqls(cancelDb).some((sql) => sql.includes('DELETE rl FROM stock_document_line_reservations'))).toBe(true);
    expect(sqls(cancelDb).some((sql) => sql.includes('UPDATE stock_balances SET reserved'))).toBe(false);

    const deleteDb = makeDb({ doc: issueDoc({ status: 'DRAFT' }), lines: [issueLine()] });
    await request(appFor(tp, deleteDb)).delete('/documents/doc1').expect(200);
    expect(sqls(deleteDb).some((sql) => sql.includes('DELETE rl FROM stock_document_line_reservations'))).toBe(true);
    expect(sqls(deleteDb).some((sql) => sql.includes('UPDATE stock_balances SET reserved'))).toBe(false);
  });

  it('settles only the remaining quantity after a partial issue consumption', async () => {
    const releaseDb = makeDb({
      reservations: [reservation({ quantity: 10, consumedQuantity: 4 })],
      balance: { onHand: 6, reserved: 6 },
    });
    await request(appFor(tp, releaseDb)).post('/reservations/r1/release').send({}).expect(200);
    const releaseBalance = releaseDb.runs.find(([sql]: [string, any[]]) => sql.includes('UPDATE stock_balances SET reserved = reserved - ?'));
    expect(releaseBalance?.[1]?.[0]).toBe(6);
    expect(sqls(releaseDb).some((sql) => sql.includes('DELETE FROM stock_document_line_reservations WHERE reservationId = ?'))).toBe(true);

    const consumeDb = makeDb({
      reservations: [reservation({ quantity: 10, consumedQuantity: 4 })],
      balance: { onHand: 6, reserved: 6 },
    });
    await request(appFor(tp, consumeDb)).post('/reservations/r1/consume').send({}).expect(200);
    const move = consumeDb.runs.find(([sql]: [string, any[]]) => sql.includes('INSERT INTO stock_moves'));
    expect(move?.[1]?.[4]).toBe(-6);
    const consumed = consumeDb.runs.find(([sql]: [string, any[]]) => sql.includes('UPDATE reservations SET status = ?, consumedQuantity = ?'));
    expect(consumed?.[1]).toEqual(['CONSUMED', 10, 'r1']);
  });

  it('expires only the remaining reserved quantity and clears links', async () => {
    const db = makeDb({
      reservations: [reservation({ quantity: 10, consumedQuantity: 4, expiresAt: '2026-01-01T00:00:00.000Z' })],
      balance: { onHand: 6, reserved: 6 },
    });
    const released = await releaseExpiredReservations(db, new Date('2026-10-23T00:00:00.000Z'));
    expect(released).toBe(1);
    const balanceUpdate = db.runs.find(([sql]: [string, any[]]) => sql.includes('UPDATE stock_balances SET reserved = reserved - ?'));
    expect(balanceUpdate?.[1]?.[0]).toBe(6);
    expect(sqls(db).some((sql) => sql.includes('DELETE FROM stock_document_line_reservations WHERE reservationId = ?'))).toBe(true);
  });
});
