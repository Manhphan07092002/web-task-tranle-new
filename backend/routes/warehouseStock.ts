import { Router } from 'express';
import { isWhAdmin, managesWarehouse } from '../middleware/warehouseAuth.js';

// Central stock inquiry (A6, spec §9-§12): ONE page, tabs Tổng hợp /
// Theo kho-vị trí (+ Serial-Lô / Combo land in Phase B/C).
// UI always prefers Available = onHand - reserved.

function stockScope(req: any): { restricted: boolean } {
  return { restricted: isWhAdmin(req) };
}

// Incoming = ordered but not yet received on open receipt docs.
async function incomingMap(db: any): Promise<Map<string, number>> {
  const rows: any = await db.all(
    `SELECT l.productId, d.warehouseId, COALESCE(SUM(l.qtyOrdered - l.qtyReceived), 0) AS incoming
     FROM stock_document_lines l
     JOIN stock_documents d ON l.docId = d.id
     WHERE d.type = 'RECEIPT' AND d.status IN ('CONFIRMED', 'RECEIVING')
     GROUP BY l.productId, d.warehouseId`
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(`${r.productId}|${r.warehouseId}`, Number(r.incoming));
  return map;
}

export function warehouseStockRoutes(db: any) {
  const router = Router();

  // ============================================================
  // GET /api/warehouse/stock?view=summary|by-location
  // Filters: search, warehouseId, category, brand, tracking, status
  // (instock|low|out), minStockOnly. Pagination: page, pageSize.
  // ============================================================
  router.get('/stock', async (req, res) => {
    try {
      const { restricted } = stockScope(req);
      if (restricted) return res.json({ rows: [], total: 0, page: 1, pageSize: 20 });

      const view = String(req.query.view || 'summary');
      if (view !== 'summary' && view !== 'by-location') {
        return res.status(400).json({ error: 'view must be summary or by-location' });
      }
      const search = String(req.query.search || '').trim();
      const warehouseId = String(req.query.warehouseId || '');
      const category = String(req.query.category || '').trim();
      const brand = String(req.query.brand || '').trim();
      const tracking = String(req.query.tracking || '').trim();
      const status = String(req.query.status || '');
      const pageSize = Math.min(Math.max(parseInt(String(req.query.pageSize || '20'), 10) || 20, 1), 500);
      const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);

      const conditions: string[] = [];
      const params: any[] = [];
      if (search) {
        conditions.push('(p.code LIKE ? OR p.name LIKE ? OR p.model LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (warehouseId) {
        conditions.push('b.warehouseId = ?');
        params.push(warehouseId);
      }
      if (category) {
        conditions.push('p.category = ?');
        params.push(category);
      }
      if (brand) {
        conditions.push('p.brand = ?');
        params.push(brand);
      }
      if (tracking) {
        conditions.push('p.tracking = ?');
        params.push(tracking);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      if (view === 'summary') {
        const totalRow: any = await db.get(
          `SELECT COUNT(DISTINCT b.productId) AS c
           FROM stock_balances b JOIN stock_products p ON b.productId = p.id ${where}`,
          params
        );
        const total = Number(totalRow?.c || 0);
        const rows: any = await db.all(
          `SELECT b.productId, p.code AS productCode, p.name AS productName, p.unit,
                  p.category, p.brand, p.model, p.tracking,
                  COALESCE(MAX(sp.minStock), MAX(p.minStock), 0) AS minStock,
                  COALESCE(MAX(sp.maxStock), MAX(p.maxStock), 0) AS maxStock,
                  COALESCE(MAX(sp.reorderPoint), MAX(p.reorderPoint), MAX(p.minStock), 0) AS reorderPoint,
                  COALESCE(SUM(b.onHand), 0) AS onHand,
                  COALESCE(SUM(b.reserved), 0) AS reserved,
                  COALESCE(SUM(b.onHand - b.reserved), 0) AS available
           FROM stock_balances b JOIN stock_products p ON b.productId = p.id
           LEFT JOIN stock_policies sp ON sp.productId = b.productId AND sp.warehouseId = b.warehouseId
           ${where}
           GROUP BY b.productId
           ORDER BY p.code ASC
           LIMIT ? OFFSET ?`,
          [...params, pageSize, (page - 1) * pageSize]
        );
        const incoming = await incomingMap(db);
        const withStatus = rows.map((r: any) => {
          const available = Number(r.available);
          const reorder = Number(r.reorderPoint) || Number(r.minStock) || 0;
          const st = available <= 0 ? 'out' : reorder > 0 && available <= reorder ? 'low' : 'ok';
          return {
            ...r,
            onHand: Number(r.onHand), reserved: Number(r.reserved), available,
            minStock: Number(r.minStock), maxStock: Number(r.maxStock), reorderPoint: Number(r.reorderPoint),
            incoming: 0, // summed per warehouse below; summary shows total
            status: st,
          };
        });
        // Total incoming across warehouses for summary rows shown
        const prodIds = withStatus.map((r: any) => r.productId);
        if (prodIds.length > 0) {
          const inRows: any = await db.all(
            `SELECT l.productId, COALESCE(SUM(l.qtyOrdered - l.qtyReceived), 0) AS incoming
             FROM stock_document_lines l
             JOIN stock_documents d ON l.docId = d.id
             WHERE d.type = 'RECEIPT' AND d.status IN ('CONFIRMED', 'RECEIVING')
               AND l.productId IN (${prodIds.map(() => '?').join(',')})
             GROUP BY l.productId`,
            prodIds
          );
          const inMap = new Map(inRows.map((x: any) => [x.productId, Number(x.incoming)]));
          withStatus.forEach((r: any) => { r.incoming = inMap.get(r.productId) || 0; });
        }
        void incoming;
        const filtered = status ? withStatus.filter((r: any) => r.status === status) : withStatus;
        return res.json({ rows: filtered, total: status ? filtered.length : total, page, pageSize });
      }

      // by-location view
      const totalRow: any = await db.get(
        `SELECT COUNT(*) AS c
         FROM stock_balances b JOIN stock_products p ON b.productId = p.id ${where}`,
        params
      );
      const rows: any = await db.all(
        `SELECT b.productId, p.code AS productCode, p.name AS productName, p.unit,
                p.category, p.brand, p.tracking,
                COALESCE(sp.minStock, p.minStock, 0) AS minStock,
                COALESCE(sp.reorderPoint, p.reorderPoint, p.minStock, 0) AS reorderPoint,
                b.warehouseId, w.code AS warehouseCode, w.name AS warehouseName,
                b.locationId, l.code AS locationCode,
                b.onHand, b.reserved, (b.onHand - b.reserved) AS available
         FROM stock_balances b
         JOIN stock_products p ON b.productId = p.id
         JOIN warehouses w ON b.warehouseId = w.id
         LEFT JOIN warehouse_locations l ON b.locationId = l.id
         LEFT JOIN stock_policies sp ON sp.productId = b.productId AND sp.warehouseId = b.warehouseId
         ${where}
         ORDER BY w.code ASC, p.code ASC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      const incoming = await incomingMap(db);
      const withStatus = rows.map((r: any) => {
        const available = Number(r.available);
        const reorder = Number(r.reorderPoint) || Number(r.minStock) || 0;
        return {
          ...r,
          onHand: Number(r.onHand), reserved: Number(r.reserved), available,
          minStock: Number(r.minStock),
          incoming: incoming.get(`${r.productId}|${r.warehouseId}`) || 0,
          status: available <= 0 ? 'out' : reorder > 0 && available <= reorder ? 'low' : 'ok',
        };
      });
      const filtered = status ? withStatus.filter((r: any) => r.status === status) : withStatus;
      res.json({ rows: filtered, total: status ? filtered.length : Number(totalRow?.c || 0), page, pageSize });
    } catch (error) {
      console.error('Error fetching stock:', error);
      res.status(500).json({ error: 'Failed to fetch stock' });
    }
  });

  // ============================================================
  // GET /api/warehouse/stock/:productId - Product drawer data
  // ============================================================
  router.get('/stock/:productId', async (req, res) => {
    try {
      const { restricted } = stockScope(req);
      if (restricted) return res.status(403).json({ error: 'Forbidden' });
      const product = await db.get('SELECT * FROM stock_products WHERE id = ?', [req.params.productId]);
      if (!product) return res.status(404).json({ error: 'Product not found' });

      const breakdown: any = await db.all(
        `SELECT b.warehouseId, w.code AS warehouseCode, w.name AS warehouseName,
                b.locationId, l.code AS locationCode,
                b.onHand, b.reserved, (b.onHand - b.reserved) AS available
         FROM stock_balances b
         JOIN warehouses w ON b.warehouseId = w.id
         LEFT JOIN warehouse_locations l ON b.locationId = l.id
         WHERE b.productId = ?
         ORDER BY w.code ASC`,
        [product.id]
      );
      const moves: any = await db.all(
        `SELECT m.id, m.qty, m.moveType, m.createdAt, m.docId, d.code AS docCode,
                w.code AS warehouseCode
         FROM stock_moves m
         LEFT JOIN stock_documents d ON m.docId = d.id
         LEFT JOIN warehouses w ON m.warehouseId = w.id
         WHERE m.productId = ?
         ORDER BY m.createdAt DESC
         LIMIT 20`,
        [product.id]
      );
      const payload: any = {
        product,
        breakdown: breakdown.map((b: any) => ({
          ...b, onHand: Number(b.onHand), reserved: Number(b.reserved), available: Number(b.available),
        })),
        moves: moves.map((m: any) => ({ ...m, qty: Number(m.qty) })),
        totals: {
          onHand: breakdown.reduce((s: number, b: any) => s + Number(b.onHand), 0),
          reserved: breakdown.reduce((s: number, b: any) => s + Number(b.reserved), 0),
          available: breakdown.reduce((s: number, b: any) => s + Number(b.available), 0),
        },
      };
      // TP extras: active reservations + incoming docs
      if (!isWhAdmin(req) && managesWarehouse(req)) {
        const reservations: any = await db.all(
          `SELECT r.id, r.qty, r.qtyConsumed, r.status, r.sourceType, r.sourceId,
                  w.code AS warehouseCode, u.name AS assigneeName, r.expiresAt
           FROM reservations r
           JOIN warehouses w ON r.warehouseId = w.id
           LEFT JOIN users u ON r.assigneeId = u.id
           WHERE r.productId = ? AND r.status = 'ACTIVE'
           ORDER BY r.createdAt DESC`,
          [product.id]
        );
        const incomingDocs: any = await db.all(
          `SELECT d.id, d.code, d.status, d.warehouseId, w.code AS warehouseCode,
                  l.productCode, (l.qtyOrdered - l.qtyReceived) AS qtyPending
           FROM stock_document_lines l
           JOIN stock_documents d ON l.docId = d.id
           JOIN warehouses w ON d.warehouseId = w.id
           WHERE d.type = 'RECEIPT' AND d.status IN ('CONFIRMED', 'RECEIVING')
             AND l.productId = ? AND (l.qtyOrdered - l.qtyReceived) > 0
           ORDER BY d.createdAt DESC`,
          [product.id]
        );
        payload.reservations = reservations.map((r: any) => ({ ...r, qty: Number(r.qty), qtyConsumed: Number(r.qtyConsumed) }));
        payload.incomingDocs = incomingDocs.map((d: any) => ({ ...d, qtyPending: Number(d.qtyPending) }));
      }
      res.json(payload);
    } catch (error) {
      console.error('Error fetching product stock:', error);
      res.status(500).json({ error: 'Failed to fetch product stock' });
    }
  });

  // ============================================================
  // GET /api/warehouse/dashboard/overview - role-aware dashboard (spec §7-§8)
  // level 10: personal KPIs + assigned tasks + personal alerts.
  // level 20+: department KPIs + warehouses table + admin alerts + performance.
  // ============================================================
  router.get('/dashboard/overview', async (req, res) => {
    try {
      const user: any = req.user || {};
      const userId = user.id;
      if (isWhAdmin(req) || !userId) return res.json({ role: 'none' });
      const today = new Date().toISOString().slice(0, 10);

      // Permission-driven scope: stock.manage = department manager view,
      // otherwise personal ("Nhân viên") view.
      if (!managesWarehouse(req)) {
        const own = '(d.requesterId = ? OR d.assigneeId = ? OR d.receiverId = ? OR d.createdBy = ?)';
        const ownParams = [userId, userId, userId, userId];
        const countBy = async (type: string, statuses: string[]) => {
          const row: any = await db.get(
            `SELECT COUNT(*) AS c FROM stock_documents d
             WHERE d.type = ? AND d.status IN (${statuses.map(() => '?').join(',')}) AND ${own}`,
            [type, ...statuses, ...ownParams]
          );
          return Number(row?.c || 0);
        };
        const tasks: any = await db.all(
          `SELECT d.id, d.code, d.type, d.status, d.dueDate, d.warehouseId,
                  w.code AS warehouseCode,
                  (SELECT COUNT(*) FROM stock_document_lines l WHERE l.docId = d.id) AS lineCount,
                  (SELECT COALESCE(SUM(l.qtyOrdered), 0) FROM stock_document_lines l WHERE l.docId = d.id) AS qtyOrdered,
                  (SELECT l.productName FROM stock_document_lines l WHERE l.docId = d.id ORDER BY l.createdAt ASC LIMIT 1) AS firstProduct
           FROM stock_documents d
           JOIN warehouses w ON d.warehouseId = w.id
           WHERE d.status IN ('CONFIRMED', 'RECEIVING', 'PICKING', 'IN_TRANSIT', 'READY') AND ${own}
           ORDER BY d.dueDate IS NULL, d.dueDate ASC, d.createdAt DESC
           LIMIT 10`,
          ownParams
        );
        const overdue: any = await db.all(
          `SELECT d.id, d.code, d.type, d.status, d.dueDate
           FROM stock_documents d
           WHERE d.dueDate IS NOT NULL AND d.dueDate < ?
             AND d.status IN ('CONFIRMED', 'RECEIVING', 'PICKING', 'IN_TRANSIT', 'READY')
             AND ${own}
           ORDER BY d.dueDate ASC
           LIMIT 5`,
          [today, ...ownParams]
        );
        const awaitingTransfers: any = await db.all(
          `SELECT d.id, d.code, d.status, d.etaDate
           FROM stock_documents d
           WHERE d.type = 'TRANSFER' AND d.status = 'IN_TRANSIT' AND d.receiverId = ?
           ORDER BY d.etaDate IS NULL, d.etaDate ASC
           LIMIT 5`,
          [userId]
        );
        return res.json({
          role: 'staff',
          user: { id: userId, name: user.name },
          date: today,
          kpis: {
            pendingReceipts: await countBy('RECEIPT', ['CONFIRMED', 'RECEIVING']),
            pendingIssues: await countBy('ISSUE', ['CONFIRMED', 'PICKING', 'READY']),
            pendingTransfers: await countBy('TRANSFER', ['CONFIRMED', 'IN_TRANSIT', 'RECEIVED']),
            pendingCounts: 0, // stock counts land in Phase B
          },
          todayTasks: tasks,
          alerts: {
            overdue,
            awaitingTransfers,
          },
        });
      }

      // ---- Manager / Director ----
      const warehouseId = String(req.query.warehouseId || '');
      const whFilter = warehouseId ? ' AND b.warehouseId = ?' : '';
      const whParams: any[] = warehouseId ? [warehouseId] : [];

      const prodAgg: any = await db.all(
        `SELECT b.productId,
                COALESCE(SUM(b.onHand), 0) AS onHand,
                COALESCE(SUM(b.onHand - b.reserved), 0) AS available,
                MAX(COALESCE(sp.reorderPoint, p.reorderPoint, p.minStock, 0)) AS reorderPoint
         FROM stock_balances b
         JOIN stock_products p ON b.productId = p.id
         LEFT JOIN stock_policies sp ON sp.productId = b.productId AND sp.warehouseId = b.warehouseId
         WHERE 1=1 ${whFilter}
         GROUP BY b.productId`,
        whParams
      );
      const skuCount = prodAgg.filter((r: any) => Number(r.onHand) > 0).length;
      const lowRows = prodAgg.filter((r: any) => {
        const a = Number(r.available);
        const rp = Number(r.reorderPoint);
        return a > 0 && rp > 0 && a <= rp;
      });
      const outRows = prodAgg.filter((r: any) => Number(r.available) <= 0);
      const docCount = async (type: string, statuses: string[], extra = '', extraParams: any[] = []) => {
        const row: any = await db.get(
          `SELECT COUNT(*) AS c FROM stock_documents d
           WHERE d.type = ? AND d.status IN (${statuses.map(() => '?').join(',')}) ${extra}`,
          [type, ...statuses, ...extraParams]
        );
        return Number(row?.c || 0);
      };
      const whExtra = warehouseId ? ' AND d.warehouseId = ?' : '';
      const whExtraParams = warehouseId ? [warehouseId] : [];
      const pendingIssues = await docCount('ISSUE', ['CONFIRMED', 'PICKING', 'READY'], whExtra, whExtraParams);
      const inTransit = await docCount('TRANSFER', ['IN_TRANSIT'], whExtra, whExtraParams);

      const warehouses: any = await db.all(
        `SELECT w.id, w.code, w.name,
                (SELECT COUNT(DISTINCT b.productId) FROM stock_balances b
                 WHERE b.warehouseId = w.id AND b.onHand > 0) AS sku,
                (SELECT COUNT(*) FROM stock_documents d
                 WHERE d.warehouseId = w.id AND d.type = 'RECEIPT' AND d.status IN ('CONFIRMED', 'RECEIVING')) AS pendingReceipts,
                (SELECT COUNT(*) FROM stock_documents d
                 WHERE d.warehouseId = w.id AND d.type = 'ISSUE' AND d.status IN ('CONFIRMED', 'PICKING', 'READY')) AS pendingIssues
         FROM warehouses w
         ${warehouseId ? 'WHERE w.id = ?' : ''}
         ORDER BY w.code ASC`,
        warehouseId ? [warehouseId] : []
      );
      // Alerts per warehouse computed from balances (low/out) — cheap enough at this scale
      for (const w of warehouses) {
        const agg: any = await db.all(
          `SELECT COALESCE(SUM(b.onHand - b.reserved), 0) AS available,
                  MAX(COALESCE(sp.reorderPoint, p.reorderPoint, p.minStock, 0)) AS reorderPoint
           FROM stock_balances b
           JOIN stock_products p ON b.productId = p.id
           LEFT JOIN stock_policies sp ON sp.productId = b.productId AND sp.warehouseId = b.warehouseId
           WHERE b.warehouseId = ?
           GROUP BY b.productId`,
          [w.id]
        );
        const out = agg.filter((r: any) => Number(r.available) <= 0).length;
        const low = agg.filter((r: any) => {
          const a = Number(r.available);
          const rp = Number(r.reorderPoint);
          return a > 0 && rp > 0 && a <= rp;
        }).length;
        w.alerts = out + low;
        w.status = out > 0 ? 'action' : low > 0 ? 'attention' : 'ok';
      }

      const outItems: any = await db.all(
        `SELECT p.code AS productCode, p.name AS productName, w.code AS warehouseCode,
                COALESCE(SUM(b.onHand - b.reserved), 0) AS available
         FROM stock_balances b
         JOIN stock_products p ON b.productId = p.id
         JOIN warehouses w ON b.warehouseId = w.id
         ${warehouseId ? 'WHERE b.warehouseId = ?' : ''}
         GROUP BY p.id, b.warehouseId
         HAVING available <= 0
         ORDER BY p.code ASC
         LIMIT 5`,
        warehouseId ? [warehouseId] : []
      );
      const overdueTransfers: any = await db.all(
        `SELECT d.id, d.code, d.etaDate, w.code AS warehouseCode, tw.code AS toWarehouseCode
         FROM stock_documents d
         JOIN warehouses w ON d.warehouseId = w.id
         LEFT JOIN warehouses tw ON d.toWarehouseId = tw.id
         WHERE d.type = 'TRANSFER' AND d.status = 'IN_TRANSIT'
           AND d.etaDate IS NOT NULL AND d.etaDate < ?
           ${warehouseId ? 'AND (d.warehouseId = ? OR d.toWarehouseId = ?)' : ''}
         ORDER BY d.etaDate ASC
         LIMIT 5`,
        warehouseId ? [today, warehouseId, warehouseId] : [today]
      );
      const overdueDocs: any = await db.all(
        `SELECT d.id, d.code, d.type, d.status, d.dueDate, w.code AS warehouseCode
         FROM stock_documents d
         JOIN warehouses w ON d.warehouseId = w.id
         WHERE d.dueDate IS NOT NULL AND d.dueDate < ?
           AND d.status IN ('CONFIRMED', 'RECEIVING', 'PICKING', 'IN_TRANSIT', 'READY')
           ${warehouseId ? 'AND d.warehouseId = ?' : ''}
         ORDER BY d.dueDate ASC
         LIMIT 5`,
        warehouseId ? [today, warehouseId] : [today]
      );
      const expiringRes: any = await db.all(
        `SELECT r.id, r.productCode, r.qty, r.expiresAt, w.code AS warehouseCode
         FROM reservations r
         JOIN warehouses w ON r.warehouseId = w.id
         WHERE r.status = 'ACTIVE' AND r.expiresAt IS NOT NULL
           AND r.expiresAt <= DATE_ADD(NOW(), INTERVAL 7 DAY)
           ${warehouseId ? 'AND r.warehouseId = ?' : ''}
         ORDER BY r.expiresAt ASC
         LIMIT 5`,
        warehouseId ? [warehouseId] : []
      );
      const performance: any = await db.all(
        `SELECT u.id, u.name,
                COUNT(*) AS handled,
                SUM(CASE WHEN d.dueDate IS NOT NULL AND DATE(d.updatedAt) <= d.dueDate THEN 1 ELSE 0 END) AS onTime,
                SUM(CASE WHEN d.dueDate IS NOT NULL AND DATE(d.updatedAt) > d.dueDate THEN 1 ELSE 0 END) AS overdue
         FROM stock_documents d
         JOIN users u ON d.assigneeId = u.id
         WHERE d.status = 'DONE'
         GROUP BY u.id
         ORDER BY handled DESC
         LIMIT 10`
      );

      res.json({
        role: 'manager',
        date: today,
        kpis: {
          skuCount,
          lowStock: lowRows.length,
          outOfStock: outRows.length,
          pendingIssues,
          inTransit,
          openVariances: 0, // stock count variances land in Phase B
        },
        warehouses: warehouses.map((w: any) => ({
          ...w, sku: Number(w.sku), pendingReceipts: Number(w.pendingReceipts), pendingIssues: Number(w.pendingIssues),
        })),
        alerts: {
          outItems: outItems.map((r: any) => ({ ...r, available: Number(r.available) })),
          overdueTransfers, overdueDocs, expiringReservations: expiringRes,
        },
        performance: performance.map((p: any) => ({
          ...p,
          handled: Number(p.handled), onTime: Number(p.onTime), overdue: Number(p.overdue),
          onTimeRate: Number(p.handled) > 0 ? Math.round((Number(p.onTime) / Number(p.handled)) * 100) : null,
        })),
      });
    } catch (error) {
      console.error('Error fetching dashboard overview:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard overview' });
    }
  });

  return router;
}
