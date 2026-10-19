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
      const { warehouseId, productId, moveType, from, to, q } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT m.*, p.name AS productName, w.name AS warehouseName, u.name AS createdByName
        FROM stock_moves m
        LEFT JOIN products p ON p.id = m.productId
        LEFT JOIN warehouses w ON w.id = m.warehouseId
        LEFT JOIN users u ON u.id = m.createdBy
        LEFT JOIN stock_serials s ON s.id = m.serialId
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND m.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND m.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      if (productId?.trim()) { query += ' AND m.productId = ?'; params.push(productId.trim()); }
      if (moveType?.trim()) { query += ' AND m.moveType = ?'; params.push(moveType.trim()); }
      if (q?.trim()) {
        const needle = `%${q.trim()}%`;
        query += ' AND (p.name LIKE ? OR m.productId LIKE ? OR s.serialNumber LIKE ? OR m.lotId LIKE ? OR u.name LIKE ?)';
        params.push(needle, needle, needle, needle, needle);
      }
      if (from?.trim()) {
        const fromDate = new Date(from);
        if (!Number.isFinite(fromDate.getTime())) return res.status(400).json({ error: 'Khoảng thời gian bắt đầu không hợp lệ' });
        query += ' AND m.createdAt >= ?'; params.push(fromDate.toISOString());
      }
      if (to?.trim()) {
        const toDate = new Date(to);
        if (!Number.isFinite(toDate.getTime())) return res.status(400).json({ error: 'Khoảng thời gian kết thúc không hợp lệ' });
        query += ' AND m.createdAt < ?'; params.push(toDate.toISOString());
      }
      query += ' ORDER BY m.createdAt DESC';
      const movePage = paginationOf(req.query as Record<string, string | undefined>);
      query += ' LIMIT ? OFFSET ?';
      params.push(movePage.limit, movePage.offset);
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock moves' }); }
  });

  // Đối soát ledger: stock_balances phải bằng tổng stock_moves theo cùng
  // product/kho/vị trí. Chỉ báo sai lệch, không tự ý sửa tồn.
  router.get('/reconciliation', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { warehouseId, productId } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json({ rows: [], total: 0 });
      }
      const filters: string[] = [];
      const params: any[] = [];
      if (warehouseId) { filters.push('b.warehouseId = ?'); params.push(warehouseId); }
      else if (!isDirector(user)) { filters.push(`b.warehouseId IN (${scope.map(() => '?').join(',')})`); params.push(...scope); }
      if (productId?.trim()) { filters.push('b.productId = ?'); params.push(productId.trim()); }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const query = `SELECT b.productId, b.warehouseId, b.locationId,
          b.onHand AS balanceOnHand, COALESCE(m.ledgerQty, 0) AS ledgerQty,
          b.onHand - COALESCE(m.ledgerQty, 0) AS difference,
          p.name AS productName, p.unit, w.name AS warehouseName
        FROM stock_balances b
        LEFT JOIN (
          SELECT productId, warehouseId, COALESCE(locationId, '') AS locationId, SUM(quantity) AS ledgerQty
          FROM stock_moves GROUP BY productId, warehouseId, COALESCE(locationId, '')
        ) m ON m.productId = b.productId AND m.warehouseId = b.warehouseId AND m.locationId = COALESCE(b.locationId, '')
        LEFT JOIN products p ON p.id = b.productId
        LEFT JOIN warehouses w ON w.id = b.warehouseId
        ${where}
        HAVING ABS(difference) > 0.000001
        ORDER BY ABS(difference) DESC`;
      const rows = await db.all(query, params);
      res.json({ rows, total: rows.length });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to reconcile stock ledger' }); }
  });

  // Phát hiện dữ liệu cần điều tra; endpoint chỉ đọc, không tự sửa Serial/Lô.
  router.get('/anomalies', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { warehouseId, type } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json({ rows: [], total: 0 });
      }
      const whClause = warehouseId ? 'AND s.warehouseId = ?' : !isDirector(user) ? `AND s.warehouseId IN (${scope.map(() => '?').join(',')})` : '';
      const whParams = warehouseId ? [warehouseId] : !isDirector(user) ? [...scope] : [];
      const rows: any[] = [];
      if (!type || type === 'SERIAL') {
        const serialRows = await db.all(`SELECT 'SERIAL_STATE' AS anomalyType, s.id, s.productId, s.serialNumber,
            s.warehouseId, s.stockStatus, s.status, p.name AS productName, w.name AS warehouseName,
            CASE WHEN s.stockStatus = 'IN_STOCK' AND COALESCE(b.onHand, 0) <= 0 THEN 'Serial còn trong kho nhưng tồn số lượng bằng 0'
                 WHEN s.stockStatus = 'OUT' AND COALESCE(b.onHand, 0) > 0 THEN 'Serial đã xuất nhưng tồn số lượng vẫn còn'
                 ELSE 'Trạng thái Serial không nhất quán' END AS message
          FROM stock_serials s
          LEFT JOIN products p ON p.id = s.productId
          LEFT JOIN warehouses w ON w.id = s.warehouseId
          LEFT JOIN (SELECT productId, warehouseId, SUM(onHand) AS onHand FROM stock_balances GROUP BY productId, warehouseId) b
            ON b.productId = s.productId AND b.warehouseId = s.warehouseId
          WHERE p.tracking = 'SERIAL' AND ((s.stockStatus = 'IN_STOCK' AND COALESCE(b.onHand, 0) <= 0) OR (s.stockStatus = 'OUT' AND COALESCE(b.onHand, 0) > 0)) ${whClause}
          ORDER BY s.updatedAt DESC`, whParams);
        rows.push(...serialRows);
      }
      if (!type || type === 'LOT') {
        const lotRows = await db.all(`SELECT 'LOT_REMAINING' AS anomalyType, l.id, l.productId, l.lotCode,
            l.warehouseId, l.remainingQty, l.initialQty, p.name AS productName, w.name AS warehouseName,
            CASE WHEN l.remainingQty < 0 THEN 'Số lượng còn lại của Lô bị âm' ELSE 'Lô có số lượng còn lại vượt số lượng ban đầu' END AS message
          FROM stock_lots l LEFT JOIN products p ON p.id = l.productId LEFT JOIN warehouses w ON w.id = l.warehouseId
          WHERE (l.remainingQty < 0 OR l.remainingQty > l.initialQty) ${warehouseId ? 'AND l.warehouseId = ?' : !isDirector(user) ? `AND l.warehouseId IN (${scope.map(() => '?').join(',')})` : ''}
          ORDER BY l.updatedAt DESC`, warehouseId ? [warehouseId] : !isDirector(user) ? [...scope] : []);
        rows.push(...lotRows);
      }
      if (!type || type === 'BALANCE') {
        const balanceRows = await db.all(`SELECT 'NEGATIVE_BALANCE' AS anomalyType, b.productId, b.warehouseId,
            b.locationId, b.onHand, b.reserved, p.name AS productName, w.name AS warehouseName,
            'Tồn hoặc số lượng giữ không được âm' AS message
          FROM stock_balances b LEFT JOIN products p ON p.id = b.productId LEFT JOIN warehouses w ON w.id = b.warehouseId
          WHERE (b.onHand < 0 OR b.reserved < 0 OR b.reserved > b.onHand)
            ${warehouseId ? 'AND b.warehouseId = ?' : !isDirector(user) ? `AND b.warehouseId IN (${scope.map(() => '?').join(',')})` : ''}
          ORDER BY b.updatedAt DESC`, warehouseId ? [warehouseId] : !isDirector(user) ? [...scope] : []);
        rows.push(...balanceRows);
      }
      res.json({ rows, total: rows.length });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to inspect stock anomalies' }); }
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
      const page = paginationOf(req.query as Record<string, string | undefined>);
      query += ' LIMIT ? OFFSET ?';
      params.push(page.limit, page.offset);
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
        ORDER BY available ASC`;
      const page = paginationOf(req.query as Record<string, string | undefined>);
      query += ' LIMIT ? OFFSET ?';
      params.push(page.limit, page.offset);
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
      // Lấy lần biến động cuối trên toàn bộ ledger trước khi so sánh cutoff.
      // Nếu giới hạn stock_moves ngay trong JOIN bằng cutoff thì mọi mặt hàng
      // chỉ từng di chuyển trước cutoff sẽ bị coi nhầm là "chưa từng di chuyển".
      let query = `SELECT b.productId, b.warehouseId,
          SUM(b.onHand) AS onHand, SUM(b.onHand - b.reserved) AS available,
          p.name AS productName, w.code AS warehouseCode, w.name AS warehouseName,
          m.lastMoveAt
        FROM stock_balances b
        LEFT JOIN products p ON p.id = b.productId
        LEFT JOIN warehouses w ON w.id = b.warehouseId
        LEFT JOIN (
          SELECT productId, warehouseId, MAX(createdAt) AS lastMoveAt
          FROM stock_moves
          GROUP BY productId, warehouseId
        ) m ON m.productId = b.productId AND m.warehouseId = b.warehouseId
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND b.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND b.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      query += ` GROUP BY b.productId, b.warehouseId, p.name, w.code, w.name, m.lastMoveAt
        HAVING onHand > 0 AND (lastMoveAt IS NULL OR lastMoveAt < ?)
        ORDER BY lastMoveAt ASC`;
      params.push(cutoff);
      const page = paginationOf(req.query as Record<string, string | undefined>);
      query += ' LIMIT ? OFFSET ?';
      params.push(page.limit, page.offset);
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch slow-moving stock' }); }
  });
  return router;
}
