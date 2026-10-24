import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { stockRoutes } from '../routes/stock.js';
import {
  getWarrantyStartType, resolveWarrantyStart, warrantyEndDate,
} from '../utils/warranty.js';

const tp = { id: 'tp', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };

function appFor(user: any, db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(stockRoutes(db));
  return app;
}

describe('resolveWarrantyStart', () => {
  it('defaults to outbound date', () => {
    expect(resolveWarrantyStart({ startType: 'OUTBOUND', outboundDate: '2026-10-20T10:00:00.000Z' })).toBe('2026-10-20');
  });
  it('prefers configured source dates with outbound fallback', () => {
    expect(resolveWarrantyStart({ startType: 'DELIVERY', deliveryDate: '2026-11-01', outboundDate: '2026-10-20' })).toBe('2026-11-01');
    expect(resolveWarrantyStart({ startType: 'INSTALLATION', installationDate: '', outboundDate: '2026-10-20' })).toBe('2026-10-20');
    expect(resolveWarrantyStart({ startType: 'ACCEPTANCE', acceptanceDate: 'not-a-date', fallbackDate: '2026-09-01' })).toBe('2026-09-01');
  });
  it('returns null when nothing usable', () => {
    expect(resolveWarrantyStart({ startType: 'OUTBOUND' })).toBe(null);
  });
});

describe('warrantyEndDate', () => {
  it('adds calendar months', () => {
    expect(warrantyEndDate('2026-10-15', 12)).toBe('2027-10-15');
    expect(warrantyEndDate('2026-01-31', 1)).toBe('2026-03-03');
    // Test JavaScript Date object (e.g. returned by mysql2)
    expect(warrantyEndDate(new Date('2026-10-22T17:00:00.000Z'), 120)).toBe('2036-10-22');
  });
  it('returns null without start or months', () => {
    expect(warrantyEndDate(null, 12)).toBe(null);
    expect(warrantyEndDate('2026-10-15', 0)).toBe(null);
  });
});

describe('getWarrantyStartType', () => {
  it('falls back to OUTBOUND when unconfigured', async () => {
    expect(await getWarrantyStartType({ get: async () => undefined })).toBe('OUTBOUND');
    expect(await getWarrantyStartType({ get: async () => { throw new Error('db'); } })).toBe('OUTBOUND');
  });
  it('reads configured value case-insensitively', async () => {
    const db = { get: vi.fn(async () => ({ value: 'installation' })) };
    expect(await getWarrantyStartType(db)).toBe('INSTALLATION');
  });
});

describe('serial timeline (Phase 5)', () => {
  const serialRow = {
    id: 's1', serialNumber: 'PV00025', productId: 'p1', productName: 'JA Solar 620W',
    warehouseId: 'wh-hn', warehouseName: 'Kho HN', status: 'SOLD', stockStatus: 'OUT',
    supplier: 'NCC X', customerName: 'Khach A', projectId: 'PJ-1',
    receiptDocumentId: 'pnk1', receiptLineId: 'l1', issueDocumentId: 'pxk3', issueLineId: 'l9',
    receivedAt: '2026-09-01T00:00:00.000Z', outDate: '2026-10-20T00:00:00.000Z',
    warrantyStart: null, warrantyMonths: 12,
  };
  const docs: Record<string, any> = {
    pnk1: { id: 'pnk1', code: 'PNK-26-0001', postingDate: '2026-09-01', partnerName: 'NCC X', warehouseId: 'wh-hn', warehouseName: 'Kho HN' },
    pxk3: { id: 'pxk3', code: 'PXK-26-0003', postingDate: '2026-10-20', partnerName: 'Khach A', warehouseId: 'wh-hn', warehouseName: 'Kho HN' },
  };
  function timelineDb(row: any) {
    return {
      all: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-hn' }];
        if (String(sql).includes('FROM stock_moves')) return [];
        return [];
      }),
      get: vi.fn(async (sql: string, params: any[] = []) => {
        if (String(sql).includes('FROM stock_serials')) return row ? { ...row } : undefined;
        if (String(sql).includes('FROM stock_documents')) return docs[params[0]];
        return undefined;
      }),
      run: vi.fn(),
    };
  }

  it('traces receipt, issue, warehouse and warranty from one serial', async () => {
    const res = await request(appFor(tp, timelineDb(serialRow))).get('/serials/timeline/PV00025').expect(200);
    expect(res.body.serial).toMatchObject({ serialNumber: 'PV00025', stockStatus: 'OUT' });
    expect(res.body.receipt).toMatchObject({ code: 'PNK-26-0001', supplier: 'NCC X' });
    expect(res.body.issue).toMatchObject({ code: 'PXK-26-0003', customerName: 'Khach A' });
    expect(res.body.warranty).toMatchObject({ startType: 'OUTBOUND', start: '2026-10-20', months: 12, end: '2027-10-20' });
    expect(res.body.moves).toEqual([]);
  });

  it('404s unknown serials and 403s out-of-scope warehouses', async () => {
    await request(appFor(tp, timelineDb(undefined))).get('/serials/timeline/NOPE').expect(404);
    const other = { ...serialRow, warehouseId: 'wh-hcm' };
    await request(appFor(tp, timelineDb(other))).get('/serials/timeline/PV00025').expect(403);
  });
});
