import { Router } from 'express';
import { randomUUID } from 'crypto';
import { canManageWarehouse } from '../middleware/warehouseAuth.js';

// Warehouse master data (A1): stock_products, warehouses, warehouse_locations.
// Reads: any authenticated user. Writes: stock.manage permission, level 20+, or Admin.
function canManageStock(req: any): boolean {
  return canManageWarehouse(req, 'stock.manage');
}

const VALID_TRACKING = ['NONE', 'LOT', 'SERIAL'];
const VALID_LOCATION_TYPES = ['INTERNAL', 'SUPPLIER', 'CUSTOMER', 'TRANSIT', 'LOSS', 'ADJUSTMENT'];
const VALID_LOCATION_PURPOSES = ['SALEABLE', 'WARRANTY', 'DAMAGED', 'DEMO', 'QUARANTINE', 'PICKING', 'RECEIVING', 'OTHER'];

export function warehouseMasterRoutes(db: any) {
  const router = Router();

  // ============================================================
  // Products master
  // ============================================================
  router.get('/products', async (req, res) => {
    try {
      const conditions: string[] = [];
      const params: any[] = [];
      const search = String(req.query.search || '').trim();
      if (search) {
        conditions.push('(p.code LIKE ? OR p.name LIKE ? OR p.brand LIKE ? OR p.model LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }
      for (const key of ['category', 'brand', 'tracking'] as const) {
        const value = String(req.query[key] || '').trim();
        if (value) {
          conditions.push(`p.${key} = ?`);
          params.push(value);
        }
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.all(
        `SELECT p.*, u.name AS createdByName
         FROM stock_products p
         LEFT JOIN users u ON p.createdBy = u.id
         ${where}
         ORDER BY p.code ASC`,
        params
      );
      res.json(rows);
    } catch (error) {
      console.error('Error fetching stock products:', error);
      res.status(500).json({ error: 'Failed to fetch stock products' });
    }
  });

  router.post('/products', async (req, res) => {
    try {
      if (!canManageStock(req)) return res.status(403).json({ error: 'Forbidden' });
      const {
        code, name, brand, model, category, unit = 'pcs', tracking = 'NONE',
        warrantyMonths = 0, minStock = 0, maxStock = 0, reorderPoint = 0,
        requiresCertificates = false, notes,
      } = req.body;
      if (!code || !String(code).trim() || !name || !String(name).trim()) {
        return res.status(400).json({ error: 'code and name are required' });
      }
      if (!VALID_TRACKING.includes(tracking)) {
        return res.status(400).json({ error: `Invalid tracking. Must be one of: ${VALID_TRACKING.join(', ')}` });
      }
      const cleanCode = String(code).trim();
      const existing = await db.get('SELECT id FROM stock_products WHERE code = ?', [cleanCode]);
      if (existing) return res.status(400).json({ error: `Mã hàng '${cleanCode}' đã tồn tại` });
      const id = randomUUID();
      await db.run(
        `INSERT INTO stock_products
         (id, code, name, brand, model, category, unit, tracking, warrantyMonths,
          minStock, maxStock, reorderPoint, requiresCertificates, notes, createdBy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, cleanCode, String(name).trim(), brand || null, model || null, category || null,
         unit || 'pcs', tracking, Number(warrantyMonths) || 0, Number(minStock) || 0,
         Number(maxStock) || 0, Number(reorderPoint) || 0, requiresCertificates ? 1 : 0,
         notes || null, (req as any).user?.id || null]
      );
      res.json({ id, code: cleanCode, success: true });
    } catch (error) {
      console.error('Error creating stock product:', error);
      res.status(500).json({ error: 'Failed to create stock product' });
    }
  });

  router.patch('/products/:id', async (req, res) => {
    try {
      if (!canManageStock(req)) return res.status(403).json({ error: 'Forbidden' });
      const { id } = req.params;
      const row = await db.get('SELECT * FROM stock_products WHERE id = ?', [id]);
      if (!row) return res.status(404).json({ error: 'Product not found' });
      const {
        name, brand, model, category, unit, tracking,
        warrantyMonths, minStock, maxStock, reorderPoint,
        requiresCertificates, notes, isActive,
      } = req.body;
      if (tracking !== undefined && !VALID_TRACKING.includes(tracking)) {
        return res.status(400).json({ error: `Invalid tracking. Must be one of: ${VALID_TRACKING.join(', ')}` });
      }
      await db.run(
        `UPDATE stock_products
         SET name = ?, brand = ?, model = ?, category = ?, unit = ?, tracking = ?,
             warrantyMonths = ?, minStock = ?, maxStock = ?, reorderPoint = ?,
             requiresCertificates = ?, notes = ?, isActive = ?, updatedAt = ?
         WHERE id = ?`,
        [
          name !== undefined ? String(name).trim() : row.name,
          brand !== undefined ? brand : row.brand,
          model !== undefined ? model : row.model,
          category !== undefined ? category : row.category,
          unit !== undefined ? unit : row.unit,
          tracking !== undefined ? tracking : row.tracking,
          warrantyMonths !== undefined ? Number(warrantyMonths) : row.warrantyMonths,
          minStock !== undefined ? Number(minStock) : row.minStock,
          maxStock !== undefined ? Number(maxStock) : row.maxStock,
          reorderPoint !== undefined ? Number(reorderPoint) : row.reorderPoint,
          requiresCertificates !== undefined ? (requiresCertificates ? 1 : 0) : row.requiresCertificates,
          notes !== undefined ? notes : row.notes,
          isActive !== undefined ? (isActive ? 1 : 0) : row.isActive,
          new Date().toISOString(), id,
        ]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating stock product:', error);
      res.status(500).json({ error: 'Failed to update stock product' });
    }
  });

  router.delete('/products/:id', async (req, res) => {
    try {
      if (!canManageStock(req)) return res.status(403).json({ error: 'Forbidden' });
      const { id } = req.params;
      const row = await db.get('SELECT * FROM stock_products WHERE id = ?', [id]);
      if (!row) return res.status(404).json({ error: 'Product not found' });
      await db.run('DELETE FROM stock_products WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting stock product:', error);
      res.status(500).json({ error: 'Failed to delete stock product' });
    }
  });

  // ============================================================
  // Warehouses
  // ============================================================
  router.get('/warehouses', async (_req, res) => {
    try {
      const rows = await db.all(
        `SELECT w.*, u.name AS managerName,
                (SELECT COUNT(*) FROM warehouse_locations l WHERE l.warehouseId = w.id) AS locationCount
         FROM warehouses w
         LEFT JOIN users u ON w.managerId = u.id
         ORDER BY w.code ASC`
      );
      res.json(rows);
    } catch (error) {
      console.error('Error fetching warehouses:', error);
      res.status(500).json({ error: 'Failed to fetch warehouses' });
    }
  });

  router.post('/warehouses', async (req, res) => {
    try {
      if (!canManageStock(req)) return res.status(403).json({ error: 'Forbidden' });
      const { code, name, region, address, managerId } = req.body;
      if (!code || !String(code).trim() || !name || !String(name).trim()) {
        return res.status(400).json({ error: 'code and name are required' });
      }
      const cleanCode = String(code).trim();
      const existing = await db.get('SELECT id FROM warehouses WHERE code = ?', [cleanCode]);
      if (existing) return res.status(400).json({ error: `Mã kho '${cleanCode}' đã tồn tại` });
      if (managerId) {
        const manager = await db.get('SELECT id FROM users WHERE id = ?', [managerId]);
        if (!manager) return res.status(400).json({ error: 'Manager not found' });
      }
      const id = randomUUID();
      await db.run(
        `INSERT INTO warehouses (id, code, name, region, address, managerId, createdBy)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, cleanCode, String(name).trim(), region || null, address || null, managerId || null, (req as any).user?.id || null]
      );
      res.json({ id, code: cleanCode, success: true });
    } catch (error) {
      console.error('Error creating warehouse:', error);
      res.status(500).json({ error: 'Failed to create warehouse' });
    }
  });

  router.patch('/warehouses/:id', async (req, res) => {
    try {
      if (!canManageStock(req)) return res.status(403).json({ error: 'Forbidden' });
      const { id } = req.params;
      const row = await db.get('SELECT * FROM warehouses WHERE id = ?', [id]);
      if (!row) return res.status(404).json({ error: 'Warehouse not found' });
      const { name, region, address, managerId, isActive } = req.body;
      if (managerId !== undefined && managerId !== null) {
        const manager = await db.get('SELECT id FROM users WHERE id = ?', [managerId]);
        if (!manager) return res.status(400).json({ error: 'Manager not found' });
      }
      await db.run(
        `UPDATE warehouses
         SET name = ?, region = ?, address = ?, managerId = ?, isActive = ?, updatedAt = ?
         WHERE id = ?`,
        [
          name !== undefined ? String(name).trim() : row.name,
          region !== undefined ? region : row.region,
          address !== undefined ? address : row.address,
          managerId !== undefined ? managerId : row.managerId,
          isActive !== undefined ? (isActive ? 1 : 0) : row.isActive,
          new Date().toISOString(), id,
        ]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating warehouse:', error);
      res.status(500).json({ error: 'Failed to update warehouse' });
    }
  });

  router.delete('/warehouses/:id', async (req, res) => {
    try {
      if (!canManageStock(req)) return res.status(403).json({ error: 'Forbidden' });
      const { id } = req.params;
      const row = await db.get('SELECT * FROM warehouses WHERE id = ?', [id]);
      if (!row) return res.status(404).json({ error: 'Warehouse not found' });
      const used = await db.get('SELECT COUNT(*) AS c FROM warehouse_locations WHERE warehouseId = ?', [id]);
      if (used && Number(used.c) > 0) {
        return res.status(400).json({ error: `Kho '${row.code}' còn ${used.c} vị trí, hãy xóa vị trí trước` });
      }
      await db.run('DELETE FROM warehouses WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting warehouse:', error);
      res.status(500).json({ error: 'Failed to delete warehouse' });
    }
  });

  // ============================================================
  // Warehouse locations (spec §24: type + purpose, code HX-A-02-03)
  // ============================================================
  router.get('/locations', async (req, res) => {
    try {
      const warehouseId = String(req.query.warehouseId || '');
      const rows = await db.all(
        `SELECT l.*, w.code AS warehouseCode, w.name AS warehouseName,
                p.code AS parentCode,
                (SELECT COUNT(*) FROM warehouse_locations c WHERE c.parentId = l.id) AS childCount
         FROM warehouse_locations l
         JOIN warehouses w ON l.warehouseId = w.id
         LEFT JOIN warehouse_locations p ON l.parentId = p.id
         ${warehouseId ? 'WHERE l.warehouseId = ?' : ''}
         ORDER BY w.code ASC, l.code ASC`,
        warehouseId ? [warehouseId] : []
      );
      res.json(rows);
    } catch (error) {
      console.error('Error fetching warehouse locations:', error);
      res.status(500).json({ error: 'Failed to fetch warehouse locations' });
    }
  });

  router.post('/locations', async (req, res) => {
    try {
      if (!canManageStock(req)) return res.status(403).json({ error: 'Forbidden' });
      const { warehouseId, parentId, code, name, type = 'INTERNAL', purpose = 'SALEABLE' } = req.body;
      if (!warehouseId) return res.status(400).json({ error: 'warehouseId is required' });
      if (!code || !String(code).trim() || !name || !String(name).trim()) {
        return res.status(400).json({ error: 'code and name are required' });
      }
      if (!VALID_LOCATION_TYPES.includes(type)) {
        return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_LOCATION_TYPES.join(', ')}` });
      }
      if (!VALID_LOCATION_PURPOSES.includes(purpose)) {
        return res.status(400).json({ error: `Invalid purpose. Must be one of: ${VALID_LOCATION_PURPOSES.join(', ')}` });
      }
      const warehouse = await db.get('SELECT id FROM warehouses WHERE id = ?', [warehouseId]);
      if (!warehouse) return res.status(400).json({ error: 'Warehouse not found' });
      const cleanCode = String(code).trim();
      const existing = await db.get('SELECT id FROM warehouse_locations WHERE code = ?', [cleanCode]);
      if (existing) return res.status(400).json({ error: `Mã vị trí '${cleanCode}' đã tồn tại` });
      if (parentId) {
        const parent = await db.get('SELECT id, warehouseId FROM warehouse_locations WHERE id = ?', [parentId]);
        if (!parent) return res.status(400).json({ error: 'Parent location not found' });
        if (parent.warehouseId !== warehouseId) {
          return res.status(400).json({ error: 'Parent location must belong to the same warehouse' });
        }
      }
      const id = randomUUID();
      await db.run(
        `INSERT INTO warehouse_locations
         (id, warehouseId, parentId, code, name, type, purpose, createdBy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, warehouseId, parentId || null, cleanCode, String(name).trim(), type, purpose, (req as any).user?.id || null]
      );
      res.json({ id, code: cleanCode, success: true });
    } catch (error) {
      console.error('Error creating warehouse location:', error);
      res.status(500).json({ error: 'Failed to create warehouse location' });
    }
  });

  router.patch('/locations/:id', async (req, res) => {
    try {
      if (!canManageStock(req)) return res.status(403).json({ error: 'Forbidden' });
      const { id } = req.params;
      const row = await db.get('SELECT * FROM warehouse_locations WHERE id = ?', [id]);
      if (!row) return res.status(404).json({ error: 'Location not found' });
      const { name, type, purpose, parentId, isActive } = req.body;
      if (type !== undefined && !VALID_LOCATION_TYPES.includes(type)) {
        return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_LOCATION_TYPES.join(', ')}` });
      }
      if (purpose !== undefined && !VALID_LOCATION_PURPOSES.includes(purpose)) {
        return res.status(400).json({ error: `Invalid purpose. Must be one of: ${VALID_LOCATION_PURPOSES.join(', ')}` });
      }
      if (parentId !== undefined && parentId !== null) {
        if (parentId === id) return res.status(400).json({ error: 'Location cannot be its own parent' });
        const parent = await db.get('SELECT id, warehouseId FROM warehouse_locations WHERE id = ?', [parentId]);
        if (!parent) return res.status(400).json({ error: 'Parent location not found' });
        if (parent.warehouseId !== row.warehouseId) {
          return res.status(400).json({ error: 'Parent location must belong to the same warehouse' });
        }
      }
      await db.run(
        `UPDATE warehouse_locations
         SET name = ?, type = ?, purpose = ?, parentId = ?, isActive = ?, updatedAt = ?
         WHERE id = ?`,
        [
          name !== undefined ? String(name).trim() : row.name,
          type !== undefined ? type : row.type,
          purpose !== undefined ? purpose : row.purpose,
          parentId !== undefined ? parentId : row.parentId,
          isActive !== undefined ? (isActive ? 1 : 0) : row.isActive,
          new Date().toISOString(), id,
        ]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating warehouse location:', error);
      res.status(500).json({ error: 'Failed to update warehouse location' });
    }
  });

  router.delete('/locations/:id', async (req, res) => {
    try {
      if (!canManageStock(req)) return res.status(403).json({ error: 'Forbidden' });
      const { id } = req.params;
      const row = await db.get('SELECT * FROM warehouse_locations WHERE id = ?', [id]);
      if (!row) return res.status(404).json({ error: 'Location not found' });
      const hasChildren = await db.get('SELECT COUNT(*) AS c FROM warehouse_locations WHERE parentId = ?', [id]);
      if (hasChildren && Number(hasChildren.c) > 0) {
        return res.status(400).json({ error: `Vị trí '${row.code}' còn ${hasChildren.c} vị trí con` });
      }
      await db.run('DELETE FROM warehouse_locations WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting warehouse location:', error);
      res.status(500).json({ error: 'Failed to delete warehouse location' });
    }
  });

  return router;
}
