import { Router } from 'express';
import { randomUUID } from 'crypto';
import { requireWarehouseView } from '../middleware/warehouseAuth.js';
import { canManageWarehouse } from '../middleware/warehouseAuth.js';

// Stock counts (B2, spec §19-20, §28): blind count + variance + adjustment.
// Flow: planned -> in_progress -> reconciling -> done.
// - Snapshot takes systemQty from balances (optionally scoped to a location).
// - NV sees systemQty ONLY when blindCount is off; otherwise *** until counted.
// - counted -> auto-moves count to reconciling when no pending lines remain.
// - TP approves variances (resolution required); close emits ADJUSTMENT moves
//   for approved nonzero variances. Stock is NEVER edited directly.

function canManageCounts(req: any): boolean {
  return canManageWarehouse(req, 'stock.manage');
}

function countCode(): string {
  const now = new Date();
  const ym = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `KK-${ym}-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 100)}`;
}

async function loadCountForWrite(db: any, id: string, req: any, res: any) {
  const count = await db.get(
    `SELECT c.*, w.code AS warehouseCode, w.name AS warehouseName,
            l.code AS locationCode, u.name AS assigneeName
     FROM stock_counts c
     JOIN warehouses w ON c.warehouseId = w.id
     LEFT JOIN warehouse_locations l ON c.locationId = l.id
     LEFT JOIN users u ON c.assigneeId = u.id
     WHERE c.id = ?`,
    [id]
  );
  if (!count) {
    res.status(404).json({ error: 'Stock count not found' });
    return null;
  }
  const userId = req.user?.id;
  const isManager = canManageCounts(req);
  const involved = count.createdBy === userId || count.assigneeId === userId;
  if (!isManager && !involved) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return { count, isManager, userId };
}

function sanitizeLine(row: any, hideSystem: boolean) {
  if (!hideSystem) return { ...row, systemQty: Number(row.systemQty), countedQty: row.countedQty === null ? null : Number(row.countedQty) };
  return {
    ...row,
    systemQty: row.status === 'pending' ? null : Number(row.systemQty),
    countedQty: row.countedQty === null ? null : Number(row.countedQty),
  };
}

