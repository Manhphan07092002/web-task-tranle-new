import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { stockRoutes } from '../routes/stock.js';

const manager = { id: 'manager', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };

function appFor(db: any, user: any = manager) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(stockRoutes(db));
  return app;
}

function routeDb(opts: {
  docs?: any[];
  lines?: any[];
  products?: any[];
  serials?: any[];
  onAll?: (sql: string, params: any[]) => any[] | undefined;
  onGet?: (sql: string, params: any[]) => any;
} = {}) {
  const allCalls: [string, any[]][] = [];
  const getCalls: string[] = [];
  const runCalls: [string, any[]][] = [];
  const db: any = {
    allCalls,
    getCalls,
    runCalls,
    all: vi.fn(async (sql: string, params: any[] = []) => {
      allCalls.push([sql, params]);
      const custom = opts.onAll?.(sql, params);
      if (custom !== undefined) return custom;
      if (sql.includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }, { warehouseId: 'wh-hcm' }];
      if (sql.includes('SELECT id, tracking FROM products')) {
        return (opts.products || []).map((p) => ({ id: p.id, tracking: p.tracking }));
      }
      if (sql.includes('SELECT id, warrantyMonths FROM products')) {
        return (opts.products || []).map((p) => ({ id: p.id, warrantyMonths: p.warrantyMonths ?? 12 }));
      }
      if (sql.includes('FROM products')) return (opts.products || []).map((p) => ({ id: p.id }));
      if (sql.includes('FROM stock_document_lines')) return opts.lines || [];
      if (sql.includes('SELECT serialNumber FROM stock_serials')) return [];
      if (sql.includes('FROM stock_serials')) return opts.serials || [];
      if (sql.includes('FROM stock_documents')) return opts.docs || [];
      if (sql.includes('FROM stock_balances')) return [{ productId: 'p1', locationId: '', onHand: 100, reserved: 0 }];
      if (sql.includes('FROM stock_locations')) return [];
      if (sql.includes('FROM warehouses')) return [{ id: 'wh-hn' }, { id: 'wh-hcm' }];
      return [];
    }),
    get: vi.fn(async (sql: string, params: any[] = []) => {
      getCalls.push(sql);
      const custom = opts.onGet?.(sql, params);
      if (custom !== undefined) return custom;
      if (sql.includes('FROM stock_documents')) return (opts.docs || [])[0];
      if (sql.includes('FROM stock_counts')) return undefined;
      if (sql.includes('FROM stock_balances')) return { onHand: 100, reserved: 0 };
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

describe('Phase 4-5 stock posting performance', () => {
  it('looks up serial ids in batches and checks counting once per document', async () => {
    const total = 40;
    const serialNumbers = Array.from({ length: total }, (_, i) => `SN-${i + 1}`);
    const doc = {
      id: 'doc1', docType: 'RECEIPT', status: 'READY', warehouseId: 'wh-hn',
      code: 'PNK-26-0001', postingDate: '2026-10-15', partnerName: 'NCC A',
    };
    const line = {
      id: 'l1', documentId: 'doc1', productId: 'p1', quantity: total,
      locationId: null, serialLot: serialNumbers.join('\n'), serialRequired: 1,
      processingStatus: 'COMPLETED',
    };
    const serials = serialNumbers.map((sn, i) => ({ id: `sid-${i + 1}`, productId: 'p1', serialNumber: sn }));
    const db = routeDb({
      docs: [doc],
      lines: [line],
      products: [{ id: 'p1', tracking: 'SERIAL', warrantyMonths: 12 }],
      serials,
    });

    await request(appFor(db)).post('/receipts/doc1/complete').send({}).expect(200);

    const batchLookups = db.allCalls.filter(([sql]: [string, any[]]) => String(sql).includes('SELECT id, productId, serialNumber FROM stock_serials'));
    expect(batchLookups).toHaveLength(1);
    expect(db.getCalls.filter((sql: string) => sql.includes('FROM stock_serials'))).toHaveLength(0);
    expect(db.getCalls.filter((sql: string) => sql.includes('FROM stock_counts'))).toHaveLength(1);

    const moves = db.runCalls.filter(([sql]: [string, any[]]) => String(sql).includes('INSERT INTO stock_moves'));
    expect(moves).toHaveLength(1);
    const moveParams = moves[0][1];
    const serialIds: any[] = [];
    for (let i = 9; i < moveParams.length; i += 13) serialIds.push(moveParams[i]);
    expect(serialIds).toHaveLength(total);
    expect(new Set(serialIds).size).toBe(total);
    expect(serialIds.every(Boolean)).toBe(true);
    expect(moveParams).toHaveLength(total * 13);
    const balance = db.runCalls.filter(([sql]: [string, any[]]) => String(sql).includes('INSERT INTO stock_balances'));
    expect(balance).toHaveLength(1);
    expect(balance[0][1].slice(0, 4)).toEqual(['p1', 'wh-hn', '', total]);
    expect(db.runCalls.filter(([sql]: [string, any[]]) => String(sql).includes('INSERT INTO warehouse_activity_logs'))).toHaveLength(1);
  });

  it('posts lot allocations for many lines with one batch query', async () => {
    const doc = {
      id: 'doc1', docType: 'ISSUE', status: 'READY', warehouseId: 'wh-hn',
      code: 'PXK-26-0001', postingDate: '2026-10-15', partnerName: 'KH A',
    };
    const lines = [
      { id: 'l1', documentId: 'doc1', productId: 'p1', quantity: 3, locationId: '', serialLot: '', serialRequired: 0, processingStatus: 'COMPLETED' },
      { id: 'l2', documentId: 'doc1', productId: 'p1', quantity: 3, locationId: '', serialLot: '', serialRequired: 0, processingStatus: 'COMPLETED' },
    ];
    const allocations: Record<string, { lotId: string; quantity: number }[]> = {
      l1: [{ lotId: 'lotA', quantity: 2 }, { lotId: 'lotB', quantity: 1 }],
      l2: [{ lotId: 'lotC', quantity: 3 }],
    };
    const db = routeDb({
      docs: [doc],
      lines,
      products: [{ id: 'p1', tracking: 'LOT' }],
      onAll: (sql, params) => {
        if (sql.includes('FROM stock_document_line_lots')) {
          if (sql.includes('documentLineId IN')) {
            return Object.entries(allocations).flatMap(([documentLineId, rows]) =>
              rows.map((row) => ({ documentLineId, ...row }))
            );
          }
          return allocations[params[0]] || [];
        }
        return undefined;
      },
      onGet: (sql, params) => {
        if (sql.includes('FROM stock_document_line_lots') && sql.includes('SUM(quantity)')) {
          const rows = allocations[params[0]] || [];
          return { total: rows.reduce((sum, row) => sum + row.quantity, 0) };
        }
        if (sql.includes('FROM stock_lots')) {
          return { id: params[0], productId: 'p1', warehouseId: 'wh-hn', lotCode: params[0], remainingQty: 100, status: 'ACTIVE' };
        }
        return undefined;
      },
    });

    await request(appFor(db)).post('/issues/doc1/complete').send({}).expect(200);

    const coverageQueries = db.allCalls.filter(([sql]: [string, any[]]) =>
      String(sql).includes('FROM stock_document_line_lots') && String(sql).includes('documentLineId IN') && String(sql).includes('SUM(quantity)')
    );
    const batchQueries = db.allCalls.filter(([sql]: [string, any[]]) =>
      String(sql).includes('FROM stock_document_line_lots') && String(sql).includes('documentLineId IN') && !String(sql).includes('SUM(quantity)')
    );
    expect(coverageQueries).toHaveLength(1);
    expect(batchQueries).toHaveLength(1);
    expect(db.getCalls.filter((sql: string) => sql.includes('FROM stock_counts'))).toHaveLength(1);

    const moves = db.runCalls.filter(([sql]: [string, any[]]) => String(sql).includes('INSERT INTO stock_moves'));
    expect(moves.map(([, params]: [string, any[]]) => params[4])).toEqual([-2, -1, -3]);
    expect(moves.map(([, params]: [string, any[]]) => params[10])).toEqual(['lotA', 'lotB', 'lotC']);
  });

  it('generates the next code with a single indexed query and skips legacy codes', async () => {
    const yy = String(new Date().getFullYear()).slice(2);
    const db = routeDb({
      onAll: (sql) => {
        if (sql.includes('SELECT code FROM stock_documents')) {
          return [{ code: `PNK-${yy}-0007` }, { code: 'PNK-261015-R79Q' }];
        }
        return undefined;
      },
    });

    const res = await request(appFor(db)).get('/next-code?docType=RECEIPT').expect(200);
    expect(res.body.code).toBe(`PNK-${yy}-0008`);
    const codeQuery = db.allCalls.find(([sql]: [string, any[]]) => String(sql).includes('SELECT code FROM stock_documents'));
    expect(codeQuery?.[0]).toContain('REGEXP');
    expect(codeQuery?.[0]).toContain('CAST(SUBSTRING(code,');
    expect(codeQuery?.[0]).toContain('AS UNSIGNED) DESC');
    expect(codeQuery?.[0]).toContain('LIMIT 1');
    expect(codeQuery?.[0]).not.toContain('LIMIT 5000');
  });

  it('pushes warehouse scope into reconciliation and anomaly subqueries', async () => {
    const db = routeDb();

    await request(appFor(db)).get('/reconciliation?warehouseId=wh-hn').expect(200);
    const reconciliation = db.allCalls.find(([sql]: [string, any[]]) => String(sql).includes('FROM stock_moves'));
    expect(reconciliation?.[0]).toContain('FROM stock_moves WHERE warehouseId = ? GROUP BY');
    expect(reconciliation?.[1]).toEqual(['wh-hn', 'wh-hn']);

    await request(appFor(db)).get('/anomalies?type=SERIAL&warehouseId=wh-hn').expect(200);
    const anomalies = db.allCalls.find(([sql]: [string, any[]]) => String(sql).includes('FROM stock_serials'));
    expect(anomalies?.[0]).toContain('FROM stock_balances WHERE warehouseId = ? GROUP BY');
    expect(anomalies?.[1]).toEqual(['wh-hn', 'wh-hn']);

    db.allCalls.length = 0;
    await request(appFor(db)).get('/reconciliation').expect(200);
    const scopedReconciliation = db.allCalls.find(([sql]: [string, any[]]) => String(sql).includes('FROM stock_moves'));
    expect(scopedReconciliation?.[0]).toContain('FROM stock_moves WHERE warehouseId IN (?,?) GROUP BY');
    expect(scopedReconciliation?.[1]).toEqual(['wh-hn', 'wh-hcm', 'wh-hn', 'wh-hcm']);

    await request(appFor(db)).get('/anomalies?type=SERIAL').expect(200);
    const scopedAnomalies = db.allCalls.find(([sql]: [string, any[]]) => String(sql).includes('FROM stock_serials'));
    expect(scopedAnomalies?.[0]).toContain('FROM stock_balances WHERE warehouseId IN (?,?) GROUP BY');
    expect(scopedAnomalies?.[1]).toEqual(['wh-hn', 'wh-hcm', 'wh-hn', 'wh-hcm']);
  });

  it('pages MISA sync logs instead of hardcoding the newest 200 rows', async () => {
    const db = routeDb({
      onAll: (sql) => (sql.includes('FROM misa_sync_logs') ? [{ id: 'log-1' }] : undefined),
      onGet: (sql) => (sql.includes('COUNT(*) AS total FROM misa_sync_logs') ? { total: 731 } : undefined),
    });
    const res = await request(appFor(db)).get('/misa-logs?limit=50&offset=100&status=FAILED').expect(200);
    expect(res.body).toEqual([{ id: 'log-1' }]);
    // Body là mảng trần nên tổng số dòng chỉ có chỗ ở header (FE đã đọc header này).
    expect(res.headers['x-total-count']).toBe('731');
    const page = db.allCalls.find(([sql]: [string, any[]]) => String(sql).includes('FROM misa_sync_logs'));
    expect(page?.[0]).toContain('LIMIT ? OFFSET ?');
    expect(page?.[0]).not.toContain('LIMIT 200');
    expect(page?.[1]).toEqual(['FAILED', 50, 100]);
  });
});
