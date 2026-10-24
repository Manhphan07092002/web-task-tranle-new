import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../middleware/auth.js';
import { beginStockTransaction } from '../utils/stockTransaction.js';

/** Danh mục kho: đọc cho mọi user, thêm/sửa/xóa chỉ TP+ (không Admin). */
export function warehouseRoutes(db: any) {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const rows = await db.all(
        'SELECT id, code, name, region, address, isActive FROM warehouses ORDER BY name ASC'
      );
      res.json(rows.map((w: any) => ({ ...w, isActive: Boolean(w.isActive) })));
    } catch (e) { res.status(500).json({ error: 'Failed to fetch warehouses' }); }
  });

  function requireWarehouseManager(user: any) {
    const level = normalizeManagementLevel(user?.managementLevel);
    return level >= MANAGEMENT_LEVELS.MANAGER && level !== MANAGEMENT_LEVELS.ADMIN;
  }

  const WarehouseSchema = z.object({
    code: z.string().trim().min(1).max(50),
    name: z.string().trim().min(1).max(255),
    region: z.string().trim().max(100).nullable().optional(),
    address: z.string().max(1000).nullable().optional(),
    isActive: z.boolean().optional(),
  });

  // Vị trí mặc định cho kho mới — giống seed v15 (§24).
  const DEFAULT_LOCATIONS: [string, string, string][] = [
    ['RECEIVING', 'Khu nhận hàng', 'RECEIVING'],
    ['SALEABLE', 'Khu bán hàng', 'SALEABLE'],
    ['PICKING', 'Khu soạn hàng', 'PICKING'],
    ['WARRANTY', 'Khu bảo hành', 'WARRANTY'],
    ['DAMAGED', 'Khu hàng lỗi', 'DAMAGED'],
    ['DEMO', 'Khu trưng bày', 'DEMO'],
    ['QUARANTINE', 'Khu cách ly', 'QUARANTINE'],
  ];

  router.post('/', validate(WarehouseSchema), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage warehouses' });
    let transactionOpen = false;
    try {
      const { code, name, region, address } = req.body;
      const normalizedCode = String(code).trim().toUpperCase();
      const dup = await db.get('SELECT id FROM warehouses WHERE code = ?', [normalizedCode]);
      if (dup) return res.status(409).json({ error: 'Warehouse code already exists' });
      const id = `wh-${randomUUID().slice(0, 8)}`;
      await beginStockTransaction(db);
      transactionOpen = true;
      try {
        await db.run(
          'INSERT INTO warehouses (id, code, name, region, address, isActive) VALUES (?, ?, ?, ?, ?, 1)',
          [id, normalizedCode, String(name).trim(), region?.trim() || null, address?.trim() || null]
        );
        await db.run(
          `INSERT INTO stock_locations (id, warehouseId, code, name, type, purpose) VALUES ${DEFAULT_LOCATIONS.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
          DEFAULT_LOCATIONS.flatMap(([locCode, locName, purpose]) => [`loc-${id}-${locCode}`, id, locCode, locName, 'INTERNAL', purpose])
        );
        // Nhân sự Kho Vận thấy kho mới ngay (giống bootstrap v13).
        const khoStaff = await db.all(`SELECT id FROM users WHERE primaryDepartmentId = 'tle-dept-kho' OR department = 'Kho vận'`);
        if (khoStaff.length > 0) {
          await db.run(
            `INSERT IGNORE INTO user_warehouse_scopes (id, userId, warehouseId) VALUES ${khoStaff.map(() => '(?, ?, ?)').join(', ')}`,
            khoStaff.flatMap((u: any) => [`uws-${u.id}-${id}`, u.id, id])
          );
        }
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        if ((e as any)?.message?.includes('Duplicate')) return res.status(409).json({ error: 'Warehouse code already exists' });
        throw e;
      }
      res.status(201).json({ id });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to create warehouse' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.put('/:id', validate(WarehouseSchema.partial()), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage warehouses' });
    try {
      const existing = await db.get('SELECT * FROM warehouses WHERE id = ?', [String(req.params.id)]);
      if (!existing) return res.status(404).json({ error: 'Warehouse not found' });
      const { code, name, region, address, isActive } = req.body;
      const nextCode = code?.trim() ? String(code).trim().toUpperCase() : existing.code;
      if (nextCode !== existing.code) {
        const dup = await db.get('SELECT id FROM warehouses WHERE code = ? AND id <> ?', [nextCode, existing.id]);
        if (dup) return res.status(409).json({ error: 'Warehouse code already exists' });
      }
      await db.run(
        'UPDATE warehouses SET code = ?, name = ?, region = ?, address = ?, isActive = ? WHERE id = ?',
        [nextCode, name?.trim() || existing.name, region !== undefined ? (region?.trim() || null) : existing.region,
          address !== undefined ? (address?.trim() || null) : existing.address,
          isActive === undefined ? existing.isActive : (isActive ? 1 : 0), existing.id]
      );
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to update warehouse' }); }
  });

  router.delete('/:id', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage warehouses' });
    let transactionOpen = false;
    try {
      const id = String(req.params.id);
      const existing = await db.get('SELECT id FROM warehouses WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: 'Warehouse not found' });
      const refs = await db.all(
        `SELECT 'documents' AS kind FROM stock_documents WHERE warehouseId = ? OR sourceWarehouseId = ? OR destWarehouseId = ? LIMIT 1`,
        [id, id, id]
      );
      const moves = await db.all('SELECT productId FROM stock_moves WHERE warehouseId = ? LIMIT 1', [id]);
      const balances = await db.all('SELECT productId FROM stock_balances WHERE warehouseId = ? AND (onHand <> 0 OR reserved <> 0) LIMIT 1', [id]);
      const holds = await db.all(`SELECT id FROM reservations WHERE warehouseId = ? AND status = 'HELD' LIMIT 1`, [id]);
      const counts = await db.all(`SELECT id FROM stock_counts WHERE warehouseId = ? AND status = 'COUNTING' LIMIT 1`, [id]);
      if (refs.length > 0 || moves.length > 0 || balances.length > 0 || holds.length > 0 || counts.length > 0) {
        return res.status(400).json({ error: 'Kho còn chứng từ/tồn/giữ hàng/kiểm kê, không thể xóa' });
      }
      await beginStockTransaction(db);
      transactionOpen = true;
      try {
        await db.run('DELETE FROM stock_locations WHERE warehouseId = ?', [id]);
        await db.run('DELETE FROM user_warehouse_scopes WHERE warehouseId = ?', [id]);
        await db.run('DELETE FROM warehouses WHERE id = ?', [id]);
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to delete warehouse' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  return router;
}
