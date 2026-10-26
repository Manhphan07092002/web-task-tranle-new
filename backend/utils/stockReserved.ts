/** Nơi duy nhất được chạm stock_balances.reserved.
 *
 * Chuỗi SQL giữ nguyên văn như trước khi gom về helper vì test assert trực
 * tiếp trên SQL text (stock.test.ts, stockReservationsIssuePhase6.test.ts,
 * warehouseRegression.test.ts) và thứ tự tham số là API contract.
 *
 * `reserved` không phải sự kiện ledger (spec 09_KHO_VAN §21: giữ hàng không
 * tạo stock_move) nên không đi qua postMove trong routes/stock/context.ts.
 */
export const RESERVED_SQL = {
  DECREMENT:
    'UPDATE stock_balances SET reserved = reserved - ?, updatedAt = ? WHERE productId = ? AND warehouseId = ? AND locationId = ?',
  DECREMENT_CLAMPED:
    'UPDATE stock_balances SET reserved = GREATEST(0, reserved - ?), updatedAt = ? WHERE productId = ? AND warehouseId = ? AND locationId = ?',
  HOLD_UPSERT: `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
           VALUES (?, ?, ?, 0, ?, ?)
           ON DUPLICATE KEY UPDATE reserved = reserved + VALUES(reserved), updatedAt = VALUES(updatedAt)`,
} as const;

export type ReservedKind = keyof typeof RESERVED_SQL;

type AdjustReservedArgs = {
  kind: ReservedKind;
  productId: string;
  warehouseId: string;
  locationId?: string | null;
  delta: number;
  now?: string;
};

/** Mọi call-site đều đã tự chắn delta <= 0 trước khi gọi, nên no-op ở đây
 * chỉ là phòng thủ và không đổi hành vi hiện có. */
export async function adjustReserved(
  run: (sql: string, params?: any[]) => Promise<unknown>,
  args: AdjustReservedArgs
): Promise<void> {
  const delta = Number(args.delta);
  if (!Number.isFinite(delta) || delta <= 0) return;
  const locationId = args.locationId || '';
  const now = args.now || new Date().toISOString();
  if (args.kind === 'HOLD_UPSERT') {
    await run(RESERVED_SQL.HOLD_UPSERT, [args.productId, args.warehouseId, locationId, delta, now]);
    return;
  }
  const sql = args.kind === 'DECREMENT_CLAMPED' ? RESERVED_SQL.DECREMENT_CLAMPED : RESERVED_SQL.DECREMENT;
  await run(sql, [delta, now, args.productId, args.warehouseId, locationId]);
}
