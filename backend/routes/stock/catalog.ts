import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import type { StockContext } from './context.js';

export function catalogRoutes(ctx: StockContext) {
  const { db, scopeOf, isDirector, requireWarehouse, requireWarehouseManager, docWarehouseIds, canReadDocument, canWriteDocument, assertLocation, isSaleableLocation, availableOf, saleableLocationSet, saleableAvailableOf, assertNotCounting, postMove, docCode, paginationOf } = ctx;
  const router = Router();
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
          const available = await saleableAvailableOf(item.productId, warehouseId);
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
      query += ' ORDER BY m.createdAt DESC';
      const movePage = paginationOf(req.query as Record<string, string | undefined>);
      query += ' LIMIT ? OFFSET ?';
      params.push(movePage.limit, movePage.offset);
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
        LEFT JOIN stock_moves m ON m.productId = b.productId AND m.warehouseId = b.warehouseId AND m.createdAt >= ?
        WHERE 1=1`;
      const params: any[] = [cutoff];
      if (warehouseId) { query += ' AND b.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND b.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      query += ` GROUP BY b.productId, b.warehouseId, p.name, w.code, w.name
        HAVING onHand > 0 AND (lastMoveAt IS NULL OR lastMoveAt < ?)
        ORDER BY lastMoveAt ASC LIMIT 500`;
      params.push(cutoff);
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch slow-moving stock' }); }
  });
  return router;
}
