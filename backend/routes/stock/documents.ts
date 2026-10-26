import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import { adjustReserved } from '../../utils/stockReserved.js';
import { resolveTracking } from '../../utils/tracking.js';
import { getWarrantyStartType, resolveWarrantyStart } from '../../utils/warranty.js';
import type { StockContext } from './context.js';

export function documentsRoutes(ctx: StockContext) {
  const { db, listScope, isDirector, requireWarehouse, requireWarehouseManager, docWarehouseIds, canReadDocument, canWriteDocument, assertLocation, availableOf, saleableLocationSet, assertNotCounting, postMove, postMoves, recordWarehouseActivity, resolveAccountingDefaults, docCode, nextDocCode, paginationOf } = ctx;
  const router = Router();
  // VAT mặc định theo quy ước nghiệp vụ hiện tại. Người có thẩm quyền vẫn có
  // thể thay đổi trên từng dòng; không dùng mã tài khoản mặc định cứng.
  const DEFAULT_VAT_RATE = 8;
  // ── Chứng từ: danh sách ─────────────────────────────────────────────────────

  router.get('/documents', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { docType, status, warehouseId, from, to, sortOrder } = req.query as Record<string, string | undefined>;
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
      const normalizedSortOrder = (sortOrder || 'desc').trim().toLowerCase();
      if (normalizedSortOrder !== 'asc' && normalizedSortOrder !== 'desc') {
        return res.status(400).json({ error: 'Thứ tự sắp xếp ngày không hợp lệ' });
      }
      // Sắp xếp thực hiện ở DB trước phân trang để "cũ nhất" vẫn chính xác
      // trên toàn bộ phiếu, không chỉ các dòng của trang hiện tại.
      query += ` ORDER BY d.createdAt ${normalizedSortOrder.toUpperCase()}`;
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
           p.name AS productName, p.importCode AS productSku, p.unit, p.origin, p.category, p.tracking,
           loc.code AS locationCode, loc.name AS locationName
         FROM stock_document_lines l
         LEFT JOIN products p ON p.id = l.productId
         LEFT JOIN stock_locations loc ON loc.id = l.locationId
         WHERE l.documentId = ?`,
        [id]
      );

      // Phiếu trả không nhập tay nguồn gốc hàng. Thông tin đơn vị/ngày nhập
      // phải được truy vết theo Serial qua sổ stock_moves để vẫn đúng sau khi
      // Serial đã được chuyển kho, xuất, hoặc trả về một kho khác.
      let returnTrace: {
        sourceIssue: { code: string | null; shippedAt: string | null } | null;
        receiptSources: Array<{ documentId: string; code: string | null; partnerCode: string | null; partnerName: string | null; receivedAt: string | null }>;
      } | null = null;
      if (doc.docType === 'RETURN') {
        const serialNumbers = [...new Set((lines || []).flatMap((line: any) => parseSerials(line.serialLot)))];
        const sourceIssue = doc.referenceId
          ? await db.get(
            `SELECT code, COALESCE(docDate, postingDate, createdAt) AS shippedAt
             FROM stock_documents WHERE id = ? AND docType = 'ISSUE'`,
            [doc.referenceId]
          )
          : null;

        let receiptSources: Array<{ documentId: string; code: string | null; partnerCode: string | null; partnerName: string | null; receivedAt: string | null }> = [];
        if (serialNumbers.length > 0) {
          const serialRows = await db.all(
            `SELECT id FROM stock_serials WHERE serialNumber IN (${serialNumbers.map(() => '?').join(', ')})`,
            serialNumbers
          );
          const serialIds = [...new Set((serialRows || []).map((row: any) => row.id).filter(Boolean))];
          if (serialIds.length > 0) {
            const receiptMoves = await db.all(
              `SELECT sm.serialId, d.id AS documentId, d.code, d.partnerCode, d.partnerName,
                      COALESCE(d.docDate, d.postingDate, d.createdAt) AS receivedAt
               FROM stock_moves sm
               JOIN stock_documents d ON d.id = sm.referenceId AND d.docType = 'RECEIPT'
               WHERE sm.serialId IN (${serialIds.map(() => '?').join(', ')})
                 AND sm.moveType = 'RECEIPT'
               ORDER BY sm.createdAt ASC`,
              serialIds
            );
            // Một Serial có thể đi qua nhiều vòng nhận/xuất/trả. Chỉ lấy lần
            // nhận đầu tiên để hiển thị nguồn nhập ban đầu của thiết bị.
            const firstReceiptBySerial = new Map<string, any>();
            for (const row of receiptMoves || []) {
              if (!firstReceiptBySerial.has(row.serialId)) firstReceiptBySerial.set(row.serialId, row);
            }
            const sourceByDocument = new Map<string, any>();
            for (const row of firstReceiptBySerial.values()) {
              if (!sourceByDocument.has(row.documentId)) sourceByDocument.set(row.documentId, row);
            }
            receiptSources = [...sourceByDocument.values()].map((row: any) => ({
              documentId: row.documentId,
              code: row.code ?? null,
              partnerCode: row.partnerCode ?? null,
              partnerName: row.partnerName ?? null,
              receivedAt: row.receivedAt ?? null,
            }));
          }
        }
        returnTrace = {
          sourceIssue: sourceIssue ? { code: sourceIssue.code ?? null, shippedAt: sourceIssue.shippedAt ?? null } : null,
          receiptSources,
        };
      }
      const reservationLinks = doc.docType === 'ISSUE' ? await loadIssueReservationLinks(id) : [];
      res.json({ ...doc, lines, reservationLinks, returnTrace });
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
      await beginStockTransaction(db, docWarehouseIds(doc));
      try {
        await dropDocReservationLinks(id);
        await releaseReservedSerials(id);
        await dropDocLots(id);
        await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?', ['CANCELLED', new Date().toISOString(), id]);
        await db.run('COMMIT');
      } catch (err) {
        await db.run('ROLLBACK');
        throw err;
      }
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
      await beginStockTransaction(db, docWarehouseIds(doc));
      try {
        await dropDocReservationLinks(id);
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

      await beginStockTransaction(db, docWarehouseIds(doc));
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
          );
          await dropDocReservationLinks(id);
          await db.run('DELETE FROM stock_document_lines WHERE documentId = ?', [id]);
          const newLineIds: { id: string; productId: string; locationId: string; quantity: number }[] = [];
          for (const line of body.lines) {
            const q = Number(line.quantity) || 0;
            const p = Number(line.unitPrice) || 0;
            const rate = canEditFinancials && line.vatRate !== undefined ? Number(line.vatRate) : DEFAULT_VAT_RATE;
            const linePreTax = q * p;
            const lineVat = canEditFinancials && line.vatAmount !== undefined ? Number(line.vatAmount) : (linePreTax * rate / 100);
            const lineTotal = canEditFinancials && line.totalAmount !== undefined ? Number(line.totalAmount) : (linePreTax + lineVat);
            computedPreTax += linePreTax;
            computedVat += lineVat;
            // Mọi dòng hàng đều truy vết bằng Serial, kể cả phiếu cũ được sửa lại.
            const serialRequired = true;
            const codes = parseSerials(line.serialLot);
            const st = codes.length === q ? 'COMPLETED' : codes.length > 0 ? 'PARTIAL' : 'PENDING';
            const newId = randomUUID();
            newLineIds.push({ id: newId, productId: line.productId, locationId: line.locationId || '', quantity: q });
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
          );
          for (const lot of docLots || []) {
            const target = newLineIds.find((l) =>
              l.productId === (lot as any).productId && l.locationId === ((lot as any).locationId || ''));
            if (target) {
              await db.run('UPDATE stock_lots SET receiptLineId = ? WHERE id = ?', [target.id, (lot as any).id]);
            }
          }
          if (doc.docType === 'ISSUE') {
            await syncDocumentReservationLinks(lineWh, body.lines, newLineIds);
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
    reservationIds: z.array(z.string().trim().min(1).max(191)).max(100).optional(),
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

    // Phiếu trả không yêu cầu người dùng chọn PXK từ lúc tạo. PXK và đơn vị
    // trả được xác định tự động khi quét Serial đầu tiên, để hỗ trợ trả lẻ
    // (ví dụ đã xuất 5 thiết bị nhưng chỉ nhận trả 1 thiết bị).
    if (docType === 'RETURN') {
      if (!String(body.notes || '').trim()) {
        throw Object.assign(new Error('Phiếu trả cần nhập lý do trả hàng.'), { status: 400 });
      }
      // Không nhận tham chiếu do client gửi lên: nguồn trả chỉ được tin từ
      // stock_serials sau khi kiểm tra Serial đang OUT.
      body.referenceId = null;
      body.referenceType = null;
    }

    // Khóa cả 2 đầu của TRANSFER; không khóa toàn bảng warehouses vì mọi
    // luồng tạo phiếu khác sẽ bị xếp hàng chờ.
    const lockWarehouseIds = [warehouses.warehouseId, warehouses.sourceWarehouseId, warehouses.destWarehouseId].filter(Boolean) as string[];
    await beginStockTransaction(db, lockWarehouseIds);
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
      const savedLines: { id: string; productId: string; locationId: string; quantity: number }[] = [];
      for (const line of body.lines) {
        const q = Number(line.quantity) || 0;
        const p = Number(line.unitPrice) || 0;
        const rate = canEditFinancials && line.vatRate !== undefined ? Number(line.vatRate) : DEFAULT_VAT_RATE;
        const linePreTax = q * p;
        const lineVat = canEditFinancials && line.vatAmount !== undefined ? Number(line.vatAmount) : (linePreTax * rate / 100);
        const lineTotal = canEditFinancials && line.totalAmount !== undefined ? Number(line.totalAmount) : (linePreTax + lineVat);
        const lineId = randomUUID();
        savedLines.push({ id: lineId, productId: line.productId, locationId: line.locationId || '', quantity: q });
        await db.run(
          `INSERT INTO stock_document_lines (
            id, documentId, productId, quantity, unitPrice, locationId, note,
            accountDebit, accountCredit, vatRate, vatAmount, totalAmount, projectId, costItem, serialLot, costObjectId, serialRequired
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            lineId, id, line.productId, q, p, line.locationId ?? null, line.note ?? null,
            (requireWarehouseManager(user) ? line.accountDebit : null) || (await resolveAccountingDefaults(line.productId, body.partnerCode || body.partnerName, line.projectId)).accountDebit,
            (requireWarehouseManager(user) ? line.accountCredit : null) || (await resolveAccountingDefaults(line.productId, body.partnerCode || body.partnerName, line.projectId)).accountCredit,
            rate, lineVat, lineTotal, line.projectId ?? null,
            requireWarehouseManager(user) ? line.costItem ?? null : null,
            line.serialLot ?? null, requireWarehouseManager(user) ? line.costObjectId ?? null : null, 1
          ]
        );
      }
      if (docType === 'ISSUE') {
        await syncDocumentReservationLinks(
          warehouses.warehouseId || warehouses.sourceWarehouseId || '',
          body.lines,
          savedLines
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
        await beginStockTransaction(db, lockWarehouseIds);
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
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || !(quantity > 0)) return `Số lượng của sản phẩm ${line.productId} phải lớn hơn 0.`;
      if (!Number.isInteger(quantity)) return `Số lượng của sản phẩm ${line.productId} phải là số nguyên vì mỗi đơn vị cần quét một Serial riêng.`;
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

  /** Dòng có bắt buộc quản lý theo Serial? (tracking SERIAL hoặc cờ legacy serialRequired) */
  function requiresSerial(line: any, tracking: string): boolean {
    return Number(line?.serialRequired) === 1 || tracking === 'SERIAL';
  }

  /** Số lượng đã đăng ký (nhập) hoặc phân bổ (xuất/điều chuyển) theo Lô của dòng. */
  async function lotCoverage(doc: any, line: any): Promise<number> {
    if (doc.docType === 'RECEIPT') {
      const row = await db.get(
        `SELECT COALESCE(SUM(initialQty), 0) AS total FROM stock_lots
         WHERE receiptDocumentId = ? AND receiptLineId = ?`,
        [doc.id, line.id]
      ).catch(() => undefined);
      return Number(row?.total || 0);
    }
    const row = await db.get(
      `SELECT COALESCE(SUM(quantity), 0) AS total FROM stock_document_line_lots
       WHERE documentLineId = ?`,
      [line.id]
    ).catch(() => undefined);
    return Number(row?.total || 0);
  }

  /** Chốt hoàn tất theo từng dòng, tính lại từ DB (không tin client).
   * SERIAL: đủ serial từng chiếc; LOT: đủ số lượng đã đăng ký/phân bổ lô;
   * QUANTITY: chỉ kiểm tra tồn khi xuất. */
  async function canComplete(doc: any, lines: any[], reservationCredit?: Map<string, number>): Promise<{ ok: boolean; message?: string }> {
    const trackings = await productTrackings(lines.map((line) => line.productId));
    for (const line of lines) {
      const tracking = trackings.get(line.productId) || 'QUANTITY';
      const qty = Number(line.quantity);
      const label = line.productId;
      if (requiresSerial(line, tracking) && Number(line.serialSkipped) !== 1) {
        const serials = parseSerials(line.serialLot);
        if (serials.length !== qty) {
          if (serials.length === 0) {
            return { ok: false, message: `Chưa đủ Serial: dòng ${label} mới có 0/${qty}. Vui lòng mở Xử lý hàng hóa và quét đủ Serial trước khi hoàn tất.` };
          }
          return { ok: false, message: `Chưa đủ Serial: dòng ${label} mới có ${serials.length}/${qty}. Vui lòng tiếp tục xử lý hàng hóa để quét đủ Serial.` };
        }
        continue;
      }
      if (tracking === 'LOT' && doc.docType !== 'RETURN') {
        const covered = await lotCoverage(doc, line);
        if (covered < qty) {
          return { ok: false, message: `Chưa đủ Lô: dòng ${label} mới phân bổ ${covered}/${qty}. Vui lòng chọn đủ lô trước khi hoàn tất.` };
        }
      }
    }
    if (doc.docType === 'ISSUE') {
      const aggregate = aggregateLines(lines);
      const available = await availableMap(doc.warehouseId, aggregate.map((line) => ({ productId: line.productId, locationId: line.locationId || '' })));
      for (const line of aggregate) {
        const key = `${line.productId}|${line.locationId || ''}`;
        const current = (available.get(key) ?? 0) + (reservationCredit?.get(key) ?? 0);
        if (current < Number(line.quantity)) {
          return { ok: false, message: await insufficientStockMessage(doc.warehouseId, line, current) };
        }
      }
    }
    return { ok: true };
  }

  async function assertProcessable(doc: any, lines: any[], reservationCredit?: Map<string, number>): Promise<void> {
    const r = await canComplete(doc, lines, reservationCredit);
    if (!r.ok) throw Object.assign(new Error(r.message), { status: 400 });
  }

  /** Kiểm tra điều kiện ghi sổ theo đúng thứ tự ưu tiên: kho đang kiểm kê (409)
   * phải được báo trước mọi lỗi chi tiết dòng hàng (thiếu Serial, thiếu tồn...).
   * `warehouseId` là kho thực sự bị ghi sổ ở bước này (ship = nguồn, receive = đích). */
  async function preflightPosting(doc: any, lines: any[], warehouseId: string, reservationCredit?: Map<string, number>): Promise<void> {
    if (warehouseId) await assertNotCounting(warehouseId);
    await assertProcessable(doc, lines, reservationCredit);
  }

  /** Phiếu đã bắt đầu xử lý Serial/Lot? (serial đã gắn hoặc dòng đã PARTIAL/COMPLETED) */
  async function processingStarted(documentId: string): Promise<boolean> {
    const s = await db.get(
      'SELECT id FROM stock_serials WHERE receiptDocumentId = ? OR issueDocumentId = ? LIMIT 1',
      [documentId, documentId]
    );
    if (s) return true;
    const l = await db.get(
      `SELECT id FROM stock_document_lines WHERE documentId = ? AND processingStatus <> 'PENDING' LIMIT 1`,
      [documentId]
    );
    return !!l;
  }

  /** Reset xử lý nhưng không phá lịch sử Serial của hàng xuất/điều chuyển.
   * Phiếu nhập nháp chỉ được xóa Serial do chính nó tạo; phiếu xuất/điều chuyển
   * chỉ nhả RESERVED về IN_STOCK. */
  async function resetDocProcessing(documentId: string): Promise<void> {
    const doc = await db.get('SELECT docType FROM stock_documents WHERE id = ?', [documentId]);
    const issued = await db.get(
      `SELECT id FROM stock_serials WHERE receiptDocumentId = ? AND stockStatus = 'OUT' LIMIT 1`,
      [documentId]
    );
    if (issued) {
      throw Object.assign(new Error('Serial của phiếu đã xuất kho, không thể reset xử lý. Hãy dùng phiếu điều chỉnh/trả hàng.'), { status: 409 });
    }
    if (doc?.docType === 'RECEIPT') {
      await db.run(`DELETE FROM stock_serials WHERE receiptDocumentId = ? AND stockStatus IN ('IN_STOCK', 'RESERVED')`, [documentId]);
    } else {
      await releaseReservedSerials(documentId);
    }
    await db.run(`DELETE FROM stock_lot_movements WHERE referenceId = ?`, [documentId]);
    await db.run(`DELETE FROM stock_lots WHERE receiptDocumentId = ?`, [documentId]);
    await db.run(
      `DELETE a FROM stock_document_line_lots a
       INNER JOIN stock_document_lines l ON l.id = a.documentLineId
       WHERE l.documentId = ?`,
      [documentId]
    );
    await db.run(
      `UPDATE stock_document_lines SET processingStatus = 'PENDING', actualQty = NULL, varianceQty = NULL, varianceReason = NULL WHERE documentId = ?`,
      [documentId]
    );
  }

  /** Dọn lô/cuộn của phiếu hủy/xóa (chưa từng nhập kho chính thức). */
  async function dropDocLots(documentId: string): Promise<void> {
    await db.run(`DELETE FROM stock_lot_movements WHERE referenceId = ?`, [documentId]);
    await db.run(`DELETE FROM stock_lots WHERE receiptDocumentId = ?`, [documentId]);
    await db.run(
      `DELETE a FROM stock_document_line_lots a
       INNER JOIN stock_document_lines l ON l.id = a.documentLineId
       WHERE l.documentId = ?`,
      [documentId]
    );
  }

  /** Nhả serial đang RESERVED cho phiếu (hủy/xóa nháp): về IN_STOCK, xóa link xuất. */
  async function releaseReservedSerials(documentId: string): Promise<void> {
    await db.run(
      `UPDATE stock_serials SET stockStatus = 'IN_STOCK', issueDocumentId = NULL, issueLineId = NULL, updatedAt = ? WHERE issueDocumentId = ? AND stockStatus = 'RESERVED'`,
      [new Date().toISOString(), documentId]
    );
  }

  /** Bỏ liên kết giữ hàng của phiếu nhưng KHÔNG nhả reservation.
   * Reservation vẫn HELD để người dùng có thể gắn cho phiếu xuất khác. */
  async function dropDocReservationLinks(documentId: string): Promise<void> {
    await db.run(
      `DELETE rl FROM stock_document_line_reservations rl
       INNER JOIN stock_document_lines l ON l.id = rl.documentLineId
       WHERE l.documentId = ?`,
      [documentId]
    );
  }

  /** Liên kết giữ hàng còn hiệu lực của một phiếu xuất, kèm dữ liệu reservation. */
  async function loadIssueReservationLinks(documentId: string): Promise<any[]> {
    return db.all(
      `SELECT rl.id AS linkId, rl.documentLineId, rl.reservationId,
              rl.quantity AS allocatedQuantity,
              r.productId, r.warehouseId, r.locationId, r.quantity, r.consumedQuantity, r.status
       FROM stock_document_line_reservations rl
       INNER JOIN reservations r ON r.id = rl.reservationId
       INNER JOIN stock_document_lines l ON l.id = rl.documentLineId
       WHERE l.documentId = ? AND r.status = 'HELD'`,
      [documentId]
    ).catch(() => []);
  }

  /** Lượng đang giữ cho chính phiếu xuất này; được cộng lại khi kiểm tra khả dụng
   * vì stock_balances.reserved đã trừ phần đó. */
  function reservationCreditFromLinks(links: any[]): Map<string, number> {
    const credit = new Map<string, number>();
    for (const link of links || []) {
      const remaining = Math.max(0, Number(link.quantity || 0) - Number(link.consumedQuantity || 0));
      const quantity = Math.min(Number(link.allocatedQuantity || 0), remaining);
      if (!(quantity > 0)) continue;
      const key = `${link.productId}|${link.locationId || ''}`;
      credit.set(key, (credit.get(key) || 0) + quantity);
    }
    return credit;
  }

  /** Ghi liên kết reservation cho các dòng vừa lưu. Mỗi reservation chỉ được
   * gắn cho một dòng; số lượng link không vượt quá phần còn giữ của reservation
   * và không vượt quá số lượng dòng. */
  async function syncDocumentReservationLinks(
    warehouseId: string,
    lines: any[],
    savedLines: { id: string; productId: string; locationId: string; quantity: number }[]
  ): Promise<void> {
    const selections = lines
      .map((line, index) => ({ line, target: savedLines[index] }))
      .filter((entry) => entry.target && Array.isArray(entry.line?.reservationIds));
    if (selections.length === 0) return;

    const reservationIds = [...new Set(selections.flatMap(({ line }) =>
      (line.reservationIds as string[]).map((id: string) => String(id).trim()).filter(Boolean)
    ))];
    if (reservationIds.length === 0) return;

    const rows = await db.all(
      `SELECT * FROM reservations WHERE id IN (${reservationIds.map(() => '?').join(', ')}) FOR UPDATE`,
      reservationIds
    );
    const byId = new Map((rows || []).map((row: any) => [row.id, row]));
    const now = new Date().toISOString();

    for (const { line, target } of selections) {
      const ids = [...new Set((line.reservationIds as string[]).map((id: string) => String(id).trim()).filter(Boolean))];
      if (ids.length === 0) continue;
      let lineRemaining = Number(target.quantity || 0);
      for (const reservationId of ids) {
        const reservation: any = byId.get(reservationId);
        if (!reservation) {
          throw Object.assign(new Error(`Không tìm thấy giữ hàng ${reservationId}.`), { status: 400 });
        }
        if (reservation.status !== 'HELD') {
          throw Object.assign(new Error(`Giữ hàng ${reservationId} không còn ở trạng thái đang giữ.`), { status: 400 });
        }
        if (reservation.productId !== target.productId
          || reservation.warehouseId !== warehouseId
          || (reservation.locationId || '') !== (target.locationId || '')) {
          throw Object.assign(new Error(`Giữ hàng ${reservationId} không khớp sản phẩm/kho/vị trí của dòng.`), { status: 400 });
        }
        const reservedRemaining = Math.max(0, Number(reservation.quantity || 0) - Number(reservation.consumedQuantity || 0));
        const quantity = Math.min(lineRemaining, reservedRemaining);
        if (!(quantity > 0)) {
          throw Object.assign(new Error(`Giữ hàng ${reservationId} không còn đủ số lượng cho dòng.`), { status: 400 });
        }
        try {
          await db.run(
            `INSERT INTO stock_document_line_reservations
             (id, documentLineId, reservationId, quantity, createdAt)
             VALUES (?, ?, ?, ?, ?)`,
            [randomUUID(), target.id, reservationId, quantity, now]
          );
        } catch (e: any) {
          if (e?.message?.includes('Duplicate')) {
            throw Object.assign(new Error(`Giữ hàng ${reservationId} đang được gắn cho phiếu khác.`), { status: 409 });
          }
          throw e;
        }
        lineRemaining -= quantity;
      }
    }
  }

  /** Tiêu thụ phần reservation đã gắn cho phiếu xuất. Chỉ giảm reserved,
   * không tạo thêm stock_move vì move của phiếu đã trừ onHand. */
  async function consumeIssueReservationLinks(doc: any, links: any[]): Promise<void> {
    if (!links || links.length === 0) return;
    const now = new Date().toISOString();
    for (const link of links) {
      const reservationQuantity = Number(link.quantity || 0);
      const alreadyConsumed = Number(link.consumedQuantity || 0);
      const remaining = Math.max(0, reservationQuantity - alreadyConsumed);
      const quantity = Math.min(Number(link.allocatedQuantity || 0), remaining);
      if (!(quantity > 0)) continue;
      const nextConsumed = alreadyConsumed + quantity;
      const nextStatus = nextConsumed >= reservationQuantity ? 'CONSUMED' : 'HELD';
      await db.run(
        'UPDATE reservations SET consumedQuantity = ?, status = ? WHERE id = ?',
        [nextConsumed, nextStatus, link.reservationId]
      );
      await adjustReserved(db.run.bind(db), {
        kind: 'DECREMENT_CLAMPED', productId: link.productId, warehouseId: link.warehouseId,
        locationId: link.locationId, delta: quantity, now,
      });
    }
    await dropDocReservationLinks(doc.id);
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
      try {
        const reservationCredit = loaded.doc.docType === 'ISSUE'
          ? reservationCreditFromLinks(await loadIssueReservationLinks(loaded.doc.id))
          : undefined;
        await preflightPosting(
          loaded.doc,
          loaded.lines,
          loaded.doc.warehouseId || loaded.doc.sourceWarehouseId,
          reservationCredit
        );
      } catch (e: any) {
        await db.run('ROLLBACK'); transactionOpen = false;
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to validate document before posting' });
      }
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
    const trackings = await productTrackings(lines.map((l) => l.productId));
    const withSerials = lines.filter(
      (l) => requiresSerial(l, trackings.get(l.productId) || 'QUANTITY') && parseSerials(l.serialLot).length > 0
    );
    if (withSerials.length === 0) return;
    const productIds = [...new Set(withSerials.map((l) => l.productId))];
    const products = await db.all(
      `SELECT id, warrantyMonths FROM products WHERE id IN (${productIds.map(() => '?').join(', ')})`,
      productIds
    ).catch(() => []);
    const warrantyByProduct = new Map((products || []).map((p: any) => [p.id, Math.max(0, Number(p.warrantyMonths) || 0)]));
    const warrantyStart = String(doc.postingDate || doc.docDate || new Date().toISOString()).slice(0, 10);
    const now = new Date().toISOString();
    const serialRows: { line: any; serial: string }[] = [];
    for (const line of withSerials) {
      const serials = parseSerials(line.serialLot);
      const qty = Number(line.quantity);
      if (serials.length !== qty) {
        throw serialError(`Dòng ${line.productId}: đã nhập ${serials.length} serial nhưng số lượng ${qty} — quét đủ serial từng chiếc`, 400);
      }
      for (const serial of serials) serialRows.push({ line, serial });
    }

    const allSerials = serialRows.map((row) => row.serial);
    const dupes = await db.all(
      `SELECT serialNumber FROM stock_serials WHERE serialNumber IN (${allSerials.map(() => '?').join(', ')})`,
      allSerials
    ).catch(() => []);
    if ((dupes || []).length > 0) {
      throw serialError(`Serial ${(dupes[0] as any).serialNumber} đã được ghi nhận trước đó. Hãy kiểm tra phiếu nhập cũ hoặc nhập một Serial khác.`, 409);
    }

    // Phiếu nhập lớn ghi theo lô; phiếu nhỏ giữ từng insert để không đổi hành vi cũ.
    if (serialRows.length > 20) {
      const CHUNK = 200;
      for (let offset = 0; offset < serialRows.length; offset += CHUNK) {
        const chunk = serialRows.slice(offset, offset + CHUNK);
        const placeholders = chunk.map(() => `(?, ?, ?, NULL, ?, ?, 'SALEABLE', ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, 'IN_STOCK', ?)`).join(', ');
        const params = chunk.flatMap(({ line, serial }) => [
          randomUUID(), line.productId, serial, doc.warehouseId, line.locationId || null,
          doc.partnerName ?? null, doc.id, warrantyStart, warrantyByProduct.get(line.productId) ?? 0,
          user.id, now, now, doc.id, line.id, now,
        ]);
        try {
          await db.run(
            `INSERT INTO stock_serials (id, productId, serialNumber, lotCode, warehouseId, locationId, status, supplier, receiptId, customerName, projectId, warrantyStart, warrantyMonths, notes, createdBy, createdAt, updatedAt, receiptDocumentId, receiptLineId, stockStatus, receivedAt)
             VALUES ${placeholders}`,
            params
          );
        } catch (e: any) {
          if (e.message?.includes('Duplicate')) {
            throw serialError(`Một Serial trong phiếu đã được ghi nhận trước đó. Hãy kiểm tra phiếu nhập cũ hoặc nhập Serial khác.`, 409);
          }
          throw e;
        }
      }
    } else {
      for (const { line, serial } of serialRows) {
        try {
          await db.run(
            `INSERT INTO stock_serials (id, productId, serialNumber, lotCode, warehouseId, locationId, status, supplier, receiptId, customerName, projectId, warrantyStart, warrantyMonths, notes, createdBy, createdAt, updatedAt, receiptDocumentId, receiptLineId, stockStatus, receivedAt)
             VALUES (?, ?, ?, NULL, ?, ?, 'SALEABLE', ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, 'IN_STOCK', ?)`,
            [randomUUID(), line.productId, serial, doc.warehouseId, line.locationId || null,
              doc.partnerName ?? null, doc.id, warrantyStart, warrantyByProduct.get(line.productId) ?? 0,
              user.id, now, now, doc.id, line.id, now]
          );
        } catch (e: any) {
          if (e.message?.includes('Duplicate')) {
            throw serialError(`Serial ${serial} đã được ghi nhận trước đó. Hãy kiểm tra phiếu nhập cũ hoặc nhập một Serial khác.`, 409);
          }
          throw e;
        }
      }
    }
  }

  /** Trừ số lượng LOT đã phân bổ cho dòng xuất và ghi audit movement.
   * Khóa từng lô trong cùng transaction với chứng từ để hai PXK không thể
   * cùng tiêu vượt remainingQty. */
  async function consumeIssueLots(doc: any, lines: any[], user: any): Promise<Map<string, any[]>> {
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const trackings = await productTrackings(productIds);
    const candidates = lines.filter((line) => Number(line.serialRequired) !== 1);
    const isLotTracked = (line: any) => trackings.get(line.productId) === 'LOT';
    const postingsByLine = new Map<string, any[]>();
    if (candidates.length === 0) return postingsByLine;

    const consumeAllocations = async (line: any, allocations: any[]) => {
      for (const allocation of allocations) {
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
    };

    // Một dòng LOT giữ nguyên truy vấn cũ (tương thích mock/legacy).
    if (candidates.length === 1) {
      const line = candidates[0];
      if (!isLotTracked(line)) return postingsByLine;
      const allocations = await db.all(
        `SELECT a.lotId, a.quantity, s.lotCode
         FROM stock_document_line_lots a
         INNER JOIN stock_lots s ON s.id = a.lotId
         WHERE a.documentLineId = ? ORDER BY s.createdAt ASC, s.id ASC`,
        [line.id]
      );
      const rows = allocations || [];
      const allocated = rows.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
      if (allocated < Number(line.quantity)) {
        throw serialError(`Dòng ${line.productId}: đã phân bổ ${allocated}/${Number(line.quantity)} theo lô`, 400);
      }
      postingsByLine.set(line.id, rows);
      await consumeAllocations(line, rows);
      return postingsByLine;
    }

    // Nhiều dòng: gom coverage + allocation thành hai truy vấn. Dòng QUANTITY
    // không có phân bổ lô vẫn đi tiếp như hàng số lượng.
    const lineIds = candidates.map((line) => line.id);
    const coverageRows = await db.all(
      `SELECT a.documentLineId, COALESCE(SUM(quantity), 0) AS covered
       FROM stock_document_line_lots a
       WHERE a.documentLineId IN (${lineIds.map(() => '?').join(', ')})
       GROUP BY a.documentLineId`,
      lineIds
    );
    const coverage = new Map<string, number>();
    for (const row of coverageRows || []) {
      const covered = row.covered !== undefined && row.covered !== null
        ? Number(row.covered || 0)
        : Number(row.quantity || 0);
      coverage.set(row.documentLineId, (coverage.get(row.documentLineId) || 0) + covered);
    }

    const allocationRows = await db.all(
      `SELECT a.documentLineId, a.lotId, a.quantity, s.lotCode
       FROM stock_document_line_lots a
       INNER JOIN stock_lots s ON s.id = a.lotId
       WHERE a.documentLineId IN (${lineIds.map(() => '?').join(', ')})
       ORDER BY s.createdAt ASC, s.id ASC`,
      lineIds
    );
    for (const line of candidates) {
      const allocations = (allocationRows || []).filter((row: any) => row.documentLineId === line.id);
      const allocated = coverage.get(line.id) ?? 0;
      if (!isLotTracked(line) && allocated <= 0) continue;
      postingsByLine.set(line.id, allocations);
      if (allocated < Number(line.quantity)) {
        throw serialError(`Dòng ${line.productId}: đã phân bổ ${allocated}/${Number(line.quantity)} theo lô`, 400);
      }
      await consumeAllocations(line, allocations);
    }
    return postingsByLine;
  }

  /** Trừ serial khi hoàn tất XUẤT: serial đã nhập phải tồn tại (IN_STOCK,
   * đúng kho) và đủ số lượng dòng -> đánh dấu SOLD + khách hàng. */
  async function consumeIssueSerials(doc: any, lines: any[], user: any): Promise<void> {
    const trackings = await productTrackings(lines.map((l) => l.productId));
    const withSerials = lines.filter(
      (l) => requiresSerial(l, trackings.get(l.productId) || 'QUANTITY') && parseSerials(l.serialLot).length > 0
    );
    if (withSerials.length === 0) return;
    const warrantyStartType = await getWarrantyStartType(db);
    for (const line of withSerials) {
      const serials = parseSerials(line.serialLot);
      const qty = Number(line.quantity);
      if (serials.length !== qty) {
        throw serialError(`Dòng ${line.productId}: đã nhập ${serials.length} serial nhưng số lượng ${qty} — chọn đúng từng chiếc xuất`, 400);
      }
      const nowOut = new Date().toISOString();
      const warrantyStartFor = (row: any) => resolveWarrantyStart({
        startType: warrantyStartType,
        outboundDate: nowOut,
        deliveryDate: doc.deliveryDate,
        installationDate: doc.installationDate,
        acceptanceDate: doc.acceptanceDate,
        fallbackDate: row?.warrantyStart,
      });

      if (serials.length > 20) {
        const rows = await db.all(
          `SELECT id, serialNumber, stockStatus, issueDocumentId, issueLineId, warrantyStart
           FROM stock_serials
           WHERE serialNumber IN (${serials.map(() => '?').join(', ')})
             AND productId = ? AND warehouseId = ? AND status = 'SALEABLE'
             AND (stockStatus IS NULL OR stockStatus = 'IN_STOCK'
               OR (stockStatus = 'RESERVED' AND issueDocumentId = ? AND issueLineId = ?))
           FOR UPDATE`,
          [...serials, line.productId, doc.warehouseId, doc.id, line.id]
        );
        const bySerial = new Map((rows || []).map((row: any) => [row.serialNumber, row]));
        const ordered = serials.map((sn) => {
          const row: any = bySerial.get(sn);
          if (!row) throw serialError(`Serial ${sn} không có trong tồn bán được của kho`, 400);
          if (row.issueDocumentId && row.issueDocumentId !== doc.id) {
            throw serialError(`Serial ${sn} đang được giữ cho phiếu khác`, 400);
          }
          return row;
        });
        const cases = ordered.map(() => 'WHEN ? THEN ?').join(' ');
        const ids = ordered.map((row) => row.id);
        await db.run(
          `UPDATE stock_serials
           SET status = 'SOLD', stockStatus = 'OUT',
               outDate = CASE id ${cases} END, customerName = ?,
               issueDocumentId = ?, issueLineId = ?,
               warrantyStart = COALESCE(CASE id ${cases} END, warrantyStart), updatedAt = ?
           WHERE id IN (${ids.map(() => '?').join(', ')})`,
          [...ordered.flatMap((row) => [row.id, nowOut]), doc.partnerName ?? null, doc.id, line.id,
            ...ordered.flatMap((row) => [row.id, warrantyStartFor(row)]), nowOut, ...ids]
        );
        continue;
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
        const wStart = warrantyStartFor(row);
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
    const serialLines = lines.filter((line) => requiresSerial(line, trackings.get(line.productId) || 'QUANTITY'));
    if (serialLines.length === 0) return;
    const rows = await db.all(
      `SELECT id, productId, serialNumber, issueLineId
       FROM stock_serials
       WHERE issueDocumentId = ? AND warehouseId = ? AND stockStatus = 'RESERVED'
       FOR UPDATE`,
      [doc.id, doc.sourceWarehouseId]
    );
    const bySerial = new Map((rows || []).map((row: any) => [row.serialNumber, row]));
    for (const line of serialLines) {
      const serials = parseSerials(line.serialLot);
      if (serials.length !== Number(line.quantity)) {
        throw serialError(`Dòng ${line.productId}: chưa đủ Serial (${serials.length}/${Number(line.quantity)})`, 400);
      }
      for (const serial of serials) {
        const row: any = bySerial.get(serial);
        if (!row || row.issueLineId !== line.id
          || (row.productId && row.productId !== line.productId)) {
          throw serialError(`Serial ${serial} chưa được giữ cho phiếu điều chuyển`, 400);
        }
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

  /** Ghi stock_moves theo đơn vị quản lý của từng dòng:
   * SERIAL = 1 move/chiếc, LOT = 1 move/lô đã đăng ký hoặc phân bổ,
   * QUANTITY = 1 move/dòng (theo số lượng thực tế đã xác nhận). */
  async function postDocumentMoves(
    doc: any,
    lines: any[],
    moveType: string,
    direction: 1 | -1,
    user: any,
    lotPostings?: Map<string, { lotId: string; quantity: number }[]>
  ): Promise<void> {
    const trackings = await productTrackings(lines.map((l) => l.productId));
    const moves: any[] = [];
    const serialLines = lines.filter((line) => {
      const tracking = trackings.get(line.productId) || 'QUANTITY';
      return requiresSerial(line, tracking) && Number(line.serialSkipped) !== 1;
    });

    // Một query cho mọi serial của chứng từ, tránh N+1 khi nhập/xuất hàng loạt.
    const serialByKey = new Map<string, any>();
    if (serialLines.length > 0) {
      const serials = serialLines.flatMap((line) => parseSerials(line.serialLot));
      if (serials.length > 0) {
        const rows = await db.all(
          `SELECT id, productId, serialNumber FROM stock_serials
           WHERE serialNumber IN (${serials.map(() => '?').join(', ')})
             AND (receiptDocumentId = ? OR issueDocumentId = ?)`,
          [...serials, doc.id, doc.id]
        ).catch(() => []);
        for (const row of rows || []) {
          serialByKey.set(`${row.productId}|${row.serialNumber}`, row);
        }
      }
    }

    const lotLines = lines.filter((line) => (trackings.get(line.productId) || 'QUANTITY') === 'LOT' || !!lotPostings?.has(line.id));
    const lotRowsByLine = new Map<string, any[]>();
    if (lotLines.length > 0) {
      if (doc.docType === 'RECEIPT') {
        if (lotLines.length === 1) {
          const line = lotLines[0];
          const rows = await db.all(
            `SELECT id AS lotId, initialQty AS quantity FROM stock_lots
             WHERE receiptDocumentId = ? AND receiptLineId = ?`,
            [doc.id, line.id]
          ).catch(() => []);
          lotRowsByLine.set(line.id, rows || []);
        } else {
          const rows = await db.all(
            `SELECT receiptLineId AS documentLineId, id AS lotId, initialQty AS quantity
             FROM stock_lots WHERE receiptDocumentId = ?`,
            [doc.id]
          ).catch(() => []);
          for (const row of rows || []) {
            const key = row.documentLineId;
            if (!lotRowsByLine.has(key)) lotRowsByLine.set(key, []);
            lotRowsByLine.get(key)!.push(row);
          }
        }
      } else if (doc.docType === 'RETURN') {
        for (const line of lotLines) lotRowsByLine.set(line.id, lotPostings?.get(line.id) || []);
      } else if (lotPostings) {
        for (const line of lotLines) lotRowsByLine.set(line.id, lotPostings.get(line.id) || []);
      } else {
        const lineIds = lotLines.map((line) => line.id);
        const rows = await db.all(
          `SELECT documentLineId, lotId, quantity FROM stock_document_line_lots
           WHERE documentLineId IN (${lineIds.map(() => '?').join(', ')})`,
          lineIds
        ).catch(() => []);
        for (const row of rows || []) {
          if (!lotRowsByLine.has(row.documentLineId)) lotRowsByLine.set(row.documentLineId, []);
          lotRowsByLine.get(row.documentLineId)!.push(row);
        }
      }
    }

    for (const line of lines) {
      const tracking = trackings.get(line.productId) || 'QUANTITY';
      if (requiresSerial(line, tracking) && Number(line.serialSkipped) !== 1) {
        for (const serial of parseSerials(line.serialLot)) {
          const serialRow = serialByKey.get(`${line.productId}|${serial}`);
          moves.push({
            productId: line.productId, warehouseId: doc.warehouseId, locationId: line.locationId || '',
            quantity: direction, moveType, referenceType: doc.docType, referenceId: doc.id,
            documentLineId: line.id, serialId: serialRow?.id ?? null, createdBy: user.id,
          });
        }
        continue;
      }
      if (tracking === 'LOT' || lotPostings?.has(line.id)) {
        const postings = lotRowsByLine.get(line.id) || [];
        for (const posting of postings) {
          const quantity = Number(posting.quantity || 0);
          if (!(quantity > 0)) continue;
          moves.push({
            productId: line.productId, warehouseId: doc.warehouseId, locationId: line.locationId || '',
            quantity: direction * quantity, moveType, referenceType: doc.docType, referenceId: doc.id,
            documentLineId: line.id, lotId: (posting as any).lotId ?? null, createdBy: user.id,
          });
        }
        continue;
      }
      moves.push({
        productId: line.productId, warehouseId: doc.warehouseId, locationId: line.locationId || '',
        quantity: direction * effectiveLineQuantity(line), moveType, referenceType: doc.docType, referenceId: doc.id,
        documentLineId: line.id, serialId: null, createdBy: user.id,
      });
    }
    await postMoves(db.run.bind(db), moves, { skipCountingCheck: true });
  }

  /** Ghi stock_moves cho điều chuyển theo tracking.
   * OUT lấy lô nguồn đã phân bổ; IN lấy lô đích đã tạo (destLotId). */
  async function postTransferMoves(
    doc: any,
    lines: any[],
    direction: 'OUT' | 'IN',
    destinationLocation: string,
    user: any
  ): Promise<void> {
    const isOut = direction === 'OUT';
    const warehouseId = isOut ? doc.sourceWarehouseId : doc.destWarehouseId;
    const moveType = isOut ? 'TRANSFER_OUT' : 'TRANSFER_IN';
    const trackings = await productTrackings(lines.map((l) => l.productId));
    const moves: any[] = [];
    const serialLines = lines.filter((line) => {
      const tracking = trackings.get(line.productId) || 'QUANTITY';
      return requiresSerial(line, tracking) && Number(line.serialSkipped) !== 1;
    });
    const serialByKey = new Map<string, any>();
    if (serialLines.length > 0) {
      const serials = serialLines.flatMap((line) => parseSerials(line.serialLot));
      if (serials.length > 0) {
        const rows = await db.all(
          isOut
            ? `SELECT id, productId, serialNumber FROM stock_serials
               WHERE serialNumber IN (${serials.map(() => '?').join(', ')})
                 AND warehouseId = ? AND stockStatus = 'RESERVED' AND issueDocumentId = ?`
            : `SELECT id, productId, serialNumber FROM stock_serials
               WHERE serialNumber IN (${serials.map(() => '?').join(', ')})
                 AND warehouseId = ?`,
          isOut ? [...serials, warehouseId, doc.id] : [...serials, warehouseId]
        ).catch(() => []);
        for (const row of rows || []) serialByKey.set(`${row.productId}|${row.serialNumber}`, row);
      }
    }

    for (const line of lines) {
      const tracking = trackings.get(line.productId) || 'QUANTITY';
      const locationId = isOut ? (line.locationId || '') : (destinationLocation || '');
      if (requiresSerial(line, tracking) && Number(line.serialSkipped) !== 1) {
        for (const serial of parseSerials(line.serialLot)) {
          const serialRow = serialByKey.get(`${line.productId}|${serial}`);
          moves.push({
            productId: line.productId, warehouseId, locationId,
            quantity: isOut ? -1 : 1, moveType, referenceType: 'TRANSFER', referenceId: doc.id,
            documentLineId: line.id, serialId: serialRow?.id ?? null, createdBy: user.id,
          });
        }
        continue;
      }
      if (tracking === 'LOT') {
        const postings = isOut
          ? await db.all(
              `SELECT lotId, quantity FROM stock_document_line_lots WHERE documentLineId = ?`,
              [line.id]
            )
          : await db.all(
              `SELECT destLotId AS lotId, quantity FROM stock_transfer_line_lots
               WHERE documentLineId = ? AND destLotId IS NOT NULL`,
              [line.id]
            );
        for (const posting of postings || []) {
          const quantity = Number(posting.quantity || 0);
          if (!(quantity > 0)) continue;
          moves.push({
            productId: line.productId, warehouseId, locationId,
            quantity: isOut ? -quantity : quantity, moveType, referenceType: 'TRANSFER', referenceId: doc.id,
            documentLineId: line.id, lotId: (posting as any).lotId ?? null, createdBy: user.id,
          });
        }
        continue;
      }
      moves.push({
        productId: line.productId, warehouseId, locationId,
        quantity: (isOut ? -1 : 1) * effectiveLineQuantity(line), moveType,
        referenceType: 'TRANSFER', referenceId: doc.id,
        documentLineId: line.id, serialId: null, createdBy: user.id,
      });
    }
    await postMoves(db.run.bind(db), moves, { skipCountingCheck: true });
  }

  /** Nhận lại serial khi hoàn tất TRẢ HÀNG: serial đã từng xuất (SOLD) được
   * đưa về SALEABLE tại vị trí trả + xóa khách; serial chưa từng đăng ký thì
   * ghi mới như nhập (giữ vết bảo hành theo sản phẩm). */
  async function registerReturnSerials(doc: any, lines: any[], user: any): Promise<void> {
    const trackings = await productTrackings(lines.map((l) => l.productId));
    const withSerials = lines.filter(
      (l) => requiresSerial(l, trackings.get(l.productId) || 'QUANTITY') && parseSerials(l.serialLot).length > 0
    );
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
      const serials = parseSerials(line.serialLot);
      const qty = Number(line.quantity);
      if (serials.length !== qty) {
        throw serialError(`Dòng ${line.productId}: đã nhập ${serials.length} serial nhưng số lượng ${qty} — quét đủ serial từng chiếc`, 400);
      }
      for (const sn of serials) {
        const row = await db.get(
          `SELECT id, stockStatus, issueDocumentId FROM stock_serials WHERE serialNumber = ? AND productId = ? LIMIT 1 FOR UPDATE`,
          [sn, line.productId]
        );
        if (!row || (row as any).stockStatus !== 'OUT' || (row as any).issueDocumentId !== doc.referenceId) {
          throw serialError(`Serial ${sn} không còn ở trạng thái đã xuất của phiếu gốc; không thể hoàn tất phiếu trả.`, 409);
        }
        await db.run(
          `UPDATE stock_serials SET status = 'SALEABLE', stockStatus = 'IN_STOCK',
           warehouseId = ?, locationId = ?, receiptId = ?, receiptDocumentId = ?, receiptLineId = ?,
           issueDocumentId = NULL, issueLineId = NULL, customerName = NULL, receivedAt = ?,
           warrantyStart = ?, warrantyMonths = ?, updatedAt = ? WHERE id = ?`,
          [doc.warehouseId, line.locationId || null, doc.id, doc.id, line.id, now,
            warrantyStart, warrantyByProduct.get(line.productId) ?? 0, now, (row as any).id]
        );
      }
    }
  }

  /** Nhận lại hàng theo Lô khi hoàn tất TRẢ HÀNG: cộng/tạo lô ở kho trả,
   * ghi audit movement và trả về postings để ghi stock_moves đúng từng lô. */
  async function registerReturnLots(
    doc: any,
    lines: any[],
    user: any
  ): Promise<Map<string, { lotId: string; quantity: number }[]>> {
    const postings = new Map<string, { lotId: string; quantity: number }[]>();
    const trackings = await productTrackings(lines.map((l) => l.productId));
    for (const line of lines) {
      const tracking = trackings.get(line.productId) || 'QUANTITY';
      if (tracking !== 'LOT' || Number(line.serialRequired) === 1) continue;
      const quantity = effectiveLineQuantity(line);
      if (!(quantity > 0)) continue;
      const lotCode = parseSerials(line.serialLot)[0] || `RET-${doc.code || doc.id.slice(0, 8)}`;
      const now = new Date().toISOString();
      let lot = await db.get(
        `SELECT id FROM stock_lots
         WHERE productId = ? AND warehouseId = ? AND lotCode = ? LIMIT 1 FOR UPDATE`,
        [line.productId, doc.warehouseId, lotCode]
      );
      if (lot) {
        await db.run(
          `UPDATE stock_lots SET initialQty = initialQty + ?, remainingQty = remainingQty + ?,
           status = 'ACTIVE', locationId = ?, updatedAt = ? WHERE id = ?`,
          [quantity, quantity, line.locationId || null, now, lot.id]
        );
      } else {
        const lotId = randomUUID();
        await db.run(
          `INSERT INTO stock_lots
           (id, productId, lotCode, coilCode, warehouseId, locationId, initialQty, remainingQty, unit,
            manufacturedAt, supplier, receiptDocumentId, receiptLineId, status, createdBy, createdAt, updatedAt)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 'ACTIVE', ?, ?, ?)`,
          [lotId, line.productId, lotCode, doc.warehouseId, line.locationId || null,
            quantity, quantity, doc.id, line.id, user.id, now, now]
        );
        lot = { id: lotId };
      }
      await db.run(
        `INSERT INTO stock_lot_movements
         (id, lotId, productId, warehouseId, quantity, moveType, referenceType, referenceId, documentLineId, createdBy, createdAt)
         VALUES (?, ?, ?, ?, ?, 'RETURN', 'RETURN', ?, ?, ?, ?)`,
        [randomUUID(), lot.id, line.productId, doc.warehouseId, quantity, doc.id, line.id, user.id, now]
      );
      postings.set(line.id, [{ lotId: lot.id, quantity }]);
    }
    return postings;
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
        await preflightPosting(loaded.doc, loaded.lines, loaded.doc.warehouseId);
      } catch (e: any) {
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to validate document before posting' });
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
      const reservationLinks = await loadIssueReservationLinks(loaded.doc.id);
      const reservedForIssue = reservationCreditFromLinks(reservationLinks);
      try {
        await preflightPosting(loaded.doc, loaded.lines, loaded.doc.warehouseId, reservedForIssue);
      } catch (e: any) {
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to validate document before posting' });
      }

      const agg = aggregateLines(loaded.lines);
      const saleable = await saleableLocationSet(loaded.doc.warehouseId, agg.map((l) => l.locationId || ''));
      for (const line of agg) {
        if (!saleable.has(line.locationId || '')) return res.status(400).json({ error: `Vị trí ${line.locationId} không phải vị trí được phép xuất hàng. Vui lòng chọn vị trí bán được.` });
      }
      const avail = await availableMap(loaded.doc.warehouseId, agg.map((l) => ({ productId: l.productId, locationId: l.locationId || '' })));
      for (const line of agg) {
        const key = `${line.productId}|${line.locationId || ''}`;
        const availableHere = (avail.get(key) ?? 0) + (reservedForIssue.get(key) ?? 0);
        if (availableHere < Number(line.quantity)) {
          return res.status(400).json({ error: await insufficientStockMessage(loaded.doc.warehouseId, line, availableHere) });
        }
      }

      try {
        const lotPostings = await consumeIssueLots(loaded.doc, loaded.lines, user);
        await consumeIssueSerials(loaded.doc, loaded.lines, user);
        await consumeIssueReservationLinks(loaded.doc, reservationLinks);
        await postDocumentMoves(loaded.doc, loaded.lines, 'ISSUE', -1, user, lotPostings);
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
        await preflightPosting(loaded.doc, loaded.lines, loaded.doc.warehouseId);
      } catch (e: any) {
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to validate document before posting' });
      }

      try {
        await registerReturnSerials(loaded.doc, loaded.lines, user);
        const returnLots = await registerReturnLots(loaded.doc, loaded.lines, user);
        await postDocumentMoves(loaded.doc, loaded.lines, 'RETURN', 1, user, returnLots);
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
        await preflightPosting(loaded.doc, loaded.lines, loaded.doc.sourceWarehouseId);
        await assertTransferSerialsReady(loaded.doc, loaded.lines);
      } catch (e: any) {
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to validate document before posting' });
      }
      const agg = aggregateLines(loaded.lines);
      const avail = await availableMap(loaded.doc.sourceWarehouseId, agg.map((l) => ({ productId: l.productId, locationId: l.locationId || '' })));
      for (const line of agg) {
        if ((avail.get(`${line.productId}|${line.locationId || ''}`) ?? 0) < Number(line.quantity)) {
          return res.status(400).json({ error: await insufficientStockMessage(loaded.doc.sourceWarehouseId, line, avail.get(`${line.productId}|${line.locationId || ''}`) ?? 0) });
        }
      }

      try {
        await consumeTransferLotsOnShip(loaded.doc, loaded.lines, user);
        await postTransferMoves(loaded.doc, loaded.lines, 'OUT', '', user);
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
        await preflightPosting(loaded.doc, loaded.lines, loaded.doc.destWarehouseId);
      } catch (e: any) {
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to validate document before posting' });
      }

      try {
        await receiveTransferSerials(loaded.doc, destinationLocation);
        await receiveTransferLots(loaded.doc, loaded.lines, destinationLocation, user);
        await postTransferMoves(loaded.doc, loaded.lines, 'IN', destinationLocation, user);
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
        return res.status(e.status || 409).json({ error: e.status ? e.message : 'Failed to check counting state' });
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

  const SmartScanSchema = z.object({
    documentId: z.string().trim().min(1).max(191),
    serial: z.string().trim().min(1).max(191),
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
      } else if (doc.docType === 'RETURN' && next) {
        const returnedRow = await db.get(
          `SELECT id FROM stock_serials
           WHERE serialNumber = ? AND productId = ? AND stockStatus = 'OUT' AND issueDocumentId = ?
           LIMIT 1 FOR UPDATE`,
          [next, line.productId, doc.referenceId]
        );
        if (!returnedRow) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(400).json({ error: `Serial ${next} không thuộc phiếu xuất gốc hoặc đã được trả trước đó` }); }
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

  /** Tự đóng bước xử lý hàng hóa khi toàn bộ dòng đã quét đủ Serial.
   * READY chỉ xác nhận xử lý, chưa tạo stock_move hay thay đổi tồn kho. */
  async function refreshProcessingAfterSerialScan(docId: string): Promise<boolean> {
    const pending = await db.get(
      `SELECT COUNT(*) AS incomplete FROM stock_document_lines
       WHERE documentId = ? AND processingStatus <> 'COMPLETED'`,
      [docId]
    );
    if (Number(pending?.incomplete || 0) > 0) {
      await touchProcessing(docId);
      return false;
    }
    await db.run(
      `UPDATE stock_documents SET status = ?, updatedAt = ?
       WHERE id = ? AND status IN ('DRAFT', 'PROCESSING')`,
      ['READY', new Date().toISOString(), docId]
    );
    return true;
  }

  router.post('/serials/scan', validate(ScanSchema), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, documentLineId, serial } = req.body;
      const code = String(serial).trim();
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      if (!doc || doc.docType !== 'RECEIPT') return res.status(404).json({ error: 'Receipt not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft receipts can be processed' });
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND documentId = ?', [documentLineId, documentId]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
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
        const processingCompleted = await refreshProcessingAfterSerialScan(documentId);
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'SERIAL_SCANNED_IN', entityType: 'SERIAL', documentId, entityId: code,
          productId: fresh.productId, warehouseId: doc.warehouseId, quantity: 1, userId: user.id,
          metadata: { documentLineId, serial: code, processingCount: result.count },
        });
        await db.run('COMMIT'); transactionOpen = false;
        res.status(201).json({ serial: code, count: result.count, required: qty, completed: result.completed, processingCompleted });
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to scan serial' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  /** Quét Serial cho phiếu trả. Serial phải là thiết bị đã xuất đúng theo
   * phiếu xuất gốc; vì vậy không áp dụng kiểm tra "Serial đã tồn tại" của
   * phiếu nhập mới. */
  router.post('/serials/scan-return', validate(ScanSchema), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, documentLineId, serial } = req.body;
      const code = String(serial).trim();
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      if (!doc || doc.docType !== 'RETURN') return res.status(404).json({ error: 'Return document not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft returns can be processed' });
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND documentId = ?', [documentLineId, documentId]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      const current = parseSerials(line.serialLot);
      if (current.some((s) => s.toLowerCase() === code.toLowerCase())) return res.status(400).json({ error: 'Serial này đã được thêm vào phiếu trả' });
      if (current.length >= Number(line.quantity)) return res.status(400).json({ error: `Phiếu yêu cầu ${line.quantity} thiết bị, đã đủ ${current.length}/${line.quantity}` });

      const found = await db.get('SELECT * FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
      if (!found) return res.status(404).json({ error: `Không tìm thấy Serial ${code} trong lịch sử xuất kho.` });
      if (found.productId !== line.productId) return res.status(400).json({ error: `Serial này thuộc sản phẩm ${found.productId}, không phải sản phẩm ${line.productId} trên phiếu trả.` });
      if (found.stockStatus !== 'OUT') return res.status(409).json({ error: found.stockStatus === 'IN_STOCK' ? `Serial ${code} đã được trả về kho trước đó.` : `Serial ${code} chưa ở trạng thái đã xuất nên không thể nhận trả.` });
      const sourceIssue = await db.get(
        `SELECT id, code, partnerCode, partnerName, partnerAddress, deliverer
         FROM stock_documents WHERE id = ? AND docType = 'ISSUE' AND status = 'DONE' LIMIT 1`,
        [found.issueDocumentId]
      );
      if (!sourceIssue) return res.status(409).json({ error: `Serial ${code} không có phiếu xuất gốc hợp lệ để nhận trả.` });
      const referenceId = String(doc.referenceId || '').trim();
      if (referenceId && referenceId !== sourceIssue.id) {
        return res.status(400).json({ error: `Serial ${code} thuộc ${sourceIssue.code || 'một phiếu xuất khác'}. Mỗi phiếu trả chỉ xử lý Serial của một phiếu xuất gốc.` });
      }

      await beginStockTransaction(db, [doc.warehouseId]);
      transactionOpen = true;
      const locked = await db.get('SELECT * FROM stock_serials WHERE serialNumber = ? LIMIT 1 FOR UPDATE', [code]);
      if (!locked || locked.productId !== line.productId || locked.stockStatus !== 'OUT' || locked.issueDocumentId !== sourceIssue.id) {
        await db.run('ROLLBACK'); transactionOpen = false;
        return res.status(409).json({ error: `Serial ${code} vừa thay đổi trạng thái hoặc không còn hợp lệ để trả.` });
      }
      const fresh = await db.get('SELECT * FROM stock_document_lines WHERE id = ? FOR UPDATE', [documentLineId]);
      if (!fresh) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(404).json({ error: 'Document line not found' }); }
      const freshSerials = parseSerials(fresh.serialLot);
      if (freshSerials.some((s) => s.toLowerCase() === code.toLowerCase()) || freshSerials.length >= Number(fresh.quantity)) {
        await db.run('ROLLBACK'); transactionOpen = false;
        return res.status(400).json({ error: 'Serial đã được thêm hoặc dòng đã đủ số lượng' });
      }
      const result = await appendLineSerial(fresh, code, true);
      if (!referenceId) {
        await db.run(
          `UPDATE stock_documents
           SET referenceType = 'ISSUE', referenceId = ?, partnerCode = ?, partnerName = ?,
               partnerAddress = ?, deliverer = ?, updatedAt = ? WHERE id = ?`,
          [sourceIssue.id, sourceIssue.partnerCode || null, sourceIssue.partnerName || null,
            sourceIssue.partnerAddress || null, sourceIssue.deliverer || null, new Date().toISOString(), documentId]
        );
      }
      const processingCompleted = await refreshProcessingAfterSerialScan(documentId);
      await recordWarehouseActivity(db.run.bind(db), {
        actionType: 'SERIAL_SCANNED_RETURN', entityType: 'SERIAL', entityId: locked.id,
        documentId, documentCode: doc.code, productId: fresh.productId, serialId: locked.id,
        warehouseId: doc.warehouseId, quantity: 1, userId: user.id,
        metadata: { documentLineId, serial: code, sourceIssueDocumentId: sourceIssue.id, sourceIssueCode: sourceIssue.code, processingCount: result.count },
      });
      await db.run('COMMIT'); transactionOpen = false;
      return res.status(201).json({
        serial: code, count: result.count, required: Number(fresh.quantity), completed: result.completed, processingCompleted,
        sourceIssue: { id: sourceIssue.id, code: sourceIssue.code, partnerName: sourceIssue.partnerName || null },
      });
    } catch (e: any) {
      if (transactionOpen) await db.run('ROLLBACK');
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to scan return serial' });
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
        const processingCompleted = await refreshProcessingAfterSerialScan(documentId);
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'SERIAL_SCANNED_OUT', entityType: 'SERIAL', documentId, entityId: locked.id,
          productId: fresh.productId, serialId: locked.id, warehouseId: sourceWarehouseId,
          quantity: -1, userId: user.id,
          metadata: { documentLineId, serial: code, processingCount: result.count },
        });
        await db.run('COMMIT'); transactionOpen = false;
        res.status(201).json({ serial: code, count: result.count, required: qty, completed: result.completed, processingCompleted });
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to scan serial for issue' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  /** Quét thông minh (Smart Scan): Tự động khớp Serial vào đúng dòng sản phẩm trên phiếu */
  router.post('/serials/scan-smart', validate(SmartScanSchema), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, serial } = req.body;
      const code = String(serial).trim();
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING' && doc.status !== 'READY') {
        return res.status(400).json({ error: 'Phiếu đã đóng hoặc đã hủy, không thể quét thêm Serial' });
      }

      const lines = await db.all(
        `SELECT l.*, p.name AS productName, p.tracking FROM stock_document_lines l
         LEFT JOIN products p ON p.id = l.productId WHERE l.documentId = ?`,
        [documentId]
      );
      if (!lines || lines.length === 0) {
        return res.status(400).json({ error: 'Phiếu chưa có dòng hàng nào' });
      }

      if (doc.docType === 'ISSUE' || doc.docType === 'TRANSFER') {
        const sourceWarehouseId = doc.docType === 'TRANSFER' ? doc.sourceWarehouseId : doc.warehouseId;
        const row = await db.get('SELECT * FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
        if (!row) {
          return res.status(404).json({ error: `Không tìm thấy Serial "${code}" trong kho. Serial này chưa từng nhập kho.` });
        }
        if (row.stockStatus === 'OUT') {
          const issueDoc = row.issueDocumentId
            ? await db.get('SELECT code FROM stock_documents WHERE id = ?', [row.issueDocumentId]).catch(() => null)
            : null;
          return res.status(400).json({ error: `Serial "${code}" đã xuất theo ${issueDoc?.code || 'phiếu khác'}` });
        }
        if (row.stockStatus === 'RESERVED' && row.issueDocumentId !== documentId) {
          const resDoc = row.issueDocumentId
            ? await db.get('SELECT code FROM stock_documents WHERE id = ?', [row.issueDocumentId]).catch(() => null)
            : null;
          return res.status(400).json({ error: `Serial "${code}" đang được giữ cho ${resDoc?.code || 'phiếu khác'}` });
        }
        if (row.warehouseId !== sourceWarehouseId) {
          return res.status(400).json({ error: `Serial "${code}" không nằm tại kho đang xuất (kho hiện tại: ${row.warehouseId})` });
        }

        const matchingLines = lines.filter((l: any) => l.productId === row.productId);
        if (matchingLines.length === 0) {
          return res.status(400).json({ error: `Serial "${code}" thuộc sản phẩm [${row.productId}], nhưng sản phẩm này không có trên phiếu ${doc.code || ''}` });
        }

        const already = matchingLines.find((l: any) => parseSerials(l.serialLot).some((s: string) => s.toLowerCase() === code.toLowerCase()));
        if (already) {
          return res.status(400).json({ error: `Serial "${code}" đã được quét cho dòng "${already.productName || already.productId}"` });
        }

        const targetLine = matchingLines.find((l: any) => parseSerials(l.serialLot).length < Number(l.quantity));
        if (!targetLine) {
          return res.status(400).json({ error: `Dòng sản phẩm "${matchingLines[0].productName || row.productId}" đã được quét đủ số lượng yêu cầu` });
        }

        await beginStockTransaction(db, [sourceWarehouseId]);
        transactionOpen = true;
        const locked = await db.get('SELECT * FROM stock_serials WHERE serialNumber = ? LIMIT 1 FOR UPDATE', [code]);
        const lockedState = locked?.stockStatus || 'IN_STOCK';
        if (!locked || (lockedState !== 'IN_STOCK' && !(lockedState === 'RESERVED' && locked?.issueDocumentId === documentId))) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(409).json({ error: 'Serial vừa bị giữ/xuất bởi người khác, hãy quét lại' });
        }
        const fresh = await db.get('SELECT * FROM stock_document_lines WHERE id = ? FOR UPDATE', [targetLine.id]);
        if (!fresh) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(404).json({ error: 'Document line not found' }); }
        const freshSerials = parseSerials(fresh.serialLot);
        if (freshSerials.some((s) => s.toLowerCase() === code.toLowerCase()) || freshSerials.length >= Number(fresh.quantity)) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: 'Serial đã được thêm hoặc dòng đã đủ số lượng' });
        }
        await db.run(
          `UPDATE stock_serials SET stockStatus = 'RESERVED', issueDocumentId = ?, issueLineId = ?, updatedAt = ? WHERE id = ?`,
          [documentId, targetLine.id, new Date().toISOString(), locked.id]
        );
        const result = await appendLineSerial(fresh, code, true);
        const processingCompleted = await refreshProcessingAfterSerialScan(documentId);
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'SERIAL_SCANNED_OUT', entityType: 'SERIAL', documentId, entityId: locked.id,
          productId: fresh.productId, serialId: locked.id, warehouseId: sourceWarehouseId,
          quantity: -1, userId: user.id,
          metadata: { documentLineId: targetLine.id, serial: code, processingCount: result.count, smartMatch: true },
        });
        await db.run('COMMIT'); transactionOpen = false;
        return res.status(201).json({
          success: true, matchedLineId: targetLine.id, productId: fresh.productId,
          productName: targetLine.productName || fresh.productId, serial: code,
          count: result.count, required: Number(fresh.quantity), completed: result.completed, processingCompleted,
        });
      } else if (doc.docType === 'RECEIPT') {
        const exists = await db.get('SELECT id FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
        if (exists) {
          return res.status(409).json({ error: `Serial "${code}" đã tồn tại trong hệ thống. Không thể nhập lại mã này.` });
        }
        const alreadyInDoc = lines.find((l: any) => parseSerials(l.serialLot).some((s: string) => s.toLowerCase() === code.toLowerCase()));
        if (alreadyInDoc) {
          return res.status(400).json({ error: `Serial "${code}" đã được quét trên phiếu này` });
        }
        const targetLine = lines.find((l: any) => parseSerials(l.serialLot).length < Number(l.quantity));
        if (!targetLine) {
          return res.status(400).json({ error: 'Tất cả các dòng hàng trên phiếu nhập đã đủ số lượng' });
        }

        await beginStockTransaction(db, [doc.warehouseId]);
        transactionOpen = true;
        const fresh = await db.get('SELECT * FROM stock_document_lines WHERE id = ? FOR UPDATE', [targetLine.id]);
        if (!fresh) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(404).json({ error: 'Document line not found' }); }
        const freshSerials = parseSerials(fresh.serialLot);
        if (freshSerials.length >= Number(fresh.quantity)) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: 'Dòng sản phẩm đã đủ số lượng' });
        }
        const dup = await db.get('SELECT id FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
        if (dup) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(409).json({ error: `Serial "${code}" vừa được ghi nhận bởi người khác.` });
        }
        const result = await appendLineSerial(fresh, code, true);
        const processingCompleted = await refreshProcessingAfterSerialScan(documentId);
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'SERIAL_SCANNED_IN', entityType: 'SERIAL', documentId, entityId: code,
          productId: fresh.productId, warehouseId: doc.warehouseId, quantity: 1, userId: user.id,
          metadata: { documentLineId: targetLine.id, serial: code, processingCount: result.count, smartMatch: true },
        });
        await db.run('COMMIT'); transactionOpen = false;
        return res.status(201).json({
          success: true, matchedLineId: targetLine.id, productId: fresh.productId,
          productName: targetLine.productName || fresh.productId, serial: code,
          count: result.count, required: Number(fresh.quantity), completed: result.completed, processingCompleted,
        });
      } else {
        return res.status(400).json({ error: 'Chức năng quét thông minh chưa hỗ trợ loại phiếu này' });
      }
    } catch (e: any) {
      if (transactionOpen) await db.run('ROLLBACK');
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Thao tác quét thông minh thất bại' });
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
        const serialRequired = true;
        const serialSkipped = false;
        const tracking = 'SERIAL';
        const required = Number(line.quantity);
        const processed = parseSerials(line.serialLot).length;
        const lots: any[] = [];
        const completed = processed === required;
        let availability: any = null;
        if (doc.docType === 'ISSUE') {
          availability = await db.get(
            `SELECT COALESCE(SUM(onHand), 0) AS onHand, COALESCE(SUM(reserved), 0) AS reserved,
                    COALESCE(SUM(onHand - reserved), 0) AS available
             FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ?`,
            [line.productId, doc.warehouseId, line.locationId || '']
          ).catch(() => ({ onHand: 0, reserved: 0, available: 0 }));
          availability = { ...availability, afterIssue: Number(availability.available || 0) - required };
        }
        out.push({
          lineId: line.id, productId: line.productId,
          productName: (line as any).productName || line.productId,
          required, processed, tracking, lots,
          serials: parseSerials(line.serialLot),
          serialSkipped,
          canEnableSerial: !serialRequired
            && !serialSkipped
            && line.processingStatus === 'PENDING'
            && parseSerials(line.serialLot).length === 0,
          quantityConfirmed: line.processingStatus !== 'PENDING' || parseSerials(line.serialLot).length > 0,
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

  /**
   * Chuyển một dòng xuất/điều chuyển cũ sang quy trình Serial chuẩn.
   * Phiếu mới đã lưu serialRequired = 1 từ lúc tạo; endpoint này chỉ là
   * đường nâng cấp có kiểm soát cho các phiếu còn ở trạng thái chưa xử lý.
   */
  router.post('/lines/:id/enable-serial', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ?', [String(req.params.id)]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [line.documentId]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') {
        return res.status(400).json({ error: 'Phiếu không còn ở bước xử lý hàng hóa' });
      }
      if (Number(line.serialRequired) === 1) return res.json({ success: true, serialRequired: true });
      if (Number(line.serialSkipped) === 1 || line.processingStatus !== 'PENDING' || parseSerials(line.serialLot).length > 0) {
        return res.status(400).json({ error: 'Dòng hàng đã được xử lý. Hãy đặt lại xử lý trước khi chuyển sang quét Serial.' });
      }

      await beginStockTransaction(db, [doc.warehouseId || doc.sourceWarehouseId].filter(Boolean) as string[]);
      transactionOpen = true;
      await db.run(
        `UPDATE stock_document_lines
         SET serialRequired = 1, serialSkipped = 0, actualQty = NULL, varianceQty = NULL,
             varianceReason = NULL, processingStatus = 'PENDING'
         WHERE id = ?`,
        [line.id]
      );
      await recordWarehouseActivity(db.run.bind(db), {
        actionType: 'SERIAL_TRACKING_ENABLED', entityType: 'DOCUMENT_LINE', entityId: line.id,
        documentId: doc.id, documentCode: doc.code, productId: line.productId,
        warehouseId: doc.warehouseId || doc.sourceWarehouseId, quantity: Number(line.quantity), userId: user.id,
        metadata: { source: 'legacy_document_line' },
      });
      await db.run('COMMIT'); transactionOpen = false;
      return res.json({ success: true, serialRequired: true });
    } catch (e: any) {
      if (transactionOpen) await db.run('ROLLBACK');
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Không thể chuyển dòng hàng sang quét Serial' });
    }
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
      const expected = Number(line.quantity);
      const actual = Number(req.body.actualQty);
      if (actual !== expected) {
        return res.status(400).json({ error: `Mọi dòng hàng phải xác nhận đủ ${expected} sản phẩm rồi quét đủ ${expected} Serial.` });
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
          metadata: { tracking: 'SERIAL', serialRequired: true, actualQty: expected },
        });
        await db.run('COMMIT'); transactionOpen = false;
        return res.json({ quantityConfirmed: true, requiredQty: expected });
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
    return res.status(400).json({ error: 'Mọi dòng hàng phải quét đủ Serial. Không còn hỗ trợ hoàn tất phiếu bằng lựa chọn “Không có Serial”.' });
    /* Legacy implementation retained temporarily for migration context.
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
    } */
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
