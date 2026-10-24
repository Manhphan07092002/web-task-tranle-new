import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { productRoutes } from '../routes/products.js';

const nv = { id: 'nv', role: 'Employee', department: 'Kho', managementLevel: 10, permissions: [] };

function appFor(user: any, db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(productRoutes(db));
  return app;
}

function mockDb(opts: { perms?: string[]; scopes?: string[]; refs?: boolean } = {}) {
  return {
    all: vi.fn(async (sql: string) => {
      if (String(sql).includes('FROM user_warehouse_scopes')) {
        return (opts.scopes ?? []).map((warehouseId) => ({ warehouseId }));
      }
      if (String(sql).includes('LOWER(importCode)')) return [];
      if (opts.refs && (String(sql).includes('FROM stock_document_lines') || String(sql).includes('FROM stock_moves'))) {
        return [{ productId: 'p1' }];
      }
      return [];
    }),
    get: vi.fn(async (sql: string) => {
      if (String(sql).includes('FROM roles')) {
        return { permissions: JSON.stringify(opts.perms ?? []) };
      }
      if (String(sql).includes('FROM products WHERE id')) {
        return { id: 'prod-new', name: 'Hang moi' };
      }
      return undefined;
    }),
    run: vi.fn(async () => ({ changes: 1 })),
  };
}

const validBody = { name: 'Pin test 100Ah', unit: 'Bo', importPrice: 1000, salePrice: 1200 };

describe('product creation permission', () => {
  it('lets scoped warehouse staff create products inline from documents', async () => {
    const db = mockDb({ scopes: ['wh-hn'] });
    const res = await request(appFor(nv, db)).post('/').send(validBody).expect(201);
    expect(res.body.name).toBe('Hang moi');
  });

  it('blocks staff without any warehouse scope', async () => {
    const db = mockDb({ scopes: [] });
    await request(appFor(nv, db)).post('/').send(validBody).expect(403);
  });

  it('still rejects invalid pricing', async () => {
    const db = mockDb({ scopes: ['wh-hn'] });
    await request(appFor(nv, db)).post('/').send({ ...validBody, salePrice: 1000 }).expect(400);
  });

  it('does not write legacy remainingQuantity when creating a product', async () => {
    const db = mockDb({ scopes: ['wh-hn'] });
    await request(appFor(nv, db))
      .post('/')
      .send({ ...validBody, importQuantity: 10, remainingQuantity: 999 })
      .expect(201);

    const insert = db.run.mock.calls.find(([sql]: string[]) => String(sql).includes('INSERT INTO products')) as any;
    expect(insert).toBeTruthy();
    expect(String(insert?.[0])).not.toContain('remainingQuantity');
    expect(insert?.[1]).toHaveLength(14);
  });
});

describe('product update keeps stock authoritative', () => {
  it('does not write legacy remainingQuantity when updating a product', async () => {
    const db = mockDb({ perms: ['manage_warehouse'] });
    await request(appFor({ ...nv, role: 'Manager' }, db))
      .put('/prod-new')
      .send({ ...validBody, importQuantity: 10, remainingQuantity: 999 })
      .expect(200);

    const update = db.run.mock.calls.find(([sql]: string[]) => String(sql).includes('UPDATE products SET')) as any;
    expect(update).toBeTruthy();
    expect(String(update?.[0])).not.toContain('remainingQuantity');
    expect(update?.[1]).toHaveLength(13);
  });
});

describe('product deletion guard', () => {
  it('refuses to delete products referenced by stock documents', async () => {
    const db = mockDb({ perms: ['manage_warehouse'], refs: true });
    await request(appFor({ ...nv, role: 'Manager' }, db)).delete('/p1').expect(400);
    expect(db.run.mock.calls.some(([s]: string[]) => String(s).startsWith('DELETE FROM products'))).toBe(false);
  });

  it('deletes unreferenced products', async () => {
    const db = mockDb({ perms: ['manage_warehouse'] });
    await request(appFor({ ...nv, role: 'Manager' }, db)).delete('/p1').expect(200);
  });
});
