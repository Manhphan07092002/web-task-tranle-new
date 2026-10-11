import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../middleware/auth.js';
import { beginStockTransaction } from '../utils/stockTransaction.js';
import { stockReportRoutes } from './stockReports.js';
import { getWarehouseScope } from '../services/rbacService.js';

// Phase A backend kho (09_KHO_VAN §3, §13–18 + D10).
// - Mọi biến động tồn sinh stock_move + cập nhật balances TRONG transaction.
// - Không bao giờ UPDATE số tồn trực tiếp. Serial/lot + kiểm kê ở Phase B.
export function stockRoutes(db: any) {
  const router = Router();
  router.use(stockReportRoutes(db));

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function scopeOf(user: any): Promise<string[]> {
    return getWarehouseScope(db, user);
  }

  function isDirector(user: any): boolean {
    return normalizeManagementLevel(user?.managementLevel) >= MANAGEMENT_LEVELS.DIRECTOR
      && normalizeManagementLevel(user?.managementLevel) !== MANAGEMENT_LEVELS.ADMIN;
  }

  /** Admin (99) bị chặn business kho (D12); Director thấy tất cả; còn lại theo scope gán. */
  async function requireWarehouse(user: any, warehouseId: string): Promise<{ ok: boolean; scope: string[] }> {
    if (!user || normalizeManagementLevel(user?.managementLevel) === MANAGEMENT_LEVELS.ADMIN) return { ok: false, scope: [] };
    const scope = await scopeOf(user);
    if (isDirector(user)) return { ok: true, scope };
    return { ok: !!warehouseId && scope.includes(warehouseId), scope };
  }

  async function assertLocation(warehouseId: string, locationId: string | null | undefined): Promise<boolean> {
    if (!locationId) return true;
    const loc = await db.get('SELECT warehouseId, isActive, purpose FROM stock_locations WHERE id = ?', [locationId]);
    return !!loc && loc.warehouseId === warehouseId && (loc.isActive === 1 || loc.isActive === true);
  }

  async function isSaleableLocation(warehouseId: string, locationId: string): Promise<boolean> {
    if (!locationId) return true;
    const location = await db.get('SELECT warehouseId, isActive, purpose FROM stock_locations WHERE id = ?', [locationId]);
    return !!location && location.warehouseId === warehouseId && Boolean(location.isActive) && location.purpose === 'SALEABLE';
  }

  async function availableOf(productId: string, warehouseId: string, locationId: string): Promise<number> {
    const row = await db.get(
      'SELECT onHand, reserved FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ?',
      [productId, warehouseId, locationId]
    );
    return Number(row?.onHand ?? 0) - Number(row?.reserved ?? 0);
  }

  async function assertNotCounting(warehouseId: string) {
    const active = await db.get("SELECT id FROM stock_counts WHERE warehouseId = ? AND status = 'COUNTING' LIMIT 1", [warehouseId]);
    if (active) throw Object.assign(new Error('Kho đang kiểm kê; hoàn tất kiểm kê trước khi ghi sổ.'), { status: 409 });
  }

  async function postMove(run: (sql: string, params?: any[]) => Promise<unknown>, args: {
    productId: string; warehouseId: string; locationId: string; quantity: number;
    moveType: string; referenceType: string | null; referenceId: string;
    documentLineId: string | null; createdBy: string;
  }): Promise<void> {
    await assertNotCounting(args.warehouseId);
    const now = new Date().toISOString();
    await run(
      `INSERT INTO stock_moves (id, productId, warehouseId, locationId, quantity, moveType, referenceType, referenceId, documentLineId, createdBy, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), args.productId, args.warehouseId, args.locationId || null, args.quantity, args.moveType, args.referenceType, args.referenceId, args.documentLineId, args.createdBy, now]
    );
    await run(
      `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
       VALUES (?, ?, ?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)`,
      [args.productId, args.warehouseId, args.locationId, args.quantity, now]
    );
  }

  function docCode(prefix: string): string {
    const d = new Date();
    const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${stamp}-${rand}`;
  }

  // ── Tồn kho (đọc) ─────────────────────────────────────────────────────────

  router.get('/balances', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot view business stock data' });
      }
      const scope = await scopeOf(user);
      const { warehouseId, q, purpose } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT b.productId, b.warehouseId, b.locationId, b.onHand, b.reserved,
          CASE WHEN b.locationId = '' OR (l.isActive = 1 AND l.purpose = 'SALEABLE') THEN b.onHand - b.reserved ELSE 0 END AS available,
          p.name AS productName, w.code AS warehouseCode, w.name AS warehouseName,
          l.code AS locationCode, l.purpose AS locationPurpose
        FROM stock_balances b
        LEFT JOIN products p ON p.id = b.productId
        LEFT JOIN warehouses w ON w.id = b.warehouseId
        LEFT JOIN stock_locations l ON l.id = b.locationId
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND b.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND b.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      if (q?.trim()) { query += ' AND (p.name LIKE ? OR b.productId LIKE ?)'; params.push(`%${q.trim()}%`, `%${q.trim()}%`); }
      if (purpose?.trim()) { query += ' AND l.purpose = ?'; params.push(purpose.trim()); }
      query += ' ORDER BY w.name ASC, p.name ASC';
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock balances' }); }
  });

  // ── Chứng từ: danh sách ─────────────────────────────────────────────────────

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

  // ── Chứng từ: tạo ─────────────────────────────────────────────────────────

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

  // ── Cảnh báo tồn theo chính sách Min/Max (§26, TP+) ──────────────────────────
  router.get('/alerts', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot view business stock data' });
      }
      const scope = await scopeOf(user);
      const { warehouseId } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT b.productId, b.warehouseId,
          SUM(b.onHand) AS onHand, SUM(b.reserved) AS reserved,
          SUM(CASE WHEN b.locationId = '' OR (l.isActive = 1 AND l.purpose = 'SALEABLE') THEN b.onHand - b.reserved ELSE 0 END) AS available,
          p.name AS productName, w.code AS warehouseCode, w.name AS warehouseName,
          pol.minStock, pol.maxStock, pol.reorderPoint
        FROM stock_balances b
        LEFT JOIN products p ON p.id = b.productId
        LEFT JOIN warehouses w ON w.id = b.warehouseId
        LEFT JOIN product_warehouse_policies pol ON pol.productId = b.productId AND pol.warehouseId = b.warehouseId
        LEFT JOIN stock_locations l ON l.id = b.locationId AND l.warehouseId = b.warehouseId
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND b.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND b.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      query += ` GROUP BY b.productId, b.warehouseId, p.name, w.code, w.name, pol.minStock, pol.maxStock, pol.reorderPoint
        HAVING available <= 0
          OR (pol.reorderPoint IS NOT NULL AND pol.reorderPoint > 0 AND available < pol.reorderPoint)
          OR (pol.minStock IS NOT NULL AND pol.minStock > 0 AND available < pol.minStock)
          OR (pol.maxStock IS NOT NULL AND pol.maxStock > 0 AND onHand > pol.maxStock)
        ORDER BY available ASC`;
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock alerts' }); }
  });

  const PolicySchema = z.object({
    productId: z.string().trim().min(1).max(191),
    warehouseId: z.string().trim().min(1).max(191),
    minStock: z.number().finite().min(0).max(1_000_000_000),
    maxStock: z.number().finite().min(0).max(1_000_000_000),
    reorderPoint: z.number().finite().min(0).max(1_000_000_000),
    leadTimeDays: z.number().int().min(0).max(3650),
  });

  router.put('/policies', validate(PolicySchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      // NV không được sửa Min/Max (§10.3); Admin không đụng business (D12).
      if (normalizeManagementLevel(user.managementLevel) < MANAGEMENT_LEVELS.MANAGER
        || normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Only warehouse managers can set stock policies' });
      }
      const { productId, warehouseId, minStock, maxStock, reorderPoint, leadTimeDays } = req.body;
      const access = await requireWarehouse(user, warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const product = await db.get('SELECT id FROM products WHERE id = ?', [productId]);
      if (!product) return res.status(400).json({ error: `Unknown product: ${productId}` });
      if (maxStock > 0 && minStock > maxStock) {
        return res.status(400).json({ error: 'Min stock cannot exceed max stock' });
      }
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO product_warehouse_policies (productId, warehouseId, minStock, maxStock, reorderPoint, leadTimeDays, updatedBy, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE minStock = VALUES(minStock), maxStock = VALUES(maxStock),
           reorderPoint = VALUES(reorderPoint), leadTimeDays = VALUES(leadTimeDays),
           updatedBy = VALUES(updatedBy), updatedAt = VALUES(updatedAt)`,
        [productId, warehouseId, minStock, maxStock, reorderPoint, leadTimeDays, user.id, now]
      );
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to save stock policy' }); }
  });

  // ── Tồn lâu: có tồn nhưng quá hạn không di chuyển (§26) ──────────────────────

  router.get('/slow', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot view business stock data' });
      }
      const scope = await scopeOf(user);
      const { warehouseId, days } = req.query as Record<string, string | undefined>;
      const thresholdDays = Math.min(Math.max(Number(days) || 90, 1), 3650);
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000).toISOString();
      let query = `SELECT b.productId, b.warehouseId,
          SUM(b.onHand) AS onHand, SUM(b.onHand - b.reserved) AS available,
          p.name AS productName, w.code AS warehouseCode, w.name AS warehouseName,
          MAX(m.createdAt) AS lastMoveAt
        FROM stock_balances b
        LEFT JOIN products p ON p.id = b.productId
        LEFT JOIN warehouses w ON w.id = b.warehouseId
        LEFT JOIN stock_moves m ON m.productId = b.productId AND m.warehouseId = b.warehouseId
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND b.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND b.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      query += ` GROUP BY b.productId, b.warehouseId, p.name, w.code, w.name
        HAVING onHand > 0 AND (lastMoveAt IS NULL OR lastMoveAt < ?)
        ORDER BY lastMoveAt ASC`;
      params.push(cutoff);
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch slow-moving stock' }); }
  });

  // ── Giữ hàng / phân bổ (§21: hold/release/consume, TP+NV trong scope) ─────────

  router.get('/reservations', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot view business stock data' });
      }
      const scope = await scopeOf(user);
      const { warehouseId, status } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT r.*, p.name AS productName, w.name AS warehouseName
        FROM reservations r
        LEFT JOIN products p ON p.id = r.productId
        LEFT JOIN warehouses w ON w.id = r.warehouseId
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND r.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND r.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      if (status?.trim()) { query += ' AND r.status = ?'; params.push(status.trim()); }
      query += ' ORDER BY r.createdAt DESC';
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch reservations' }); }
  });

  const ReservationSchema = z.object({
    productId: z.string().trim().min(1).max(191),
    warehouseId: z.string().trim().min(1).max(191),
    locationId: z.string().trim().max(191).nullable().optional(),
    quantity: z.number().finite().positive().max(1_000_000_000),
    sourceType: z.enum(['SALES_ORDER', 'PROJECT', 'WARRANTY', 'INTERNAL']).optional(),
    sourceId: z.string().max(191).nullable().optional(),
    expiresAt: z.string().max(40).nullable().optional(),
  });

  router.post('/reservations', validate(ReservationSchema), async (req, res) => {
    let transactionOpen = false;
    try {
      await beginStockTransaction(db);
      transactionOpen = true;
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
      const { productId, warehouseId, locationId, quantity, sourceType, sourceId, expiresAt } = req.body;
      const access = await requireWarehouse(user, warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const product = await db.get('SELECT id FROM products WHERE id = ?', [productId]);
      if (!product) return res.status(400).json({ error: `Unknown product: ${productId}` });
      if (!(await assertLocation(warehouseId, locationId ?? null))) {
        return res.status(400).json({ error: 'Invalid location for this warehouse' });
      }
      if (!(await isSaleableLocation(warehouseId, locationId || ''))) return res.status(400).json({ error: 'Only saleable stock can be reserved' });
      // Chỉ giữ từ available (D10/§21) — không giữ hàng đã giữ.
      const available = await availableOf(productId, warehouseId, locationId || '');
      if (available < Number(quantity)) {
        return res.status(400).json({ error: `Insufficient available stock (available: ${available})` });
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      try {
        await db.run(
          `INSERT INTO reservations (id, productId, warehouseId, locationId, quantity, sourceType, sourceId, requestedBy, status, expiresAt, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'HELD', ?, ?)`,
          [id, productId, warehouseId, locationId || '', quantity, sourceType || 'INTERNAL', sourceId ?? null, user.id, expiresAt ?? null, now]
        );
        await db.run(
          `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
           VALUES (?, ?, ?, 0, ?, ?)
           ON DUPLICATE KEY UPDATE reserved = reserved + VALUES(reserved), updatedAt = VALUES(updatedAt)`,
          [productId, warehouseId, locationId || '', quantity, now]
        );
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.status(201).json({ id });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to hold stock' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  async function settleReservation(req: any, res: any, toStatus: 'RELEASED' | 'CONSUMED') {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
    let transactionOpen = false;
    try {
      await beginStockTransaction(db);
      transactionOpen = true;
      const r = await db.get('SELECT * FROM reservations WHERE id = ?', [String(req.params.id)]);
      if (!r) return res.status(404).json({ error: 'Reservation not found' });
      if (r.status !== 'HELD') return res.status(400).json({ error: 'Only held reservations can be settled' });
      const access = await requireWarehouse(user, r.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const now = new Date().toISOString();
      try {
        if (toStatus === 'CONSUMED') {
          await assertNotCounting(r.warehouseId);
          const bal = await db.get(
            'SELECT onHand FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ?',
            [r.productId, r.warehouseId, r.locationId || '']
          );
          if (Number(bal?.onHand ?? 0) < Number(r.quantity)) {
            await db.run('ROLLBACK'); transactionOpen = false;
            return res.status(400).json({ error: 'Insufficient on-hand stock to consume' });
          }
          await db.run(
            `INSERT INTO stock_moves (id, productId, warehouseId, locationId, quantity, moveType, referenceType, referenceId, createdBy, createdAt)
             VALUES (?, ?, ?, ?, ?, 'ISSUE', 'RESERVATION', ?, ?, ?)`,
            [randomUUID(), r.productId, r.warehouseId, r.locationId || '', -Number(r.quantity), r.id, user.id, now]
          );
          await db.run(
            'UPDATE stock_balances SET onHand = onHand - ?, reserved = reserved - ?, updatedAt = ? WHERE productId = ? AND warehouseId = ? AND locationId = ?',
            [Number(r.quantity), Number(r.quantity), now, r.productId, r.warehouseId, r.locationId || '']
          );
        } else {
          await db.run(
            'UPDATE stock_balances SET reserved = reserved - ?, updatedAt = ? WHERE productId = ? AND warehouseId = ? AND locationId = ?',
            [Number(r.quantity), now, r.productId, r.warehouseId, r.locationId || '']
          );
        }
        await db.run('UPDATE reservations SET status = ? WHERE id = ?', [toStatus, r.id]);
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to settle reservation' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  }

  router.post('/reservations/:id/release', async (req, res) => { await settleReservation(req, res, 'RELEASED'); });
  router.post('/reservations/:id/consume', async (req, res) => { await settleReservation(req, res, 'CONSUMED'); });

  // ── Kho & vị trí (§24: cây RECEIVING/SALEABLE/PICKING/..., TP quản lý) ─────────

  router.get('/locations', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot view business stock data' });
      }
      const scope = await scopeOf(user);
      const { warehouseId } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT l.*, w.name AS warehouseName FROM stock_locations l LEFT JOIN warehouses w ON w.id = l.warehouseId WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND l.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND l.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      query += ' ORDER BY w.name ASC, l.code ASC';
      res.json((await db.all(query, params)).map((r: any) => ({ ...r, isActive: Boolean(r.isActive) })));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch locations' }); }
  });

  const LocationSchema = z.object({
    warehouseId: z.string().trim().min(1).max(191),
    code: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(255),
    type: z.enum(['INTERNAL', 'SUPPLIER', 'CUSTOMER', 'TRANSIT', 'LOSS', 'ADJUSTMENT']).optional(),
    purpose: z.enum(['SALEABLE', 'WARRANTY', 'DAMAGED', 'DEMO', 'QUARANTINE', 'PICKING', 'RECEIVING', 'OTHER']).optional(),
    parentId: z.string().trim().max(191).nullable().optional(),
    isActive: z.boolean().optional(),
  });

  function requireWarehouseManager(user: any) {
    const level = normalizeManagementLevel(user?.managementLevel);
    return level >= MANAGEMENT_LEVELS.MANAGER && level !== MANAGEMENT_LEVELS.ADMIN;
  }

  router.post('/locations', validate(LocationSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage locations' });
      const { warehouseId, code, name, type, purpose, parentId } = req.body;
      const access = await requireWarehouse(user, warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const id = `loc-${randomUUID().slice(0, 8)}`;
      try {
        await db.run(
          'INSERT INTO stock_locations (id, warehouseId, parentId, code, name, type, purpose) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, warehouseId, parentId || null, code.trim().toUpperCase(), name.trim(), type || 'INTERNAL', purpose || 'SALEABLE']
        );
      } catch (e: any) {
        if (e.message?.includes('Duplicate')) return res.status(409).json({ error: 'Location code already exists in this warehouse' });
        throw e;
      }
      res.status(201).json({ id });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to create location' }); }
  });

  router.put('/locations/:id', validate(LocationSchema.partial()), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage locations' });
      const existing = await db.get('SELECT * FROM stock_locations WHERE id = ?', [String(req.params.id)]);
      if (!existing) return res.status(404).json({ error: 'Location not found' });
      const access = await requireWarehouse(user, existing.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const { name, type, purpose, parentId, isActive, code } = req.body;
      try {
        await db.run(
          'UPDATE stock_locations SET name = ?, type = ?, purpose = ?, parentId = ?, isActive = ?, code = ? WHERE id = ?',
          [name?.trim() || existing.name, type || existing.type, purpose || existing.purpose,
            parentId !== undefined ? (parentId || null) : existing.parentId,
            isActive === undefined ? existing.isActive : (isActive ? 1 : 0),
            code?.trim() ? code.trim().toUpperCase() : existing.code, existing.id]
        );
      } catch (e: any) {
        if (e.message?.includes('Duplicate')) return res.status(409).json({ error: 'Location code already exists in this warehouse' });
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to update location' }); }
  });

  // ── Serial / Lô Phase B (§22: đăng ký + truy vết cơ bản) ──────────────────────

  const SERIAL_STATUSES = ['SALEABLE', 'WARRANTY', 'DAMAGED', 'DEMO', 'QUARANTINE', 'SOLD'];

  router.get('/serials', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot view business stock data' });
      }
      const scope = await scopeOf(user);
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

  // ── Combo / bộ sản phẩm (§23: buildable từ available) ─────────────────────────

  router.get('/bundles', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot view business stock data' });
      }
      const scope = await scopeOf(user);
      const { warehouseId } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      const warehouses = warehouseId ? [warehouseId] : isDirector(user)
        ? (await db.all('SELECT id FROM warehouses')).map((w: any) => w.id)
        : scope;
      const bundles = await db.all(`SELECT * FROM product_bundles WHERE isActive IS NULL OR isActive = 1 ORDER BY name ASC`);
      const items = await db.all('SELECT bi.bundleId, bi.productId, bi.qtyPerBundle, p.name AS productName FROM product_bundle_items bi LEFT JOIN products p ON p.id = bi.productId');
      const avail = warehouses.length > 0 ? await db.all(
        `SELECT b.productId, b.warehouseId, SUM(b.onHand - b.reserved) AS available FROM stock_balances b
         LEFT JOIN stock_locations l ON l.id = b.locationId AND l.warehouseId = b.warehouseId
         WHERE b.warehouseId IN (${warehouses.map(() => '?').join(', ')})
           AND (b.locationId = '' OR (l.isActive = 1 AND l.purpose = 'SALEABLE'))
         GROUP BY b.productId, b.warehouseId`,
        warehouses
      ) : [];
      const availByProduct = new Map<string, number>();
      for (const row of avail) {
        availByProduct.set(row.productId, (availByProduct.get(row.productId) ?? 0) + Math.max(0, Number(row.available) || 0));
      }
      res.json(bundles.map((b: any) => {
        const parts = items.filter((i: any) => i.bundleId === b.id).map((i: any) => {
          const per = Math.max(0, Number(i.qtyPerBundle) || 0);
          const have = availByProduct.get(i.productId) ?? 0;
          return { ...i, available: have, buildable: per > 0 ? Math.floor(have / per) : 0 };
        });
        const buildable = parts.length > 0 ? Math.min(...parts.map((p: any) => p.buildable)) : 0;
        const limiting = parts.find((p: any) => p.buildable === buildable)?.productId ?? null;
        return { ...b, isActive: Boolean(b.isActive), items: parts, buildable, limitingProductId: limiting };
      }));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch bundles' }); }
  });

  const BundleSchema = z.object({
    name: z.string().trim().min(1).max(255),
    code: z.string().trim().max(100).nullable().optional(),
    bundleType: z.enum(['VIRTUAL_BUNDLE', 'STOCKED_KIT']).optional(),
    kitProductId: z.string().trim().max(191).nullable().optional(),
    description: z.string().max(5000).nullable().optional(),
    items: z.array(z.object({
      productId: z.string().trim().min(1).max(191),
      qtyPerBundle: z.number().finite().positive().max(1_000_000),
    })).min(1).max(200),
  });

  async function writeBundle(id: string | null, body: any, user: any) {
    const { name, code, bundleType, kitProductId, description, items } = body;
    if (new Set(items.map((item: any) => item.productId)).size !== items.length || items.some((item: any) => item.productId === kitProductId)) {
      throw Object.assign(new Error('Components must be distinct and cannot contain the kit itself'), { status: 400 });
    }
    for (const item of items) {
      const product = await db.get('SELECT id FROM products WHERE id = ?', [item.productId]);
      if (!product) throw Object.assign(new Error(`Unknown product: ${item.productId}`), { status: 400 });
    }
    if (kitProductId) {
      const kit = await db.get('SELECT id FROM products WHERE id = ?', [kitProductId]);
      if (!kit) throw Object.assign(new Error(`Unknown kit product: ${kitProductId}`), { status: 400 });
    }
    const now = new Date().toISOString();
    await db.run('START TRANSACTION');
    try {
      let bundleId = id;
      if (!bundleId) {
        bundleId = randomUUID();
        await db.run(
          'INSERT INTO product_bundles (id, name, code, bundleType, kitProductId, description, isActive, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
          [bundleId, name.trim(), code?.trim() || null, bundleType || 'VIRTUAL_BUNDLE', kitProductId || null, description ?? null, user.id, now]
        );
      } else {
        await db.run(
          'UPDATE product_bundles SET name = ?, code = ?, bundleType = ?, kitProductId = ?, description = ? WHERE id = ?',
          [name.trim(), code?.trim() || null, bundleType || 'VIRTUAL_BUNDLE', kitProductId || null, description ?? null, bundleId]
        );
        await db.run('DELETE FROM product_bundle_items WHERE bundleId = ?', [bundleId]);
      }
      for (const item of items) {
        await db.run('INSERT INTO product_bundle_items (bundleId, productId, qtyPerBundle) VALUES (?, ?, ?)', [bundleId, item.productId, item.qtyPerBundle]);
      }
      await db.run('COMMIT');
      return bundleId;
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }
  }

  function requireBundleManager(user: any) {
    const level = normalizeManagementLevel(user?.managementLevel);
    return level >= MANAGEMENT_LEVELS.MANAGER && level !== MANAGEMENT_LEVELS.ADMIN;
  }

  router.post('/bundles', validate(BundleSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireBundleManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage bundles' });
      try {
        res.status(201).json({ id: await writeBundle(null, req.body, user) });
      } catch (e: any) {
        if (e.status === 400) return res.status(400).json({ error: e.message });
        if (e.message?.includes('Duplicate')) return res.status(409).json({ error: 'Bundle code already exists' });
        throw e;
      }
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to create bundle' }); }
  });

  router.put('/bundles/:id', validate(BundleSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireBundleManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage bundles' });
      const existing = await db.get('SELECT * FROM product_bundles WHERE id = ?', [String(req.params.id)]);
      if (!existing) return res.status(404).json({ error: 'Bundle not found' });
      try {
        await writeBundle(existing.id, { ...req.body, kitProductId: req.body.kitProductId ?? existing.kitProductId }, user);
      } catch (e: any) {
        if (e.status === 400) return res.status(400).json({ error: e.message });
        if (e.message?.includes('Duplicate')) return res.status(409).json({ error: 'Bundle code already exists' });
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to update bundle' }); }
  });

  // Lắp/rã STOCKED_KIT (§23): trừ linh kiện + cộng bộ (lắp), ngược lại khi rã.
  // TP+ trong scope kho, toàn bộ trong 1 transaction.
  async function settleKit(req: any, res: any, direction: 1 | -1) {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      await beginStockTransaction(db);
      transactionOpen = true;
      if (!requireBundleManager(user)) return res.status(403).json({ error: 'Only warehouse managers can assemble kits' });
      const { warehouseId, quantity } = req.body ?? {};
      const qty = Number(quantity);
      if (!warehouseId || !(qty > 0)) return res.status(400).json({ error: 'warehouseId and positive quantity are required' });
      const bundle = await db.get('SELECT * FROM product_bundles WHERE id = ?', [String(req.params.id)]);
      if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
      if (bundle.bundleType !== 'STOCKED_KIT') {
        return res.status(400).json({ error: 'Only STOCKED_KIT bundles can be assembled' });
      }
      if (!bundle.kitProductId) {
        return res.status(400).json({ error: 'Bundle has no linked kit product yet' });
      }
      const access = await requireWarehouse(user, warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const items = await db.all('SELECT productId, qtyPerBundle FROM product_bundle_items WHERE bundleId = ?', [bundle.id]);
      if (items.length === 0) return res.status(400).json({ error: 'Bundle has no components' });
      const now = new Date().toISOString();
      if (direction === 1) {
        for (const item of items) {
          const available = await availableOf(item.productId, warehouseId, '');
          if (available < Number(item.qtyPerBundle) * qty) {
            return res.status(400).json({ error: `Insufficient stock for component: ${item.productId}` });
          }
        }
      } else {
        const kit = await db.get(
          'SELECT onHand, reserved FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ?',
          [bundle.kitProductId, warehouseId, '']
        );
        if (Number(kit?.onHand ?? 0) - Number(kit?.reserved ?? 0) < qty) {
          return res.status(400).json({ error: 'Insufficient assembled kits to disassemble' });
        }
      }
      try {
        for (const item of items) {
          const delta = direction * Number(item.qtyPerBundle) * qty;
          await postMove(db.run.bind(db), {
            productId: item.productId, warehouseId, locationId: '',
            quantity: -delta, moveType: direction === 1 ? 'KIT_OUT' : 'KIT_IN',
            referenceType: 'KIT', referenceId: bundle.id,
            documentLineId: null, createdBy: user.id,
          });
        }
        await postMove(db.run.bind(db), {
          productId: bundle.kitProductId, warehouseId, locationId: '',
          quantity: direction * qty, moveType: direction === 1 ? 'KIT_IN' : 'KIT_OUT',
          referenceType: 'KIT', referenceId: bundle.id,
          documentLineId: null, createdBy: user.id,
        });
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to settle kit' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  }

  router.post('/bundles/:id/assemble', async (req, res) => { await settleKit(req, res, 1); });
  router.post('/bundles/:id/disassemble', async (req, res) => { await settleKit(req, res, -1); });

  // ── Lịch sử hàng hóa: timeline moves (§30.5, đọc) ─────────────────────────────

  router.get('/moves', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot view business stock data' });
      }
      const scope = await scopeOf(user);
      const { warehouseId, productId, moveType } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT m.*, p.name AS productName, w.name AS warehouseName, u.name AS createdByName
        FROM stock_moves m
        LEFT JOIN products p ON p.id = m.productId
        LEFT JOIN warehouses w ON w.id = m.warehouseId
        LEFT JOIN users u ON u.id = m.createdBy
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND m.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND m.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      if (productId?.trim()) { query += ' AND m.productId = ?'; params.push(productId.trim()); }
      if (moveType?.trim()) { query += ' AND m.moveType = ?'; params.push(moveType.trim()); }
      query += ' ORDER BY m.createdAt DESC LIMIT 500';
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock moves' }); }
  });

  router.get('/policies', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot view business stock data' });
      }
      const scope = await scopeOf(user);
      const { warehouseId } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT pol.*, p.name AS productName, w.name AS warehouseName
        FROM product_warehouse_policies pol
        LEFT JOIN products p ON p.id = pol.productId
        LEFT JOIN warehouses w ON w.id = pol.warehouseId
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND pol.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND pol.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      query += ' ORDER BY w.name ASC, p.name ASC';
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock policies' }); }
  });

  // ── Kiểm kê blind-count (§19–20) ────────────────────────────────────────────

  function requireCountManager(user: any) {
    const level = normalizeManagementLevel(user?.managementLevel);
    return level >= MANAGEMENT_LEVELS.MANAGER && level !== MANAGEMENT_LEVELS.ADMIN;
  }

  router.get('/counts', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot view business stock data' });
      }
      const scope = await scopeOf(user);
      const { warehouseId, status } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT c.*, w.name AS warehouseName FROM stock_counts c
        LEFT JOIN warehouses w ON w.id = c.warehouseId WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND c.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND c.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      if (status?.trim()) { query += ' AND c.status = ?'; params.push(status.trim()); }
      query += ' ORDER BY c.createdAt DESC';
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock counts' }); }
  });

  router.get('/counts/:id', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const count = await db.get('SELECT * FROM stock_counts WHERE id = ?', [String(req.params.id)]);
      if (!count) return res.status(404).json({ error: 'Count not found' });
      const access = await requireWarehouse(user, count.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const lines = await db.all(
        `SELECT l.*, p.name AS productName FROM stock_count_lines l
         LEFT JOIN products p ON p.id = l.productId WHERE l.countId = ? ORDER BY p.name ASC`,
        [count.id]
      );
      // Blind count: NV không thấy số hệ thống (§19.1).
      const blind = Number(count.blindCount) === 1 && !requireCountManager(user);
      res.json({
        ...count,
        blindCount: Boolean(Number(count.blindCount)),
        lines: lines.map((l: any) => blind ? { ...l, expectedQty: null } : l),
      });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock count' }); }
  });

  router.post('/counts', validate(z.object({
    warehouseId: z.string().trim().min(1).max(191),
    blindCount: z.boolean().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })), async (req, res) => {
    let transactionOpen = false;
    try {
      await beginStockTransaction(db);
      transactionOpen = true;
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireCountManager(user)) return res.status(403).json({ error: 'Only warehouse managers can open counts' });
      const { warehouseId, blindCount, notes } = req.body;
      const access = await requireWarehouse(user, warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      await assertNotCounting(warehouseId);
      const snapshot = await db.all(
        'SELECT productId, locationId, onHand FROM stock_balances WHERE warehouseId = ?',
        [warehouseId]
      );
      const now = new Date().toISOString();
      const id = randomUUID();
      const d = new Date();
      const code = `KK-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      try {
        await db.run(
          'INSERT INTO stock_counts (id, code, warehouseId, status, blindCount, notes, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, code, warehouseId, 'COUNTING', blindCount === false ? 0 : 1, notes ?? null, user.id, now, now]
        );
        for (const row of snapshot) {
          await db.run(
            'INSERT INTO stock_count_lines (id, countId, productId, locationId, expectedQty) VALUES (?, ?, ?, ?, ?)',
            [randomUUID(), id, row.productId, row.locationId || '', Number(row.onHand) || 0]
          );
        }
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.status(201).json({ id, code, lines: snapshot.length });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to open stock count' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/counts/:id/lines', validate(z.object({
    lines: z.array(z.object({
      productId: z.string().trim().min(1).max(191),
      locationId: z.string().trim().max(191).nullable().optional(),
      actualQty: z.number().finite().min(0).max(1_000_000_000),
      note: z.string().max(2000).nullable().optional(),
    })).min(1).max(1000),
  })), async (req, res) => {
    let transactionOpen = false;
    try {
      await beginStockTransaction(db);
      transactionOpen = true;
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const count = await db.get('SELECT warehouseId, status FROM stock_counts WHERE id = ?', [String(req.params.id)]);
      if (!count) return res.status(404).json({ error: 'Count not found' });
      if (count.status !== 'COUNTING') return res.status(400).json({ error: 'Count is no longer open for entry' });
      const access = await requireWarehouse(user, count.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      try {
        for (const line of req.body.lines) {
          if (!(await db.get('SELECT id FROM products WHERE id = ?', [line.productId])) || !(await assertLocation(count.warehouseId, line.locationId))) {
            return res.status(400).json({ error: 'Invalid product or location for count' });
          }
          await db.run(
            `INSERT INTO stock_count_lines (id, countId, productId, locationId, expectedQty, actualQty, note)
             VALUES (?, ?, ?, ?, 0, ?, ?)
             ON DUPLICATE KEY UPDATE actualQty = VALUES(actualQty), note = VALUES(note)`,
            [randomUUID(), count.id ?? String(req.params.id), line.productId, line.locationId || '', Number(line.actualQty), line.note ?? null]
          );
        }
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to submit count lines' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/counts/:id/recount', validate(z.object({
    lineIds: z.array(z.string().trim().min(1).max(191)).min(1).max(1000),
  })), async (req, res) => {
    let transactionOpen = false;
    try {
      await beginStockTransaction(db);
      transactionOpen = true;
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireCountManager(user)) return res.status(403).json({ error: 'Only warehouse managers can request recounts' });
      const count = await db.get('SELECT warehouseId, status FROM stock_counts WHERE id = ?', [String(req.params.id)]);
      if (!count) return res.status(404).json({ error: 'Count not found' });
      if (count.status !== 'COUNTING') return res.status(400).json({ error: 'Count is no longer open' });
      const access = await requireWarehouse(user, count.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const placeholders = req.body.lineIds.map(() => '?').join(', ');
      await db.run(
        `UPDATE stock_count_lines SET actualQty = NULL, note = NULL WHERE countId = ? AND id IN (${placeholders})`,
        [String(req.params.id), ...req.body.lineIds]
      );
      await db.run('COMMIT'); transactionOpen = false;
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to request recount' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/counts/:id/approve', async (req, res) => {
    let transactionOpen = false;
    try {
      await beginStockTransaction(db);
      transactionOpen = true;
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireCountManager(user)) return res.status(403).json({ error: 'Only warehouse managers can approve counts' });
      const count = await db.get('SELECT * FROM stock_counts WHERE id = ?', [String(req.params.id)]);
      if (!count) return res.status(404).json({ error: 'Count not found' });
      if (count.status !== 'COUNTING') return res.status(400).json({ error: 'Count is already closed' });
      const access = await requireWarehouse(user, count.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const lines = await db.all('SELECT * FROM stock_count_lines WHERE countId = ?', [count.id]);
      const missing = lines.filter((l: any) => l.actualQty === null || l.actualQty === undefined).length;
      if (missing > 0) {
        return res.status(400).json({ error: `${missing} lines still await counting` });
      }
      const now = new Date().toISOString();
      try {
        for (const line of lines) {
          const balance = await db.get('SELECT onHand, reserved FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ?', [line.productId, count.warehouseId, line.locationId || '']);
          if (Number(balance?.onHand ?? 0) !== Number(line.expectedQty)) throw Object.assign(new Error('Tồn đã thay đổi sau khi mở kiểm kê; cần kiểm kê lại.'), { status: 409 });
          if (Number(line.actualQty) < Number(balance?.reserved ?? 0)) throw Object.assign(new Error('Giải phóng giữ hàng vượt số đếm trước khi duyệt.'), { status: 409 });
          const variance = Number(line.actualQty) - Number(line.expectedQty);
          if (variance === 0) continue;
          await db.run(
            `INSERT INTO stock_moves (id, productId, warehouseId, locationId, quantity, moveType, referenceType, referenceId, documentLineId, createdBy, createdAt)
             VALUES (?, ?, ?, ?, ?, 'ADJUSTMENT', 'COUNT', ?, ?, ?, ?)`,
            [randomUUID(), line.productId, count.warehouseId, line.locationId || '', variance, count.id, line.id, user.id, now]
          );
          await db.run(
            `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
             VALUES (?, ?, ?, ?, 0, ?)
             ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)`,
            [line.productId, count.warehouseId, line.locationId || '', variance, now]
          );
        }
        await db.run('UPDATE stock_counts SET status = ?, approvedBy = ?, updatedAt = ? WHERE id = ?', ['DONE', user.id, now, count.id]);
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to approve count' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/counts/:id/cancel', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!requireCountManager(req.user)) return res.status(403).json({ error: 'Warehouse manager access required' });
    let transactionOpen = false;
    try {
      await beginStockTransaction(db); transactionOpen = true;
      const count = await db.get('SELECT * FROM stock_counts WHERE id = ?', [String(req.params.id)]);
      if (!count) return res.status(404).json({ error: 'Count not found' });
      if (!(await requireWarehouse(req.user, count.warehouseId)).ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (count.status !== 'COUNTING') return res.status(400).json({ error: 'Only open counts can be cancelled' });
      await db.run('UPDATE stock_counts SET status = ?, updatedAt = ? WHERE id = ?', ['CANCELLED', new Date().toISOString(), count.id]);
      await db.run('COMMIT'); transactionOpen = false;
      res.json({ success: true });
    } catch { res.status(500).json({ error: 'Failed to cancel count' }); }
    finally { if (transactionOpen) await db.run('ROLLBACK'); }
  });

  // ── MISA: mapping + nhật ký (§35 — quản trị chủ động, sync thật để sau) ──────

  function requireMisaManager(user: any) {
    const level = normalizeManagementLevel(user?.managementLevel);
    return level >= MANAGEMENT_LEVELS.MANAGER && level !== MANAGEMENT_LEVELS.ADMIN;
  }

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
    entityType: z.string().trim().min(1).max(64),
    entityId: z.string().trim().min(1).max(191),
    misaCode: z.string().trim().min(1).max(191),
    misaName: z.string().trim().max(255).nullable().optional(),
  });

  router.post('/misa-mappings', validate(MisaMappingSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireMisaManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage MISA mappings' });
      const { entityType, entityId, misaCode, misaName } = req.body;
      const now = new Date().toISOString();
      try {
        await db.run(
          'INSERT INTO misa_mappings (id, entityType, entityId, misaCode, misaName, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [randomUUID(), entityType, entityId, misaCode.trim(), misaName?.trim() || null, user.id, now]
        );
      } catch (e: any) {
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
      if (!requireMisaManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage MISA mappings' });
      await db.run('DELETE FROM misa_mappings WHERE id = ?', [String(req.params.id)]);
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to delete MISA mapping' }); }
  });

  router.get('/misa-logs', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Warehouse manager access required' });
      const { status, entityType } = req.query as Record<string, string | undefined>;
      let query = 'SELECT * FROM misa_sync_logs WHERE 1=1';
      const params: any[] = [];
      if (status?.trim()) { query += ' AND status = ?'; params.push(status.trim()); }
      if (entityType?.trim()) { query += ' AND entityType = ?'; params.push(entityType.trim()); }
      query += ' ORDER BY createdAt DESC LIMIT 200';
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch MISA sync logs' }); }
  });

  return router;
}
