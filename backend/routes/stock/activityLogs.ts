import { Router } from 'express';
import type { StockContext } from './context.js';

/** Nhật ký nghiệp vụ kho vận. Chỉ đọc; scope kho được áp dụng ở backend. */
export function activityLogsRoutes(ctx: StockContext) {
  const { db, listScope, isDirector, paginationOf } = ctx;
  const router = Router();

  router.get('/activity-logs', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { limit, offset } = paginationOf(req.query as Record<string, string | undefined>);
      const q = String(req.query.q || '').trim();
      const actionType = String(req.query.actionType || '').trim();
      const entityType = String(req.query.entityType || '').trim();
      const documentId = String(req.query.documentId || '').trim();
      const warehouseId = String(req.query.warehouseId || '').trim();
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      const params: any[] = [];
      const where: string[] = ['1=1'];

      if (!isDirector(user)) {
        if (scope.length === 0) return res.json({ rows: [], total: 0, limit, offset });
        const marks = scope.map(() => '?').join(',');
        where.push(`(a.warehouseId IN (${marks}) OR d.warehouseId IN (${marks}) OR d.sourceWarehouseId IN (${marks}) OR d.destWarehouseId IN (${marks}))`);
        params.push(...scope, ...scope, ...scope, ...scope);
      }
      if (warehouseId) {
        where.push('(a.warehouseId = ? OR d.warehouseId = ? OR d.sourceWarehouseId = ? OR d.destWarehouseId = ?)');
        params.push(warehouseId, warehouseId, warehouseId, warehouseId);
      }
      if (actionType) { where.push('a.actionType = ?'); params.push(actionType); }
      if (entityType) { where.push('a.entityType = ?'); params.push(entityType); }
      if (documentId) { where.push('a.documentId = ?'); params.push(documentId); }
      if (from) { where.push('a.createdAt >= ?'); params.push(`${from} 00:00:00`); }
      if (to) { where.push('a.createdAt < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(`${to} 00:00:00`); }
      if (q) {
        where.push('(a.documentCode LIKE ? OR a.entityId LIKE ? OR a.productId LIKE ? OR a.serialId LIKE ? OR a.lotId LIKE ? OR u.name LIKE ? OR p.name LIKE ?)');
        const needle = `%${q}%`;
        params.push(needle, needle, needle, needle, needle, needle, needle);
      }

      const base = `FROM warehouse_activity_logs a
        LEFT JOIN stock_documents d ON d.id = a.documentId
        LEFT JOIN users u ON u.id = a.userId
        LEFT JOIN products p ON p.id = a.productId
        LEFT JOIN warehouses w ON w.id = a.warehouseId
        WHERE ${where.join(' AND ')}`;
      const countRows = await db.all(`SELECT COUNT(*) AS total ${base}`, params);
      const rows = await db.all(
        `SELECT a.*, u.name AS userName, p.name AS productName, w.name AS warehouseName
         ${base} ORDER BY a.createdAt DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const parse = (value: unknown) => {
        if (value === null || value === undefined || value === '') return null;
        try { return JSON.parse(String(value)); } catch { return value; }
      };
      res.json({
        rows: (rows || []).map((row: any) => ({ ...row, oldData: parse(row.oldData), newData: parse(row.newData), metadata: parse(row.metadata) })),
        total: Number(countRows?.[0]?.total || 0), limit, offset,
      });
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch warehouse activity logs' });
    }
  });

  return router;
}
