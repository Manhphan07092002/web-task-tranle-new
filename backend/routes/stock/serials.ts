import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import { getWarrantyStartType, resolveWarrantyStart, warrantyEndDate } from '../../utils/warranty.js';
import type { StockContext } from './context.js';

export function serialsRoutes(ctx: StockContext) {
  const { db, listScope, isDirector, requireWarehouse, assertLocation, paginationOf } = ctx;
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
      let query = `SELECT s.*, p.name AS productName, w.name AS warehouseName
        FROM stock_serials s
        LEFT JOIN products p ON p.id = s.productId
        LEFT JOIN warehouses w ON w.id = s.warehouseId
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND s.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND s.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      if (status?.trim()) { query += ' AND s.status = ?'; params.push(status.trim()); }
      if (productId?.trim()) { query += ' AND s.productId = ?'; params.push(productId.trim()); }
      if (q?.trim()) { query += ' AND (s.serialNumber LIKE ? OR s.lotCode LIKE ? OR p.name LIKE ?)'; params.push(`%${q.trim()}%`, `%${q.trim()}%`, `%${q.trim()}%`); }
      query += ' ORDER BY s.createdAt DESC';
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
      const { productId, serialNumber, lotCode, warehouseId, locationId, status, supplier, receiptId, customerName, projectId, warrantyStart, warrantyMonths, notes } = req.body;
      if (!serialNumber?.trim() && !lotCode?.trim()) {
        return res.status(400).json({ error: 'Serial number or lot code is required' });
      }
      const access = await requireWarehouse(user, warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const product = await db.get('SELECT id FROM products WHERE id = ?', [productId]);
      if (!product) return res.status(400).json({ error: `Unknown product: ${productId}` });
      if (!(await assertLocation(warehouseId, locationId ?? null))) {
        return res.status(400).json({ error: 'Invalid location for this warehouse' });
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      try {
        await db.run(
          `INSERT INTO stock_serials (id, productId, serialNumber, lotCode, warehouseId, locationId, status, supplier, receiptId, customerName, projectId, warrantyStart, warrantyMonths, notes, createdBy, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, productId, serialNumber?.trim() || null, lotCode?.trim() || null, warehouseId, locationId || null,
            status || 'SALEABLE', supplier ?? null, receiptId ?? null, customerName ?? null, projectId ?? null,
            warrantyStart ?? null, warrantyMonths ?? 0, notes ?? null, user.id, now, now]
        );
      } catch (e: any) {
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
        && !(await assertLocation(existing.warehouseId, locationId || null))) {
        return res.status(400).json({ error: 'Invalid location for this warehouse' });
      }
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
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to update serial' }); }
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
  return router;
}
