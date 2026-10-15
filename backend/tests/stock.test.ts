import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { stockRoutes } from '../routes/stock.js';

const nv = { id: 'nv', role: 'Employee', department: 'Kho', managementLevel: 10, permissions: [] };
const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
const admin = { id: 'a', role: 'Admin', department: 'B', managementLevel: 99, permissions: ['admin_panel'] };
const director = { id: 'd', role: 'Director', department: 'B', managementLevel: 40, permissions: [] };

function appFor(user: any, db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(stockRoutes(db));
  return app;
}

function mockDb(opts: {
  scopes?: string[]; doc?: any; lines?: any[]; products?: Set<string>;
  balance?: { onHand: number; reserved: number }; balances?: any[];
} = {}) {
  const runs: string[] = [];
  return {
    runs,
    all: vi.fn(async (sql: string) => {
      if (String(sql).includes('FROM user_warehouse_scopes')) {
        return (opts.scopes ?? []).map((warehouseId) => ({ warehouseId }));
      }
      if (String(sql).includes('FROM stock_document_lines')) return opts.lines ?? [];
      if (String(sql).includes('FROM products')) {
        const ids = [...((opts.products ?? (opts as any).productIds) as Set<string> ?? [])];
        return ids.map((id) => ({ id }));
      }
      if (String(sql).includes('FROM stock_balances b')) return opts.balances ?? [];
      if (String(sql).includes('FROM stock_balances')) {
        return opts.balance ? [{ productId: 'p1', locationId: '', onHand: opts.balance.onHand, reserved: opts.balance.reserved }] : [];
      }
      return [];
    }),
    get: vi.fn(async (sql: string) => {
      if (String(sql).includes('FROM stock_documents')) return opts.doc;
      if (String(sql).includes('FROM products')) {
        const id = (opts as any).lastProduct;
        return opts.products?.has(id) ? { id } : undefined;
      }
      if (String(sql).includes('FROM stock_locations')) return { warehouseId: 'wh-hn', isActive: 1 };
      if (String(sql).includes('FROM stock_balances')) return opts.balance;
      return undefined;
    }),
    run: vi.fn(async (sql: string) => { runs.push(sql); return { changes: 1 }; }),
  };
}

// db.get for products needs the requested id: wrap mockDb to capture params.
function mockDbProducts(opts: Parameters<typeof mockDb>[0] & { productIds?: Set<string> } = {}) {
  const db: any = mockDb(opts);
  const origGet = db.get;
  db.get = vi.fn(async (sql: string, params?: any[]) => {
    if (String(sql).includes('FROM products')) {
      return opts.productIds?.has(params?.[0]) ? { id: params?.[0] } : undefined;
    }
    return origGet(sql, params);
  });
  return db;
}

describe('stock balances scope', () => {
  it('blocks Admin from business stock data', async () => {
    const db = mockDb({ scopes: ['wh-hn'] });
    await request(appFor(admin, db)).get('/balances').expect(403);
  });

  it('unscoped staff sees an empty list, not an error', async () => {
    const db = mockDb({ scopes: [] });
    await request(appFor(nv, db)).get('/balances').expect(200, []);
    expect(db.all.mock.calls.some(([s]: string[]) => String(s).includes('FROM stock_balances b'))).toBe(false);
  });

  it('rejects warehouses outside the staff scope', async () => {
    const db = mockDb({ scopes: ['wh-hn'] });
    await request(appFor(nv, db)).get('/balances?warehouseId=wh-hcm').expect(403);
  });

  it('lists scoped balances with product and location joins', async () => {
    const rows = [{ productId: 'p1', onHand: 10, reserved: 2 }];
    const db = mockDb({ scopes: ['wh-hn'], balances: rows });
    const res = await request(appFor(nv, db)).get('/balances?warehouseId=wh-hn').expect(200);
    expect(res.body).toEqual(rows);
    const balanceQuery = db.all.mock.calls.find(([s]: string[]) => String(s).includes('FROM stock_balances b')) as unknown as [string, any[]] | undefined;
    const [sql, params] = balanceQuery ?? ['', []];
    expect(sql).toContain('b.warehouseId = ?');
    expect(params).toContain('wh-hn');
  });

  it('director bypasses scope filters', async () => {
    const db = mockDb({ scopes: [] });
    await request(appFor(director, db)).get('/balances').expect(200);
    const [sql] = db.all.mock.calls.find(([s]: string[]) => String(s).includes('FROM stock_balances b'))!;
    expect(sql).not.toContain('b.warehouseId IN');
  });
});

