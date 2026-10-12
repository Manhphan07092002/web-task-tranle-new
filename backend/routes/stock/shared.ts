import { randomUUID } from 'crypto';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { getWarehouseScope } from '../../services/rbacService.js';

// Helpers dÃ¹ng chung cho má»i sub-router kho (tÃ¡ch tá»« routes/stock.ts, giá»¯ nguyÃªn hÃ nh vi).
export interface StockContext {
  db: any;
  scopeOf: (user: any) => Promise<string[]>;
  isDirector: (user: any) => boolean;
  requireWarehouse: (user: any, warehouseId: string) => Promise<{ ok: boolean; scope: string[] }>;
  requireWarehouseManager: (user: any) => boolean;
  requireBundleManager: (user: any) => boolean;
  requireCountManager: (user: any) => boolean;
  requireMisaManager: (user: any) => boolean;
  assertLocation: (warehouseId: string, locationId: string | null | undefined) => Promise<boolean>;
  isSaleableLocation: (warehouseId: string, locationId: string) => Promise<boolean>;
  availableOf: (productId: string, warehouseId: string, locationId: string) => Promise<number>;
  assertNotCounting: (warehouseId: string) => Promise<void>;
  postMove: (run: (sql: string, params?: any[]) => Promise<unknown>, args: {
    productId: string; warehouseId: string; locationId: string; quantity: number;
    moveType: string; referenceType: string | null; referenceId: string;
    documentLineId: string | null; createdBy: string;
  }) => Promise<void>;
  docCode: (prefix: string) => string;
}

export function createStockContext(db: any): StockContext {
  async function scopeOf(user: any): Promise<string[]> {
    return getWarehouseScope(db, user);
  }

  function isDirector(user: any): boolean {
    return normalizeManagementLevel(user?.managementLevel) >= MANAGEMENT_LEVELS.DIRECTOR
      && normalizeManagementLevel(user?.managementLevel) !== MANAGEMENT_LEVELS.ADMIN;
  }

  /** Admin (99) bá»‹ cháº·n business kho (D12); Director tháº¥y táº¥t cáº£; cÃ²n láº¡i theo scope gÃ¡n. */
  async function requireWarehouse(user: any, warehouseId: string): Promise<{ ok: boolean; scope: string[] }> {
    if (!user || normalizeManagementLevel(user?.managementLevel) === MANAGEMENT_LEVELS.ADMIN) return { ok: false, scope: [] };
    const scope = await scopeOf(user);
    if (isDirector(user)) return { ok: true, scope };
    return { ok: !!warehouseId && scope.includes(warehouseId), scope };
  }

  function requireLevelManager(user: any): boolean {
    const level = normalizeManagementLevel(user?.managementLevel);
    return level >= MANAGEMENT_LEVELS.MANAGER && level !== MANAGEMENT_LEVELS.ADMIN;
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

  async function assertNotCounting(warehouseId: string) {
    const active = await db.get("SELECT id FROM stock_counts WHERE warehouseId = ? AND status = 'COUNTING' LIMIT 1", [warehouseId]);
    if (active) throw Object.assign(new Error('Kho Ä‘ang kiá»ƒm kÃª; hoÃ n táº¥t kiá»ƒm kÃª trÆ°á»›c khi ghi sá»•.'), { status: 409 });
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

  return {
    db,
    scopeOf,
    isDirector,
    requireWarehouse,
    requireWarehouseManager: requireLevelManager,
    requireBundleManager: requireLevelManager,
    requireCountManager: requireLevelManager,
    requireMisaManager: requireLevelManager,
    assertLocation,
    isSaleableLocation,
    availableOf,
    assertNotCounting,
    postMove,
    docCode,
  };
}
