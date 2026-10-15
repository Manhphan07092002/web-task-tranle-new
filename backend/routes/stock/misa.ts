import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import type { StockContext } from './context.js';

export function misaRoutes(ctx: StockContext) {
  const { db, scopeOf, isDirector, requireWarehouseManager } = ctx;
  const router = Router();
  // ── MISA: mapping + nhật ký (§35 — quản trị chủ động, sync thật để sau) ──────

  router.get('/misa-mappings', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
      const { entityType } = req.query as Record<string, string | undefined>;
      let query = 'SELECT * FROM misa_mappings WHERE 1=1';
      const params: any[] = [];
      if (entityType?.trim()) { query += ' AND entityType = ?'; params.push(entityType.trim()); }
      query += ' ORDER BY entityType ASC, misaCode ASC';
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch MISA mappings' }); }
  });

  const MisaMappingSchema = z.object({
    entityType: z.string().trim().min(1).max(64),
    entityId: z.string().trim().min(1).max(191),
    misaCode: z.string().trim().min(1).max(191),
    misaName: z.string().trim().max(255).nullable().optional(),
  });

  router.post('/misa-mappings', validate(MisaMappingSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage MISA mappings' });
      const { entityType, entityId, misaCode, misaName } = req.body;
      const now = new Date().toISOString();
      try {
        await db.run(
          'INSERT INTO misa_mappings (id, entityType, entityId, misaCode, misaName, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [randomUUID(), entityType, entityId, misaCode.trim(), misaName?.trim() || null, user.id, now]
        );
      } catch (e: any) {
        if (e.message?.includes('Duplicate')) return res.status(409).json({ error: 'Mapping already exists for this entity' });
        throw e;
      }
      res.status(201).json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to create MISA mapping' }); }
  });

  router.delete('/misa-mappings/:id', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage MISA mappings' });
      const id = String(req.params.id || '').trim();
      if (!id || id.length > 191) return res.status(400).json({ error: 'Invalid mapping id' });
      // Mapping là cấu hình toàn cục (không gắn kho) nên mọi TP kho đều được
      // quản lý; chỉ chặn id rác để tránh xóa nhầm.
      const result = await db.run('DELETE FROM misa_mappings WHERE id = ?', [id]);
      if (result && Number(result.changes) === 0) return res.status(404).json({ error: 'Mapping not found' });
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to delete MISA mapping' }); }
  });

  router.get('/misa-logs', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
      const { status, entityType } = req.query as Record<string, string | undefined>;
      let query = 'SELECT * FROM misa_sync_logs WHERE 1=1';
      const params: any[] = [];
      if (status?.trim()) { query += ' AND status = ?'; params.push(status.trim()); }
      if (entityType?.trim()) { query += ' AND entityType = ?'; params.push(entityType.trim()); }
      query += ' ORDER BY createdAt DESC LIMIT 200';
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch MISA sync logs' }); }
  });

  router.get('/misa-reconcile', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
      const { warehouseId } = req.query as Record<string, string | undefined>;
      const scope = await scopeOf(user);
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
      }

      let query = `
        SELECT 
          p.id AS productId,
          p.name AS productName,
          p.unit AS unit,
          p.category AS category,
          p.importPrice AS importPrice,
          p.defaultPrice AS defaultPrice,
          w.id AS warehouseId,
          w.code AS warehouseCode,
          w.name AS warehouseName,
          COALESCE(SUM(b.onHand), 0) AS onHand,
          COALESCE(SUM(b.reserved), 0) AS reserved,
          COALESCE(SUM(CASE WHEN b.locationId = '' OR (l.isActive = 1 AND l.purpose = 'SALEABLE') THEN b.onHand - b.reserved ELSE 0 END), 0) AS available,
          mm.misaCode AS misaCode,
          mm.misaName AS misaName
        FROM products p
        LEFT JOIN misa_mappings mm ON mm.entityType = 'product' AND mm.entityId = p.id
        LEFT JOIN stock_balances b ON b.productId = p.id
        LEFT JOIN warehouses w ON w.id = b.warehouseId
        LEFT JOIN stock_locations l ON l.id = b.locationId
        WHERE (w.isActive = 1 OR w.id IS NULL)
      `;
      const params: any[] = [];
      if (warehouseId?.trim()) {
        query += ' AND (w.id = ? OR (w.id IS NULL AND mm.misaCode IS NOT NULL))';
        params.push(warehouseId.trim());
      } else if (!isDirector(user) && scope.length > 0) {
        query += ` AND (w.id IN (${scope.map(() => '?').join(', ')}) OR (w.id IS NULL AND mm.misaCode IS NOT NULL))`;
        params.push(...scope);
      }
      query += `
        GROUP BY p.id, p.name, p.unit, p.category, p.importPrice, p.defaultPrice, w.id, w.code, w.name, mm.misaCode, mm.misaName
        HAVING onHand != 0 OR reserved != 0 OR mm.misaCode IS NOT NULL
        ORDER BY w.name ASC, p.name ASC
        LIMIT 1000
      `;

      res.json(await db.all(query, params));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch MISA reconciliation data' });
    }
  });

  router.post('/misa-reconcile/log', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
      const { itemsCount, matchedCount, mismatchedCount, unmappedCount, notes, warehouseId } = req.body || {};
      const now = new Date().toISOString();
      const idempotencyKey = `reconcile-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const payload = JSON.stringify({
        warehouseId: warehouseId || 'ALL',
        itemsCount: Number(itemsCount || 0),
        matchedCount: Number(matchedCount || 0),
        mismatchedCount: Number(mismatchedCount || 0),
        unmappedCount: Number(unmappedCount || 0),
        notes: notes || '',
        reconciledBy: user.name || user.id,
      });
      const status = Number(mismatchedCount || 0) > 0 ? 'DISCREPANCY' : 'MATCHED';
      await db.run(
        'INSERT INTO misa_sync_logs (id, direction, entityType, entityId, idempotencyKey, status, payload, error, createdAt, finishedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), 'RECONCILE', 'stock_balance', warehouseId || 'ALL', idempotencyKey, status, payload, null, now, now]
      );
      res.status(201).json({ success: true, idempotencyKey });
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to log MISA reconciliation' });
    }
  });
  return router;
}