describe('list pagination', () => {
  it('defaults to 500 rows and clamps out-of-range limit/offset', async () => {
    const db = mockDb({ scopes: ['wh-hn'], balances: [] });
    await request(appFor(nv, db)).get('/balances?warehouseId=wh-hn').expect(200);
    const defaultCall = db.all.mock.calls.find(([s]: string[]) => String(s).includes('FROM stock_balances b')) as unknown as [string, any[]] | undefined;
    expect(defaultCall?.[1].slice(-2)).toEqual([500, 0]);

    const db2 = mockDb({ scopes: ['wh-hn'], balances: [] });
    await request(appFor(nv, db2)).get('/balances?warehouseId=wh-hn&limit=5000&offset=-3').expect(200);
    const clampCall = db2.all.mock.calls.find(([s]: string[]) => String(s).includes('FROM stock_balances b')) as unknown as [string, any[]] | undefined;
    expect(clampCall?.[1].slice(-2)).toEqual([1000, 0]);
  });

  it('paginates document and move lists', async () => {
    const docs = mockDb({ scopes: ['wh-hn'] });
    await request(appFor(nv, docs)).get('/documents?limit=50&offset=50').expect(200);
    const docCall = docs.all.mock.calls.find(([s]: string[]) => String(s).includes('FROM stock_documents d')) as unknown as [string, any[]] | undefined;
    expect(docCall?.[1].slice(-2)).toEqual([50, 50]);

    const moves = mockDb({ scopes: ['wh-hn'] });
    await request(appFor(nv, moves)).get('/moves?limit=20').expect(200);
    const moveCall = moves.all.mock.calls.find(([s]: string[]) => String(s).includes('FROM stock_moves m')) as unknown as [string, any[]] | undefined;
    expect(String(moveCall?.[0])).toContain('LIMIT ? OFFSET ?');
    expect(moveCall?.[1].slice(-2)).toEqual([20, 0]);
  });
});

describe('receipts', () => {
  const line = { id: 'l1', productId: 'p1', quantity: 10, unitPrice: 5, locationId: null };

  it('creates a draft receipt inside the scope', async () => {
    const db = mockDbProducts({ scopes: ['wh-hn'], productIds: new Set(['p1']) });
    const res = await request(appFor(nv, db)).post('/receipts')
      .send({ warehouseId: 'wh-hn', lines: [{ productId: 'p1', quantity: 10 }] }).expect(201);
    expect(res.body.code).toMatch(/^PNK-/);
    expect(db.run.mock.calls.some(([s]: string[]) => String(s).includes('INSERT INTO stock_documents'))).toBe(true);
  });

  it('refuses creation outside the scope', async () => {
    const db = mockDb({ scopes: ['wh-hn'] });
    await request(appFor(nv, db)).post('/receipts')
      .send({ warehouseId: 'wh-hcm', lines: [{ productId: 'p1', quantity: 10 }] }).expect(403);
  });

  it('completes a receipt with moves and balance upserts in one transaction', async () => {
    const db = mockDbProducts({
      scopes: ['wh-hn'],
      doc: { id: 'doc1', docType: 'RECEIPT', status: 'DRAFT', warehouseId: 'wh-hn', referenceType: null },
      lines: [line],
      productIds: new Set(['p1']),
    });
    await request(appFor(nv, db)).post('/receipts/doc1/complete').send({}).expect(200);
    const sqls = db.run.mock.calls.map(([s]: string[]) => String(s));
    expect(sqls[0]).toBe('START TRANSACTION');
    expect(sqls.some((s: string) => s.includes('INSERT INTO stock_moves'))).toBe(true);
    expect(sqls.some((s: string) => s.includes('INSERT INTO stock_balances') && s.includes('ON DUPLICATE KEY UPDATE'))).toBe(true);
    expect(sqls).toContain('COMMIT');
    expect(sqls).not.toContain('ROLLBACK');
  });

  it('rejects unknown products and non-draft documents', async () => {
    const db = mockDbProducts({
      scopes: ['wh-hn'],
      doc: { id: 'doc1', docType: 'RECEIPT', status: 'DRAFT', warehouseId: 'wh-hn', referenceType: null },
      lines: [{ ...line, productId: 'ghost' }],
      productIds: new Set(['p1']),
    });
    await request(appFor(nv, db)).post('/receipts/doc1/complete').send({}).expect(400);

    const done = mockDbProducts({
      scopes: ['wh-hn'],
      doc: { id: 'doc1', docType: 'RECEIPT', status: 'DONE', warehouseId: 'wh-hn', referenceType: null },
      lines: [line],
      productIds: new Set(['p1']),
    });
    await request(appFor(nv, done)).post('/receipts/doc1/complete').send({}).expect(400);
  });
});

describe('issues', () => {
  const line = { id: 'l1', productId: 'p1', quantity: 4, locationId: null };

  it('blocks issues exceeding available stock', async () => {
    const db = mockDbProducts({
      scopes: ['wh-hn'],
      doc: { id: 'doc1', docType: 'ISSUE', status: 'DRAFT', warehouseId: 'wh-hn', referenceType: null },
      lines: [line],
      productIds: new Set(['p1']),
      balance: { onHand: 5, reserved: 2 }, // available = 3 < 4
    });
    await request(appFor(tp, db)).post('/issues/doc1/complete').send({}).expect(400);
    expect(db.run.mock.calls.map(([sql]: string[]) => sql)).toEqual(['START TRANSACTION', 'ROLLBACK']);
  });

  it('posts negative moves when stock suffices', async () => {
    const db = mockDbProducts({
      scopes: ['wh-hn'],
      doc: { id: 'doc1', docType: 'ISSUE', status: 'DRAFT', warehouseId: 'wh-hn', referenceType: null },
      lines: [line],
      productIds: new Set(['p1']),
      balance: { onHand: 10, reserved: 2 },
    });
    await request(appFor(tp, db)).post('/issues/doc1/complete').send({}).expect(200);
    expect(db.run.mock.calls.some(([s]: string[]) => String(s).includes('INSERT INTO stock_moves'))).toBe(true);
  });
});

