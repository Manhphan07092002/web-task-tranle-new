import { vi } from 'vitest';

type Row = Record<string, any>;

export interface FakeMysqlOptions {
  /** Trả về row information_schema.columns cho ensureColumnType; undefined = cột chưa tồn tại. */
  columnTypes?: (table: string, column: string) => Row | undefined;
}

export interface FakeMysqlStore {
  rows: (table: string) => Map<string, Row>;
  has: (table: string) => boolean;
  query: ReturnType<typeof vi.fn>;
  failNext: (pattern: RegExp) => void;
}

/**
 * MySQL double dùng chung cho các test schema/bootstrap: giữ row qua nhiều lần mở
 * kết nối (restart), snapshot/rollback khi transaction thất bại và báo lỗi rõ cho
 * SQL chưa được mô phỏng. Không cần MySQL server hay credentials thật.
 */
export function fakeMysql(
  createConnectionMock: { createConnection: ReturnType<typeof vi.fn> },
  options: FakeMysqlOptions = {},
): FakeMysqlStore {
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
      if (sql.includes('table_name = ?')) return [[{ count: tables.has(String(params[0])) ? 1 : 0 }]];
      if (sql.includes('table_name IN (')) {
        // dbBootstrap liệt kê tên bảng bằng literal, không phải placeholder.
        const names = [...sql.matchAll(/'(\w+)'/g)].map((m) => m[1]);
        return [[{ count: names.filter((name) => tables.has(name)).length }]];
      }
      return [[...tables.keys()].map((name) => ({ name }))];
    }
    if (sql.includes('FROM information_schema.columns')) {
      if (options.columnTypes && sql.includes('DATA_TYPE')) {
        const row = options.columnTypes(String(params[0]), String(params[1]));
        return [row ? [row] : []];
      }
      return [[{ count: 1 }]];
    }
    if (sql.includes('FROM information_schema.statistics')) return [[{ count: 0 }]]; // Index checks
    if (sql.includes('FROM information_schema.key_column_usage')) return [[]]; // No legacy FKs in test DB
    if (sql.startsWith('CREATE INDEX')) return [{ affectedRows: 0 }];
    if (sql.startsWith('DROP TABLE IF EXISTS')) return [{ affectedRows: 0 }]; // v14 drops empty legacy tables
    if (sql.startsWith('ALTER TABLE') && sql.includes('DROP COLUMN')) return [{ affectedRows: 0 }];
    if (sql.startsWith('ALTER TABLE') && sql.includes('MODIFY COLUMN')) return [{ affectedRows: 0 }];
    if (sql.startsWith('ALTER TABLE') && sql.includes('ADD UNIQUE KEY')) return [{ affectedRows: 0 }]; // v25 count_lines
    if (sql.startsWith('ALTER TABLE') && sql.includes('DROP FOREIGN KEY')) return [{ affectedRows: 0 }]; // v24/v25 stale FKs
    if (sql.startsWith('ALTER TABLE stock_document_lines MODIFY')) return [{ affectedRows: 0 }]; // v40 removes hard-coded account defaults
    if (sql.startsWith('DELETE legacy FROM misa_mappings')) return [{ affectedRows: 0 }]; // v41 canonical mapping cleanup
    if (sql.startsWith('UPDATE misa_mappings SET entityType')) return [{ affectedRows: 0 }]; // v41 mapping canonicalization
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
    if (/^UPDATE products\b/.test(sql)) return [{ affectedRows: 0 }]; // v38 tracking backfill
    if (/^UPDATE (reservations|stock_documents|stock_document_lines|stock_moves|stock_count_lines|stock_serials)\b/.test(sql)) return [{ affectedRows: 0 }]; // v24/v25 ledger backfills + v33 serial lifecycle backfill
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
  createConnectionMock.createConnection.mockImplementation(async () => ({ query, end: vi.fn() }));
  return { rows, has: (table: string) => tables.has(table), query, failNext: (pattern: RegExp) => { failure = pattern; } };
}
