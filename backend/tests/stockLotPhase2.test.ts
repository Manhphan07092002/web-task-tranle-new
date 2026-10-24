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

/** Ledger giả lập đủ cho các luồng LOT: nhập, điều chuyển xuất/nhận. */
function ledger(doc: any, line: any, opts: {
  tracking?: string;
  allocations?: Record<string, number>;
  sourceLots?: any[];
  links?: any[];
} = {}) {
  const state = {
    doc: { ...doc },
    line: { ...line },
    lots: (opts.sourceLots || []).map((lot) => ({ ...lot })),
    allocations: { ...(opts.allocations || {}) },
    links: (opts.links || []).map((link) => ({ ...link })),
    moves: [] as any[],
    lotMovements: [] as any[],
  };

  const db: any = {
    state,
    all: async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-1' }, { warehouseId: 'wh-2' }];
      if (sql.includes('SELECT id, tracking FROM products')) {
        return [{ id: state.line.productId, tracking: opts.tracking || 'LOT' }];
      }
      if (sql.includes('FROM products')) return [{ id: state.line.productId }];
      if (sql.includes('FROM stock_document_lines')) return [{ ...state.line }];
      if (sql.includes('FROM stock_document_line_lots')) {
        return Object.entries(state.allocations).map(([lotId, quantity]) => ({
          lotId, quantity, lotCode: state.lots.find((lot) => lot.id === lotId)?.lotCode,
        }));
      }
      if (sql.includes('FROM stock_lots') && sql.includes('receiptDocumentId')) {
        return state.lots
          .filter((lot) => lot.receiptDocumentId === state.doc.id && lot.receiptLineId === state.line.id)
          .map((lot) => ({ lotId: lot.id, quantity: lot.initialQty }));
      }
      if (sql.includes('FROM stock_lots')) return state.lots.map((lot) => ({ ...lot }));
      if (sql.includes('FROM stock_transfer_line_lots')) {
        if (sql.includes('destLotId AS lotId')) {
          return state.links
            .filter((link) => link.destLotId)
            .map((link) => ({ lotId: link.destLotId, quantity: link.quantity }));
        }
        return state.links.map((link) => {
          const source = state.lots.find((lot) => lot.id === link.sourceLotId);
          return { ...link, productId: source?.productId, lotCode: source?.lotCode, unit: source?.unit };
        });
      }
      if (sql.includes('FROM stock_serials')) return [];
      if (sql.includes('FROM stock_balances')) {
        return [{ productId: state.line.productId, locationId: '', onHand: 100, reserved: 0 }];
      }
      if (sql.includes('FROM warehouses')) return [{ id: 'wh-1' }, { id: 'wh-2' }];
      return [];
    },
    get: async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM stock_documents')) {
        if (params[0] === state.doc.id) return { ...state.doc };
        return { id: params[0], docType: 'ISSUE', status: 'DONE', code: 'PXK-ORIGIN', partnerName: 'KH' };
      }
      if (sql.includes('FROM stock_counts')) return undefined;
      if (sql.includes('FROM stock_locations')) return { warehouseId: params[0], isActive: 1, purpose: 'SALEABLE' };
      if (sql.includes('FROM products')) return { id: state.line.productId };
      if (sql.includes('FROM stock_lots') && sql.includes('SUM(initialQty)')) {
        const total = state.lots
          .filter((lot) => lot.receiptDocumentId === state.doc.id && lot.receiptLineId === state.line.id)
          .reduce((sum, lot) => sum + Number(lot.initialQty || 0), 0);
        return { total };
      }
      if (sql.includes('FROM stock_document_line_lots') && sql.includes('SUM(quantity)')) {
        const total = Object.values(state.allocations).reduce((sum, qty) => sum + Number(qty), 0);
        return { total };
      }
      if (sql.includes('FROM stock_lots')) {
        if (sql.includes('lotCode = ?')) {
          return state.lots.find((lot) =>
            lot.productId === params[0] && lot.warehouseId === params[1] && lot.lotCode === params[2]);
        }
        return state.lots.find((lot) => lot.id === params[0]);
      }
      if (sql.includes('FROM stock_balances')) return { onHand: 100, reserved: 0 };
      return undefined;
    },
    run: async (sql: string, params: any[] = []) => {
      if (sql.includes('INSERT INTO stock_moves')) state.moves.push(params);
      if (sql.includes('INSERT INTO stock_lot_movements')) state.lotMovements.push(params);
      if (sql.includes('INSERT INTO stock_transfer_line_lots')) {
        state.links.push({
          id: params[0], documentLineId: params[1], sourceLotId: params[2],
          quantity: Number(params[3]), destLotId: null,
        });
      }
      if (sql.includes('UPDATE stock_transfer_line_lots SET destLotId')) {
        const link = state.links.find((row) => row.id === params[1]);
        if (link) link.destLotId = params[0];
      }
      if (sql.includes('INSERT INTO stock_lots')) {
        state.lots.push({
          id: params[0], productId: params[1], lotCode: params[2], warehouseId: params[4],
          locationId: params[5], initialQty: Number(params[6]), remainingQty: Number(params[7]),
          receiptDocumentId: params[11], receiptLineId: params[12], status: 'ACTIVE',
        });
      }
      if (sql.includes('UPDATE stock_lots SET remainingQty')) {
        const lot = state.lots.find((row) => row.id === params[3]);
        if (lot) {
          lot.remainingQty -= Number(params[0]);
          if (lot.remainingQty <= 0) lot.status = 'DEPLETED';
        }
      }
      if (sql.includes('UPDATE stock_lots SET initialQty')) {
        const lot = state.lots.find((row) => row.id === params[4]);
        if (lot) {
          lot.initialQty += Number(params[0]);
          lot.remainingQty += Number(params[1]);
        }
      }
      if (sql.includes('UPDATE stock_documents SET status')) state.doc.status = params[0];
      if (sql.includes('UPDATE stock_document_lines SET serialLot')) state.line.serialLot = params[0];
      return { changes: 1 };
    },
  };
  return db;
}

