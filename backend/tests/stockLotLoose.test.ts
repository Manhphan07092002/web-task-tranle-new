import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { stockRoutes } from '../routes/stock.js';

const manager = { id: 'manager', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };

function appFor(db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = manager; next(); });
  app.use(stockRoutes(db));
  return app;
}

type Mode = 'LOT' | 'LOOSE';

/** Mock đủ cho luồng xuất lẻ: mode tracking, lô còn tồn, tồn kho và audit. */
function looseLedger(opts: {
  doc: any;
  lines: any[];
  lots?: any[];
  tracking?: string;
  mode?: Mode;
  onHand?: number;
  allocations?: any[];
}) {
  const state = {
    doc: { ...opts.doc },
    lines: opts.lines.map((line) => ({ ...line })),
    lots: (opts.lots || []).map((lot) => ({ ...lot })),
    tracking: opts.tracking || 'LOT',
    mode: opts.mode || 'LOT',
    onHand: opts.onHand ?? 30,
    allocations: (opts.allocations || []).map((row) => ({ ...row })),
    moves: [] as any[],
    lotMovements: [] as any[],
    activities: [] as any[],
    lineUpdates: [] as any[],
    trackingUpdates: [] as any[],
  };

  const db: any = {
    state,
    all: async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-1' }];
      if (sql.includes('SELECT id, tracking FROM products')) {
        return [{ id: state.lines[0]?.productId, tracking: state.tracking }];
      }
      if (sql.includes('FROM products')) return [{ id: state.lines[0]?.productId }];
      if (sql.includes('FROM warehouses')) return [{ id: 'wh-1' }];
      if (sql.includes('FROM stock_documents')) return [{ ...state.doc }];
      if (sql.includes('FROM stock_document_lines')) return state.lines.map((line) => ({ ...line }));
      if (sql.includes('FROM stock_lot_tracking')) {
        if (sql.includes('NOT EXISTS')) {
          return state.mode === 'LOOSE' && state.onHand <= 0
            ? [{ productId: state.lines[0]?.productId, warehouseId: 'wh-1' }]
            : [];
        }
        return state.mode === 'LOOSE'
          ? [{ productId: state.lines[0]?.productId, warehouseId: 'wh-1', mode: 'LOOSE' }]
          : [];
      }
      if (sql.includes('FROM stock_document_line_lots')) {
        return state.allocations.map((row) => ({ ...row, lotCode: row.lotCode || row.lotId }));
      }
      if (sql.includes('FROM stock_lots')) {
        return state.lots.filter((lot) => Number(lot.remainingQty) > 0).map((lot) => ({ ...lot }));
      }
      if (sql.includes('FROM stock_balances')) {
        return [{ productId: state.lines[0]?.productId, locationId: '', onHand: state.onHand, reserved: 0 }];
      }
      if (sql.includes('FROM stock_locations')) return [];
      if (sql.includes('FROM stock_serials')) return [];
      if (sql.includes('FROM stock_document_line_reservations')) return [];
      return [];
    },
    get: async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM stock_documents')) return { ...state.doc };
      if (sql.includes('FROM stock_document_lines')) return state.lines.find((line) => line.id === params[0]) || undefined;
      if (sql.includes('FROM stock_lot_tracking')) {
        return state.mode === 'LOOSE'
          ? { productId: params[0], warehouseId: params[1], mode: 'LOOSE' }
          : undefined;
      }
      if (sql.includes('FROM stock_document_line_lots')) {
        return state.allocations.length > 0 ? { ...state.allocations[0] } : undefined;
      }
      if (sql.includes('FROM stock_lot_movements')) return undefined;
      if (sql.includes('FROM stock_lots')) {
        if (sql.includes('lotCode = ?')) {
          return state.lots.find((lot) => lot.productId === params[0] && lot.warehouseId === params[1] && lot.lotCode === params[2]);
        }
        return state.lots.find((lot) => lot.id === params[0]);
      }
      if (sql.includes('FROM stock_balances')) return { productId: state.lines[0]?.productId, onHand: state.onHand, reserved: 0 };
      if (sql.includes('FROM stock_locations')) return { warehouseId: params[0], isActive: 1, purpose: 'SALEABLE' };
      if (sql.includes('FROM products')) return { id: state.lines[0]?.productId, tracking: state.tracking };
      if (sql.includes('FROM stock_counts')) return undefined;
      return undefined;
    },
    run: async (sql: string, params: any[] = []) => {
      if (sql.includes('UPDATE stock_lots SET remainingQty = 0')) {
        const lot = state.lots.find((row) => row.id === params[2]);
        if (lot) { lot.remainingQty = 0; lot.status = 'DEPLETED'; }
      }
      if (sql.includes('INSERT INTO stock_lot_tracking')) state.mode = 'LOOSE';
      if (sql.includes('UPDATE stock_lot_tracking SET mode = ')) {
        state.mode = 'LOT';
        state.trackingUpdates.push(params);
      }
      if (sql.includes('INSERT INTO stock_lot_movements')) state.lotMovements.push({ sql, params });
      if (sql.includes('INSERT INTO stock_lots')) {
        state.lots.push({
          id: params[0], productId: params[1], lotCode: params[2], warehouseId: params[4],
          locationId: params[5], initialQty: Number(params[6]), remainingQty: Number(params[7]),
          receiptDocumentId: params[11], receiptLineId: params[12], status: params[13],
        });
      }
      if (sql.includes('INSERT INTO stock_moves')) state.moves.push(params);
      if (sql.includes('INSERT INTO stock_balances')) {
        state.onHand += Number(params[3] || 0);
      }
      if (sql.includes('INSERT INTO warehouse_activity_logs')) state.activities.push(params);
      if (sql.includes('SET lotIssueMode')) state.lineUpdates.push(params);
      if (sql.includes('UPDATE stock_documents SET status')) state.doc.status = params[0];
      return { changes: 1 };
    },
  };
  return db;
}

