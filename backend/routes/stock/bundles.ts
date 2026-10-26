import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import type { StockContext } from './context.js';

export function bundlesRoutes(ctx: StockContext) {
  const { db, listScope, isDirector, requireWarehouse, requireWarehouseManager, postMove } = ctx;
  const router = Router();
  // ── Combo / bộ sản phẩm (§23: buildable từ available) ─────────────────────────

  router.get('/bundles', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
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

  router.post('/bundles', validate(BundleSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage bundles' });
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
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage bundles' });
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
    if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can assemble kits' });
    const { warehouseId, quantity } = req.body ?? {};
    const qty = Number(quantity);
    if (!warehouseId || !(qty > 0)) return res.status(400).json({ error: 'warehouseId and positive quantity are required' });
    let transactionOpen = false;
    try {
      await beginStockTransaction(db, [warehouseId]);
      transactionOpen = true;
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
      const componentPostings = new Map<string, { locationId: string; quantity: number }[]>();
      if (direction === 1) {
        for (const item of items) {
          const required = Number(item.qtyPerBundle) * qty;
          const balances = await db.all(
            `SELECT b.locationId, b.onHand, b.reserved
             FROM stock_balances b
             LEFT JOIN stock_locations l ON l.id = b.locationId AND l.warehouseId = b.warehouseId
             WHERE b.productId = ? AND b.warehouseId = ?
               AND (b.locationId = '' OR (l.isActive = 1 AND l.purpose = 'SALEABLE'))
               AND b.onHand > b.reserved
             ORDER BY CASE WHEN b.locationId = '' THEN 0 ELSE 1 END, b.locationId
             FOR UPDATE`,
            [item.productId, warehouseId]
          );
          let remaining = required;
          const postings: { locationId: string; quantity: number }[] = [];
          for (const balance of balances || []) {
            const available = Math.max(0, Number(balance.onHand || 0) - Number(balance.reserved || 0));
            const consumed = Math.min(available, remaining);
            if (consumed > 0) postings.push({ locationId: balance.locationId || '', quantity: consumed });
            remaining -= consumed;
            if (remaining <= 0) break;
          }
          if (remaining > 0) {
            return res.status(400).json({ error: `Insufficient stock for component: ${item.productId}` });
          }
          componentPostings.set(item.productId, postings);
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
          const postings = direction === 1
            ? componentPostings.get(item.productId) || []
            : [{ locationId: '', quantity: Number(item.qtyPerBundle) * qty }];
          for (const posting of postings) {
            await postMove(db.run.bind(db), {
              productId: item.productId, warehouseId, locationId: posting.locationId,
              quantity: direction === 1 ? -posting.quantity : posting.quantity,
              moveType: direction === 1 ? 'KIT_OUT' : 'KIT_IN',
              referenceType: 'KIT', referenceId: bundle.id,
              documentLineId: null, createdBy: user.id,
            });
          }
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
  return router;
}