describe('stock alerts and policies', () => {
  const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
  const nv = { id: 'nv', role: 'Employee', department: 'Kho', managementLevel: 10, permissions: [] };
  const admin = { id: 'a', role: 'Admin', department: 'B', managementLevel: 99, permissions: ['admin_panel'] };

  function appFor(user: any, db: any) {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = user; next(); });
    app.use(stockRoutes(db));
    return app;
  }

  function alertDb(alerts: any[] = []) {
    return {
      all: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }];
        if (String(sql).includes('FROM stock_balances b')) return alerts;
        return [];
      }),
      get: vi.fn(),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  it('alerts stay scoped and hide from Admin', async () => {
    const rows = [{ productId: 'p1', available: 0 }];
    await request(appFor(tp, alertDb(rows))).get('/alerts').expect(200, rows);
    const db = alertDb(rows);
    await request(appFor(nv, db)).get('/alerts?warehouseId=wh-hcm').expect(403);
    await request(appFor(admin, alertDb(rows))).get('/alerts').expect(403);
  });

  it('policies require a manager and a scoped warehouse', async () => {    const body = { productId: 'p1', warehouseId: 'wh-hn', minStock: 5, maxStock: 100, reorderPoint: 10, leadTimeDays: 7 };
    const mk = () => ({
      all: vi.fn(async (sql: string) => String(sql).includes('FROM user_warehouse_scopes') ? [{ warehouseId: 'wh-hn' }] : []),
      get: vi.fn(async (sql: string) => String(sql).includes('FROM products') ? { id: 'p1' } : undefined),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    });
    await request(appFor(tp, mk())).put('/policies').send(body).expect(200);
    await request(appFor(nv, mk())).put('/policies').send(body).expect(403);
    await request(appFor(admin, mk())).put('/policies').send(body).expect(403);
    await request(appFor(tp, mk())).put('/policies').send({ ...body, minStock: 200 }).expect(400);
  });
});

describe('transfers ship and receive', () => {
  const line = { id: 'l1', productId: 'p1', quantity: 3, locationId: null };
  const base = { id: 'doc1', docType: 'TRANSFER', sourceWarehouseId: 'wh-hn', destWarehouseId: 'wh-hcm', referenceType: null };

  it('rejects same-warehouse transfers at creation', async () => {
    const db = mockDb({ scopes: ['wh-hn'] });
    await request(appFor(tp, db)).post('/transfers')
      .send({ sourceWarehouseId: 'wh-hn', destWarehouseId: 'wh-hn', lines: [{ productId: 'p1', quantity: 1 }] }).expect(400);
  });

  it('ships only with stock and exactly once', async () => {
    const mk = (status: string, balance = { onHand: 10, reserved: 0 }) => mockDbProducts({
      scopes: ['wh-hn', 'wh-hcm'],
      doc: { ...base, status },
      lines: [line],
      productIds: new Set(['p1']),
      balance,
    });
    await request(appFor(tp, mk('DRAFT'))).post('/transfers/doc1/ship').send({}).expect(200);
    await request(appFor(tp, mk('IN_TRANSIT'))).post('/transfers/doc1/ship').send({}).expect(400);
    const poor = mk('DRAFT', { onHand: 2, reserved: 0 });
    await request(appFor(tp, poor)).post('/transfers/doc1/ship').send({}).expect(400);
  });

  it('receives only in-transit transfers into the destination', async () => {
    const mk = (status: string) => mockDbProducts({
      scopes: ['wh-hcm'],
      doc: { ...base, status },
      lines: [line],
      productIds: new Set(['p1']),
    });
    await request(appFor(tp, mk('DRAFT'))).post('/transfers/doc1/receive').send({}).expect(400);
    const db = mk('IN_TRANSIT');
    await request(appFor(tp, db)).post('/transfers/doc1/receive').send({}).expect(200);
    expect(db.run.mock.calls.some(([s]: string[]) => String(s).includes("status = ?, updatedAt = ? WHERE id = ?"))).toBe(true);
  });
});

describe('relocations', () => {
  const body = { warehouseId: 'wh-hn', productId: 'p1', fromLocationId: 'l1', toLocationId: 'l2', quantity: 3 };
  it('moves stock between locations in one transaction', async () => {
    const db = mockDbProducts({ scopes: ['wh-hn'], productIds: new Set(['p1']), balance: { onHand: 10, reserved: 0 } });
    await request(appFor(tp, db)).post('/relocations').send(body).expect(201);
    const sqls = db.run.mock.calls.map(([s]: string[]) => String(s));
    expect(sqls.filter((s: string) => s.includes('INSERT INTO stock_moves'))).toHaveLength(2);
    expect(sqls).toContain('COMMIT');
  });
  it('refuses when source available is short', async () => {
    const db = mockDbProducts({ scopes: ['wh-hn'], productIds: new Set(['p1']), balance: { onHand: 2, reserved: 0 } });
    await request(appFor(tp, db)).post('/relocations').send(body).expect(400);
    expect(db.run.mock.calls.some(([s]: string[]) => String(s).includes('INSERT INTO stock_moves'))).toBe(false);
  });
});

