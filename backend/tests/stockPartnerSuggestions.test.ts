import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { stockRoutes } from '../routes/stock.js';

const warehouseStaff = { id: 'staff1', role: 'Staff', department: 'Kho', managementLevel: 10, permissions: [] };
const warehouseManager = { id: 'mgr1', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
const admin = { id: 'adm', role: 'Admin', department: 'Admin', managementLevel: 99, permissions: ['admin_panel'] };

function appFor(user: any, db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(stockRoutes(db));
  return app;
}

function mockDbForSuggestions(opts: {
  docRows?: any[];
  clientRows?: any[];
  contractRows?: any[];
  projectRows?: any[];
  doc?: any;
  lines?: any[];
  scopes?: string[];
} = {}) {
  const runs: string[] = [];
  const db: any = {
    runs,
    all: vi.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes('FROM stock_documents')) {
        return opts.docRows ?? [
          { partnerCode: 'NCC-01', partnerName: 'Công ty Alpha', partnerAddress: 'Hà Nội', deliverer: 'Nguyễn Văn A', notes: 'Nhập lô hàng 01' },
          { partnerCode: 'NCC-02', partnerName: 'Công ty Beta', partnerAddress: 'Đà Nẵng', deliverer: 'Trần Văn B', notes: 'Nhập lô hàng 02' },
        ];
      }
      if (s.includes('FROM clients')) {
        return opts.clientRows ?? [
          { name: 'Công ty Alpha', region: 'Hà Nội' }, // trùng Alpha -> deduplicate
          { name: 'Khách hàng Gamma', region: 'TP.HCM' },
        ];
      }
      if (s.includes('FROM contracts')) {
        return opts.contractRows ?? [
          { supplierName: 'Nhà cung cấp Delta', clientName: 'Công ty Alpha' },
        ];
      }
      if (s.includes('FROM projects')) {
        return opts.projectRows ?? [
          { clientName: 'Dự án Epsilon', investor: 'Chủ đầu tư Zeta' },
        ];
      }
      if (s.includes('FROM user_warehouse_scopes')) {
        return (opts.scopes ?? ['wh-1']).map((warehouseId: string) => ({ warehouseId }));
      }
      if (s.includes('FROM stock_document_lines')) {
        return opts.lines ?? [{ id: 'l1', productId: 'p1', quantity: 10, unitPrice: 50000 }];
      }
      return [];
    }),
    get: vi.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes('FROM stock_documents')) {
        return opts.doc ?? { id: 'doc-123', docType: 'RECEIPT', status: 'DRAFT', warehouseId: 'wh-1', partnerName: 'Công ty Alpha' };
      }
      return undefined;
    }),
    run: vi.fn(async (sql: string, params?: any[]) => {
      runs.push(sql);
      return { changes: 1, params };
    }),
  };
  return db;
}

describe('Stock Partner Suggestions & Document Flow API', () => {
  it('rejects unauthenticated requests to /partner-suggestions with 401', async () => {
    const db = mockDbForSuggestions();
    await request(appFor(null, db)).get('/partner-suggestions').expect(401);
  });

  it('rejects Admin (level 99) with 403 per D12 governance rule', async () => {
    const db = mockDbForSuggestions();
    await request(appFor(admin, db)).get('/partner-suggestions').expect(403);
  });

  it('returns aggregated and deduplicated partner suggestions for warehouse user', async () => {
    const db = mockDbForSuggestions();
    const res = await request(appFor(warehouseStaff, db)).get('/partner-suggestions').expect(200);

    expect(res.body).toHaveProperty('partners');
    expect(res.body).toHaveProperty('deliverers');
    expect(res.body).toHaveProperty('notes');
    expect(res.body).toHaveProperty('addresses');

    const partners = res.body.partners;
    expect(Array.isArray(partners)).toBe(true);

    // Alpha should exist only once even though it was in stock_documents, clients, and contracts
    const alphaCount = partners.filter((p: any) => p.name.toLowerCase().includes('alpha')).length;
    expect(alphaCount).toBe(1);

    const alpha = partners.find((p: any) => p.name.toLowerCase().includes('alpha'));
    expect(alpha.code).toBe('NCC-01');
    expect(alpha.address).toBe('Hà Nội');
    expect(alpha.deliverer).toBe('Nguyễn Văn A');

    // Deliverers list includes 'Nguyễn Văn A' and 'Trần Văn B'
    expect(res.body.deliverers).toContain('Nguyễn Văn A');
    expect(res.body.deliverers).toContain('Trần Văn B');

    // Notes list includes the doc notes
    expect(res.body.notes).toContain('Nhập lô hàng 01');

    // Addresses list includes Hà Nội and Đà Nẵng
    expect(res.body.addresses).toContain('Hà Nội');
    expect(res.body.addresses).toContain('Đà Nẵng');
  });

  it('fetches single document detail via GET /documents/:id', async () => {
    const doc = {
      id: 'doc-123',
      code: 'PNK-2610-001',
      docType: 'RECEIPT',
      status: 'DRAFT',
      warehouseId: 'wh-1',
      partnerCode: 'NCC-01',
      partnerName: 'Công ty Alpha',
      totalAmount: 540000,
    };
    const lines = [
      { id: 'line-1', productId: 'p1', productName: 'Pin mặt trời 550W', quantity: 10, unitPrice: 50000, vatRate: 8, totalAmount: 540000 },
    ];
    const db = mockDbForSuggestions({ doc, lines, scopes: ['wh-1'] });

    const res = await request(appFor(warehouseManager, db)).get('/documents/doc-123').expect(200);
    expect(res.body.id).toBe('doc-123');
    expect(res.body.partnerName).toBe('Công ty Alpha');
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].productName).toBe('Pin mặt trời 550W');
  });

  it('cancels draft document via POST /documents/:id/cancel', async () => {
    const doc = {
      id: 'doc-cancel-1',
      docType: 'RECEIPT',
      status: 'DRAFT',
      warehouseId: 'wh-1',
    };
    const db = mockDbForSuggestions({ doc, scopes: ['wh-1'] });

    const res = await request(appFor(warehouseManager, db)).post('/documents/doc-cancel-1/cancel').expect(200);
    expect(res.body.success).toBe(true);
    expect(db.runs.some((sql: string) => sql.includes("UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?"))).toBe(true);
  });
});
