import { beginStockTransaction } from '../utils/stockTransaction.js';
import { randomUUID } from 'crypto';

// Tự động giải phóng giữ hàng hết hạn (§21: release khi hủy/hết hạn).
// Chạy định kỳ, idempotent: chỉ chạm các dòng HELD đã quá expiresAt.
export async function releaseExpiredReservations(db: any, now = new Date()): Promise<number> {
  const release = () => releaseExpiredInContext(db, now);
  return db.runWithRequestContext ? db.runWithRequestContext(release) : release();
}

async function releaseExpiredInContext(db: any, now: Date): Promise<number> {
  const expired = await db.all(
    `SELECT id, productId, warehouseId, locationId, quantity, consumedQuantity FROM reservations
     WHERE status = 'HELD' AND expiresAt IS NOT NULL AND expiresAt <= ?`,
    [now.toISOString()]
  );
  let released = 0;
  for (const r of expired) {
    await beginStockTransaction(db);
    try {
      const current = await db.get('SELECT status FROM reservations WHERE id = ? FOR UPDATE', [r.id]);
      if (!current || current.status !== 'HELD') {
        await db.run('ROLLBACK');
        continue;
      }
      const remaining = Math.max(0, Number(r.quantity ?? 0) - Number(r.consumedQuantity ?? 0));
      if (remaining <= 0) {
        await db.run('UPDATE reservations SET status = ? WHERE id = ?', ['RELEASED', r.id]);
        await db.run('DELETE FROM stock_document_line_reservations WHERE reservationId = ?', [r.id]).catch(() => undefined);
        await db.run('COMMIT');
        released++;
        continue;
      }
      await db.run(
        'UPDATE stock_balances SET reserved = reserved - ?, updatedAt = ? WHERE productId = ? AND warehouseId = ? AND locationId = ?',
        [remaining, now.toISOString(), r.productId, r.warehouseId, r.locationId || '']
      );
      await db.run('UPDATE reservations SET status = ? WHERE id = ?', ['RELEASED', r.id]);
      await db.run('DELETE FROM stock_document_line_reservations WHERE reservationId = ?', [r.id]).catch(() => undefined);
      await db.run(
        `INSERT INTO warehouse_activity_logs
         (id, actionType, entityType, entityId, productId, warehouseId, quantity, metadata, createdAt)
         VALUES (?, 'RESERVATION_EXPIRED', 'RESERVATION', ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), r.id, r.productId, r.warehouseId, remaining,
          JSON.stringify({ locationId: r.locationId || '', source: 'scheduler', expiresAt: now.toISOString() }), now.toISOString()]
      );
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