describe('scoped warehouse locks', () => {
  it('locks only the document warehouse on complete', async () => {
    const db = mockDbProducts({
      scopes: ['wh-hn'],
      doc: { id: 'doc1', docType: 'RECEIPT', status: 'DRAFT', warehouseId: 'wh-hn', referenceType: null },
      lines: [{ id: 'l1', productId: 'p1', quantity: 10, locationId: null }],
      productIds: new Set(['p1']),
    });
    await request(appFor(nv, db)).post('/receipts/doc1/complete').send({}).expect(200);
    const lockCall = db.all.mock.calls.find(([s]: string[]) => String(s).includes('FOR UPDATE')) as unknown as [string, any[]] | undefined;
    expect(String(lockCall?.[0])).toContain('WHERE id IN');
    expect(lockCall?.[1]).toEqual(['wh-hn']);
  });

  it('locks the reservation row on settle', async () => {
    const held = { id: 'r1', productId: 'p1', warehouseId: 'wh-hn', locationId: '', quantity: 4, status: 'HELD' };
    const getCalls: string[] = [];
    const allCalls: [string, any[]][] = [];
    const d: any = {
      all: vi.fn(async (sql: string, params?: any[]) => {
        allCalls.push([sql, params ?? []]);
        if (String(sql).includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }];
        return [];
      }),
      get: vi.fn(async (sql: string) => {
        getCalls.push(sql);
        if (String(sql).includes('FROM reservations')) return { ...held };
        if (String(sql).includes('FROM stock_balances')) return { onHand: 10, reserved: 0 };
        return undefined;
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    await request(appFor(tp, d)).post('/reservations/r1/release').send({}).expect(200);
    expect(getCalls.some((s) => s.includes('FROM reservations') && s.includes('FOR UPDATE'))).toBe(true);
    const lockCall = allCalls.find(([s]) => s.includes('FOR UPDATE'));
    expect(lockCall?.[1]).toEqual(['wh-hn']);
  });
});

describe('reservations hold, release and consume', () => {
  const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };

  function appFor(user: any, db: any) {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = user; next(); });
    app.use(stockRoutes(db));
    return app;
  }

  function db(opts: { scopes?: string[]; balance?: any; reservation?: any; product?: boolean } = {}) {
    return {
      all: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM user_warehouse_scopes')) return (opts.scopes ?? ['wh-hn']).map((warehouseId) => ({ warehouseId }));
        if (String(sql).includes('FROM reservations r')) return [];
        return [];
      }),
      get: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM products')) return opts.product === false ? undefined : { id: 'p1' };
        if (String(sql).includes('FROM stock_locations')) return { warehouseId: 'wh-hn', isActive: 1 };
        if (String(sql).includes('FROM stock_balances')) return opts.balance ?? { onHand: 10, reserved: 0 };
        if (String(sql).includes('FROM reservations')) return opts.reservation;
        return undefined;
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  const body = { productId: 'p1', warehouseId: 'wh-hn', quantity: 4 };

  it('holds stock from available and bumps reserved in one transaction', async () => {
    const d = db();
    const res = await request(appFor(tp, d)).post('/reservations').send(body).expect(201);
    expect(res.body.id).toBeTruthy();
    const sqls = d.run.mock.calls.map(([s]: string[]) => String(s));
    expect(sqls).toContain('START TRANSACTION');
    expect(sqls.some((s) => s.includes('INSERT INTO reservations'))).toBe(true);
    expect(sqls).toContain('COMMIT');
  });

  it('refuses holds beyond available stock', async () => {
    const d = db({ balance: { onHand: 5, reserved: 2 } }); // available = 3 < 4
    await request(appFor(tp, d)).post('/reservations').send(body).expect(400);
    expect(d.run.mock.calls.map(([sql]: string[]) => sql)).toEqual(['START TRANSACTION', 'ROLLBACK']);
  });

  it('releases without touching on-hand, consumes with an issue move', async () => {
    const held = { id: 'r1', productId: 'p1', warehouseId: 'wh-hn', locationId: '', quantity: 4, status: 'HELD' };
    const rel = db({ reservation: held });
    await request(appFor(tp, rel)).post('/reservations/r1/release').send({}).expect(200);
    expect(rel.run.mock.calls.some(([s]: string[]) => String(s).includes('UPDATE stock_balances SET reserved = reserved - ?'))).toBe(true);
    expect(rel.run.mock.calls.some(([s]: string[]) => String(s).includes('INSERT INTO stock_moves'))).toBe(false);

    const con = db({ reservation: held, balance: { onHand: 10, reserved: 4 } });
    await request(appFor(tp, con)).post('/reservations/r1/consume').send({}).expect(200);
    expect(con.run.mock.calls.some(([s]: string[]) => String(s).includes('INSERT INTO stock_moves'))).toBe(true);
  });

  it('settles only held reservations', async () => {
    const d = db({ reservation: { id: 'r1', status: 'RELEASED' } });
    await request(appFor(tp, d)).post('/reservations/r1/release').send({}).expect(400);
    await request(appFor(tp, db({ reservation: undefined }))).post('/reservations/r1/consume').send({}).expect(404);
  });
});

