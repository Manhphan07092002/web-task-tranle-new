import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import type { StockContext } from './context.js';

export function locationsRoutes(ctx: StockContext) {
  const { db, listScope, isDirector, requireWarehouse, requireWarehouseManager } = ctx;
  const router = Router();
  // ── Kho & vị trí (§24: cây RECEIVING/SALEABLE/PICKING/..., TP quản lý) ─────────

  router.get('/locations', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { warehouseId } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT l.*, w.name AS warehouseName FROM stock_locations l LEFT JOIN warehouses w ON w.id = l.warehouseId WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND l.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND l.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      query += ' ORDER BY w.name ASC, l.code ASC';
      res.json((await db.all(query, params)).map((r: any) => ({ ...r, isActive: Boolean(r.isActive) })));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch locations' }); }
  });

  const LocationSchema = z.object({
    warehouseId: z.string().trim().min(1).max(191),
    code: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(255),
    type: z.enum(['INTERNAL', 'SUPPLIER', 'CUSTOMER', 'TRANSIT', 'LOSS', 'ADJUSTMENT']).optional(),
    purpose: z.enum(['SALEABLE', 'WARRANTY', 'DAMAGED', 'DEMO', 'QUARANTINE', 'PICKING', 'RECEIVING', 'OTHER']).optional(),
    parentId: z.string().trim().max(191).nullable().optional(),
    isActive: z.boolean().optional(),
  });


  router.post('/locations', validate(LocationSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage locations' });
      const { warehouseId, code, name, type, purpose, parentId } = req.body;
      const access = await requireWarehouse(user, warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const id = `loc-${randomUUID().slice(0, 8)}`;
      try {
        await db.run(
          'INSERT INTO stock_locations (id, warehouseId, parentId, code, name, type, purpose) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, warehouseId, parentId || null, code.trim().toUpperCase(), name.trim(), type || 'INTERNAL', purpose || 'SALEABLE']
        );
      } catch (e: any) {
        if (e.message?.includes('Duplicate')) return res.status(409).json({ error: 'Location code already exists in this warehouse' });
        throw e;
      }
      res.status(201).json({ id });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to create location' }); }
  });

  router.put('/locations/:id', validate(LocationSchema.partial()), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage locations' });
      const existing = await db.get('SELECT * FROM stock_locations WHERE id = ?', [String(req.params.id)]);
      if (!existing) return res.status(404).json({ error: 'Location not found' });
      const access = await requireWarehouse(user, existing.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const { name, type, purpose, parentId, isActive, code } = req.body;
      try {
        await db.run(
          'UPDATE stock_locations SET name = ?, type = ?, purpose = ?, parentId = ?, isActive = ?, code = ? WHERE id = ?',
          [name?.trim() || existing.name, type || existing.type, purpose || existing.purpose,
            parentId !== undefined ? (parentId || null) : existing.parentId,
            isActive === undefined ? existing.isActive : (isActive ? 1 : 0),
            code?.trim() ? code.trim().toUpperCase() : existing.code, existing.id]
        );
      } catch (e: any) {
        if (e.message?.includes('Duplicate')) return res.status(409).json({ error: 'Location code already exists in this warehouse' });
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to update location' }); }
  });
  return router;
}
