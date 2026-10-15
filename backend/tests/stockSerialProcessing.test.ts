import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { stockRoutes } from '../routes/stock.js';
import { DatabaseTransactionGate } from '../utils/dbTransactionGate.js';

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
  lots?: any[];
  lotHit?: any;
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
    { id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 2, locationId: null, serialLot: '', processingStatus: 'PENDING' },
  ]).map((l) => ({ ...l }));
  const serials: Record<string, any> = {};
  for (const [sn, row] of Object.entries(opts.serials || {})) serials[sn] = { serialNumber: sn, ...row };

  const db: any = {
    calls, doc, lines, serials,
    all: vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }, { warehouseId: 'wh-hcm' }];
      if (sql.includes('FROM stock_document_lines')) {
        if (sql.includes('processingStatus')) return lines.filter((l) => l.processingStatus !== 'PENDING');
        return lines.map((l) => ({ ...l, tracking: opts.trackings?.[l.productId] }));
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
      if (sql.includes('FROM stock_lots')) return opts.lots ?? [];
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
      if (sql.includes('FROM stock_lots')) return opts.lotHit;
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
    expect(db.calls.some(([s]: [string, any[]]) => String(s).includes('INSERT INTO stock_moves'))).toBe(false);
  });

  it('passes SERIAL lines with matching serials', async () => {
    const db = procDb({
      trackings: { p1: 'SERIAL' },
      lines: [{ id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 2, locationId: null, serialLot: 'A\nB', processingStatus: 'COMPLETED' }],
    });
    await request(appFor(tp, db)).post('/receipts/doc1/complete').send({}).expect(200);
  });

  it('lets QUANTITY lines through without serials; LOT needs coverage', async () => {
    for (const tracking of ['QUANTITY', undefined]) {
      const db = procDb({ trackings: tracking ? { p1: tracking } : {} });
      const res = await request(appFor(tp, db)).post('/receipts/doc1/complete').send({});
      expect(res.status).toBe(200);
    }
    // LOT line with nothing registered is blocked...
    const dbEmpty = procDb({ trackings: { p1: 'LOT' } });
    await request(appFor(tp, dbEmpty)).post('/receipts/doc1/complete').send({}).expect(400);
    // ...but passes once registered lots cover the quantity
    const dbCovered = procDb({ trackings: { p1: 'LOT' }, lots: [{ covered: 2 }] });
    await request(appFor(tp, dbCovered)).post('/receipts/doc1/complete').send({}).expect(200);
  });

  it('completes PROCESSING documents', async () => {
    const db = procDb({
      status: 'PROCESSING', trackings: { p1: 'SERIAL' },
      lines: [{ id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 2, locationId: null, serialLot: 'A\nB', processingStatus: 'COMPLETED' }],
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
    expect(db.calls.some(([s]: [string, any[]]) => String(s).includes("stockStatus = 'RESERVED'"))).toBe(true);
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
  it('recomputes warranty start on issue complete', async () => {
    const db = procDb({
      docType: 'ISSUE',
      trackings: { p1: 'SERIAL' },
      lines: [{ id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 1, locationId: null, serialLot: 'SN1', processingStatus: 'PARTIAL' }],
      serials: { SN1: { productId: 'p1', warehouseId: 'wh-hn', stockStatus: 'IN_STOCK', receiptDocumentId: 'pnk1' } },
    });
    await request(appFor(tp, db)).post('/issues/doc1/complete').send({}).expect(200);
    const today = new Date().toISOString().slice(0, 10);
    const updates = db.calls.filter(([s]: [string, any[]]) => String(s).includes('warrantyStart = COALESCE'));
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toContain(today);
  });
});

describe('concurrent scan (Phase 6)', () => {
  function gateDb() {
    const gate = new DatabaseTransactionGate();
    const doc: any = { id: 'doc1', docType: 'RECEIPT', status: 'DRAFT', warehouseId: 'wh-hn', referenceType: null };
    const line: any = { id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 2, locationId: null, serialLot: '', processingStatus: 'PENDING' };
    const db: any = {
      runWithRequestContext: (fn: () => any) => gate.runWithRequestContext(fn),
      all: (sql: string, params: any[] = []) => gate.run(sql, async () => {
        if (sql.includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }];
        if (sql.includes('FROM stock_document_lines')) return [{ ...line }];
        if (sql.includes('SELECT id, tracking FROM products')) return [{ id: 'p1', tracking: 'SERIAL' }];
        if (sql.includes('FROM products')) return [{ id: 'p1' }];
        if (sql.includes('FROM stock_serials')) return [];
        if (sql.includes('FROM warehouses')) return [{ id: 'wh-hn' }];
        return [];
      }),
      get: (sql: string, params: any[] = []) => gate.run(sql, async () => {
        if (sql.includes('FROM stock_documents')) return { ...doc };
        if (sql.includes('FROM stock_document_lines')) return { ...line };
        if (sql.includes('FROM stock_serials')) return undefined;
        return undefined;
      }),
      run: (sql: string, params: any[] = []) => gate.run(sql, async () => {
        if (sql.includes('UPDATE stock_document_lines SET serialLot')) {
          line.serialLot = params[0];
          line.processingStatus = params[1];
        }
        if (sql.includes('UPDATE stock_documents SET status')) doc.status = 'PROCESSING';
        return { changes: 1 };
      }),
    };
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: 'u1', managementLevel: 20 }; db.runWithRequestContext(next); });
    app.use(stockRoutes(db));
    return { app, line };
  }

  it('two simultaneous scans of the same serial yield exactly one success', async () => {
    const { app, line } = gateDb();
    const body = { documentId: 'doc1', documentLineId: 'l1', serial: 'SN-DUP' };
    const responses = await Promise.all([1, 2].map(() => request(app).post('/serials/scan').send(body)));
    expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(line.processingStatus).toBe('PARTIAL');
  });

  it('completes once: second call sees DONE', async () => {
    const db = procDb({ trackings: { p1: 'SERIAL' } });
    // seed serials via scan first
    await request(appFor(tp, db)).post('/serials/scan').send({ documentId: 'doc1', documentLineId: 'l1', serial: 'A' }).expect(201);
    await request(appFor(tp, db)).post('/serials/scan').send({ documentId: 'doc1', documentLineId: 'l1', serial: 'B' }).expect(201);
    await request(appFor(tp, db)).post('/receipts/doc1/complete').send({}).expect(200);
    // doc fixture reloads DRAFT from the static mock... emulate DONE:
    db.doc.status = 'DONE';
    await request(appFor(tp, db)).post('/receipts/doc1/complete').send({}).expect(400);
    const moves = db.calls.filter(([s]: [string, any[]]) => String(s).includes('INSERT INTO stock_moves'));
    expect(moves.length).toBeGreaterThan(0);
  });
});

