import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mysqlMock = vi.hoisted(() => ({ createConnection: vi.fn() }));
vi.mock('mysql2/promise', () => ({ default: mysqlMock }));
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(async () => 'test-hash') } }));

import { initDbMysql } from '../db_mysql.js';
import { fakeMysql, type FakeMysqlOptions } from './helpers/fakeMysql.js';

// Persistent query double: reopen connections on restart, retain committed rows,
// and roll back writes on failure. No real MySQL server or credentials are used.
const database = (options?: FakeMysqlOptions) => fakeMysql(mysqlMock, options);

describe('first-install database bootstrap', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'mysql://test:test@localhost/test_bootstrap');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SEED_DEMO_DATA', 'false');
    vi.stubEnv('MAIL_ENCRYPTION_KEY', '');
    vi.stubEnv('ADMIN_DEFAULT_PASSWORD', 'test-bootstrap-password');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  async function restart() {
    const db = await initDbMysql();
    await db.close();
  }

  it('seeds a fresh install once and preserves deletions and edits across restarts', async () => {
    const store = database();
    await restart();
    expect(store.rows('departments').size).toBe(14);
    expect(store.rows('tasks').size).toBe(4);
    expect(store.rows('_bootstrap').get('1')?.completed).toBe(1);
    store.rows('departments').delete('dept-marketing');
    for (const table of ['tasks', 'task_assignees', 'task_tags', 'task_subtasks', 'products', 'notes', 'events', 'contracts']) store.rows(table).clear();
    store.rows('projects').get('proj-01')!.name = 'Edited project';
    store.rows('clients').get('client-chaugiang')!.name = 'Edited client';
    store.rows('projects').delete('proj-02');
    store.rows('clients').delete('client-vinhlinh');
    store.rows('_migrations').delete('3');
    vi.stubEnv('SEED_DEMO_DATA', 'true');
    await restart();
    await restart();
    expect(store.rows('departments').has('dept-marketing')).toBe(false);
    for (const table of ['tasks', 'products', 'notes', 'events', 'contracts']) expect(store.rows(table).size).toBe(0);
    expect(store.rows('projects').get('proj-01')!.name).toBe('Edited project');
    expect(store.rows('clients').get('client-chaugiang')!.name).toBe('Edited client');
    expect(store.rows('projects').has('proj-02')).toBe(false);
    expect(store.rows('clients').has('client-vinhlinh')).toBe(false);
    expect(store.rows('_migrations').has('3')).toBe(true);
  });

  it.each([false, true])('adopts a legacy installation without seeding, populated=%s', async (populated) => {
    const store = database();
    const users = store.rows('users');
    if (populated) users.set('real-user', { id: 'real-user' });
    await restart();
    await restart();
    expect(store.rows('users').size).toBe(populated ? 1 : 0);
    expect(store.rows('departments').size).toBe(0);
    expect(store.rows('tasks').size).toBe(0);
    expect(store.rows('system_config').size).toBe(0);
    expect(store.rows('_bootstrap').get('1')?.completed).toBe(1);
    expect(store.rows('_migrations').size).toBe(43); // v34-v49: LOT allocation/transfer, Serial lifecycle, tracking, audit log, MISA enum, alert state, issue reservation links, hot-path indexes, DECIMAL quantities/vatRate/prices, loose-lot tracking, packages
  });

  it('does not recreate accounts, roles, or config after all application data is deleted', async () => {
    const store = database();
    vi.stubEnv('NODE_ENV', 'production');
    await restart();
    expect([...store.rows('users').keys()]).toEqual(['u1']);
    expect(store.rows('tasks').size).toBe(0);
    for (const table of ['users', 'roles', 'departments', 'system_config']) store.rows(table).clear();
    vi.stubEnv('SEED_DEMO_DATA', 'true');
    await restart();
    for (const table of ['users', 'roles', 'departments', 'system_config', 'tasks']) expect(store.rows(table).size).toBe(0);
  });

  it.each([/^INSERT INTO tasks/, /^UPDATE _bootstrap/])('rolls back a failed bootstrap and retries: %s', async (failure) => {
    const store = database();
    store.failNext(failure);
    await expect(restart()).rejects.toThrow('injected database failure');
    expect(store.rows('_bootstrap').get('1')?.completed).toBe(0);
    for (const table of ['users', 'departments', 'system_config', 'projects']) expect(store.rows(table).size).toBe(0);
    // v12 Deputy seed chạy ở migrateSchema (ngoài seed transaction, như mọi migration
    // MySQL) nên được giữ lại sau rollback — hành vi thật, không phải rò rỉ seed.
    expect(store.rows('roles').size).toBeLessThanOrEqual(1);
    await restart();
    expect(store.rows('_bootstrap').get('1')?.completed).toBe(1);
    expect(store.rows('tasks').size).toBe(4);
    expect(store.rows('roles').has('role-deputy')).toBe(true);
  });

  it('retries first-install schema failures without treating partial schema as a legacy install', async () => {
    const store = database();
    store.failNext(/^CREATE TABLE IF NOT EXISTS tasks/);
    await expect(restart()).rejects.toThrow('injected database failure');
    expect(store.rows('_bootstrap').get('1')?.completed).toBe(0);
    await restart();
    expect(store.rows('_bootstrap').get('1')?.completed).toBe(1);
    expect(store.rows('users').size).toBe(4);
    expect(store.rows('tasks').size).toBe(4);
  });

  it('drops empty legacy position tables but keeps tables holding data', async () => {
    const store = database();
    store.rows('positions').set('pos-1', { id: 'pos-1' });
    await restart();
    expect(store.rows('positions').get('pos-1')).toBeDefined();
    expect(store.query.mock.calls.some(([sql]) => String(sql).includes('DROP TABLE IF EXISTS `positions`'))).toBe(false);
    expect(store.query.mock.calls.some(([sql]) => String(sql).includes('DROP TABLE IF EXISTS `user_positions`'))).toBe(true);
  });

  // Bỏ qua cột legacy `qty` (đã được migration cũ đổi sang DECIMAL và code không
  // còn đọc) để chỉ đo v45–v47.
  const decimalAlters = (store: ReturnType<typeof database>) => store.query.mock.calls
    .map(([sql]) => String(sql))
    .filter((sql) => sql.startsWith('ALTER TABLE') && sql.includes('DECIMAL(') && !sql.includes('MODIFY COLUMN qty '));

  it('converts stock quantity columns to DECIMAL when the current type is unknown', async () => {
    const store = database();
    await restart();
    expect(decimalAlters(store)).toHaveLength(31); // 26 quantities + 2 vatRate + 3 product prices
    expect(decimalAlters(store)).toContain('ALTER TABLE `stock_balances` MODIFY COLUMN `onHand` DECIMAL(18,3) NOT NULL DEFAULT 0');
    expect(decimalAlters(store)).toContain('ALTER TABLE `stock_documents` MODIFY COLUMN `vatRate` DECIMAL(7,4) NOT NULL DEFAULT 0');
  });

  it('skips the ALTER when the column already has the target DECIMAL type', async () => {
    // Chốt idempotency: boot lại trên DB đã migrate không được phát ALTER nào.
    const store = database({
      columnTypes: (table, column) => ({
        dataType: 'decimal',
        numericScale: column === 'vatRate' ? 4 : table === 'products' ? 2 : 3,
      }),
    });
    await restart();
    expect(decimalAlters(store)).toEqual([]);
  });
});
