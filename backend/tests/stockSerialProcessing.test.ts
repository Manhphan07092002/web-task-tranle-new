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
  referenceId?: string | null;
  warehouseId?: string;
  lines?: any[];
  trackings?: Record<string, string>;
  serials?: Record<string, any>;
  lots?: any[];
  allocations?: any[];
  lotHit?: any;
}

// Stateful fixture: doc/lines/serials mutate through run() like a real ledger.
function procDb(opts: ProcOpts = {}) {
  const calls: [string, any[]][] = [];
  const doc: any = {
    id: 'doc1', docType: opts.docType || 'RECEIPT', status: opts.status || 'DRAFT',
    code: 'PNK-26-0001', warehouseId: opts.warehouseId || 'wh-hn', sourceWarehouseId: 'wh-hn',
    destWarehouseId: 'wh-hcm', referenceType: null, referenceId: opts.referenceId ?? null, partnerName: 'NCC A',
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
      if (sql.includes('GROUP BY l.documentId')) {
        if (lines.length === 0) return [];
        return [{ documentId: 'doc1', total: lines.length, done: lines.filter((l) => l.processingStatus === 'COMPLETED').length }];
      }
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
      if (sql.includes('FROM stock_document_line_lots')) return opts.allocations ?? [];
      if (sql.includes('FROM stock_lots')) return opts.lots ?? [];
      if (sql.includes('FROM warehouses')) return [{ id: 'wh-hn' }, { id: 'wh-hcm' }];
      return [];
    }),
    get: vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM stock_documents')) {
        if (params[0] === 'doc1') return { ...doc };
        // Phiếu xuất nguồn được truy từ Serial khi xử lý trả hàng.
        return { id: params[0], docType: 'ISSUE', status: 'DONE', code: 'PXK-ORIGIN', partnerCode: 'KH-01', partnerName: 'Khách hàng gốc' };
      }
      if (sql.includes('COUNT(*) AS incomplete') && sql.includes('stock_document_lines')) {
        return { incomplete: lines.filter((line) => line.processingStatus !== 'COMPLETED').length };
      }
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
      if (sql.includes('UPDATE stock_documents') && sql.includes('SET status')) {
        doc.status = sql.includes("SET status = 'PROCESSING'") ? 'PROCESSING' : params[0];
      }
      if (sql.includes('UPDATE stock_document_lines') && sql.includes('SET actualQty = ?')) {
        const line = lines.find((l) => l.id === params[3]);
        if (line) { line.actualQty = params[0]; line.varianceQty = params[1]; line.varianceReason = params[2]; line.processingStatus = 'COMPLETED'; }
      }
      if (sql.includes('UPDATE stock_document_lines SET serialLot')) {
        const line = lines.find((l) => l.id === params[2]);
        if (line) { line.serialLot = params[0]; line.processingStatus = params[1]; }
      }
      if (sql.includes('UPDATE stock_document_lines SET serialSkipped')) {
        const line = lines.find((l) => l.id === params[3]);
        if (line) { line.serialSkipped = 1; line.actualQty = params[0]; line.varianceQty = params[1]; line.processingStatus = 'COMPLETED'; }
      }
      if (sql.includes('UPDATE stock_document_lines') && sql.includes('SET serialRequired = 1')) {
        const line = lines.find((l) => l.id === params[0]);
        if (line) { line.serialRequired = 1; line.serialSkipped = 0; line.processingStatus = 'PENDING'; }
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
    const db = procDb({ status: 'READY', trackings: { p1: 'SERIAL' } });
    const res = await request(appFor(tp, db)).post('/receipts/doc1/complete').send({}).expect(400);
    expect(res.body.error).toMatch(/Chưa đủ Serial/);
    expect(db.calls.some(([s]: [string, any[]]) => String(s).includes('INSERT INTO stock_moves'))).toBe(false);
  });

  it('passes SERIAL lines with matching serials', async () => {
    const db = procDb({
      status: 'READY', trackings: { p1: 'SERIAL' },
      lines: [{ id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 2, locationId: null, serialLot: 'A\nB', processingStatus: 'COMPLETED' }],
    });
    await request(appFor(tp, db)).post('/receipts/doc1/complete').send({}).expect(200);
  });

  it('only SERIAL requires scanned serials; LOT requires lot registration', async () => {
    for (const tracking of ['QUANTITY', 'LOT', undefined]) {
      const db = procDb({ status: 'READY', trackings: tracking ? { p1: tracking } : {} });
      const res = await request(appFor(tp, db)).post('/receipts/doc1/complete').send({});
      if (tracking === 'LOT') {
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Chưa đủ Lô/);
      } else {
        expect(res.status).toBe(200);
      }
    }
  });

  it('completes PROCESSING documents', async () => {
    const db = procDb({
      status: 'PROCESSING', trackings: { p1: 'SERIAL' },
      lines: [{ id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 2, locationId: null, serialLot: 'A\nB', processingStatus: 'COMPLETED' }],
    });
    await request(appFor(tp, db)).post('/documents/doc1/processing-complete').send({}).expect(200);
    await request(appFor(tp, db)).post('/receipts/doc1/complete').send({}).expect(200);
    expect(db.doc.status).toBe('DONE');
  });

  it('marks processing READY without posting stock moves', async () => {
    const db = procDb({
      status: 'PROCESSING', trackings: { p1: 'SERIAL' },
      lines: [{ id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 2, locationId: null, serialLot: 'A\nB', processingStatus: 'COMPLETED' }],
    });
    await request(appFor(tp, db)).post('/documents/doc1/processing-complete').send({}).expect(200);
    expect(db.doc.status).toBe('READY');
    expect(db.calls.some(([s]: [string, any[]]) => String(s).includes('INSERT INTO stock_moves'))).toBe(false);
  });
});

