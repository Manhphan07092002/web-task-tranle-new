import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mysqlMock = vi.hoisted(() => ({ createConnection: vi.fn() }));
vi.mock('mysql2/promise', () => ({ default: mysqlMock }));
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(async () => 'test-hash') } }));

import { initDbMysql } from '../db_mysql.js';
import { fakeMysql } from './helpers/fakeMysql.js';

const PACKAGE_TABLES = ['stock_package_types', 'stock_packages', 'stock_package_lines', 'stock_package_movements'];

describe('v49 package schema migration', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'mysql://test:test@localhost/test_packages');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SEED_DEMO_DATA', 'false');
    vi.stubEnv('MAIL_ENCRYPTION_KEY', '');
    vi.stubEnv('ADMIN_DEFAULT_PASSWORD', 'test-packages-password');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  async function restart() {
    const db = await initDbMysql();
    await db.close();
  }

  // DB đang chạy thật: _bootstrap đã hoàn tất, chỉ migration mới được áp dụng.
  function legacyInstall() {
    const store = fakeMysql(mysqlMock);
    store.rows('users').set('real-user', { id: 'real-user' });
    return store;
  }

  it('creates the package tables and seeds package types on a running install', async () => {
    const store = legacyInstall();
    await restart();
    for (const table of PACKAGE_TABLES) expect(store.has(table)).toBe(true);
    expect(store.rows('_migrations').has('49')).toBe(true);
    expect([...store.rows('stock_package_types').values()].map((row) => row.code).sort())
      .toEqual(['CARTON', 'KIEN_GO', 'MEMG_CO', 'PALLET']);
  });

  it('is idempotent across restarts and never re-seeds package types', async () => {
    const store = legacyInstall();
    await restart();
    store.rows('stock_package_types').get('pkgtype-carton')!.name = 'Thùng carton 3 lớp';
    await restart();
    expect(store.rows('stock_package_types').size).toBe(4);
    expect(store.rows('stock_package_types').get('pkgtype-carton')!.name).toBe('Thùng carton 3 lớp');
    expect(store.rows('_migrations').size).toBe(43);
  });

  it('keeps baseline DDL and the v49 migration declaring the same package tables', async () => {
    const source = readFileSync(resolve(process.cwd(), 'db_mysql.ts'), 'utf8');
    const migration = source.slice(source.indexOf('runVersionedMigration(db, 49'));
    for (const table of PACKAGE_TABLES) {
      const baseline = [...source.matchAll(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`, 'g'))];
      // Một trong DDL baseline, một trong migration: thiếu một trong hai là DB fresh
      // và DB migrate sẽ lệch nhau.
      expect(baseline.length, table).toBe(2);
      expect(migration.includes(`CREATE TABLE IF NOT EXISTS ${table} (`), table).toBe(true);
    }
  });

  it('adds package links without touching the frozen ledger table', async () => {
    const source = readFileSync(resolve(process.cwd(), 'db_mysql.ts'), 'utf8');
    expect(source).toContain("ensureColumn('stock_document_lines', 'packageId'");
    expect(source).toContain("ensureColumn('stock_document_lines', 'packageLineId'");
    expect(source).toContain("ensureColumn('warehouse_activity_logs', 'packageId'");
    const ledger = source.slice(
      source.indexOf('CREATE TABLE IF NOT EXISTS stock_moves ('),
      source.indexOf('CREATE TABLE IF NOT EXISTS stock_balances')
    );
    expect(ledger).not.toContain('packageId');
  });
});
