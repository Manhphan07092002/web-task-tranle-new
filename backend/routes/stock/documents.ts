import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import { createDocumentContext } from './documentContext.js';
import { DEFAULT_VAT_RATE, DOC_CODE_PREFIX, ReceiptSchema, TransferSchema, RelocationSchema, ScanSchema, SerialEditSchema, SmartScanSchema } from './documentSchemas.js';
import type { StockContext } from './context.js';

export function documentsRoutes(ctx: StockContext) {
  const { db, listScope, isDirector, requireWarehouse, requireWarehouseManager, docWarehouseIds, canReadDocument, canWriteDocument, assertLocation, availableOf, saleableLocationSet, assertNotCounting, postMove, postMoves, recordWarehouseActivity, resolveAccountingDefaults, docCode, nextDocCode, paginationOf } = ctx;
  // Helper ghi sổ/validate nằm trong documentContext để các sub-router (bước sau)
  // dùng chung; ở đây chỉ cần đưa chúng vào scope của các handler.
  const {
    createDocument, loadDocument, effectiveLineQuantity, aggregateLines, validateLines, availableMap, formatStockQuantity,
    insufficientStockMessage, parseSerials, serialError, productTrackings, requiresSerial, lotCoverage, canComplete,
    assertProcessable, preflightPosting, processingStarted, resetDocProcessing, dropDocLots, releaseReservedSerials,
    dropDocReservationLinks, loadIssueReservationLinks, reservationCreditFromLinks, syncDocumentReservationLinks,
    consumeIssueReservationLinks, registerReceiptSerials, consumeIssueLots, consumeIssueSerials, assertTransferSerialsReady,
    receiveTransferSerials, consumeTransferLotsOnShip, receiveTransferLots, postDocumentMoves, postTransferMoves,
    registerReturnSerials, registerReturnLots, appendLineSerial, touchProcessing, refreshProcessingAfterSerialScan,
  } = createDocumentContext(ctx);
  const router = Router();
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
      // FE gọi /next-code trước khi form chọn kho nên warehouseId là tùy chọn;
      // người không có kho nào trong scope thì không được xem số phiếu.
      const warehouseId = req.query.warehouseId ? String(req.query.warehouseId) : '';
      const scope = await listScope(user);
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.status(403).json({ error: 'Warehouse outside your scope' });
      }
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
