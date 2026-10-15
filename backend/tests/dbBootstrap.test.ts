import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mysqlMock = vi.hoisted(() => ({ createConnection: vi.fn() }));
vi.mock('mysql2/promise', () => ({ default: mysqlMock }));
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(async () => 'test-hash') } }));

import { initDbMysql } from '../db_mysql.js';

type Row = Record<string, any>;

// Persistent query double: reopen connections on restart, retain committed rows,
// and roll back writes on failure. No real MySQL server or credentials are used.
function database() {
  let tables = new Map<string, Map<string, Row>>();
  let snapshot: typeof tables | undefined;
  let failure: RegExp | undefined;
  const rows = (table: string) => {
    if (!tables.has(table)) tables.set(table, new Map());
    return tables.get(table)!;
  };
  const query = vi.fn(async (statement: string, params: any[] = []) => {
    const sql = statement.trim().replace(/\s+/g, ' ');
    if (failure?.test(sql)) {
      failure = undefined;
      throw new Error('injected database failure');
    }
    if (sql === 'START TRANSACTION') { snapshot = structuredClone(tables); return [{ affectedRows: 0 }]; }
    if (sql === 'COMMIT') { snapshot = undefined; return [{ affectedRows: 0 }]; }
    if (sql === 'ROLLBACK') { tables = snapshot!; snapshot = undefined; return [{ affectedRows: 0 }]; }
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
    if (sql.startsWith('CREATE DATABASE')) return [{ affectedRows: 0 }];
    const create = sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/);
    if (create) { rows(create[1]); return [{ affectedRows: 0 }]; }
    if (sql.includes('FROM information_schema.tables')) {
      return [[{ count: ['users', 'roles', 'departments', 'tasks', 'system_config', '_migrations'].filter(t => tables.has(t)).length }]];
    }
    if (sql.includes('FROM information_schema.columns')) return [[{ count: 1 }]];
    if (sql.includes('FROM information_schema.statistics')) return [[{ count: 0 }]]; // Index checks
    if (sql.includes('FROM information_schema.key_column_usage')) return [[]]; // No legacy FKs in test DB
    if (sql.startsWith('CREATE INDEX')) return [{ affectedRows: 0 }];
    if (sql.startsWith('DROP TABLE IF EXISTS')) return [{ affectedRows: 0 }]; // v14 drops empty legacy tables
    if (sql.startsWith('ALTER TABLE') && sql.includes('DROP COLUMN')) return [{ affectedRows: 0 }];
    if (sql.startsWith('ALTER TABLE') && sql.includes('MODIFY COLUMN')) return [{ affectedRows: 0 }];
    if (sql.startsWith('ALTER TABLE') && sql.includes('ADD UNIQUE KEY')) return [{ affectedRows: 0 }]; // v25 count_lines
    if (sql.startsWith('ALTER TABLE') && sql.includes('DROP FOREIGN KEY')) return [{ affectedRows: 0 }]; // v24/v25 stale FKs
    if (sql === 'SELECT completed FROM _bootstrap WHERE id = 1') return [[...rows('_bootstrap').values()]];
    if (sql === 'SELECT version FROM _migrations WHERE version = ?') {
      const row = rows('_migrations').get(String(params[0]));
      return [row ? [row] : []];
    }
    const count = sql.match(/^SELECT COUNT\(\*\) as count FROM (\w+)$/i);
    if (count) return [[{ count: rows(count[1]).size }]];
    const ids = sql.match(/^SELECT id FROM (\w+)/);
    if (ids) return [[]]; // v13 scope bootstrap: test DB has no Kho staff
    if (sql.startsWith('UPDATE password_reset_tokens')) return [{ affectedRows: 0 }];
    if (/^UPDATE (users|roles)\b/.test(sql)) return [{ affectedRows: 0 }]; // v11/v12 level backfills + role/user syncs
    if (/^UPDATE (reservations|stock_documents|stock_document_lines|stock_moves|stock_count_lines)\b/.test(sql)) return [{ affectedRows: 0 }]; // v24/v25 ledger backfills
    if (sql === 'UPDATE _bootstrap SET completed = 1 WHERE id = 1') {
      rows('_bootstrap').get('1')!.completed = 1;
      return [{ affectedRows: 1 }];
    }
    if (sql === 'INSERT INTO _bootstrap (id, completed) VALUES (1, ?)') {
      rows('_bootstrap').set('1', { id: 1, completed: params[0] });
      return [{ affectedRows: 1 }];
    }
    const insert = sql.match(/^INSERT( IGNORE)? INTO (\w+) \(([^)]+)\)/);
    if (insert) {
      const columns = insert[3].split(',').map(c => c.trim().replace(/`/g, ''));
      const row = Object.fromEntries(columns.map((c, i) => [c, params[i]]));
      const table = rows(insert[2]);
      const key = String(row.id ?? row.key ?? row.version ?? table.size);
      if (!insert[1] || !table.has(key)) table.set(key, row);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unhandled test SQL: ${sql}`);
  });
  mysqlMock.createConnection.mockImplementation(async () => ({ query, end: vi.fn() }));
  return { rows, query, failNext: (pattern: RegExp) => { failure = pattern; } };
}

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
    expect(store.rows('_migrations').size).toBe(26); // + v11..v22, v24, v25, v26, v29, v30, v31, v32 (v23, v27, v28 không tồn tại ở code)
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
});
