import { Router } from 'express';
import { randomUUID } from 'crypto';
import { canManageWarehouse, isWhAdmin, managesWarehouse, requireWarehouseView } from '../middleware/warehouseAuth.js';

// Stock documents (A2-A5): RECEIPT/ISSUE/TRANSFER flows + reservations.
// Every physical move generates immutable stock_moves; balances project.

function canManageDocs(req: any): boolean {
  return canManageWarehouse(req, 'stock.manage');
}

// Data scope: holders of stock.manage see every document; everyone else only
// the ones they are requester/assignee/receiver/creator of. Permission-driven,
// not chức danh-driven.
function docScope(req: any): { userId: string; ownOnly: boolean } {
  const user = req.user || {};
  return { userId: user.id, ownOnly: !managesWarehouse(req) };
}

function docCode(prefix: string): string {
  const now = new Date();
  const ym = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `${prefix}-${ym}-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 100)}`;
}

const DOC_TYPES = ['RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT'] as const;
const DOC_PREFIX: Record<string, string> = { RECEIPT: 'PNK', ISSUE: 'PXK', TRANSFER: 'DCK', ADJUSTMENT: 'DC' };

export function warehouseDocsRoutes(db: any) {
  const router = Router();

  // ============================================================
  // GET /api/warehouse/documents?type=&status=
  // ============================================================
  router.get('/documents', async (req, res) => {
    try {
      const { userId, ownOnly } = docScope(req);
      if (isWhAdmin(req)) return res.json([]);

      const conditions: string[] = [];
      const params: any[] = [];
      const type = String(req.query.type || '');
      if (type) {
        if (!DOC_TYPES.includes(type as any)) {
          return res.status(400).json({ error: 'Unsupported document type' });
        }
        conditions.push('d.type = ?');
        params.push(type);
      } else {
        conditions.push(`d.type IN ('RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT')`);
      }
      const status = String(req.query.status || '');
      if (status) {
        const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
        conditions.push(`d.status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses);
      }
      if (ownOnly) {
        conditions.push('(d.requesterId = ? OR d.assigneeId = ? OR d.createdBy = ? OR d.receiverId = ?)');
        params.push(userId, userId, userId, userId);
      }
      const rows = await db.all(
        `SELECT d.*, w.code AS warehouseCode, w.name AS warehouseName,
                u1.name AS requesterName, u2.name AS assigneeName,
                (SELECT COUNT(*) FROM stock_document_lines l WHERE l.docId = d.id) AS lineCount,
                (SELECT COALESCE(SUM(l.qtyReceived), 0) FROM stock_document_lines l WHERE l.docId = d.id) AS qtyReceived,
                (SELECT COALESCE(SUM(l.qtyOrdered), 0) FROM stock_document_lines l WHERE l.docId = d.id) AS qtyOrdered
         FROM stock_documents d
         JOIN warehouses w ON d.warehouseId = w.id
         LEFT JOIN users u1 ON d.requesterId = u1.id
         LEFT JOIN users u2 ON d.assigneeId = u2.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY d.createdAt DESC`,
        params
      );
      res.json(rows);
    } catch (error) {
      console.error('Error fetching stock documents:', error);
      res.status(500).json({ error: 'Failed to fetch stock documents' });
    }
  });

  // ============================================================
  // POST /api/warehouse/documents - Create receipt/issue/transfer (TP/Admin)
  // ============================================================
  router.post('/documents', async (req, res) => {
    try {
      if (!canManageDocs(req)) return res.status(403).json({ error: 'Forbidden' });
      const { type = 'RECEIPT', warehouseId, toWarehouseId, supplierName, sourceType = 'INTERNAL', sourceId, assigneeId, receiverId, etaDate, dueDate, notes, lines = [] } = req.body;
      if (!DOC_TYPES.includes(type) || type === 'ADJUSTMENT') {
        return res.status(400).json({ error: `Invalid type. Must be one of: RECEIPT, ISSUE, TRANSFER (ADJUSTMENT is system-generated)` });
      }
      if (!warehouseId) return res.status(400).json({ error: 'warehouseId is required' });
      const warehouse = await db.get('SELECT id FROM warehouses WHERE id = ?', [warehouseId]);
      if (!warehouse) return res.status(400).json({ error: 'Warehouse not found' });
      let destWarehouseId: string | null = null;
      if (type === 'TRANSFER') {
        if (!toWarehouseId) return res.status(400).json({ error: 'toWarehouseId is required for transfers' });
        if (toWarehouseId === warehouseId) {
          return res.status(400).json({ error: 'Source and destination warehouses must differ' });
        }
        const dest = await db.get('SELECT id FROM warehouses WHERE id = ?', [toWarehouseId]);
        if (!dest) return res.status(400).json({ error: 'Destination warehouse not found' });
        destWarehouseId = toWarehouseId;
      }
      if (etaDate !== undefined && etaDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(etaDate)) {
        return res.status(400).json({ error: 'etaDate must be YYYY-MM-DD' });
      }
      if (dueDate !== undefined && dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        return res.status(400).json({ error: 'dueDate must be YYYY-MM-DD' });
      }
      if (!Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ error: 'at least one line is required' });
      }
      if (assigneeId) {
        const assignee = await db.get('SELECT id FROM users WHERE id = ?', [assigneeId]);
        if (!assignee) return res.status(400).json({ error: 'Assignee not found' });
      }
      if (receiverId) {
        const receiver = await db.get('SELECT id FROM users WHERE id = ?', [receiverId]);
        if (!receiver) return res.status(400).json({ error: 'Receiver not found' });
      }
      for (const line of lines) {
        const product = await db.get('SELECT id, code, name FROM stock_products WHERE id = ?', [line.productId]);
        if (!product) return res.status(400).json({ error: `Product not found: ${line.productId}` });
        if (line.qtyOrdered === undefined || Number.isNaN(Number(line.qtyOrdered)) || Number(line.qtyOrdered) <= 0) {
          return res.status(400).json({ error: 'each line needs qtyOrdered > 0' });
        }
        if (line.locationId) {
          const loc = await db.get('SELECT id, warehouseId FROM warehouse_locations WHERE id = ?', [line.locationId]);
          if (!loc) return res.status(400).json({ error: 'Location not found' });
          if (loc.warehouseId !== warehouseId) {
            return res.status(400).json({ error: 'Line location must belong to the document warehouse' });
          }
        }
        line._product = product;
      }
      const id = randomUUID();
      const code = docCode(DOC_PREFIX[type]);
      const userId = (req as any).user?.id || null;
      await db.run(
        `INSERT INTO stock_documents
         (id, code, type, status, sourceType, sourceId, supplierName, warehouseId, toWarehouseId, requesterId, assigneeId, receiverId, etaDate, dueDate, notes, createdBy)
         VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, code, type, sourceType, sourceId || null, supplierName || null, warehouseId, destWarehouseId, userId, assigneeId || null, receiverId || null, etaDate || null, dueDate || null, notes || null, userId]
      );
      for (const line of lines) {
        await db.run(
          `INSERT INTO stock_document_lines
           (id, docId, productId, productCode, productName, qtyOrdered, unit, locationId, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), id, line.productId, line._product.code, line._product.name,
           Number(line.qtyOrdered), line.unit || 'pcs', line.locationId || null, line.notes || null]
        );
      }
      res.json({ id, code, success: true });
    } catch (error) {
      console.error('Error creating stock document:', error);
      res.status(500).json({ error: 'Failed to create stock document' });
    }
  });

  // ============================================================
  // GET /api/warehouse/documents/:id - Detail with lines
  // ============================================================
  router.get('/documents/:id', async (req, res) => {
    try {
      const { userId, ownOnly } = docScope(req);
      if (isWhAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
      const doc = await db.get(
        `SELECT d.*, w.code AS warehouseCode, w.name AS warehouseName,
                tw.code AS toWarehouseCode, tw.name AS toWarehouseName,
                u1.name AS requesterName, u2.name AS assigneeName, u3.name AS receiverName
         FROM stock_documents d
         JOIN warehouses w ON d.warehouseId = w.id
         LEFT JOIN warehouses tw ON d.toWarehouseId = tw.id
         LEFT JOIN users u1 ON d.requesterId = u1.id
         LEFT JOIN users u2 ON d.assigneeId = u2.id
         LEFT JOIN users u3 ON d.receiverId = u3.id
         WHERE d.id = ?`,
        [req.params.id]
      );
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (ownOnly && doc.requesterId !== userId && doc.assigneeId !== userId && doc.createdBy !== userId && doc.receiverId !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const lines = await db.all(
        `SELECT l.*, p.unit AS productUnit, p.tracking AS productTracking
         FROM stock_document_lines l
         LEFT JOIN stock_products p ON l.productId = p.id
         WHERE l.docId = ?
         ORDER BY l.createdAt ASC`,
        [doc.id]
      );
      res.json({ ...doc, lines });
    } catch (error) {
      console.error('Error fetching stock document:', error);
      res.status(500).json({ error: 'Failed to fetch stock document' });
    }
  });

  async function loadDocForWrite(id: string, req: any, res: any) {
    const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [id]);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return null;
    }
    const userId = req.user?.id;
    const isManager = canManageDocs(req);
    const involved = doc.requesterId === userId || doc.assigneeId === userId
      || doc.receiverId === userId || doc.createdBy === userId;
    if (!isManager && !involved) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return { doc, isManager, userId };
  }

  // POST /lines - add line (DRAFT/CONFIRMED, creator or TP)
  router.post('/documents/:id/lines', async (req, res) => {
    try {
      const loaded = await loadDocForWrite(req.params.id, req, res);
      if (!loaded) return;
      const { doc, isManager, userId } = loaded;
      if (!['DRAFT', 'CONFIRMED'].includes(doc.status)) {
        return res.status(400).json({ error: `Cannot add lines to a ${doc.status} document` });
      }
      if (!isManager && doc.createdBy !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const { productId, qtyOrdered, unit, locationId, notes } = req.body;
      const product = await db.get('SELECT id, code, name FROM stock_products WHERE id = ?', [productId]);
      if (!product) return res.status(400).json({ error: 'Product not found' });
      if (qtyOrdered === undefined || Number.isNaN(Number(qtyOrdered)) || Number(qtyOrdered) <= 0) {
        return res.status(400).json({ error: 'qtyOrdered > 0 is required' });
      }
      if (locationId) {
        const loc = await db.get('SELECT id, warehouseId FROM warehouse_locations WHERE id = ?', [locationId]);
        if (!loc) return res.status(400).json({ error: 'Location not found' });
        if (loc.warehouseId !== doc.warehouseId) {
          return res.status(400).json({ error: 'Line location must belong to the document warehouse' });
        }
      }
      const lineId = randomUUID();
      await db.run(
        `INSERT INTO stock_document_lines
         (id, docId, productId, productCode, productName, qtyOrdered, unit, locationId, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [lineId, doc.id, productId, product.code, product.name, Number(qtyOrdered), unit || 'pcs', locationId || null, notes || null]
      );
      res.json({ id: lineId, success: true });
    } catch (error) {
      console.error('Error adding document line:', error);
      res.status(500).json({ error: 'Failed to add document line' });
    }
  });

  // PATCH /lines/:lineId - edit ordered qty (DRAFT only, creator or TP)
  router.patch('/documents/:docId/lines/:lineId', async (req, res) => {
    try {
      const loaded = await loadDocForWrite(req.params.docId, req, res);
      if (!loaded) return;
      const { doc, isManager, userId } = loaded;
      if (doc.status !== 'DRAFT') {
        return res.status(400).json({ error: 'Only DRAFT lines can be edited' });
      }
      if (!isManager && doc.createdBy !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND docId = ?', [req.params.lineId, doc.id]);
      if (!line) return res.status(404).json({ error: 'Line not found' });
      const { qtyOrdered, unit, locationId, notes } = req.body;
      if (qtyOrdered !== undefined && (Number.isNaN(Number(qtyOrdered)) || Number(qtyOrdered) <= 0)) {
        return res.status(400).json({ error: 'qtyOrdered > 0 is required' });
      }
      if (locationId !== undefined && locationId !== null) {
        const loc = await db.get('SELECT id, warehouseId FROM warehouse_locations WHERE id = ?', [locationId]);
        if (!loc) return res.status(400).json({ error: 'Location not found' });
        if (loc.warehouseId !== doc.warehouseId) {
          return res.status(400).json({ error: 'Line location must belong to the document warehouse' });
        }
      }
      await db.run(
        `UPDATE stock_document_lines
         SET qtyOrdered = ?, unit = ?, locationId = ?, notes = ?, updatedAt = ?
         WHERE id = ?`,
        [
          qtyOrdered !== undefined ? Number(qtyOrdered) : line.qtyOrdered,
          unit !== undefined ? unit : line.unit,
          locationId !== undefined ? locationId : line.locationId,
          notes !== undefined ? notes : line.notes,
          new Date().toISOString(), line.id,
        ]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating document line:', error);
      res.status(500).json({ error: 'Failed to update document line' });
    }
  });

  // DELETE /lines/:lineId (DRAFT only, creator or TP)
  router.delete('/documents/:docId/lines/:lineId', async (req, res) => {
    try {
      const loaded = await loadDocForWrite(req.params.docId, req, res);
      if (!loaded) return;
      const { doc, isManager, userId } = loaded;
      if (doc.status !== 'DRAFT') {
        return res.status(400).json({ error: 'Only DRAFT lines can be deleted' });
      }
      if (!isManager && doc.createdBy !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      await db.run('DELETE FROM stock_document_lines WHERE id = ? AND docId = ?', [req.params.lineId, doc.id]);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting document line:', error);
      res.status(500).json({ error: 'Failed to delete document line' });
    }
  });

  // PATCH /documents/:id - status transitions
  // RECEIPT: DRAFT->CONFIRMED/CANCELLED (creator/TP); CONFIRMED->RECEIVING
  //   (handler); CONFIRMED->CANCELLED (creator/TP).
  // ISSUE: DRAFT->CONFIRMED/CANCELLED (creator/TP); CONFIRMED->PICKING (handler);
  //   PICKING->READY (handler, all lines fully picked); CONFIRMED->CANCELLED.
  // TRANSFER: DRAFT->CONFIRMED/CANCELLED (creator/TP); CONFIRMED->IN_TRANSIT
  //   "Xác nhận gửi" (sender/TP); IN_TRANSIT->RECEIVED "Xác nhận nhận"
  //   (receiver/TP); RECEIVED->DONE via complete (TP only);
  //   CONFIRMED->CANCELLED (creator/TP).
  // Also allows TP to reassign assigneeId/receiverId.
  router.patch('/documents/:id', async (req, res) => {
    try {
      const loaded = await loadDocForWrite(req.params.id, req, res);
      if (!loaded) return;
      const { doc, isManager, userId } = loaded;
      const { status, assigneeId, receiverId, dueDate } = req.body;
      const isInvolved = doc.requesterId === userId || doc.assigneeId === userId
        || doc.receiverId === userId || doc.createdBy === userId;

      if (assigneeId !== undefined || receiverId !== undefined) {
        if (!isManager) return res.status(403).json({ error: 'Only managers can reassign' });
        if (assigneeId !== undefined && assigneeId !== null) {
          const assignee = await db.get('SELECT id FROM users WHERE id = ?', [assigneeId]);
          if (!assignee) return res.status(400).json({ error: 'Assignee not found' });
          await db.run('UPDATE stock_documents SET assigneeId = ?, updatedAt = ? WHERE id = ?',
            [assigneeId, new Date().toISOString(), doc.id]);
        }
        if (receiverId !== undefined && receiverId !== null) {
          const receiver = await db.get('SELECT id FROM users WHERE id = ?', [receiverId]);
          if (!receiver) return res.status(400).json({ error: 'Receiver not found' });
          await db.run('UPDATE stock_documents SET receiverId = ?, updatedAt = ? WHERE id = ?',
            [receiverId, new Date().toISOString(), doc.id]);
        }
      }

      if (dueDate !== undefined && !['DONE', 'CANCELLED'].includes(doc.status)) {
        if (!isManager && doc.createdBy !== userId) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        if (dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
          return res.status(400).json({ error: 'dueDate must be YYYY-MM-DD' });
        }
        await db.run('UPDATE stock_documents SET dueDate = ?, updatedAt = ? WHERE id = ?',
          [dueDate, new Date().toISOString(), doc.id]);
      }

      if (status !== undefined && status !== doc.status) {
        const from = doc.status;
        const to = status;
        let allowed = false;
        const creatorOrManager = isManager || doc.createdBy === userId;
        if (from === 'DRAFT' && (to === 'CONFIRMED' || to === 'CANCELLED')) {
          allowed = creatorOrManager;
        } else if (from === 'CONFIRMED' && to === 'CANCELLED') {
          allowed = creatorOrManager;
        } else if (doc.type === 'RECEIPT' && from === 'CONFIRMED' && to === 'RECEIVING') {
          allowed = isManager || isInvolved;
        } else if (doc.type === 'ISSUE' && from === 'CONFIRMED' && to === 'PICKING') {
          allowed = isManager || isInvolved;
        } else if (doc.type === 'ISSUE' && from === 'PICKING' && to === 'READY') {
          if (isManager || isInvolved) {
            const lines = await db.all('SELECT qtyOrdered, qtyReceived FROM stock_document_lines WHERE docId = ?', [doc.id]);
            allowed = lines.length > 0 && lines.every((l: any) => Number(l.qtyReceived) >= Number(l.qtyOrdered));
          }
        } else if (doc.type === 'TRANSFER' && from === 'CONFIRMED' && to === 'IN_TRANSIT') {
          allowed = isManager || doc.assigneeId === userId;
        } else if (doc.type === 'TRANSFER' && from === 'IN_TRANSIT' && to === 'RECEIVED') {
          allowed = isManager || doc.receiverId === userId;
        }
        if (!allowed) {
          return res.status(400).json({ error: `Cannot transition ${from} -> ${to}` });
        }
        await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?',
          [to, new Date().toISOString(), doc.id]);
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating stock document:', error);
      res.status(500).json({ error: 'Failed to update stock document' });
    }
  });

  // POST /documents/:id/lines/:lineId/receive - record received qty (RECEIPT only)
  // Auto-moves CONFIRMED -> RECEIVING. Caps at ordered (no over-receipt).
  router.post('/documents/:id/lines/:lineId/receive', async (req, res) => {
    try {
      const loaded = await loadDocForWrite(req.params.id, req, res);
      if (!loaded) return;
      const { doc, isManager, userId } = loaded;
      if (doc.type !== 'RECEIPT') {
        return res.status(400).json({ error: 'Use the pick/transfer-receive endpoint for non-receipt documents' });
      }
      if (!['CONFIRMED', 'RECEIVING'].includes(doc.status)) {
        return res.status(400).json({ error: `Cannot receive on a ${doc.status} document` });
      }
      const isHandler = isManager || doc.assigneeId === userId || doc.requesterId === userId;
      if (!isHandler) return res.status(403).json({ error: 'Forbidden' });
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND docId = ?', [req.params.lineId, doc.id]);
      if (!line) return res.status(404).json({ error: 'Line not found' });
      const { qty, locationId } = req.body;
      if (qty === undefined || Number.isNaN(Number(qty)) || Number(qty) <= 0) {
        return res.status(400).json({ error: 'qty > 0 is required' });
      }
      const newReceived = Number(line.qtyReceived) + Number(qty);
      if (newReceived > Number(line.qtyOrdered)) {
        return res.status(400).json({
          error: `Over-receipt blocked: ordered ${line.qtyOrdered}, already received ${line.qtyReceived}`,
        });
      }
      let locId = line.locationId;
      if (locationId !== undefined) {
        if (locationId === null) {
          locId = null;
        } else {
          const loc = await db.get('SELECT id, warehouseId FROM warehouse_locations WHERE id = ?', [locationId]);
          if (!loc) return res.status(400).json({ error: 'Location not found' });
          if (loc.warehouseId !== doc.warehouseId) {
            return res.status(400).json({ error: 'Location must belong to the document warehouse' });
          }
          locId = locationId;
        }
      }
      await db.run(
        'UPDATE stock_document_lines SET qtyReceived = ?, locationId = ?, updatedAt = ? WHERE id = ?',
        [newReceived, locId, new Date().toISOString(), line.id]
      );
      if (doc.status === 'CONFIRMED') {
        await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?',
          ['RECEIVING', new Date().toISOString(), doc.id]);
      }
      res.json({ success: true, qtyReceived: newReceived });
    } catch (error) {
      console.error('Error receiving line:', error);
      res.status(500).json({ error: 'Failed to record receipt' });
    }
  });

  // POST /documents/:id/lines/:lineId/pick - record picked qty (ISSUE only)
  // Auto-moves CONFIRMED -> PICKING. Caps at ordered AND at available stock
  // (no override on shortage). Source location must be SALEABLE/PICKING
  // (never quarantine/damaged).
  router.post('/documents/:id/lines/:lineId/pick', async (req, res) => {
    try {
      const loaded = await loadDocForWrite(req.params.id, req, res);
      if (!loaded) return;
      const { doc, isManager, userId } = loaded;
      if (doc.type !== 'ISSUE') {
        return res.status(400).json({ error: 'Use the receive/transfer-receive endpoint for non-issue documents' });
      }
      if (!['CONFIRMED', 'PICKING'].includes(doc.status)) {
        return res.status(400).json({ error: `Cannot pick on a ${doc.status} document` });
      }
      const isHandler = isManager || doc.assigneeId === userId || doc.requesterId === userId;
      if (!isHandler) return res.status(403).json({ error: 'Forbidden' });
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND docId = ?', [req.params.lineId, doc.id]);
      if (!line) return res.status(404).json({ error: 'Line not found' });
      const { qty, locationId } = req.body;
      if (qty === undefined || Number.isNaN(Number(qty)) || Number(qty) <= 0) {
        return res.status(400).json({ error: 'qty > 0 is required' });
      }
      const newPicked = Number(line.qtyReceived) + Number(qty);
      if (newPicked > Number(line.qtyOrdered)) {
        return res.status(400).json({
          error: `Over-pick blocked: ordered ${line.qtyOrdered}, already picked ${line.qtyReceived}`,
        });
      }
      let locId = line.locationId;
      if (locationId !== undefined) {
        if (locationId === null) {
          locId = null;
        } else {
          const loc = await db.get('SELECT id, warehouseId, purpose FROM warehouse_locations WHERE id = ?', [locationId]);
          if (!loc) return res.status(400).json({ error: 'Location not found' });
          if (loc.warehouseId !== doc.warehouseId) {
            return res.status(400).json({ error: 'Location must belong to the document warehouse' });
          }
          if (!['SALEABLE', 'PICKING'].includes(loc.purpose)) {
            return res.status(400).json({ error: `Cannot pick from ${loc.purpose} locations` });
          }
          locId = locationId;
        }
      }
      // Available-stock check across all balance buckets of this product+warehouse
      const buckets: any = await db.all(
        `SELECT COALESCE(SUM(onHand - reserved), 0) AS available
         FROM stock_balances WHERE productId = ? AND warehouseId = ?`,
        [line.productId, doc.warehouseId]
      );
      const available = Number(buckets[0]?.available || 0);
      if (Number(qty) > available) {
        return res.status(400).json({
          error: `Insufficient stock: need ${qty}, available ${available}`,
        });
      }
      await db.run(
        'UPDATE stock_document_lines SET qtyReceived = ?, locationId = ?, updatedAt = ? WHERE id = ?',
        [newPicked, locId, new Date().toISOString(), line.id]
      );
      if (doc.status === 'CONFIRMED') {
        await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?',
          ['PICKING', new Date().toISOString(), doc.id]);
      }
      res.json({ success: true, qtyPicked: newPicked });
    } catch (error) {
      console.error('Error picking line:', error);
      res.status(500).json({ error: 'Failed to record pick' });
    }
  });

  // POST /documents/:id/lines/:lineId/transfer-receive - dest confirms qty (TRANSFER)
  // Allowed in IN_TRANSIT (receiver/TP). Caps at ordered. Location must belong
  // to the DESTINATION warehouse. First confirm moves doc IN_TRANSIT->RECEIVED.
  // Shortage/damage reported via notes.
  router.post('/documents/:id/lines/:lineId/transfer-receive', async (req, res) => {
    try {
      const loaded = await loadDocForWrite(req.params.id, req, res);
      if (!loaded) return;
      const { doc, isManager, userId } = loaded;
      if (doc.type !== 'TRANSFER') {
        return res.status(400).json({ error: 'Only TRANSFER documents support transfer-receive' });
      }
      if (!['IN_TRANSIT', 'RECEIVED'].includes(doc.status)) {
        return res.status(400).json({ error: `Cannot confirm receipt on a ${doc.status} document` });
      }
      const isReceiver = isManager || doc.receiverId === userId;
      if (!isReceiver) return res.status(403).json({ error: 'Forbidden' });
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND docId = ?', [req.params.lineId, doc.id]);
      if (!line) return res.status(404).json({ error: 'Line not found' });
      const { qty, locationId, notes } = req.body;
      if (qty === undefined || Number.isNaN(Number(qty)) || Number(qty) < 0) {
        return res.status(400).json({ error: 'qty >= 0 is required (0 flags a full shortage)' });
      }
      const newReceived = Number(line.qtyReceived) + Number(qty);
      if (newReceived > Number(line.qtyOrdered)) {
        return res.status(400).json({
          error: `Over-receipt blocked: sent ${line.qtyOrdered}, already confirmed ${line.qtyReceived}`,
        });
      }
      let locId = line.locationId;
      if (locationId !== undefined) {
        if (locationId === null) {
          locId = null;
        } else {
          const loc = await db.get('SELECT id, warehouseId FROM warehouse_locations WHERE id = ?', [locationId]);
          if (!loc) return res.status(400).json({ error: 'Location not found' });
          if (loc.warehouseId !== doc.toWarehouseId) {
            return res.status(400).json({ error: 'Receiving location must belong to the destination warehouse' });
          }
          locId = locationId;
        }
      }
      await db.run(
        'UPDATE stock_document_lines SET qtyReceived = ?, locationId = ?, notes = ?, updatedAt = ? WHERE id = ?',
        [newReceived, locId, notes !== undefined ? notes : line.notes, new Date().toISOString(), line.id]
      );
      if (doc.status === 'IN_TRANSIT') {
        await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?',
          ['RECEIVED', new Date().toISOString(), doc.id]);
      }
      res.json({ success: true, qtyReceived: newReceived });
    } catch (error) {
      console.error('Error confirming transfer receipt:', error);
      res.status(500).json({ error: 'Failed to confirm transfer receipt' });
    }
  });

  // POST /documents/:id/complete
  // RECEIPT (from RECEIVING): validate full receipt, emit +moves.
  // ISSUE (from READY): validate full pick, emit -moves, decrement balances.
  // TRANSFER (from RECEIVED, TP only): emit -moves at source + +moves at dest.
  router.post('/documents/:id/complete', async (req, res) => {
    try {
      const loaded = await loadDocForWrite(req.params.id, req, res);
      if (!loaded) return;
      const { doc, isManager, userId } = loaded;
      const wantFrom = doc.type === 'RECEIPT' ? 'RECEIVING' : doc.type === 'ISSUE' ? 'READY' : 'RECEIVED';
      if (doc.status !== wantFrom) {
        return res.status(400).json({ error: `Only ${wantFrom} documents can be completed (current: ${doc.status})` });
      }
      const isHandler = isManager || doc.assigneeId === userId || doc.requesterId === userId || doc.receiverId === userId;
      if (!isHandler) return res.status(403).json({ error: 'Forbidden' });
      if (doc.type === 'TRANSFER' && !isManager) {
        return res.status(403).json({ error: 'Only managers can finalize transfers' });
      }
      const lines = await db.all('SELECT * FROM stock_document_lines WHERE docId = ?', [doc.id]);
      if (lines.length === 0) {
        return res.status(400).json({ error: 'Document has no lines' });
      }
      const handledWord = doc.type === 'RECEIPT' ? 'received' : doc.type === 'ISSUE' ? 'picked' : 'confirmed';
      const incomplete = lines.filter((l: any) => Number(l.qtyReceived) < Number(l.qtyOrdered));
      if (incomplete.length > 0 && doc.type !== 'TRANSFER') {
        return res.status(400).json({
          error: `${incomplete.length} line(s) not fully ${handledWord}`,
          lines: incomplete.map((l: any) => ({ id: l.id, productCode: l.productCode, ordered: l.qtyOrdered, received: l.qtyReceived })),
        });
      }
      const now = new Date().toISOString();
      await db.run('START TRANSACTION');
      try {
        // ISSUE guard: SERIAL-tracked lines need enough assigned serials
        if (doc.type === 'ISSUE') {
          for (const line of lines) {
            const prod: any = await db.get('SELECT tracking FROM stock_products WHERE id = ?', [line.productId]);
            if (prod && prod.tracking === 'SERIAL') {
              const assigned: any = await db.get(
                `SELECT COUNT(*) AS c FROM serials WHERE issueLineId = ? AND status = 'RESERVED'`,
                [line.id]
              );
              if (Number(assigned?.c || 0) < Number(line.qtyReceived)) {
                throw new Error(`Line ${line.productCode} needs ${line.qtyReceived} assigned serials`);
              }
            }
          }
        }
        for (const line of lines) {
          if (doc.type === 'TRANSFER') {
            // Source side: -qty (guard available inside transaction)
            const buckets: any = await db.all(
              `SELECT COALESCE(SUM(onHand - reserved), 0) AS available
               FROM stock_balances WHERE productId = ? AND warehouseId = ?`,
              [line.productId, doc.warehouseId]
            );
            if (Number(line.qtyOrdered) > Number(buckets[0]?.available || 0)) {
              throw new Error(`Insufficient stock at source for ${line.productCode}`);
            }
            await db.run(
              `INSERT INTO stock_moves
               (id, productId, productCode, warehouseId, locationId, qty, moveType, docId, lineId, createdBy, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, 'TRANSFER', ?, ?, ?, ?)`,
              [randomUUID(), line.productId, line.productCode, doc.warehouseId, line.locationId,
               -Number(line.qtyOrdered), doc.id, line.id, userId, now]
            );
            await db.run(
              `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
               VALUES (?, ?, ?, ?, 0, ?)
               ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)`,
              [line.productId, doc.warehouseId, line.locationId || '', -Number(line.qtyOrdered), now]
            );
            // Destination side: +confirmed qty
            await db.run(
              `INSERT INTO stock_moves
               (id, productId, productCode, warehouseId, locationId, qty, moveType, docId, lineId, createdBy, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, 'TRANSFER', ?, ?, ?, ?)`,
              [randomUUID(), line.productId, line.productCode, doc.toWarehouseId, line.locationId,
               Number(line.qtyReceived), doc.id, line.id, userId, now]
            );
            await db.run(
              `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
               VALUES (?, ?, ?, ?, 0, ?)
               ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)`,
              [line.productId, doc.toWarehouseId, line.locationId || '', Number(line.qtyReceived), now]
            );
          } else {
            const sign = doc.type === 'RECEIPT' ? 1 : -1;
            const qty = sign * Number(line.qtyReceived);
            if (sign < 0) {
              const buckets: any = await db.all(
                `SELECT COALESCE(SUM(onHand - reserved), 0) AS available
                 FROM stock_balances WHERE productId = ? AND warehouseId = ?`,
                [line.productId, doc.warehouseId]
              );
              if (Number(line.qtyReceived) > Number(buckets[0]?.available || 0)) {
                throw new Error(`Insufficient stock for ${line.productCode}`);
              }
            }
            await db.run(
              `INSERT INTO stock_moves
               (id, productId, productCode, warehouseId, locationId, qty, moveType, docId, lineId, createdBy, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [randomUUID(), line.productId, line.productCode, doc.warehouseId, line.locationId,
               qty, doc.type, doc.id, line.id, userId, now]
            );
            const locKey = line.locationId || '';
            await db.run(
              `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
               VALUES (?, ?, ?, ?, 0, ?)
               ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)`,
              [line.productId, doc.warehouseId, locKey, qty, now]
            );
          }
        }
        // ISSUE DONE consumes ACTIVE reservations FIFO (same product + warehouse).
        // Reserved qty drops together with onHand, so available only falls by
        // the unreserved portion actually issued.
        if (doc.type === 'ISSUE') {
          for (const line of lines) {
            let remaining = Number(line.qtyReceived);
            const active = await db.all(
              `SELECT * FROM reservations
               WHERE productId = ? AND warehouseId = ? AND status = 'ACTIVE'
               ORDER BY createdAt ASC`,
              [line.productId, doc.warehouseId]
            );
            for (const r of active) {
              if (remaining <= 0) break;
              const left = Number(r.qty) - Number(r.qtyConsumed);
              if (left <= 0) continue;
              const take = Math.min(left, remaining);
              remaining -= take;
              const consumed = Number(r.qtyConsumed) + take;
              await db.run(
                `UPDATE reservations SET qtyConsumed = ?, status = ?, updatedAt = ? WHERE id = ?`,
                [consumed, consumed >= Number(r.qty) ? 'CONSUMED' : 'ACTIVE', now, r.id]
              );
              await bumpReserved(line.productId, doc.warehouseId, r.locationId || '', -take, now);
            }
          }
        }
        // ISSUE DONE flips assigned serials to ISSUED
        if (doc.type === 'ISSUE') {
          const lineIds = lines.map((l: any) => l.id);
          if (lineIds.length > 0) {
            await db.run(
              `UPDATE serials SET status = 'ISSUED', updatedAt = ?
               WHERE issueLineId IN (${lineIds.map(() => '?').join(',')}) AND status = 'RESERVED'`,
              [now, ...lineIds]
            );
          }
        }
        await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?',
          ['DONE', now, doc.id]);
        await db.run('COMMIT');
      } catch (txError) {
        await db.run('ROLLBACK');
        throw txError;
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error completing document:', error);
      res.status(500).json({ error: 'Failed to complete document' });
    }
  });

  // POST /documents/:id/cancel
  router.post('/documents/:id/cancel', async (req, res) => {
    try {
      const loaded = await loadDocForWrite(req.params.id, req, res);
      if (!loaded) return;
      const { doc, isManager, userId } = loaded;
      if (!['DRAFT', 'CONFIRMED'].includes(doc.status)) {
        return res.status(400).json({ error: `Cannot cancel a ${doc.status} document` });
      }
      if (!isManager && doc.createdBy !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?',
        ['CANCELLED', new Date().toISOString(), doc.id]);
      res.json({ success: true });
    } catch (error) {
      console.error('Error cancelling document:', error);
      res.status(500).json({ error: 'Failed to cancel document' });
    }
  });

  // ============================================================
  // GET /api/warehouse/balances - stock projection (Available = onHand - reserved)
  // ============================================================
  router.get('/balances', async (req, res) => {
    try {
      const user: any = req.user || {};
      if (isWhAdmin(req)) return res.json([]);
      const conditions: string[] = [];
      const params: any[] = [];
      const warehouseId = String(req.query.warehouseId || '');
      if (warehouseId) {
        conditions.push('b.warehouseId = ?');
        params.push(warehouseId);
      }
      const search = String(req.query.search || '').trim();
      if (search) {
        conditions.push('(p.code LIKE ? OR p.name LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.all(
        `SELECT b.productId, p.code AS productCode, p.name AS productName, p.unit,
                b.warehouseId, w.code AS warehouseCode, w.name AS warehouseName,
                b.locationId, l.code AS locationCode,
                b.onHand, b.reserved, (b.onHand - b.reserved) AS available, b.updatedAt
         FROM stock_balances b
         JOIN stock_products p ON b.productId = p.id
         JOIN warehouses w ON b.warehouseId = w.id
         LEFT JOIN warehouse_locations l ON b.locationId = l.id
         ${where}
         ORDER BY p.code ASC`,
        params
      );
      res.json(rows.map((r: any) => ({
        ...r,
        onHand: Number(r.onHand), reserved: Number(r.reserved), available: Number(r.available),
      })));
    } catch (error) {
      console.error('Error fetching balances:', error);
      res.status(500).json({ error: 'Failed to fetch balances' });
    }
  });

  // ============================================================
  // Reservations (A5: giữ hàng — không sinh stock_move)
  // Reserve/release/consume chỉ chạm cột reserved trong balances.
  // ============================================================

  // Adjust reserved bucket (creates the bucket row if missing)
  async function bumpReserved(productId: string, warehouseId: string, locationKey: string, delta: number, now: string) {
    await db.run(
      `INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt)
       VALUES (?, ?, ?, 0, ?, ?)
       ON DUPLICATE KEY UPDATE reserved = reserved + VALUES(reserved), updatedAt = VALUES(updatedAt)`,
      [productId, warehouseId, locationKey, delta, now]
    );
  }

  async function bucketAvailable(productId: string, warehouseId: string, locationKey: string): Promise<number> {
    const row: any = await db.get(
      `SELECT COALESCE(onHand - reserved, 0) AS available
       FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ?`,
      [productId, warehouseId, locationKey]
    );
    return Number(row?.available || 0);
  }

  // GET /api/warehouse/reservations - TP: all; NV: own/assigned
  router.get('/reservations', async (req, res) => {
    try {
      const user: any = req.user || {};
      if (isWhAdmin(req)) return res.json([]);
      const conditions: string[] = [];
      const params: any[] = [];
      const status = String(req.query.status || '');
      if (status) {
        conditions.push('r.status = ?');
        params.push(status);
      }
      if (!managesWarehouse(req)) {
        conditions.push('(r.createdBy = ? OR r.assigneeId = ?)');
        params.push(user.id, user.id);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.all(
        `SELECT r.*, w.code AS warehouseCode, w.name AS warehouseName,
                l.code AS locationCode, u1.name AS assigneeName, u2.name AS createdByName,
                CASE WHEN r.expiresAt IS NOT NULL AND r.expiresAt < NOW() AND r.status = 'ACTIVE'
                     THEN 1 ELSE 0 END AS isExpired
         FROM reservations r
         JOIN warehouses w ON r.warehouseId = w.id
         LEFT JOIN warehouse_locations l ON r.locationId = l.id
         LEFT JOIN users u1 ON r.assigneeId = u1.id
         LEFT JOIN users u2 ON r.createdBy = u2.id
         ${where}
         ORDER BY r.createdAt DESC`,
        params
      );
      res.json(rows);
    } catch (error) {
      console.error('Error fetching reservations:', error);
      res.status(500).json({ error: 'Failed to fetch reservations' });
    }
  });

  // POST /api/warehouse/reservations - TP/Admin giữ hàng (chỉ từ available)
  router.post('/reservations', async (req, res) => {
    try {
      if (!canManageDocs(req)) return res.status(403).json({ error: 'Forbidden' });
      const { productId, warehouseId, locationId, qty, sourceType = 'INTERNAL', sourceId, assigneeId, expiresAt, notes } = req.body;
      if (!productId || !warehouseId || qty === undefined) {
        return res.status(400).json({ error: 'productId, warehouseId and qty are required' });
      }
      if (Number.isNaN(Number(qty)) || Number(qty) <= 0) {
        return res.status(400).json({ error: 'qty > 0 is required' });
      }
      const product = await db.get('SELECT id, code, name FROM stock_products WHERE id = ?', [productId]);
      if (!product) return res.status(400).json({ error: 'Product not found' });
      const warehouse = await db.get('SELECT id FROM warehouses WHERE id = ?', [warehouseId]);
      if (!warehouse) return res.status(400).json({ error: 'Warehouse not found' });
      let locKey = '';
      if (locationId) {
        const loc = await db.get('SELECT id, warehouseId, purpose FROM warehouse_locations WHERE id = ?', [locationId]);
        if (!loc) return res.status(400).json({ error: 'Location not found' });
        if (loc.warehouseId !== warehouseId) {
          return res.status(400).json({ error: 'Location must belong to the warehouse' });
        }
        if (!['SALEABLE', 'PICKING'].includes(loc.purpose)) {
          return res.status(400).json({ error: `Cannot reserve from ${loc.purpose} locations` });
        }
        locKey = locationId;
      }
      if (assigneeId) {
        const assignee = await db.get('SELECT id FROM users WHERE id = ?', [assigneeId]);
        if (!assignee) return res.status(400).json({ error: 'Assignee not found' });
      }
      if (expiresAt !== undefined && expiresAt !== null && !/^\d{4}-\d{2}-\d{2}/.test(expiresAt)) {
        return res.status(400).json({ error: 'expiresAt must be a valid datetime' });
      }
      const available = await bucketAvailable(productId, warehouseId, locKey);
      if (Number(qty) > available) {
        return res.status(400).json({ error: `Cannot reserve ${qty}: only ${available} available` });
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      await db.run('START TRANSACTION');
      try {
        await db.run(
          `INSERT INTO reservations
           (id, sourceType, sourceId, productId, productCode, productName, warehouseId, locationId,
            qty, assigneeId, expiresAt, notes, createdBy, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, sourceType, sourceId || null, productId, product.code, product.name, warehouseId,
           locationId || null, Number(qty), assigneeId || null, expiresAt || null, notes || null,
           (req as any).user?.id || null, now]
        );
        await bumpReserved(productId, warehouseId, locKey, Number(qty), now);
        await db.run('COMMIT');
      } catch (txError) {
        await db.run('ROLLBACK');
        throw txError;
      }
      res.json({ id, success: true });
    } catch (error) {
      console.error('Error creating reservation:', error);
      res.status(500).json({ error: 'Failed to create reservation' });
    }
  });

  // POST /api/warehouse/reservations/:id/release - giải phóng phần chưa dùng
  router.post('/reservations/:id/release', async (req, res) => {
    try {
      const row = await db.get('SELECT * FROM reservations WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Reservation not found' });
      if (row.status !== 'ACTIVE') {
        return res.status(400).json({ error: `Only ACTIVE reservations can be released (current: ${row.status})` });
      }
      const userId = (req as any).user?.id;
      if (!canManageDocs(req) && row.createdBy !== userId && row.assigneeId !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const remaining = Number(row.qty) - Number(row.qtyConsumed);
      const now = new Date().toISOString();
      await db.run('START TRANSACTION');
      try {
        await db.run(`UPDATE reservations SET status = 'RELEASED', updatedAt = ? WHERE id = ?`, [now, row.id]);
        await bumpReserved(row.productId, row.warehouseId, row.locationId || '', -remaining, now);
        await db.run('COMMIT');
      } catch (txError) {
        await db.run('ROLLBACK');
        throw txError;
      }
      res.json({ success: true, released: remaining });
    } catch (error) {
      console.error('Error releasing reservation:', error);
      res.status(500).json({ error: 'Failed to release reservation' });
    }
  });

  // ============================================================
  // GET /api/warehouse/transfer-suggestions - shortage vs surplus (C3)
  // For each product+warehouse below reorder: suggest transfer from the
  // warehouse holding the biggest surplus. TP-only.
  // ============================================================
  router.get('/transfer-suggestions', requireWarehouseView(['stock.manage']), async (req, res) => {
    try {
      const agg: any = await db.all(
        `SELECT b.productId, p.code AS productCode, p.name AS productName, p.unit,
                b.warehouseId, w.code AS warehouseCode, w.name AS warehouseName,
                COALESCE(SUM(b.onHand - b.reserved), 0) AS available,
                COALESCE(MAX(sp.reorderPoint), MAX(p.reorderPoint), MAX(p.minStock), 0) AS reorderPoint
         FROM stock_balances b
         JOIN stock_products p ON b.productId = p.id
         JOIN warehouses w ON b.warehouseId = w.id
         LEFT JOIN stock_policies sp ON sp.productId = b.productId AND sp.warehouseId = b.warehouseId
         GROUP BY b.productId, b.warehouseId`
      );
      // Surplus pools per product: warehouses above reorder
      const surplusByProduct = new Map<string, { warehouseId: string; warehouseCode: string; surplus: number }[]>();
      for (const r of agg) {
        const available = Number(r.available);
        const rp = Number(r.reorderPoint);
        if (rp > 0 && available > rp) {
          const list = surplusByProduct.get(r.productId) || [];
          list.push({ warehouseId: r.warehouseId, warehouseCode: r.warehouseCode, surplus: available - rp });
          surplusByProduct.set(r.productId, list);
        }
      }
      const suggestions = [];
      for (const r of agg) {
        const available = Number(r.available);
        const rp = Number(r.reorderPoint);
        if (!(rp > 0 && available < rp)) continue;
        const pools = (surplusByProduct.get(r.productId) || [])
          .filter((p) => p.warehouseId !== r.warehouseId)
          .sort((a, b) => b.surplus - a.surplus);
        if (pools.length === 0) continue;
        const shortage = rp - available;
        const from = pools[0];
        suggestions.push({
          productId: r.productId,
          productCode: r.productCode,
          productName: r.productName,
          unit: r.unit,
          toWarehouseId: r.warehouseId,
          toWarehouseCode: r.warehouseCode,
          fromWarehouseId: from.warehouseId,
          fromWarehouseCode: from.warehouseCode,
          shortageQty: shortage,
          suggestQty: Math.min(shortage, from.surplus),
        });
      }
      res.json(suggestions);
    } catch (error) {
      console.error('Error fetching transfer suggestions:', error);
      res.status(500).json({ error: 'Failed to fetch transfer suggestions' });
    }
  });

  return router;
}