describe('slow-moving stock', () => {
  const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
  const admin = { id: 'a', role: 'Admin', department: 'B', managementLevel: 99, permissions: ['admin_panel'] };

  function appFor(user: any, db: any) {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = user; next(); });
    app.use(stockRoutes(db));
    return app;
  }

  function db(rows: any[] = []) {
    return {
      all: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }];
        if (String(sql).includes('FROM stock_balances b')) return rows;
        return [];
      }),
      get: vi.fn(),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  it('lists slow rows in scope and hides from Admin', async () => {
    const rows = [{ productId: 'p1', onHand: 5 }];
    const res = await request(appFor(tp, db(rows))).get('/slow?days=90').expect(200);
    expect(res.body).toEqual(rows);
    await request(appFor(admin, db(rows))).get('/slow').expect(403);
  });

  it('rejects out-of-scope warehouses', async () => {
    const d = db();
    await request(appFor(tp, d)).get('/slow?warehouseId=wh-hcm').expect(403);
  });
});

describe('stock counts blind flow', () => {
  const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
  const nv = { id: 'nv', role: 'Employee', department: 'Kho', managementLevel: 10, permissions: [] };

  function appFor(user: any, db: any) {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = user; next(); });
    app.use(stockRoutes(db));
    return app;
  }

  function db(opts: { scopes?: string[]; count?: any; lines?: any[]; balances?: any[] } = {}) {
    return {
      all: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM user_warehouse_scopes')) return (opts.scopes ?? ['wh-hn']).map((warehouseId) => ({ warehouseId }));
        if (String(sql).includes('FROM stock_balances')) return opts.balances ?? [];
        if (String(sql).includes('FROM stock_count_lines')) return opts.lines ?? [];
        if (String(sql).includes('FROM stock_counts')) return [];
        return [];
      }),
      get: vi.fn(async (sql: string, params?: any[]) => {
        if (String(sql).includes('FROM products')) return { id: params?.[0] };
        if (String(sql).includes('FROM stock_balances')) return { onHand: opts.lines?.find(line => line.productId === params?.[0])?.expectedQty ?? 0, reserved: 0 };
        if (String(sql).includes('FROM stock_counts')) return opts.count;
        return undefined;
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  it('managers open counts with a balances snapshot, staff cannot', async () => {
    const d = db({ balances: [{ productId: 'p1', locationId: '', onHand: 20 }] });
    const res = await request(appFor(tp, d)).post('/counts').send({ warehouseId: 'wh-hn' }).expect(201);
    expect(res.body.code).toMatch(/^KK-/);
    expect(d.run.mock.calls.some(([s]: string[]) => String(s).includes('INSERT INTO stock_count_lines'))).toBe(true);
    await request(appFor(nv, db())).post('/counts').send({ warehouseId: 'wh-hn' }).expect(403);
  });

  it('hides expected quantities from staff on blind counts', async () => {
    const lines = [{ id: 'l1', expectedQty: 20, actualQty: null }];
    const count = { id: 'c1', warehouseId: 'wh-hn', blindCount: 1 };
    const staff = await request(appFor(nv, db({ count, lines }))).get('/counts/c1').expect(200);
    expect(staff.body.lines[0].expectedQty).toBeNull();
    const mgr = await request(appFor(tp, db({ count, lines }))).get('/counts/c1').expect(200);
    expect(mgr.body.lines[0].expectedQty).toBe(20);
  });

  it('approve requires complete lines and posts signed adjustments', async () => {
    const open = { id: 'c1', warehouseId: 'wh-hn', status: 'COUNTING' };
    const partial = db({ count: open, lines: [{ id: 'l1', expectedQty: 20, actualQty: null }] });
    await request(appFor(tp, partial)).post('/counts/c1/approve').send({}).expect(400);

    const full = db({
      count: open,
      lines: [
        { id: 'l1', productId: 'p1', locationId: '', expectedQty: 20, actualQty: 19 },
        { id: 'l2', productId: 'p2', locationId: '', expectedQty: 5, actualQty: 5 },
      ],
    });
    await request(appFor(tp, full)).post('/counts/c1/approve').send({}).expect(200);
    const moves = full.run.mock.calls.filter(([s]: string[]) => String(s).includes('INSERT INTO stock_moves'));
    expect(moves).toHaveLength(1); // only the -1 variance line
    expect(moves[0][1]).toContain(-1);
    expect(full.run.mock.calls.some(([s]: string[]) => String(s).includes("status = ?, approvedBy = ?"))).toBe(true);
  });

  it('recount resets lines for managers only', async () => {
    const open = { id: 'c1', warehouseId: 'wh-hn', status: 'COUNTING' };
    await request(appFor(nv, db({ count: open }))).post('/counts/c1/recount').send({ lineIds: ['l1'] }).expect(403);
    const d = db({ count: open });
    await request(appFor(tp, d)).post('/counts/c1/recount').send({ lineIds: ['l1'] }).expect(200);
    expect(d.run.mock.calls.some(([s]: string[]) => String(s).includes('actualQty = NULL'))).toBe(true);
  });
});