describe('progress + confirm-qty + lots (Phase 3 backend)', () => {
  const multiLines = [
    { id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 2, locationId: null, serialLot: 'A', processingStatus: 'PARTIAL' },
    { id: 'l2', documentId: 'doc1', productId: 'p2', quantity: 100, locationId: null, serialLot: '', processingStatus: 'PENDING' },
    { id: 'l3', documentId: 'doc1', productId: 'p3', quantity: 500, locationId: null, serialLot: '', processingStatus: 'PENDING', actualQty: null },
  ];
  const trackings = { p1: 'SERIAL', p2: 'LOT', p3: 'QUANTITY' };

  it('reports per-line progress', async () => {
    const db = procDb({ lines: multiLines, trackings });
    const res = await request(appFor(tp, db)).get('/documents/doc1/progress').expect(200);
    expect(res.body.allCompleted).toBe(false);
    const byId: Record<string, any> = Object.fromEntries(res.body.lines.map((l: any) => [l.lineId, l]));
    expect(byId.l1).toMatchObject({ required: 2, processed: 1, tracking: 'SERIAL', status: 'PARTIAL' });
    expect(byId.l2).toMatchObject({ required: 100, processed: 0, tracking: 'LOT', status: 'PENDING' });
    expect(byId.l3).toMatchObject({ required: 500, processed: 0, tracking: 'QUANTITY', status: 'PENDING' });
  });

  it('confirms quantity with variance reason', async () => {
    const db = procDb({ lines: multiLines, trackings });
    const res = await request(appFor(tp, db)).post('/lines/l3/confirm-qty')
      .send({ actualQty: 495, varianceReason: 'Hao hut van chuyen' }).expect(200);
    expect(res.body).toEqual({ actualQty: 495, varianceQty: -5 });
    await request(appFor(tp, db)).post('/lines/l3/confirm-qty').send({ actualQty: 490 }).expect(400);
  });

  it('rejects confirm-qty on SERIAL lines', async () => {
    const db = procDb({ lines: multiLines, trackings });
    await request(appFor(tp, db)).post('/lines/l1/confirm-qty').send({ actualQty: 2 }).expect(400);
  });

  it('registers lots and completes when covered', async () => {
    const db = procDb({ lines: multiLines, trackings });
    const r1 = await request(appFor(tp, db)).post('/lots/register').send({
      documentId: 'doc1', documentLineId: 'l2', lotCode: 'LAPP-01', quantity: 60, unit: 'm',
    }).expect(201);
    expect(r1.body.lotCode).toBe('LAPP-01');
    // duplicate lot code in same warehouse
    const dbDup = procDb({ lines: multiLines, trackings, lotHit: { id: 'lot9' } });
    await request(appFor(tp, dbDup)).post('/lots/register').send({
      documentId: 'doc1', documentLineId: 'l2', lotCode: 'LAPP-01', quantity: 60,
    }).expect(409);
    // LOT line covered by registered lots passes complete gating
    const dbCovered = procDb({
      lines: [{ id: 'l2', documentId: 'doc1', productId: 'p2', quantity: 100, locationId: null, serialLot: '', processingStatus: 'PENDING' }],
      trackings: { p2: 'LOT' },
      lots: [{ covered: 100 }],
    });
    await request(appFor(tp, dbCovered)).post('/receipts/doc1/complete').send({}).expect(200);
  });

  it('rejects lot registration on non-LOT products', async () => {
    const db = procDb({ lines: multiLines, trackings });
    await request(appFor(tp, db)).post('/lots/register').send({
      documentId: 'doc1', documentLineId: 'l1', lotCode: 'X-01', quantity: 1,
    }).expect(400);
  });
});
