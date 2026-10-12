import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import type { StockContext } from './shared.js';

// â”€â”€ Chá»©ng tá»« nháº­p/xuáº¥t/Ä‘iá»u chuyá»ƒn (tÃ¡ch tá»« routes/stock.ts, giá»¯ nguyÃªn hÃ nh vi) â”€â”€
export function stockDocumentRoutes(db: any, ctx: StockContext) {
  const router = Router();
  const { scopeOf, isDirector, requireWarehouse, assertLocation, isSaleableLocation, availableOf, postMove, docCode } = ctx;

  // â”€â”€ Chá»©ng tá»«: danh sÃ¡ch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  router.get('/documents', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot view business stock data' });
      }
      const scope = await scopeOf(user);
      const { docType, status, warehouseId } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT d.*, w.name AS warehouseName FROM stock_documents d LEFT JOIN warehouses w ON w.id = d.warehouseId WHERE 1=1`;
      const params: any[] = [];
      if (docType?.trim()) { query += ' AND d.docType = ?'; params.push(docType.trim()); }
      if (status?.trim()) { query += ' AND d.status = ?'; params.push(status.trim()); }
      if (warehouseId) { query += ' AND (d.warehouseId = ? OR d.sourceWarehouseId = ? OR d.destWarehouseId = ?)'; params.push(warehouseId, warehouseId, warehouseId); }
      else if (!isDirector(user)) {
        query += ` AND (d.warehouseId IN (${scope.map(() => '?').join(', ')}) OR d.sourceWarehouseId IN (${scope.map(() => '?').join(', ')}) OR d.destWarehouseId IN (${scope.map(() => '?').join(', ')}))`;
        params.push(...scope, ...scope, ...scope);
      }
      query += ' ORDER BY d.createdAt DESC';
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock documents' }); }
  });

  // â”€â”€ Chá»©ng tá»«: táº¡o â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const LineSchema = z.object({
    productId: z.string().trim().min(1).max(191),
    quantity: z.number().finite().positive().max(1_000_000_000),
    unitPrice: z.number().finite().min(0).max(1_000_000_000_000).optional(),
    locationId: z.string().trim().max(191).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  });
  const ReceiptSchema = z.object({
    warehouseId: z.string().trim().min(1).max(191),
    lines: z.array(LineSchema).min(1).max(500),
    referenceType: z.string().max(64).nullable().optional(),
    referenceId: z.string().max(191).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
  });
  const TransferSchema = z.object({
    sourceWarehouseId: z.string().trim().min(1).max(191),
    destWarehouseId: z.string().trim().min(1).max(191),
    lines: z.array(LineSchema).min(1).max(500),
    notes: z.string().max(5000).nullable().optional(),
  });

  async function createDocument(docType: string, code: string, warehouses: { warehouseId?: string | null; sourceWarehouseId?: string | null; destWarehouseId?: string | null }, body: any, user: any) {
    const now = new Date().toISOString();
    const id = randomUUID();
    await beginStockTransaction(db);
    try {
    const validationError = await validateLines(body.lines, warehouses.warehouseId || warehouses.sourceWarehouseId || '');
    if (validationError) throw Object.assign(new Error(validationError), { status: 400 });
    await db.run(
      `INSERT INTO stock_documents (id, code, docType, status, warehouseId, sourceWarehouseId, destWarehouseId, referenceType, referenceId, notes, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, code, docType, warehouses.warehouseId ?? null, warehouses.sourceWarehouseId ?? null, warehouses.destWarehouseId ?? null,
        body.referenceType ?? null, body.referenceId ?? null, body.notes ?? null, user.id, now, now]
    );
    for (const line of body.lines) {
      await db.run(
        'INSERT INTO stock_document_lines (id, documentId, productId, quantity, unitPrice, locationId, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), id, line.productId, line.quantity, line.unitPrice ?? 0, line.locationId ?? null, line.note ?? null]
      );
    }
    await db.run('COMMIT');
    return { id, code };
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  }

  router.post('/receipts', validate(ReceiptSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const access = await requireWarehouse(user, req.body.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      res.status(201).json(await createDocument('RECEIPT', docCode('PNK'), { warehouseId: req.body.warehouseId }, req.body, user));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to create receipt' }); }
  });

  router.post('/issues', validate(ReceiptSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const access = await requireWarehouse(user, req.body.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      res.status(201).json(await createDocument('ISSUE', docCode('PXK'), { warehouseId: req.body.warehouseId }, req.body, user));
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
      res.status(201).json(await createDocument('TRANSFER', docCode('DCK'), {
        sourceWarehouseId: req.body.sourceWarehouseId, destWarehouseId: req.body.destWarehouseId,
      }, req.body, user));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to create transfer' }); }
  });

  // â”€â”€ Chá»©ng tá»«: hoÃ n táº¥t (sinh moves + balances, transaction) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function loadDocument(id: string) {
    const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [id]);
    if (!doc) return null;
    const lines = await db.all('SELECT * FROM stock_document_lines WHERE documentId = ?', [id]);
    return { doc, lines };
  }

  function aggregateLines(lines: any[]): any[] {
    const totals = new Map<string, any>();
    for (const line of lines) {
      const key = JSON.stringify([line.productId, line.locationId || '']);
      const previous = totals.get(key);
      totals.set(key, { ...line, quantity: Number(line.quantity) + Number(previous?.quantity || 0) });
    }
    return [...totals.values()];
  }

  async function validateLines(lines: any[], warehouseId: string): Promise<string | null> {
    if (lines.length === 0) return 'Document has no lines';
    for (const line of lines) {
      const product = await db.get('SELECT id FROM products WHERE id = ?', [line.productId]);
      if (!product) return `Unknown product: ${line.productId}`;
      if (!Number.isFinite(Number(line.quantity)) || !(Number(line.quantity) > 0)) return `Invalid quantity for product: ${line.productId}`;
      if (!(await assertLocation(warehouseId, line.locationId))) return `Invalid location for product: ${line.productId}`;
    }
    return null;
  }

  router.post('/receipts/:id/complete', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      await beginStockTransaction(db);
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
      await beginStockTransaction(db);
      transactionOpen = true;
      const loaded = await loadDocument(String(req.params.id));
      if (!loaded || loaded.doc.docType !== 'ISSUE') return res.status(404).json({ error: 'Issue not found' });
      if (loaded.doc.status !== 'DRAFT') return res.status(400).json({ error: 'Only draft issues can be completed' });
      const access = await requireWarehouse(user, loaded.doc.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const err = await validateLines(loaded.lines, loaded.doc.warehouseId);
      if (err) return res.status(400).json({ error: err });
      for (const line of aggregateLines(loaded.lines)) {
        if (!(await isSaleableLocation(loaded.doc.warehouseId, line.locationId || ''))) return res.status(400).json({ error: 'Only saleable stock can be issued' });
        const available = await availableOf(line.productId, loaded.doc.warehouseId, line.locationId || '');
        if (available < Number(line.quantity)) {
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
      await beginStockTransaction(db);
      transactionOpen = true;
      const loaded = await loadDocument(String(req.params.id));
      if (!loaded || loaded.doc.docType !== 'TRANSFER') return res.status(404).json({ error: 'Transfer not found' });
      if (loaded.doc.status !== 'DRAFT') return res.status(400).json({ error: 'Only draft transfers can be shipped' });
      const from = await requireWarehouse(user, loaded.doc.sourceWarehouseId);
      const to = await requireWarehouse(user, loaded.doc.destWarehouseId);
      if (!from.ok || !to.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const err = await validateLines(loaded.lines, loaded.doc.sourceWarehouseId);
      if (err) return res.status(400).json({ error: err });
      for (const line of aggregateLines(loaded.lines)) {
        const available = await availableOf(line.productId, loaded.doc.sourceWarehouseId, line.locationId || '');
        if (available < Number(line.quantity)) {
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
      await beginStockTransaction(db);
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

  return router;
}