describe('serials register, search and status', () => {
  const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
  const nv = { id: 'nv', role: 'Employee', department: 'Kho', managementLevel: 10, permissions: [] };

  function appFor(user: any, db: any) {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = user; next(); });
    app.use(stockRoutes(db));
    return app;
  }

  function db(opts: { scopes?: string[]; serial?: any; product?: boolean } = {}) {
    return {
      all: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM user_warehouse_scopes')) return (opts.scopes ?? ['wh-hn']).map((warehouseId) => ({ warehouseId }));
        if (String(sql).includes('FROM stock_serials')) return [];
        return [];
      }),
      get: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM products')) return opts.product === false ? undefined : { id: 'p1' };
        if (String(sql).includes('FROM stock_locations')) return { warehouseId: 'wh-hn', isActive: 1 };
        if (String(sql).includes('FROM stock_serials')) return opts.serial;
        return undefined;
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  it('registers with a serial or lot inside the scope', async () => {
    const d = db();
    const res = await request(appFor(nv, d)).post('/serials')
      .send({ productId: 'p1', serialNumber: 'SN-001', warehouseId: 'wh-hn' }).expect(201);
    expect(res.body.id).toBeTruthy();
    await request(appFor(nv, db())).post('/serials')
      .send({ productId: 'p1', warehouseId: 'wh-hn' }).expect(400);
    await request(appFor(nv, db())).post('/serials')
      .send({ productId: 'p1', serialNumber: 'SN-002', warehouseId: 'wh-hcm' }).expect(403);
  });

  it('duplicate serials conflict', async () => {
    const d: any = {
      ...db(),
      run: vi.fn().mockRejectedValueOnce(new Error("Duplicate entry 'SN-001' for key 'serialNumber'")),
    };
    await request(appFor(tp, d)).post('/serials')
      .send({ productId: 'p1', serialNumber: 'SN-001', warehouseId: 'wh-hn' }).expect(409);
  });

  it('only managers change serial status', async () => {
    const serial = { id: 's1', warehouseId: 'wh-hn', status: 'SALEABLE', locationId: null };
    await request(appFor(nv, db({ serial }))).put('/serials/s1').send({ status: 'DAMAGED' }).expect(403);
    await request(appFor(tp, db({ serial }))).put('/serials/s1').send({ status: 'DAMAGED' }).expect(200);
    await request(appFor(tp, db({ serial: undefined }))).put('/serials/ghost').send({ status: 'DAMAGED' }).expect(404);
  });
});

describe('misa mappings and logs', () => {
  const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
  const nv = { id: 'nv', role: 'Employee', department: 'Kho', managementLevel: 10, permissions: [] };

  function appFor(user: any, db: any) {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = user; next(); });
    app.use(stockRoutes(db));
    return app;
  }

  function db() {
    return {
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  it('lists mappings and logs for managers, not staff', async () => {
    const rows = [{ id: 'm1' }];
    const d: any = { ...db(), all: vi.fn().mockResolvedValue(rows) };
    await request(appFor(tp, d)).get('/misa-mappings').expect(200, rows);
    await request(appFor(tp, d)).get('/misa-logs').expect(200, rows);
    await request(appFor(nv, d)).get('/misa-mappings').expect(403);
    await request(appFor(nv, d)).get('/misa-logs').expect(403);
  });

  it('managers create mappings, staff cannot, duplicates conflict', async () => {
    const d = db();
    await request(appFor(tp, d)).post('/misa-mappings')
      .send({ entityType: 'product', entityId: 'p1', misaCode: 'MISA-001' }).expect(201);
    await request(appFor(nv, db())).post('/misa-mappings')
      .send({ entityType: 'product', entityId: 'p1', misaCode: 'MISA-001' }).expect(403);
    const dup: any = { ...db(), run: vi.fn().mockRejectedValueOnce(new Error("Duplicate entry 'x' for key 'unique_misa_mapping'")) };
    await request(appFor(tp, dup)).post('/misa-mappings')
      .send({ entityType: 'product', entityId: 'p1', misaCode: 'MISA-001' }).expect(409);
  });

  it('managers delete mappings, staff cannot', async () => {
    const d = db();
    await request(appFor(tp, d)).delete('/misa-mappings/m1').expect(200);
    await request(appFor(nv, db())).delete('/misa-mappings/m1').expect(403);
  });
});

