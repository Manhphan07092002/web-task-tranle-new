import { Router } from 'express';
import { getWarehouseScope } from '../services/rbacService.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../middleware/auth.js';

export function stockReportRoutes(db: any) {
  const router = Router();
  router.get('/reports', async (req, res) => {
    const level = normalizeManagementLevel(req.user?.managementLevel);
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (level < MANAGEMENT_LEVELS.MANAGER || level === MANAGEMENT_LEVELS.ADMIN) return res.status(403).json({ error: 'Warehouse manager access required' });
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : new Date(NaN);
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : new Date(NaN);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to || to.getTime() - from.getTime() > 366 * 86400000) {
      return res.status(400).json({ error: 'Supply a valid reporting period of at most 366 days' });
    }
    if (from.getTime() > Date.now()) {
      return res.status(400).json({ error: 'Reporting period cannot start in the future' });
    }
    try {
      const scope = await getWarehouseScope(db, req.user);
      const warehouseId = typeof req.query.warehouseId === 'string' ? req.query.warehouseId : '';
      if (level < MANAGEMENT_LEVELS.DIRECTOR && warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (level < MANAGEMENT_LEVELS.DIRECTOR && !scope.length) return res.json([]);
      if (warehouseId && typeof db.get === 'function') {
        const exists = await db.get('SELECT id FROM warehouses WHERE id = ?', [warehouseId]).catch(() => null);
        if (!exists) return res.json([]);
      }
      const fromIso = from.toISOString(), toIso = to.toISOString();
      const params: any[] = [fromIso, toIso, fromIso, toIso, fromIso, toIso, fromIso, toIso];
      const requestedLimit = Number(req.query.limit);
      const hasPagination = typeof req.query.limit === 'string' && Number.isFinite(requestedLimit);
      const limit = hasPagination ? Math.min(Math.max(Math.floor(requestedLimit), 1), 1000) : null;
      const rawOffset = Number(req.query.offset);
      const offset = Number.isFinite(rawOffset) ? Math.max(Math.floor(rawOffset), 0) : 0;
      let filter = '';
      if (warehouseId) { filter = ' WHERE b.warehouseId = ?'; params.push(warehouseId); }
      else if (level < MANAGEMENT_LEVELS.DIRECTOR) { filter = ` WHERE b.warehouseId IN (${scope.map(() => '?').join(',')})`; params.push(...scope); }
      // One statement provides a consistent snapshot. Aggregate the whole ledger,
      // not the paginated activity feed; retain per-product units in the result.
      let query = `SELECT b.productId, b.warehouseId, p.name AS productName, p.unit, p.importPrice,
          w.name AS warehouseName,
          b.onHand - COALESCE(m.sinceStart, 0) AS opening,
          COALESCE(m.inbound, 0) AS inbound, COALESCE(m.outbound, 0) AS outbound,
          COALESCE(m.adjustment, 0) AS adjustment,
          b.onHand - COALESCE(m.afterEnd, 0) AS closing
        FROM (SELECT productId, warehouseId, SUM(onHand) AS onHand FROM stock_balances GROUP BY productId, warehouseId) b
        LEFT JOIN (
          SELECT productId, warehouseId,
            SUM(CASE WHEN createdAt >= ? THEN quantity ELSE 0 END) AS sinceStart,
            SUM(CASE WHEN createdAt >= ? THEN quantity ELSE 0 END) AS afterEnd,
            SUM(CASE WHEN createdAt >= ? AND createdAt < ? AND moveType IN ('RECEIPT','TRANSFER_IN','RETURN') THEN quantity ELSE 0 END) AS inbound,
            SUM(CASE WHEN createdAt >= ? AND createdAt < ? AND moveType IN ('ISSUE','TRANSFER_OUT') THEN -quantity ELSE 0 END) AS outbound,
            SUM(CASE WHEN createdAt >= ? AND createdAt < ? AND moveType NOT IN ('RECEIPT','TRANSFER_IN','RETURN','ISSUE','TRANSFER_OUT') THEN quantity ELSE 0 END) AS adjustment
          FROM stock_moves GROUP BY productId, warehouseId
        ) m ON m.productId = b.productId AND m.warehouseId = b.warehouseId
        LEFT JOIN products p ON p.id = b.productId
        LEFT JOIN warehouses w ON w.id = b.warehouseId
        ${filter} ORDER BY w.name, p.name`;
      if (limit !== null) {
        query += ' LIMIT ? OFFSET ?';
        params.push(limit, offset);
      }
      const rows = await db.all(query, params);
      res.json(rows.map((row: any) => {
        const numeric = Object.fromEntries(['opening', 'inbound', 'outbound', 'adjustment', 'closing'].map(key => [key, Number(row[key]) || 0]));
        const unitValue = Number(row.importPrice) || 0;
        return { ...row, ...numeric, unitValue, closingValue: numeric.closing * unitValue, availableValue: numeric.closing * unitValue };
      }));
    } catch {
      res.status(500).json({ error: 'Failed to fetch stock report' });
    }
  });

  router.get('/reports/summary', async (req, res) => {
    const level = normalizeManagementLevel(req.user?.managementLevel);
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (level < MANAGEMENT_LEVELS.MANAGER || level === MANAGEMENT_LEVELS.ADMIN) return res.status(403).json({ error: 'Warehouse manager access required' });
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : new Date(NaN);
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : new Date(NaN);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to || to.getTime() - from.getTime() > 366 * 86400000) {
      return res.status(400).json({ error: 'Supply a valid reporting period of at most 366 days' });
    }
    try {
      const scope = await getWarehouseScope(db, req.user);
      const warehouseId = typeof req.query.warehouseId === 'string' ? req.query.warehouseId : '';
      if (level < MANAGEMENT_LEVELS.DIRECTOR && warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (level < MANAGEMENT_LEVELS.DIRECTOR && !scope.length) return res.json({ totals: {}, daily: [], slowCount: 0 });
      const fromIso = from.toISOString(), toIso = to.toISOString();
      const whFilter = warehouseId ? ' AND m.warehouseId = ?' : level < MANAGEMENT_LEVELS.DIRECTOR ? ` AND m.warehouseId IN (${scope.map(() => '?').join(',')})` : '';
      const whParams = warehouseId ? [warehouseId] : level < MANAGEMENT_LEVELS.DIRECTOR ? [...scope] : [];
      const totals = await db.get(`SELECT
          COALESCE(SUM(CASE WHEN m.moveType IN ('RECEIPT','RETURN','TRANSFER_IN') THEN ABS(m.quantity) ELSE 0 END), 0) AS inbound,
          COALESCE(SUM(CASE WHEN m.moveType IN ('ISSUE','TRANSFER_OUT') THEN ABS(m.quantity) ELSE 0 END), 0) AS outbound,
          COALESCE(SUM(CASE WHEN m.moveType NOT IN ('RECEIPT','RETURN','TRANSFER_IN','ISSUE','TRANSFER_OUT') THEN ABS(m.quantity) ELSE 0 END), 0) AS adjustment,
          COUNT(DISTINCT CASE WHEN m.moveType IN ('RECEIPT','RETURN','TRANSFER_IN') THEN m.referenceId END) AS inboundDocuments,
          COUNT(DISTINCT CASE WHEN m.moveType IN ('ISSUE','TRANSFER_OUT') THEN m.referenceId END) AS outboundDocuments
        FROM stock_moves m WHERE m.createdAt >= ? AND m.createdAt < ?${whFilter}`, [fromIso, toIso, ...whParams]);
      const balanceFilter = warehouseId ? ' WHERE b.warehouseId = ?' : level < MANAGEMENT_LEVELS.DIRECTOR ? ` WHERE b.warehouseId IN (${scope.map(() => '?').join(',')})` : '';
      const balanceParams = warehouseId ? [warehouseId] : level < MANAGEMENT_LEVELS.DIRECTOR ? [...scope] : [];
      const inventory = await db.get(`SELECT COALESCE(SUM(b.onHand),0) AS onHand, COALESCE(SUM(b.reserved),0) AS reserved,
          COALESCE(SUM(b.onHand * COALESCE(p.importPrice,0)),0) AS stockValue
        FROM stock_balances b LEFT JOIN products p ON p.id = b.productId${balanceFilter}`, balanceParams);
      const daily = await db.all(`SELECT DATE(m.createdAt) AS day,
          COALESCE(SUM(CASE WHEN m.moveType IN ('RECEIPT','RETURN','TRANSFER_IN') THEN ABS(m.quantity) ELSE 0 END),0) AS inbound,
          COALESCE(SUM(CASE WHEN m.moveType IN ('ISSUE','TRANSFER_OUT') THEN ABS(m.quantity) ELSE 0 END),0) AS outbound
        FROM stock_moves m WHERE m.createdAt >= ? AND m.createdAt < ?${whFilter}
        GROUP BY DATE(m.createdAt) ORDER BY day`, [fromIso, toIso, ...whParams]);
      const slowCutoff = new Date(Date.now() - 90 * 86400000).toISOString();
      const slow = await db.get(`SELECT COUNT(*) AS count FROM (
          SELECT b.productId, b.warehouseId FROM stock_balances b
          LEFT JOIN (SELECT productId, warehouseId, MAX(createdAt) AS lastMoveAt FROM stock_moves GROUP BY productId, warehouseId) m
            ON m.productId = b.productId AND m.warehouseId = b.warehouseId
          ${balanceFilter} GROUP BY b.productId, b.warehouseId
          HAVING SUM(b.onHand) > 0 AND (lastMoveAt IS NULL OR lastMoveAt < ?)
        ) slow_rows`, [...balanceParams, slowCutoff]);
      const numbers = (source: any) => Object.fromEntries(Object.entries(source || {}).map(([key, value]) => [key, Number(value) || 0]));
      res.json({ totals: { ...numbers(totals), ...numbers(inventory), slowCount: Number(slow?.count || 0) }, daily: (daily || []).map((row: any) => ({ ...row, inbound: Number(row.inbound) || 0, outbound: Number(row.outbound) || 0 })) });
    } catch { res.status(500).json({ error: 'Failed to fetch stock report summary' }); }
  });
  return router;
}
