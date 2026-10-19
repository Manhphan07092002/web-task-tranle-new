import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import type { StockContext } from './context.js';

export function reservationsRoutes(ctx: StockContext) {
  const { db, listScope, isDirector, requireWarehouse, requireWarehouseManager, assertLocation, isSaleableLocation, availableOf, assertNotCounting, paginationOf, recordWarehouseActivity } = ctx;
  const router = Router();
  // ── Giữ hàng / phân bổ (§21: hold/release/consume, TP+NV trong scope) ─────────

  router.get('/reservations', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { warehouseId, status } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT r.*, p.name AS productName, w.name AS warehouseName
        FROM reservations r
        LEFT JOIN products p ON p.id = r.productId
        LEFT JOIN warehouses w ON w.id = r.warehouseId
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND r.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND r.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      if (status?.trim()) { query += ' AND r.status = ?'; params.push(status.trim()); }
      query += ' ORDER BY r.createdAt DESC';
      const resvPage = paginationOf(req.query as Record<string, string | undefined>);
      query += ' LIMIT ? OFFSET ?';
      params.push(resvPage.limit, resvPage.offset);
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch reservations' }); }
  });

  const ReservationSchema = z.object({
    productId: z.string().trim().min(1).max(191),
    warehouseId: z.string().trim().min(1).max(191),
    locationId: z.string().trim().max(191).nullable().optional(),
    quantity: z.number().finite().positive().max(1_000_000_000),
    sourceType: z.enum(['SALES_ORDER', 'PROJECT', 'WARRANTY', 'INTERNAL']).optional(),
    sourceId: z.string().max(191).nullable().optional(),
    // expiresAt lưu VARCHAR(40): ép chuẩn ISO ở đầu vào để scheduler so sánh chuỗi đúng.
    expiresAt: z.string().max(40).nullable().optional().refine(
      (v) => v == null || v === '' || !Number.isNaN(Date.parse(v)),
      { message: 'expiresAt must be a valid datetime' }
    ),
  });

  router.post('/reservations', validate(ReservationSchema), async (req, res) => {
    let transactionOpen = false;
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
      const { productId, warehouseId, locationId, quantity, sourceType, sourceId, expiresAt } = req.body;
      await beginStockTransaction(db, [warehouseId]);
      transactionOpen = true;
      const access = await requireWarehouse(user, warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const product = await db.get('SELECT id FROM products WHERE id = ?', [productId]);
      if (!product) return res.status(400).json({ error: `Unknown product: ${productId}` });
      if (!(await assertLocation(warehouseId, locationId ?? null))) {
        return res.status(400).json({ error: 'Invalid location for this warehouse' });
      }
      if (!(await isSaleableLocation(warehouseId, locationId || ''))) return res.status(400).json({ error: 'Only saleable stock can be reserved' });
      // Chỉ giữ từ available (D10/§21) — không giữ hàng đã giữ.
      const available = await availableOf(productId, warehouseId, locationId || '');
      if (available < Number(quantity)) {
        return res.status(400).json({ error: `Insufficient available stock (available: ${available})` });
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      try {
        await db.run(
          `INSERT INTO reservations (id, productId, warehouseId, locationId, quantity, sourceType, sourceId, requestedBy, status, expiresAt, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'HELD', ?, ?)`,
          [id, productId, warehouseId, locationId || '', quantity, sourceType || 'INTERNAL', sourceId ?? null, user.id, expiresAt ?? null, now]
        );
        await db.run(
          `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
           VALUES (?, ?, ?, 0, ?, ?)
           ON DUPLICATE KEY UPDATE reserved = reserved + VALUES(reserved), updatedAt = VALUES(updatedAt)`,
          [productId, warehouseId, locationId || '', quantity, now]
        );
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'RESERVATION_HELD', entityType: 'RESERVATION', entityId: id,
          productId, warehouseId, quantity: Number(quantity), userId: user.id,
          metadata: { locationId: locationId || '', sourceType: sourceType || 'INTERNAL', sourceId: sourceId ?? null, expiresAt: expiresAt ?? null },
        });
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.status(201).json({ id });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to hold stock' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  async function settleReservation(req: any, res: any, toStatus: 'RELEASED' | 'CONSUMED') {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
    let transactionOpen = false;
    try {
      const pre = await db.get('SELECT warehouseId FROM reservations WHERE id = ?', [String(req.params.id)]);
      if (!pre) return res.status(404).json({ error: 'Reservation not found' });
      await beginStockTransaction(db, [pre.warehouseId]);
      transactionOpen = true;
      // Khóa row giữ hàng trong transaction — chống settle 2 lần concurrent.
      const r = await db.get('SELECT * FROM reservations WHERE id = ? FOR UPDATE', [String(req.params.id)]);
      if (!r) return res.status(404).json({ error: 'Reservation not found' });
      if (r.status !== 'HELD') return res.status(400).json({ error: 'Only held reservations can be settled' });
      const access = await requireWarehouse(user, r.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const now = new Date().toISOString();
      try {
        if (toStatus === 'CONSUMED') {
          await assertNotCounting(r.warehouseId);
          const bal = await db.get(
            'SELECT onHand FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ? FOR UPDATE',
            [r.productId, r.warehouseId, r.locationId || '']
          );
          if (Number(bal?.onHand ?? 0) < Number(r.quantity)) {
            await db.run('ROLLBACK'); transactionOpen = false;
            return res.status(400).json({ error: 'Insufficient on-hand stock to consume' });
          }
          await db.run(
            `INSERT INTO stock_moves (id, productId, warehouseId, locationId, quantity, moveType, referenceType, referenceId, createdBy, createdAt)
             VALUES (?, ?, ?, ?, ?, 'ISSUE', 'RESERVATION', ?, ?, ?)`,
            [randomUUID(), r.productId, r.warehouseId, r.locationId || '', -Number(r.quantity), r.id, user.id, now]
          );
          await db.run(
            'UPDATE stock_balances SET onHand = onHand - ?, reserved = reserved - ?, updatedAt = ? WHERE productId = ? AND warehouseId = ? AND locationId = ?',
            [Number(r.quantity), Number(r.quantity), now, r.productId, r.warehouseId, r.locationId || '']
          );
        } else {
          await db.run(
            'UPDATE stock_balances SET reserved = reserved - ?, updatedAt = ? WHERE productId = ? AND warehouseId = ? AND locationId = ?',
            [Number(r.quantity), now, r.productId, r.warehouseId, r.locationId || '']
          );
        }
        await db.run('UPDATE reservations SET status = ? WHERE id = ?', [toStatus, r.id]);
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: toStatus === 'CONSUMED' ? 'RESERVATION_CONSUMED' : 'RESERVATION_RELEASED',
          entityType: 'RESERVATION', entityId: r.id, productId: r.productId,
          warehouseId: r.warehouseId, quantity: Number(r.quantity), userId: user.id,
          oldData: { status: 'HELD' }, newData: { status: toStatus },
          metadata: { locationId: r.locationId || '', sourceType: r.sourceType, sourceId: r.sourceId || null },
        });
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to settle reservation' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  }

  router.post('/reservations/:id/release', async (req, res) => { await settleReservation(req, res, 'RELEASED'); });
  router.post('/reservations/:id/consume', async (req, res) => { await settleReservation(req, res, 'CONSUMED'); });
  return router;
}