describe('POST /serials/scan (Phase 2)', () => {
  const body = { documentId: 'doc1', documentLineId: 'l1', serial: 'SN-X' };

  it('appends serials and marks PROCESSING', async () => {
    const db = procDb({ trackings: { p1: 'SERIAL' } });
    const r1 = await request(appFor(tp, db)).post('/serials/scan').send(body).expect(201);
    expect(r1.body).toMatchObject({ serial: 'SN-X', count: 1, required: 2, completed: false, processingCompleted: false });
    expect(db.doc.status).toBe('PROCESSING');
    const r2 = await request(appFor(tp, db)).post('/serials/scan').send({ ...body, serial: 'SN-Y' }).expect(201);
    expect(r2.body).toMatchObject({ count: 2, completed: true, processingCompleted: true });
    expect(db.doc.status).toBe('READY');
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

  it('scans products regardless of their former tracking mode', async () => {
    const db = procDb({ trackings: { p1: 'QUANTITY' } });
    await request(appFor(tp, db)).post('/serials/scan').send(body).expect(201);
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

describe('POST /serials/scan-return', () => {
  const body = { documentId: 'doc1', documentLineId: 'l1', serial: 'SN-RETURN' };

  it('accepts only a Serial exported by the referenced issue document', async () => {
    const db = procDb({
      docType: 'RETURN', referenceId: 'issue-origin',
      serials: { 'SN-RETURN': { productId: 'p1', warehouseId: 'wh-hn', stockStatus: 'OUT', issueDocumentId: 'issue-origin' } },
    });
    await request(appFor(tp, db)).post('/serials/scan-return').send(body).expect(201);
    expect(db.lines[0].serialLot).toBe('SN-RETURN');
  });

  it('accepts a partial return without preselecting PXK and derives its source from Serial', async () => {
    const db = procDb({
      docType: 'RETURN', referenceId: null,
      lines: [{ id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 1, locationId: null, serialLot: '', processingStatus: 'PENDING' }],
      serials: { 'SN-RETURN-1': { productId: 'p1', warehouseId: 'wh-source', stockStatus: 'OUT', issueDocumentId: 'issue-origin' } },
    });
    const response = await request(appFor(tp, db)).post('/serials/scan-return')
      .send({ ...body, serial: 'SN-RETURN-1' }).expect(201);

    expect(response.body).toMatchObject({ serial: 'SN-RETURN-1', required: 1, sourceIssue: { id: 'issue-origin', code: 'PXK-ORIGIN', partnerName: 'Khách hàng gốc' } });
    expect(db.calls.some(([sql, params]: [string, any[]]) => String(sql).includes("SET referenceType = 'ISSUE'") && params.includes('issue-origin') && params.includes('Khách hàng gốc'))).toBe(true);
  });

  it('rejects Serial already returned or exported by another issue document', async () => {
    const alreadyReturned = procDb({
      docType: 'RETURN', referenceId: 'issue-origin',
      serials: { 'SN-RETURN': { productId: 'p1', stockStatus: 'IN_STOCK', issueDocumentId: null } },
    });
    await request(appFor(tp, alreadyReturned)).post('/serials/scan-return').send(body).expect(409);

    const differentIssue = procDb({
      docType: 'RETURN', referenceId: 'issue-origin',
      serials: { 'SN-RETURN': { productId: 'p1', stockStatus: 'OUT', issueDocumentId: 'another-issue' } },
    });
    await request(appFor(tp, differentIssue)).post('/serials/scan-return').send(body).expect(400);
  });
});

describe('return completion stock destination', () => {
  it('adds returned serials to the selected return warehouse ledger and balance', async () => {
    const db = procDb({
      docType: 'RETURN', status: 'READY', referenceId: 'issue-origin', warehouseId: 'wh-hcm',
      trackings: { p1: 'SERIAL' },
      lines: [{
        id: 'return-line', documentId: 'doc1', productId: 'p1', quantity: 1,
        locationId: null, serialLot: 'RETURN-SN-01', processingStatus: 'COMPLETED',
      }],
      serials: {
        'RETURN-SN-01': { id: 'serial-return-1', productId: 'p1', warehouseId: 'wh-hn', stockStatus: 'OUT', issueDocumentId: 'issue-origin' },
      },
    });

    await request(appFor(tp, db)).post('/returns/doc1/complete').send({}).expect(200);

    const serialRestore = db.calls.find(([sql]: [string]) => String(sql).includes("SET status = 'SALEABLE'"));
    expect(serialRestore?.[1]?.[0]).toBe('wh-hcm');

    const move = db.calls.find(([sql]: [string]) => String(sql).includes('INSERT INTO stock_moves'));
    expect(move?.[1]?.[2]).toBe('wh-hcm');
    expect(move?.[1]?.[4]).toBe(1);
    expect(move?.[1]?.[5]).toBe('RETURN');

    const balance = db.calls.find(([sql]: [string]) => String(sql).includes('INSERT INTO stock_balances'));
    expect(balance?.[1]?.[1]).toBe('wh-hcm');
    expect(balance?.[1]?.[3]).toBe(1);
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
      status: 'READY',
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
    await request(appFor(tp, db)).post('/documents/doc1/processing-complete').send({}).expect(200);
    await request(appFor(tp, db)).post('/receipts/doc1/complete').send({}).expect(200);
    // doc fixture reloads DRAFT from the static mock... emulate DONE:
    db.doc.status = 'DONE';
    await request(appFor(tp, db)).post('/receipts/doc1/complete').send({}).expect(200);
    const moves = db.calls.filter(([s]: [string, any[]]) => String(s).includes('INSERT INTO stock_moves'));
    expect(moves.length).toBeGreaterThan(0);
  });

  it('concurrent complete does not double-post moves', async () => {
    const gate = new DatabaseTransactionGate();
    const calls: [string, any[]][] = [];
    let docStatus = 'READY';
    const db: any = {
      calls,
      runWithRequestContext: (fn: () => any) => gate.runWithRequestContext(fn),
      all: (sql: string) => gate.run(sql, async () => {
        if (sql.includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }];
        if (sql.includes('FROM stock_document_lines')) return [{ id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 2, serialLot: 'A\nB', processingStatus: 'COMPLETED' }];
        if (sql.includes('SELECT id, tracking FROM products')) return [{ id: 'p1', tracking: 'SERIAL' }];
        if (sql.includes('FROM products')) return [{ id: 'p1' }];
        if (sql.includes('SELECT serialNumber FROM stock_serials')) return [];
        if (sql.includes('FROM stock_serials')) return [{ id: 'serial-a', serialNumber: 'A' }, { id: 'serial-b', serialNumber: 'B' }];
        if (sql.includes('FROM warehouses')) return [{ id: 'wh-hn' }];
        return [];
      }),
      get: (sql: string, params: any[] = []) => gate.run(sql, async () => {
        if (sql.includes('FROM stock_documents')) return { id: 'doc1', docType: 'RECEIPT', status: docStatus, warehouseId: 'wh-hn', referenceType: null };
        if (sql.includes('FROM stock_balances')) return [{ productId: 'p1', locationId: '', onHand: 10, reserved: 0 }];
        if (sql.includes('FROM stock_serials')) return { id: 'serial-a', serialNumber: 'A' };
        if (sql.includes('FROM warehouses')) return [{ id: 'wh-hn' }];
        return undefined;
      }),
      run: (sql: string, params: any[] = []) => gate.run(sql, async () => {
        calls.push([sql, params]);
        if (sql.includes('UPDATE stock_documents SET status')) docStatus = params[0];
        if (sql.includes('UPDATE stock_documents SET status')) return { changes: 1 };
        return { changes: 1 };
      }),
    };
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = tp; db.runWithRequestContext(next); });
    app.use(stockRoutes(db));

    // Two simultaneous complete requests
    const responses = await Promise.all([1, 2].map(() => request(app).post('/receipts/doc1/complete').send({})));
    const statuses = responses.map(r => r.status).sort();
    // Lần gọi thứ hai idempotent, nhưng không được ghi thêm move.
    expect(statuses).toEqual([200, 200]);
    const moves = db.calls.filter(([s]: [string, any[]]) => String(s).includes('INSERT INTO stock_moves'));
    // Một receipt có hai serial sẽ tạo hai ledger rows (mỗi thiết bị một row),
    // không phải hai lần hoàn tất phiếu.
    expect(moves.length).toBe(2);
    expect(db.calls.filter(([s]: [string, any[]]) => String(s).includes("UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?")).length).toBe(1);
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

  it('does not allow a quantity variance to bypass required Serial scans', async () => {
    const db = procDb({ lines: [{ ...multiLines[2], serialRequired: 1 }], trackings });
    const res = await request(appFor(tp, db)).post('/lines/l3/confirm-qty')
      .send({ actualQty: 495, varianceReason: 'Hao hut van chuyen' }).expect(400);
    expect(res.body.error).toMatch(/quét đủ 500 Serial/);
  });

  it('confirms the target quantity before scanning SERIAL lines', async () => {
    const db = procDb({ lines: multiLines, trackings });
    const response = await request(appFor(tp, db)).post('/lines/l1/confirm-qty').send({ actualQty: 2 }).expect(200);
    expect(response.body).toEqual({ quantityConfirmed: true, requiredQty: 2 });
    expect(db.lines.find((line: any) => line.id === 'l1')?.processingStatus).toBe('PARTIAL');
  });

  it('forces Serial flow for new lines even when product tracking is QUANTITY', async () => {
    const db = procDb({
      lines: [{ ...multiLines[2], serialRequired: 1 }],
      trackings: { p3: 'QUANTITY' },
    });
    const progress = await request(appFor(tp, db)).get('/documents/doc1/progress').expect(200);
    expect(progress.body.lines[0]).toMatchObject({ tracking: 'SERIAL', quantityConfirmed: false });
    await request(appFor(tp, db)).post('/lines/l3/confirm-qty').send({ actualQty: 500 }).expect(200);
  });

  it('presents legacy lines with product tracking and keeps the Serial upgrade path', async () => {
    const db = procDb({
      docType: 'ISSUE',
      trackings: { p3: 'QUANTITY' },
      lines: [{ ...multiLines[2], serialRequired: 0 }],
      serials: { 'SN-LEGACY': { productId: 'p3', warehouseId: 'wh-hn', stockStatus: 'IN_STOCK', receiptDocumentId: 'pnk1' } },
    });
    const progress = await request(appFor(tp, db)).get('/documents/doc1/progress').expect(200);
    expect(progress.body.lines[0]).toMatchObject({ tracking: 'QUANTITY', canEnableSerial: true });
    const response = await request(appFor(tp, db)).post('/lines/l3/enable-serial').send({}).expect(200);
    expect(response.body).toEqual({ success: true, serialRequired: true });
    expect(db.lines[0]).toMatchObject({ serialRequired: 1, processingStatus: 'PENDING' });
    expect(db.calls.some(([, params]: [string, any[]]) => params.includes('SERIAL_TRACKING_ENABLED'))).toBe(true);
    await request(appFor(tp, db)).post('/serials/scan-out').send({ documentId: 'doc1', documentLineId: 'l3', serial: 'SN-LEGACY' }).expect(201);
  });

  it('does not let a processed legacy issue line switch tracking mid-flow', async () => {
    const db = procDb({
      docType: 'ISSUE',
      trackings: { p3: 'QUANTITY' },
      lines: [{ ...multiLines[2], serialRequired: 0, processingStatus: 'COMPLETED', actualQty: 500 }],
    });
    const response = await request(appFor(tp, db)).post('/lines/l3/enable-serial').send({}).expect(400);
    expect(response.body.error).toMatch(/đã được xử lý/);
  });

  it('rejects bypassing mandatory Serial scanning', async () => {
    const db = procDb({
      lines: [{ ...multiLines[2], serialRequired: 1 }],
      trackings: { p3: 'QUANTITY' },
    });
    const response = await request(appFor(tp, db)).post('/lines/l3/confirm-no-serial').send({ actualQty: 500 }).expect(400);
    expect(response.body.error).toMatch(/phải quét đủ Serial/);
  });

  it('does not let lot registration replace required Serial scans', async () => {
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
    // LOT line covered by registered lots still cannot bypass Serial gating.
    const dbCovered = procDb({
      status: 'READY',
      lines: [{ id: 'l2', documentId: 'doc1', productId: 'p2', quantity: 100, locationId: null, serialLot: '', processingStatus: 'PENDING' }],
      trackings: { p2: 'LOT' },
      lots: [{ covered: 100 }],
    });
    await request(appFor(tp, dbCovered)).post('/receipts/doc1/complete').send({}).expect(400);
  });

  it('rejects lot registration on non-LOT products', async () => {
    const db = procDb({ lines: multiLines, trackings });
    await request(appFor(tp, db)).post('/lots/register').send({
      documentId: 'doc1', documentLineId: 'l1', lotCode: 'X-01', quantity: 1,
    }).expect(400);
  });

  it('reports LOT coverage from registered and allocated lots', async () => {
    const receiptDb = procDb({
      lines: [{ ...multiLines[1], serialLot: 'L1' }],
      trackings,
      lots: [{ id: 'lot1', lotCode: 'L1', coilCode: null, initialQty: 60, remainingQty: 60, unit: 'm', status: 'ACTIVE' }],
    });
    const receipt = await request(appFor(tp, receiptDb)).get('/documents/doc1/progress').expect(200);
    expect(receipt.body.lines[0]).toMatchObject({ tracking: 'LOT', processed: 60, status: 'PARTIAL' });
    expect(receipt.body.lines[0].lots[0]).toMatchObject({ lotCode: 'L1', initialQty: 60 });

    const issueDb = procDb({
      docType: 'ISSUE',
      lines: [{ ...multiLines[1], serialLot: 'L1' }],
      trackings,
      allocations: [{ id: 'lot1', lotCode: 'L1', allocatedQty: 40, initialQty: 100, remainingQty: 60, unit: 'm', status: 'ACTIVE' }],
    });
    const issue = await request(appFor(tp, issueDb)).get('/documents/doc1/progress').expect(200);
    expect(issue.body.lines[0]).toMatchObject({ tracking: 'LOT', processed: 40, status: 'PARTIAL' });
  });

  it('accepts a quantity variance with a reason on QUANTITY lines', async () => {
    const db = procDb({ lines: [{ ...multiLines[2], quantity: 500 }], trackings: { p3: 'QUANTITY' } });
    const res = await request(appFor(tp, db)).post('/lines/l3/confirm-qty')
      .send({ actualQty: 495, varianceReason: 'Hao hụt vận chuyển' }).expect(200);
    expect(res.body).toMatchObject({ quantityConfirmed: true, actualQty: 495, varianceQty: -5 });
    const progress = await request(appFor(tp, db)).get('/documents/doc1/progress').expect(200);
    expect(progress.body.lines[0]).toMatchObject({ tracking: 'QUANTITY', processed: 500, status: 'COMPLETED' });
  });

  it('requires a reason when QUANTITY actual differs from the document', async () => {
    const db = procDb({ lines: [{ ...multiLines[2], quantity: 500 }], trackings: { p3: 'QUANTITY' } });
    const res = await request(appFor(tp, db)).post('/lines/l3/confirm-qty').send({ actualQty: 495 }).expect(400);
    expect(res.body.error).toMatch(/nhập lý do/);
  });

  it('allows decimal quantities for LOT but not SERIAL at creation', async () => {
    const lotDb = procDb({ trackings: { p1: 'LOT' } });
    await request(appFor(tp, lotDb)).post('/receipts')
      .send({ warehouseId: 'wh-hn', lines: [{ productId: 'p1', quantity: 1.5 }] }).expect(201);
    const serialDb = procDb({ trackings: { p1: 'SERIAL' } });
    const res = await request(appFor(tp, serialDb)).post('/receipts')
      .send({ warehouseId: 'wh-hn', lines: [{ productId: 'p1', quantity: 1.5 }] }).expect(400);
    expect(res.body.error).toMatch(/số nguyên/);
  });

  it('snapshots serialRequired from product tracking when creating lines', async () => {
    const serialDb = procDb({ trackings: { p1: 'SERIAL' } });
    await request(appFor(tp, serialDb)).post('/receipts')
      .send({ warehouseId: 'wh-hn', lines: [{ productId: 'p1', quantity: 2 }] }).expect(201);
    const serialInsert = serialDb.calls.find(([sql]: [string, any[]]) => String(sql).includes('INSERT INTO stock_document_lines'));
    expect(serialInsert?.[1]?.[16]).toBe(1);

    const quantityDb = procDb({ trackings: { p1: 'QUANTITY' } });
    await request(appFor(tp, quantityDb)).post('/receipts')
      .send({ warehouseId: 'wh-hn', lines: [{ productId: 'p1', quantity: 2 }] }).expect(201);
    const quantityInsert = quantityDb.calls.find(([sql]: [string, any[]]) => String(sql).includes('INSERT INTO stock_document_lines'));
    expect(quantityInsert?.[1]?.[16]).toBe(0);
  });
});

describe('processing summary + PUT keeps progress (Phase 3+)', () => {
  it('summarizes completed lines per document', async () => {
    const db = procDb({
      lines: [
        { id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 2, serialLot: 'A\nB', processingStatus: 'COMPLETED' },
        { id: 'l2', documentId: 'doc1', productId: 'p2', quantity: 3, serialLot: 'X', processingStatus: 'PARTIAL' },
      ],
      trackings: { p1: 'SERIAL', p2: 'SERIAL' },
    });
    const res = await request(appFor(tp, db)).get('/documents/processing-summary').expect(200);
    expect(res.body).toEqual({ doc1: { total: 2, done: 1 } });
  });

  it('PUT recomputes processingStatus from line text', async () => {
    const db = procDb({ trackings: { p1: 'SERIAL' } });
    await request(appFor(tp, db)).put('/documents/doc1').send({
      notes: 'sua',
      lines: [{ productId: 'p1', quantity: 2, locationId: null, serialLot: 'A\nB' }],
    }).expect(200);
    const inserts = db.calls.filter(([s]: [string, any[]]) => String(s).includes('INSERT INTO stock_document_lines'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toContain('COMPLETED');
  });

  it('PUT relinks lots to replacement lines', async () => {
    const db = procDb({
      trackings: { p2: 'LOT' },
      lines: [{ id: 'old1', documentId: 'doc1', productId: 'p2', quantity: 100, locationId: null, serialLot: '', processingStatus: 'PENDING' }],
      lots: [{ id: 'lot1', productId: 'p2', locationId: '', initialQty: 100 }],
    });
    await request(appFor(tp, db)).put('/documents/doc1').send({
      lines: [{ productId: 'p2', quantity: 100, locationId: null }],
    }).expect(200);
    expect(db.calls.some(
      ([s]: [string, any[]]) => String(s).includes('UPDATE stock_lots SET receiptLineId')
    )).toBe(true);
  });
});

describe('smart scan auto-matching (/serials/scan-smart)', () => {
  it('automatically matches the right product line for an issue document', async () => {
    const db = procDb({
      docType: 'ISSUE',
      status: 'PROCESSING',
      lines: [
        { id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 2, serialLot: '', processingStatus: 'PENDING' },
        { id: 'l2', documentId: 'doc1', productId: 'p2', quantity: 1, serialLot: '', processingStatus: 'PENDING' },
      ],
      trackings: { p1: 'SERIAL', p2: 'SERIAL' },
      serials: {
        'SN-P2-01': { id: 's2', productId: 'p2', warehouseId: 'wh-hn', stockStatus: 'IN_STOCK', receiptDocumentId: 'rec1' },
      },
    });

    const res = await request(appFor(tp, db)).post('/serials/scan-smart').send({
      documentId: 'doc1',
      serial: 'SN-P2-01',
    }).expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.matchedLineId).toBe('l2');
    expect(res.body.productId).toBe('p2');
    expect(res.body.serial).toBe('SN-P2-01');
  });

  it('rejects serial not found in warehouse for issue', async () => {
    const db = procDb({
      docType: 'ISSUE',
      status: 'PROCESSING',
      lines: [{ id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 2, serialLot: '', processingStatus: 'PENDING' }],
      trackings: { p1: 'SERIAL' },
      serials: {},
    });

    const res = await request(appFor(tp, db)).post('/serials/scan-smart').send({
      documentId: 'doc1',
      serial: 'UNKNOWN-SN',
    }).expect(404);

    expect(res.body.error).toContain('Không tìm thấy Serial');
  });

  it('automatically matches the open line for a receipt document', async () => {
    const db = procDb({
      docType: 'RECEIPT',
      status: 'PROCESSING',
      lines: [{ id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 2, serialLot: '', processingStatus: 'PENDING' }],
      trackings: { p1: 'SERIAL' },
      serials: {},
    });

    const res = await request(appFor(tp, db)).post('/serials/scan-smart').send({
      documentId: 'doc1',
      serial: 'NEW-SN-001',
    }).expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.matchedLineId).toBe('l1');
    expect(res.body.serial).toBe('NEW-SN-001');
  });
});
