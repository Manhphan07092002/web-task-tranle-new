import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
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
      if (doc.status !== 'DRAFT') {
        return res.status(400).json({ error: 'Only draft documents can be cancelled' });
      }
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
      if (doc.status !== 'DRAFT' && doc.status !== 'CANCELLED') {
        return res.status(400).json({ error: 'Cannot delete processed document' });
      }
      await beginStockTransaction(db);
      try {
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
      if (doc.status !== 'DRAFT') {
        return res.status(400).json({ error: 'Only draft documents can be modified' });
      }
      const now = new Date().toISOString();
      const body = req.body;
      let totalPreTax = doc.totalPreTax;
      let vatAmount = doc.vatAmount;
      let totalAmount = doc.totalAmount;

      await beginStockTransaction(db);
      try {
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
      if (loaded.doc.status !== 'DRAFT') return res.status(400).json({ error: 'Only draft receipts can be completed' });
      const access = await requireWarehouse(user, loaded.doc.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const err = await validateLines(loaded.lines, loaded.doc.warehouseId);
      if (err) return res.status(400).json({ error: err });

      try {
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
      if (loaded.doc.status !== 'DRAFT') return res.status(400).json({ error: 'Only draft issues can be completed' });
      const access = await requireWarehouse(user, loaded.doc.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const err = await validateLines(loaded.lines, loaded.doc.warehouseId);
      if (err) return res.status(400).json({ error: err });
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
  return router;
}
