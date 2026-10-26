import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import type { StockContext } from './context.js';

export function misaRoutes(ctx: StockContext) {
  const { db, scopeOf, isDirector, requireWarehouseManager, paginationOf, recordWarehouseActivity } = ctx;
  const router = Router();
  const MISA_ENTITY_TYPES = [
    'PRODUCT_ITEM', 'PRODUCT_INVENTORY_ACCOUNT', 'PARTNER_PAYABLE_ACCOUNT',
    'WAREHOUSE', 'PROJECT', 'DOCUMENT',
  ] as const;
  // ── MISA: mapping + nhật ký (§35 — quản trị chủ động, sync thật để sau) ──────

  router.get('/misa-mappings', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
      const { entityType } = req.query as Record<string, string | undefined>;
      let query = 'SELECT * FROM misa_mappings WHERE 1=1';
      const params: any[] = [];
      if (entityType?.trim()) { query += ' AND entityType = ?'; params.push(entityType.trim()); }
      query += ' ORDER BY entityType ASC, misaCode ASC';
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch MISA mappings' }); }
  });

  const MisaMappingSchema = z.object({
    entityType: z.enum(MISA_ENTITY_TYPES),
    entityId: z.string().trim().min(1).max(191),
    misaCode: z.string().trim().min(1).max(191),
    misaName: z.string().trim().max(255).nullable().optional(),
  });

  router.post('/misa-mappings', validate(MisaMappingSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage MISA mappings' });
      const { entityType, entityId, misaCode, misaName } = req.body;
      const now = new Date().toISOString();
      let transactionOpen = false;
      try {
        // Mapping và Audit Log là một thay đổi nghiệp vụ duy nhất. Không dùng
        // beginStockTransaction vì đây là cấu hình toàn cục, không được khóa
        // toàn bộ kho chỉ để ghi một mapping.
        await db.run('START TRANSACTION');
        transactionOpen = true;
        await db.run(
          'INSERT INTO misa_mappings (id, entityType, entityId, misaCode, misaName, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [randomUUID(), entityType, entityId, misaCode.trim(), misaName?.trim() || null, user.id, now]
        );
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'MISA_MAPPING_CREATED', entityType: 'MISA_MAPPING', entityId,
          userId: user.id, newData: { entityType, entityId, misaCode: misaCode.trim(), misaName: misaName?.trim() || null },
        });
        await db.run('COMMIT');
        transactionOpen = false;
      } catch (e: any) {
        if (transactionOpen) await db.run('ROLLBACK').catch(() => undefined);
        if (e.message?.includes('Duplicate')) return res.status(409).json({ error: 'Mapping already exists for this entity' });
        throw e;
      }
      res.status(201).json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to create MISA mapping' }); }
  });

  router.delete('/misa-mappings/:id', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage MISA mappings' });
      const id = String(req.params.id || '').trim();
      if (!id || id.length > 191) return res.status(400).json({ error: 'Invalid mapping id' });
      let transactionOpen = false;
      try {
        await db.run('START TRANSACTION');
        transactionOpen = true;
        const mapping = await db.get('SELECT * FROM misa_mappings WHERE id = ?', [id]);
        if (!mapping) {
          await db.run('ROLLBACK');
          transactionOpen = false;
          return res.status(404).json({ error: 'Mapping not found' });
        }
        // Mapping là cấu hình toàn cục (không gắn kho) nên mọi TP kho đều được
        // quản lý; chỉ chặn id rác để tránh xóa nhầm.
        const result = await db.run('DELETE FROM misa_mappings WHERE id = ?', [id]);
        if (result && Number(result.changes) === 0) {
          await db.run('ROLLBACK');
          transactionOpen = false;
          return res.status(404).json({ error: 'Mapping not found' });
        }
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'MISA_MAPPING_DELETED', entityType: 'MISA_MAPPING', entityId: id,
          userId: user.id, oldData: mapping,
        });
        await db.run('COMMIT');
        transactionOpen = false;
      } catch (e) {
        if (transactionOpen) await db.run('ROLLBACK').catch(() => undefined);
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to delete MISA mapping' }); }
  });

  router.get('/misa-logs', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
      const { status, entityType } = req.query as Record<string, string | undefined>;
      let where = 'FROM misa_sync_logs WHERE 1=1';
      const params: any[] = [];
      if (status?.trim()) { where += ' AND status = ?'; params.push(status.trim()); }
      if (entityType?.trim()) { where += ' AND entityType = ?'; params.push(entityType.trim()); }
      // Trước đây cố định LIMIT 200 nên không thể xem log cũ hơn; giờ phân trang
      // như các list endpoint khác và báo tổng qua header vì body là mảng trần.
      const totalRow = await db.get(`SELECT COUNT(*) AS total ${where}`, params);
      const page = paginationOf(req.query as Record<string, string | undefined>);
      res.setHeader('X-Total-Count', String(Number(totalRow?.total || 0)));
      res.json(await db.all(`SELECT * ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [...params, page.limit, page.offset]));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch MISA sync logs' }); }
  });

  // Hàng đợi nội bộ để chuẩn bị sync. Chưa gọi API MISA và không coi việc
  // tạo queue là đã đồng bộ thành công.
  router.get('/misa-sync/queue', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
      const scope = await scopeOf(user);
      const { status, warehouseId } = req.query as Record<string, string | undefined>;
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const where: string[] = ["l.direction = 'PUSH'"];
      const params: any[] = [];
      if (status?.trim()) { where.push('l.status = ?'); params.push(status.trim()); }
      if (!isDirector(user)) {
        if (scope.length === 0) return res.json({ rows: [], total: 0, limit, offset });
        where.push(`JSON_UNQUOTE(JSON_EXTRACT(l.payload, '$.document.warehouseId')) IN (${scope.map(() => '?').join(',')})`);
        params.push(...scope);
      }
      if (warehouseId?.trim()) {
        if (!isDirector(user) && !scope.includes(warehouseId.trim())) return res.status(403).json({ error: 'Warehouse outside your scope' });
        where.push("JSON_UNQUOTE(JSON_EXTRACT(l.payload, '$.document.warehouseId')) = ?"); params.push(warehouseId.trim());
      }
      const base = `FROM misa_sync_logs l WHERE ${where.join(' AND ')}`;
      const total = await db.get(`SELECT COUNT(*) AS total ${base}`, params);
      const rows = await db.all(`SELECT l.* FROM misa_sync_logs l WHERE ${where.join(' AND ')} ORDER BY l.createdAt DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      res.json({ rows: (rows || []).map((row: any) => ({ ...row, payload: (() => { try { return JSON.parse(row.payload || 'null'); } catch { return row.payload; } })() })), total: Number(total?.total || 0), limit, offset });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch MISA sync queue' }); }
  });

  router.post('/misa-sync/prepare', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
      const scope = await scopeOf(user);
      const requestedIds = Array.isArray(req.body?.documentIds) ? req.body.documentIds.map(String).filter(Boolean).slice(0, 500) : [];
      const warehouseId = typeof req.body?.warehouseId === 'string' ? req.body.warehouseId.trim() : '';
      if (!isDirector(user) && warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const conditions = ["d.status = 'DONE'"];
      const params: any[] = [];
      if (requestedIds.length) { conditions.push(`d.id IN (${requestedIds.map(() => '?').join(',')})`); params.push(...requestedIds); }
      if (warehouseId) { conditions.push('(d.warehouseId = ? OR d.sourceWarehouseId = ? OR d.destWarehouseId = ?)'); params.push(warehouseId, warehouseId, warehouseId); }
      else if (!isDirector(user)) {
        if (!scope.length) return res.json({ prepared: 0, skipped: 0 });
        conditions.push(`(d.warehouseId IN (${scope.map(() => '?').join(',')}) OR d.sourceWarehouseId IN (${scope.map(() => '?').join(',')}) OR d.destWarehouseId IN (${scope.map(() => '?').join(',')}))`);
        params.push(...scope, ...scope, ...scope);
      }
      const docs = await db.all(`SELECT d.* FROM stock_documents d WHERE ${conditions.join(' AND ')} ORDER BY d.updatedAt DESC LIMIT 500`, params);
      let prepared = 0; let skipped = 0;
      for (const doc of docs || []) {
        const lines = await db.all('SELECT productId, quantity, unitPrice, vatRate, vatAmount, totalAmount, projectId, accountDebit, accountCredit FROM stock_document_lines WHERE documentId = ?', [doc.id]);
        const payload = JSON.stringify({ schemaVersion: 1, preparedAt: new Date().toISOString(), document: {
          id: doc.id, code: doc.code, docType: doc.docType, status: doc.status, warehouseId: doc.warehouseId,
          sourceWarehouseId: doc.sourceWarehouseId, destWarehouseId: doc.destWarehouseId, partnerCode: doc.partnerCode,
          partnerName: doc.partnerName, postingDate: doc.postingDate, docDate: doc.docDate, totalPreTax: doc.totalPreTax,
          vatAmount: doc.vatAmount, totalAmount: doc.totalAmount,
        }, lines });
        const key = `stock-document:${doc.id}:v1`;
        const result = await db.run(
          `INSERT IGNORE INTO misa_sync_logs (id, direction, entityType, entityId, idempotencyKey, status, payload, error, createdAt, finishedAt)
           VALUES (?, 'PUSH', 'stock_document', ?, ?, 'PENDING', ?, NULL, ?, NULL)`,
          [randomUUID(), doc.id, key, payload, new Date().toISOString()]
        );
        if (Number(result?.changes || result?.affectedRows || 0) > 0) prepared += 1; else skipped += 1;
      }
      res.status(201).json({ prepared, skipped, message: 'Đã tạo hàng đợi nội bộ; chưa gửi dữ liệu sang MISA.' });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to prepare MISA sync queue' }); }
  });

  router.get('/misa-reconcile', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
      const { warehouseId } = req.query as Record<string, string | undefined>;
      const scope = await scopeOf(user);
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
      }

      let query = `
        SELECT 
          p.id AS productId,
          p.name AS productName,
          p.unit AS unit,
          p.category AS category,
          p.importPrice AS importPrice,
          p.defaultPrice AS defaultPrice,
          w.id AS warehouseId,
          w.code AS warehouseCode,
          w.name AS warehouseName,
          COALESCE(SUM(b.onHand), 0) AS onHand,
          COALESCE(SUM(b.reserved), 0) AS reserved,
          COALESCE(SUM(CASE WHEN b.locationId = '' OR (l.isActive = 1 AND l.purpose = 'SALEABLE') THEN b.onHand - b.reserved ELSE 0 END), 0) AS available,
          mm.misaCode AS misaCode,
          mm.misaName AS misaName
        FROM products p
        LEFT JOIN misa_mappings mm ON mm.entityType = 'PRODUCT_ITEM' AND mm.entityId = p.id
        LEFT JOIN stock_balances b ON b.productId = p.id
        LEFT JOIN warehouses w ON w.id = b.warehouseId
        LEFT JOIN stock_locations l ON l.id = b.locationId
        WHERE (w.isActive = 1 OR w.id IS NULL)
      `;
      const params: any[] = [];
      if (warehouseId?.trim()) {
        query += ' AND (w.id = ? OR (w.id IS NULL AND mm.misaCode IS NOT NULL))';
        params.push(warehouseId.trim());
      } else if (!isDirector(user) && scope.length > 0) {
        query += ` AND (w.id IN (${scope.map(() => '?').join(', ')}) OR (w.id IS NULL AND mm.misaCode IS NOT NULL))`;
        params.push(...scope);
      }
      query += `
        GROUP BY p.id, p.name, p.unit, p.category, p.importPrice, p.defaultPrice, w.id, w.code, w.name, mm.misaCode, mm.misaName
        HAVING onHand != 0 OR reserved != 0 OR mm.misaCode IS NOT NULL
        ORDER BY w.name ASC, p.name ASC
        LIMIT 1000
      `;

      res.json(await db.all(query, params));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch MISA reconciliation data' });
    }
  });

  router.post('/misa-reconcile/log', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
      const { itemsCount, matchedCount, mismatchedCount, unmappedCount, notes, warehouseId } = req.body || {};
      const now = new Date().toISOString();
      const idempotencyKey = `reconcile-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const payload = JSON.stringify({
        warehouseId: warehouseId || 'ALL',
        itemsCount: Number(itemsCount || 0),
        matchedCount: Number(matchedCount || 0),
        mismatchedCount: Number(mismatchedCount || 0),
        unmappedCount: Number(unmappedCount || 0),
        notes: notes || '',
        reconciledBy: user.name || user.id,
      });
      const status = Number(mismatchedCount || 0) > 0 ? 'DISCREPANCY' : 'MATCHED';
      await db.run(
        'INSERT INTO misa_sync_logs (id, direction, entityType, entityId, idempotencyKey, status, payload, error, createdAt, finishedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), 'RECONCILE', 'stock_balance', warehouseId || 'ALL', idempotencyKey, status, payload, null, now, now]
      );
      res.status(201).json({ success: true, idempotencyKey });
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to log MISA reconciliation' });
    }
  });
  return router;
}
