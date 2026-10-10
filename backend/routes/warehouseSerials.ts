import { Router } from 'express';
import { randomUUID } from 'crypto';
import { canManageWarehouse } from '../middleware/warehouseAuth.js';

// Serial / Lot tracking (B1, spec §22).
// - Register: on RECEIPT lines (handler), sets IN_STOCK + warranty from product.
// - Assign: to ISSUE lines (handler), sets RESERVED; ISSUE completion flips to
//   ISSUED and is blocked unless enough serials are assigned (SERIAL products).
// - Status workflow (TP): IN_STOCK / RESERVED / ISSUED / WARRANTY / DAMAGED / LOST.

function canManageSerials(req: any): boolean {
  return canManageWarehouse(req, 'stock.manage');
}

const VALID_SERIAL_STATUS = ['IN_STOCK', 'RESERVED', 'ISSUED', 'WARRANTY', 'DAMAGED', 'LOST'];

function warrantyEnd(startISO: string, months: number): string {
  const d = new Date(startISO);
  d.setMonth(d.getMonth() + Math.max(Number(months) || 0, 0));
  return d.toISOString().slice(0, 10);
}

export function warehouseSerialsRoutes(db: any) {
  const router = Router();

  // ============================================================
  // Lots
  // ============================================================
  router.get('/lots', async (req, res) => {
    try {
      const level = req.user?.managementLevel ?? 10;
      if (level === 99) return res.json([]);
      const conditions: string[] = [];
      const params: any[] = [];
      const search = String(req.query.search || '').trim();
      if (search) {
        conditions.push('(l.lotCode LIKE ? OR l.productCode LIKE ? OR p.name LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      const productId = String(req.query.productId || '');
      if (productId) {
        conditions.push('l.productId = ?');
        params.push(productId);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.all(
        `SELECT l.*, p.name AS productName, p.unit,
                (SELECT COUNT(*) FROM serials s WHERE s.lotId = l.id) AS serialCount
         FROM lots l
         JOIN stock_products p ON l.productId = p.id
         ${where}
         ORDER BY l.createdAt DESC`,
        params
      );
      res.json(rows);
    } catch (error) {
      console.error('Error fetching lots:', error);
      res.status(500).json({ error: 'Failed to fetch lots' });
    }
  });

  router.post('/lots', async (req, res) => {
    try {
      const user = (req.user || {}) as any;
      const level = user.managementLevel ?? 10;
      if (level === 99 || level < 10) return res.status(403).json({ error: 'Forbidden' });
      const { productId, lotCode, expiryDate, supplierName, notes } = req.body;
      if (!productId || !lotCode || !String(lotCode).trim()) {
        return res.status(400).json({ error: 'productId and lotCode are required' });
      }
      const product = await db.get('SELECT id, code FROM stock_products WHERE id = ?', [productId]);
      if (!product) return res.status(400).json({ error: 'Product not found' });
      if (expiryDate !== undefined && expiryDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
        return res.status(400).json({ error: 'expiryDate must be YYYY-MM-DD' });
      }
      const cleanCode = String(lotCode).trim();
      const existing = await db.get('SELECT id FROM lots WHERE lotCode = ?', [cleanCode]);
      if (existing) return res.status(400).json({ error: `Số lô '${cleanCode}' đã tồn tại` });
      const id = randomUUID();
      await db.run(
        `INSERT INTO lots (id, lotCode, productId, productCode, expiryDate, supplierName, notes, createdBy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, cleanCode, productId, product.code, expiryDate || null, supplierName || null, notes || null, user.id || null]
      );
      res.json({ id, success: true });
    } catch (error) {
      console.error('Error creating lot:', error);
      res.status(500).json({ error: 'Failed to create lot' });
    }
  });

  router.patch('/lots/:id', async (req, res) => {
    try {
      const user = (req.user || {}) as any;
      const level = user.managementLevel ?? 10;
      if (level === 99 || level < 10) return res.status(403).json({ error: 'Forbidden' });
      const row = await db.get('SELECT * FROM lots WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Lot not found' });
      const { expiryDate, supplierName, notes } = req.body;
      if (expiryDate !== undefined && expiryDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
        return res.status(400).json({ error: 'expiryDate must be YYYY-MM-DD' });
      }
      await db.run(
        `UPDATE lots SET expiryDate = ?, supplierName = ?, notes = ?, updatedAt = ? WHERE id = ?`,
        [
          expiryDate !== undefined ? expiryDate : row.expiryDate,
          supplierName !== undefined ? supplierName : row.supplierName,
          notes !== undefined ? notes : row.notes,
          new Date().toISOString(), row.id,
        ]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating lot:', error);
      res.status(500).json({ error: 'Failed to update lot' });
    }
  });

  router.delete('/lots/:id', async (req, res) => {
    try {
      if (!canManageSerials(req)) return res.status(403).json({ error: 'Forbidden' });
      const row = await db.get('SELECT * FROM lots WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Lot not found' });
      const used = await db.get('SELECT COUNT(*) AS c FROM serials WHERE lotId = ?', [row.id]);
      if (used && Number(used.c) > 0) {
        return res.status(400).json({ error: `Lô '${row.lotCode}' còn ${used.c} serial, không thể xóa` });
      }
      await db.run('DELETE FROM lots WHERE id = ?', [row.id]);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting lot:', error);
      res.status(500).json({ error: 'Failed to delete lot' });
    }
  });

  // ============================================================
  // Serials search + detail (spec §22.1–22.2)
  // ============================================================
  router.get('/serials', async (req, res) => {
    try {
      const level = req.user?.managementLevel ?? 10;
      if (level === 99) return res.json([]);
      const conditions: string[] = [];
      const params: any[] = [];
      const search = String(req.query.search || '').trim();
      if (search) {
        conditions.push('(s.serialNo LIKE ? OR l.lotCode LIKE ? OR p.model LIKE ? OR p.code LIKE ? OR p.name LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }
      const status = String(req.query.status || '');
      if (status) {
        if (!VALID_SERIAL_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status' });
        conditions.push('s.status = ?');
        params.push(status);
      }
      const productId = String(req.query.productId || '');
      if (productId) {
        conditions.push('s.productId = ?');
        params.push(productId);
      }
      const lineId = String(req.query.lineId || '');
      if (lineId) {
        conditions.push('(s.receiptLineId = ? OR s.issueLineId = ?)');
        params.push(lineId, lineId);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.all(
        `SELECT s.*, p.name AS productName, p.model, p.brand,
                l.lotCode, w.code AS warehouseCode, wl.code AS locationCode
         FROM serials s
         JOIN stock_products p ON s.productId = p.id
         LEFT JOIN lots l ON s.lotId = l.id
         LEFT JOIN warehouses w ON s.warehouseId = w.id
         LEFT JOIN warehouse_locations wl ON s.locationId = wl.id
         ${where}
         ORDER BY s.createdAt DESC
         LIMIT 200`,
        params
      );
      res.json(rows);
    } catch (error) {
      console.error('Error fetching serials:', error);
      res.status(500).json({ error: 'Failed to fetch serials' });
    }
  });

  router.get('/serials/:serialNo', async (req, res) => {
    try {
      const level = req.user?.managementLevel ?? 10;
      if (level === 99) return res.status(403).json({ error: 'Forbidden' });
      const serialNo = String(req.params.serialNo || '');
      const row: any = await db.get(
        `SELECT s.*, p.name AS productName, p.model, p.brand, p.warrantyMonths,
                l.lotCode, l.expiryDate AS lotExpiry,
                w.code AS warehouseCode, w.name AS warehouseName,
                wl.code AS locationCode,
                rd.code AS receiptCode, idoc.code AS issueCode
         FROM serials s
         JOIN stock_products p ON s.productId = p.id
         LEFT JOIN lots l ON s.lotId = l.id
         LEFT JOIN warehouses w ON s.warehouseId = w.id
         LEFT JOIN warehouse_locations wl ON s.locationId = wl.id
         LEFT JOIN stock_documents rd ON s.receiptDocId = rd.id
         LEFT JOIN stock_documents idoc ON s.issueDocId = idoc.id
         WHERE s.serialNo = ?`,
        [serialNo]
      );
      if (!row) return res.status(404).json({ error: 'Serial not found' });
      const timeline: any = await db.all(
        `SELECT m.id, m.qty, m.moveType, m.createdAt, m.docId, d.code AS docCode,
                w.code AS warehouseCode
         FROM stock_moves m
         LEFT JOIN stock_documents d ON m.docId = d.id
         LEFT JOIN warehouses w ON m.warehouseId = w.id
         WHERE m.serialNo = ?
         ORDER BY m.createdAt ASC`,
        [serialNo]
      );
      res.json({ ...row, timeline });
    } catch (error) {
      console.error('Error fetching serial:', error);
      res.status(500).json({ error: 'Failed to fetch serial' });
    }
  });

  // PATCH /serials/:serialNo/status - TP workflow (audit via notes required for exceptions)
  router.patch('/serials/:serialNo/status', async (req, res) => {
    try {
      if (!canManageSerials(req)) return res.status(403).json({ error: 'Forbidden' });
      const serialNo = String(req.params.serialNo || '');
      const row = await db.get('SELECT * FROM serials WHERE serialNo = ?', [serialNo]);
      if (!row) return res.status(404).json({ error: 'Serial not found' });
      const { status, notes, customerRef } = req.body;
      if (!VALID_SERIAL_STATUS.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_SERIAL_STATUS.join(', ')}` });
      }
      if (['WARRANTY', 'DAMAGED', 'LOST'].includes(status) && (!notes || !String(notes).trim())) {
        return res.status(400).json({ error: 'notes is required for exception statuses' });
      }
      await db.run(
        `UPDATE serials SET status = ?, notes = ?, customerRef = ?, updatedAt = ? WHERE serialNo = ?`,
        [status, notes !== undefined ? notes : row.notes,
         customerRef !== undefined ? customerRef : row.customerRef,
         new Date().toISOString(), serialNo]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating serial status:', error);
      res.status(500).json({ error: 'Failed to update serial status' });
    }
  });

  // POST /documents/:docId/lines/:lineId/serials - register (RECEIPT) or assign (ISSUE)
  router.post('/documents/:docId/lines/:lineId/serials', async (req, res) => {
    try {
      const user = (req.user || {}) as any;
      const userId = user.id;
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [req.params.docId]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      const isManager = canManageSerials(req);
      const involved = doc.requesterId === userId || doc.assigneeId === userId
        || doc.receiverId === userId || doc.createdBy === userId;
      if (!isManager && !involved) return res.status(403).json({ error: 'Forbidden' });

      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND docId = ?', [req.params.lineId, doc.id]);
      if (!line) return res.status(404).json({ error: 'Line not found' });
      const product: any = await db.get('SELECT * FROM stock_products WHERE id = ?', [line.productId]);
      if (!product || product.tracking !== 'SERIAL') {
        return res.status(400).json({ error: 'Product is not SERIAL-tracked' });
      }
      const { serials = [], lotId } = req.body;
      if (!Array.isArray(serials) || serials.length === 0) {
        return res.status(400).json({ error: 'serials array is required' });
      }
      const clean = [...new Set(serials.map((s: any) => String(s).trim()).filter(Boolean))];
      if (clean.length === 0) return res.status(400).json({ error: 'serials array is required' });
      if (clean.length > 500) return res.status(400).json({ error: 'Max 500 serials per request' });

      if (doc.type === 'RECEIPT') {
        if (!['CONFIRMED', 'RECEIVING'].includes(doc.status)) {
          return res.status(400).json({ error: `Cannot register serials on a ${doc.status} receipt` });
        }
        let lotCode: string | null = null;
        if (lotId) {
          const lot = await db.get('SELECT id, lotCode, productId FROM lots WHERE id = ?', [lotId]);
          if (!lot) return res.status(400).json({ error: 'Lot not found' });
          if (lot.productId !== line.productId) {
            return res.status(400).json({ error: 'Lot belongs to a different product' });
          }
          lotCode = lot.lotCode;
        }
        const dupes: any = await db.all(
          `SELECT serialNo FROM serials WHERE serialNo IN (${clean.map(() => '?').join(',')})`,
          clean
        );
        if (dupes.length > 0) {
          return res.status(400).json({
            error: `Serials already registered: ${dupes.map((d: any) => d.serialNo).join(', ')}`,
          });
        }
        const today = new Date().toISOString().slice(0, 10);
        const wEnd = warrantyEnd(today, product.warrantyMonths);
        const now = new Date().toISOString();
        for (const sn of clean) {
          await db.run(
            `INSERT INTO serials
             (id, serialNo, productId, productCode, productName, lotId, status,
              warehouseId, locationId, receiptDocId, receiptLineId,
              warrantyStart, warrantyEnd, createdBy, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, 'IN_STOCK', ?, ?, ?, ?, ?, ?, ?, ?)`,
            [randomUUID(), sn, line.productId, line.productCode, line.productName,
             lotId || null, doc.warehouseId, line.locationId || null, doc.id, line.id,
             today, wEnd, userId, now]
          );
          await db.run(
            `INSERT INTO stock_moves
             (id, productId, productCode, warehouseId, locationId, serialNo, qty, moveType, docId, lineId, createdBy, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, 0, 'SERIAL_REGISTER', ?, ?, ?, ?)`,
            [randomUUID(), line.productId, line.productCode, doc.warehouseId, line.locationId || null,
             sn, doc.id, line.id, userId, now]
          );
          void lotCode;
        }
        return res.json({ success: true, registered: clean.length });
      }

      if (doc.type === 'ISSUE') {
        if (!['CONFIRMED', 'PICKING', 'READY'].includes(doc.status)) {
          return res.status(400).json({ error: `Cannot assign serials on a ${doc.status} issue` });
        }
        const rows: any = await db.all(
          `SELECT serialNo FROM serials WHERE serialNo IN (${clean.map(() => '?').join(',')})`,
          clean
        );
        const found = new Map(rows.map((r: any) => [r.serialNo, r]));
        const missing = clean.filter((sn) => !found.has(sn));
        if (missing.length > 0) {
          return res.status(400).json({ error: `Serials not in stock: ${missing.join(', ')}` });
        }
        const full: any = await db.all(
          `SELECT serialNo, status, warehouseId FROM serials WHERE serialNo IN (${clean.map(() => '?').join(',')})`,
          clean
        );
        const bad = full.filter((r: any) => r.status !== 'IN_STOCK' || r.warehouseId !== doc.warehouseId);
        if (bad.length > 0) {
          return res.status(400).json({
            error: `Serials not available at this warehouse: ${bad.map((r: any) => r.serialNo).join(', ')}`,
          });
        }
        const already: any = await db.all(
          `SELECT serialNo FROM serials WHERE serialNo IN (${clean.map(() => '?').join(',')}) AND issueLineId IS NOT NULL AND issueLineId != ?`,
          [...clean, line.id]
        );
        if (already.length > 0) {
          return res.status(400).json({
            error: `Serials already assigned elsewhere: ${already.map((r: any) => r.serialNo).join(', ')}`,
          });
        }
        for (const sn of clean) {
          await db.run(
            `UPDATE serials SET status = 'RESERVED', issueDocId = ?, issueLineId = ?, updatedAt = ? WHERE serialNo = ?`,
            [doc.id, line.id, new Date().toISOString(), sn]
          );
        }
        return res.json({ success: true, assigned: clean.length });
      }

      return res.status(400).json({ error: 'Serials only apply to RECEIPT and ISSUE documents' });
    } catch (error) {
      console.error('Error handling document serials:', error);
      res.status(500).json({ error: 'Failed to handle serials' });
    }
  });

  return router;
}
