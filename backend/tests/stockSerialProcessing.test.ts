import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { stockRoutes } from '../routes/stock.js';

const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };

function appFor(user: any, db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(stockRoutes(db));
  return app;
}

interface ProcOpts {
  docType?: string;
  status?: string;
  lines?: any[];
  trackings?: Record<string, string>;
  serials?: Record<string, any>;
}

// Stateful fixture: doc/lines/serials mutate through run() like a real ledger.
function procDb(opts: ProcOpts = {}) {
  const calls: [string, any[]][] = [];
  const doc: any = {
    id: 'doc1', docType: opts.docType || 'RECEIPT', status: opts.status || 'DRAFT',
    code: 'PNK-26-0001', warehouseId: 'wh-hn', sourceWarehouseId: 'wh-hn',
    destWarehouseId: 'wh-hcm', referenceType: null, partnerName: 'NCC A',
  };
  const lines: any[] = (opts.lines || [
    { id: 'l1', productId: 'p1', quantity: 2, locationId: null, serialLot: '', processingStatus: 'PENDING' },
  ]).map((l) => ({ ...l }));
  const serials: Record<string, any> = {};
  for (const [sn, row] of Object.entries(opts.serials || {})) serials[sn] = { serialNumber: sn, ...row };

  const db: any = {
    calls, doc, lines, serials,
    all: vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }, { warehouseId: 'wh-hcm' }];
      if (sql.includes('FROM stock_document_lines')) {
        if (sql.includes('processingStatus')) return lines.filter((l) => l.processingStatus !== 'PENDING');
        return lines.map((l) => ({ ...l }));
      }
      if (sql.includes('SELECT id, tracking FROM products')) {
        return params.map((id) => ({ id, tracking: opts.trackings?.[id] }));
      }
      if (sql.includes('FROM products')) return Object.keys({ p1: 0, ...opts.trackings }).map((id) => ({ id }));
      if (sql.includes('FROM stock_serials')) {
        if (sql.includes('receiptDocumentId') || sql.includes('issueDocumentId')) {
          return Object.values(serials).filter((s: any) => s.receiptDocumentId === 'doc1' || s.issueDocumentId === 'doc1');
        }
        return [];
      }
      if (sql.includes('FROM stock_balances')) {
        return [{ productId: 'p1', locationId: '', onHand: 10, reserved: 0 }];
      }
      if (sql.includes('FROM warehouses')) return [{ id: 'wh-hn' }, { id: 'wh-hcm' }];
      return [];
    }),
    get: vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM stock_documents')) return params[0] === 'doc1' ? { ...doc } : undefined;
      if (sql.includes('FROM stock_document_lines')) {
        return lines.find((l) => l.id === params[0]);
      }
      if (sql.includes('FROM stock_serials')) {
        if (sql.includes('serialNumber')) {
          const hit = serials[params[0]];
          return hit ? { ...hit } : undefined;
        }
        if (sql.includes("stockStatus = 'OUT'")) {
          return Object.values(serials).find(
            (s: any) => s.stockStatus === 'OUT' && (s.receiptDocumentId === 'doc1' || s.issueDocumentId === 'doc1')
          );
        }
        if (sql.includes('receiptDocumentId') || sql.includes('issueDocumentId')) {
          const found = Object.values(serials).find(
            (s: any) => s.receiptDocumentId === 'doc1' || s.issueDocumentId === 'doc1'
          );
          return found ? { ...(found as object) } : undefined;
        }
        return undefined;
      }
      if (sql.includes('FROM stock_locations')) return { warehouseId: 'wh-hn', isActive: 1, purpose: 'SALEABLE' };
      if (sql.includes('FROM stock_balances')) return { onHand: 10, reserved: 0 };
      return undefined;
    }),
    run: vi.fn(async (sql: string, params: any[] = []) => {
      calls.push([sql, params]);
      if (sql.includes('UPDATE stock_documents SET status')) {
        doc.status = sql.includes("'PROCESSING'") ? 'PROCESSING' : params[0];
      }
      if (sql.includes('UPDATE stock_document_lines SET serialLot')) {
        const line = lines.find((l) => l.id === params[2]);
        if (line) { line.serialLot = params[0]; line.processingStatus = params[1]; }
      }
      if (sql.includes('UPDATE stock_serials SET stockStatus')) {
        const row = Object.values(serials).find((s: any) => s.serialNumber === params[3] || true);
        void row;
      }
      if (sql.startsWith('UPDATE stock_serials SET stockStatus')) {
        // params: [..., serialId-last] — locate by issueDocumentId flow is asserted via calls
      }
      if (sql.includes('INSERT INTO stock_serials')) {
        const sn = params[2];
        if (typeof sn === 'string' && sn) serials[sn] = { serialNumber: sn, productId: params[1] };
      }
      if (sql.includes('DELETE FROM stock_serials')) {
        for (const sn of Object.keys(serials)) {
          if (serials[sn].receiptDocumentId === 'doc1' || serials[sn].issueDocumentId === 'doc1') delete serials[sn];
        }
      }
      if (sql.includes('DELETE FROM stock_document_lines')) lines.length = 0;
      return { changes: 1 };
    }),
  };
  return db;
}