export function warehouseCountsRoutes(db: any) {
  const router = Router();

  // ============================================================
  // GET /api/warehouse/counts?status=
  // ============================================================
  router.get('/counts', async (req, res) => {
    try {
      const user: any = req.user || {};
      const level = user.managementLevel ?? 10;
      if (level === 99) return res.json([]);
      const conditions: string[] = [];
      const params: any[] = [];
      const status = String(req.query.status || '');
      if (status) {
        conditions.push('c.status = ?');
        params.push(status);
      }
      if (level === 10) {
        conditions.push('(c.createdBy = ? OR c.assigneeId = ?)');
        params.push(user.id, user.id);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.all(
        `SELECT c.*, w.code AS warehouseCode, w.name AS warehouseName,
                l.code AS locationCode, u.name AS assigneeName,
                (SELECT COUNT(*) FROM stock_count_lines x WHERE x.countId = c.id) AS lineCount,
                (SELECT COUNT(*) FROM stock_count_lines x WHERE x.countId = c.id AND x.status = 'counted') AS countedCount,
                (SELECT COUNT(*) FROM stock_count_lines x
                 WHERE x.countId = c.id AND x.countedQty IS NOT NULL AND x.countedQty != x.systemQty
                   AND x.status != 'resolved') AS varianceCount
         FROM stock_counts c
         JOIN warehouses w ON c.warehouseId = w.id
         LEFT JOIN warehouse_locations l ON c.locationId = l.id
         LEFT JOIN users u ON c.assigneeId = u.id
         ${where}
         ORDER BY c.createdAt DESC`,
        params
      );
      res.json(rows);
    } catch (error) {
      console.error('Error fetching stock counts:', error);
      res.status(500).json({ error: 'Failed to fetch stock counts' });
    }
  });

  // POST /api/warehouse/counts - TP creates a count period
  router.post('/counts', async (req, res) => {
    try {
      if (!canManageCounts(req)) return res.status(403).json({ error: 'Forbidden' });
      const { warehouseId, locationId, blindCount = true, assigneeId, notes } = req.body;
      if (!warehouseId) return res.status(400).json({ error: 'warehouseId is required' });
      const warehouse = await db.get('SELECT id FROM warehouses WHERE id = ?', [warehouseId]);
      if (!warehouse) return res.status(400).json({ error: 'Warehouse not found' });
      if (locationId) {
        const loc = await db.get('SELECT id, warehouseId FROM warehouse_locations WHERE id = ?', [locationId]);
        if (!loc) return res.status(400).json({ error: 'Location not found' });
        if (loc.warehouseId !== warehouseId) {
          return res.status(400).json({ error: 'Location must belong to the warehouse' });
        }
      }
      if (assigneeId) {
        const assignee = await db.get('SELECT id FROM users WHERE id = ?', [assigneeId]);
        if (!assignee) return res.status(400).json({ error: 'Assignee not found' });
      }
      const id = randomUUID();
      await db.run(
        `INSERT INTO stock_counts
         (id, code, warehouseId, locationId, status, blindCount, assigneeId, notes, createdBy)
         VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?)`,
        [id, countCode(), warehouseId, locationId || null, blindCount ? 1 : 0,
         assigneeId || null, notes || null, (req as any).user?.id || null]
      );
      res.json({ id, success: true });
    } catch (error) {
      console.error('Error creating stock count:', error);
      res.status(500).json({ error: 'Failed to create stock count' });
    }
  });

  // GET /api/warehouse/counts/:id - detail + lines (blind enforced)
  router.get('/counts/:id', async (req, res) => {
    try {
      const loaded = await loadCountForWrite(db, req.params.id, req, res);
      if (!loaded) return;
      const { count, isManager } = loaded;
      const lines = await db.all(
        'SELECT * FROM stock_count_lines WHERE countId = ? ORDER BY productCode ASC',
        [count.id]
      );
      const hideSystem = !!count.blindCount && !isManager;
      res.json({
        ...count,
        lines: lines.map((l: any) => sanitizeLine(l, hideSystem)),
      });
    } catch (error) {
      console.error('Error fetching stock count:', error);
      res.status(500).json({ error: 'Failed to fetch stock count' });
    }
  });

  // PATCH /api/warehouse/counts/:id - transitions + reassign
  // planned->in_progress (TP/assignee); in_progress->planned recede (TP);
  // planned/in_progress->cancelled (TP/creator); reconciling->in_progress recount (TP).
  router.patch('/counts/:id', async (req, res) => {
    try {
      const loaded = await loadCountForWrite(db, req.params.id, req, res);
      if (!loaded) return;
      const { count, isManager, userId } = loaded;
      const { status, assigneeId } = req.body;

      if (assigneeId !== undefined) {
        if (!isManager) return res.status(403).json({ error: 'Only managers can reassign' });
        if (assigneeId !== null) {
          const assignee = await db.get('SELECT id FROM users WHERE id = ?', [assigneeId]);
          if (!assignee) return res.status(400).json({ error: 'Assignee not found' });
        }
        await db.run('UPDATE stock_counts SET assigneeId = ?, updatedAt = ? WHERE id = ?',
          [assigneeId, new Date().toISOString(), count.id]);
      }

      if (status !== undefined && status !== count.status) {
        const from = count.status;
        const to = status;
        let allowed = false;
        const creatorOrManager = isManager || count.createdBy === userId;
        const handler = isManager || count.assigneeId === userId || count.createdBy === userId;
        if (from === 'planned' && to === 'in_progress') allowed = handler;
        else if (from === 'planned' && to === 'cancelled') allowed = creatorOrManager;
        else if (from === 'in_progress' && to === 'planned') allowed = isManager;
        else if (from === 'in_progress' && to === 'cancelled') allowed = creatorOrManager;
        else if (from === 'reconciling' && to === 'in_progress') allowed = isManager;
        if (!allowed) {
          return res.status(400).json({ error: `Cannot transition ${from} -> ${to}` });
        }
        await db.run('UPDATE stock_counts SET status = ?, updatedAt = ? WHERE id = ?',
          [to, new Date().toISOString(), count.id]);
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating stock count:', error);
      res.status(500).json({ error: 'Failed to update stock count' });
    }
  });

  // POST /api/warehouse/counts/:id/snapshot - snapshot balances into lines
  router.post('/counts/:id/snapshot', async (req, res) => {
    try {
      const loaded = await loadCountForWrite(db, req.params.id, req, res);
      if (!loaded) return;
      const { count, isManager } = loaded;
      if (!isManager) return res.status(403).json({ error: 'Forbidden' });
      if (!['planned', 'in_progress'].includes(count.status)) {
        return res.status(400).json({ error: `Cannot snapshot a ${count.status} count` });
      }
      const existing: any = await db.get('SELECT COUNT(*) AS c FROM stock_count_lines WHERE countId = ?', [count.id]);
      if (Number(existing?.c || 0) > 0) {
        return res.status(400).json({ error: 'Snapshot already taken (lines exist)' });
      }
      const balances: any = await db.all(
        `SELECT b.productId, p.code AS productCode, p.name AS productName,
                COALESCE(SUM(b.onHand), 0) AS systemQty
         FROM stock_balances b
         JOIN stock_products p ON b.productId = p.id
         WHERE b.warehouseId = ?
         GROUP BY b.productId
         HAVING systemQty != 0`,
        [count.warehouseId]
      );
      // Optional location scope: restrict snapshot to products stored there
      let productIds: Set<string> | null = null;
      if (count.locationId) {
        const locBuckets: any = await db.all(
          `SELECT DISTINCT b.productId FROM stock_balances b
           JOIN warehouse_locations l ON b.locationId = l.id
           WHERE b.warehouseId = ? AND (l.id = ? OR l.parentId = ?)`,
          [count.warehouseId, count.locationId, count.locationId]
        );
        productIds = new Set(locBuckets.map((r: any) => r.productId));
      }
      let added = 0;
      for (const b of balances) {
        if (productIds && !productIds.has(b.productId)) continue;
        await db.run(
          `INSERT INTO stock_count_lines (id, countId, productId, productCode, productName, systemQty, status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
          [randomUUID(), count.id, b.productId, b.productCode, b.productName, Number(b.systemQty)]
        );
        added++;
      }
      if (count.status === 'planned') {
        await db.run(`UPDATE stock_counts SET status = 'in_progress', updatedAt = ? WHERE id = ?`,
          [new Date().toISOString(), count.id]);
      }
      res.json({ success: true, added });
    } catch (error) {
      console.error('Error snapshotting count:', error);
      res.status(500).json({ error: 'Failed to snapshot count' });
    }
  });

  // PATCH /counts/:id/lines/:lineId/count - NV records actual (assignee/creator/TP)
  router.patch('/counts/:id/lines/:lineId/count', async (req, res) => {
    try {
      const loaded = await loadCountForWrite(db, req.params.id, req, res);
      if (!loaded) return;
      const { count, isManager, userId } = loaded;
      if (count.status !== 'in_progress') {
        return res.status(400).json({ error: `Cannot count in a ${count.status} count` });
      }
      const isHandler = isManager || count.assigneeId === userId || count.createdBy === userId;
      if (!isHandler) return res.status(403).json({ error: 'Forbidden' });
      const line = await db.get('SELECT * FROM stock_count_lines WHERE id = ? AND countId = ?', [req.params.lineId, count.id]);
      if (!line) return res.status(404).json({ error: 'Line not found' });
      if (line.status === 'resolved') {
        return res.status(400).json({ error: 'Line already resolved' });
      }
      const { countedQty } = req.body;
      if (countedQty === undefined || countedQty === null || Number.isNaN(Number(countedQty)) || Number(countedQty) < 0) {
        return res.status(400).json({ error: 'countedQty must be a number >= 0' });
      }
      await db.run(
        `UPDATE stock_count_lines SET countedQty = ?, status = 'counted', updatedAt = ? WHERE id = ?`,
        [Number(countedQty), new Date().toISOString(), line.id]
      );
      // Auto-move to reconciling when nothing is pending anymore
      const pending: any = await db.get(
        `SELECT COUNT(*) AS c FROM stock_count_lines WHERE countId = ? AND status = 'pending'`,
        [count.id]
      );
      if (Number(pending?.c || 0) === 0) {
        await db.run(`UPDATE stock_counts SET status = 'reconciling', updatedAt = ? WHERE id = ?`,
          [new Date().toISOString(), count.id]);
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error recording count:', error);
      res.status(500).json({ error: 'Failed to record count' });
    }
  });

  // POST /counts/:id/lines/:lineId/recount - TP reopens a line
  router.post('/counts/:id/lines/:lineId/recount', async (req, res) => {
    try {
      const loaded = await loadCountForWrite(db, req.params.id, req, res);
      if (!loaded) return;
      const { count, isManager } = loaded;
      if (!isManager) return res.status(403).json({ error: 'Forbidden' });
      if (!['in_progress', 'reconciling'].includes(count.status)) {
        return res.status(400).json({ error: `Cannot recount in a ${count.status} count` });
      }
      const line = await db.get('SELECT * FROM stock_count_lines WHERE id = ? AND countId = ?', [req.params.lineId, count.id]);
      if (!line) return res.status(404).json({ error: 'Line not found' });
      await db.run(
        `UPDATE stock_count_lines SET countedQty = NULL, status = 'pending', updatedAt = ? WHERE id = ?`,
        [new Date().toISOString(), line.id]
      );
      if (count.status === 'reconciling') {
        await db.run(`UPDATE stock_counts SET status = 'in_progress', updatedAt = ? WHERE id = ?`,
          [new Date().toISOString(), count.id]);
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error reopening count line:', error);
      res.status(500).json({ error: 'Failed to reopen line' });
    }
  });

  router.post('/counts/:id/lines/:lineId/approve', async (req, res) => {
    try {
      const loaded = await loadCountForWrite(db, req.params.id, req, res);
      if (!loaded) return;
      const { count, isManager } = loaded;
      if (!isManager) return res.status(403).json({ error: 'Forbidden' });
      if (count.status !== 'reconciling') {
        return res.status(400).json({ error: `Can only approve variances in reconciling counts (current: ${count.status})` });
      }
      const line = await db.get('SELECT * FROM stock_count_lines WHERE id = ? AND countId = ?', [req.params.lineId, count.id]);
      if (!line) return res.status(404).json({ error: 'Line not found' });
      if (line.countedQty === null) {
        return res.status(400).json({ error: 'Line has not been counted yet' });
      }
      const { resolution } = req.body;
      if (!resolution || !String(resolution).trim()) {
        return res.status(400).json({ error: 'resolution is required' });
      }
      await db.run(
        `UPDATE stock_count_lines SET status = 'approved', resolution = ?, resolvedBy = ?, updatedAt = ? WHERE id = ?`,
        [String(resolution).trim(), (req as any).user?.id || null, new Date().toISOString(), line.id]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Error approving variance:', error);
      res.status(500).json({ error: 'Failed to approve variance' });
    }
  });

  // POST /counts/:id/close - TP closes; approved nonzero variances emit ADJUSTMENT
  router.post('/counts/:id/close', async (req, res) => {
    try {
      const loaded = await loadCountForWrite(db, req.params.id, req, res);
      if (!loaded) return;
      const { count, isManager, userId } = loaded;
      if (!isManager) return res.status(403).json({ error: 'Forbidden' });
      if (count.status !== 'reconciling') {
        return res.status(400).json({ error: `Only reconciling counts can be closed (current: ${count.status})` });
      }
      const lines: any = await db.all('SELECT * FROM stock_count_lines WHERE countId = ?', [count.id]);
      const uncounted = lines.filter((l: any) => l.countedQty === null);
      if (uncounted.length > 0) {
        return res.status(400).json({ error: `${uncounted.length} line(s) not counted yet` });
      }
      const openVariance = lines.filter((l: any) =>
        Number(l.countedQty) !== Number(l.systemQty) && l.status !== 'approved' && l.status !== 'resolved');
      if (openVariance.length > 0) {
        return res.status(400).json({
          error: `${openVariance.length} variance(s) not approved yet`,
          lines: openVariance.map((l: any) => l.id),
        });
      }
      const adjustments = lines.filter((l: any) =>
        l.status === 'approved' && Number(l.countedQty) !== Number(l.systemQty));
      const now = new Date().toISOString();
      await db.run('START TRANSACTION');
      try {
        let docId: string | null = null;
        if (adjustments.length > 0) {
          docId = randomUUID();
          const code = `DC-${now.slice(2, 4)}${now.slice(5, 7)}-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 100)}`;
          await db.run(
            `INSERT INTO stock_documents
             (id, code, type, status, sourceType, sourceId, warehouseId, requesterId, notes, createdBy)
             VALUES (?, ?, 'ADJUSTMENT', 'DONE', 'STOCK_COUNT', ?, ?, ?, ?, ?)`,
            [docId, code, count.id, count.warehouseId, userId,
             `Adjustment from count ${count.code}`, userId]
          );
        }
        for (const line of adjustments) {
          const variance = Number(line.countedQty) - Number(line.systemQty);
          const lineId = randomUUID();
          await db.run(
            `INSERT INTO stock_document_lines
             (id, docId, productId, productCode, productName, qtyOrdered, qtyReceived, unit, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [lineId, docId, line.productId, line.productCode, line.productName,
             Math.abs(variance), Math.abs(variance), 'pcs', line.resolution || null]
          );
          await db.run(
            `INSERT INTO stock_moves
             (id, productId, productCode, warehouseId, locationId, qty, moveType, docId, lineId, createdBy, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, 'ADJUSTMENT', ?, ?, ?, ?)`,
            [randomUUID(), line.productId, line.productCode, count.warehouseId, null,
             variance, docId, lineId, userId, now]
          );
          await db.run(
            `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
             VALUES (?, ?, '', ?, 0, ?)
             ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)`,
            [line.productId, count.warehouseId, variance, now]
          );
          await db.run(`UPDATE stock_count_lines SET status = 'resolved', updatedAt = ? WHERE id = ?`, [now, line.id]);
        }
        await db.run(`UPDATE stock_counts SET status = 'done', updatedAt = ? WHERE id = ?`, [now, count.id]);
        await db.run('COMMIT');
      } catch (txError) {
        await db.run('ROLLBACK');
        throw txError;
      }
      res.json({ success: true, adjustments: adjustments.length });
    } catch (error) {
      console.error('Error closing count:', error);
      res.status(500).json({ error: 'Failed to close count' });
    }
  });

  // ============================================================
  // GET /api/warehouse/count-variances - all unresolved variances (TP)
  // ============================================================
  router.get('/count-variances', requireWarehouseView(['stock.approve']), async (req, res) => {
    try {
      const onlyOpen = String(req.query.open || '') === '1';
      const rows = await db.all(
        `SELECT l.*, c.code AS countCode, c.status AS countStatus,
                w.code AS warehouseCode, w.name AS warehouseName,
                u.name AS counterName,
                (l.countedQty - l.systemQty) AS variance
         FROM stock_count_lines l
         JOIN stock_counts c ON l.countId = c.id
         JOIN warehouses w ON c.warehouseId = w.id
         LEFT JOIN users u ON l.resolvedBy = u.id
         WHERE l.countedQty IS NOT NULL AND l.countedQty != l.systemQty
           ${onlyOpen ? "AND l.status NOT IN ('approved', 'resolved')" : ''}
         ORDER BY ABS(l.countedQty - l.systemQty) DESC
         LIMIT 500`
      );
      res.json(rows.map((r: any) => ({
        ...r,
        systemQty: Number(r.systemQty), countedQty: Number(r.countedQty), variance: Number(r.variance),
      })));
    } catch (error) {
      console.error('Error fetching count variances:', error);
      res.status(500).json({ error: 'Failed to fetch count variances' });
    }
  });

  return router;
}
