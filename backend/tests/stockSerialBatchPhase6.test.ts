import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { stockRoutes } from '../routes/stock.js';

const manager = { id: 'manager', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };

function appFor(db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = manager; next(); });
  app.use(stockRoutes(db));
  return app;
}

function batchDb(opts: { doc: any; lines: any[]; products?: any[]; serials?: any[] }) {
  const allCalls: [string, any[]][] = [];
  const runCalls: [string, any[]][] = [];
  const getCalls: string[] = [];
  const db: any = {
    allCalls,
    runCalls,
    getCalls,
    all: vi.fn(async (sql: string, params: any[] = []) => {
      allCalls.push([sql, params]);
      if (sql.includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }, { warehouseId: 'wh-hcm' }];
      if (sql.includes('SELECT id, tracking FROM products')) {
        return (opts.products || []).map((p) => ({ id: p.id, tracking: p.tracking }));
      }
      if (sql.includes('SELECT id, warrantyMonths FROM products')) {
        return (opts.products || []).map((p) => ({ id: p.id, warrantyMonths: p.warrantyMonths ?? 12 }));
      }
      if (sql.includes('FROM products')) return (opts.products || []).map((p) => ({ id: p.id }));
      if (sql.includes('FROM stock_document_lines')) return opts.lines;
      if (sql.includes('SELECT serialNumber FROM stock_serials')) return [];
      if (sql.includes('FROM stock_serials')) return opts.serials || [];
      if (sql.includes('FROM stock_balances')) {
        return [{ productId: 'p1', locationId: '', onHand: 1000, reserved: 0 }];
      }
      if (sql.includes('FROM stock_locations')) return [];
      if (sql.includes('FROM warehouses')) return [{ id: 'wh-hn' }, { id: 'wh-hcm' }];
      return [];
    }),
    get: vi.fn(async (sql: string) => {
      getCalls.push(sql);
      if (sql.includes('FROM stock_documents')) return opts.doc;
      if (sql.includes('FROM stock_counts')) return undefined;
      if (sql.includes('FROM stock_balances')) return { onHand: 1000, reserved: 0 };
      if (sql.includes('FROM stock_locations')) return { warehouseId: 'wh-hn', isActive: 1, purpose: 'SALEABLE' };
      if (sql.includes('FROM products')) return { id: 'p1' };
      return undefined;
    }),
    run: vi.fn(async (sql: string, params: any[] = []) => {
      runCalls.push([sql, params]);
      return { changes: 1 };
    }),
  };
  return db;
}

function serialFixture(total = 40) {
  const serialNumbers = Array.from({ length: total }, (_, i) => `SN-${i + 1}`);
  return { total, serialNumbers, serialText: serialNumbers.join('\n') };
}

describe('Phase 6A batch serial writes', () => {
  it('inserts 40 receipt serials in one batch statement', async () => {
    const { total, serialText } = serialFixture();
    const doc = {
      id: 'doc1', docType: 'RECEIPT', status: 'READY', warehouseId: 'wh-hn',
      code: 'PNK-26-0001', postingDate: '2026-10-15', partnerName: 'NCC A',
    };
    const line = {
      id: 'l1', documentId: 'doc1', productId: 'p1', quantity: total,
      locationId: null, serialLot: serialText, serialRequired: 1, processingStatus: 'COMPLETED',
    };
    const db = batchDb({ doc, lines: [line], products: [{ id: 'p1', tracking: 'SERIAL', warrantyMonths: 12 }] });

    await request(appFor(db)).post('/receipts/doc1/complete').send({}).expect(200);

    const inserts = db.runCalls.filter(([sql]: [string, any[]]) => String(sql).includes('INSERT INTO stock_serials'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toHaveLength(total * 15);
    expect(inserts[0][1]).toContain('SN-1');
    expect(inserts[0][1]).toContain('SN-40');
    const duplicateChecks = db.allCalls.filter(([sql]: [string, any[]]) => String(sql).includes('SELECT serialNumber FROM stock_serials'));
    expect(duplicateChecks).toHaveLength(1);
  });

  it('locks and updates 40 issue serials in one batch each', async () => {
    const { total, serialNumbers, serialText } = serialFixture();
    const doc = {
      id: 'doc1', docType: 'ISSUE', status: 'READY', warehouseId: 'wh-hn',
      code: 'PXK-26-0001', postingDate: '2026-10-15', partnerName: 'KH A',
    };
    const line = {
      id: 'l1', documentId: 'doc1', productId: 'p1', quantity: total,
      locationId: null, serialLot: serialText, serialRequired: 1, processingStatus: 'COMPLETED',
    };
    const serials = serialNumbers.map((serialNumber, i) => ({
      id: `sid-${i + 1}`, productId: 'p1', serialNumber,
      stockStatus: 'IN_STOCK', warrantyStart: null,
    }));
    const db = batchDb({
      doc, lines: [line], products: [{ id: 'p1', tracking: 'SERIAL' }], serials,
    });

    await request(appFor(db)).post('/issues/doc1/complete').send({}).expect(200);

    const lockQueries = db.allCalls.filter(([sql]: [string, any[]]) => (
      String(sql).includes('FROM stock_serials')
      && String(sql).includes('serialNumber IN')
      && String(sql).includes('FOR UPDATE')
    ));
    expect(lockQueries).toHaveLength(1);
    expect(lockQueries[0][1]).toContain('SN-1');
    expect(lockQueries[0][1]).toContain('SN-40');

    const updates = db.runCalls.filter(([sql]: [string, any[]]) => String(sql).includes("SET status = 'SOLD'"));
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toContain('sid-1');
    expect(updates[0][1]).toContain('sid-40');
    expect((String(updates[0][0]).match(/WHEN \? THEN \?/g) || [])).toHaveLength(total * 2);
  });

  it('validates 40 transfer serials with one locked query', async () => {
    const { total, serialNumbers, serialText } = serialFixture();
    const doc = {
      id: 'doc1', docType: 'TRANSFER', status: 'READY', warehouseId: null,
      sourceWarehouseId: 'wh-hn', destWarehouseId: 'wh-hcm',
      code: 'PĐC-26-0001', postingDate: '2026-10-15',
    };
    const line = {
      id: 'l1', documentId: 'doc1', productId: 'p1', quantity: total,
      locationId: null, serialLot: serialText, serialRequired: 1, processingStatus: 'COMPLETED',
    };
    const serials = serialNumbers.map((serialNumber, i) => ({
      id: `sid-${i + 1}`, productId: 'p1', serialNumber,
      stockStatus: 'RESERVED', issueDocumentId: 'doc1', issueLineId: 'l1',
    }));
    const db = batchDb({
      doc, lines: [line], products: [{ id: 'p1', tracking: 'SERIAL' }], serials,
    });

    await request(appFor(db)).post('/transfers/doc1/ship').send({}).expect(200);

    const readyQueries = db.allCalls.filter(([sql]: [string, any[]]) => (
      String(sql).includes('FROM stock_serials')
      && String(sql).includes('issueLineId')
      && String(sql).includes('FOR UPDATE')
    ));
    expect(readyQueries).toHaveLength(1);
    expect(readyQueries[0][1]).toEqual(['doc1', 'wh-hn']);
  });
});
