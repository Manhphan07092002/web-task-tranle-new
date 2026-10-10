import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL || 'mysql://root:@127.0.0.1:3306/Tranle_task_new';
const parsed = new URL(url);
const conn = await mysql.createConnection({
  host: parsed.hostname, port: parseInt(parsed.port || '3306', 10),
  user: decodeURIComponent(parsed.username || 'root'),
  password: decodeURIComponent(parsed.password || ''),
  database: parsed.pathname.replace(/^\//, ''),
});

const apply = process.argv.includes('--apply');

// Prefixes minted by backend tests — each carries a Date.now() suffix, so they
// can never collide with codes a human types in the UI.
const PREFIXES = ['DOC-', 'CLS-', 'CNT-', 'POL-', 'VAR-', 'PM-', 'DBG-', 'SGP-',
  'BUN-', 'KIT-', 'LOTP-', 'SER-', 'NOP-', 'TRF-', 'RSV-', 'TR-WH-', 'TR-WH2-',
  'SG-A-', 'SG-B-', 'DC-'];
const like = (col: string) => PREFIXES.map((p) => `${col} LIKE '${p}%'`).join(' OR ');

const count = async (sql: string) => Number((await conn.query(sql) as any)[0][0].c);
const idList = async (sql: string) => {
  const [rows]: any = await conn.query(sql);
  return rows.map((r: any) => {
    if (!/^[A-Za-z0-9_-]+$/.test(r.id)) throw new Error(`unsafe id ${r.id}`);
    return `'${r.id}'`;
  }).join(',') || 'NULL';
};

const TEST_USERS = await idList(`SELECT id FROM users WHERE email LIKE '%@example.com'`);
const TEST_PROD = await idList(`SELECT id FROM stock_products WHERE ${like('code')}`);
const TEST_WH = await idList(`SELECT id FROM warehouses WHERE ${like('code')}`);
const TEST_DOCS = await idList(`SELECT id FROM stock_documents WHERE warehouseId IN (${TEST_WH === 'NULL' ? 'NULL' : TEST_WH})`);
const TEST_COUNTS = await idList(`SELECT id FROM stock_counts WHERE warehouseId IN (${TEST_WH === 'NULL' ? 'NULL' : TEST_WH})`);
const TEST_BUNDLES = await idList(`SELECT id FROM bundles WHERE code LIKE 'BUN-%' OR code LIKE 'KIT-%'`);

const TABLES = ['stock_moves', 'stock_document_lines', 'stock_documents', 'stock_count_lines',
  'stock_counts', 'serials', 'reservations', 'lots', 'stock_policies', 'bundle_items',
  'bundles', 'stock_balances', 'warehouse_locations', 'warehouses', 'stock_products',
  'user_assignments', 'users', 'roles'];

const before: Record<string, number> = {};
for (const t of TABLES) before[t] = await count(`SELECT COUNT(*) AS c FROM ${t}`);
const testUsers = await count(`SELECT COUNT(*) AS c FROM users WHERE email LIKE '%@example.com'`);
const testRoles = await count(`SELECT COUNT(*) AS c FROM roles WHERE name LIKE 'DocsRole%' OR name LIKE 'Bare%' OR name LIKE 'PermRole%' OR name LIKE 'NoPermRole%'`);

console.log(apply ? '=== APPLY ===' : '=== DRY RUN ===');
console.log(`test users: ${testUsers}, test roles: ${testRoles}`);
console.log('before:', JSON.stringify(before));

if (!apply) { await conn.end(); process.exit(0); }

// Children first, parents last — mirrors information_schema KEY_COLUMN_USAGE.
const STEPS: Array<[string, string]> = [
  ['stock_moves', `DELETE FROM stock_moves WHERE createdBy IN (${TEST_USERS}) OR productId IN (${TEST_PROD}) OR warehouseId IN (${TEST_WH})`],
  ['stock_document_lines', `DELETE FROM stock_document_lines WHERE productId IN (${TEST_PROD}) OR docId IN (${TEST_DOCS})`],
  ['stock_documents', `DELETE FROM stock_documents WHERE createdBy IN (${TEST_USERS}) OR warehouseId IN (${TEST_WH})`],
  ['stock_count_lines', `DELETE FROM stock_count_lines WHERE resolvedBy IN (${TEST_USERS}) OR countId IN (${TEST_COUNTS})`],
  ['stock_counts', `DELETE FROM stock_counts WHERE createdBy IN (${TEST_USERS}) OR assigneeId IN (${TEST_USERS}) OR warehouseId IN (${TEST_WH})`],
  ['serials', `DELETE FROM serials WHERE createdBy IN (${TEST_USERS}) OR productId IN (${TEST_PROD}) OR warehouseId IN (${TEST_WH})`],
  ['lots', `DELETE FROM lots WHERE createdBy IN (${TEST_USERS}) OR productId IN (${TEST_PROD})`],
  ['stock_policies', `DELETE FROM stock_policies WHERE createdBy IN (${TEST_USERS}) OR productId IN (${TEST_PROD}) OR warehouseId IN (${TEST_WH})`],
  ['reservations', `DELETE FROM reservations WHERE createdBy IN (${TEST_USERS}) OR assigneeId IN (${TEST_USERS}) OR productId IN (${TEST_PROD}) OR warehouseId IN (${TEST_WH})`],
  ['bundle_items', `DELETE FROM bundle_items WHERE productId IN (${TEST_PROD}) OR bundleId IN (${TEST_BUNDLES})`],
  ['bundles', `DELETE FROM bundles WHERE createdBy IN (${TEST_USERS}) OR id IN (${TEST_BUNDLES})`],
  ['stock_balances', `DELETE FROM stock_balances WHERE productId IN (${TEST_PROD}) OR warehouseId IN (${TEST_WH})`],
  ['warehouse_locations', `DELETE FROM warehouse_locations WHERE createdBy IN (${TEST_USERS}) OR warehouseId IN (${TEST_WH})`],
  ['warehouses', `DELETE FROM warehouses WHERE createdBy IN (${TEST_USERS}) OR managerId IN (${TEST_USERS}) OR ${like('code')}`],
  ['stock_products', `DELETE FROM stock_products WHERE createdBy IN (${TEST_USERS}) OR ${like('code')}`],
  ['user_assignments', `DELETE FROM user_assignments WHERE userId IN (${TEST_USERS})`],
];

try {
  await conn.query('START TRANSACTION');
  const report: string[] = [];
  for (const [name, sql] of STEPS) {
    const [res]: any = await conn.query(sql);
    report.push(`${name}:${res.affectedRows}`);
  }
  // Detach the surviving product from any test author, then drop the accounts.
  await conn.query(`UPDATE stock_products SET createdBy = NULL WHERE createdBy IN (${TEST_USERS})`);
  const [delUsers]: any = await conn.query(`DELETE FROM users WHERE email LIKE '%@example.com'`);
  report.push(`users:${delUsers.affectedRows}`);
  const [delRoles]: any = await conn.query(
    `DELETE FROM roles WHERE name LIKE 'DocsRole%' OR name LIKE 'Bare%' OR name LIKE 'PermRole%'
       OR name LIKE 'NoPermRole%' OR name LIKE 'TmpRole%' OR name LIKE 'Lv20Role%'`
  );
  report.push(`roles:${delRoles.affectedRows}`);
  await conn.query('COMMIT');
  console.log('committed ->', report.join(' '));
} catch (e: any) {
  await conn.query('ROLLBACK').catch(() => {});
  console.error('rolled back:', e.message);
  process.exitCode = 1;
}

const after: Record<string, number> = {};
for (const t of TABLES) after[t] = await count(`SELECT COUNT(*) AS c FROM ${t}`);
console.log('after:', JSON.stringify(after));
await conn.end();