describe('warehouse locations', () => {
  const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
  const nv = { id: 'nv', role: 'Employee', department: 'Kho', managementLevel: 10, permissions: [] };

  function appFor(user: any, db: any) {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = user; next(); });
    app.use(stockRoutes(db));
    return app;
  }

  function db() {
    return {
      all: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }];
        if (String(sql).includes('FROM stock_locations')) return [];
        return [];
      }),
      get: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM stock_locations')) return undefined;
        return undefined;
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  it('lists scoped locations', async () => {
    const d = db();
    await request(appFor(tp, d)).get('/locations').expect(200);
    const locationQuery = d.all.mock.calls.find(([s]: string[]) => String(s).includes('FROM stock_locations')) as unknown as [string, any[]] | undefined;
    const [sql, params] = locationQuery ?? ['', []];
    expect(sql).toContain('l.warehouseId IN (?)');
    expect(params).toEqual(['wh-hn']);
  });

  it('managers create locations, staff cannot', async () => {
    const d = db();
    const res = await request(appFor(tp, d)).post('/locations')
      .send({ warehouseId: 'wh-hn', code: 'a-01', name: 'Kệ A01' }).expect(201);
    expect(res.body.id).toBeTruthy();
    const [, params] = d.run.mock.calls.find(([s]: string[]) => String(s).includes('INSERT INTO stock_locations'))!;
    expect(params).toContain('A-01');
    await request(appFor(nv, db())).post('/locations')
      .send({ warehouseId: 'wh-hn', code: 'a-02', name: 'Kệ A02' }).expect(403);
  });

  it('duplicate codes conflict and missing rows 404', async () => {
    const d: any = {
      ...db(),
      run: vi.fn().mockRejectedValueOnce(new Error("Duplicate entry 'A-01' for key 'unique_warehouse_location'")),
    };
    await request(appFor(tp, d)).post('/locations')
      .send({ warehouseId: 'wh-hn', code: 'a-01', name: 'Kệ A01' }).expect(409);
    await request(appFor(tp, db())).put('/locations/ghost').send({ name: 'X' }).expect(404);
  });
});

describe('product bundles buildable', () => {
  const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
  const nv = { id: 'nv', role: 'Employee', department: 'Kho', managementLevel: 10, permissions: [] };

  function appFor(user: any, db: any) {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = user; next(); });
    app.use(stockRoutes(db));
    return app;
  }

  const bundles = [{ id: 'b1', name: 'Bộ 6kW', bundleType: 'VIRTUAL_BUNDLE', isActive: 1 }];
  const items = [
    { bundleId: 'b1', productId: 'inv', qtyPerBundle: 1, productName: 'Inverter' },
    { bundleId: 'b1', productId: 'panel', qtyPerBundle: 10, productName: 'Panel' },
  ];
  // inv: 27 available, panel: 198 available -> buildable 19, limited by panel.
  const balances = [
    { productId: 'inv', warehouseId: 'wh-hn', available: 27 },
    { productId: 'panel', warehouseId: 'wh-hn', available: 198 },
  ];

  function db() {
    return {
      all: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }];
        if (String(sql).includes('FROM product_bundles')) return bundles;
        if (String(sql).includes('FROM product_bundle_items')) return items;
        if (String(sql).includes('FROM stock_balances')) return balances;
        return [];
      }),
      get: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM products')) return { id: 'p1' };
        return undefined;
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  it('computes buildable quantity as the limiting component', async () => {
    const res = await request(appFor(nv, db())).get('/bundles').expect(200);
    expect(res.body).toEqual([{
      id: 'b1', name: 'Bộ 6kW', bundleType: 'VIRTUAL_BUNDLE', isActive: true,
      items: [
        { bundleId: 'b1', productId: 'inv', qtyPerBundle: 1, productName: 'Inverter', available: 27, buildable: 27 },
        { bundleId: 'b1', productId: 'panel', qtyPerBundle: 10, productName: 'Panel', available: 198, buildable: 19 },
      ],
      buildable: 19,
      limitingProductId: 'panel',
    }]);
  });

  it('managers configure bundles, staff cannot', async () => {
    const d = db();
    const res = await request(appFor(tp, d)).post('/bundles')
      .send({ name: 'Bộ mới', items: [{ productId: 'p1', qtyPerBundle: 2 }] }).expect(201);
    expect(res.body.id).toBeTruthy();
    await request(appFor(nv, db())).post('/bundles')
      .send({ name: 'Bộ lậu', items: [{ productId: 'p1', qtyPerBundle: 2 }] }).expect(403);
  });

  it('assembles kits from components and disassembles them back', async () => {
    const kit = { id: 'b1', bundleType: 'STOCKED_KIT', kitProductId: 'kit1' };
    const items = [{ productId: 'p1', qtyPerBundle: 2 }];
    const mk = (balance: any = { onHand: 10, reserved: 0 }, kitBalance: any = { onHand: 0, reserved: 0 }) => ({
      all: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }];
        if (String(sql).includes('FROM product_bundle_items')) return items;
        return [];
      }),
      get: vi.fn(async (sql: string, params?: any[]) => {
        if (String(sql).includes('FROM product_bundles')) return kit;
        if (String(sql).includes('FROM stock_balances')) {
          const bal = params?.includes('kit1') ? kitBalance : balance;
          // Query SUM SALEABLE trả về { available }; query theo location trả về { onHand, reserved }.
          if (String(sql).includes('SUM(')) return { available: Number(bal?.onHand ?? 0) - Number(bal?.reserved ?? 0) };
          return bal;
        }
        return undefined;
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    });
    // get() mock above doesn't branch productId; scoped balance mock returns `balance` for any balance query.
    // Assemble 3 kits needs 6 components (have 10) then disassemble needs 3 kits.
    const asm = mk();
    await request(appFor(tp, asm)).post('/bundles/b1/assemble').send({ warehouseId: 'wh-hn', quantity: 3 }).expect(200);
    expect(asm.run.mock.calls.some(([s]: string[]) => String(s).includes('INSERT INTO stock_moves'))).toBe(true);

    const poor = mk({ onHand: 5, reserved: 0 });
    await request(appFor(tp, poor)).post('/bundles/b1/assemble').send({ warehouseId: 'wh-hn', quantity: 3 }).expect(400);

    const dis = mk({ onHand: 10, reserved: 0 }, { onHand: 5, reserved: 0 });
    await request(appFor(tp, dis)).post('/bundles/b1/disassemble').send({ warehouseId: 'wh-hn', quantity: 2 }).expect(200);

    const empty = mk({ onHand: 10, reserved: 0 }, { onHand: 1, reserved: 0 });
    await request(appFor(tp, empty)).post('/bundles/b1/disassemble').send({ warehouseId: 'wh-hn', quantity: 2 }).expect(400);

    await request(appFor(nv, mk())).post('/bundles/b1/assemble').send({ warehouseId: 'wh-hn', quantity: 1 }).expect(403);
  });
});

