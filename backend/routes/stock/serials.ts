import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import { getWarrantyStartType, resolveWarrantyStart, warrantyEndDate } from '../../utils/warranty.js';
import type { StockContext } from './context.js';

export function serialsRoutes(ctx: StockContext) {
  const { db, listScope, isDirector, requireWarehouse, requireWarehouseManager, assertLocation, recordWarehouseActivity, paginationOf } = ctx;
  const router = Router();
  // ── Serial / Lô Phase B (§22: đăng ký + truy vết cơ bản) ──────────────────────

  const SERIAL_STATUSES = ['SALEABLE', 'WARRANTY', 'DAMAGED', 'DEMO', 'QUARANTINE', 'SOLD'];

  router.get('/serials', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { q, status, warehouseId, productId } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT x.* FROM (
        SELECT 'SERIAL' AS recordType, s.id, s.productId, s.serialNumber, s.lotCode,
          s.warehouseId, s.locationId, s.status, s.stockStatus, s.supplier, s.receiptId,
          s.receiptDocumentId, s.receiptLineId, s.issueDocumentId, s.issueLineId,
          s.customerName, s.projectId, s.warrantyStart, s.warrantyMonths, s.notes,
          s.createdAt, s.updatedAt, p.name AS productName, p.unit, w.name AS warehouseName,
          NULL AS initialQty, NULL AS remainingQty
        FROM stock_serials s LEFT JOIN products p ON p.id = s.productId LEFT JOIN warehouses w ON w.id = s.warehouseId
        UNION ALL
        SELECT 'LOT' AS recordType, l.id, l.productId, NULL AS serialNumber, l.lotCode,
          l.warehouseId, l.locationId, l.status, CASE WHEN l.remainingQty > 0 THEN 'IN_STOCK' ELSE 'OUT' END AS stockStatus,
          l.supplier, NULL AS receiptId, l.receiptDocumentId, l.receiptLineId, NULL AS issueDocumentId, NULL AS issueLineId,
          NULL AS customerName, NULL AS projectId, NULL AS warrantyStart, 0 AS warrantyMonths, NULL AS notes,
          l.createdAt, l.updatedAt, p.name AS productName, l.unit, w.name AS warehouseName,
          l.initialQty, l.remainingQty
        FROM stock_lots l LEFT JOIN products p ON p.id = l.productId LEFT JOIN warehouses w ON w.id = l.warehouseId
      ) x WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND x.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND x.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      if (status?.trim()) { query += ' AND x.status = ?'; params.push(status.trim()); }
      if (productId?.trim()) { query += ' AND x.productId = ?'; params.push(productId.trim()); }
      if (q?.trim()) { query += ' AND (x.serialNumber LIKE ? OR x.lotCode LIKE ? OR x.productName LIKE ? OR x.productId LIKE ?)'; params.push(`%${q.trim()}%`, `%${q.trim()}%`, `%${q.trim()}%`, `%${q.trim()}%`); }
      query += ' ORDER BY x.createdAt DESC';
      const serialPage = paginationOf(req.query as Record<string, string | undefined>);
      query += ' LIMIT ? OFFSET ?';
      params.push(serialPage.limit, serialPage.offset);
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch serials' }); }
  });

  const SerialSchema = z.object({
    productId: z.string().trim().min(1).max(191),
    serialNumber: z.string().trim().max(191).nullable().optional(),
    lotCode: z.string().trim().max(191).nullable().optional(),
    warehouseId: z.string().trim().min(1).max(191),
    locationId: z.string().trim().max(191).nullable().optional(),
    status: z.enum(['SALEABLE', 'WARRANTY', 'DAMAGED', 'DEMO', 'QUARANTINE', 'SOLD']).optional(),
    supplier: z.string().max(300).nullable().optional(),
    receiptId: z.string().max(191).nullable().optional(),
    receiptDocumentId: z.string().max(191).nullable().optional(),
    customerName: z.string().max(300).nullable().optional(),
    projectId: z.string().max(191).nullable().optional(),
    warrantyStart: z.string().max(40).nullable().optional(),
    warrantyMonths: z.number().int().min(0).max(1200).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
  });

  router.post('/serials', validate(SerialSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const { productId, serialNumber, lotCode, warehouseId, locationId, status, supplier, receiptId, receiptDocumentId, customerName, projectId, warrantyStart, warrantyMonths, notes } = req.body;
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Chỉ quản lý kho mới được bổ sung Serial/Lô lịch sử' });
      if (!receiptDocumentId) return res.status(409).json({ error: 'Serial/Lô phải được đăng ký từ phiếu nhập đã hoàn tất; không được tạo rời khỏi chứng từ' });
      if (!serialNumber?.trim()) {
        return res.status(400).json({ error: 'Bổ sung lịch sử tại đây chỉ áp dụng cho Serial; Lô phải được tạo từ luồng xử lý phiếu' });
      }
      const access = await requireWarehouse(user, warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const receipt = await db.get('SELECT id, docType, status, warehouseId FROM stock_documents WHERE id = ?', [receiptDocumentId]);
      if (!receipt || !['RECEIPT', 'RETURN'].includes(receipt.docType) || receipt.status !== 'DONE' || receipt.warehouseId !== warehouseId) {
        return res.status(400).json({ error: 'Chỉ được bổ sung Serial/Lô cho phiếu nhập/trả hàng đã hoàn tất cùng kho' });
      }
      const product = await db.get('SELECT id FROM products WHERE id = ?', [productId]);
      if (!product) return res.status(400).json({ error: `Unknown product: ${productId}` });
      const receiptLine = await db.get('SELECT id, quantity FROM stock_document_lines WHERE documentId = ? AND productId = ? LIMIT 1', [receiptDocumentId, productId]);
      if (!receiptLine) return res.status(400).json({ error: 'Sản phẩm không có trong phiếu nhập/trả hàng đã chọn' });
      const registered = await db.get(
        'SELECT COUNT(*) AS count FROM stock_serials WHERE receiptLineId = ? AND serialNumber IS NOT NULL',
        [receiptLine.id]
      ).catch(() => ({ count: 0 }));
      if (Number(registered?.count || 0) >= Number(receiptLine.quantity || 0)) {
        return res.status(409).json({ error: 'Dòng hàng trên phiếu đã đủ Serial; không thể bổ sung thêm' });
      }
      if (!(await assertLocation(warehouseId, locationId ?? null))) {
        return res.status(400).json({ error: 'Invalid location for this warehouse' });
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      await beginStockTransaction(db);
      try {
        await db.run(
          `INSERT INTO stock_serials (id, productId, serialNumber, lotCode, warehouseId, locationId, status, supplier, receiptId, receiptDocumentId, receiptLineId, customerName, projectId, warrantyStart, warrantyMonths, notes, createdBy, createdAt, updatedAt, stockStatus)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_STOCK')`,
          [id, productId, serialNumber?.trim() || null, lotCode?.trim() || null, warehouseId, locationId || null,
            status || 'SALEABLE', supplier ?? null, receiptId ?? receiptDocumentId, receiptDocumentId, receiptLine.id,
            customerName ?? null, projectId ?? null, warrantyStart ?? null, warrantyMonths ?? 0, notes ?? null, user.id, now, now]
        );
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'SERIAL_BACKFILLED', entityType: 'SERIAL', entityId: id,
          serialId: id, documentId: receiptDocumentId,
          productId, warehouseId, userId: user.id,
          metadata: { source: 'completed_receipt', receiptLineId: receiptLine.id, historicalEntry: true },
        });
        await db.run('COMMIT');
      } catch (e: any) {
        await db.run('ROLLBACK');
        if (e.message?.includes('Duplicate')) return res.status(409).json({ error: 'Serial number already registered' });
        throw e;
      }
      res.status(201).json({ id });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to register serial' }); }
  });

  router.put('/serials/:id', validate(SerialSchema.partial()), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const existing = await db.get('SELECT * FROM stock_serials WHERE id = ?', [String(req.params.id)]);
      if (!existing) return res.status(404).json({ error: 'Serial not found' });
      const access = await requireWarehouse(user, existing.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const { status, locationId, customerName, projectId, warrantyStart, warrantyMonths, notes, supplier } = req.body;
      // Đổi trạng thái cần TP+ (NV chỉ quét/xem) — kho đổi bằng luồng điều chuyển.
      if (status !== undefined && status !== existing.status
        && normalizeManagementLevel(user.managementLevel) < MANAGEMENT_LEVELS.MANAGER) {
        return res.status(403).json({ error: 'Only warehouse managers can change serial status' });
      }
      if (locationId !== undefined && locationId !== existing.locationId
        && normalizeManagementLevel(user.managementLevel) < MANAGEMENT_LEVELS.MANAGER) {
        return res.status(403).json({ error: 'Chỉ quản lý kho mới được đổi vị trí Serial trực tiếp; hãy dùng phiếu điều chuyển' });
      }
      if (locationId !== undefined && locationId !== existing.locationId
        && !(await assertLocation(existing.warehouseId, locationId || null))) {
        return res.status(400).json({ error: 'Invalid location for this warehouse' });
      }
      await beginStockTransaction(db);
      try {
        await db.run(
          `UPDATE stock_serials SET status = ?, locationId = ?, customerName = ?, projectId = ?,
            warrantyStart = ?, warrantyMonths = ?, notes = ?, supplier = ?, updatedAt = ? WHERE id = ?`,
          [status || existing.status, locationId !== undefined ? (locationId || null) : existing.locationId,
            customerName !== undefined ? (customerName || null) : existing.customerName,
            projectId !== undefined ? (projectId || null) : existing.projectId,
            warrantyStart !== undefined ? (warrantyStart || null) : existing.warrantyStart,
            warrantyMonths ?? existing.warrantyMonths, notes !== undefined ? (notes || null) : existing.notes,
            supplier !== undefined ? (supplier || null) : existing.supplier,
            new Date().toISOString(), existing.id]
        );
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'SERIAL_UPDATED', entityType: 'SERIAL', entityId: existing.id,
          serialId: existing.id, productId: existing.productId, warehouseId: existing.warehouseId,
          userId: user.id,
          oldData: { status: existing.status, locationId: existing.locationId, customerName: existing.customerName, projectId: existing.projectId },
          newData: { status: status ?? existing.status, locationId: locationId !== undefined ? locationId : existing.locationId, customerName: customerName ?? existing.customerName, projectId: projectId ?? existing.projectId },
        });
        await db.run('COMMIT');
      } catch (error) {
        await db.run('ROLLBACK');
        throw error;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to update serial' }); }
  });

  router.delete('/serials/:id', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Chỉ quản lý kho mới được xóa Serial' });
    try {
      const existing = await db.get('SELECT * FROM stock_serials WHERE id = ?', [String(req.params.id)]);
      if (!existing) return res.status(404).json({ error: 'Không tìm thấy Serial' });
      const access = await requireWarehouse(user, existing.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (existing.receiptDocumentId || existing.issueDocumentId || existing.stockStatus === 'OUT' || existing.stockStatus === 'RESERVED') {
        return res.status(409).json({ error: 'Không thể xóa Serial đã liên kết chứng từ hoặc đã phát sinh xuất/giữ hàng' });
      }
      const move = await db.get('SELECT id FROM stock_moves WHERE serialId = ? LIMIT 1', [existing.id]);
      if (move) return res.status(409).json({ error: 'Không thể xóa Serial đã có lịch sử biến động kho' });
      await beginStockTransaction(db);
      try {
        await db.run('DELETE FROM stock_serials WHERE id = ?', [existing.id]);
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'SERIAL_DELETED', entityType: 'SERIAL', entityId: existing.id,
          serialId: existing.id, productId: existing.productId, warehouseId: existing.warehouseId,
          userId: user.id, oldData: { serialNumber: existing.serialNumber, lotCode: existing.lotCode, status: existing.status },
        });
        await db.run('COMMIT');
      } catch (error) {
        await db.run('ROLLBACK');
        throw error;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Không thể xóa Serial' }); }
  });

  // ── Vòng đời Serial: tra 1 mã ra toàn bộ SP → nhập → kho → xuất → KH → BH ──
  // Quan hệ PNK↔PXK suy từ serial (không lưu cứng ở header phiếu).
  router.get('/serials/timeline/:serialNumber', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const serialNumber = String(req.params.serialNumber || '').trim();
      if (!serialNumber) return res.status(400).json({ error: 'Serial number is required' });
      const s = await db.get(
        `SELECT s.*, p.name AS productName, p.unit AS unit, p.tracking AS tracking,
                w.name AS warehouseName
         FROM stock_serials s
         LEFT JOIN products p ON p.id = s.productId
         LEFT JOIN warehouses w ON w.id = s.warehouseId
         WHERE s.serialNumber = ?`,
        [serialNumber]
      );
      if (!s) return res.status(404).json({ error: 'Không tìm thấy Serial trong hệ thống' });
      const access = await requireWarehouse(user, s.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });

      const receipt = s.receiptDocumentId
        ? await db.get(
          `SELECT d.id, d.code, d.docDate, d.postingDate, d.partnerName, d.warehouseId, w.name AS warehouseName
           FROM stock_documents d LEFT JOIN warehouses w ON w.id = d.warehouseId
           WHERE d.id = ?`, [s.receiptDocumentId]
        ).catch(() => null)
        : null;
      const issue = s.issueDocumentId
        ? await db.get(
          `SELECT d.id, d.code, d.docDate, d.postingDate, d.partnerName, d.deliveryDate, d.installationDate, d.acceptanceDate, d.customerName, d.projectId, d.warehouseId, w.name AS warehouseName
           FROM stock_documents d LEFT JOIN warehouses w ON w.id = d.warehouseId
           WHERE d.id = ?`, [s.issueDocumentId]
        ).catch(() => null)
        : null;
      const moves = await db.all(
        `SELECT m.id, m.quantity, m.moveType, m.referenceType, m.referenceId, m.warehouseId, w.name AS warehouseName, m.createdBy, m.createdAt
         FROM stock_moves m LEFT JOIN warehouses w ON w.id = m.warehouseId
         WHERE m.serialId = ? OR (m.referenceType IN ('RECEIPT', 'ISSUE', 'TRANSFER', 'RESERVATION', 'KIT', 'COUNT')
           AND (m.referenceId = ? OR m.referenceId = ?))
         ORDER BY m.createdAt ASC LIMIT 200`,
        [s.id, s.receiptDocumentId || '', s.issueDocumentId || '']
      ).catch(() => []);

      const startType = await getWarrantyStartType(db);
      const outDate = s.outDate || issue?.postingDate || issue?.docDate || null;
      const warrantyStart = s.warrantyStart
        || resolveWarrantyStart({
          startType,
          outboundDate: outDate,
          deliveryDate: issue?.deliveryDate,
          installationDate: issue?.installationDate,
          acceptanceDate: issue?.acceptanceDate,
          fallbackDate: s.receivedAt || s.createdAt,
        });
      const months = Number(s.warrantyMonths) || 0;
      const warrantyEnd = warrantyEndDate(warrantyStart, months);

      res.json({
        serial: {
          id: s.id, serialNumber: s.serialNumber, productId: s.productId,
          productName: s.productName, unit: s.unit, tracking: s.tracking,
          warehouseId: s.warehouseId, warehouseName: s.warehouseName,
          status: s.status, stockStatus: s.stockStatus || 'IN_STOCK',
          supplier: s.supplier, customerName: s.customerName, projectId: s.projectId,
          receivedAt: s.receivedAt, outDate: s.outDate,
        },
        receipt: receipt ? {
          documentId: receipt.id, code: receipt.code,
          date: receipt.postingDate || receipt.docDate,
          supplier: s.supplier || receipt.partnerName,
          warehouseId: receipt.warehouseId, warehouseName: receipt.warehouseName,
        } : null,
        issue: issue ? {
          documentId: issue.id, code: issue.code,
          date: issue.postingDate || issue.docDate,
          customerName: s.customerName || issue.partnerName,
          projectId: s.projectId || issue.projectId,
          warehouseId: issue.warehouseId, warehouseName: issue.warehouseName,
        } : null,
        warranty: {
          startType, start: warrantyStart, months,
          end: warrantyEnd,
          daysLeft: warrantyEnd ? Math.ceil((Date.parse(warrantyEnd) - Date.now()) / 86400000) : null,
        },
        moves: moves || [],
      });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch serial timeline' }); }
  });

  // Lô quản lý theo số lượng, nên vòng đời hiển thị phiếu nhập và các lần phân bổ/xuất của chính lô đó.
  router.get('/lots/timeline/:lotId', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const lotId = String(req.params.lotId || '').trim();
      if (!lotId) return res.status(400).json({ error: 'Lot id is required' });
      const lot = await db.get(
        `SELECT l.*, p.name AS productName, p.tracking, w.name AS warehouseName
         FROM stock_lots l
         LEFT JOIN products p ON p.id = l.productId
         LEFT JOIN warehouses w ON w.id = l.warehouseId
         WHERE l.id = ?`,
        [lotId]
      );
      if (!lot) return res.status(404).json({ error: 'Không tìm thấy Lô trong hệ thống' });
      const access = await requireWarehouse(user, lot.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const receipt = lot.receiptDocumentId
        ? await db.get(
          `SELECT d.id, d.code, d.docDate, d.postingDate, d.partnerName, d.warehouseId, w.name AS warehouseName
           FROM stock_documents d LEFT JOIN warehouses w ON w.id = d.warehouseId WHERE d.id = ?`,
          [lot.receiptDocumentId]
        ).catch(() => null)
        : null;
      const moves = await db.all(
        `SELECT m.id, m.quantity, m.moveType, m.referenceType, m.referenceId, m.documentLineId, m.warehouseId,
                w.name AS warehouseName, m.createdAt
         FROM stock_lot_movements m LEFT JOIN warehouses w ON w.id = m.warehouseId
         WHERE m.lotId = ? ORDER BY m.createdAt ASC LIMIT 200`,
        [lot.id]
      ).catch(() => []);
      res.json({
        lot: {
          id: lot.id, lotCode: lot.lotCode, coilCode: lot.coilCode, productId: lot.productId,
          productName: lot.productName, tracking: lot.tracking, warehouseId: lot.warehouseId,
          warehouseName: lot.warehouseName, initialQty: Number(lot.initialQty || 0),
          remainingQty: Number(lot.remainingQty || 0), unit: lot.unit, status: lot.status,
          supplier: lot.supplier, manufacturedAt: lot.manufacturedAt,
        },
        receipt: receipt ? {
          documentId: receipt.id, code: receipt.code, date: receipt.postingDate || receipt.docDate,
          supplier: lot.supplier || receipt.partnerName, warehouseId: receipt.warehouseId, warehouseName: receipt.warehouseName,
        } : null,
        moves: moves || [],
      });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Không tải được lịch sử Lô' }); }
  });
  return router;
}
