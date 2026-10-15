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
      let filter = '';
      if (warehouseId) { filter = ' WHERE b.warehouseId = ?'; params.push(warehouseId); }
      else if (level < MANAGEMENT_LEVELS.DIRECTOR) { filter = ` WHERE b.warehouseId IN (${scope.map(() => '?').join(',')})`; params.push(...scope); }
      // One statement provides a consistent snapshot. Aggregate the whole ledger,
      // not the paginated activity feed; retain per-product units in the result.
      const rows = await db.all(`SELECT b.productId, b.warehouseId, p.name AS productName, p.unit,
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
        ${filter} ORDER BY w.name, p.name`, params);
      res.json(rows.map((row: any) => ({ ...row, ...Object.fromEntries(['opening', 'inbound', 'outbound', 'adjustment', 'closing'].map(key => [key, Number(row[key]) || 0])) })));
    } catch {
      res.status(500).json({ error: 'Failed to fetch stock report' });
    }
  });
  return router;
}
