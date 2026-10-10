import { Router } from 'express';
import { randomUUID } from 'crypto';
import { canManageWarehouse, isWhAdmin, requireWarehouseView } from '../middleware/warehouseAuth.js';

// Alerts + Min/Max policies (B3, spec §26-27). Management views share the
// sidebar OR-rule: level 20+ (incl. Director) or matching permission.
// Effective policy = per-warehouse override, else product defaults.
// Every list carries codes for drill-down into stock/serials pages.

function requireManager(req: any, res: any): boolean {
  if (canManageWarehouse(req, 'stock.manage')) return true;
  res.status(403).json({ error: 'Forbidden' });
  return false;
}

export function warehouseAlertsRoutes(db: any) {
  const router = Router();

  // ============================================================
  // GET /api/warehouse/policies - Min/Max overrides
  // ============================================================
  router.get('/policies', async (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const conditions: string[] = [];
      const params: any[] = [];
      const productId = String(req.query.productId || '');
      if (productId) {
        conditions.push('sp.productId = ?');
        params.push(productId);
      }
      const warehouseId = String(req.query.warehouseId || '');
      if (warehouseId) {
        conditions.push('sp.warehouseId = ?');
        params.push(warehouseId);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.all(
        `SELECT sp.*, p.code AS productCode, p.name AS productName, p.unit,
                w.code AS warehouseCode, w.name AS warehouseName
         FROM stock_policies sp
         JOIN stock_products p ON sp.productId = p.id
         JOIN warehouses w ON sp.warehouseId = w.id
         ${where}
         ORDER BY p.code ASC`,
        params
      );
      res.json(rows.map((r: any) => ({
        ...r,
        minStock: Number(r.minStock), maxStock: Number(r.maxStock),
        reorderPoint: Number(r.reorderPoint), preferredQty: Number(r.preferredQty),
        leadTimeDays: Number(r.leadTimeDays),
      })));
    } catch (error) {
      console.error('Error fetching stock policies:', error);
      res.status(500).json({ error: 'Failed to fetch stock policies' });
    }
  });

  // POST /api/warehouse/policies - upsert override (TP)
  router.post('/policies', async (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const { productId, warehouseId, minStock = 0, maxStock = 0, reorderPoint = 0, preferredQty = 0, leadTimeDays = 0 } = req.body;
      if (!productId || !warehouseId) {
        return res.status(400).json({ error: 'productId and warehouseId are required' });
      }
      for (const [key, value] of Object.entries({ minStock, maxStock, reorderPoint, preferredQty, leadTimeDays })) {
        if (Number.isNaN(Number(value)) || Number(value) < 0) {
          return res.status(400).json({ error: `${key} must be a number >= 0` });
        }
      }
      const product = await db.get('SELECT id FROM stock_products WHERE id = ?', [productId]);
      if (!product) return res.status(400).json({ error: 'Product not found' });
      const warehouse = await db.get('SELECT id FROM warehouses WHERE id = ?', [warehouseId]);
      if (!warehouse) return res.status(400).json({ error: 'Warehouse not found' });
      const now = new Date().toISOString();
      const existing: any = await db.get(
        'SELECT id FROM stock_policies WHERE productId = ? AND warehouseId = ?', [productId, warehouseId]);
      if (existing) {
        await db.run(
          `UPDATE stock_policies
           SET minStock = ?, maxStock = ?, reorderPoint = ?, preferredQty = ?, leadTimeDays = ?, updatedAt = ?
           WHERE id = ?`,
          [Number(minStock), Number(maxStock), Number(reorderPoint), Number(preferredQty), Number(leadTimeDays), now, existing.id]
        );
        return res.json({ id: existing.id, success: true, updated: true });
      }
      const id = randomUUID();
      await db.run(
        `INSERT INTO stock_policies
         (id, productId, warehouseId, minStock, maxStock, reorderPoint, preferredQty, leadTimeDays, createdBy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, productId, warehouseId, Number(minStock), Number(maxStock), Number(reorderPoint),
         Number(preferredQty), Number(leadTimeDays), (req as any).user?.id || null]
      );
      res.json({ id, success: true });
    } catch (error) {
      console.error('Error saving stock policy:', error);
      res.status(500).json({ error: 'Failed to save stock policy' });
    }
  });

  // DELETE /api/warehouse/policies/:id - remove override (falls back to product defaults)
  router.delete('/policies/:id', async (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const row = await db.get('SELECT id FROM stock_policies WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Policy not found' });
      await db.run('DELETE FROM stock_policies WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting stock policy:', error);
      res.status(500).json({ error: 'Failed to delete stock policy' });
    }
  });

  // ============================================================
  // GET /api/warehouse/alerts - management alert lists (TP)
  // ============================================================
  router.get('/alerts', requireWarehouseView(['stock.manage', 'stock.reports']), async (req, res) => {
    try {
      const warehouseId = String(req.query.warehouseId || '');
      const slowDays = Math.min(Math.max(parseInt(String(req.query.slowDays || '90'), 10) || 90, 1), 3650);
      const whFilter = warehouseId ? ' AND b.warehouseId = ?' : '';
      const whParams: any[] = warehouseId ? [warehouseId] : [];

      // Effective policy per product+warehouse
      const agg: any = await db.all(
        `SELECT b.productId, p.code AS productCode, p.name AS productName, p.unit,
                b.warehouseId, w.code AS warehouseCode, w.name AS warehouseName,
                COALESCE(SUM(b.onHand), 0) AS onHand,
                COALESCE(SUM(b.onHand - b.reserved), 0) AS available,
                COALESCE(MAX(sp.reorderPoint), MAX(p.reorderPoint), MAX(p.minStock), 0) AS reorderPoint,
                COALESCE(MAX(sp.minStock), MAX(p.minStock), 0) AS minStock,
                COALESCE(MAX(sp.maxStock), MAX(p.maxStock), 0) AS maxStock
         FROM stock_balances b
         JOIN stock_products p ON b.productId = p.id
         JOIN warehouses w ON b.warehouseId = w.id
         LEFT JOIN stock_policies sp ON sp.productId = b.productId AND sp.warehouseId = b.warehouseId
         WHERE 1=1 ${whFilter}
         GROUP BY b.productId, b.warehouseId`,
        whParams
      );
      const out = [];
      const low = [];
      for (const r of agg) {
        const available = Number(r.available);
        const rp = Number(r.reorderPoint);
        const item = {
          productId: r.productId, productCode: r.productCode, productName: r.productName, unit: r.unit,
          warehouseId: r.warehouseId, warehouseCode: r.warehouseCode, warehouseName: r.warehouseName,
          onHand: Number(r.onHand), available,
          minStock: Number(r.minStock), maxStock: Number(r.maxStock), reorderPoint: rp,
        };
        if (available <= 0) out.push(item);
        else if (rp > 0 && available <= rp) low.push(item);
      }

      // Slow-moving: on hand but no moves in slowDays
      const slow: any = await db.all(        `SELECT b.productId, p.code AS productCode, p.name AS productName, p.unit,
                b.warehouseId, w.code AS warehouseCode,
                COALESCE(SUM(b.onHand), 0) AS onHand,
                MAX(m.createdAt) AS lastMoveAt,
                DATEDIFF(NOW(), MAX(m.createdAt)) AS daysSinceMove
         FROM stock_balances b
         JOIN stock_products p ON b.productId = p.id
         JOIN warehouses w ON b.warehouseId = w.id
         LEFT JOIN stock_moves m ON m.productId = b.productId AND m.warehouseId = b.warehouseId
         WHERE 1=1 ${whFilter}
         GROUP BY b.productId, b.warehouseId
         HAVING COALESCE(SUM(b.onHand), 0) > 0
            AND (MAX(m.createdAt) IS NULL OR DATEDIFF(NOW(), MAX(m.createdAt)) >= ?)
         ORDER BY MAX(m.createdAt) IS NULL DESC, MAX(m.createdAt) ASC
         LIMIT 100`,
        [...whParams, slowDays]
      );

      // Overdue incoming receipts
      const today = new Date().toISOString().slice(0, 10);
      const incomingOverdue: any = await db.all(
        `SELECT d.id, d.code, d.dueDate, d.supplierName, w.code AS warehouseCode,
                (SELECT COUNT(*) FROM stock_document_lines l WHERE l.docId = d.id) AS lineCount
         FROM stock_documents d
         JOIN warehouses w ON d.warehouseId = w.id
         WHERE d.type = 'RECEIPT' AND d.status IN ('CONFIRMED', 'RECEIVING')
           AND d.dueDate IS NOT NULL AND d.dueDate < ?
           ${warehouseId ? 'AND d.warehouseId = ?' : ''}
         ORDER BY d.dueDate ASC
         LIMIT 50`,
        warehouseId ? [today, warehouseId] : [today]
      );

      // Reservations expiring within 7 days
      const expiringRes: any = await db.all(
        `SELECT r.id, r.productCode, r.productName, r.qty, r.expiresAt, w.code AS warehouseCode
         FROM reservations r
         JOIN warehouses w ON r.warehouseId = w.id
         WHERE r.status = 'ACTIVE' AND r.expiresAt IS NOT NULL
           AND r.expiresAt <= DATE_ADD(NOW(), INTERVAL 7 DAY)
           ${warehouseId ? 'AND r.warehouseId = ?' : ''}
         ORDER BY r.expiresAt ASC
         LIMIT 50`,
        warehouseId ? [warehouseId] : []
      );

      // Exception serials by status
      const excRows: any = await db.all(
        `SELECT status, COUNT(*) AS c FROM serials
         WHERE status IN ('WARRANTY', 'DAMAGED', 'QUARANTINE', 'LOST')
         GROUP BY status`
      );
      const exceptions: Record<string, number> = { WARRANTY: 0, DAMAGED: 0, QUARANTINE: 0, LOST: 0 };
      for (const r of excRows) exceptions[r.status] = Number(r.c);

      res.json({
        out, low,
        slow: slow.map((r: any) => ({ ...r, onHand: Number(r.onHand), daysSinceMove: r.daysSinceMove === null ? null : Number(r.daysSinceMove) })),
        incomingOverdue, expiringReservations: expiringRes, exceptions,
        slowDays,
      });
    } catch (error) {
      console.error('Error fetching alerts:', error);
      res.status(500).json({ error: 'Failed to fetch alerts' });
    }
  });

  // ============================================================
  // GET /api/warehouse/moves - Lịch sử biến động (filter + paging)
  // ============================================================
  router.get('/moves', async (req, res) => {
    try {
      const user: any = req.user || {};
      if (isWhAdmin(req)) return res.json({ rows: [], total: 0, page: 1, pageSize: 20 });
      const conditions: string[] = [];
      const params: any[] = [];
      const productId = String(req.query.productId || '');
      if (productId) {
        conditions.push('m.productId = ?');
        params.push(productId);
      }
      const warehouseId = String(req.query.warehouseId || '');
      if (warehouseId) {
        conditions.push('m.warehouseId = ?');
        params.push(warehouseId);
      }
      const moveType = String(req.query.moveType || '');
      if (moveType) {
        conditions.push('m.moveType = ?');
        params.push(moveType);
      }
      const from = String(req.query.from || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        conditions.push('m.createdAt >= ?');
        params.push(from);
      }
      const to = String(req.query.to || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        conditions.push('m.createdAt < DATE_ADD(?, INTERVAL 1 DAY)');
        params.push(to);
      }
      const search = String(req.query.search || '').trim();
      if (search) {
        conditions.push('(m.productCode LIKE ? OR m.serialNo LIKE ? OR d.code LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const pageSize = Math.min(Math.max(parseInt(String(req.query.pageSize || '20'), 10) || 20, 1), 500);
      const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
      const totalRow: any = await db.get(`SELECT COUNT(*) AS c FROM stock_moves m LEFT JOIN stock_documents d ON m.docId = d.id ${where}`, params);
      const rows: any = await db.all(
        `SELECT m.*, d.code AS docCode, w.code AS warehouseCode,
                u.name AS createdByName
         FROM stock_moves m
         LEFT JOIN stock_documents d ON m.docId = d.id
         LEFT JOIN warehouses w ON m.warehouseId = w.id
         LEFT JOIN users u ON m.createdBy = u.id
         ${where}
         ORDER BY m.createdAt DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      res.json({
        rows: rows.map((r: any) => ({ ...r, qty: Number(r.qty) })),
        total: Number(totalRow?.c || 0), page, pageSize,
      });
    } catch (error) {
      console.error('Error fetching moves:', error);
      res.status(500).json({ error: 'Failed to fetch moves' });
    }
  });

  // ============================================================
  // GET /api/warehouse/report/summary - Nhập-Xuất-Tồn theo ngày (?month=YYYY-MM)
  // ============================================================
  router.get('/report/summary', requireWarehouseView(['stock.reports']), async (req, res) => {
    try {
      const monthParam = /^\d{4}-\d{2}$/.test(String(req.query.month || ''))
        ? String(req.query.month)
        : new Date().toISOString().slice(0, 7);
      const [mYear, mMonth] = monthParam.split('-').map(Number);
      const monthStart = `${monthParam}-01`;
      const monthEnd = new Date(Date.UTC(mYear, mMonth, 1)).toISOString().slice(0, 10);
      const warehouseId = String(req.query.warehouseId || '');
      const extra = warehouseId ? ' AND m.warehouseId = ?' : '';
      const extraParams: any[] = warehouseId ? [warehouseId] : [];

      const byDay: any = await db.all(
        `SELECT DATE(m.createdAt) AS day,
                SUM(CASE WHEN m.qty > 0 AND m.moveType IN ('RECEIPT', 'TRANSFER') THEN m.qty ELSE 0 END) AS inbound,
                SUM(CASE WHEN m.qty < 0 THEN -m.qty ELSE 0 END) AS outbound
         FROM stock_moves m
         WHERE m.createdAt >= ? AND m.createdAt < ? AND m.moveType NOT IN ('SERIAL_REGISTER') ${extra}
         GROUP BY DATE(m.createdAt)
         ORDER BY day ASC`,
        [monthStart, monthEnd, ...extraParams]
      );
      const byType: any = await db.all(
        `SELECT m.moveType, COUNT(*) AS docs, COALESCE(SUM(ABS(m.qty)), 0) AS qty
         FROM stock_moves m
         WHERE m.createdAt >= ? AND m.createdAt < ? AND m.moveType NOT IN ('SERIAL_REGISTER') ${extra}
         GROUP BY m.moveType`,
        [monthStart, monthEnd, ...extraParams]
      );
      const byWarehouse: any = await db.all(
        `SELECT w.id AS warehouseId, w.code AS warehouseCode, w.name AS warehouseName,
                COALESCE(SUM(b.onHand), 0) AS onHand,
                COALESCE(SUM(b.reserved), 0) AS reserved,
                COALESCE(SUM(b.onHand - b.reserved), 0) AS available,
                COUNT(DISTINCT b.productId) AS sku
         FROM stock_balances b
         JOIN warehouses w ON b.warehouseId = w.id
         ${warehouseId ? 'WHERE b.warehouseId = ?' : ''}
         GROUP BY w.id
         ORDER BY w.code ASC`,
        warehouseId ? [warehouseId] : []
      );
      const inTransit: any = await db.all(
        `SELECT d.id, d.code, d.etaDate, d.createdAt,
                w.code AS warehouseCode, tw.code AS toWarehouseCode,
                (SELECT COUNT(*) FROM stock_document_lines l WHERE l.docId = d.id) AS lineCount,
                (SELECT COALESCE(SUM(l.qtyOrdered), 0) FROM stock_document_lines l WHERE l.docId = d.id) AS qty
         FROM stock_documents d
         JOIN warehouses w ON d.warehouseId = w.id
         LEFT JOIN warehouses tw ON d.toWarehouseId = tw.id
         WHERE d.type = 'TRANSFER' AND d.status = 'IN_TRANSIT'
           ${warehouseId ? 'AND (d.warehouseId = ? OR d.toWarehouseId = ?)' : ''}
         ORDER BY d.etaDate IS NULL, d.etaDate ASC`,
        warehouseId ? [warehouseId, warehouseId] : []
      );
      res.json({
        month: monthParam,
        byDay: byDay.map((r: any) => ({ day: r.day, inbound: Number(r.inbound), outbound: Number(r.outbound) })),
        byType: byType.map((r: any) => ({ moveType: r.moveType, docs: Number(r.docs), qty: Number(r.qty) })),
        byWarehouse: byWarehouse.map((r: any) => ({
          ...r, onHand: Number(r.onHand), reserved: Number(r.reserved),
          available: Number(r.available), sku: Number(r.sku),
        })),
        inTransit,
      });
    } catch (error) {
      console.error('Error fetching report summary:', error);
      res.status(500).json({ error: 'Failed to fetch report summary' });
    }
  });

  return router;
}
