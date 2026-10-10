import { Router } from 'express';
import { randomUUID } from 'crypto';
import { canManageWarehouse } from '../middleware/warehouseAuth.js';

// Product bundles (C1, spec §23).
// VIRTUAL_BUNDLE: config only; buildable = MIN(FLOOR(available / qty_per_bundle)).
// STOCKED_KIT: assemble/disassemble emits real stock moves (kit SKU stocked).

function canManageBundles(req: any): boolean {
  return canManageWarehouse(req, 'stock.manage');
}

const VALID_MODES = ['VIRTUAL_BUNDLE', 'STOCKED_KIT'];

// Available per product (+ optional warehouse), shared helper
async function availableMap(db: any, warehouseId?: string): Promise<Map<string, number>> {
  const rows: any = await db.all(
    `SELECT productId, COALESCE(SUM(onHand - reserved), 0) AS available
     FROM stock_balances
     ${warehouseId ? 'WHERE warehouseId = ?' : ''}
     GROUP BY productId`,
    warehouseId ? [warehouseId] : []
  );
  return new Map(rows.map((r: any) => [r.productId, Number(r.available)]));
}

async function buildableFor(db: any, bundleId: string, warehouseId?: string): Promise<{
  buildable: number; limiting: { productId: string; productCode: string; sets: number } | null;
  items: any[];
}> {
  const items: any = await db.all(
    'SELECT * FROM bundle_items WHERE bundleId = ? ORDER BY productCode ASC',
    [bundleId]
  );
  if (items.length === 0) return { buildable: 0, limiting: null, items };
  const stock = await availableMap(db, warehouseId);
  let buildable = Infinity;
  let limiting: { productId: string; productCode: string; sets: number } | null = null;
  for (const it of items) {
    const sets = Math.floor((stock.get(it.productId) || 0) / Math.max(Number(it.quantity) || 1, 0.000001));
    if (sets < buildable) {
      buildable = sets;
      limiting = { productId: it.productId, productCode: it.productCode, sets };
    }
  }
  return { buildable: buildable === Infinity ? 0 : buildable, limiting, items };
}

