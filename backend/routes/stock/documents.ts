import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import { resolveTracking } from '../../utils/tracking.js';
import type { StockContext } from './context.js';

export function documentsRoutes(ctx: StockContext) {
  const { db, listScope, isDirector, requireWarehouse, canReadDocument, canWriteDocument, assertLocation, availableOf, saleableLocationSet, assertNotCounting, postMove, docCode, nextDocCode, paginationOf } = ctx;
  const router = Router();
  // ── Chứng từ: danh sách ─────────────────────────────────────────────────────

  router.get('/documents', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { docType, status, warehouseId } = req.query as Record<string, string | undefined>;
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
      if (status?.trim()) { query += ' AND d.status = ?'; params.push(status.trim()); }
      if (warehouseId) { query += ' AND (d.warehouseId = ? OR d.sourceWarehouseId = ? OR d.destWarehouseId = ?)'; params.push(warehouseId, warehouseId, warehouseId); }
      else if (!isDirector(user)) {
        query += ` AND (d.warehouseId IN (${scope.map(() => '?').join(', ')}) OR d.sourceWarehouseId IN (${scope.map(() => '?').join(', ')}) OR d.destWarehouseId IN (${scope.map(() => '?').join(', ')}))`;
        params.push(...scope, ...scope, ...scope);
      }
      query += ' ORDER BY d.createdAt DESC';
      const docPage = paginationOf(req.query as Record<string, string | undefined>);
      query += ' LIMIT ? OFFSET ?';
      params.push(docPage.limit, docPage.offset);
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock documents' }); }
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
          await db.run('DELETE FROM stock_document_lines WHERE documentId = ?', [id]);
          for (const line of body.lines) {
            const q = Number(line.quantity) || 0;
            const p = Number(line.unitPrice) || 0;
            const rate = Number(line.vatRate) || 0;
            const linePreTax = q * p;
            const lineVat = line.vatAmount !== undefined ? Number(line.vatAmount) : (linePreTax * rate / 100);
            const lineTotal = line.totalAmount !== undefined ? Number(line.totalAmount) : (linePreTax + lineVat);
            computedPreTax += linePreTax;
            computedVat += lineVat;
            await db.run(
              `INSERT INTO stock_document_lines (
                id, documentId, productId, quantity, unitPrice, locationId, note,
                accountDebit, accountCredit, vatRate, vatAmount, totalAmount, projectId, costItem, serialLot, costObjectId
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                randomUUID(), id, line.productId, q, p, line.locationId ?? null, line.note ?? null,
                line.accountDebit || '1561', line.accountCredit || '331',
                rate, lineVat, lineTotal, line.projectId ?? null, line.costItem ?? null,
                line.serialLot ?? null, line.costObjectId ?? null
              ]
            );
          }
          totalPreTax = body.totalPreTax !== undefined ? Number(body.totalPreTax) : computedPreTax;
          vatAmount = body.vatAmount !== undefined ? Number(body.vatAmount) : computedVat;
          totalAmount = body.totalAmount !== undefined ? Number(body.totalAmount) : (totalPreTax + vatAmount);
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
            body.vatRate !== undefined ? Number(body.vatRate) : doc.vatRate,
            vatAmount,
            totalAmount,
            body.shippingFee !== undefined ? Number(body.shippingFee) : doc.shippingFee,
            body.paymentStatus ?? doc.paymentStatus,
            body.paymentDueDate ?? doc.paymentDueDate,
            attachmentsStr,
            now,
            id
          ]
        );
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

    let computedPreTax = 0;
    let computedVat = 0;
    for (const line of body.lines) {
      const q = Number(line.quantity) || 0;
      const p = Number(line.unitPrice) || 0;
      const rate = Number(line.vatRate) || 0;
      const linePreTax = q * p;
      const lineVat = line.vatAmount !== undefined ? Number(line.vatAmount) : (linePreTax * rate / 100);
      computedPreTax += linePreTax;
      computedVat += lineVat;
    }
    const totalPreTax = body.totalPreTax !== undefined ? Number(body.totalPreTax) : computedPreTax;
    const vatAmount = body.vatAmount !== undefined ? Number(body.vatAmount) : computedVat;
    const totalAmount = body.totalAmount !== undefined ? Number(body.totalAmount) : (totalPreTax + vatAmount);
    const shippingFee = Number(body.shippingFee) || 0;
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
          totalPreTax, Number(body.vatRate) || 0, vatAmount, totalAmount, shippingFee,
          body.paymentStatus || 'UNPAID', body.paymentDueDate ?? null,
          attachmentsStr, body.referenceType ?? null, body.referenceId ?? null, body.notes ?? null,
          user.id, now, now
        ]
      );
      for (const line of body.lines) {
        const q = Number(line.quantity) || 0;
        const p = Number(line.unitPrice) || 0;
        const rate = Number(line.vatRate) || 0;
        const linePreTax = q * p;
        const lineVat = line.vatAmount !== undefined ? Number(line.vatAmount) : (linePreTax * rate / 100);
        const lineTotal = line.totalAmount !== undefined ? Number(line.totalAmount) : (linePreTax + lineVat);
        await db.run(
          `INSERT INTO stock_document_lines (
            id, documentId, productId, quantity, unitPrice, locationId, note,
            accountDebit, accountCredit, vatRate, vatAmount, totalAmount, projectId, costItem, serialLot, costObjectId
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(), id, line.productId, q, p, line.locationId ?? null, line.note ?? null,
            line.accountDebit || '1561', line.accountCredit || '331',
            rate, lineVat, lineTotal, line.projectId ?? null, line.costItem ?? null,
            line.serialLot ?? null, line.costObjectId ?? null
          ]
        );
      }
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

  async function loadDocument(id: string) {
    const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [id]);
    if (!doc) return null;
    const lines = await db.all('SELECT * FROM stock_document_lines WHERE documentId = ?', [id]);
    return { doc, lines };
  }

  function aggregateLines(lines: any[]): any[] {
    const totals = new Map<string, any>();
    for (const line of lines) {
      if (!line?.productId) continue;
      const key = JSON.stringify([line.productId, line.locationId || '']);
      const previous = totals.get(key);
      totals.set(key, { ...line, quantity: Number(line.quantity) + Number(previous?.quantity || 0) });
    }
    return [...totals.values()];
  }

  async function validateLines(lines: any[], warehouseId: string): Promise<string | null> {
    if (lines.length === 0) return 'Document has no lines';
    for (const line of lines) {
      if (!Number.isFinite(Number(line.quantity)) || !(Number(line.quantity) > 0)) return `Invalid quantity for product: ${line.productId}`;
    }
    const productIds = [...new Set(lines.map((l: any) => l.productId))];
    const foundProducts = await db.all(
      `SELECT id FROM products WHERE id IN (${productIds.map(() => '?').join(', ')})`,
      productIds
    ).catch(() => []);
    const foundSet = new Set((foundProducts || []).map((r: any) => r.id));
    for (const pid of productIds) {
      if (!foundSet.has(pid)) return `Unknown product: ${pid}`;
    }
    const locationIds = [...new Set(lines.map((l: any) => l.locationId || '').filter(Boolean))];
    if (locationIds.length > 0) {
      const locRows = await db.all(
        `SELECT id FROM stock_locations WHERE warehouseId = ? AND id IN (${locationIds.map(() => '?').join(', ')}) AND isActive = 1`,
        [warehouseId, ...locationIds]
      ).catch(() => []);
      const locSet = new Set((locRows || []).map((r: any) => r.id));
      for (const lid of locationIds) {
        if (!locSet.has(lid)) return `Invalid location for product: ${lines.find((l: any) => (l.locationId || '') === lid)?.productId}`;
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
   * SERIAL phải đủ serial, LOT/QUANTITY qua. */
  async function canComplete(doc: any, lines: any[]): Promise<{ ok: boolean; message?: string }> {
    const trackings = await productTrackings(lines.map((l: any) => l.productId));
    for (const line of lines) {
      if (trackings.get(line.productId) !== 'SERIAL') continue;
      const serials = parseSerials(line.serialLot);
      const qty = Number(line.quantity);
      const label = line.productId;
      if (serials.length === 0) {
        return { ok: false, message: `Chưa đủ Serial: ${label} (0/${qty}) — hàng SERIAL bắt buộc quét đủ mới được hoàn tất` };
      }
      if (!(serials.length === 1 && qty > 1) && serials.length !== qty) {
        return { ok: false, message: `Chưa đủ Serial: ${label} (${serials.length}/${qty})` };
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
   * chưa gắn phiếu xuất). Serial đã OUT thì chặn reset. */
  async function resetDocProcessing(documentId: string): Promise<void> {
    const issued = await db.get(
      `SELECT id FROM stock_serials WHERE (receiptDocumentId = ? OR issueDocumentId = ?) AND stockStatus = 'OUT' LIMIT 1`,
      [documentId, documentId]
    ).catch(() => undefined);
    if (issued) {
      throw Object.assign(new Error('Serial của phiếu đã xuất kho, không thể reset xử lý. Hãy dùng phiếu điều chỉnh/trả hàng.'), { status: 409 });
    }
    await db.run(`DELETE FROM stock_serials WHERE receiptDocumentId = ? OR issueDocumentId = ?`, [documentId, documentId]);
    await db.run(
      `UPDATE stock_document_lines SET processingStatus = 'PENDING', actualQty = NULL, varianceQty = NULL, varianceReason = NULL WHERE documentId = ?`,
      [documentId]
    );
  }

  /** Nhả serial đang RESERVED cho phiếu (hủy/xóa nháp): về IN_STOCK, xóa link xuất. */
  async function releaseReservedSerials(documentId: string): Promise<void> {
    await db.run(
      `UPDATE stock_serials SET stockStatus = 'IN_STOCK', issueDocumentId = NULL, issueLineId = NULL, updatedAt = ? WHERE issueDocumentId = ? AND stockStatus = 'RESERVED'`,
      [new Date().toISOString(), documentId]
    ).catch(() => undefined);
  }

  /** Đăng ký serial/lot khi hoàn tất NHẬP: dòng nào NV đã nhập serial thì lưu
   * vết bảo hành (warrantyStart = ngày hạch toán, months theo sản phẩm).
   * 1 mã cho cả dòng SL>1 -> lưu dạng lô; nhiều mã -> mỗi mã 1 serial và
   * số lượng mã phải khớp số lượng (khi đã nhập). */
  async function registerReceiptSerials(doc: any, lines: any[], user: any): Promise<void> {
    const withSerials = lines.filter((l) => parseSerials(l.serialLot).length > 0);
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
      if (serials.length === 1 && qty > 1) {
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
        throw serialError(`Serial ${(dupes[0] as any).serialNumber} đã tồn tại trong hệ thống`, 409);
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
          if (e.message?.includes('Duplicate')) throw serialError(`Serial ${sn} đã tồn tại trong hệ thống`, 409);
          throw e;
        }
      }
    }
  }

  /** Trừ serial khi hoàn tất XUẤT: serial đã nhập phải tồn tại (IN_STOCK,
   * đúng kho) và đủ số lượng dòng -> đánh dấu SOLD + khách hàng.
   * Token khớp lotCode (hàng lô) được chấp nhận theo vết, không đổi trạng thái. */
  async function consumeIssueSerials(doc: any, lines: any[], user: any): Promise<void> {
    const withSerials = lines.filter((l) => parseSerials(l.serialLot).length > 0);
    if (withSerials.length === 0) return;
    for (const line of withSerials) {
      const serials = parseSerials(line.serialLot);
      const qty = Number(line.quantity);
      if (serials.length === 1 && qty > 1) {
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
        await db.run(
          `UPDATE stock_serials SET status = 'SOLD', stockStatus = 'OUT', outDate = ?, customerName = ?, issueDocumentId = ?, issueLineId = ?, updatedAt = ? WHERE id = ?`,
          [nowOut, doc.partnerName ?? null, doc.id, line.id, nowOut, (row as any).id]
        );
      }
    }
  }

  /** Nhận lại serial khi hoàn tất TRẢ HÀNG: serial đã từng xuất (SOLD) được
   * đưa về SALEABLE tại vị trí trả + xóa khách; serial chưa từng đăng ký thì
   * ghi mới như nhập (giữ vết bảo hành theo sản phẩm). */
  async function registerReturnSerials(doc: any, lines: any[], user: any): Promise<void> {
    const withSerials = lines.filter((l) => parseSerials(l.serialLot).length > 0);
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
      if (serials.length === 1 && qty > 1) {
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
          `SELECT id FROM stock_serials WHERE serialNumber = ? AND productId = ? LIMIT 1 FOR UPDATE`,
          [sn, line.productId]
        );
        if (row) {
          await db.run(
            `UPDATE stock_serials SET status = 'SALEABLE', warehouseId = ?, locationId = ?, receiptId = ?, customerName = NULL, updatedAt = ? WHERE id = ?`,
            [doc.warehouseId, line.locationId || null, doc.id, now, (row as any).id]
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
      const loaded = await loadDocument(String(req.params.id));
      if (!loaded || loaded.doc.docType !== 'RECEIPT') return res.status(404).json({ error: 'Receipt not found' });
      if (loaded.doc.status !== 'DRAFT' && loaded.doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft receipts can be completed' });
      const access = await requireWarehouse(user, loaded.doc.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const err = await validateLines(loaded.lines, loaded.doc.warehouseId);
      if (err) return res.status(400).json({ error: err });
      try {
        await assertProcessable(loaded.doc, loaded.lines);
      } catch (e: any) {
        return res.status(e.status || 400).json({ error: e.message });
      }

      try {
        await registerReceiptSerials(loaded.doc, loaded.lines, user);
        for (const line of loaded.lines) {
          await postMove(db.run.bind(db), {
            productId: line.productId, warehouseId: loaded.doc.warehouseId, locationId: line.locationId || '',
            quantity: Number(line.quantity), moveType: 'RECEIPT',
            referenceType: loaded.doc.referenceType, referenceId: loaded.doc.id,
            documentLineId: line.id, createdBy: user.id,
          });
        }
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
      const loaded = await loadDocument(String(req.params.id));
      if (!loaded || loaded.doc.docType !== 'ISSUE') return res.status(404).json({ error: 'Issue not found' });
      if (loaded.doc.status !== 'DRAFT' && loaded.doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft issues can be completed' });
      const access = await requireWarehouse(user, loaded.doc.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
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
        if (!saleable.has(line.locationId || '')) return res.status(400).json({ error: 'Only saleable stock can be issued' });
      }
      const avail = await availableMap(loaded.doc.warehouseId, agg.map((l) => ({ productId: l.productId, locationId: l.locationId || '' })));
      for (const line of agg) {
        if ((avail.get(`${line.productId}|${line.locationId || ''}`) ?? 0) < Number(line.quantity)) {
          return res.status(400).json({ error: `Insufficient available stock for product: ${line.productId}` });
        }
      }

      try {
        await consumeIssueSerials(loaded.doc, loaded.lines, user);
        for (const line of loaded.lines) {
          await postMove(db.run.bind(db), {
            productId: line.productId, warehouseId: loaded.doc.warehouseId, locationId: line.locationId || '',
            quantity: -Number(line.quantity), moveType: 'ISSUE',
            referenceType: loaded.doc.referenceType, referenceId: loaded.doc.id,
            documentLineId: line.id, createdBy: user.id,
          });
        }
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
      const loaded = await loadDocument(String(req.params.id));
      if (!loaded || loaded.doc.docType !== 'RETURN') return res.status(404).json({ error: 'Return not found' });
      if (loaded.doc.status !== 'DRAFT') return res.status(400).json({ error: 'Only draft returns can be completed' });
      const access = await requireWarehouse(user, loaded.doc.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const err = await validateLines(loaded.lines, loaded.doc.warehouseId);
      if (err) return res.status(400).json({ error: err });

      try {
        await registerReturnSerials(loaded.doc, loaded.lines, user);
        for (const line of loaded.lines) {
          await postMove(db.run.bind(db), {
            productId: line.productId, warehouseId: loaded.doc.warehouseId, locationId: line.locationId || '',
            quantity: Number(line.quantity), moveType: 'RETURN',
            referenceType: loaded.doc.referenceType, referenceId: loaded.doc.id,
            documentLineId: line.id, createdBy: user.id,
          });
        }
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
      const loaded = await loadDocument(String(req.params.id));
      if (!loaded || loaded.doc.docType !== 'TRANSFER') return res.status(404).json({ error: 'Transfer not found' });
      if (loaded.doc.status !== 'DRAFT') return res.status(400).json({ error: 'Only draft transfers can be shipped' });
      const from = await requireWarehouse(user, loaded.doc.sourceWarehouseId);
      const to = await requireWarehouse(user, loaded.doc.destWarehouseId);
      if (!from.ok || !to.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const err = await validateLines(loaded.lines, loaded.doc.sourceWarehouseId);
      if (err) return res.status(400).json({ error: err });
      const agg = aggregateLines(loaded.lines);
      const avail = await availableMap(loaded.doc.sourceWarehouseId, agg.map((l) => ({ productId: l.productId, locationId: l.locationId || '' })));
      for (const line of agg) {
        if ((avail.get(`${line.productId}|${line.locationId || ''}`) ?? 0) < Number(line.quantity)) {
          return res.status(400).json({ error: `Insufficient available stock for product: ${line.productId}` });
        }
      }

      try {
        for (const line of loaded.lines) {
          await postMove(db.run.bind(db), {
            productId: line.productId, warehouseId: loaded.doc.sourceWarehouseId, locationId: line.locationId || '',
            quantity: -Number(line.quantity), moveType: 'TRANSFER_OUT',
            referenceType: 'TRANSFER', referenceId: loaded.doc.id,
            documentLineId: line.id, createdBy: user.id,
          });
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
      const loaded = await loadDocument(String(req.params.id));
      if (!loaded || loaded.doc.docType !== 'TRANSFER') return res.status(404).json({ error: 'Transfer not found' });
      if (loaded.doc.status !== 'IN_TRANSIT') return res.status(400).json({ error: 'Only in-transit transfers can be received' });
      const destinationLocation = req.body.locationId || '';
      if (!(await assertLocation(loaded.doc.destWarehouseId, destinationLocation))) return res.status(400).json({ error: 'Invalid destination location' });
      const to = await requireWarehouse(user, loaded.doc.destWarehouseId);
      if (!to.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });

      try {
        for (const line of loaded.lines) {
          await postMove(db.run.bind(db), {
            productId: line.productId, warehouseId: loaded.doc.destWarehouseId, locationId: destinationLocation,
            quantity: Number(line.quantity), moveType: 'TRANSFER_IN',
            referenceType: 'TRANSFER', referenceId: loaded.doc.id,
            documentLineId: line.id, createdBy: user.id,
          });
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
    await db.run(`UPDATE stock_documents SET status = 'PROCESSING', updatedAt = ? WHERE id = ? AND status = 'DRAFT'`, [new Date().toISOString(), docId]);
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
      const trackings = await productTrackings([line.productId]);
      if (trackings.get(line.productId) !== 'SERIAL') {
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
      if (exists) return res.status(409).json({ error: 'Serial này đã tồn tại trong hệ thống' });

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
          return res.status(409).json({ error: 'Serial này đã tồn tại trong hệ thống' });
        }
        const result = await appendLineSerial(fresh, code, true);
        await touchProcessing(documentId);
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
      if (!doc || doc.docType !== 'ISSUE') return res.status(404).json({ error: 'Issue not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft issues can be processed' });

      // Đối chiếu trực tiếp với lịch sử nhập: tồn tại + đúng SP + IN_STOCK + đúng kho + có nguồn nhập.
      const row = await db.get('SELECT * FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
      if (!row) return res.status(404).json({ error: 'Không tìm thấy Serial trong lịch sử nhập kho. Không được phép xuất thiết bị này.' });
      const line0 = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND documentId = ?', [documentLineId, documentId]);
      if (!line0) return res.status(404).json({ error: 'Document line not found' });
      if (row.productId !== line0.productId) {
        return res.status(400).json({ error: 'Serial thuộc sản phẩm khác với sản phẩm trên phiếu xuất' });
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
        return res.status(400).json({ error: 'Serial đang được giữ cho phiếu xuất khác' });
      }
      if (row.warehouseId !== doc.warehouseId) {
        return res.status(400).json({ error: 'Serial hiện không nằm tại kho đang xuất' });
      }
      const trackings = await productTrackings([line0.productId]);
      if (trackings.get(line0.productId) !== 'SERIAL') {
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

      await beginStockTransaction(db, [doc.warehouseId]);
      transactionOpen = true;
      try {
        const locked = await db.get('SELECT * FROM stock_serials WHERE serialNumber = ? LIMIT 1 FOR UPDATE', [code]);
        const lockedState = locked?.stockStatus || 'IN_STOCK';
        if (!locked || (lockedState !== 'IN_STOCK' && !(lockedState === 'RESERVED' && locked?.issueDocumentId === documentId))) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(409).json({ error: 'Serial vừa bị giữ/xuất bởi người khác, hãy quét lại' });
        }
        if (locked.warehouseId !== doc.warehouseId || locked.productId !== line0.productId) {
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
  return router;
}