const issueDoc = {
  id: 'issue-1', docType: 'ISSUE', status: 'READY', warehouseId: 'wh-1',
  code: 'PXK-26-0001', partnerName: 'KH A', createdBy: manager.id,
};
const issueLine = {
  id: 'line-1', documentId: 'issue-1', productId: 'product-1', quantity: 5,
  locationId: '', serialLot: '', serialRequired: 0, processingStatus: 'COMPLETED', lotIssueMode: 'LOOSE',
};
const residualLots = [
  { id: 'lotA', productId: 'product-1', lotCode: 'A', warehouseId: 'wh-1', locationId: null, initialQty: 10, remainingQty: 10, status: 'ACTIVE' },
  { id: 'lotB', productId: 'product-1', lotCode: 'B', warehouseId: 'wh-1', locationId: null, initialQty: 5, remainingQty: 5, status: 'ACTIVE' },
];

describe('loose lot issue', () => {
  it('breaks every remaining lot of the whole product on completion', async () => {
    const db = looseLedger({ doc: issueDoc, lines: [issueLine], lots: residualLots, onHand: 30 });
    const res = await request(appFor(db)).post('/issues/issue-1/complete').send({});
    expect(res.status, res.body.error).toBe(200);

    expect(db.state.lots.map((lot: any) => [lot.lotCode, Number(lot.remainingQty), lot.status]))
      .toEqual([['A', 0, 'DEPLETED'], ['B', 0, 'DEPLETED']]);
    expect(db.state.mode).toBe('LOOSE');
    const broken = db.state.lotMovements.filter(({ sql }: any) => sql.includes("'LOT_BROKEN'"));
    expect(broken.map(({ params }: any) => params[4]).sort((a: number, b: number) => a - b)).toEqual([-10, -5]);
    expect(db.state.activities.map((params: any[]) => params[1])).toContain('LOT_MODE_BROKEN');

    expect(db.state.moves).toHaveLength(1);
    expect(db.state.moves[0][4]).toBe(-5);
    expect(db.state.moves[0][10]).toBeNull();
  });

  it('lets loose issues continue while the warehouse stays in LOOSE mode', async () => {
    const db = looseLedger({ doc: issueDoc, lines: [issueLine], lots: [], mode: 'LOOSE', onHand: 30 });
    const res = await request(appFor(db)).post('/issues/issue-1/complete').send({});
    expect(res.status, res.body.error).toBe(200);
    expect(db.state.moves).toHaveLength(1);
    expect(db.state.trackingUpdates).toHaveLength(0);
  });

  it('resets the product back to LOT once stock reaches zero', async () => {
    const db = looseLedger({
      doc: issueDoc,
      lines: [{ ...issueLine, quantity: 30 }],
      lots: [],
      mode: 'LOOSE',
      onHand: 30,
    });
    const res = await request(appFor(db)).post('/issues/issue-1/complete').send({});
    expect(res.status, res.body.error).toBe(200);
    expect(db.state.onHand).toBe(0);
    expect(db.state.mode).toBe('LOT');
    expect(db.state.trackingUpdates).toHaveLength(1);
    expect(db.state.activities.map((params: any[]) => params[1])).toContain('LOT_MODE_RESET');
  });
});