export function warehouseBundlesRoutes(db: any) {
  const router = Router();

  // ============================================================
  // GET /api/warehouse/bundles?warehouseId= - list with buildable qty
  // ============================================================
  router.get('/bundles', async (req, res) => {
    try {
      const level = req.user?.managementLevel ?? 10;
      if (level === 99) return res.json([]);
      const warehouseId = String(req.query.warehouseId || '') || undefined;
      const rows: any = await db.all(
        `SELECT b.*, p.code AS kitCode, p.name AS kitName,
                (SELECT COUNT(*) FROM bundle_items i WHERE i.bundleId = b.id) AS componentCount
         FROM bundles b
         LEFT JOIN stock_products p ON b.kitProductId = p.id
         ORDER BY b.code ASC`
      );
      const out = [];
      for (const b of rows) {
        const calc = await buildableFor(db, b.id, warehouseId);
        out.push({
          ...b,
          componentCount: Number(b.componentCount),
          items: calc.items.map((i: any) => ({ ...i, quantity: Number(i.quantity) })),
          buildable: calc.buildable,
          limiting: calc.limiting,
        });
      }
      res.json(out);
    } catch (error) {
      console.error('Error fetching bundles:', error);
      res.status(500).json({ error: 'Failed to fetch bundles' });
    }
  });

  // GET /api/warehouse/bundles/:id - detail
  router.get('/bundles/:id', async (req, res) => {
    try {
      const level = req.user?.managementLevel ?? 10;
      if (level === 99) return res.status(403).json({ error: 'Forbidden' });
      const bundle = await db.get('SELECT * FROM bundles WHERE id = ?', [req.params.id]);
      if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
      const warehouseId = String(req.query.warehouseId || '') || undefined;
      const calc = await buildableFor(db, bundle.id, warehouseId);
      res.json({
        ...bundle,
        items: calc.items.map((i: any) => ({ ...i, quantity: Number(i.quantity) })),
        buildable: calc.buildable,
        limiting: calc.limiting,
      });
    } catch (error) {
      console.error('Error fetching bundle:', error);
      res.status(500).json({ error: 'Failed to fetch bundle' });
    }
  });

  // POST /api/warehouse/bundles - TP creates bundle with components
  router.post('/bundles', async (req, res) => {
    try {
      if (!canManageBundles(req)) return res.status(403).json({ error: 'Forbidden' });
      const { code, name, unit = 'set', mode = 'VIRTUAL_BUNDLE', kitProductId, notes, items = [] } = req.body;
      if (!code || !String(code).trim() || !name || !String(name).trim()) {
        return res.status(400).json({ error: 'code and name are required' });
      }
      if (!VALID_MODES.includes(mode)) {
        return res.status(400).json({ error: `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}` });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'at least one component is required' });
      }
      for (const it of items) {
        const prod = await db.get('SELECT id FROM stock_products WHERE id = ?', [it.productId]);
        if (!prod) return res.status(400).json({ error: `Product not found: ${it.productId}` });
        if (it.quantity === undefined || Number.isNaN(Number(it.quantity)) || Number(it.quantity) <= 0) {
          return res.status(400).json({ error: 'each component needs quantity > 0' });
        }
      }
      if (mode === 'STOCKED_KIT') {
        if (!kitProductId) return res.status(400).json({ error: 'kitProductId is required for STOCKED_KIT' });
        const kit = await db.get('SELECT id FROM stock_products WHERE id = ?', [kitProductId]);
        if (!kit) return res.status(400).json({ error: 'Kit product not found' });
      }
      const cleanCode = String(code).trim();
      const existing = await db.get('SELECT id FROM bundles WHERE code = ?', [cleanCode]);
      if (existing) return res.status(400).json({ error: `Mã combo '${cleanCode}' đã tồn tại` });
      const id = randomUUID();
      await db.run(
        `INSERT INTO bundles (id, code, name, unit, mode, kitProductId, notes, createdBy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, cleanCode, String(name).trim(), unit || 'set', mode,
         mode === 'STOCKED_KIT' ? kitProductId : null, notes || null, (req as any).user?.id || null]
      );
      for (const it of items) {
        const prod: any = await db.get('SELECT code, name FROM stock_products WHERE id = ?', [it.productId]);
        await db.run(
          `INSERT INTO bundle_items (id, bundleId, productId, productCode, productName, quantity, unit)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), id, it.productId, prod.code, prod.name, Number(it.quantity), it.unit || 'pcs']
        );
      }
      res.json({ id, code: cleanCode, success: true });
    } catch (error) {
      console.error('Error creating bundle:', error);
      res.status(500).json({ error: 'Failed to create bundle' });
    }
  });

  // PATCH /api/warehouse/bundles/:id - TP edits header/mode/kit
  router.patch('/bundles/:id', async (req, res) => {
    try {
      if (!canManageBundles(req)) return res.status(403).json({ error: 'Forbidden' });
      const bundle = await db.get('SELECT * FROM bundles WHERE id = ?', [req.params.id]);
      if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
      const { name, unit, mode, kitProductId, notes, isActive } = req.body;
      if (mode !== undefined && !VALID_MODES.includes(mode)) {
        return res.status(400).json({ error: `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}` });
      }
      const nextMode = mode !== undefined ? mode : bundle.mode;
      let nextKit = kitProductId !== undefined ? kitProductId : bundle.kitProductId;
      if (nextMode === 'STOCKED_KIT') {
        if (!nextKit) return res.status(400).json({ error: 'kitProductId is required for STOCKED_KIT' });
        const kit = await db.get('SELECT id FROM stock_products WHERE id = ?', [nextKit]);
        if (!kit) return res.status(400).json({ error: 'Kit product not found' });
      } else {
        nextKit = null;
      }
      await db.run(
        `UPDATE bundles SET name = ?, unit = ?, mode = ?, kitProductId = ?, notes = ?,
                isActive = ?, updatedAt = ? WHERE id = ?`,
        [
          name !== undefined ? String(name).trim() : bundle.name,
          unit !== undefined ? unit : bundle.unit,
          nextMode, nextKit,
          notes !== undefined ? notes : bundle.notes,
          isActive !== undefined ? (isActive ? 1 : 0) : bundle.isActive,
          new Date().toISOString(), bundle.id,
        ]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating bundle:', error);
      res.status(500).json({ error: 'Failed to update bundle' });
    }
  });

  // POST /api/warehouse/bundles/:id/items - TP adds a component
  router.post('/bundles/:id/items', async (req, res) => {
    try {
      if (!canManageBundles(req)) return res.status(403).json({ error: 'Forbidden' });
      const bundle = await db.get('SELECT * FROM bundles WHERE id = ?', [req.params.id]);
      if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
      const { productId, quantity, unit } = req.body;
      const prod: any = await db.get('SELECT code, name FROM stock_products WHERE id = ?', [productId]);
      if (!prod) return res.status(400).json({ error: 'Product not found' });
      if (quantity === undefined || Number.isNaN(Number(quantity)) || Number(quantity) <= 0) {
        return res.status(400).json({ error: 'quantity > 0 is required' });
      }
      const dup = await db.get('SELECT id FROM bundle_items WHERE bundleId = ? AND productId = ?', [bundle.id, productId]);
      if (dup) return res.status(400).json({ error: 'Product already in bundle' });
      const id = randomUUID();
      await db.run(
        `INSERT INTO bundle_items (id, bundleId, productId, productCode, productName, quantity, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, bundle.id, productId, prod.code, prod.name, Number(quantity), unit || 'pcs']
      );
      res.json({ id, success: true });
    } catch (error) {
      console.error('Error adding bundle item:', error);
      res.status(500).json({ error: 'Failed to add bundle item' });
    }
  });

  // DELETE /api/warehouse/bundles/:bundleId/items/:itemId - TP removes a component
  router.delete('/bundles/:bundleId/items/:itemId', async (req, res) => {
    try {
      if (!canManageBundles(req)) return res.status(403).json({ error: 'Forbidden' });
      const item = await db.get('SELECT * FROM bundle_items WHERE id = ? AND bundleId = ?', [req.params.itemId, req.params.bundleId]);
      if (!item) return res.status(404).json({ error: 'Bundle item not found' });
      const remaining: any = await db.get('SELECT COUNT(*) AS c FROM bundle_items WHERE bundleId = ?', [req.params.bundleId]);
      if (Number(remaining?.c || 0) <= 1) {
        return res.status(400).json({ error: 'Bundle must keep at least one component' });
      }
      await db.run('DELETE FROM bundle_items WHERE id = ?', [item.id]);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting bundle item:', error);
      res.status(500).json({ error: 'Failed to delete bundle item' });
    }
  });

  // DELETE /api/warehouse/bundles/:id - TP deletes bundle (config only, stock untouched)
  router.delete('/bundles/:id', async (req, res) => {
    try {
      if (!canManageBundles(req)) return res.status(403).json({ error: 'Forbidden' });
      const bundle = await db.get('SELECT * FROM bundles WHERE id = ?', [req.params.id]);
      if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
      await db.run('DELETE FROM bundles WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting bundle:', error);
      res.status(500).json({ error: 'Failed to delete bundle' });
    }
  });

  // POST /api/warehouse/bundles/:id/assemble - STOCKED_KIT: consume parts, stock kits
  router.post('/bundles/:id/assemble', async (req, res) => {
    try {
      if (!canManageBundles(req)) return res.status(403).json({ error: 'Forbidden' });
      const bundle = await db.get('SELECT * FROM bundles WHERE id = ?', [req.params.id]);
      if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
      if (bundle.mode !== 'STOCKED_KIT') {
        return res.status(400).json({ error: 'Only STOCKED_KIT bundles can be assembled' });
      }
      const { qty, warehouseId, locationId } = req.body;
      if (qty === undefined || Number.isNaN(Number(qty)) || Number(qty) <= 0 || !Number.isInteger(Number(qty))) {
        return res.status(400).json({ error: 'qty must be a positive integer' });
      }
      if (!warehouseId) return res.status(400).json({ error: 'warehouseId is required' });
      const warehouse = await db.get('SELECT id FROM warehouses WHERE id = ?', [warehouseId]);
      if (!warehouse) return res.status(400).json({ error: 'Warehouse not found' });
      if (locationId) {
        const loc = await db.get('SELECT id, warehouseId FROM warehouse_locations WHERE id = ?', [locationId]);
        if (!loc) return res.status(400).json({ error: 'Location not found' });
        if (loc.warehouseId !== warehouseId) {
          return res.status(400).json({ error: 'Location must belong to the warehouse' });
        }
      }
      const items: any = await db.all('SELECT * FROM bundle_items WHERE bundleId = ?', [bundle.id]);
      if (items.length === 0) return res.status(400).json({ error: 'Bundle has no components' });
      const stock = await availableMap(db, warehouseId);
      for (const it of items) {
        const need = Number(it.quantity) * Number(qty);
        if ((stock.get(it.productId) || 0) < need) {
          return res.status(400).json({ error: `Insufficient ${it.productCode}: need ${need}` });
        }
      }
      const now = new Date().toISOString();
      const userId = (req as any).user?.id || null;
      const locKey = locationId || '';
      await db.run('START TRANSACTION');
      try {
        for (const it of items) {
          const need = Number(it.quantity) * Number(qty);
          await db.run(
            `INSERT INTO stock_moves
             (id, productId, productCode, warehouseId, locationId, qty, moveType, createdBy, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, 'ASSEMBLE', ?, ?)`,
            [randomUUID(), it.productId, it.productCode, warehouseId, locationId || null, -need, userId, now]
          );
          await db.run(
            `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
             VALUES (?, ?, ?, ?, 0, ?)
             ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)`,
            [it.productId, warehouseId, locKey, -need, now]
          );
        }
        const kit: any = await db.get('SELECT code FROM stock_products WHERE id = ?', [bundle.kitProductId]);
        await db.run(
          `INSERT INTO stock_moves
           (id, productId, productCode, warehouseId, locationId, qty, moveType, createdBy, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, 'ASSEMBLE', ?, ?)`,
          [randomUUID(), bundle.kitProductId, kit.code, warehouseId, locationId || null, Number(qty), userId, now]
        );
        await db.run(
          `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
           VALUES (?, ?, ?, ?, 0, ?)
           ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)`,
          [bundle.kitProductId, warehouseId, locKey, Number(qty), now]
        );
        await db.run('COMMIT');
      } catch (txError) {
        await db.run('ROLLBACK');
        throw txError;
      }
      res.json({ success: true, assembled: Number(qty) });
    } catch (error) {
      console.error('Error assembling bundle:', error);
      res.status(500).json({ error: 'Failed to assemble bundle' });
    }
  });

  // POST /api/warehouse/bundles/:id/disassemble - STOCKED_KIT: break kits back to parts
  router.post('/bundles/:id/disassemble', async (req, res) => {
    try {
      if (!canManageBundles(req)) return res.status(403).json({ error: 'Forbidden' });
      const bundle = await db.get('SELECT * FROM bundles WHERE id = ?', [req.params.id]);
      if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
      if (bundle.mode !== 'STOCKED_KIT') {
        return res.status(400).json({ error: 'Only STOCKED_KIT bundles can be disassembled' });
      }
      const { qty, warehouseId, locationId } = req.body;
      if (qty === undefined || Number.isNaN(Number(qty)) || Number(qty) <= 0 || !Number.isInteger(Number(qty))) {
        return res.status(400).json({ error: 'qty must be a positive integer' });
      }
      if (!warehouseId) return res.status(400).json({ error: 'warehouseId is required' });
      const stock = await availableMap(db, warehouseId);
      if ((stock.get(bundle.kitProductId) || 0) < Number(qty)) {
        return res.status(400).json({ error: 'Not enough kits in stock to disassemble' });
      }
      const items: any = await db.all('SELECT * FROM bundle_items WHERE bundleId = ?', [bundle.id]);
      if (items.length === 0) return res.status(400).json({ error: 'Bundle has no components' });
      const now = new Date().toISOString();
      const userId = (req as any).user?.id || null;
      const locKey = locationId || '';
      const kit: any = await db.get('SELECT code FROM stock_products WHERE id = ?', [bundle.kitProductId]);
      await db.run('START TRANSACTION');
      try {
        await db.run(
          `INSERT INTO stock_moves
           (id, productId, productCode, warehouseId, locationId, qty, moveType, createdBy, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, 'DISASSEMBLE', ?, ?)`,
          [randomUUID(), bundle.kitProductId, kit.code, warehouseId, locationId || null, -Number(qty), userId, now]
        );
        await db.run(
          `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
           VALUES (?, ?, ?, ?, 0, ?)
           ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)`,
          [bundle.kitProductId, warehouseId, locKey, -Number(qty), now]
        );
        for (const it of items) {
          const back = Number(it.quantity) * Number(qty);
          await db.run(
            `INSERT INTO stock_moves
             (id, productId, productCode, warehouseId, locationId, qty, moveType, createdBy, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, 'DISASSEMBLE', ?, ?)`,
            [randomUUID(), it.productId, it.productCode, warehouseId, locationId || null, back, userId, now]
          );
          await db.run(
            `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
             VALUES (?, ?, ?, ?, 0, ?)
             ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)`,
            [it.productId, warehouseId, locKey, back, now]
          );
        }
        await db.run('COMMIT');
      } catch (txError) {
        await db.run('ROLLBACK');
        throw txError;
      }
      res.json({ success: true, disassembled: Number(qty) });
    } catch (error) {
      console.error('Error disassembling bundle:', error);
      res.status(500).json({ error: 'Failed to disassemble bundle' });
    }
  });

  return router;
}