const receiptDoc = {
  id: 'receipt-1', docType: 'RECEIPT', status: 'READY', warehouseId: 'wh-1',
  referenceType: null, code: 'PNK-26-0001',
};
const receiptLine = {
  id: 'line-1', documentId: 'receipt-1', productId: 'product-1',
  quantity: 10, locationId: null, serialLot: '',
};
const registeredLots = [
  { id: 'lotA', productId: 'product-1', lotCode: 'A', warehouseId: 'wh-1', locationId: null, initialQty: 6, remainingQty: 6, status: 'ACTIVE', receiptDocumentId: 'receipt-1', receiptLineId: 'line-1' },
  { id: 'lotB', productId: 'product-1', lotCode: 'B', warehouseId: 'wh-1', locationId: null, initialQty: 4, remainingQty: 4, status: 'ACTIVE', receiptDocumentId: 'receipt-1', receiptLineId: 'line-1' },
];

const transferDoc = {
  id: 'transfer-1', docType: 'TRANSFER', status: 'READY', sourceWarehouseId: 'wh-1',
  destWarehouseId: 'wh-2', referenceType: null,
};
const transferLine = {
  id: 'line-1', documentId: 'transfer-1', productId: 'product-1',
  quantity: 10, locationId: null, serialLot: '',
};
const sourceLots = [
  { id: 'lotA', productId: 'product-1', lotCode: 'A', warehouseId: 'wh-1', locationId: null, initialQty: 100, remainingQty: 100, status: 'ACTIVE' },
  { id: 'lotB', productId: 'product-1', lotCode: 'B', warehouseId: 'wh-1', locationId: null, initialQty: 100, remainingQty: 100, status: 'ACTIVE' },
];

describe('LOT receipt posting', () => {
  it('posts one move per registered lot instead of one per line', async () => {
    const db = ledger(receiptDoc, receiptLine, { sourceLots: registeredLots });
    const response = await request(appFor(db)).post('/receipts/receipt-1/complete').send({});
    expect(response.status, response.body.error).toBe(200);
    expect(db.state.moves).toHaveLength(2);
    expect(db.state.moves.map((params: any[]) => params[4])).toEqual([6, 4]);
    expect(db.state.moves.map((params: any[]) => params[10])).toEqual(['lotA', 'lotB']);
  });

  it('blocks completion until the registered lot quantity covers the line', async () => {
    const db = ledger(receiptDoc, receiptLine, { sourceLots: [registeredLots[0]] });
    const response = await request(appFor(db)).post('/receipts/receipt-1/complete').send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Chưa đủ Lô/);
    expect(db.state.moves).toHaveLength(0);
  });
});

describe('LOT transfer ship/receive posting', () => {
  it('ships by allocated lot and records source lot mapping', async () => {
    const db = ledger(transferDoc, transferLine, {
      allocations: { lotA: 6, lotB: 4 },
      sourceLots,
    });
    const response = await request(appFor(db)).post('/transfers/transfer-1/ship').send({});
    expect(response.status, response.body.error).toBe(200);
    expect(db.state.moves).toHaveLength(2);
    expect(db.state.moves.map((params: any[]) => params[4])).toEqual([-6, -4]);
    expect(db.state.moves.map((params: any[]) => params[10])).toEqual(['lotA', 'lotB']);
    expect(db.state.links).toHaveLength(2);
    expect(db.state.lots.find((lot: any) => lot.id === 'lotA')?.remainingQty).toBe(94);
    expect(db.state.lots.find((lot: any) => lot.id === 'lotB')?.remainingQty).toBe(96);
  });

  it('receives by destination lot and posts inbound moves', async () => {
    const db = ledger(
      { ...transferDoc, status: 'IN_TRANSIT' },
      transferLine,
      {
        allocations: { lotA: 6, lotB: 4 },
        sourceLots,
        links: [
          { id: 'linkA', documentLineId: 'line-1', sourceLotId: 'lotA', quantity: 6, destLotId: null },
          { id: 'linkB', documentLineId: 'line-1', sourceLotId: 'lotB', quantity: 4, destLotId: null },
        ],
      }
    );
    const response = await request(appFor(db)).post('/transfers/transfer-1/receive').send({});
    expect(response.status, response.body.error).toBe(200);
    const destLotIds = db.state.links.map((link: any) => link.destLotId);
    expect(destLotIds.every(Boolean)).toBe(true);
    expect(db.state.moves).toHaveLength(2);
    expect(db.state.moves.map((params: any[]) => params[4])).toEqual([6, 4]);
    expect(db.state.moves.map((params: any[]) => params[10])).toEqual(destLotIds);
    expect(db.state.lotMovements.map((params: any[]) => params[4])).toEqual([6, 4]);
  });
});