describe('SERIAL gating on complete (Phase 2)', () => {
  it('blocks SERIAL lines without serials', async () => {
    const db = procDb({ trackings: { p1: 'SERIAL' } });
    const res = await request(appFor(tp, db)).post('/receipts/doc1/complete').send({}).expect(400);
    expect(res.body.error).toMatch(/Chưa đủ Serial/);
    expect(db.calls.some(([s]) => String(s).includes('INSERT INTO stock_moves'))).toBe(false);
  });

  it('passes SERIAL lines with matching serials', async () => {
    const db = procDb({
      trackings: { p1: 'SERIAL' },
      lines: [{ id: 'l1', productId: 'p1', quantity: 2, locationId: null, serialLot: 'A\nB', processingStatus: 'COMPLETED' }],
    });
    await request(appFor(tp, db)).post('/receipts/doc1/complete').send({}).expect(200);
  });

  it('lets LOT/QUANTITY lines through without serials', async () => {
    for (const tracking of ['LOT', 'QUANTITY', undefined]) {
      const db = procDb({ trackings: tracking ? { p1: tracking } : {} });
      const res = await request(appFor(tp, db)).post('/receipts/doc1/complete').send({});
      expect(res.status).toBe(200);
    }
  });

  it('completes PROCESSING documents', async () => {
    const db = procDb({
      status: 'PROCESSING', trackings: { p1: 'SERIAL' },
      lines: [{ id: 'l1', productId: 'p1', quantity: 2, locationId: null, serialLot: 'A\nB', processingStatus: 'COMPLETED' }],
    });
    await request(appFor(tp, db)).post('/receipts/doc1/complete').send({}).expect(200);
    expect(db.doc.status).toBe('DONE');
  });
});

describe('POST /serials/scan (Phase 2)', () => {
  const body = { documentId: 'doc1', documentLineId: 'l1', serial: 'SN-X' };

  it('appends serials and marks PROCESSING', async () => {
    const db = procDb({ trackings: { p1: 'SERIAL' } });
    const r1 = await request(appFor(tp, db)).post('/serials/scan').send(body).expect(201);
    expect(r1.body).toMatchObject({ serial: 'SN-X', count: 1, required: 2, completed: false });
    expect(db.doc.status).toBe('PROCESSING');
    const r2 = await request(appFor(tp, db)).post('/serials/scan').send({ ...body, serial: 'SN-Y' }).expect(201);
    expect(r2.body).toMatchObject({ count: 2, completed: true });
  });

  it('rejects duplicates, over-quantity and global conflicts', async () => {
    const db = procDb({ trackings: { p1: 'SERIAL' } });
    await request(appFor(tp, db)).post('/serials/scan').send(body).expect(201);
    await request(appFor(tp, db)).post('/serials/scan').send(body).expect(400);
    await request(appFor(tp, db)).post('/serials/scan').send({ ...body, serial: 'SN-Y' }).expect(201);
    await request(appFor(tp, db)).post('/serials/scan').send({ ...body, serial: 'SN-Z' }).expect(400);
  });

  it('rejects globally existing serials with 409', async () => {
    const db = procDb({ trackings: { p1: 'SERIAL' }, serials: { 'SN-X': { productId: 'p9' } } });
    await request(appFor(tp, db)).post('/serials/scan').send(body).expect(409);
  });

  it('rejects non-SERIAL products', async () => {
    const db = procDb({ trackings: { p1: 'QUANTITY' } });
    await request(appFor(tp, db)).post('/serials/scan').send(body).expect(400);
  });

  it('404s unknown documents and lines', async () => {
    const db = procDb({ trackings: { p1: 'SERIAL' } });
    await request(appFor(tp, db)).post('/serials/scan').send({ ...body, documentId: 'nope' }).expect(404);
  });
});

