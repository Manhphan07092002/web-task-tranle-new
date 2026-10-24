import { describe, expect, it, vi } from 'vitest';
import { checkStockAlerts } from '../schedulers/stockAlerts.js';
import { classifyStockAlert } from '../services/stockAlerts.js';

function alertRow(overrides: Record<string, any> = {}) {
  return {
    productId: 'p1',
    warehouseId: 'wh-hn',
    onHand: 0,
    reserved: 0,
    available: 0,
    productName: 'Máy A',
    warehouseCode: 'HN',
    warehouseName: 'Kho Hà Nội',
    minStock: 5,
    maxStock: 100,
    reorderPoint: 5,
    ...overrides,
  };
}

function stateRow(overrides: Record<string, any> = {}) {
  return {
    productId: 'p1',
    warehouseId: 'wh-hn',
    alertType: 'OUT',
    isActive: 1,
    stateVersion: 1,
    ...overrides,
  };
}

function notifyDb(opts: {
  alerts?: any[];
  states?: any[];
  recipients?: any[];
  notificationChanges?: number;
} = {}) {
  const allCalls: [string, any[]][] = [];
  const runCalls: [string, any[]][] = [];
  const getCalls: [string, any[]][] = [];
  const db: any = {
    allCalls,
    runCalls,
    getCalls,
    all: vi.fn(async (sql: string, params: any[] = []) => {
      allCalls.push([sql, params]);
      if (sql.includes('FROM stock_balances b')) return opts.alerts || [];
      if (sql.includes('FROM stock_alert_state')) return opts.states || [];
      if (sql.includes('FROM users u')) return opts.recipients || [];
      return [];
    }),
    get: vi.fn(async (sql: string, params: any[] = []) => {
      getCalls.push([sql, params]);
      if (sql.includes('FROM users')) return { email: null, name: 'Manager', preferences: '{}' };
      return undefined;
    }),
    run: vi.fn(async (sql: string, params: any[] = []) => {
      runCalls.push([sql, params]);
      if (sql.includes('INSERT IGNORE INTO notifications')) {
        return { changes: opts.notificationChanges ?? 1 };
      }
      return { changes: 1 };
    }),
  };
  return db;
}

function notificationInserts(db: any): [string, any[]][] {
  return db.runCalls.filter(([sql]: [string, any[]]) => String(sql).includes('INSERT IGNORE INTO notifications'));
}

describe('Phase 6C stock alert notifications', () => {
  it('notifies scoped managers when a new alert appears', async () => {
    const db = notifyDb({ alerts: [alertRow()], states: [], recipients: [{ id: 'u1' }] });
    const sent = await checkStockAlerts(db, new Date('2026-10-23T08:00:00.000Z'));

    expect(sent).toBe(1);
    const inserts = notificationInserts(db);
    expect(inserts).toHaveLength(1);
    const params = inserts[0][1];
    expect(params[1]).toBe('u1');
    expect(params[2]).toBe('stock_alert');
    expect(params[3]).toContain('Cảnh báo tồn kho');
    expect(params[4]).toContain('1 hết hàng');
    expect(params[5]).toBe('stock-alert:wh-hn');

    const stateInsert = db.runCalls.find(([sql]: [string, any[]]) => String(sql).includes('INSERT INTO stock_alert_state'));
    expect(stateInsert?.[1]).toEqual(['p1', 'wh-hn', 'OUT', 1, '2026-10-23T08:00:00.000Z']);
  });

  it('does not notify again while the same alert stays active', async () => {
    const db = notifyDb({
      alerts: [alertRow()],
      states: [stateRow()],
      recipients: [{ id: 'u1' }],
    });
    const sent = await checkStockAlerts(db);

    expect(sent).toBe(0);
    expect(notificationInserts(db)).toHaveLength(0);
    expect(db.runCalls.some(([sql]: [string, any[]]) => String(sql).includes('INSERT INTO stock_alert_state'))).toBe(false);
  });

  it('notifies when an alert changes level from LOW to OUT', async () => {
    const db = notifyDb({
      alerts: [alertRow({ available: 0 })],
      states: [stateRow({ alertType: 'LOW', stateVersion: 2 })],
      recipients: [{ id: 'u1' }],
    });
    const sent = await checkStockAlerts(db);

    expect(sent).toBe(1);
    const stateInsert = db.runCalls.find(([sql]: [string, any[]]) => String(sql).includes('INSERT INTO stock_alert_state'));
    expect(stateInsert?.[1]?.[2]).toBe('OUT');
    expect(stateInsert?.[1]?.[3]).toBe(3);
    expect(notificationInserts(db)).toHaveLength(1);
  });

  it('marks resolved alerts inactive without notifying', async () => {
    const db = notifyDb({ alerts: [], states: [stateRow()], recipients: [{ id: 'u1' }] });
    const sent = await checkStockAlerts(db);

    expect(sent).toBe(0);
    expect(notificationInserts(db)).toHaveLength(0);
    const deactivate = db.runCalls.find(([sql]: [string, any[]]) => String(sql).includes('SET isActive = 0'));
    expect(deactivate?.[1]?.[1]).toBe('p1');
    expect(deactivate?.[1]?.[2]).toBe('wh-hn');
  });

  it('keeps state but skips notification when no manager is scoped to the warehouse', async () => {
    const db = notifyDb({ alerts: [alertRow()], states: [], recipients: [] });
    const sent = await checkStockAlerts(db);

    expect(sent).toBe(0);
    expect(notificationInserts(db)).toHaveLength(0);
    expect(db.runCalls.some(([sql]: [string, any[]]) => String(sql).includes('INSERT INTO stock_alert_state'))).toBe(true);
  });

  it('targets manager level and excludes Admin recipients', async () => {
    const db = notifyDb({ alerts: [alertRow()], states: [], recipients: [] });
    await checkStockAlerts(db);

    const recipientQuery = db.allCalls.find(([sql]: [string, any[]]) => String(sql).includes('FROM users u'));
    expect(recipientQuery?.[0]).toContain('u.managementLevel >= ?');
    expect(recipientQuery?.[0]).toContain('u.managementLevel <> ?');
    expect(recipientQuery?.[1]).toEqual(['wh-hn', 20, 99]);
  });

  it('classifies OUT before LOW/MAX and detects each level', () => {
    expect(classifyStockAlert(alertRow({ available: 0, onHand: 200 }))).toBe('OUT');
    expect(classifyStockAlert(alertRow({ available: 3, onHand: 3 }))).toBe('LOW');
    expect(classifyStockAlert(alertRow({ available: 50, onHand: 200 }))).toBe('MAX');
    expect(classifyStockAlert(alertRow({ available: 50, onHand: 50 }))).toBeNull();
  });
});
