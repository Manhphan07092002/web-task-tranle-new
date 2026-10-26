import { beginStockTransaction } from '../utils/stockTransaction.js';
import { adjustReserved } from '../utils/stockReserved.js';
import { randomUUID } from 'crypto';

const RESERVATION_EXPIRY_LOCK = 'reservation_expiry_lock';

// Tự động giải phóng giữ hàng hết hạn (21: release khi hủy/hết hạn).
// Chạy định kỳ, idempotent: chỉ chạm các dòng HELD đã quá expiresAt.
export async function releaseExpiredReservations(db: any, now = new Date()): Promise<number> {
  const release = () => releaseExpiredWithLock(db, now);
  return db.runWithRequestContext ? db.runWithRequestContext(release) : release();
}

async function releaseExpiredWithLock(db: any, now: Date): Promise<number> {
  // The scheduler can run in more than one app process. Keep a MySQL advisory
  // lock for the whole scan so only one process can expire a reservation.
  const lock = await db.get('SELECT GET_LOCK(?, 10) AS acquired', [RESERVATION_EXPIRY_LOCK]);
  if (Number(lock?.acquired) !== 1) return 0;

  try {
    return await releaseExpiredInContext(db, now);
  } finally {
    await db.get('SELECT RELEASE_LOCK(?) AS released', [RESERVATION_EXPIRY_LOCK]);
  }
}

async function releaseExpiredInContext(db: any, now: Date): Promise<number> {
  const candidates = await db.all(
    `SELECT id FROM reservations
     WHERE status = 'HELD' AND expiresAt IS NOT NULL AND expiresAt <= ?`,
    [now.toISOString()]
  );
  let released = 0;
  for (const candidate of candidates) {
    await beginStockTransaction(db);
    try {
      // Re-read the row under lock. The initial scan is only a candidate list:
      // between that read and this transaction the reservation may have been
      // consumed, released, or extended. Never release using the stale snapshot.
      const current = await db.get(
        `SELECT id, productId, warehouseId, locationId, quantity, consumedQuantity, status, expiresAt
         FROM reservations WHERE id = ? FOR UPDATE`,
        [candidate.id]
      );
      const expiresAt = current?.expiresAt ? new Date(current.expiresAt).getTime() : NaN;
      if (!current || current.status !== 'HELD' || !Number.isFinite(expiresAt) || expiresAt > now.getTime()) {
        await db.run('ROLLBACK');
        continue;
      }
      const remaining = Math.max(0, Number(current.quantity ?? 0) - Number(current.consumedQuantity ?? 0));
      if (remaining <= 0) {
        await db.run('UPDATE reservations SET status = ? WHERE id = ?', ['RELEASED', current.id]);
        await db.run('DELETE FROM stock_document_line_reservations WHERE reservationId = ?', [current.id]).catch(() => undefined);
        await db.run('COMMIT');
        released++;
        continue;
      }
      await adjustReserved(db.run.bind(db), {
        kind: 'DECREMENT', productId: current.productId, warehouseId: current.warehouseId,
        locationId: current.locationId, delta: remaining, now: now.toISOString(),
      });
      await db.run('UPDATE reservations SET status = ? WHERE id = ?', ['RELEASED', current.id]);
      await db.run('DELETE FROM stock_document_line_reservations WHERE reservationId = ?', [current.id]).catch(() => undefined);
      await db.run(
        `INSERT INTO warehouse_activity_logs
         (id, actionType, entityType, entityId, productId, warehouseId, quantity, metadata, createdAt)
         VALUES (?, 'RESERVATION_EXPIRED', 'RESERVATION', ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), current.id, current.productId, current.warehouseId, remaining,
          JSON.stringify({ locationId: current.locationId || '', source: 'scheduler', expiresAt: now.toISOString() }), now.toISOString()]
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
