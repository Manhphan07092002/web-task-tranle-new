import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import type { StockContext } from './context.js';

export function monitoringRoutes(ctx: StockContext) {
  const { db, listScope, isDirector, requireWarehouse, paginationOf } = ctx;
  const router = Router();
  // ── Lịch sử hàng hóa: timeline moves (§30.5, đọc) ─────────────────────────────

  router.get('/moves', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { warehouseId, productId, moveType } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT m.*, p.name AS productName, w.name AS warehouseName, u.name AS createdByName
        FROM stock_moves m
        LEFT JOIN products p ON p.id = m.productId
        LEFT JOIN warehouses w ON w.id = m.warehouseId
        LEFT JOIN users u ON u.id = m.createdBy
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND m.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND m.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      if (productId?.trim()) { query += ' AND m.productId = ?'; params.push(productId.trim()); }
      if (moveType?.trim()) { query += ' AND m.moveType = ?'; params.push(moveType.trim()); }
      query += ' ORDER BY m.createdAt DESC';
      const movePage = paginationOf(req.query as Record<string, string | undefined>);
      query += ' LIMIT ? OFFSET ?';
      params.push(movePage.limit, movePage.offset);
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock moves' }); }
  });

  router.get('/policies', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { warehouseId } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT pol.*, p.name AS productName, w.name AS warehouseName
        FROM product_warehouse_policies pol
        LEFT JOIN products p ON p.id = pol.productId
        LEFT JOIN warehouses w ON w.id = pol.warehouseId
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND pol.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND pol.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      query += ' ORDER BY w.name ASC, p.name ASC';
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock policies' }); }
  });


  // ── Cảnh báo tồn theo chính sách Min/Max (§26, TP+) ──────────────────────────
  router.get('/alerts', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { warehouseId } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT b.productId, b.warehouseId,
          SUM(b.onHand) AS onHand, SUM(b.reserved) AS reserved,
          SUM(CASE WHEN b.locationId = '' OR (l.isActive = 1 AND l.purpose = 'SALEABLE') THEN b.onHand - b.reserved ELSE 0 END) AS available,
          p.name AS productName, w.code AS warehouseCode, w.name AS warehouseName,
          pol.minStock, pol.maxStock, pol.reorderPoint
        FROM stock_balances b
        LEFT JOIN products p ON p.id = b.productId
        LEFT JOIN warehouses w ON w.id = b.warehouseId
        LEFT JOIN product_warehouse_policies pol ON pol.productId = b.productId AND pol.warehouseId = b.warehouseId
        LEFT JOIN stock_locations l ON l.id = b.locationId AND l.warehouseId = b.warehouseId
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND b.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND b.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      query += ` GROUP BY b.productId, b.warehouseId, p.name, w.code, w.name, pol.minStock, pol.maxStock, pol.reorderPoint
        HAVING available <= 0
          OR (pol.reorderPoint IS NOT NULL AND pol.reorderPoint > 0 AND available < pol.reorderPoint)
          OR (pol.minStock IS NOT NULL AND pol.minStock > 0 AND available < pol.minStock)
          OR (pol.maxStock IS NOT NULL AND pol.maxStock > 0 AND onHand > pol.maxStock)
        ORDER BY available ASC LIMIT 500`;
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock alerts' }); }
  });

  const PolicySchema = z.object({
    productId: z.string().trim().min(1).max(191),
    warehouseId: z.string().trim().min(1).max(191),
    minStock: z.number().finite().min(0).max(1_000_000_000),
    maxStock: z.number().finite().min(0).max(1_000_000_000),
    reorderPoint: z.number().finite().min(0).max(1_000_000_000),
    leadTimeDays: z.number().int().min(0).max(3650),
  });

  router.put('/policies', validate(PolicySchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      // NV không được sửa Min/Max (§10.3); Admin không đụng business (D12).
      if (normalizeManagementLevel(user.managementLevel) < MANAGEMENT_LEVELS.MANAGER
        || normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Only warehouse managers can set stock policies' });
      }
      const { productId, warehouseId, minStock, maxStock, reorderPoint, leadTimeDays } = req.body;
      const access = await requireWarehouse(user, warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const product = await db.get('SELECT id FROM products WHERE id = ?', [productId]);
      if (!product) return res.status(400).json({ error: `Unknown product: ${productId}` });
      if (maxStock > 0 && minStock > maxStock) {
        return res.status(400).json({ error: 'Min stock cannot exceed max stock' });
      }
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO product_warehouse_policies (productId, warehouseId, minStock, maxStock, reorderPoint, leadTimeDays, updatedBy, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE minStock = VALUES(minStock), maxStock = VALUES(maxStock),
           reorderPoint = VALUES(reorderPoint), leadTimeDays = VALUES(leadTimeDays),
           updatedBy = VALUES(updatedBy), updatedAt = VALUES(updatedAt)`,
        [productId, warehouseId, minStock, maxStock, reorderPoint, leadTimeDays, user.id, now]
      );
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to save stock policy' }); }
  });

  // ── Tồn lâu: có tồn nhưng quá hạn không di chuyển (§26) ──────────────────────

  router.get('/slow', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { warehouseId, days } = req.query as Record<string, string | undefined>;
      const thresholdDays = Math.min(Math.max(Number(days) || 90, 1), 3650);
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000).toISOString();
      let query = `SELECT b.productId, b.warehouseId,
          SUM(b.onHand) AS onHand, SUM(b.onHand - b.reserved) AS available,
          p.name AS productName, w.code AS warehouseCode, w.name AS warehouseName,
          MAX(m.createdAt) AS lastMoveAt
        FROM stock_balances b
        LEFT JOIN products p ON p.id = b.productId
        LEFT JOIN warehouses w ON w.id = b.warehouseId
        LEFT JOIN stock_moves m ON m.productId = b.productId AND m.warehouseId = b.warehouseId AND m.createdAt >= ?
        WHERE 1=1`;
      const params: any[] = [cutoff];
      if (warehouseId) { query += ' AND b.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND b.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      query += ` GROUP BY b.productId, b.warehouseId, p.name, w.code, w.name
        HAVING onHand > 0 AND (lastMoveAt IS NULL OR lastMoveAt < ?)
        ORDER BY lastMoveAt ASC LIMIT 500`;
      params.push(cutoff);
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch slow-moving stock' }); }
  });
  return router;
}
