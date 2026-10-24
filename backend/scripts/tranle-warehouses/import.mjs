// Nhập 31 kho thực tế Trần Lê, thay 6 kho seed dev (wh-hn...wh-bhdn).
// Cách dùng: node scripts/tranle-warehouses/import.mjs [--apply]
// Không ghi phiên bản vào _migrations (dữ liệu vận hành, không phải schema).
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const APPLY = process.argv.includes('--apply');
const SEED_IDS = ['wh-hn', 'wh-hx1', 'wh-hx2', 'wh-hcm', 'wh-vt', 'wh-bhdn'];
const LOCATIONS = [
  ['RECEIVING', 'Khu nhận hàng', 'RECEIVING'],
  ['SALEABLE', 'Khu bán hàng', 'SALEABLE'],
  ['PICKING', 'Khu soạn hàng', 'PICKING'],
  ['WARRANTY', 'Khu bảo hành', 'WARRANTY'],
  ['DAMAGED', 'Khu hàng lỗi', 'DAMAGED'],
  ['DEMO', 'Khu trưng bày', 'DEMO'],
  ['QUARANTINE', 'Khu cách ly', 'QUARANTINE'],
];

const dir = dirname(fileURLToPath(import.meta.url));
const list = JSON.parse(await readFile(resolve(dir, 'warehouses.json'), 'utf8'));
const idOf = (code) => `wh-${String(code).toLowerCase().replace(/\s+/g, '-')}`;

const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  // 1. Kiểm tra 6 kho seed có dữ liệu nghiệp vụ không.
  const dirty = [];
  for (const id of SEED_IDS) {
    const [[doc]] = await db.query(
      'SELECT (SELECT COUNT(*) FROM stock_documents WHERE warehouseId = ? OR sourceWarehouseId = ? OR destWarehouseId = ?) AS d, ' +
      '(SELECT COUNT(*) FROM stock_moves WHERE warehouseId = ?) AS m, ' +
      '(SELECT COUNT(*) FROM stock_balances WHERE warehouseId = ? AND (onHand <> 0 OR reserved <> 0)) AS b, ' +
      `(SELECT COUNT(*) FROM reservations WHERE warehouseId = ? AND status = 'HELD') AS r, ` +
      `(SELECT COUNT(*) FROM stock_counts WHERE warehouseId = ? AND status = 'COUNTING') AS c`,
      [id, id, id, id, id, id, id]
    );
    if (Object.values(doc).some((n) => Number(n) > 0)) dirty.push(id);
  }
  const [existing] = await db.query('SELECT id, code FROM warehouses');
  const existingByCode = new Map(existing.map((w) => [String(w.code).toUpperCase(), w.id]));
  const plan = list.map((w) => ({ ...w, code: String(w.code).toUpperCase(), id: idOf(w.code), exists: existingByCode.has(String(w.code).toUpperCase()) }));

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    seedToRemove: SEED_IDS, seedDirty: dirty,
    toInsert: plan.filter((w) => !w.exists).length,
    alreadyThere: plan.filter((w) => w.exists).length,
    total: plan.length,
  }, null, 2));

  if (!APPLY) {
    console.log('Dry-run only. Thêm --apply để nhập.');
    if (dirty.length > 0) console.log(`Lưu ý: giữ lại kho seed còn dữ liệu: ${dirty.join(', ')}`);
    process.exit(0);
  }
  const removable = SEED_IDS.filter((id) => !dirty.includes(id));

  await db.query("SELECT GET_LOCK('tranle_warehouse_import', 30)");
  await db.beginTransaction();
  try {
    for (const id of removable) {
      await db.query('DELETE FROM stock_locations WHERE warehouseId = ?', [id]);
      await db.query('DELETE FROM user_warehouse_scopes WHERE warehouseId = ?', [id]);
      await db.query('DELETE FROM warehouses WHERE id = ?', [id]);
    }
    for (const w of plan) {
      if (w.exists) continue;
      await db.query('INSERT INTO warehouses (id, code, name, region, address, isActive) VALUES (?, ?, ?, NULL, ?, 1)',
        [w.id, w.code, w.name, w.address ?? null]);
      for (const [locCode, locName, purpose] of LOCATIONS) {
        await db.query('INSERT IGNORE INTO stock_locations (id, warehouseId, code, name, type, purpose) VALUES (?, ?, ?, ?, ?, ?)',
          [`loc-${w.id}-${locCode}`, w.id, locCode, locName, 'INTERNAL', purpose]);
      }
    }
    const [staff] = await db.query("SELECT id FROM users WHERE primaryDepartmentId = 'tle-dept-kho' OR department = 'Kho vận'");
    const [whs] = await db.query('SELECT id FROM warehouses');
    for (const u of staff) {
      for (const w of whs) {
        await db.query('INSERT IGNORE INTO user_warehouse_scopes (id, userId, warehouseId) VALUES (?, ?, ?)', [`uws-${u.id}-${w.id}`, u.id, w.id]);
      }
    }
    await db.commit();
    console.log(JSON.stringify({ removedSeeds: removable.length, keptDirtySeeds: dirty, inserted: plan.filter((w) => !w.exists).length, staff: staff.length, warehouses: whs.length }));
  } catch (e) {
    await db.rollback();
    throw e;
  } finally {
    await db.query("SELECT RELEASE_LOCK('tranle_warehouse_import')");
  }
} finally {
  await db.end();
}