describe('loose lot receipts', () => {
  const receiptDoc = {
    id: 'receipt-1', docType: 'RECEIPT', status: 'DRAFT', warehouseId: 'wh-1',
    code: 'PNK-26-0001', partnerName: 'NCC A',
  };
  const receiptLine = {
    id: 'line-1', documentId: 'receipt-1', productId: 'product-1', quantity: 10,
    locationId: null, serialLot: '', processingStatus: 'PENDING',
  };

  it('records lots without making them selectable', async () => {
    const db = looseLedger({ doc: receiptDoc, lines: [receiptLine], lots: [], mode: 'LOOSE' });
    const res = await request(appFor(db)).post('/lots/register').send({
      documentId: 'receipt-1', documentLineId: 'line-1', lotCode: 'L-1', quantity: 10,
    });
    expect(res.status, res.body.error).toBe(201);
    expect(res.body.recorded).toBe(true);
    expect(db.state.lots).toHaveLength(1);
    expect(db.state.lots[0].status).toBe('RECORDED');
    expect(Number(db.state.lots[0].remainingQty)).toBe(0);
    expect(Number(db.state.lots[0].initialQty)).toBe(10);
    expect(db.state.lotMovements.map(({ params }: any) => params[5])).toContain('RECEIPT_RECORDED');
  });
});

describe('loose lot guards', () => {
  it('does not break lots when the draft issue is cancelled', async () => {
    const db = looseLedger({
      doc: { ...issueDoc, status: 'DRAFT' },
      lines: [issueLine],
      lots: residualLots,
      mode: 'LOOSE',
    });
    const res = await request(appFor(db)).post('/documents/issue-1/cancel').send({});
    expect(res.status, res.body.error).toBe(200);
    expect(db.state.lots.map((lot: any) => Number(lot.remainingQty))).toEqual([10, 5]);
    expect(db.state.activities.map((params: any[]) => params[1])).not.toContain('LOT_MODE_BROKEN');
  });

  it('blocks lot allocation with LOT_MODE_BROKEN', async () => {
    const db = looseLedger({
      doc: { ...issueDoc, status: 'DRAFT' },
      lines: [{ ...issueLine, lotIssueMode: null }],
      lots: residualLots,
      mode: 'LOOSE',
    });
    const res = await request(appFor(db)).post('/lots/allocate').send({
      documentId: 'issue-1', documentLineId: 'line-1', lotCode: 'A', quantity: 1,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LOT_MODE_BROKEN');
  });

  it('blocks confirmation when the line already has lot allocations', async () => {
    const db = looseLedger({
      doc: { ...issueDoc, status: 'DRAFT' },
      lines: [{ ...issueLine, lotIssueMode: null }],
      lots: residualLots,
      allocations: [{ id: 'alloc-1', documentLineId: 'line-1', lotId: 'lotA', quantity: 1 }],
    });
    const res = await request(appFor(db)).post('/lines/line-1/confirm-loose-lot').send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/phân bổ lô/i);
  });

  it('confirms loose issue for every line of the product and previews affected lots', async () => {
    const db = looseLedger({
      doc: { ...issueDoc, status: 'DRAFT' },
      lines: [
        { ...issueLine, lotIssueMode: null },
        { ...issueLine, id: 'line-2', lotIssueMode: null, quantity: 3 },
      ],
      lots: residualLots,
    });
    const res = await request(appFor(db)).post('/lines/line-1/confirm-loose-lot').send({});
    expect(res.status, res.body.error).toBe(200);
    expect(res.body.alreadyBroken).toBe(false);
    expect(res.body.lineIds.sort()).toEqual(['line-1', 'line-2']);
    expect(res.body.quantity).toBe(15);
    expect(db.state.lineUpdates).toHaveLength(1);
    expect(db.state.lineUpdates[0][0]).toBe('issue-1');
    expect(db.state.lineUpdates[0][1]).toBe('product-1');
    expect(db.state.mode).toBe('LOT');
  });

  it('reports tracking mode, affected lots and on-hand stock', async () => {
    const db = looseLedger({
      doc: issueDoc, lines: [issueLine], lots: residualLots, mode: 'LOOSE', onHand: 15,
    });
    const res = await request(appFor(db)).get('/lot-tracking/product-1/wh-1').expect(200);
    expect(res.body.mode).toBe('LOOSE');
    expect(res.body.onHand).toBe(15);
    expect(res.body.lots.map((lot: any) => lot.lotCode).sort()).toEqual(['A', 'B']);
    expect(res.body.affectedQuantity).toBe(15);
  });
});
