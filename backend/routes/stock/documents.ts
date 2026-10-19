import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import { resolveTracking } from '../../utils/tracking.js';
import { getWarrantyStartType, resolveWarrantyStart } from '../../utils/warranty.js';
import type { StockContext } from './context.js';

export function documentsRoutes(ctx: StockContext) {
  const { db, listScope, isDirector, requireWarehouse, requireWarehouseManager, canReadDocument, canWriteDocument, assertLocation, availableOf, saleableLocationSet, assertNotCounting, postMove, recordWarehouseActivity, resolveAccountingDefaults, docCode, nextDocCode, paginationOf } = ctx;
  const router = Router();
  // VAT mặc định theo quy ước nghiệp vụ hiện tại. Người có thẩm quyền vẫn có
  // thể thay đổi trên từng dòng; không dùng mã tài khoản mặc định cứng.
  const DEFAULT_VAT_RATE = 8;
  // ── Chứng từ: danh sách ─────────────────────────────────────────────────────

  router.get('/documents', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { docType, status, warehouseId, from, to } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT d.*,
          (SELECT COUNT(*) FROM stock_document_lines l
            WHERE l.documentId = d.id AND (l.serialLot IS NULL OR l.serialLot = '')) AS missingSerials,
          w.name AS warehouseName,
          sw.name AS sourceWarehouseName,
          dw.name AS destWarehouseName,
          u.name AS createdByName
        FROM stock_documents d 
        LEFT JOIN warehouses w ON w.id = d.warehouseId 
        LEFT JOIN warehouses sw ON sw.id = d.sourceWarehouseId
        LEFT JOIN warehouses dw ON dw.id = d.destWarehouseId
        LEFT JOIN users u ON u.id = d.createdBy
        WHERE 1=1`;
      const params: any[] = [];
      if (docType?.trim()) { query += ' AND d.docType = ?'; params.push(docType.trim()); }
      const statusValues = status?.split(',').map((value) => value.trim()).filter(Boolean) || [];
      if (statusValues.length === 1) { query += ' AND d.status = ?'; params.push(statusValues[0]); }
      else if (statusValues.length > 1) { query += ` AND d.status IN (${statusValues.map(() => '?').join(', ')})`; params.push(...statusValues); }
      if (warehouseId) { query += ' AND (d.warehouseId = ? OR d.sourceWarehouseId = ? OR d.destWarehouseId = ?)'; params.push(warehouseId, warehouseId, warehouseId); }
      else if (!isDirector(user)) {
        query += ` AND (d.warehouseId IN (${scope.map(() => '?').join(', ')}) OR d.sourceWarehouseId IN (${scope.map(() => '?').join(', ')}) OR d.destWarehouseId IN (${scope.map(() => '?').join(', ')}))`;
        params.push(...scope, ...scope, ...scope);
      }
      if (from?.trim()) {
        const fromDate = new Date(from);
        if (!Number.isFinite(fromDate.getTime())) return res.status(400).json({ error: 'Ngày bắt đầu không hợp lệ' });
        query += ' AND d.createdAt >= ?'; params.push(fromDate.toISOString());
      }
      if (to?.trim()) {
        const toDate = new Date(to);
        if (!Number.isFinite(toDate.getTime())) return res.status(400).json({ error: 'Ngày kết thúc không hợp lệ' });
        query += ' AND d.createdAt < ?'; params.push(toDate.toISOString());
      }
      query += ' ORDER BY d.createdAt DESC';
      const docPage = paginationOf(req.query as Record<string, string | undefined>);
      query += ' LIMIT ? OFFSET ?';
      params.push(docPage.limit, docPage.offset);
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock documents' }); }
  });

  // ── Tổng tiến độ xử lý cho danh sách (1 query, không N+1) ────────────────────

  router.get('/documents/processing-summary', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { docType, warehouseId } = req.query as Record<string, string | undefined>;
      let query = `SELECT l.documentId AS documentId,
          COUNT(*) AS total,
          SUM(CASE WHEN l.processingStatus = 'COMPLETED' THEN 1 ELSE 0 END) AS done
        FROM stock_document_lines l
        JOIN stock_documents d ON d.id = l.documentId
        WHERE d.status IN ('DRAFT', 'PROCESSING', 'READY')`;
      const params: any[] = [];
      if (docType?.trim()) { query += ' AND d.docType = ?'; params.push(docType.trim()); }
      if (warehouseId) {
        if (!isDirector(user) && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        query += ' AND (d.warehouseId = ? OR d.sourceWarehouseId = ? OR d.destWarehouseId = ?)';
        params.push(warehouseId, warehouseId, warehouseId);
      } else if (!isDirector(user)) {
        if (scope.length === 0) return res.json({});
        query += ` AND (d.warehouseId IN (${scope.map(() => '?').join(', ')}) OR d.sourceWarehouseId IN (${scope.map(() => '?').join(', ')}) OR d.destWarehouseId IN (${scope.map(() => '?').join(', ')}))`;
        params.push(...scope, ...scope, ...scope);
      }
      query += ' GROUP BY l.documentId';
      const rows = await db.all(query, params);
      const out: Record<string, { total: number; done: number }> = {};
      for (const r of rows || []) {
        out[r.documentId] = { total: Number(r.total) || 0, done: Number(r.done) || 0 };
      }
      res.json(out);
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch processing summary' }); }
  });

  // ── Chứng từ: chi tiết ───────────────────────────────────────────────────────

  router.get('/documents/:id', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot view business stock data' });
      }
      const id = String(req.params.id);
      const doc = await db.get(
        `SELECT d.*, 
           w.name AS warehouseName,
           sw.name AS sourceWarehouseName,
           dw.name AS destWarehouseName,
           u.name AS createdByName
         FROM stock_documents d 
         LEFT JOIN warehouses w ON w.id = d.warehouseId 
         LEFT JOIN warehouses sw ON sw.id = d.sourceWarehouseId
         LEFT JOIN warehouses dw ON dw.id = d.destWarehouseId
         LEFT JOIN users u ON u.id = d.createdBy
         WHERE d.id = ?`,
        [id]
      );
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (!(await canReadDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const lines = await db.all(
        `SELECT l.*, 
           p.name AS productName, p.unit, p.origin, p.category, p.tracking,
           loc.code AS locationCode, loc.name AS locationName
         FROM stock_document_lines l
         LEFT JOIN products p ON p.id = l.productId
         LEFT JOIN stock_locations loc ON loc.id = l.locationId
         WHERE l.documentId = ?`,
        [id]
      );
      res.json({ ...doc, lines });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch document detail' }); }
  });

  router.post('/documents/:id/cancel', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot perform stock operations' });
      }
      const id = String(req.params.id);
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [id]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') {
        return res.status(400).json({ error: 'Only draft documents can be cancelled' });
      }
      await releaseReservedSerials(id);
      await dropDocLots(id);
      await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?', ['CANCELLED', new Date().toISOString(), id]);
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to cancel document' }); }
  });

  router.delete('/documents/:id', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot perform stock operations' });
      }
      const id = String(req.params.id);
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [id]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING' && doc.status !== 'CANCELLED') {
        return res.status(400).json({ error: 'Cannot delete processed document' });
      }
      await beginStockTransaction(db);
      try {
        await releaseReservedSerials(id);
        await dropDocLots(id);
        await db.run('DELETE FROM stock_document_lines WHERE documentId = ?', [id]);
        await db.run('DELETE FROM stock_documents WHERE id = ?', [id]);
        await db.run('COMMIT');
      } catch (err) {
        await db.run('ROLLBACK');
        throw err;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to delete document' }); }
  });

  router.put('/documents/:id', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot perform stock operations' });
      }
      const id = String(req.params.id);
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [id]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      // Scope theo chứng từ đã lưu (không tin warehouseId trong body).
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') {
        return res.status(400).json({ error: 'Only draft documents can be modified' });
      }
      const now = new Date().toISOString();
      const body = req.body;
      const canEditFinancials = requireWarehouseManager(user);
      const numericError = (field: string, value: unknown, min: number, max?: number) => {
        if (value === undefined || value === null || value === '') return null;
        const n = Number(value);
        if (!Number.isFinite(n) || n < min || (max !== undefined && n > max)) {
          return `${field} phải là số hợp lệ${min > 0 ? ` lớn hơn hoặc bằng ${min}` : ` từ ${min}`}${max !== undefined ? ` và không vượt quá ${max}` : ''}.`;
        }
        return null;
      };
      if (body.lines !== undefined) {
        if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 500) {
          return res.status(400).json({ error: 'Danh sách hàng hóa phải có từ 1 đến 500 dòng.' });
        }
        for (const [index, line] of body.lines.entries()) {
          const lineNo = index + 1;
          const checks: Array<[string, unknown, number, number?]> = [
            [`Số lượng dòng #${lineNo}`, line?.quantity, 0.0000001, 1_000_000_000],
            [`Đơn giá dòng #${lineNo}`, line?.unitPrice, 0, 1_000_000_000_000],
            [`VAT dòng #${lineNo}`, line?.vatRate, 0, 100],
            [`Tiền VAT dòng #${lineNo}`, line?.vatAmount, 0],
            [`Thành tiền dòng #${lineNo}`, line?.totalAmount, 0],
          ];
          const invalid = checks.map(([field, value, min, max]) => numericError(field, value, min, max)).find(Boolean);
          if (invalid) return res.status(400).json({ error: invalid });
        }
      }
      const headerChecks: Array<[string, unknown, number, number?]> = [
        ['Tiền hàng', body.totalPreTax, 0], ['VAT tổng', body.vatAmount, 0],
        ['Tổng thanh toán', body.totalAmount, 0], ['Chi phí mua hàng', body.shippingFee, 0],
        ['VAT chứng từ', body.vatRate, 0, 100],
      ];
      const invalidHeader = headerChecks.map(([field, value, min, max]) => numericError(field, value, min, max)).find(Boolean);
      if (invalidHeader) return res.status(400).json({ error: invalidHeader });
      // Phiếu đã bắt đầu xử lý Serial/Lot: khóa kho/sản phẩm/số lượng. Muốn đổi
      // các trường này phải gửi resetProcessing để làm lại từ đầu.
      if (Array.isArray(body.lines) && body.lines.length > 0 && (await processingStarted(id)) && !body.resetProcessing) {
        const old = await db.all('SELECT productId, locationId, quantity FROM stock_document_lines WHERE documentId = ?', [id]);
        const sig = (ls: any[]) => ls.map((l: any) => `${l.productId}|${l.locationId || ''}|${Number(l.quantity)}`).sort().join(';');
        if (sig(old) !== sig(body.lines)) {
          return res.status(400).json({ error: 'Phiếu đã bắt đầu xử lý Serial/Lot — chỉ được sửa ghi chú/thông tin phụ, hoặc gửi resetProcessing để làm lại' });
        }
      }
      let totalPreTax = doc.totalPreTax;
      let vatAmount = doc.vatAmount;
      let totalAmount = doc.totalAmount;

      await beginStockTransaction(db);
      try {
        if (body.resetProcessing) await resetDocProcessing(id);
        if (Array.isArray(body.lines) && body.lines.length > 0) {
          const lineWh = doc.warehouseId || doc.sourceWarehouseId || '';
          const err = await validateLines(body.lines, lineWh);
          if (err) throw Object.assign(new Error(err), { status: 400 });

          let computedPreTax = 0;
          let computedVat = 0;
          await db.run(
            `DELETE a FROM stock_document_line_lots a
             INNER JOIN stock_document_lines l ON l.id = a.documentLineId
             WHERE l.documentId = ?`,
            [id]
          ).catch(() => undefined);
          const previousLines = await db.all('SELECT productId, locationId, serialRequired FROM stock_document_lines WHERE documentId = ?', [id]);
          await db.run('DELETE FROM stock_document_lines WHERE documentId = ?', [id]);
          const trackMap = await productTrackings(body.lines.map((l: any) => l.productId));
          const serialRequiredByKey = new Map((previousLines || []).map((l: any) => [`${l.productId}|${l.locationId || ''}`, Number(l.serialRequired) === 1]));
          const newLineIds: { id: string; productId: string; locationId: string }[] = [];
          for (const line of body.lines) {
            const q = Number(line.quantity) || 0;
            const p = Number(line.unitPrice) || 0;
            const rate = canEditFinancials && line.vatRate !== undefined ? Number(line.vatRate) : DEFAULT_VAT_RATE;
            const linePreTax = q * p;
            const lineVat = canEditFinancials && line.vatAmount !== undefined ? Number(line.vatAmount) : (linePreTax * rate / 100);
            const lineTotal = canEditFinancials && line.totalAmount !== undefined ? Number(line.totalAmount) : (linePreTax + lineVat);
            computedPreTax += linePreTax;
            computedVat += lineVat;
            // Giữ trạng thái xử lý theo text serialLot (bulk edit không làm mất tiến độ).
            const tracking = trackMap.get(line.productId);
            const serialRequired = serialRequiredByKey.get(`${line.productId}|${line.locationId || ''}`) ?? false;
            const codes = parseSerials(line.serialLot);
            const st = serialRequired ? (codes.length === q ? 'COMPLETED' : codes.length > 0 ? 'PARTIAL' : 'PENDING')
              : tracking === 'QUANTITY' ? 'PENDING'
              : (codes.length === q || (codes.length === 1 && q > 1)) ? 'COMPLETED'
              : codes.length > 0 ? 'PARTIAL' : 'PENDING';
            const newId = randomUUID();
            newLineIds.push({ id: newId, productId: line.productId, locationId: line.locationId || '' });
            await db.run(
              `INSERT INTO stock_document_lines (
                id, documentId, productId, quantity, unitPrice, locationId, note,
                accountDebit, accountCredit, vatRate, vatAmount, totalAmount, projectId, costItem, serialLot, costObjectId, processingStatus, serialRequired
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                newId, id, line.productId, q, p, line.locationId ?? null, line.note ?? null,
                (requireWarehouseManager(user) ? line.accountDebit : null) || (await resolveAccountingDefaults(line.productId, body.partnerCode || body.partnerName, line.projectId)).accountDebit,
                (requireWarehouseManager(user) ? line.accountCredit : null) || (await resolveAccountingDefaults(line.productId, body.partnerCode || body.partnerName, line.projectId)).accountCredit,
                rate, lineVat, lineTotal, line.projectId ?? null,
                requireWarehouseManager(user) ? line.costItem ?? null : null,
                line.serialLot ?? null, requireWarehouseManager(user) ? line.costObjectId ?? null : null, st, serialRequired ? 1 : 0
              ]
            );
          }
          // Nối lại lô/cuộn sang dòng thay thế (PUT tạo id dòng mới).
          const docLots = await db.all(
            'SELECT id, productId, locationId, initialQty FROM stock_lots WHERE receiptDocumentId = ?', [id]
          ).catch(() => []);
          for (const lot of docLots || []) {
            const target = newLineIds.find((l) =>
              l.productId === (lot as any).productId && l.locationId === ((lot as any).locationId || ''));
            if (target) {
              await db.run('UPDATE stock_lots SET receiptLineId = ? WHERE id = ?', [target.id, (lot as any).id]);
            }
          }
          // LOT phủ đủ số lượng sau khi nối lại -> COMPLETED.
          for (const nl of newLineIds) {
            if (trackMap.get(nl.productId) !== 'LOT') continue;
            const covered = await db.all(
              'SELECT COALESCE(SUM(initialQty), 0) AS covered FROM stock_lots WHERE receiptDocumentId = ? AND receiptLineId = ?',
              [id, nl.id]
            ).catch(() => []);
            const need = Number(body.lines.find((l: any) => l.productId === nl.productId && (l.locationId || '') === nl.locationId)?.quantity || 0);
            if (Number(covered?.[0]?.covered ?? 0) >= need && need > 0) {
              await db.run(`UPDATE stock_document_lines SET processingStatus = 'COMPLETED' WHERE id = ?`, [nl.id]);
            }
          }
          totalPreTax = computedPreTax;
          vatAmount = computedVat;
          totalAmount = totalPreTax + vatAmount;
        }

        const attachmentsStr = body.attachments !== undefined
          ? (typeof body.attachments === 'string' ? body.attachments : (Array.isArray(body.attachments) ? JSON.stringify(body.attachments) : null))
          : doc.attachments;

        await db.run(
          `UPDATE stock_documents SET
             notes = ?, partnerCode = ?, partnerName = ?, partnerAddress = ?, deliverer = ?,
             postingDate = ?, docDate = ?, invoiceNumber = ?, invoiceDate = ?,
             customsDeclarationNumber = ?, invoiceLookupCode = ?, invoiceLookupUrl = ?,
             totalPreTax = ?, vatRate = ?, vatAmount = ?, totalAmount = ?, shippingFee = ?,
             paymentStatus = ?, paymentDueDate = ?, attachments = ?, updatedAt = ?
           WHERE id = ?`,
          [
            body.notes ?? doc.notes,
            body.partnerCode ?? doc.partnerCode,
            body.partnerName ?? doc.partnerName,
            body.partnerAddress ?? doc.partnerAddress,
            body.deliverer ?? doc.deliverer,
            body.postingDate ?? doc.postingDate,
            body.docDate ?? doc.docDate,
            body.invoiceNumber ?? doc.invoiceNumber,
            body.invoiceDate ?? doc.invoiceDate,
            body.customsDeclarationNumber ?? doc.customsDeclarationNumber,
            body.invoiceLookupCode ?? doc.invoiceLookupCode,
            body.invoiceLookupUrl ?? doc.invoiceLookupUrl,
            totalPreTax,
            canEditFinancials && body.vatRate !== undefined ? Number(body.vatRate) : (doc.vatRate ?? DEFAULT_VAT_RATE),
            vatAmount,
            totalAmount,
            canEditFinancials && body.shippingFee !== undefined ? Number(body.shippingFee) : doc.shippingFee,
            body.paymentStatus ?? doc.paymentStatus,
            body.paymentDueDate ?? doc.paymentDueDate,
            attachmentsStr,
            now,
            id
          ]
        );
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'DOCUMENT_UPDATED',
          entityType: 'DOCUMENT',
          entityId: id,
          documentId: id,
          documentCode: doc.code,
          warehouseId: doc.warehouseId || null,
          fromWarehouseId: doc.sourceWarehouseId || null,
          toWarehouseId: doc.destWarehouseId || null,
          userId: user.id,
          oldData: { status: doc.status, totalAmount: doc.totalAmount },
          newData: { totalAmount, resetProcessing: Boolean(body.resetProcessing), lineCount: Array.isArray(body.lines) ? body.lines.length : undefined },
        });
        await db.run('COMMIT');
      } catch (error) {
        await db.run('ROLLBACK');
        throw error;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to update document' }); }
  });

  // ── Chứng từ: tạo ─────────────────────────────────────────────────────────

  const LineSchema = z.object({
    productId: z.string().trim().min(1).max(191),
    quantity: z.number().finite().positive().max(1_000_000_000),
    unitPrice: z.number().finite().min(0).max(1_000_000_000_000).optional(),
    locationId: z.string().trim().max(191).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    accountDebit: z.string().max(32).nullable().optional(),
    accountCredit: z.string().max(32).nullable().optional(),
    vatRate: z.number().finite().min(0).max(100).optional(),
    vatAmount: z.number().finite().min(0).optional(),
    totalAmount: z.number().finite().min(0).optional(),
    projectId: z.string().max(191).nullable().optional(),
    costItem: z.string().max(100).nullable().optional(),
    serialLot: z.string().max(191).nullable().optional(),
    costObjectId: z.string().max(191).nullable().optional(),
  });
  const ReceiptSchema = z.object({
    code: z.string().trim().max(100).optional(),
    warehouseId: z.string().trim().min(1).max(191),
    lines: z.array(LineSchema).min(1).max(500),
    receiptSubType: z.string().max(64).optional(),
    partnerCode: z.string().max(100).nullable().optional(),
    partnerName: z.string().max(255).nullable().optional(),
    partnerAddress: z.string().max(1000).nullable().optional(),
    deliverer: z.string().max(191).nullable().optional(),
    purchaserId: z.string().max(191).nullable().optional(),
    postingDate: z.string().max(191).nullable().optional(),
    docDate: z.string().max(40).nullable().optional(),
    invoiceNumber: z.string().max(100).nullable().optional(),
    invoiceDate: z.string().max(40).nullable().optional(),
    customsDeclarationNumber: z.string().max(100).nullable().optional(),
    invoiceLookupCode: z.string().max(100).nullable().optional(),
    invoiceLookupUrl: z.string().max(1000).nullable().optional(),
    totalPreTax: z.number().finite().min(0).optional(),
    vatRate: z.number().finite().min(0).max(100).optional(),
    vatAmount: z.number().finite().min(0).optional(),
    totalAmount: z.number().finite().min(0).optional(),
    shippingFee: z.number().finite().min(0).optional(),
    paymentStatus: z.string().max(32).optional(),
    paymentDueDate: z.string().max(40).nullable().optional(),
    attachments: z.union([z.string(), z.array(z.any())]).nullable().optional(),
    referenceType: z.string().max(64).nullable().optional(),
    referenceId: z.string().max(191).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
  });
  const TransferSchema = z.object({
    code: z.string().trim().max(100).optional(),
    sourceWarehouseId: z.string().trim().min(1).max(191),
    destWarehouseId: z.string().trim().min(1).max(191),
    lines: z.array(LineSchema).min(1).max(500),
    notes: z.string().max(5000).nullable().optional(),
  });

  const DOC_CODE_PREFIX: Record<string, string> = { RECEIPT: 'PNK', ISSUE: 'PXK', TRANSFER: 'DCK', RETURN: 'PTH' };

  async function createDocument(docType: string, code: string, warehouses: { warehouseId?: string | null; sourceWarehouseId?: string | null; destWarehouseId?: string | null }, body: any, user: any) {
    const now = new Date().toISOString();
    const id = randomUUID();
    const userCode = (typeof body.code === 'string' && body.code.trim()) ? body.code.trim() : null;
    let finalCode = userCode || code;
    const canEditFinancials = requireWarehouseManager(user);

    let computedPreTax = 0;
    let computedVat = 0;
    for (const line of body.lines) {
      const q = Number(line.quantity) || 0;
      const p = Number(line.unitPrice) || 0;
      const rate = canEditFinancials && line.vatRate !== undefined ? Number(line.vatRate) : DEFAULT_VAT_RATE;
      const linePreTax = q * p;
      const lineVat = canEditFinancials && line.vatAmount !== undefined ? Number(line.vatAmount) : (linePreTax * rate / 100);
      computedPreTax += linePreTax;
      computedVat += lineVat;
    }
    const totalPreTax = computedPreTax;
    const vatAmount = computedVat;
    const totalAmount = totalPreTax + vatAmount;
    const shippingFee = canEditFinancials ? Number(body.shippingFee) || 0 : 0;
    const attachmentsStr = typeof body.attachments === 'string' ? body.attachments : (Array.isArray(body.attachments) ? JSON.stringify(body.attachments) : null);

    await beginStockTransaction(db);
    let attempts = 0;
    for (;;) {
      attempts += 1;
      try {
        const validationError = await validateLines(body.lines, warehouses.warehouseId || warehouses.sourceWarehouseId || '');
        if (validationError) throw Object.assign(new Error(validationError), { status: 400 });

      await db.run(
        `INSERT INTO stock_documents (
          id, code, docType, status, receiptSubType, warehouseId, sourceWarehouseId, destWarehouseId,
          partnerCode, partnerName, partnerAddress, deliverer, purchaserId,
          postingDate, docDate, invoiceNumber, invoiceDate, customsDeclarationNumber,
          invoiceLookupCode, invoiceLookupUrl, totalPreTax, vatRate, vatAmount, totalAmount, shippingFee,
          paymentStatus, paymentDueDate, attachments, referenceType, referenceId, notes, createdBy, createdAt, updatedAt
        ) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, finalCode, docType, body.receiptSubType || (docType === 'RECEIPT' ? 'DOMESTIC_PURCHASE' : null),
          warehouses.warehouseId ?? null, warehouses.sourceWarehouseId ?? null, warehouses.destWarehouseId ?? null,
          body.partnerCode ?? null, body.partnerName ?? null, body.partnerAddress ?? null,
          body.deliverer ?? null, body.purchaserId ?? null,
          body.postingDate ?? now, body.docDate ?? now.slice(0, 10),
          body.invoiceNumber ?? null, body.invoiceDate ?? null, body.customsDeclarationNumber ?? null,
          body.invoiceLookupCode ?? null, body.invoiceLookupUrl ?? null,
          totalPreTax, canEditFinancials && body.vatRate !== undefined ? Number(body.vatRate) : DEFAULT_VAT_RATE, vatAmount, totalAmount, shippingFee,
          body.paymentStatus || 'UNPAID', body.paymentDueDate ?? null,
          attachmentsStr, body.referenceType ?? null, body.referenceId ?? null, body.notes ?? null,
          user.id, now, now
        ]
      );
      for (const line of body.lines) {
        const q = Number(line.quantity) || 0;
        const p = Number(line.unitPrice) || 0;
        const rate = canEditFinancials && line.vatRate !== undefined ? Number(line.vatRate) : DEFAULT_VAT_RATE;
        const linePreTax = q * p;
        const lineVat = canEditFinancials && line.vatAmount !== undefined ? Number(line.vatAmount) : (linePreTax * rate / 100);
        const lineTotal = canEditFinancials && line.totalAmount !== undefined ? Number(line.totalAmount) : (linePreTax + lineVat);
        await db.run(
          `INSERT INTO stock_document_lines (
            id, documentId, productId, quantity, unitPrice, locationId, note,
            accountDebit, accountCredit, vatRate, vatAmount, totalAmount, projectId, costItem, serialLot, costObjectId, serialRequired
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(), id, line.productId, q, p, line.locationId ?? null, line.note ?? null,
            (requireWarehouseManager(user) ? line.accountDebit : null) || (await resolveAccountingDefaults(line.productId, body.partnerCode || body.partnerName, line.projectId)).accountDebit,
            (requireWarehouseManager(user) ? line.accountCredit : null) || (await resolveAccountingDefaults(line.productId, body.partnerCode || body.partnerName, line.projectId)).accountCredit,
            rate, lineVat, lineTotal, line.projectId ?? null,
            requireWarehouseManager(user) ? line.costItem ?? null : null,
            line.serialLot ?? null, requireWarehouseManager(user) ? line.costObjectId ?? null : null, 1
          ]
        );
      }
      await recordWarehouseActivity(db.run.bind(db), {
        actionType: 'DOCUMENT_CREATED',
        entityType: 'DOCUMENT',
        entityId: id,
        documentId: id,
        documentCode: finalCode,
        warehouseId: warehouses.warehouseId || null,
        fromWarehouseId: warehouses.sourceWarehouseId || null,
        toWarehouseId: warehouses.destWarehouseId || null,
        userId: user.id,
        metadata: { docType, lineCount: body.lines.length, receiptSubType: body.receiptSubType || null },
      });
      await db.run('COMMIT');
      return { id, code: finalCode };
    } catch (error: any) {
      await db.run('ROLLBACK');
      // Mã tự sinh va chạm UNIQUE (random 4 ký tự): sinh lại và thử tiếp, tối đa 3 lần.
      // Mã do người dùng nhập thì báo 409 ngay.
      if (!userCode && error?.message?.includes('Duplicate') && attempts < 3) {
        finalCode = await nextDocCode(DOC_CODE_PREFIX[docType] || 'PXK');
        await beginStockTransaction(db);
        continue;
      }
      throw error;
    }
  }
  }

  // Số phiếu dự kiến cho form tạo (không giữ chỗ — số thực chốt khi lưu,
  // concurrent có thể lệch +1 và được retry đỡ).
  router.get('/next-code', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot perform stock operations' });
      }
      const docType = String(req.query.docType || 'RECEIPT').toUpperCase();
      const prefix = DOC_CODE_PREFIX[docType];
      if (!prefix) return res.status(400).json({ error: 'Invalid docType' });
      res.json({ code: await nextDocCode(prefix), docType });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to preview document code' }); }
  });

  router.post('/receipts', validate(ReceiptSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const access = await requireWarehouse(user, req.body.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      res.status(201).json(await createDocument('RECEIPT', await nextDocCode('PNK'), { warehouseId: req.body.warehouseId }, req.body, user));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to create receipt' }); }
  });

  router.post('/issues', validate(ReceiptSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const access = await requireWarehouse(user, req.body.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      res.status(201).json(await createDocument('ISSUE', await nextDocCode('PXK'), { warehouseId: req.body.warehouseId }, req.body, user));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to create issue' }); }
  });

  router.post('/transfers', validate(TransferSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (req.body.sourceWarehouseId === req.body.destWarehouseId) {
        return res.status(400).json({ error: 'Source and destination warehouses must differ' });
      }
      const from = await requireWarehouse(user, req.body.sourceWarehouseId);
      const to = await requireWarehouse(user, req.body.destWarehouseId);
      if (!from.ok || !to.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      res.status(201).json(await createDocument('TRANSFER', await nextDocCode('DCK'), {
        sourceWarehouseId: req.body.sourceWarehouseId, destWarehouseId: req.body.destWarehouseId,
      }, req.body, user));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to create transfer' }); }
  });

  router.post('/returns', validate(ReceiptSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const access = await requireWarehouse(user, req.body.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      res.status(201).json(await createDocument('RETURN', await nextDocCode('PTH'), { warehouseId: req.body.warehouseId }, req.body, user));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to create return document' }); }
  });

  // ── Chứng từ: hoàn tất (sinh moves + balances, transaction) ────────────────

  async function loadDocument(id: string, lock = false) {
    const doc = await db.get(`SELECT * FROM stock_documents WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
    if (!doc) return null;
    const lines = await db.all('SELECT * FROM stock_document_lines WHERE documentId = ?', [id]);
    return { doc, lines };
  }

  /** Số lượng thực sự ghi sổ. QUANTITY có thể được xác nhận lệch chứng từ;
   * SERIAL/LOT vẫn lấy quantity vì chúng được kiểm soát bằng entity/allocation. */
  function effectiveLineQuantity(line: any): number {
    const actual = Number(line?.actualQty);
    if (line?.actualQty !== null && line?.actualQty !== undefined && Number.isFinite(actual)) return actual;
    return Number(line?.quantity || 0);
  }

  function aggregateLines(lines: any[]): any[] {
    const totals = new Map<string, any>();
    for (const line of lines) {
      if (!line?.productId) continue;
      const key = JSON.stringify([line.productId, line.locationId || '']);
      const previous = totals.get(key);
      totals.set(key, { ...line, quantity: effectiveLineQuantity(line) + Number(previous?.quantity || 0) });
    }
    return [...totals.values()];
  }

  async function validateLines(lines: any[], warehouseId: string): Promise<string | null> {
    if (lines.length === 0) return 'Phiếu chưa có dòng hàng để xử lý.';
    for (const line of lines) {
      if (!Number.isFinite(Number(line.quantity)) || !(Number(line.quantity) > 0)) return `Số lượng của sản phẩm ${line.productId} phải lớn hơn 0.`;
    }
    const productIds = [...new Set(lines.map((l: any) => l.productId))];
    const foundProducts = await db.all(
      `SELECT id FROM products WHERE id IN (${productIds.map(() => '?').join(', ')})`,
      productIds
    ).catch(() => []);
    const foundSet = new Set((foundProducts || []).map((r: any) => r.id));
    for (const pid of productIds) {
      if (!foundSet.has(pid)) return `Không tìm thấy sản phẩm có mã hệ thống ${pid}. Vui lòng kiểm tra lại dòng hàng.`;
    }
    const locationIds = [...new Set(lines.map((l: any) => l.locationId || '').filter(Boolean))];
    if (locationIds.length > 0) {
      const locRows = await db.all(
        `SELECT id FROM stock_locations WHERE warehouseId = ? AND id IN (${locationIds.map(() => '?').join(', ')}) AND isActive = 1`,
        [warehouseId, ...locationIds]
      ).catch(() => []);
      const locSet = new Set((locRows || []).map((r: any) => r.id));
      for (const lid of locationIds) {
        if (!locSet.has(lid)) return `Vị trí lưu kho ${lid} không tồn tại hoặc đã ngừng hoạt động trong kho này.`;
      }
    }
    return null;
  }

  /** Available theo từng (product, location) trong 1 query — thay N lần availableOf. */
  async function availableMap(warehouseId: string, keys: { productId: string; locationId: string }[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (keys.length === 0) return out;
    const pairs = keys.map((k) => `${k.productId}|${k.locationId || ''}`);
    const uniqPairs = [...new Set(pairs)];
    const productIds = [...new Set(keys.map((k) => k.productId))];
    const locationIds = [...new Set(keys.map((k) => k.locationId || '').filter(Boolean))];
    let query = 'SELECT productId, locationId, onHand, reserved FROM stock_balances WHERE warehouseId = ?';
    const params: any[] = [warehouseId];
    query += ` AND productId IN (${productIds.map(() => '?').join(', ')})`;
    params.push(...productIds);
    if (locationIds.length > 0) {
      query += ` AND (locationId = '' OR locationId IN (${locationIds.map(() => '?').join(', ')}))`;
      params.push(...locationIds);
    } else {
      query += ` AND locationId = ''`;
    }
    const rows = await db.all(query, params).catch(() => []);
    for (const r of rows || []) {
      out.set(`${r.productId}|${r.locationId || ''}`, Number(r.onHand ?? 0) - Number(r.reserved ?? 0));
    }
    for (const p of uniqPairs) if (!out.has(p)) out.set(p, 0);
    return out;
  }

  function formatStockQuantity(value: number): string {
    return Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 6 });
  }

  /** Thông báo đủ ngữ cảnh để người dùng biết cần sửa dữ liệu nào trước khi xuất. */
  async function insufficientStockMessage(warehouseId: string, line: any, available: number): Promise<string> {
    const [product, warehouse, location, balance] = await Promise.all([
      db.get('SELECT name, unit, importCode FROM products WHERE id = ?', [line.productId]).catch(() => undefined),
      db.get('SELECT name FROM warehouses WHERE id = ?', [warehouseId]).catch(() => undefined),
      line.locationId
        ? db.get('SELECT name, code FROM stock_locations WHERE id = ?', [line.locationId]).catch(() => undefined)
        : Promise.resolve(undefined),
      db.get(
        'SELECT onHand, reserved FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ?',
        [line.productId, warehouseId, line.locationId || '']
      ).catch(() => undefined),
    ]);
    const productName = product?.name || line.productId;
    const productCode = product?.importCode ? ` (${product.importCode})` : '';
    const unit = product?.unit ? ` ${product.unit}` : '';
    const warehouseName = warehouse?.name || warehouseId;
    const locationName = location ? ` tại vị trí ${location.name || location.code || line.locationId}` : '';
    const onHand = Number(balance?.onHand ?? available);
    const reserved = Number(balance?.reserved ?? Math.max(0, onHand - available));
    const held = reserved > 0 ? ` Trong đó đang giữ ${formatStockQuantity(reserved)}${unit}.` : '';
    return `Không đủ tồn kho để xuất sản phẩm “${productName}”${productCode}. `
      + `Cần xuất ${formatStockQuantity(Number(line.quantity))}${unit}, `
      + `nhưng tồn khả dụng chỉ còn ${formatStockQuantity(available)}${unit} tại kho “${warehouseName}”${locationName}.`
      + held;
  }

  /** Tách serial/lot từ ô serialLot của dòng (phân tách , ; xuống dòng), khử trùng. */
  function parseSerials(serialLot: string | null | undefined): string[] {
    if (!serialLot) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of String(serialLot).split(/[,;\n]+/)) {
      const s = part.trim();
      if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
    }
    return out;
  }

  function serialError(message: string, status: number): Error {
    return Object.assign(new Error(message), { status });
  }

  /** Tracking từng sản phẩm (batch 1 query). Thiếu tracking (hàng cũ/mock) = QUANTITY. */
  async function productTrackings(productIds: string[]): Promise<Map<string, string>> {
    const uniq = [...new Set((productIds || []).filter(Boolean))];
    if (uniq.length === 0) return new Map();
    const rows = await db.all(
      `SELECT id, tracking FROM products WHERE id IN (${uniq.map(() => '?').join(', ')})`,
      uniq
    ).catch(() => []);
    return new Map((rows || []).map((r: any) => [r.id, resolveTracking(r.tracking)]));
  }

  /** Chốt hoàn tất theo từng dòng, tính lại từ DB (không tin client):
   * SERIAL phải đủ serial; LOT đủ khi text hợp lệ hoặc lô đã đăng ký phủ đủ SL;
   * QUANTITY qua (số trên dòng là xác nhận, confirm-qty là tường minh thêm). */
  async function canComplete(doc: any, lines: any[]): Promise<{ ok: boolean; message?: string }> {
    const trackings = await productTrackings(lines.map((l: any) => l.productId));
    for (const line of lines) {
      const serialRequired = Number(line.serialRequired) === 1;
      if (serialRequired && Number(line.serialSkipped) === 1) {
        if (line.processingStatus === 'COMPLETED') continue;
        return { ok: false, message: `Dòng ${line.productId}: chưa xác nhận số lượng không có Serial` };
      }
      const tracking = serialRequired ? 'SERIAL' : trackings.get(line.productId);
      if (tracking !== 'SERIAL' && tracking !== 'LOT') continue;
      const serials = parseSerials(line.serialLot);
      const qty = Number(line.quantity);
      const label = line.productId;
      if (tracking === 'LOT') {
        const covered = doc.docType === 'ISSUE' || doc.docType === 'TRANSFER'
          ? await db.get(
            `SELECT COALESCE(SUM(a.quantity), 0) AS covered
             FROM stock_document_line_lots a WHERE a.documentLineId = ?`,
            [line.id]
          ).catch(() => undefined)
          : (await db.all(
            'SELECT COALESCE(SUM(initialQty), 0) AS covered FROM stock_lots WHERE receiptDocumentId = ? AND receiptLineId = ?',
            [doc.id, line.id]
          ).catch(() => []))[0];
        if (Number(covered?.covered ?? 0) >= qty) continue;
        return { ok: false, message: `Chưa đủ Lô: ${label} — đăng ký lô/cuộn cho đủ ${qty}` };
      }
      const textOk = serials.length === qty;
      if (textOk) continue;
      if (serials.length === 0) {
        return { ok: false, message: `Chưa đủ Serial: dòng ${label} mới có 0/${qty}. Vui lòng mở Xử lý hàng hóa và quét đủ Serial trước khi hoàn tất.` };
      }
      return { ok: false, message: `Chưa đủ Serial: dòng ${label} mới có ${serials.length}/${qty}. Vui lòng tiếp tục xử lý hàng hóa để quét đủ Serial.` };
    }
    if (doc.docType === 'ISSUE') {
      const aggregate = aggregateLines(lines);
      const available = await availableMap(doc.warehouseId, aggregate.map((line) => ({ productId: line.productId, locationId: line.locationId || '' })));
      for (const line of aggregate) {
        const current = available.get(`${line.productId}|${line.locationId || ''}`) ?? 0;
        if (current < Number(line.quantity)) {
          return { ok: false, message: await insufficientStockMessage(doc.warehouseId, line, current) };
        }
      }
    }
    return { ok: true };
  }

  async function assertProcessable(doc: any, lines: any[]): Promise<void> {
    const r = await canComplete(doc, lines);
    if (!r.ok) throw Object.assign(new Error(r.message), { status: 400 });
  }

  /** Phiếu đã bắt đầu xử lý Serial/Lot? (serial đã gắn hoặc dòng đã PARTIAL/COMPLETED) */
  async function processingStarted(documentId: string): Promise<boolean> {
    const s = await db.get(
      'SELECT id FROM stock_serials WHERE receiptDocumentId = ? OR issueDocumentId = ? LIMIT 1',
      [documentId, documentId]
    ).catch(() => undefined);
    if (s) return true;
    const l = await db.get(
      `SELECT id FROM stock_document_lines WHERE documentId = ? AND processingStatus <> 'PENDING' LIMIT 1`,
      [documentId]
    ).catch(() => undefined);
    return !!l;
  }

  /** Reset xử lý để sửa lại dòng: chỉ xóa serial chưa từng xuất (IN_STOCK/RESERVED,
   * chưa gắn phiếu xuất). Serial đã OUT thì chặn reset. Xóa cả lô/cuộn của phiếu. */
  async function resetDocProcessing(documentId: string): Promise<void> {
    const issued = await db.get(
      `SELECT id FROM stock_serials WHERE (receiptDocumentId = ? OR issueDocumentId = ?) AND stockStatus = 'OUT' LIMIT 1`,
      [documentId, documentId]
    ).catch(() => undefined);
    if (issued) {
      throw Object.assign(new Error('Serial của phiếu đã xuất kho, không thể reset xử lý. Hãy dùng phiếu điều chỉnh/trả hàng.'), { status: 409 });
    }
    await db.run(`DELETE FROM stock_serials WHERE receiptDocumentId = ? OR issueDocumentId = ?`, [documentId, documentId]);
    await db.run(`DELETE FROM stock_lot_movements WHERE referenceId = ?`, [documentId]);
    await db.run(`DELETE FROM stock_lots WHERE receiptDocumentId = ?`, [documentId]);
    await db.run(
      `DELETE a FROM stock_document_line_lots a
       INNER JOIN stock_document_lines l ON l.id = a.documentLineId
       WHERE l.documentId = ?`,
      [documentId]
    ).catch(() => undefined);
    await db.run(
      `UPDATE stock_document_lines SET processingStatus = 'PENDING', actualQty = NULL, varianceQty = NULL, varianceReason = NULL WHERE documentId = ?`,
      [documentId]
    );
  }

  /** Dọn lô/cuộn của phiếu hủy/xóa (chưa từng nhập kho chính thức). */
  async function dropDocLots(documentId: string): Promise<void> {
    await db.run(`DELETE FROM stock_lot_movements WHERE referenceId = ?`, [documentId]).catch(() => undefined);
    await db.run(`DELETE FROM stock_lots WHERE receiptDocumentId = ?`, [documentId]).catch(() => undefined);
    await db.run(
      `DELETE a FROM stock_document_line_lots a
       INNER JOIN stock_document_lines l ON l.id = a.documentLineId
       WHERE l.documentId = ?`,
      [documentId]
    ).catch(() => undefined);
  }

  /** Nhả serial đang RESERVED cho phiếu (hủy/xóa nháp): về IN_STOCK, xóa link xuất. */
  async function releaseReservedSerials(documentId: string): Promise<void> {
    await db.run(
      `UPDATE stock_serials SET stockStatus = 'IN_STOCK', issueDocumentId = NULL, issueLineId = NULL, updatedAt = ? WHERE issueDocumentId = ? AND stockStatus = 'RESERVED'`,
      [new Date().toISOString(), documentId]
    ).catch(() => undefined);
  }

  // Chốt bước kiểm tra hàng hóa, chưa ghi nhận nhập/xuất kho.
  // Bước ghi sổ thực tế vẫn nằm ở /receipts/:id/complete,
  // /issues/:id/complete hoặc /transfers/:id/ship.
  router.post('/documents/:id/processing-complete', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const pre = await loadDocument(String(req.params.id));
      if (!pre) return res.status(404).json({ error: 'Document not found' });
      if (!(await canWriteDocument(user, pre.doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (pre.doc.status === 'READY') return res.json({ success: true, status: 'READY', idempotent: true });
      if (pre.doc.status !== 'DRAFT' && pre.doc.status !== 'PROCESSING') {
        return res.status(400).json({ error: 'Phiếu không ở trạng thái có thể hoàn tất xử lý' });
      }
      await beginStockTransaction(db, [pre.doc.warehouseId || pre.doc.sourceWarehouseId].filter(Boolean) as string[]);
      transactionOpen = true;
      const loaded = await loadDocument(String(req.params.id), true);
      if (!loaded) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(404).json({ error: 'Document not found' }); }
      const check = await canComplete(loaded.doc, loaded.lines);
      if (!check.ok) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(400).json({ error: check.message }); }
      await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?', ['READY', new Date().toISOString(), loaded.doc.id]);
      await recordWarehouseActivity(db.run.bind(db), {
        actionType: 'PROCESSING_COMPLETED',
        entityType: 'DOCUMENT',
        entityId: loaded.doc.id,
        documentId: loaded.doc.id,
        documentCode: loaded.doc.code,
        warehouseId: loaded.doc.warehouseId || null,
        fromWarehouseId: loaded.doc.sourceWarehouseId || null,
        toWarehouseId: loaded.doc.destWarehouseId || null,
        userId: user.id,
        metadata: { lineCount: loaded.lines.length },
      });
      await db.run('COMMIT'); transactionOpen = false;
      return res.json({ success: true, status: 'READY' });
    } catch (e: any) {
      if (transactionOpen) await db.run('ROLLBACK');
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to complete processing' });
    }
  });

  /** Đăng ký serial/lot khi hoàn tất NHẬP: dòng nào NV đã nhập serial thì lưu
   * vết bảo hành (warrantyStart = ngày hạch toán, months theo sản phẩm).
   * 1 mã cho cả dòng SL>1 -> lưu dạng lô; nhiều mã -> mỗi mã 1 serial và
   * số lượng mã phải khớp số lượng (khi đã nhập). */
  async function registerReceiptSerials(doc: any, lines: any[], user: any): Promise<void> {
    const withSerials = lines.filter((l) => Number(l.serialSkipped) !== 1 && parseSerials(l.serialLot).length > 0);
    if (withSerials.length === 0) return;
    const productIds = [...new Set(withSerials.map((l) => l.productId))];
    const products = await db.all(
      `SELECT id, warrantyMonths FROM products WHERE id IN (${productIds.map(() => '?').join(', ')})`,
      productIds
    ).catch(() => []);
    const warrantyByProduct = new Map((products || []).map((p: any) => [p.id, Math.max(0, Number(p.warrantyMonths) || 0)]));
    const warrantyStart = String(doc.postingDate || doc.docDate || new Date().toISOString()).slice(0, 10);
    const now = new Date().toISOString();
    for (const line of withSerials) {
      // Dòng đã đăng ký entity LOT riêng thì không persist đè sang stock_serials.
      const lotRows = await db.all(
        'SELECT id FROM stock_lots WHERE receiptDocumentId = ? AND receiptLineId = ? LIMIT 1',
        [doc.id, line.id]
      ).catch(() => []);
      if (lotRows.length > 0) continue;
      const serials = parseSerials(line.serialLot);
      const qty = Number(line.quantity);
      if (Number(line.serialRequired) !== 1 && serials.length === 1 && qty > 1) {
        await db.run(
          `INSERT INTO stock_serials (id, productId, serialNumber, lotCode, warehouseId, locationId, status, supplier, receiptId, customerName, projectId, warrantyStart, warrantyMonths, notes, createdBy, createdAt, updatedAt, receiptDocumentId, receiptLineId, stockStatus, receivedAt)
           VALUES (?, ?, NULL, ?, ?, ?, 'SALEABLE', ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, 'IN_STOCK', ?)`,
          [randomUUID(), line.productId, serials[0], doc.warehouseId, line.locationId || null,
            doc.partnerName ?? null, doc.id, warrantyStart, warrantyByProduct.get(line.productId) ?? 0, user.id, now, now,
            doc.id, line.id, now]
        );
        continue;
      }
      if (serials.length !== qty) {
        throw serialError(`Dòng ${line.productId}: đã nhập ${serials.length} serial nhưng số lượng ${qty} — quét đủ serial từng chiếc`, 400);
      }
      const dupes = await db.all(
        `SELECT serialNumber FROM stock_serials WHERE serialNumber IN (${serials.map(() => '?').join(', ')})`,
        serials
      ).catch(() => []);
      if (dupes.length > 0) {
        throw serialError(`Serial ${(dupes[0] as any).serialNumber} đã được ghi nhận trước đó. Hãy kiểm tra phiếu nhập cũ hoặc nhập một Serial khác.`, 409);
      }
      for (const sn of serials) {
        try {
          await db.run(
            `INSERT INTO stock_serials (id, productId, serialNumber, lotCode, warehouseId, locationId, status, supplier, receiptId, customerName, projectId, warrantyStart, warrantyMonths, notes, createdBy, createdAt, updatedAt, receiptDocumentId, receiptLineId, stockStatus, receivedAt)
             VALUES (?, ?, ?, NULL, ?, ?, 'SALEABLE', ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, 'IN_STOCK', ?)`,
            [randomUUID(), line.productId, sn, doc.warehouseId, line.locationId || null,
              doc.partnerName ?? null, doc.id, warrantyStart, warrantyByProduct.get(line.productId) ?? 0, user.id, now, now,
              doc.id, line.id, now]
          );
        } catch (e: any) {
          if (e.message?.includes('Duplicate')) throw serialError(`Serial ${sn} đã được ghi nhận trước đó. Hãy kiểm tra phiếu nhập cũ hoặc nhập một Serial khác.`, 409);
          throw e;
        }
      }
    }
  }

  /** Trừ số lượng LOT đã phân bổ cho dòng xuất và ghi audit movement.
   * Khóa từng lô trong cùng transaction với chứng từ để hai PXK không thể
   * cùng tiêu vượt remainingQty. */
  async function consumeIssueLots(doc: any, lines: any[], user: any): Promise<void> {
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const trackings = await productTrackings(productIds);
    for (const line of lines) {
      if (Number(line.serialRequired) === 1 || trackings.get(line.productId) !== 'LOT') continue;
      const allocations = await db.all(
        `SELECT a.lotId, a.quantity, s.lotCode
         FROM stock_document_line_lots a
         INNER JOIN stock_lots s ON s.id = a.lotId
         WHERE a.documentLineId = ? ORDER BY s.createdAt ASC, s.id ASC`,
        [line.id]
      );
      const allocated = (allocations || []).reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
      if (allocated < Number(line.quantity)) {
        throw serialError(`Dòng ${line.productId}: đã phân bổ ${allocated}/${Number(line.quantity)} theo lô`, 400);
      }
      for (const allocation of allocations || []) {
        const lot = await db.get(
          `SELECT id, productId, warehouseId, lotCode, remainingQty, status
           FROM stock_lots WHERE id = ? FOR UPDATE`,
          [allocation.lotId]
        );
        const quantity = Number(allocation.quantity || 0);
        if (!lot || lot.productId !== line.productId || lot.warehouseId !== doc.warehouseId || lot.status !== 'ACTIVE') {
          throw serialError(`Lô ${allocation.lotCode || allocation.lotId} không còn hợp lệ trong kho`, 400);
        }
        if (Number(lot.remainingQty || 0) < quantity) {
          throw serialError(`Lô ${lot.lotCode} chỉ còn ${Number(lot.remainingQty || 0)}, không đủ xuất ${quantity}`, 400);
        }
        const now = new Date().toISOString();
        await db.run(
          `UPDATE stock_lots SET remainingQty = remainingQty - ?,
             status = CASE WHEN remainingQty - ? <= 0 THEN 'DEPLETED' ELSE status END,
             updatedAt = ? WHERE id = ?`,
          [quantity, quantity, now, lot.id]
        );
        await db.run(
          `INSERT INTO stock_lot_movements
           (id, lotId, productId, warehouseId, quantity, moveType, referenceType, referenceId, documentLineId, createdBy, createdAt)
           VALUES (?, ?, ?, ?, ?, 'ISSUE', 'ISSUE', ?, ?, ?, ?)`,
          [randomUUID(), lot.id, line.productId, doc.warehouseId, -quantity, doc.id, line.id, user.id, now]
        );
      }
    }
  }

  /** Trừ serial khi hoàn tất XUẤT: serial đã nhập phải tồn tại (IN_STOCK,
   * đúng kho) và đủ số lượng dòng -> đánh dấu SOLD + khách hàng. */
  async function consumeIssueSerials(doc: any, lines: any[], user: any): Promise<void> {
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const trackings = await productTrackings(productIds);
    // Legacy phiếu chưa có tracking trên product nhưng đã lưu serialLot vẫn
    // phải hoàn tất được; LOT mới đã được xử lý riêng ở consumeIssueLots.
    const withSerials = lines.filter((l) => Number(l.serialSkipped) !== 1 && (Number(l.serialRequired) === 1 || trackings.get(l.productId) !== 'LOT') && parseSerials(l.serialLot).length > 0);
    if (withSerials.length === 0) return;
    const warrantyStartType = await getWarrantyStartType(db);
    for (const line of withSerials) {
      const serials = parseSerials(line.serialLot);
      const qty = Number(line.quantity);
      if (Number(line.serialRequired) !== 1 && trackings.get(line.productId) !== 'SERIAL' && serials.length === 1 && qty > 1) {
        const lot = await db.get(
          `SELECT id FROM stock_serials WHERE lotCode = ? AND productId = ? AND warehouseId = ? AND status = 'SALEABLE' LIMIT 1`,
          [serials[0], line.productId, doc.warehouseId]
        );
        if (!lot) throw serialError(`Dòng ${line.productId}: lô ${serials[0]} không có trong tồn bán được`, 400);
        continue;
      }
      if (serials.length !== qty) {
        throw serialError(`Dòng ${line.productId}: đã nhập ${serials.length} serial nhưng số lượng ${qty} — chọn đúng từng chiếc xuất`, 400);
      }
      for (const sn of serials) {
        const row = await db.get(
          `SELECT id, stockStatus, issueDocumentId, issueLineId FROM stock_serials WHERE serialNumber = ? AND productId = ? AND warehouseId = ? AND status = 'SALEABLE'
           AND (stockStatus IS NULL OR stockStatus = 'IN_STOCK' OR (stockStatus = 'RESERVED' AND issueDocumentId = ? AND issueLineId = ?)) LIMIT 1 FOR UPDATE`,
          [sn, line.productId, doc.warehouseId, doc.id, line.id]
        );
        if (!row) throw serialError(`Serial ${sn} không có trong tồn bán được của kho`, 400);
        // Hàng legacy/mock thiếu stockStatus được coi như IN_STOCK; RESERVED cho phiếu khác thì chặn.
        if (row.issueDocumentId && row.issueDocumentId !== doc.id) {
          throw serialError(`Serial ${sn} đang được giữ cho phiếu khác`, 400);
        }
        const nowOut = new Date().toISOString();
        const wStart = resolveWarrantyStart({
          startType: warrantyStartType,
          outboundDate: nowOut,
          deliveryDate: doc.deliveryDate,
          installationDate: doc.installationDate,
          acceptanceDate: doc.acceptanceDate,
          fallbackDate: row.warrantyStart,
        });
        await db.run(
          `UPDATE stock_serials SET status = 'SOLD', stockStatus = 'OUT', outDate = ?, customerName = ?, issueDocumentId = ?, issueLineId = ?, warrantyStart = COALESCE(?, warrantyStart), updatedAt = ? WHERE id = ?`,
          [nowOut, doc.partnerName ?? null, doc.id, line.id, wStart, nowOut, (row as any).id]
        );
      }
    }
  }

  /** Kiểm tra các SERIAL đã RESERVED cho phiếu điều chuyển khi ship.
   * Scan-out đã giữ serial và gắn issueDocumentId/issueLineId; ship chỉ chốt
   * rằng toàn bộ serial của dòng vẫn còn đúng kho nguồn. */
  async function assertTransferSerialsReady(doc: any, lines: any[]): Promise<void> {
    const trackings = await productTrackings(lines.map((l) => l.productId));
    for (const line of lines) {
      if (Number(line.serialRequired) !== 1 && trackings.get(line.productId) !== 'SERIAL') continue;
      const serials = parseSerials(line.serialLot);
      if (serials.length !== Number(line.quantity)) {
        throw serialError(`Dòng ${line.productId}: chưa đủ Serial (${serials.length}/${Number(line.quantity)})`, 400);
      }
      for (const serial of serials) {
        const row = await db.get(
          `SELECT id FROM stock_serials
           WHERE serialNumber = ? AND productId = ? AND warehouseId = ?
             AND stockStatus = 'RESERVED' AND issueDocumentId = ? AND issueLineId = ?
           LIMIT 1 FOR UPDATE`,
          [serial, line.productId, doc.sourceWarehouseId, doc.id, line.id]
        );
        if (!row) throw serialError(`Serial ${serial} chưa được giữ cho phiếu điều chuyển`, 400);
      }
    }
  }

  /** Khi nhận điều chuyển, đưa các SERIAL đang RESERVED của phiếu vào kho đích. */
  async function receiveTransferSerials(doc: any, locationId: string): Promise<void> {
    const rows = await db.all(
      `SELECT id, productId, issueLineId FROM stock_serials
       WHERE issueDocumentId = ? AND stockStatus = 'RESERVED' FOR UPDATE`,
      [doc.id]
    ).catch(() => []);
    const now = new Date().toISOString();
    for (const row of rows || []) {
      await db.run(
        `UPDATE stock_serials SET warehouseId = ?, locationId = ?, stockStatus = 'IN_STOCK',
         issueDocumentId = NULL, issueLineId = NULL, updatedAt = ? WHERE id = ?`,
        [doc.destWarehouseId, locationId || null, now, row.id]
      );
    }
  }

  /** Trừ LOT ở kho nguồn khi ship và lưu mapping để receive tạo LOT đích. */
  async function consumeTransferLotsOnShip(doc: any, lines: any[], user: any): Promise<void> {
    const trackings = await productTrackings(lines.map((l) => l.productId));
    for (const line of lines) {
      if (Number(line.serialRequired) === 1 || trackings.get(line.productId) !== 'LOT') continue;
      const allocations = await db.all(
        `SELECT a.lotId, a.quantity, s.lotCode
         FROM stock_document_line_lots a INNER JOIN stock_lots s ON s.id = a.lotId
         WHERE a.documentLineId = ? ORDER BY s.createdAt ASC, s.id ASC`,
        [line.id]
      );
      const allocated = (allocations || []).reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
      if (allocated < Number(line.quantity)) {
        throw serialError(`Dòng ${line.productId}: đã phân bổ ${allocated}/${Number(line.quantity)} theo lô`, 400);
      }
      for (const allocation of allocations || []) {
        const lot = await db.get(
          `SELECT id, productId, warehouseId, lotCode, coilCode, remainingQty, initialQty, unit,
                  manufacturedAt, supplier, receiptDocumentId, receiptLineId, status
           FROM stock_lots WHERE id = ? FOR UPDATE`,
          [allocation.lotId]
        );
        const quantity = Number(allocation.quantity || 0);
        if (!lot || lot.productId !== line.productId || lot.warehouseId !== doc.sourceWarehouseId || lot.status !== 'ACTIVE') {
          throw serialError(`Lô ${allocation.lotCode || allocation.lotId} không còn hợp lệ ở kho nguồn`, 400);
        }
        if (Number(lot.remainingQty || 0) < quantity) {
          throw serialError(`Lô ${lot.lotCode} chỉ còn ${Number(lot.remainingQty || 0)}, không đủ điều chuyển ${quantity}`, 400);
        }
        const now = new Date().toISOString();
        await db.run(
          `UPDATE stock_lots SET remainingQty = remainingQty - ?,
             status = CASE WHEN remainingQty - ? <= 0 THEN 'DEPLETED' ELSE status END,
             updatedAt = ? WHERE id = ?`,
          [quantity, quantity, now, lot.id]
        );
        await db.run(
          `INSERT INTO stock_transfer_line_lots
           (id, documentLineId, sourceLotId, quantity, createdBy, createdAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [randomUUID(), line.id, lot.id, quantity, user.id, now]
        );
        await db.run(
          `INSERT INTO stock_lot_movements
           (id, lotId, productId, warehouseId, quantity, moveType, referenceType, referenceId, documentLineId, createdBy, createdAt)
           VALUES (?, ?, ?, ?, ?, 'TRANSFER_OUT', 'TRANSFER', ?, ?, ?, ?)`,
          [randomUUID(), lot.id, line.productId, doc.sourceWarehouseId, -quantity, doc.id, line.id, user.id, now]
        );
      }
    }
  }

  /** Tạo/cộng LOT tương ứng ở kho đích và ghi movement dương. */
  async function receiveTransferLots(doc: any, lines: any[], locationId: string, user: any): Promise<Set<string>> {
    const handledLines = new Set<string>();
    const trackings = await productTrackings(lines.map((l) => l.productId));
    for (const line of lines) {
      if (Number(line.serialRequired) === 1 || trackings.get(line.productId) !== 'LOT') continue;
      const links = await db.all(
        `SELECT t.id, t.sourceLotId, t.quantity, s.productId, s.lotCode, s.coilCode, s.unit,
                s.manufacturedAt, s.supplier, s.receiptDocumentId, s.receiptLineId
         FROM stock_transfer_line_lots t INNER JOIN stock_lots s ON s.id = t.sourceLotId
         WHERE t.documentLineId = ? FOR UPDATE`,
        [line.id]
      );
      for (const link of links || []) {
        const quantity = Number(link.quantity || 0);
        const now = new Date().toISOString();
        let destLot = await db.get(
          `SELECT * FROM stock_lots WHERE productId = ? AND warehouseId = ? AND lotCode = ? LIMIT 1 FOR UPDATE`,
          [link.productId, doc.destWarehouseId, link.lotCode]
        );
        if (destLot) {
          await db.run(
            `UPDATE stock_lots SET initialQty = initialQty + ?, remainingQty = remainingQty + ?,
             status = 'ACTIVE', locationId = ?, updatedAt = ? WHERE id = ?`,
            [quantity, quantity, locationId || null, now, destLot.id]
          );
        } else {
          const destLotId = randomUUID();
          await db.run(
            `INSERT INTO stock_lots
             (id, productId, lotCode, coilCode, warehouseId, locationId, initialQty, remainingQty, unit,
              manufacturedAt, supplier, receiptDocumentId, receiptLineId, status, createdBy, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
            [destLotId, link.productId, link.lotCode, link.coilCode, doc.destWarehouseId, locationId || null,
              quantity, quantity, link.unit, link.manufacturedAt, link.supplier, link.receiptDocumentId,
              link.receiptLineId, user.id, now, now]
          );
          destLot = { id: destLotId };
        }
        await db.run('UPDATE stock_transfer_line_lots SET destLotId = ? WHERE id = ?', [destLot.id, link.id]);
        await db.run(
          `INSERT INTO stock_lot_movements
           (id, lotId, productId, warehouseId, quantity, moveType, referenceType, referenceId, documentLineId, createdBy, createdAt)
           VALUES (?, ?, ?, ?, ?, 'TRANSFER_IN', 'TRANSFER', ?, ?, ?, ?)`,
          [randomUUID(), destLot.id, link.productId, doc.destWarehouseId, quantity, doc.id, line.id, user.id, now]
        );
        handledLines.add(line.id);
      }
    }
    return handledLines;
  }

  /** Ghi stock_moves theo từng LOT để timeline có thể truy ngược đúng cuộn/lô.
   * Với dữ liệu cũ chưa có allocation, vẫn fallback một move theo dòng. */
  async function postDocumentMoves(doc: any, lines: any[], moveType: string, direction: 1 | -1, user: any): Promise<void> {
    const trackings = await productTrackings(lines.map((l) => l.productId));
    for (const line of lines) {
      if ((Number(line.serialRequired) === 1 && Number(line.serialSkipped) !== 1) || trackings.get(line.productId) === 'SERIAL') {
        const serials = parseSerials(line.serialLot);
        for (const serial of serials) {
          const serialRow = await db.get(
            `SELECT id FROM stock_serials
             WHERE serialNumber = ? AND productId = ?
               AND (receiptDocumentId = ? OR issueDocumentId = ?)
             LIMIT 1`,
            [serial, line.productId, doc.id, doc.id]
          ).catch(() => undefined);
          await postMove(db.run.bind(db), {
            productId: line.productId, warehouseId: doc.warehouseId, locationId: line.locationId || '',
            quantity: direction, moveType, referenceType: doc.docType, referenceId: doc.id,
            documentLineId: line.id, serialId: serialRow?.id ?? null, createdBy: user.id,
          });
        }
        if (serials.length > 0) continue;
      }
      if (Number(line.serialRequired) !== 1 && trackings.get(line.productId) === 'LOT') {
        const rows = doc.docType === 'ISSUE'
          ? await db.all(
            'SELECT lotId, quantity FROM stock_document_line_lots WHERE documentLineId = ?',
            [line.id]
          ).catch(() => [])
          : await db.all(
            'SELECT id AS lotId, initialQty AS quantity FROM stock_lots WHERE receiptDocumentId = ? AND receiptLineId = ?',
            [doc.id, line.id]
          ).catch(() => []);
        if ((rows || []).length > 0) {
          for (const row of rows || []) {
            await postMove(db.run.bind(db), {
              productId: line.productId, warehouseId: doc.warehouseId, locationId: line.locationId || '',
              quantity: direction * Number(row.quantity), moveType,
              referenceType: doc.docType, referenceId: doc.id,
              documentLineId: line.id, lotId: row.lotId, createdBy: user.id,
            });
          }
          continue;
        }
      }
      await postMove(db.run.bind(db), {
        productId: line.productId, warehouseId: doc.warehouseId, locationId: line.locationId || '',
        quantity: direction * effectiveLineQuantity(line), moveType,
        referenceType: doc.docType, referenceId: doc.id,
        documentLineId: line.id, createdBy: user.id,
      });
    }
  }

  /** Nhận lại serial khi hoàn tất TRẢ HÀNG: serial đã từng xuất (SOLD) được
   * đưa về SALEABLE tại vị trí trả + xóa khách; serial chưa từng đăng ký thì
   * ghi mới như nhập (giữ vết bảo hành theo sản phẩm). */
  async function registerReturnSerials(doc: any, lines: any[], user: any): Promise<void> {
    const withSerials = lines.filter((l) => Number(l.serialSkipped) !== 1 && parseSerials(l.serialLot).length > 0);
    if (withSerials.length === 0) return;
    const productIds = [...new Set(withSerials.map((l) => l.productId))];
    const products = await db.all(
      `SELECT id, warrantyMonths FROM products WHERE id IN (${productIds.map(() => '?').join(', ')})`,
      productIds
    ).catch(() => []);
    const warrantyByProduct = new Map((products || []).map((p: any) => [p.id, Math.max(0, Number(p.warrantyMonths) || 0)]));
    const warrantyStart = String(doc.postingDate || doc.docDate || new Date().toISOString()).slice(0, 10);
    const now = new Date().toISOString();
    for (const line of withSerials) {
      // Dòng đã đăng ký entity LOT riêng thì không persist đè sang stock_serials.
      const lotRows = await db.all(
        'SELECT id FROM stock_lots WHERE receiptDocumentId = ? AND receiptLineId = ? LIMIT 1',
        [doc.id, line.id]
      ).catch(() => []);
      if (lotRows.length > 0) continue;
      const serials = parseSerials(line.serialLot);
      const qty = Number(line.quantity);
      if (Number(line.serialRequired) !== 1 && serials.length === 1 && qty > 1) {
        await db.run(
          `INSERT INTO stock_serials (id, productId, serialNumber, lotCode, warehouseId, locationId, status, supplier, receiptId, customerName, projectId, warrantyStart, warrantyMonths, notes, createdBy, createdAt, updatedAt, receiptDocumentId, receiptLineId, stockStatus, receivedAt)
           VALUES (?, ?, NULL, ?, ?, ?, 'SALEABLE', ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, 'IN_STOCK', ?)`,
          [randomUUID(), line.productId, serials[0], doc.warehouseId, line.locationId || null,
            doc.partnerName ?? null, doc.id, warrantyStart, warrantyByProduct.get(line.productId) ?? 0, user.id, now, now,
            doc.id, line.id, now]
        );
        continue;
      }
      if (serials.length !== qty) {
        throw serialError(`Dòng ${line.productId}: đã nhập ${serials.length} serial nhưng số lượng ${qty} — quét đủ serial từng chiếc`, 400);
      }
      for (const sn of serials) {
        const row = await db.get(
          `SELECT id, stockStatus FROM stock_serials WHERE serialNumber = ? AND productId = ? LIMIT 1 FOR UPDATE`,
          [sn, line.productId]
        );
        if (row) {
          await db.run(
            `UPDATE stock_serials SET status = 'SALEABLE', stockStatus = 'IN_STOCK',
             warehouseId = ?, locationId = ?, receiptId = ?, receiptDocumentId = ?, receiptLineId = ?,
             issueDocumentId = NULL, issueLineId = NULL, customerName = NULL, receivedAt = ?,
             warrantyStart = ?, warrantyMonths = ?, updatedAt = ? WHERE id = ?`,
            [doc.warehouseId, line.locationId || null, doc.id, doc.id, line.id, now,
              warrantyStart, warrantyByProduct.get(line.productId) ?? 0, now, (row as any).id]
          );
        } else {
          await db.run(
            `INSERT INTO stock_serials (id, productId, serialNumber, lotCode, warehouseId, locationId, status, supplier, receiptId, customerName, projectId, warrantyStart, warrantyMonths, notes, createdBy, createdAt, updatedAt, receiptDocumentId, receiptLineId, stockStatus, receivedAt)
             VALUES (?, ?, ?, NULL, ?, ?, 'SALEABLE', ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, 'IN_STOCK', ?)`,
            [randomUUID(), line.productId, sn, doc.warehouseId, line.locationId || null,
              doc.partnerName ?? null, doc.id, warrantyStart, warrantyByProduct.get(line.productId) ?? 0, user.id, now, now,
              doc.id, line.id, now]
          );
        }
      }
    }
  }

  router.post('/receipts/:id/complete', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const pre = await loadDocument(String(req.params.id));
      if (!pre || pre.doc.docType !== 'RECEIPT') return res.status(404).json({ error: 'Receipt not found' });
      await beginStockTransaction(db, [pre.doc.warehouseId]);
      transactionOpen = true;
      const loaded = await loadDocument(String(req.params.id), true);
      if (!loaded || loaded.doc.docType !== 'RECEIPT') return res.status(404).json({ error: 'Receipt not found' });
      const access = await requireWarehouse(user, loaded.doc.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (loaded.doc.status === 'DONE') return res.json({ success: true, idempotent: true, status: 'DONE' });
      if (loaded.doc.status !== 'READY') return res.status(400).json({ error: 'Phiếu nhập chưa qua bước xử lý hàng hóa. Vui lòng chuyển phiếu sang Sẵn sàng hoàn tất trước.' });
      const err = await validateLines(loaded.lines, loaded.doc.warehouseId);
      if (err) return res.status(400).json({ error: err });
      try {
        await assertProcessable(loaded.doc, loaded.lines);
      } catch (e: any) {
        return res.status(e.status || 400).json({ error: e.message });
      }

      try {
        await registerReceiptSerials(loaded.doc, loaded.lines, user);
        await postDocumentMoves(loaded.doc, loaded.lines, 'RECEIPT', 1, user);
        await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?', ['DONE', new Date().toISOString(), loaded.doc.id]);
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to complete receipt' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/issues/:id/complete', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const pre = await loadDocument(String(req.params.id));
      if (!pre || pre.doc.docType !== 'ISSUE') return res.status(404).json({ error: 'Issue not found' });
      await beginStockTransaction(db, [pre.doc.warehouseId]);
      transactionOpen = true;
      const loaded = await loadDocument(String(req.params.id), true);
      if (!loaded || loaded.doc.docType !== 'ISSUE') return res.status(404).json({ error: 'Issue not found' });
      const access = await requireWarehouse(user, loaded.doc.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (loaded.doc.status === 'DONE') return res.json({ success: true, idempotent: true, status: 'DONE' });
      if (loaded.doc.status !== 'READY') return res.status(400).json({ error: 'Phiếu xuất chưa qua bước xử lý hàng hóa. Vui lòng chuyển phiếu sang Sẵn sàng hoàn tất trước.' });
      const err = await validateLines(loaded.lines, loaded.doc.warehouseId);
      if (err) return res.status(400).json({ error: err });
      try {
        await assertProcessable(loaded.doc, loaded.lines);
      } catch (e: any) {
        return res.status(e.status || 400).json({ error: e.message });
      }
      const agg = aggregateLines(loaded.lines);
      const saleable = await saleableLocationSet(loaded.doc.warehouseId, agg.map((l) => l.locationId || ''));
      for (const line of agg) {
        if (!saleable.has(line.locationId || '')) return res.status(400).json({ error: `Vị trí ${line.locationId} không phải vị trí được phép xuất hàng. Vui lòng chọn vị trí bán được.` });
      }
      const avail = await availableMap(loaded.doc.warehouseId, agg.map((l) => ({ productId: l.productId, locationId: l.locationId || '' })));
      for (const line of agg) {
        if ((avail.get(`${line.productId}|${line.locationId || ''}`) ?? 0) < Number(line.quantity)) {
          return res.status(400).json({ error: await insufficientStockMessage(loaded.doc.warehouseId, line, avail.get(`${line.productId}|${line.locationId || ''}`) ?? 0) });
        }
      }

      try {
        await consumeIssueLots(loaded.doc, loaded.lines, user);
        await consumeIssueSerials(loaded.doc, loaded.lines, user);
        await postDocumentMoves(loaded.doc, loaded.lines, 'ISSUE', -1, user);
        await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?', ['DONE', new Date().toISOString(), loaded.doc.id]);
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to complete issue' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/returns/:id/complete', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const pre = await loadDocument(String(req.params.id));
      if (!pre || pre.doc.docType !== 'RETURN') return res.status(404).json({ error: 'Return not found' });
      await beginStockTransaction(db, [pre.doc.warehouseId]);
      transactionOpen = true;
      const loaded = await loadDocument(String(req.params.id), true);
      if (!loaded || loaded.doc.docType !== 'RETURN') return res.status(404).json({ error: 'Return not found' });
      const access = await requireWarehouse(user, loaded.doc.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (loaded.doc.status === 'DONE') return res.json({ success: true, idempotent: true, status: 'DONE' });
      if (loaded.doc.status !== 'READY') return res.status(400).json({ error: 'Phiếu trả hàng chưa qua bước xử lý hàng hóa. Vui lòng chuyển phiếu sang Sẵn sàng hoàn tất trước.' });
      const err = await validateLines(loaded.lines, loaded.doc.warehouseId);
      if (err) return res.status(400).json({ error: err });
      try {
        await assertProcessable(loaded.doc, loaded.lines);
      } catch (e: any) {
        return res.status(e.status || 400).json({ error: e.message });
      }

      try {
        await registerReturnSerials(loaded.doc, loaded.lines, user);
        await postDocumentMoves(loaded.doc, loaded.lines, 'RETURN', 1, user);
        await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?', ['DONE', new Date().toISOString(), loaded.doc.id]);
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to complete return' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/transfers/:id/ship', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const pre = await loadDocument(String(req.params.id));
      if (!pre || pre.doc.docType !== 'TRANSFER') return res.status(404).json({ error: 'Transfer not found' });
      await beginStockTransaction(db, [pre.doc.sourceWarehouseId, pre.doc.destWarehouseId]);
      transactionOpen = true;
      const loaded = await loadDocument(String(req.params.id), true);
      if (!loaded || loaded.doc.docType !== 'TRANSFER') return res.status(404).json({ error: 'Transfer not found' });
      const from = await requireWarehouse(user, loaded.doc.sourceWarehouseId);
      const to = await requireWarehouse(user, loaded.doc.destWarehouseId);
      if (!from.ok || !to.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (loaded.doc.status === 'DONE') return res.json({ success: true, idempotent: true, status: 'DONE' });
      if (loaded.doc.status !== 'READY') return res.status(400).json({ error: 'Phiếu điều chuyển chưa qua bước xử lý hàng hóa. Vui lòng chuyển phiếu sang Sẵn sàng hoàn tất trước.' });
      const err = await validateLines(loaded.lines, loaded.doc.sourceWarehouseId);
      if (err) return res.status(400).json({ error: err });
      try {
        await assertProcessable(loaded.doc, loaded.lines);
        await assertTransferSerialsReady(loaded.doc, loaded.lines);
      } catch (e: any) {
        return res.status(e.status || 400).json({ error: e.message });
      }
      const agg = aggregateLines(loaded.lines);
      const avail = await availableMap(loaded.doc.sourceWarehouseId, agg.map((l) => ({ productId: l.productId, locationId: l.locationId || '' })));
      for (const line of agg) {
        if ((avail.get(`${line.productId}|${line.locationId || ''}`) ?? 0) < Number(line.quantity)) {
          return res.status(400).json({ error: await insufficientStockMessage(loaded.doc.sourceWarehouseId, line, avail.get(`${line.productId}|${line.locationId || ''}`) ?? 0) });
        }
      }

      try {
        const trackings = await productTrackings(loaded.lines.map((l: any) => l.productId));
        await consumeTransferLotsOnShip(loaded.doc, loaded.lines, user);
        for (const line of loaded.lines) {
          if (Number(line.serialRequired) !== 1 && trackings.get(line.productId) === 'LOT') {
            const lotRows = await db.all('SELECT lotId, quantity FROM stock_document_line_lots WHERE documentLineId = ?', [line.id]);
            for (const lotRow of lotRows || []) {
              await postMove(db.run.bind(db), {
                productId: line.productId, warehouseId: loaded.doc.sourceWarehouseId, locationId: line.locationId || '',
                quantity: -Number(lotRow.quantity), moveType: 'TRANSFER_OUT', referenceType: 'TRANSFER', referenceId: loaded.doc.id,
                documentLineId: line.id, lotId: lotRow.lotId, createdBy: user.id,
              });
            }
          } else if ((Number(line.serialRequired) === 1 && Number(line.serialSkipped) !== 1) || trackings.get(line.productId) === 'SERIAL') {
            for (const serial of parseSerials(line.serialLot)) {
              const serialRow = await db.get('SELECT id FROM stock_serials WHERE serialNumber = ? AND issueDocumentId = ? LIMIT 1', [serial, loaded.doc.id]);
              await postMove(db.run.bind(db), {
                productId: line.productId, warehouseId: loaded.doc.sourceWarehouseId, locationId: line.locationId || '',
                quantity: -1, moveType: 'TRANSFER_OUT', referenceType: 'TRANSFER', referenceId: loaded.doc.id,
                documentLineId: line.id, serialId: serialRow?.id ?? null, createdBy: user.id,
              });
            }
          } else {
            await postMove(db.run.bind(db), {
              productId: line.productId, warehouseId: loaded.doc.sourceWarehouseId, locationId: line.locationId || '',
              quantity: -effectiveLineQuantity(line), moveType: 'TRANSFER_OUT',
              referenceType: 'TRANSFER', referenceId: loaded.doc.id,
              documentLineId: line.id, createdBy: user.id,
            });
          }
        }
        await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?', ['IN_TRANSIT', new Date().toISOString(), loaded.doc.id]);
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to ship transfer' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/transfers/:id/receive', validate(z.object({ locationId: z.string().trim().max(191).nullable().optional() })), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const pre = await loadDocument(String(req.params.id));
      if (!pre || pre.doc.docType !== 'TRANSFER') return res.status(404).json({ error: 'Transfer not found' });
      await beginStockTransaction(db, [pre.doc.destWarehouseId]);
      transactionOpen = true;
      const loaded = await loadDocument(String(req.params.id), true);
      if (!loaded || loaded.doc.docType !== 'TRANSFER') return res.status(404).json({ error: 'Transfer not found' });
      const destinationLocation = req.body.locationId || '';
      const to = await requireWarehouse(user, loaded.doc.destWarehouseId);
      if (!to.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (loaded.doc.status === 'DONE') return res.json({ success: true, idempotent: true, status: 'DONE' });
      if (loaded.doc.status !== 'IN_TRANSIT') return res.status(400).json({ error: 'Only in-transit transfers can be received' });
      if (!(await assertLocation(loaded.doc.destWarehouseId, destinationLocation))) return res.status(400).json({ error: 'Invalid destination location' });
      try {
        await assertProcessable(loaded.doc, loaded.lines);
      } catch (e: any) {
        return res.status(e.status || 400).json({ error: e.message });
      }

      try {
        const trackings = await productTrackings(loaded.lines.map((l: any) => l.productId));
        const transferSerialRows = await db.all(
          `SELECT id, productId, issueLineId FROM stock_serials
           WHERE issueDocumentId = ? AND stockStatus = 'RESERVED' FOR UPDATE`,
          [loaded.doc.id]
        ).catch(() => []);
        await receiveTransferLots(loaded.doc, loaded.lines, destinationLocation, user);
        await receiveTransferSerials(loaded.doc, destinationLocation);
        for (const line of loaded.lines) {
          if (Number(line.serialRequired) !== 1 && trackings.get(line.productId) === 'LOT') {
            const lotRows = await db.all('SELECT destLotId, quantity FROM stock_transfer_line_lots WHERE documentLineId = ?', [line.id]);
            for (const lotRow of lotRows || []) {
              if (!lotRow.destLotId) continue;
              await postMove(db.run.bind(db), {
                productId: line.productId, warehouseId: loaded.doc.destWarehouseId, locationId: destinationLocation,
                quantity: Number(lotRow.quantity), moveType: 'TRANSFER_IN', referenceType: 'TRANSFER', referenceId: loaded.doc.id,
                documentLineId: line.id, lotId: lotRow.destLotId, createdBy: user.id,
              });
            }
          } else if ((Number(line.serialRequired) === 1 && Number(line.serialSkipped) !== 1) || trackings.get(line.productId) === 'SERIAL') {
            const serialRows = (transferSerialRows || []).filter((row: any) => row.issueLineId === line.id);
            for (const serialRow of serialRows || []) {
              await postMove(db.run.bind(db), {
                productId: line.productId, warehouseId: loaded.doc.destWarehouseId, locationId: destinationLocation,
                quantity: 1, moveType: 'TRANSFER_IN', referenceType: 'TRANSFER', referenceId: loaded.doc.id,
                documentLineId: line.id, serialId: serialRow.id, createdBy: user.id,
              });
            }
          } else {
            await postMove(db.run.bind(db), {
              productId: line.productId, warehouseId: loaded.doc.destWarehouseId, locationId: destinationLocation,
              quantity: effectiveLineQuantity(line), moveType: 'TRANSFER_IN',
              referenceType: 'TRANSFER', referenceId: loaded.doc.id,
              documentLineId: line.id, createdBy: user.id,
            });
          }
        }
        await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?', ['DONE', new Date().toISOString(), loaded.doc.id]);
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to receive transfer' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  const RelocationSchema = z.object({
    warehouseId: z.string().trim().min(1).max(191),
    productId: z.string().trim().min(1).max(191),
    fromLocationId: z.string().trim().min(1).max(191),
    toLocationId: z.string().trim().min(1).max(191),
    quantity: z.number().positive(),
    notes: z.string().trim().max(500).optional(),
  });

  router.post('/relocations', validate(RelocationSchema), async (req, res) => {
    let transactionOpen = false;
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot perform stock operations' });
      }
      const { warehouseId, productId, fromLocationId, toLocationId, quantity, notes } = req.body;
      if (fromLocationId === toLocationId) {
        return res.status(400).json({ error: 'Vị trí nguồn và vị trí đích phải khác nhau' });
      }

      const access = await requireWarehouse(user, warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });

      await beginStockTransaction(db, [warehouseId]);
      transactionOpen = true;

      // Đọc lại trong transaction — check available ngoài lock là TOCTOU.
      const [fromLoc, toLoc] = await Promise.all([
        db.get('SELECT * FROM stock_locations WHERE id = ? AND warehouseId = ? AND isActive = 1', [fromLocationId, warehouseId]),
        db.get('SELECT * FROM stock_locations WHERE id = ? AND warehouseId = ? AND isActive = 1', [toLocationId, warehouseId]),
      ]);
      if (!fromLoc) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(400).json({ error: 'Vị trí nguồn không hợp lệ hoặc đã khóa' }); }
      if (!toLoc) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(400).json({ error: 'Vị trí đích không hợp lệ hoặc đã khóa' }); }

      try {
        await assertNotCounting(warehouseId);
      } catch (e: any) {
        await db.run('ROLLBACK'); transactionOpen = false;
        return res.status(e.status || 409).json({ error: e.message });
      }

      const fromBal = await db.get(
        'SELECT onHand, reserved FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ? FOR UPDATE',
        [productId, warehouseId, fromLocationId]
      );
      const onHand = Number(fromBal?.onHand ?? 0);
      const reserved = Number(fromBal?.reserved ?? 0);
      const available = onHand - reserved;
      if (available < quantity) {
        await db.run('ROLLBACK'); transactionOpen = false;
        return res.status(400).json({
          error: `Số lượng khả dụng tại vị trí ${fromLoc.name || fromLoc.code} không đủ (${available} < ${quantity})`,
        });
      }

      const code = docCode('DCV');

      await postMove(db.run.bind(db), {
        productId,
        warehouseId,
        locationId: fromLocationId,
        quantity: -quantity,
        moveType: 'INTERNAL_MOVE',
        referenceType: 'RELOCATION',
        referenceId: code,
        documentLineId: null,
        createdBy: user.id,
      });

      await postMove(db.run.bind(db), {
        productId,
        warehouseId,
        locationId: toLocationId,
        quantity: quantity,
        moveType: 'INTERNAL_MOVE',
        referenceType: 'RELOCATION',
        referenceId: code,
        documentLineId: null,
        createdBy: user.id,
      });

      await db.run('COMMIT');
      transactionOpen = false;

      res.status(201).json({ success: true, code, message: 'Điều chuyển vị trí nội bộ thành công' });
    } catch (e: any) {
      if (transactionOpen) await db.run('ROLLBACK');
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Lỗi khi điều chuyển vị trí' });
    } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  // ── Quét Serial theo dòng phiếu ────────────────────────────────────────────
  // Nguồn sự thật duy nhất vẫn là ô serialLot của dòng (complete-time registration
  // ghi bảng serials). Scan API validate + nối mã vào serialLot + cập nhật
  // processingStatus + chuyển phiếu sang PROCESSING.

  const ScanSchema = z.object({
    documentId: z.string().trim().min(1).max(191),
    documentLineId: z.string().trim().min(1).max(191),
    serial: z.string().trim().min(1).max(191),
  });

  const SerialEditSchema = z.object({
    documentId: z.string().trim().min(1).max(191),
    documentLineId: z.string().trim().min(1).max(191),
    serial: z.string().trim().min(1).max(191),
    replacement: z.string().trim().min(1).max(191).optional(),
  });

  router.post('/serials/edit', validate(SerialEditSchema), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, documentLineId, serial, replacement } = req.body;
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND documentId = ?', [documentLineId, documentId]);
      if (!doc || !line) return res.status(404).json({ error: 'Không tìm thấy phiếu hoặc dòng hàng' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING' && doc.status !== 'READY') return res.status(400).json({ error: 'Phiếu đã chốt, không thể sửa Serial' });
      const current = parseSerials(line.serialLot);
      const index = current.findIndex((value) => value.toLowerCase() === serial.toLowerCase());
      if (index < 0) return res.status(404).json({ error: `Không tìm thấy Serial ${serial} trên dòng hàng` });
      const next = replacement?.trim() || '';
      if (next && current.some((value, i) => i !== index && value.toLowerCase() === next.toLowerCase())) {
        return res.status(409).json({ error: `Serial ${next} đã có trong dòng hàng` });
      }
      await beginStockTransaction(db, [doc.warehouseId || doc.sourceWarehouseId].filter(Boolean) as string[]);
      transactionOpen = true;
      if (doc.docType === 'ISSUE' || doc.docType === 'TRANSFER') {
        const oldRow = await db.get(
          `SELECT * FROM stock_serials WHERE serialNumber = ? AND productId = ? AND warehouseId = ?
           AND stockStatus = 'RESERVED' AND issueDocumentId = ? AND issueLineId = ? LIMIT 1 FOR UPDATE`,
          [serial, line.productId, doc.docType === 'TRANSFER' ? doc.sourceWarehouseId : doc.warehouseId, doc.id, line.id]
        );
        if (!oldRow) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(400).json({ error: `Serial ${serial} không còn được giữ cho phiếu này` }); }
        if (next) {
          const newRow = await db.get(
            `SELECT * FROM stock_serials WHERE serialNumber = ? AND productId = ? AND warehouseId = ? AND status = 'SALEABLE'
             AND (stockStatus IS NULL OR stockStatus = 'IN_STOCK') LIMIT 1 FOR UPDATE`,
            [next, line.productId, doc.docType === 'TRANSFER' ? doc.sourceWarehouseId : doc.warehouseId]
          );
          if (!newRow) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(400).json({ error: `Serial ${next} không có trong tồn kho để thay thế` }); }
          await db.run(`UPDATE stock_serials SET stockStatus = 'IN_STOCK', issueDocumentId = NULL, issueLineId = NULL, updatedAt = ? WHERE id = ?`, [new Date().toISOString(), oldRow.id]);
          await db.run(`UPDATE stock_serials SET stockStatus = 'RESERVED', issueDocumentId = ?, issueLineId = ?, updatedAt = ? WHERE id = ?`, [doc.id, line.id, new Date().toISOString(), newRow.id]);
        } else {
          await db.run(`UPDATE stock_serials SET stockStatus = 'IN_STOCK', issueDocumentId = NULL, issueLineId = NULL, updatedAt = ? WHERE id = ?`, [new Date().toISOString(), oldRow.id]);
        }
      } else if (next) {
        const exists = await db.get('SELECT id FROM stock_serials WHERE serialNumber = ? LIMIT 1', [next]);
        if (exists) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(409).json({ error: `Serial ${next} đã tồn tại trong hệ thống` }); }
      }
      if (next) current[index] = next;
      else current.splice(index, 1);
      await db.run(`UPDATE stock_document_lines SET serialLot = ?, processingStatus = ? WHERE id = ?`, [current.join('\n'), current.length === Number(line.quantity) ? 'COMPLETED' : current.length > 0 ? 'PARTIAL' : 'PENDING', line.id]);
      await touchProcessing(documentId);
      await recordWarehouseActivity(db.run.bind(db), {
        actionType: next ? 'SERIAL_EDITED' : 'SERIAL_REMOVED', entityType: 'SERIAL', documentId,
        entityId: next || serial, productId: line.productId,
        warehouseId: doc.warehouseId || doc.sourceWarehouseId, userId: user.id,
        oldData: { serial, serials: parseSerials(line.serialLot) },
        newData: { replacement: next || null, serials: current },
        metadata: { documentLineId },
      });
      await db.run('COMMIT'); transactionOpen = false;
      return res.json({ success: true, serials: current });
    } catch (e: any) {
      if (transactionOpen) await db.run('ROLLBACK');
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Không thể sửa Serial' });
    }
  });

  async function appendLineSerial(line: any, serial: string, strictCount: boolean): Promise<{ count: number; completed: boolean }> {
    const current = parseSerials(line.serialLot);
    const next = [...current, serial.trim()];
    const qty = Number(line.quantity);
    // strict (quét từng chiếc): đủ khi count === qty. Legacy text flow cho
    // phép 1 mã phủ cả dòng SL>1 (lô) nên giữ rule nới lỏng ở complete-time.
    const completed = strictCount ? next.length === qty : (next.length === qty || (next.length === 1 && qty > 1));
    const joined = next.join('\n');
    await db.run(
      `UPDATE stock_document_lines SET serialLot = ?, processingStatus = ? WHERE id = ?`,
      [joined, completed ? 'COMPLETED' : 'PARTIAL', line.id]
    );
    return { count: next.length, completed };
  }

  async function touchProcessing(docId: string): Promise<void> {
    await db.run(`UPDATE stock_documents SET status = 'PROCESSING', updatedAt = ? WHERE id = ? AND status IN ('DRAFT', 'READY')`, [new Date().toISOString(), docId]);
  }

  router.post('/serials/scan', validate(ScanSchema), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, documentLineId, serial } = req.body;
      const code = String(serial).trim();
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      if (!doc || (doc.docType !== 'RECEIPT' && doc.docType !== 'RETURN')) return res.status(404).json({ error: 'Receipt or return not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft receipts/returns can be processed' });
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND documentId = ?', [documentLineId, documentId]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      const trackings = await productTrackings([line.productId]);
      if (Number(line.serialRequired) !== 1 && trackings.get(line.productId) !== 'SERIAL') {
        return res.status(400).json({ error: 'Sản phẩm không quản lý theo Serial' });
      }
      const qty = Number(line.quantity);
      const current = parseSerials(line.serialLot);
      if (current.some((s) => s.toLowerCase() === code.toLowerCase())) {
        return res.status(400).json({ error: 'Serial này đã được thêm vào phiếu' });
      }
      if (current.length >= qty) {
        return res.status(400).json({ error: `Phiếu yêu cầu ${qty} thiết bị, đã đủ ${current.length}/${qty}` });
      }
      const exists = await db.get('SELECT id FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
      if (exists) return res.status(409).json({ error: `Serial ${code} đã tồn tại trong hệ thống. Không thể quét lại thiết bị này; vui lòng kiểm tra phiếu nhập trước đó hoặc quét mã khác.` });

      await beginStockTransaction(db, [doc.warehouseId]);
      transactionOpen = true;
      try {
        const fresh = await db.get('SELECT * FROM stock_document_lines WHERE id = ? FOR UPDATE', [documentLineId]);
        if (!fresh) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(404).json({ error: 'Document line not found' }); }
        const freshSerials = parseSerials(fresh.serialLot);
        if (freshSerials.some((s) => s.toLowerCase() === code.toLowerCase())) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: 'Serial này đã được thêm vào phiếu' });
        }
        if (freshSerials.length >= qty) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: `Phiếu yêu cầu ${qty} thiết bị, đã đủ ${freshSerials.length}/${qty}` });
        }
        const dup = await db.get('SELECT id FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
        if (dup) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(409).json({ error: `Serial ${code} vừa được ghi nhận bởi người khác. Vui lòng quét lại mã khác.` });
        }
        const result = await appendLineSerial(fresh, code, true);
        await touchProcessing(documentId);
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'SERIAL_SCANNED_IN', entityType: 'SERIAL', documentId, entityId: code,
          productId: fresh.productId, warehouseId: doc.warehouseId, quantity: 1, userId: user.id,
          metadata: { documentLineId, serial: code, processingCount: result.count },
        });
        await db.run('COMMIT'); transactionOpen = false;
        res.status(201).json({ serial: code, count: result.count, required: qty, completed: result.completed });
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to scan serial' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/serials/scan-out', validate(ScanSchema), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, documentLineId, serial } = req.body;
      const code = String(serial).trim();
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      if (!doc || (doc.docType !== 'ISSUE' && doc.docType !== 'TRANSFER')) return res.status(404).json({ error: 'Issue or transfer not found' });
      const sourceWarehouseId = doc.docType === 'TRANSFER' ? doc.sourceWarehouseId : doc.warehouseId;
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft issues/transfers can be processed' });

      // Đối chiếu trực tiếp với lịch sử nhập: tồn tại + đúng SP + IN_STOCK + đúng kho + có nguồn nhập.
      const row = await db.get('SELECT * FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
      if (!row) return res.status(404).json({ error: 'Không tìm thấy Serial trong lịch sử nhập kho. Không được phép xuất thiết bị này.' });
      const line0 = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND documentId = ?', [documentLineId, documentId]);
      if (!line0) return res.status(404).json({ error: 'Document line not found' });
      if (row.productId !== line0.productId) {
        return res.status(400).json({ error: `Serial này thuộc sản phẩm ${row.productId}, không phải sản phẩm ${line0.productId} trên phiếu xuất.` });
      }
      if (!row.receiptDocumentId) {
        return res.status(400).json({ error: 'Serial chưa từng nhập kho. Không được phép xuất thiết bị này.' });
      }
      const stockState = row.stockStatus || 'IN_STOCK';
      if (stockState === 'OUT') {
        const issueDoc = row.issueDocumentId
          ? await db.get('SELECT code FROM stock_documents WHERE id = ?', [row.issueDocumentId]).catch(() => null)
          : null;
        return res.status(400).json({ error: `Serial này đã được xuất theo ${issueDoc?.code || 'phiếu khác'}` });
      }
      if (stockState === 'RESERVED' && row.issueDocumentId !== documentId) {
        const reservedDoc = row.issueDocumentId
          ? await db.get('SELECT code FROM stock_documents WHERE id = ?', [row.issueDocumentId]).catch(() => null)
          : null;
        return res.status(400).json({ error: `Serial đang được giữ cho ${reservedDoc?.code || 'một phiếu xuất khác'}.` });
      }
      if (row.warehouseId !== sourceWarehouseId) {
        return res.status(400).json({ error: `Serial hiện không nằm tại kho đang xuất (kho hiện tại: ${row.warehouseId}, kho xuất: ${sourceWarehouseId}).` });
      }
      const trackings = await productTrackings([line0.productId]);
      if (Number(line0.serialRequired) !== 1 && trackings.get(line0.productId) !== 'SERIAL') {
        return res.status(400).json({ error: 'Sản phẩm không quản lý theo Serial' });
      }
      const qty = Number(line0.quantity);
      const current = parseSerials(line0.serialLot);
      if (current.some((s) => s.toLowerCase() === code.toLowerCase())) {
        return res.status(400).json({ error: 'Serial này đã được thêm vào phiếu' });
      }
      if (current.length + 1 > qty) {
        return res.status(400).json({ error: `Phiếu yêu cầu ${qty} thiết bị, đã đủ ${current.length}/${qty}` });
      }

      await beginStockTransaction(db, [sourceWarehouseId]);
      transactionOpen = true;
      try {
        const locked = await db.get('SELECT * FROM stock_serials WHERE serialNumber = ? LIMIT 1 FOR UPDATE', [code]);
        const lockedState = locked?.stockStatus || 'IN_STOCK';
        if (!locked || (lockedState !== 'IN_STOCK' && !(lockedState === 'RESERVED' && locked?.issueDocumentId === documentId))) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(409).json({ error: 'Serial vừa bị giữ/xuất bởi người khác, hãy quét lại' });
        }
        if (locked.warehouseId !== sourceWarehouseId || locked.productId !== line0.productId) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: 'Serial không còn hợp lệ để xuất (sai kho/sản phẩm)' });
        }
        const fresh = await db.get('SELECT * FROM stock_document_lines WHERE id = ? FOR UPDATE', [documentLineId]);
        if (!fresh) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(404).json({ error: 'Document line not found' }); }
        const freshSerials = parseSerials(fresh.serialLot);
        if (freshSerials.some((s) => s.toLowerCase() === code.toLowerCase()) || freshSerials.length >= qty) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: 'Serial đã được thêm hoặc dòng đã đủ số lượng' });
        }
        await db.run(
          `UPDATE stock_serials SET stockStatus = 'RESERVED', issueDocumentId = ?, issueLineId = ?, updatedAt = ? WHERE id = ?`,
          [documentId, documentLineId, new Date().toISOString(), locked.id]
        );
        const result = await appendLineSerial(fresh, code, true);
        await touchProcessing(documentId);
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'SERIAL_SCANNED_OUT', entityType: 'SERIAL', documentId, entityId: locked.id,
          productId: fresh.productId, serialId: locked.id, warehouseId: sourceWarehouseId,
          quantity: -1, userId: user.id,
          metadata: { documentLineId, serial: code, processingCount: result.count },
        });
        await db.run('COMMIT'); transactionOpen = false;
        res.status(201).json({ serial: code, count: result.count, required: qty, completed: result.completed });
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to scan serial for issue' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });
  // ── Tiến độ xử lý + xác nhận số lượng + đăng ký lô ──────────────────────────

  /** Tiến độ từng dòng để SerialPage hiển thị: Yêu cầu / Đã xử lý / Còn thiếu / Đủ. */
  router.get('/documents/:id/progress', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const id = String(req.params.id);
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [id]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (!(await canReadDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const lines = await db.all(
        `SELECT l.*, p.name AS productName, p.tracking FROM stock_document_lines l
         LEFT JOIN products p ON p.id = l.productId WHERE l.documentId = ?`,
        [id]
      );
      const out = [];
      for (const line of lines || []) {
        const serialRequired = Number(line.serialRequired) === 1;
        const serialSkipped = Number(line.serialSkipped) === 1;
        const tracking = serialSkipped ? 'QUANTITY' : serialRequired ? 'SERIAL' : resolveTracking((line as any).tracking);
        const required = Number(line.quantity);
        let processed = 0;
        let lots: any[] = [];
        if (tracking === 'SERIAL' || tracking === 'LOT') {
          const serials = parseSerials(line.serialLot);
          processed = serials.length;
          if (tracking === 'LOT') {
            if (doc.docType === 'ISSUE' || doc.docType === 'TRANSFER') {
              lots = await db.all(
                `SELECT s.id, s.lotCode, s.coilCode, s.initialQty, s.remainingQty, s.unit, s.status, a.quantity AS allocatedQty
                 FROM stock_document_line_lots a INNER JOIN stock_lots s ON s.id = a.lotId
                 WHERE a.documentLineId = ? ORDER BY s.createdAt ASC, s.id ASC`,
                [line.id]
              ).catch(() => []);
              const covered = (lots || []).reduce((s: number, r: any) => s + Number(r.allocatedQty || 0), 0);
              processed = covered;
            } else {
              lots = await db.all(
                'SELECT id, lotCode, coilCode, initialQty, remainingQty, unit, status FROM stock_lots WHERE receiptDocumentId = ? AND receiptLineId = ? ORDER BY createdAt ASC',
                [id, line.id]
              ).catch(() => []);
              const covered = (lots || []).reduce((s: number, r: any) => s + Number(r.initialQty || 0), 0);
              processed = Math.min(covered, required);
            }
          }
        } else {
          processed = line.actualQty === null || line.actualQty === undefined ? 0 : Number(line.actualQty);
        }
        const completed = tracking === 'QUANTITY'
          ? (line.processingStatus === 'COMPLETED')
          : tracking === 'LOT'
            ? (processed >= required)
            : processed === required;
        let availability: any = null;
        if (doc.docType === 'ISSUE') {
          availability = await db.get(
            `SELECT COALESCE(SUM(onHand), 0) AS onHand, COALESCE(SUM(reserved), 0) AS reserved,
                    COALESCE(SUM(onHand - reserved), 0) AS available
             FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ?`,
            [line.productId, doc.warehouseId, line.locationId || '']
          ).catch(() => ({ onHand: 0, reserved: 0, available: 0 }));
          const issueQty = tracking === 'QUANTITY' && line.actualQty !== null && line.actualQty !== undefined
            ? Number(line.actualQty) : required;
          availability = { ...availability, afterIssue: Number(availability.available || 0) - issueQty };
        }
        out.push({
          lineId: line.id, productId: line.productId,
          productName: (line as any).productName || line.productId,
          required, processed, tracking, lots,
          serials: (tracking === 'SERIAL' || tracking === 'LOT') ? parseSerials(line.serialLot) : [],
          serialSkipped,
          quantityConfirmed: tracking === 'SERIAL'
            ? (line.processingStatus !== 'PENDING' || parseSerials(line.serialLot).length > 0)
            : tracking === 'QUANTITY' ? line.processingStatus === 'COMPLETED' : false,
          actualQty: line.actualQty ?? null, varianceQty: line.varianceQty ?? null,
          availability,
          status: completed ? 'COMPLETED' : (processed > 0 ? 'PARTIAL' : 'PENDING'),
        });
      }
      res.json({
        documentId: id, code: doc.code, status: doc.status,
        lines: out, allCompleted: out.length > 0 && out.every((l: any) => l.status === 'COMPLETED'),
      });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch processing progress' }); }
  });

  router.post('/lines/:id/confirm-qty', validate(z.object({
    actualQty: z.number().finite().min(0).max(1_000_000_000),
    varianceReason: z.string().trim().max(500).nullable().optional(),
  })), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ?', [String(req.params.id)]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [line.documentId]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft documents can be processed' });
      const trackings = await productTrackings([line.productId]);
      const tracking = trackings.get(line.productId);
      if (Number(line.serialRequired) === 1 || tracking === 'SERIAL') {
        const expected = Number(line.quantity);
        const actual = Number(req.body.actualQty);
        if (actual !== expected) {
          return res.status(400).json({ error: `Hàng quản lý theo Serial phải xác nhận đủ ${expected} sản phẩm trước khi quét Serial.` });
        }
        await beginStockTransaction(db, [doc.warehouseId || doc.sourceWarehouseId].filter(Boolean) as string[]);
        transactionOpen = true;
        try {
          await db.run(
            `UPDATE stock_document_lines SET actualQty = NULL, varianceQty = NULL, varianceReason = NULL,
             processingStatus = CASE WHEN processingStatus = 'COMPLETED' THEN 'COMPLETED' ELSE 'PARTIAL' END WHERE id = ?`,
            [line.id]
          );
          await touchProcessing(doc.id);
          await recordWarehouseActivity(db.run.bind(db), {
            actionType: 'QUANTITY_CONFIRMED', entityType: 'DOCUMENT_LINE', entityId: line.id,
            documentId: doc.id, documentCode: doc.code, productId: line.productId,
            warehouseId: doc.warehouseId || doc.sourceWarehouseId, quantity: expected, userId: user.id,
            metadata: { tracking, serialRequired: true, actualQty: expected },
          });
          await db.run('COMMIT'); transactionOpen = false;
          return res.json({ quantityConfirmed: true, requiredQty: expected });
        } catch (e) {
          await db.run('ROLLBACK'); transactionOpen = false;
          throw e;
        }
      }
      if (tracking !== 'QUANTITY') {
        return res.status(400).json({ error: 'Chỉ hàng quản lý theo số lượng mới xác nhận tay (SERIAL/LOT phải quét/đăng ký)' });
      }
      const actual = Number(req.body.actualQty);
      const variance = actual - Number(line.quantity);
      if (variance !== 0 && !req.body.varianceReason?.trim()) {
        return res.status(400).json({ error: 'Số thực nhận lệch chứng từ — vui lòng nhập lý do chênh lệch' });
      }
      await beginStockTransaction(db, [doc.warehouseId || doc.sourceWarehouseId].filter(Boolean) as string[]);
      transactionOpen = true;
      try {
        await db.run(
          `UPDATE stock_document_lines SET actualQty = ?, varianceQty = ?, varianceReason = ?, processingStatus = 'COMPLETED' WHERE id = ?`,
          [actual, variance, req.body.varianceReason?.trim() || null, line.id]
        );
        await touchProcessing(doc.id);
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'QUANTITY_CONFIRMED', entityType: 'DOCUMENT_LINE', entityId: line.id,
          documentId: doc.id, documentCode: doc.code, productId: line.productId,
          warehouseId: doc.warehouseId || doc.sourceWarehouseId, quantity: actual, userId: user.id,
          metadata: { tracking, expectedQty: Number(line.quantity), actualQty: actual, variance, varianceReason: req.body.varianceReason?.trim() || null },
        });
        await db.run('COMMIT'); transactionOpen = false;
        res.json({ actualQty: actual, varianceQty: variance });
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to confirm quantity' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/lines/:id/confirm-no-serial', validate(z.object({
    actualQty: z.number().finite().min(0).max(1_000_000_000),
    varianceReason: z.string().trim().max(500).nullable().optional(),
  })), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ?', [String(req.params.id)]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [line.documentId]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Phiếu không còn ở bước xử lý hàng hóa' });
      if (Number(line.serialRequired) !== 1) return res.status(400).json({ error: 'Dòng này không yêu cầu lựa chọn bỏ qua Serial' });
      const actual = Number(req.body.actualQty);
      const variance = actual - Number(line.quantity);
      if (variance !== 0 && !req.body.varianceReason?.trim()) {
        return res.status(400).json({ error: 'Số lượng thực nhận lệch phiếu — vui lòng nhập lý do' });
      }
      await beginStockTransaction(db, [doc.warehouseId || doc.sourceWarehouseId].filter(Boolean) as string[]);
      transactionOpen = true;
      await db.run(
        `UPDATE stock_document_lines SET serialSkipped = 1, actualQty = ?, varianceQty = ?, varianceReason = ?, processingStatus = 'COMPLETED' WHERE id = ?`,
        [actual, variance, req.body.varianceReason?.trim() || 'Hàng hóa không có Serial', line.id]
      );
      await touchProcessing(doc.id);
      await recordWarehouseActivity(db.run.bind(db), {
        actionType: 'SERIAL_SKIPPED', entityType: 'DOCUMENT_LINE', entityId: line.id,
        documentId: doc.id, documentCode: doc.code, productId: line.productId,
        warehouseId: doc.warehouseId || doc.sourceWarehouseId, quantity: actual, userId: user.id,
        metadata: { expectedQty: Number(line.quantity), actualQty: actual, variance, reason: req.body.varianceReason?.trim() || 'Hàng hóa không có Serial' },
      });
      await db.run('COMMIT'); transactionOpen = false;
      return res.json({ success: true, serialSkipped: true, actualQty: actual, varianceQty: variance });
    } catch (e: any) {
      if (transactionOpen) await db.run('ROLLBACK');
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to confirm line without serial' });
    }
  });

  router.post('/lots/allocate', validate(z.object({
    documentId: z.string().trim().min(1).max(191),
    documentLineId: z.string().trim().min(1).max(191),
    lotCode: z.string().trim().min(1).max(191),
    quantity: z.number().finite().positive().max(1_000_000_000),
  })), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, documentLineId, lotCode, quantity } = req.body;
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      if (!doc || (doc.docType !== 'ISSUE' && doc.docType !== 'TRANSFER')) return res.status(404).json({ error: 'Issue or transfer not found' });
      const allocationWarehouseId = doc.docType === 'TRANSFER' ? doc.sourceWarehouseId : doc.warehouseId;
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft issues/transfers can be processed' });
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND documentId = ?', [documentLineId, documentId]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      if ((await productTrackings([line.productId])).get(line.productId) !== 'LOT') {
        return res.status(400).json({ error: 'Sản phẩm không quản lý theo Lô/Cuộn' });
      }

      await beginStockTransaction(db, [allocationWarehouseId]);
      transactionOpen = true;
      try {
        const lot = await db.get(
          `SELECT * FROM stock_lots
           WHERE lotCode = ? AND productId = ? AND warehouseId = ? AND status IN ('ACTIVE', 'DEPLETED')
           LIMIT 1 FOR UPDATE`,
          [lotCode, line.productId, allocationWarehouseId]
        );
        if (!lot) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(404).json({ error: `Không tìm thấy lô ${lotCode} trong kho` });
        }
        const existing = await db.get(
          'SELECT quantity FROM stock_document_line_lots WHERE documentLineId = ? AND lotId = ? FOR UPDATE',
          [documentLineId, lot.id]
        );
        const totalRow = await db.get(
          'SELECT COALESCE(SUM(quantity), 0) AS total FROM stock_document_line_lots WHERE documentLineId = ?',
          [documentLineId]
        );
        const oldQty = Number(existing?.quantity || 0);
        const total = Number(totalRow?.total || 0);
        const nextTotal = total + Number(quantity);
        if (nextTotal > Number(line.quantity)) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: `Dòng chỉ yêu cầu ${Number(line.quantity)}, đã phân bổ ${total}` });
        }
        if (Number(lot.remainingQty || 0) - oldQty < Number(quantity)) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: `Lô ${lotCode} chỉ còn ${Number(lot.remainingQty || 0)}, không đủ phân bổ ${Number(quantity)}` });
        }
        const now = new Date().toISOString();
        if (existing) {
          await db.run(
            'UPDATE stock_document_line_lots SET quantity = quantity + ?, createdBy = ?, createdAt = ? WHERE documentLineId = ? AND lotId = ?',
            [Number(quantity), user.id, now, documentLineId, lot.id]
          );
        } else {
          await db.run(
            `INSERT INTO stock_document_line_lots (id, documentLineId, lotId, quantity, createdBy, createdAt)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [randomUUID(), documentLineId, lot.id, Number(quantity), user.id, now]
          );
        }
        await db.run(
          `UPDATE stock_document_lines SET serialLot = ?, processingStatus = ? WHERE id = ?`,
          [lotCode, nextTotal >= Number(line.quantity) ? 'COMPLETED' : 'PARTIAL', documentLineId]
        );
        await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ? AND status = \'DRAFT\'', ['PROCESSING', now, documentId]);
        await db.run('COMMIT'); transactionOpen = false;
        return res.status(201).json({ lotCode, allocated: nextTotal, required: Number(line.quantity), completed: nextTotal >= Number(line.quantity) });
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
    } catch (e: any) {
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to allocate lot' });
    } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/lots/register', validate(z.object({
    documentId: z.string().trim().min(1).max(191),
    documentLineId: z.string().trim().min(1).max(191),
    lotCode: z.string().trim().min(1).max(191),
    coilCode: z.string().trim().max(191).nullable().optional(),
    quantity: z.number().finite().positive().max(1_000_000_000),
    unit: z.string().trim().max(32).nullable().optional(),
    manufacturedAt: z.string().trim().max(40).nullable().optional(),
    supplier: z.string().trim().max(300).nullable().optional(),
  })), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, documentLineId, lotCode, coilCode, quantity, unit, manufacturedAt, supplier } = req.body;
      const code = String(lotCode).trim();
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      if (!doc || doc.docType !== 'RECEIPT') return res.status(404).json({ error: 'Receipt not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft receipts can be processed' });
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND documentId = ?', [documentLineId, documentId]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      const trackings = await productTrackings([line.productId]);
      if (trackings.get(line.productId) !== 'LOT') {
        return res.status(400).json({ error: 'Sản phẩm không quản lý theo Lô/Cuộn' });
      }
      const qty = Number(quantity);
      await beginStockTransaction(db, [doc.warehouseId]);
      transactionOpen = true;
      try {
        const dup = await db.get(
          'SELECT id FROM stock_lots WHERE productId = ? AND warehouseId = ? AND lotCode = ? LIMIT 1',
          [line.productId, doc.warehouseId, code]
        );
        if (dup) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(409).json({ error: `Lô ${code} đã tồn tại trong kho` });
        }
        const coveredBefore = await db.get(
          'SELECT COALESCE(SUM(initialQty), 0) AS covered FROM stock_lots WHERE receiptDocumentId = ? AND receiptLineId = ?',
          [documentId, documentLineId]
        );
        if (Number(coveredBefore?.covered || 0) + qty > Number(line.quantity)) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: `Dòng chỉ yêu cầu ${Number(line.quantity)}, không thể đăng ký thêm ${qty}` });
        }
        const now = new Date().toISOString();
        const lotId = randomUUID();
        await db.run(
          `INSERT INTO stock_lots (id, productId, lotCode, coilCode, warehouseId, locationId, initialQty, remainingQty, unit, manufacturedAt, supplier, receiptDocumentId, receiptLineId, status, createdBy, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
          [lotId, line.productId, code, coilCode?.trim() || null, doc.warehouseId, line.locationId || null,
            qty, qty, unit?.trim() || null, manufacturedAt?.trim() || null, supplier?.trim() || doc.partnerName || null,
            documentId, documentLineId, user.id, now, now]
        );
        await db.run(
          `INSERT INTO stock_lot_movements (id, lotId, productId, warehouseId, quantity, moveType, referenceType, referenceId, documentLineId, createdBy, createdAt)
           VALUES (?, ?, ?, ?, ?, 'RECEIPT', 'RECEIPT', ?, ?, ?, ?)`,
          [randomUUID(), lotId, line.productId, doc.warehouseId, qty, documentId, documentLineId, user.id, now]
        );
        // Giữ text serialLot đồng bộ để luồng complete-time tương thích.
        const fresh = await db.get('SELECT serialLot FROM stock_document_lines WHERE id = ? FOR UPDATE', [documentLineId]);
        const existing = parseSerials(fresh?.serialLot);
        if (!existing.some((s) => s.toLowerCase() === code.toLowerCase())) {
          await db.run('UPDATE stock_document_lines SET serialLot = ? WHERE id = ?',
            [existing.length > 0 ? `${fresh.serialLot}\n${code}` : code, documentLineId]);
        }
        const covered = await db.all(
          'SELECT COALESCE(SUM(initialQty), 0) AS covered FROM stock_lots WHERE receiptDocumentId = ? AND receiptLineId = ?',
          [documentId, documentLineId]
        ).catch(() => []);
        const total = Number(covered?.[0]?.covered ?? 0);
        await db.run(
          `UPDATE stock_document_lines SET processingStatus = ? WHERE id = ?`,
          [total >= Number(line.quantity) ? 'COMPLETED' : 'PARTIAL', documentLineId]
        );
        await touchProcessing(documentId);
        await db.run('COMMIT'); transactionOpen = false;
        res.status(201).json({ lotId, lotCode: code, covered: total, required: Number(line.quantity) });
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to register lot' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });
  return router;
}
