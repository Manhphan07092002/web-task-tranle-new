import { randomUUID } from 'crypto';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { getWarehouseScope } from '../../services/rbacService.js';

// Helpers dùng chung cho mọi sub-router kho: scope, vị trí, tồn,
// ghi moves + balances, mã chứng từ, phân trang.
export function createStockContext(db: any) {
  async function scopeOf(user: any): Promise<string[]> {
    return getWarehouseScope(db, user);
  }

  function isDirector(user: any): boolean {
    return normalizeManagementLevel(user?.managementLevel) >= MANAGEMENT_LEVELS.DIRECTOR
      && normalizeManagementLevel(user?.managementLevel) !== MANAGEMENT_LEVELS.ADMIN;
  }

  /** Admin (99) bị chặn business kho (D12); Director thấy tất cả; còn lại theo scope gán. */
  async function requireWarehouse(user: any, warehouseId: string): Promise<{ ok: boolean; scope: string[] }> {
    if (!user || normalizeManagementLevel(user?.managementLevel) === MANAGEMENT_LEVELS.ADMIN) return { ok: false, scope: [] };
    const scope = await scopeOf(user);
    if (isDirector(user)) return { ok: true, scope };
    return { ok: !!warehouseId && scope.includes(warehouseId), scope };
  }

  /** TRANSFER liên quan 2 kho: đọc cho phép 1 trong 2 đầu, ghi yêu cầu cả 2 đầu. */
  function docWarehouseIds(doc: any): string[] {
    return [doc?.warehouseId, doc?.sourceWarehouseId, doc?.destWarehouseId].filter(Boolean);
  }

  async function canReadDocument(user: any, doc: any): Promise<boolean> {
    if (!user || normalizeManagementLevel(user?.managementLevel) === MANAGEMENT_LEVELS.ADMIN) return false;
    if (isDirector(user)) return true;
    const ids = docWarehouseIds(doc);
    if (ids.length === 0) return true;
    const scope = await scopeOf(user);
    return ids.some((id) => scope.includes(id));
  }

  async function canWriteDocument(user: any, doc: any): Promise<boolean> {
    if (!user || normalizeManagementLevel(user?.managementLevel) === MANAGEMENT_LEVELS.ADMIN) return false;
    if (isDirector(user)) return true;
    const ids = docWarehouseIds(doc);
    if (ids.length === 0) return true;
    const scope = await scopeOf(user);
    return ids.every((id) => scope.includes(id));
  }

  async function assertLocation(warehouseId: string, locationId: string | null | undefined): Promise<boolean> {
    if (!locationId) return true;
    const loc = await db.get('SELECT warehouseId, isActive, purpose FROM stock_locations WHERE id = ?', [locationId]);
    return !!loc && loc.warehouseId === warehouseId && (loc.isActive === 1 || loc.isActive === true);
  }

  async function isSaleableLocation(warehouseId: string, locationId: string): Promise<boolean> {
    if (!locationId) return true;
    const location = await db.get('SELECT warehouseId, isActive, purpose FROM stock_locations WHERE id = ?', [locationId]);
    return !!location && location.warehouseId === warehouseId && Boolean(location.isActive) && location.purpose === 'SALEABLE';
  }

  async function availableOf(productId: string, warehouseId: string, locationId: string): Promise<number> {
    const row = await db.get(
      'SELECT onHand, reserved FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ?',
      [productId, warehouseId, locationId]
    );
    return Number(row?.onHand ?? 0) - Number(row?.reserved ?? 0);
  }

  /** Vị trí SALEABLE đang hoạt động ('' mặc định luôn tính là bán được). */
  async function saleableLocationSet(warehouseId: string, locationIds: string[]): Promise<Set<string>> {
    const out = new Set<string>(['']);
    const ids = [...new Set(locationIds.filter(Boolean))];
    if (ids.length === 0) return out;
    const rows = await db.all(
      `SELECT id FROM stock_locations WHERE warehouseId = ? AND purpose = 'SALEABLE' AND isActive = 1 AND id IN (${ids.map(() => '?').join(', ')})`,
      [warehouseId, ...ids]
    ).catch(() => []);
    for (const r of rows || []) out.add(r.id);
    return out;
  }

  /** Tổng khả dụng SALEABLE toàn kho (location '' mặc định + vị trí SALEABLE đang hoạt động). */
  async function saleableAvailableOf(productId: string, warehouseId: string): Promise<number> {
    const row = await db.get(
      `SELECT SUM(b.onHand - b.reserved) AS available FROM stock_balances b
        LEFT JOIN stock_locations l ON l.id = b.locationId AND l.warehouseId = b.warehouseId
       WHERE b.productId = ? AND b.warehouseId = ?
         AND (b.locationId = '' OR (l.isActive = 1 AND l.purpose = 'SALEABLE'))`,
      [productId, warehouseId]
    );
    return Number(row?.available ?? 0);
  }

  async function assertNotCounting(warehouseId: string) {
    const active = await db.get("SELECT id FROM stock_counts WHERE warehouseId = ? AND status = 'COUNTING' LIMIT 1", [warehouseId]);
    if (active) throw Object.assign(new Error('Kho đang kiểm kê; hoàn tất kiểm kê trước khi ghi sổ.'), { status: 409 });
  }

  async function postMove(run: (sql: string, params?: any[]) => Promise<unknown>, args: {
    productId: string; warehouseId: string; locationId: string; quantity: number;
    moveType: string; referenceType: string | null; referenceId: string;
    documentLineId: string | null; createdBy: string;
  }): Promise<void> {
    await assertNotCounting(args.warehouseId);
    const now = new Date().toISOString();
    await run(
      `INSERT INTO stock_moves (id, productId, warehouseId, locationId, quantity, moveType, referenceType, referenceId, documentLineId, createdBy, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), args.productId, args.warehouseId, args.locationId || null, args.quantity, args.moveType, args.referenceType, args.referenceId, args.documentLineId, args.createdBy, now]
    );
    await run(
      `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
       VALUES (?, ?, ?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)`,
      [args.productId, args.warehouseId, args.locationId, args.quantity, now]
    );
  }

  function docCode(prefix: string): string {
    const d = new Date();
    const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${stamp}-${rand}`;
  }

  /** Phân trang cho các endpoint list: mặc định 500 (giữ tương thích FE cũ), tối đa 1000. */
  function paginationOf(query: Record<string, string | undefined>): { limit: number; offset: number } {
    const rawLimit = Number(query.limit);
    const rawOffset = Number(query.offset);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 1000) : 500;
    const offset = Number.isFinite(rawOffset) ? Math.min(Math.max(Math.floor(rawOffset), 0), 1_000_000) : 0;
    return { limit, offset };
  }
  function requireWarehouseManager(user: any) {
    const level = normalizeManagementLevel(user?.managementLevel);
    return level >= MANAGEMENT_LEVELS.MANAGER && level !== MANAGEMENT_LEVELS.ADMIN;
  }
  return {
    db, scopeOf, isDirector, requireWarehouse, requireWarehouseManager, docWarehouseIds, canReadDocument, canWriteDocument, assertLocation, isSaleableLocation, availableOf, saleableLocationSet, saleableAvailableOf, assertNotCounting, postMove, docCode, paginationOf,
  };
}

export type StockContext = ReturnType<typeof createStockContext>;
