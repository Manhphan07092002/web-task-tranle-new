import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import type { StockContext } from './context.js';

export function countsRoutes(ctx: StockContext) {
  const { db, listScope, isDirector, requireWarehouse, requireWarehouseManager, assertLocation, assertNotCounting, paginationOf } = ctx;
  const router = Router();
  // ── Kiểm kê blind-count (§19–20) ────────────────────────────────────────────

  router.get('/counts', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { warehouseId, status } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT c.*, w.name AS warehouseName FROM stock_counts c
        LEFT JOIN warehouses w ON w.id = c.warehouseId WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND c.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND c.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      if (status?.trim()) { query += ' AND c.status = ?'; params.push(status.trim()); }
      query += ' ORDER BY c.createdAt DESC';
      const countPage = paginationOf(req.query as Record<string, string | undefined>);
      query += ' LIMIT ? OFFSET ?';
      params.push(countPage.limit, countPage.offset);
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock counts' }); }
  });

  router.get('/counts/:id', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot view business stock data' });
      }
      const count = await db.get('SELECT * FROM stock_counts WHERE id = ?', [String(req.params.id)]);
      if (!count) return res.status(404).json({ error: 'Count not found' });
      const access = await requireWarehouse(user, count.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const lines = await db.all(
        `SELECT l.*, p.name AS productName FROM stock_count_lines l
         LEFT JOIN products p ON p.id = l.productId WHERE l.countId = ? ORDER BY p.name ASC`,
        [count.id]
      );
      // Blind count: NV không thấy số hệ thống (§19.1).
      const blind = Number(count.blindCount) === 1 && !requireWarehouseManager(user);
      res.json({
        ...count,
        blindCount: Boolean(Number(count.blindCount)),
        lines: lines.map((l: any) => blind ? { ...l, expectedQty: null } : l),
      });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock count' }); }
  });

  router.post('/counts', validate(z.object({
    warehouseId: z.string().trim().min(1).max(191),
    blindCount: z.boolean().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })), async (req, res) => {
    let transactionOpen = false;
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can open counts' });
      const { warehouseId, blindCount, notes } = req.body;
      await beginStockTransaction(db, [warehouseId]);
      transactionOpen = true;
      const access = await requireWarehouse(user, warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      await assertNotCounting(warehouseId);
      const snapshot = await db.all(
        'SELECT productId, locationId, onHand FROM stock_balances WHERE warehouseId = ?',
        [warehouseId]
      );
      const now = new Date().toISOString();
      const id = randomUUID();
      const d = new Date();
      const code = `KK-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      try {
        await db.run(
          'INSERT INTO stock_counts (id, code, warehouseId, status, blindCount, notes, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, code, warehouseId, 'COUNTING', blindCount === false ? 0 : 1, notes ?? null, user.id, now, now]
        );
        for (const row of snapshot) {
          await db.run(
            'INSERT INTO stock_count_lines (id, countId, productId, locationId, expectedQty) VALUES (?, ?, ?, ?, ?)',
            [randomUUID(), id, row.productId, row.locationId || '', Number(row.onHand) || 0]
          );
        }
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.status(201).json({ id, code, lines: snapshot.length });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to open stock count' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/counts/:id/lines', validate(z.object({
    lines: z.array(z.object({
      productId: z.string().trim().min(1).max(191),
      locationId: z.string().trim().max(191).nullable().optional(),
      actualQty: z.number().finite().min(0).max(1_000_000_000),
      note: z.string().max(2000).nullable().optional(),
    })).min(1).max(1000),
  })), async (req, res) => {
    let transactionOpen = false;
    try {
      const pre = await db.get('SELECT warehouseId, status FROM stock_counts WHERE id = ?', [String(req.params.id)]);
      if (!pre) return res.status(404).json({ error: 'Count not found' });
      await beginStockTransaction(db, [pre.warehouseId]);
      transactionOpen = true;
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const count = await db.get('SELECT warehouseId, status FROM stock_counts WHERE id = ? FOR UPDATE', [String(req.params.id)]);
      if (!count) return res.status(404).json({ error: 'Count not found' });
      if (count.status !== 'COUNTING') return res.status(400).json({ error: 'Count is no longer open for entry' });
      const access = await requireWarehouse(user, count.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      try {
        for (const line of req.body.lines) {
          if (!(await db.get('SELECT id FROM products WHERE id = ?', [line.productId])) || !(await assertLocation(count.warehouseId, line.locationId))) {
            return res.status(400).json({ error: 'Invalid product or location for count' });
          }
          // Cặp (product, location) chưa có trong snapshot: lấy tồn hiện tại
          // làm expectedQty thay vì 0 — nếu không approve luôn 409.
          const existing = await db.get(
            'SELECT id FROM stock_count_lines WHERE countId = ? AND productId = ? AND locationId = ?',
            [String(req.params.id), line.productId, line.locationId || '']
          );
          let expectedQty = 0;
          if (!existing) {
            const bal = await db.get(
              'SELECT onHand FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ?',
              [line.productId, count.warehouseId, line.locationId || '']
            );
            expectedQty = Number(bal?.onHand ?? 0);
          }
          await db.run(
            `INSERT INTO stock_count_lines (id, countId, productId, locationId, expectedQty, actualQty, note, countedBy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE actualQty = VALUES(actualQty), note = VALUES(note), countedBy = VALUES(countedBy)`,
            [randomUUID(), count.id ?? String(req.params.id), line.productId, line.locationId || '', expectedQty, Number(line.actualQty), line.note ?? null, user.id]
          );
        }
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to submit count lines' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/counts/:id/recount', validate(z.object({
    lineIds: z.array(z.string().trim().min(1).max(191)).min(1).max(1000),
  })), async (req, res) => {
    let transactionOpen = false;
    try {
      const pre = await db.get('SELECT warehouseId, status FROM stock_counts WHERE id = ?', [String(req.params.id)]);
      if (!pre) return res.status(404).json({ error: 'Count not found' });
      await beginStockTransaction(db, [pre.warehouseId]);
      transactionOpen = true;
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can request recounts' });
      const count = await db.get('SELECT warehouseId, status FROM stock_counts WHERE id = ? FOR UPDATE', [String(req.params.id)]);
      if (!count) return res.status(404).json({ error: 'Count not found' });
      if (count.status !== 'COUNTING') return res.status(400).json({ error: 'Count is no longer open' });
      const access = await requireWarehouse(user, count.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const placeholders = req.body.lineIds.map(() => '?').join(', ');
      await db.run(
        `UPDATE stock_count_lines SET actualQty = NULL, note = NULL WHERE countId = ? AND id IN (${placeholders})`,
        [String(req.params.id), ...req.body.lineIds]
      );
      await db.run('COMMIT'); transactionOpen = false;
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to request recount' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/counts/:id/approve', async (req, res) => {
    let transactionOpen = false;
    try {
      const pre = await db.get('SELECT warehouseId, status FROM stock_counts WHERE id = ?', [String(req.params.id)]);
      if (!pre) return res.status(404).json({ error: 'Count not found' });
      await beginStockTransaction(db, [pre.warehouseId]);
      transactionOpen = true;
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can approve counts' });
      const count = await db.get('SELECT * FROM stock_counts WHERE id = ? FOR UPDATE', [String(req.params.id)]);
      if (!count) return res.status(404).json({ error: 'Count not found' });
      if (count.status !== 'COUNTING') return res.status(400).json({ error: 'Count is already closed' });
      const access = await requireWarehouse(user, count.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const lines = await db.all('SELECT * FROM stock_count_lines WHERE countId = ?', [count.id]);
      const missing = lines.filter((l: any) => l.actualQty === null || l.actualQty === undefined).length;
      if (missing > 0) {
        return res.status(400).json({ error: `${missing} lines still await counting` });
      }
      const now = new Date().toISOString();
      try {
        for (const line of lines) {
          const balance = await db.get('SELECT onHand, reserved FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ? FOR UPDATE', [line.productId, count.warehouseId, line.locationId || '']);
          if (Number(balance?.onHand ?? 0) !== Number(line.expectedQty)) throw Object.assign(new Error('Tồn đã thay đổi sau khi mở kiểm kê; cần kiểm kê lại.'), { status: 409 });
          if (Number(line.actualQty) < Number(balance?.reserved ?? 0)) throw Object.assign(new Error('Giải phóng giữ hàng vượt số đếm trước khi duyệt.'), { status: 409 });
          const variance = Number(line.actualQty) - Number(line.expectedQty);
          if (variance === 0) continue;
          await db.run(
            `INSERT INTO stock_moves (id, productId, warehouseId, locationId, quantity, moveType, referenceType, referenceId, documentLineId, createdBy, createdAt)
             VALUES (?, ?, ?, ?, ?, 'ADJUSTMENT', 'COUNT', ?, ?, ?, ?)`,
            [randomUUID(), line.productId, count.warehouseId, line.locationId || '', variance, count.id, line.id, user.id, now]
          );
          await db.run(
            `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
             VALUES (?, ?, ?, ?, 0, ?)
             ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)`,
            [line.productId, count.warehouseId, line.locationId || '', variance, now]
          );
        }
        await db.run('UPDATE stock_counts SET status = ?, approvedBy = ?, updatedAt = ? WHERE id = ?', ['DONE', user.id, now, count.id]);
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to approve count' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/counts/:id/cancel', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!requireWarehouseManager(req.user)) return res.status(403).json({ error: 'Warehouse manager access required' });
    let transactionOpen = false;
    try {
      const pre = await db.get('SELECT warehouseId FROM stock_counts WHERE id = ?', [String(req.params.id)]);
      if (!pre) return res.status(404).json({ error: 'Count not found' });
      await beginStockTransaction(db, [pre.warehouseId]); transactionOpen = true;
      const count = await db.get('SELECT * FROM stock_counts WHERE id = ? FOR UPDATE', [String(req.params.id)]);
      if (!count) return res.status(404).json({ error: 'Count not found' });
      if (!(await requireWarehouse(req.user, count.warehouseId)).ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (count.status !== 'COUNTING') return res.status(400).json({ error: 'Only open counts can be cancelled' });
      await db.run('UPDATE stock_counts SET status = ?, updatedAt = ? WHERE id = ?', ['CANCELLED', new Date().toISOString(), count.id]);
      await db.run('COMMIT'); transactionOpen = false;
      res.json({ success: true });
    } catch { res.status(500).json({ error: 'Failed to cancel count' }); }
    finally { if (transactionOpen) await db.run('ROLLBACK'); }
  });
  return router;
}
