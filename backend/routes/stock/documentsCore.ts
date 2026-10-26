import { Router } from 'express';
import { randomUUID } from 'crypto';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import { DEFAULT_VAT_RATE, DOC_CODE_PREFIX } from './documentSchemas.js';
import type { DocumentContext } from './documentContext.js';

/** Đọc/sửa/hủy/xóa chứng từ, mã phiếu dự kiến — phần lõi trước mọi luồng ghi sổ. */
export function documentsCoreRoutes(d: DocumentContext) {
  const {
    db, listScope, isDirector, requireWarehouseManager, docWarehouseIds, canReadDocument, canWriteDocument,
    recordWarehouseActivity, resolveAccountingDefaults, nextDocCode, paginationOf, validateLines, parseSerials,
    processingStarted, resetDocProcessing, dropDocLots, releaseReservedSerials, dropDocReservationLinks,
    loadIssueReservationLinks, syncDocumentReservationLinks,
  } = d;
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

  return router;
}
