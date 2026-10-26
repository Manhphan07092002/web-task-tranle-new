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
    );
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

  type MoveInput = {
    productId: string; warehouseId: string; locationId: string; quantity: number;
    moveType: string; referenceType: string | null; referenceId: string;
    documentLineId: string | null; lotId?: string | null; serialId?: string | null; createdBy: string;
  };
  type ActivityInput = {
    actionType: string; entityType: string; entityId?: string | null; documentId?: string | null;
    documentCode?: string | null; productId?: string | null; serialId?: string | null; lotId?: string | null;
    warehouseId?: string | null; fromWarehouseId?: string | null; toWarehouseId?: string | null;
    quantity?: number | null; unit?: string | null; userId?: string | null;
    oldData?: unknown; newData?: unknown; metadata?: unknown; createdAt?: string;
  };

  const activityByMove: Record<string, string> = {
    RECEIPT: 'RECEIPT_COMPLETED', RETURN: 'RETURN_COMPLETED', ISSUE: 'ISSUE_COMPLETED',
    TRANSFER_IN: 'TRANSFER_RECEIVED', TRANSFER_OUT: 'TRANSFER_SHIPPED',
    ADJUSTMENT: 'STOCK_ADJUSTMENT_CREATED', RECOUNT_ADJUSTMENT: 'STOCK_ADJUSTMENT_CREATED',
    KIT_IN: 'KIT_ASSEMBLED', KIT_OUT: 'KIT_DISASSEMBLED', INTERNAL_MOVE: 'INTERNAL_MOVE',
  };
  const jsonValue = (value: unknown) => value === undefined || value === null ? null : JSON.stringify(value);

  async function recordWarehouseActivities(
    run: (sql: string, params?: any[]) => Promise<unknown>,
    argsList: ActivityInput[]
  ): Promise<void> {
    const CHUNK = 200;
    for (let offset = 0; offset < argsList.length; offset += CHUNK) {
      const chunk = argsList.slice(offset, offset + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params = chunk.flatMap((args) => [
        randomUUID(), args.actionType, args.entityType, args.entityId ?? null, args.documentId ?? null,
        args.documentCode ?? null, args.productId ?? null, args.serialId ?? null, args.lotId ?? null,
        args.warehouseId ?? null, args.fromWarehouseId ?? null, args.toWarehouseId ?? null,
        args.quantity ?? null, args.unit ?? null, args.userId ?? null, jsonValue(args.oldData), jsonValue(args.newData),
        jsonValue(args.metadata), args.createdAt || new Date().toISOString(),
      ]);
      await run(
        `INSERT INTO warehouse_activity_logs
         (id, actionType, entityType, entityId, documentId, documentCode, productId, serialId, lotId,
          warehouseId, fromWarehouseId, toWarehouseId, quantity, unit, userId, oldData, newData, metadata, createdAt)
         VALUES ${placeholders}`,
        params
      );
    }
  }

  async function recordWarehouseActivity(
    run: (sql: string, params?: any[]) => Promise<unknown>,
    args: ActivityInput
  ): Promise<void> {
    await recordWarehouseActivities(run, [args]);
  }

  async function postMove(
    run: (sql: string, params?: any[]) => Promise<unknown>,
    args: MoveInput,
    opts?: { skipCountingCheck?: boolean }
  ): Promise<void> {
    // Luồng chứng từ đã gọi assertNotCounting trong preflightPosting (cùng
    // transaction) nên không cần kiểm tra lại cho từng move/chiếc.
    if (!opts?.skipCountingCheck) await assertNotCounting(args.warehouseId);
    const now = new Date().toISOString();
    const moveId = randomUUID();
    await run(
      `INSERT INTO stock_moves (id, productId, warehouseId, locationId, quantity, moveType, referenceType, referenceId, documentLineId, serialId, lotId, createdBy, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [moveId, args.productId, args.warehouseId, args.locationId || null, args.quantity, args.moveType, args.referenceType, args.referenceId, args.documentLineId, args.serialId ?? null, args.lotId ?? null, args.createdBy, now]
    );
    await run(
      `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
       VALUES (?, ?, ?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)`,
      // stock_balances.locationId là NOT NULL DEFAULT '' và là một phần của khóa
      // tồn; sentinel '' phải khớp với postMoves, nếu không cùng một vị trí sẽ
      // bị tách thành 2 dòng tồn.
      [args.productId, args.warehouseId, args.locationId || '', args.quantity, now]
    );
    await recordWarehouseActivities(run, [{
      actionType: activityByMove[args.moveType] || `STOCK_MOVE_${args.moveType}`,
      entityType: 'STOCK_MOVE', entityId: moveId, documentId: args.referenceId,
      productId: args.productId, serialId: args.serialId ?? null, lotId: args.lotId ?? null,
      warehouseId: args.warehouseId, quantity: args.quantity, userId: args.createdBy,
      metadata: { moveType: args.moveType, referenceType: args.referenceType, documentLineId: args.documentLineId },
      createdAt: now,
    }]);
  }

  /** Ghi nhiều move trong ít round-trip. Phiếu nhỏ vẫn đi qua postMove để giữ
   * nguyên audit/error chi tiết; phiếu lớn gộp insert moves, upsert balances
   * và activity logs theo lô. */
  async function postMoves(
    run: (sql: string, params?: any[]) => Promise<unknown>,
    moves: MoveInput[],
    opts?: { skipCountingCheck?: boolean }
  ): Promise<void> {
    if (moves.length === 0) return;
    const BATCH_THRESHOLD = 20;
    if (moves.length <= BATCH_THRESHOLD) {
      for (const move of moves) await postMove(run, move, opts);
      return;
    }
    if (!opts?.skipCountingCheck) {
      for (const warehouseId of new Set(moves.map((move) => move.warehouseId))) {
        await assertNotCounting(warehouseId);
      }
    }
    const now = new Date().toISOString();
    const rows = moves.map((move) => ({ ...move, id: randomUUID() }));
    const CHUNK = 200;
    for (let offset = 0; offset < rows.length; offset += CHUNK) {
      const chunk = rows.slice(offset, offset + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params = chunk.flatMap((move) => [
        move.id, move.productId, move.warehouseId, move.locationId || null, move.quantity,
        move.moveType, move.referenceType, move.referenceId, move.documentLineId,
        move.serialId ?? null, move.lotId ?? null, move.createdBy, now,
      ]);
      await run(
        `INSERT INTO stock_moves (id, productId, warehouseId, locationId, quantity, moveType, referenceType, referenceId, documentLineId, serialId, lotId, createdBy, createdAt)
         VALUES ${placeholders}`,
        params
      );
    }

    // Cộng dồn theo cùng product/kho/vị trí rồi upsert một lần cho mỗi khóa.
    const balances = new Map<string, { productId: string; warehouseId: string; locationId: string; quantity: number }>();
    for (const move of moves) {
      const locationId = move.locationId || '';
      const key = JSON.stringify([move.productId, move.warehouseId, locationId]);
      const previous = balances.get(key);
      if (previous) previous.quantity += move.quantity;
      else balances.set(key, { productId: move.productId, warehouseId: move.warehouseId, locationId, quantity: move.quantity });
    }
    const balanceRows = [...balances.values()];
    for (let offset = 0; offset < balanceRows.length; offset += CHUNK) {
      const chunk = balanceRows.slice(offset, offset + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, 0, ?)').join(', ');
      const params = chunk.flatMap((balance) => [
        balance.productId, balance.warehouseId, balance.locationId, balance.quantity, now,
      ]);
      await run(
        `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)`,
        params
      );
    }

    await recordWarehouseActivities(run, rows.map((move) => ({
      actionType: activityByMove[move.moveType] || `STOCK_MOVE_${move.moveType}`,
      entityType: 'STOCK_MOVE', entityId: move.id, documentId: move.referenceId,
      productId: move.productId, serialId: move.serialId ?? null, lotId: move.lotId ?? null,
      warehouseId: move.warehouseId, quantity: move.quantity, userId: move.createdBy,
      metadata: { moveType: move.moveType, referenceType: move.referenceType, documentLineId: move.documentLineId },
      createdAt: now,
    })));
  }

  /** Mapping kế toán/MISA là cấu hình, không suy diễn bằng mã tài khoản cố định. */
  async function resolveAccountingDefaults(productId: string, partnerKey?: string | null, projectId?: string | null) {
    const rows = await db.all(
      `SELECT entityType, entityId, misaCode FROM misa_mappings
       WHERE (entityType = 'PRODUCT_INVENTORY_ACCOUNT' AND entityId = ?)
          OR (entityType = 'PARTNER_PAYABLE_ACCOUNT' AND entityId = ?)
          OR (entityType = 'PROJECT' AND entityId = ?) ORDER BY createdAt DESC`,
      [productId, partnerKey || '', projectId || '']
    ).catch(() => []);
    const find = (type: string, id: string | null | undefined) => (rows || []).find((row: any) => row.entityType === type && row.entityId === id)?.misaCode || null;
    return {
      accountDebit: find('PRODUCT_INVENTORY_ACCOUNT', productId),
      accountCredit: partnerKey ? find('PARTNER_PAYABLE_ACCOUNT', partnerKey) : null,
      projectMisaCode: projectId ? find('PROJECT', projectId) : null,
    };
  }

  function docCode(prefix: string): string {
    const d = new Date();
    const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${stamp}-${rand}`;
  }

  /** Mã phiếu đơn giản PREFIX-YY-NNNN (VD: PNK-26-0001): số thứ tự theo
   * từng loại phiếu + năm, lấy MAX hiện có rồi +1. Va chạm concurrent
   * (2 phiếu cùng số) được đỡ bởi UNIQUE + vòng retry ở createDocument.
   * Chỉ lấy 1 dòng lớn nhất theo số thứ tự (không theo chuỗi) để tránh quét
   * tối đa 5000 mã mỗi lần sinh số; REGEXP loại mã legacy khác định dạng. */
  async function nextDocCode(prefix: string): Promise<string> {
    const yy = String(new Date().getFullYear()).slice(2);
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const numberStart = `${prefix}-${yy}-`.length + 1;
    const rows = await db.all(
      `SELECT code FROM stock_documents
        WHERE code LIKE ? AND code REGEXP ?
        ORDER BY CAST(SUBSTRING(code, ${numberStart}) AS UNSIGNED) DESC
        LIMIT 1`,
      [`${prefix}-${yy}-%`, `^${escapedPrefix}-${yy}-[0-9]+$`]
    ).catch(() => []);
    const re = new RegExp(`^${escapedPrefix}-${yy}-(\\d+)$`);
    let max = 0;
    for (const r of rows || []) {
      const m = String(r?.code || '').match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n)) max = Math.max(max, n);
      }
    }
    return `${prefix}-${yy}-${String(max + 1).padStart(4, '0')}`;
  }

  /** Phân trang cho các endpoint list: mặc định 500 (giữ tương thích FE cũ), tối đa 1000. */
  function paginationOf(query: Record<string, string | undefined>): { limit: number; offset: number } {
    const rawLimit = Number(query.limit);
    const rawOffset = Number(query.offset);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 1000) : 500;
    const offset = Number.isFinite(rawOffset) ? Math.min(Math.max(Math.floor(rawOffset), 0), 1_000_000) : 0;
    return { limit, offset };
  }
  /** Chuẩn hóa guard đầu endpoint đọc: 401 khi chưa login, 403 khi Admin. */
  async function listScope(user: any): Promise<string[]> {
    if (!user) throw Object.assign(new Error('Unauthorized'), { status: 401 });
    if (normalizeManagementLevel(user?.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
      throw Object.assign(new Error('Admin cannot view business stock data'), { status: 403 });
    }
    return scopeOf(user);
  }
  function requireWarehouseManager(user: any) {
    const level = normalizeManagementLevel(user?.managementLevel);
    return level >= MANAGEMENT_LEVELS.MANAGER && level !== MANAGEMENT_LEVELS.ADMIN;
  }
  return {
    db, scopeOf, listScope, isDirector, requireWarehouse, requireWarehouseManager, docWarehouseIds, canReadDocument, canWriteDocument, assertLocation, isSaleableLocation, availableOf, saleableLocationSet, saleableAvailableOf, assertNotCounting, postMove, postMoves, recordWarehouseActivity, resolveAccountingDefaults, docCode, nextDocCode, paginationOf,
  };
}

export type StockContext = ReturnType<typeof createStockContext>;
