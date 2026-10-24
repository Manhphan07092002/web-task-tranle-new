import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { contractRoutes } from '../routes/contracts.js';

const admin = {
  id: 'u1',
  name: 'Admin',
  role: 'Admin',
  department: 'Kho',
  managementLevel: 99,
  permissions: ['admin_panel'],
};

const existingInputContract = {
  createdBy: 'u1',
  status: 'draft',
  department: 'Kho',
  approvalFeedback: null,
  docAccountantUserId: null,
  docAccountantStatus: null,
  docSentDate: null,
  docReceivedDate: null,
  docAccountantDate: null,
  docReceiver: null,
  paidAmount: 0,
  contractName: 'Mua pin',
  contractNumber: 'HD-NK-01',
  contractType: 'input',
};

function appFor(db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = admin; next(); });
  app.use(contractRoutes(db));
  return app;
}

function catalogDb(existing?: any) {
  return {
    get: vi.fn(async (sql: string) => {
      const text = String(sql);
      if (text.includes('SELECT createdBy, status')) return existing;
      if (text.includes('SELECT * FROM contracts WHERE id')) return existing;
      if (text.includes('SELECT id FROM contracts WHERE contractNumber')) return undefined;
      if (text.includes('FROM users')) return undefined;
      return undefined;
    }),
    all: vi.fn(async () => []),
    run: vi.fn(async () => ({ changes: 1 })),
  };
}

function productInsert(db: any) {
  return db.run.mock.calls.find(([sql]: string[]) => String(sql).includes('INSERT INTO products'));
}

function expectNoStockLedgerWrites(db: any) {
  const forbidden = ['stock_documents', 'stock_document_lines', 'stock_moves', 'stock_balances'];
  for (const call of db.run.mock.calls) {
    const sql = String(call[0]);
    for (const table of forbidden) {
      expect(sql).not.toContain(table);
    }
  }
}

const inputBody = {
  contractNumber: 'HD-NK-01',
  clientName: 'NCC Pin',
  contractName: 'Mua pin',
  contractType: 'input',
  status: 'draft',
  products: [
    { name: 'Pin A', unit: 'Tấm', origin: 'AIKO', quantity: 10, unitPrice: 1000 },
  ],
};

describe('input contract creates catalog entries only', () => {
  it('creates a product catalog row without remainingQuantity or stock ledger rows', async () => {
    const db = catalogDb();
    await request(appFor(db)).post('/').send(inputBody).expect(201);

    const insert = productInsert(db);
    expect(insert).toBeTruthy();
    expect(String(insert?.[0])).not.toContain('remainingQuantity');
    expect(String(insert?.[0])).toContain('importQuantity');
    expect(insert?.[1]).toHaveLength(10);
    // Quantity is catalog metadata only: it appears once (importQuantity), not duplicated as stock.
    expect(insert?.[1].filter((value: any) => value === 10)).toHaveLength(1);
    expectNoStockLedgerWrites(db);
  });

  it('updates the catalog row on contract update without touching stock', async () => {
    const db = catalogDb(existingInputContract);
    await request(appFor(db))
      .put('/contract-1')
      .send({
        ...inputBody,
        products: [
          { name: 'Pin A', unit: 'Tấm', origin: 'AIKO', quantity: 12, unitPrice: 1000 },
        ],
      })
      .expect(200);

    const insert = productInsert(db);
    expect(insert).toBeTruthy();
    expect(String(insert?.[0])).not.toContain('remainingQuantity');
    expect(String(insert?.[0])).toContain('importQuantity');
    expect(insert?.[1]).toHaveLength(10);
    expect(insert?.[1].filter((value: any) => value === 12)).toHaveLength(1);
    expectNoStockLedgerWrites(db);
  });
});