describe('stock moves timeline and policy listing', () => {
  const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };
  const admin = { id: 'a', role: 'Admin', department: 'B', managementLevel: 99, permissions: ['admin_panel'] };

  function appFor(user: any, db: any) {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = user; next(); });
    app.use(stockRoutes(db));
    return app;
  }

  function db(rows: any[] = []) {
    return {
      all: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }];
        if (String(sql).includes('FROM stock_moves m')) return rows;
        if (String(sql).includes('FROM product_warehouse_policies')) return rows;
        return [];
      }),
      get: vi.fn(),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  it('lists scoped moves with joins and hides from Admin', async () => {
    const rows = [{ id: 'm1', moveType: 'RECEIPT' }];
    const res = await request(appFor(tp, db(rows))).get('/moves').expect(200);
    expect(res.body).toEqual(rows);
    await request(appFor(admin, db(rows))).get('/moves').expect(403);
  });

  it('lists scoped policies', async () => {
    const rows = [{ productId: 'p1', minStock: 5 }];
    const res = await request(appFor(tp, db(rows))).get('/policies').expect(200);
    expect(res.body).toEqual(rows);
  });
});

describe('reservation expiry scheduler', () => {
  it('releases only expired held rows and restores reserved', async () => {
    const { releaseExpiredReservations } = await import('../schedulers/reservationExpiry.js');
    const expired = { id: 'r1', productId: 'p1', warehouseId: 'wh-hn', locationId: '', quantity: 4 };
    const db: any = {
      all: vi.fn().mockResolvedValue([expired]),
      get: vi.fn().mockResolvedValue({ status: 'HELD' }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    await expect(releaseExpiredReservations(db, new Date('2026-10-11T10:00:00Z'))).resolves.toBe(1);
    expect(db.all.mock.calls[0][1][0]).toBe('2026-10-11T10:00:00.000Z');
    expect(db.run.mock.calls.some(([s]: string[]) => String(s).includes('reserved = reserved - ?'))).toBe(true);
    expect(db.run.mock.calls.some(([s]: string[]) => String(s).includes("status = ? WHERE id = ?"))).toBe(true);
  });

  it('skips rows settled concurrently and rolls back on failure', async () => {
    const { releaseExpiredReservations } = await import('../schedulers/reservationExpiry.js');
    const expired = { id: 'r1', productId: 'p1', warehouseId: 'wh-hn', locationId: '', quantity: 4 };
    const raced: any = {
      all: vi.fn().mockResolvedValue([expired]),
      get: vi.fn().mockResolvedValue({ status: 'RELEASED' }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    await expect(releaseExpiredReservations(raced, new Date())).resolves.toBe(0);
    expect(raced.run.mock.calls.map(([s]: string[]) => String(s))).toEqual(['START TRANSACTION', 'ROLLBACK']);

    const broken: any = {
      all: vi.fn().mockResolvedValue([expired]),
      get: vi.fn().mockResolvedValue({ status: 'HELD' }),
      run: vi.fn(async (sql: string) => {
        if (String(sql).includes('UPDATE stock_balances')) throw new Error('db down');
        return { changes: 1 };
      }),
    };
    await expect(releaseExpiredReservations(broken, new Date())).resolves.toBe(0);
  });

  it('does nothing when nothing expired', async () => {
    const { releaseExpiredReservations } = await import('../schedulers/reservationExpiry.js');
    const db: any = { all: vi.fn().mockResolvedValue([]), get: vi.fn(), run: vi.fn() };
    await expect(releaseExpiredReservations(db, new Date())).resolves.toBe(0);
    expect(db.run).not.toHaveBeenCalled();
  });
});
