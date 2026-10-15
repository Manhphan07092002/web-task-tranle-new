import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { stockRoutes } from '../routes/stock.js';

const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
const admin = { id: 'a', role: 'Admin', department: 'B', managementLevel: 99, permissions: ['admin_panel'] };

function appFor(user: any, db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(stockRoutes(db));
  return app;
}

function mockDb(opts: {
  scopes?: string[]; doc?: any; lines?: any[]; productIds?: Set<string>;
} = {}) {
  const runs: string[] = [];
  const db: any = {
    runs,
    all: vi.fn(async (sql: string) => {
      if (String(sql).includes('FROM user_warehouse_scopes')) {
        return (opts.scopes ?? []).map((warehouseId: string) => ({ warehouseId }));
      }
      if (String(sql).includes('FROM stock_document_lines')) return opts.lines ?? [];
      if (String(sql).includes('FROM products')) {
        return [...(opts.productIds ?? new Set<string>())].map((id) => ({ id }));
      }
      return [];
    }),
    get: vi.fn(async (sql: string, params?: any[]) => {
      if (String(sql).includes('FROM stock_documents')) return opts.doc;
      if (String(sql).includes('FROM products')) {
        return opts.productIds?.has(params?.[0]) ? { id: params?.[0] } : undefined;
      }
      if (String(sql).includes('FROM stock_locations')) return { warehouseId: 'wh-hn', isActive: 1 };
      return undefined;
    }),
    run: vi.fn(async (sql: string, params?: any[]) => { runs.push(sql); return { changes: 1, params }; }),
  };
  return db;
}

const misaBody = {
  warehouseId: 'wh-hn',
  partnerCode: 'CTY.SINPOWER',
  partnerName: 'CÔNG TY TNHH SINPOWER',
  deliverer: 'Nguyễn Văn A',
  postingDate: '09/10/2026',
  docDate: '09/10/2026',
  invoiceNumber: '439',
  invoiceDate: '09/10/2026',
  paymentStatus: 'UNPAID',
  notes: 'Mua hàng theo hóa đơn số 439',
  lines: [{ productId: 'p1', quantity: 2, unitPrice: 100, vatRate: 8, projectId: 'PJ-1', serialLot: 'SN-001', costObjectId: 'CT-01' }],
};

describe('MISA receipt fields (v26 API)', () => {
  it('creates receipts with partner/invoice header and computed totals', async () => {
    const db = mockDb({ scopes: ['wh-hn'], productIds: new Set(['p1']) });
    await request(appFor(tp, db)).post('/receipts').send(misaBody).expect(201);
    const calls = db.run.mock.calls as unknown as [string, any[]][];
    const docCall = calls.find(([sql]) => String(sql).includes('INSERT INTO stock_documents'));
    expect(docCall).toBeDefined();
    expect(docCall?.[0]).toContain('partnerName');
    expect(docCall?.[0]).toContain('invoiceNumber');
    // computed: 2x100=200 preTax, 8% vat=16, total=216
    expect(docCall?.[1]).toContain('CÔNG TY TNHH SINPOWER');
    expect(docCall?.[1]).toContain('439');
    expect(docCall?.[1]).toContain(200);
    expect(docCall?.[1]).toContain(16);
    expect(docCall?.[1]).toContain(216);
    const lineCall = calls.find(([sql]) => String(sql).includes('INSERT INTO stock_document_lines'));
    expect(lineCall?.[0]).toContain('vatRate');
    expect(lineCall?.[1]).toContain(8);
    expect(lineCall?.[1]).toContain('1561'); // default TK nợ
    expect(lineCall?.[1]).toContain('331'); // default TK có
    expect(lineCall?.[1]).toContain('PJ-1');
    expect(lineCall?.[1]).toContain('SN-001');
    expect(lineCall?.[1]).toContain('CT-01');
  });

  it('rejects out-of-range VAT rates', async () => {
    const db = mockDb({ scopes: ['wh-hn'], productIds: new Set(['p1']) });
    await request(appFor(tp, db)).post('/receipts')
      .send({ warehouseId: 'wh-hn', lines: [{ productId: 'p1', quantity: 1, vatRate: 150 }] })
      .expect(400);
  });

  it('updates draft headers and recomputes totals on PUT', async () => {
    const doc = { id: 'doc1', docType: 'RECEIPT', status: 'DRAFT', warehouseId: 'wh-hn', totalPreTax: 0, vatAmount: 0, totalAmount: 0 };
    const db = mockDb({ scopes: ['wh-hn'], doc, productIds: new Set(['p1']) });
    await request(appFor(tp, db)).put('/documents/doc1')
      .send({ partnerName: 'NEW SUPPLIER', invoiceNumber: '440', lines: [{ productId: 'p1', quantity: 1, unitPrice: 50, vatRate: 10 }] })
      .expect(200);
    const calls = db.run.mock.calls as unknown as [string, any[]][];
    const updateCall = calls.find(([sql]) => String(sql).includes('UPDATE stock_documents SET'));
    expect(updateCall?.[1]).toContain('NEW SUPPLIER');
    expect(updateCall?.[1]).toContain('440');
    expect(updateCall?.[1]).toContain(50); // recomputed preTax
    expect(updateCall?.[1]).toContain(5); // recomputed vat
    expect(updateCall?.[1]).toContain(55); // recomputed total
  });

  it('refuses to modify non-draft documents', async () => {
    const db = mockDb({ scopes: ['wh-hn'], doc: { id: 'doc1', status: 'DONE', warehouseId: 'wh-hn' } });
    await request(appFor(tp, db)).put('/documents/doc1').send({ partnerName: 'X' }).expect(400);
  });

  it('deletes draft documents with their lines', async () => {
    const db = mockDb({ scopes: ['wh-hn'], doc: { id: 'doc1', status: 'DRAFT', warehouseId: 'wh-hn' } });
    await request(appFor(tp, db)).delete('/documents/doc1').expect(200);
    expect(db.runs.some((s: string) => s.includes('DELETE FROM stock_document_lines'))).toBe(true);
    expect(db.runs.some((s: string) => s.includes('DELETE FROM stock_documents'))).toBe(true);
  });

  it('refuses to delete processed documents', async () => {
    const db = mockDb({ scopes: ['wh-hn'], doc: { id: 'doc1', status: 'DONE', warehouseId: 'wh-hn' } });
    await request(appFor(tp, db)).delete('/documents/doc1').expect(400);
    expect(db.runs.some((s: string) => s.includes('DELETE FROM'))).toBe(false);
  });

  it('blocks Admin from document operations', async () => {
    const db = mockDb({ scopes: [], doc: { id: 'doc1', status: 'DRAFT', warehouseId: 'wh-hn' } });
    await request(appFor(admin, db)).delete('/documents/doc1').expect(403);
  });
});
