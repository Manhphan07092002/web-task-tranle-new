import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { stockRoutes } from '../routes/stock.js';

const manager = { id: 'manager', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };

function lotDb() {
  const doc: any = { id: 'issue-1', docType: 'ISSUE', status: 'DRAFT', warehouseId: 'wh-1', referenceType: null };
  const line: any = { id: 'line-1', documentId: doc.id, productId: 'product-1', quantity: 50, locationId: '', serialLot: '', processingStatus: 'PENDING' };
  const lots: Record<string, any> = {
    lotA: { id: 'lotA', lotCode: 'A', productId: 'product-1', warehouseId: 'wh-1', remainingQty: 100, status: 'ACTIVE' },
    lotB: { id: 'lotB', lotCode: 'B', productId: 'product-1', warehouseId: 'wh-1', remainingQty: 50, status: 'ACTIVE' },
  };
  const allocations: Record<string, number> = {};
  const movements: any[] = [];
  const moves: any[] = [];

  const db: any = {
    doc, line, lots, allocations, movements, moves,
    all: async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-1' }];
      if (sql.includes('SELECT id, tracking FROM products')) return [{ id: 'product-1', tracking: 'LOT' }];
      if (sql.includes('FROM products')) return [{ id: 'product-1' }];
      if (sql.includes('FROM stock_document_lines')) return [{ ...line }];
      if (sql.includes('FROM stock_document_line_lots')) {
        return Object.entries(allocations).map(([lotId, quantity]) => ({
          lotId, quantity, lotCode: lots[lotId].lotCode,
          id: lotId, productId: 'product-1', warehouseId: 'wh-1',
          initialQty: 100, remainingQty: lots[lotId].remainingQty, status: lots[lotId].status,
        }));
      }
      if (sql.includes('FROM stock_balances')) return [{ productId: 'product-1', locationId: '', onHand: 100, reserved: 0 }];
      if (sql.includes('FROM warehouses')) return [{ id: 'wh-1' }];
      if (sql.includes('FROM stock_serials')) return [];
      return [];
    },
    get: async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM stock_documents')) return { ...doc };
      if (sql.includes('FROM stock_document_lines')) return { ...line };
      if (sql.includes('FROM stock_lots')) {
        if (sql.includes('lotCode = ?')) return Object.values(lots).find((lot) => lot.lotCode === params[0]);
        return lots[params[0]];
      }
      if (sql.includes('FROM stock_document_line_lots')) {
        if (sql.includes('SUM(quantity)') || sql.includes('SUM(a.quantity)')) {
          const total = Object.values(allocations).reduce((sum, q) => sum + q, 0);
          return { total, covered: total };
        }
        return allocations[params[1]] ? { quantity: allocations[params[1]] } : undefined;
      }
      if (sql.includes('FROM stock_balances')) return { onHand: 100, reserved: 0 };
      if (sql.includes('FROM stock_counts')) return undefined;
      if (sql.includes('FROM stock_locations')) return undefined;
      return undefined;
    },
    run: async (sql: string, params: any[] = []) => {
      if (sql.includes('INSERT INTO stock_document_line_lots')) allocations[params[2]] = Number(params[3]);
      if (sql.includes('UPDATE stock_document_line_lots SET quantity')) allocations[params[4]] += Number(params[0]);
      if (sql.includes('UPDATE stock_lots SET remainingQty')) lots[params[3]].remainingQty -= Number(params[0]);
      if (sql.includes('INSERT INTO stock_lot_movements')) movements.push({ lotId: params[1], quantity: params[4], moveType: 'ISSUE' });
      if (sql.includes('INSERT INTO stock_moves')) moves.push(params);
      if (sql.includes('UPDATE stock_document_lines SET serialLot')) { line.serialLot = params[0]; line.processingStatus = params[1]; }
      if (sql.includes('UPDATE stock_documents SET status')) doc.status = params[0];
      return { changes: 1 };
    },
  };
  return db;
}

function appFor(db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = manager; next(); });
  app.use(stockRoutes(db));
  return app;
}

describe('LOT outbound allocation', () => {
  it('allocates one issue across two lots and decrements remainingQty on complete', async () => {
    const db = lotDb();
    const app = appFor(db);

    await request(app).post('/lots/allocate').send({ documentId: 'issue-1', documentLineId: 'line-1', lotCode: 'A', quantity: 10 }).expect(201);
    await request(app).post('/lots/allocate').send({ documentId: 'issue-1', documentLineId: 'line-1', lotCode: 'B', quantity: 40 }).expect(201);
    expect(db.allocations).toEqual({ lotA: 10, lotB: 40 });
    // Ghi sổ chỉ được phép sau khi bước xử lý hàng hóa đã hoàn tất.
    db.doc.status = 'READY';
    db.line.processingStatus = 'COMPLETED';
    const complete = await request(app).post('/issues/issue-1/complete').send({});
    expect(complete.status, complete.body.error || JSON.stringify(complete.body)).toBe(200);

    expect(db.lots.lotA.remainingQty).toBe(90);
    expect(db.lots.lotB.remainingQty).toBe(10);
    expect(db.movements).toEqual([
      expect.objectContaining({ lotId: 'lotA', quantity: -10, moveType: 'ISSUE' }),
      expect.objectContaining({ lotId: 'lotB', quantity: -40, moveType: 'ISSUE' }),
    ]);
    expect(db.moves).toHaveLength(2);
  });

  it('rejects allocation beyond the lot remaining quantity', async () => {
    const db = lotDb();
    await request(appFor(db)).post('/lots/allocate').send({ documentId: 'issue-1', documentLineId: 'line-1', lotCode: 'A', quantity: 101 }).expect(400);
    expect(db.allocations).toEqual({});
  });
});
