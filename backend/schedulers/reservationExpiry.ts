// Tự động giải phóng giữ hàng hết hạn (§21: release khi hủy/hết hạn).
// Chạy định kỳ, idempotent: chỉ chạm các dòng HELD đã quá expiresAt.
export async function releaseExpiredReservations(db: any, now = new Date()): Promise<number> {
  const expired = await db.all(
    `SELECT id, productId, warehouseId, locationId, quantity FROM reservations
     WHERE status = 'HELD' AND expiresAt IS NOT NULL AND expiresAt <= ?`,
    [now.toISOString()]
  );
  let released = 0;
  for (const r of expired) {
    await db.run('START TRANSACTION');
    try {
      const current = await db.get('SELECT status FROM reservations WHERE id = ?', [r.id]);
      if (!current || current.status !== 'HELD') {
        await db.run('ROLLBACK');
        continue;
      }
      await db.run(
        'UPDATE stock_balances SET reserved = reserved - ?, updatedAt = ? WHERE productId = ? AND warehouseId = ? AND locationId = ?',
        [Number(r.quantity), now.toISOString(), r.productId, r.warehouseId, r.locationId || '']
      );
      await db.run('UPDATE reservations SET status = ? WHERE id = ?', ['RELEASED', r.id]);
      await db.run('COMMIT');
      released++;
    } catch {
      try { await db.run('ROLLBACK'); } catch { /* ignore */ }
    }
  }
  return released;
}

export function scheduleReservationExpiry(db: any) {
  const tick = async () => {
    try {
      const n = await releaseExpiredReservations(db);
      if (n > 0) console.info(`[Scheduler] Released ${n} expired reservations.`);
    } catch (err) {
      console.error('[Scheduler] Reservation expiry error:', err);
    }
  };
  setInterval(tick, 5 * 60_000);
  tick();
}