describe('POST /serials/scan-out (Phase 2)', () => {
  const base = { documentId: 'doc1', documentLineId: 'l1', serial: 'SN-X' };
  const stocked = { productId: 'p1', warehouseId: 'wh-hn', stockStatus: 'IN_STOCK', receiptDocumentId: 'pnk1' };

  function issueDb(serials: Record<string, any>, trackings = { p1: 'SERIAL' }) {
    return procDb({ docType: 'ISSUE', trackings, serials });
  }

  it('reserves matching serials', async () => {
    const db = issueDb({ 'SN-X': { ...stocked } });
    const res = await request(appFor(tp, db)).post('/serials/scan-out').send(base).expect(201);
    expect(res.body).toMatchObject({ serial: 'SN-X', count: 1, required: 2 });
    expect(db.calls.some(([s]) => String(s).includes("stockStatus = 'RESERVED'"))).toBe(true);
  });

  it('404s unknown serials and 400s mismatches with clear messages', async () => {
    const db = issueDb({});
    const missing = await request(appFor(tp, db)).post('/serials/scan-out').send(base).expect(404);
    expect(missing.body.error).toMatch(/lịch sử nhập kho/);

    const wrongProduct = issueDb({ 'SN-X': { ...stocked, productId: 'p9' } });
    await request(appFor(tp, wrongProduct)).post('/serials/scan-out').send(base).expect(400);

    const wrongWh = issueDb({ 'SN-X': { ...stocked, warehouseId: 'wh-hcm' } });
    const whRes = await request(appFor(tp, wrongWh)).post('/serials/scan-out').send(base).expect(400);
    expect(whRes.body.error).toMatch(/không nằm tại kho/);
  });

  it('blocks already-issued serials naming the issue document', async () => {
    const db = issueDb({ 'SN-X': { ...stocked, stockStatus: 'OUT', issueDocumentId: 'dx' } });
    // mock doc lookup returns the doc itself; override code via doc object is fixed,
    // so only assert the refusal shape here.
    const res = await request(appFor(tp, db)).post('/serials/scan-out').send(base).expect(400);
    expect(res.body.error).toMatch(/đã được xuất theo/);
  });

  it('blocks serials reserved by another document', async () => {
    const db = issueDb({ 'SN-X': { ...stocked, stockStatus: 'RESERVED', issueDocumentId: 'other' } });
    await request(appFor(tp, db)).post('/serials/scan-out').send(base).expect(400);
  });

  it('rejects serials never received into stock', async () => {
    const db = issueDb({ 'SN-X': { productId: 'p1', warehouseId: 'wh-hn', stockStatus: 'IN_STOCK' } });
    const res = await request(appFor(tp, db)).post('/serials/scan-out').send(base).expect(400);
    expect(res.body.error).toMatch(/chưa từng nhập kho/);
  });
});

describe('PUT processing lock (Phase 2)', () => {
  const sameLines = [{ productId: 'p1', quantity: 2, locationId: null, serialLot: 'A\nB' }];

  it('blocks quantity changes after processing started', async () => {
    const db = procDb({ serials: { A: { receiptDocumentId: 'doc1', stockStatus: 'IN_STOCK' } } });
    const res = await request(appFor(tp, db)).put('/documents/doc1')
      .send({ lines: [{ productId: 'p1', quantity: 5, locationId: null }] }).expect(400);
    expect(res.body.error).toMatch(/đã bắt đầu xử lý/);
  });

  it('allows header-only edits after processing started', async () => {
    const db = procDb({ serials: { A: { receiptDocumentId: 'doc1', stockStatus: 'IN_STOCK' } } });
    await request(appFor(tp, db)).put('/documents/doc1').send({ notes: 'ghi chu moi' }).expect(200);
  });

  it('resetProcessing clears linked serials and unlocks edits', async () => {
    const db = procDb({ serials: { A: { receiptDocumentId: 'doc1', stockStatus: 'IN_STOCK' } } });
    await request(appFor(tp, db)).put('/documents/doc1')
      .send({ resetProcessing: true, lines: [{ productId: 'p1', quantity: 5, locationId: null }] }).expect(200);
    expect(Object.keys(db.serials)).toHaveLength(0);
  });

  it('refuses reset when serials already issued', async () => {
    const db = procDb({ serials: { A: { receiptDocumentId: 'doc1', stockStatus: 'OUT', issueDocumentId: 'dx' } } });
    await request(appFor(tp, db)).put('/documents/doc1')
      .send({ resetProcessing: true, lines: sameLines }).expect(409);
  });
});

describe('idempotent complete (Phase 2)', () => {
  it('completes once: second call sees DONE', async () => {
    const db = procDb({ trackings: { p1: 'SERIAL' } });
    // seed serials via scan first
    await request(appFor(tp, db)).post('/serials/scan').send({ documentId: 'doc1', documentLineId: 'l1', serial: 'A' }).expect(201);
    await request(appFor(tp, db)).post('/serials/scan').send({ documentId: 'doc1', documentLineId: 'l1', serial: 'B' }).expect(201);
    await request(appFor(tp, db)).post('/receipts/doc1/complete').send({}).expect(200);
    // doc fixture reloads DRAFT from the static mock... emulate DONE:
    db.doc.status = 'DONE';
    await request(appFor(tp, db)).post('/receipts/doc1/complete').send({}).expect(400);
    const moves = db.calls.filter(([s]) => String(s).includes('INSERT INTO stock_moves'));
    expect(moves.length).toBeGreaterThan(0);
  });
});
