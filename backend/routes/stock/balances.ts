import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import type { StockContext } from './context.js';

export function balancesRoutes(ctx: StockContext) {
  const { db, listScope, isDirector, paginationOf } = ctx;
  const router = Router();
  // ── Tồn kho (đọc) ─────────────────────────────────────────────────────────

  router.get('/balances', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { warehouseId, q, purpose } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }
      let query = `SELECT b.productId, b.warehouseId, b.locationId, b.onHand, b.reserved,
          CASE WHEN b.locationId = '' OR (l.isActive = 1 AND l.purpose = 'SALEABLE') THEN b.onHand - b.reserved ELSE 0 END AS available,
          p.name AS productName, p.importCode AS productCode, w.code AS warehouseCode, w.name AS warehouseName,
          l.code AS locationCode, l.purpose AS locationPurpose
        FROM stock_balances b
        LEFT JOIN products p ON p.id = b.productId
        LEFT JOIN warehouses w ON w.id = b.warehouseId
        LEFT JOIN stock_locations l ON l.id = b.locationId
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND b.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND b.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      if (q?.trim()) { query += ' AND (p.name LIKE ? OR b.productId LIKE ? OR p.importCode LIKE ?)'; params.push(`%${q.trim()}%`, `%${q.trim()}%`, `%${q.trim()}%`); }
      if (purpose?.trim()) { query += ' AND l.purpose = ?'; params.push(purpose.trim()); }
      query += ' ORDER BY w.name ASC, p.name ASC';
      const page = paginationOf(req.query as Record<string, string | undefined>);
      query += ' LIMIT ? OFFSET ?';
      params.push(page.limit, page.offset);
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock balances' }); }
  });

  // Tồn khả dụng đã gom theo sản phẩm + kho. Dùng cho trang Xuất kho;
  // không lấy products.remainingQuantity làm nguồn tồn.
  router.get('/available-inventory', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const { warehouseId, q, tracking, onlyAvailable } = req.query as Record<string, string | undefined>;
      if (!isDirector(user)) {
        if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
        if (!warehouseId && scope.length === 0) return res.json([]);
      }

      let query = `SELECT b.productId, b.warehouseId,
          SUM(b.onHand) AS onHand, SUM(b.reserved) AS reserved,
          SUM(CASE WHEN b.locationId = '' OR (l.isActive = 1 AND l.purpose = 'SALEABLE')
            THEN b.onHand - b.reserved ELSE 0 END) AS available,
          p.name AS productName, p.importCode AS productCode, p.unit, p.category, p.origin, p.tracking,
          w.code AS warehouseCode, w.name AS warehouseName
        FROM stock_balances b
        LEFT JOIN products p ON p.id = b.productId
        LEFT JOIN warehouses w ON w.id = b.warehouseId
        LEFT JOIN stock_locations l ON l.id = b.locationId
        WHERE 1=1`;
      const params: any[] = [];
      if (warehouseId) { query += ' AND b.warehouseId = ?'; params.push(warehouseId); }
      else if (!isDirector(user)) { query += ` AND b.warehouseId IN (${scope.map(() => '?').join(', ')})`; params.push(...scope); }
      if (tracking?.trim()) { query += ' AND p.tracking = ?'; params.push(tracking.trim().toUpperCase()); }
      if (q?.trim()) {
        const term = `%${q.trim()}%`;
        query += ` AND (p.name LIKE ? OR p.id LIKE ? OR p.importCode LIKE ? OR p.origin LIKE ? OR p.category LIKE ?
          OR EXISTS (SELECT 1 FROM stock_serials ss WHERE ss.productId = b.productId AND ss.warehouseId = b.warehouseId AND ss.serialNumber LIKE ?))`;
        params.push(term, term, term, term, term, term);
      }
      const groupBy = ' GROUP BY b.productId, b.warehouseId, p.name, p.importCode, p.unit, p.category, p.origin, p.tracking, w.code, w.name';
      query += groupBy;
      if (onlyAvailable !== 'false') query += ' HAVING available > 0';
      const totalRows = await db.get(`SELECT COUNT(*) AS total FROM (${query}) AS inventory_rows`, params);
      query += ' ORDER BY w.name ASC, p.name ASC';
      const page = paginationOf(req.query as Record<string, string | undefined>);
      query += ' LIMIT ? OFFSET ?';
      params.push(page.limit, page.offset);
      res.setHeader('X-Total-Count', String(Number(totalRows?.total || 0)));
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch available inventory' }); }
  });

  router.get('/inventory/:productId/:warehouseId/details', async (req, res) => {
    try {
      const user = req.user;
      const productId = String(req.params.productId);
      const warehouseId = String(req.params.warehouseId);
      const scope = await listScope(user);
      if (!isDirector(user) && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const product = await db.get('SELECT id, name, importCode, unit, category, origin, tracking FROM products WHERE id = ?', [productId]);
      const warehouse = await db.get('SELECT id, code, name FROM warehouses WHERE id = ?', [warehouseId]);
      if (!product || !warehouse) return res.status(404).json({ error: 'Không tìm thấy sản phẩm hoặc kho' });
      const summary = await db.get(
        `SELECT COALESCE(SUM(onHand), 0) AS onHand, COALESCE(SUM(reserved), 0) AS reserved,
          COALESCE(SUM(CASE WHEN locationId = '' OR locationId IS NULL THEN onHand - reserved ELSE 0 END), 0) AS available
         FROM stock_balances WHERE productId = ? AND warehouseId = ?`,
        [productId, warehouseId]
      );
      const serials = await db.all(
        `SELECT s.id, s.serialNumber, s.stockStatus, s.status, s.warehouseId, s.receivedAt, s.outDate,
                s.supplier, s.receiptDocumentId, s.receiptLineId, s.issueDocumentId, s.issueLineId,
                rd.code AS receiptCode, rd.partnerName AS receiptPartnerName,
                idoc.code AS issueCode, idoc.partnerName AS issuePartnerName
         FROM stock_serials s
         LEFT JOIN stock_documents rd ON rd.id = s.receiptDocumentId
         LEFT JOIN stock_documents idoc ON idoc.id = s.issueDocumentId
         WHERE s.productId = ? AND s.warehouseId = ?
         ORDER BY s.receivedAt DESC, s.createdAt DESC`,
        [productId, warehouseId]
      );
      const lots = await db.all(
        `SELECT l.id, l.lotCode, l.coilCode, l.initialQty, l.remainingQty, l.unit,
                l.createdAt AS receivedAt, l.supplier, l.receiptDocumentId, l.receiptLineId,
                d.code AS receiptCode, d.partnerName AS receiptPartnerName
         FROM stock_lots l
         LEFT JOIN stock_documents d ON d.id = l.receiptDocumentId
         WHERE l.productId = ? AND l.warehouseId = ?
         ORDER BY l.createdAt DESC`,
        [productId, warehouseId]
      );
      res.json({ product, warehouse, summary, serials, lots });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Không tải được chi tiết tồn kho' }); }
  });

  // ── Gợi ý đối tác / nhà cung cấp / diễn giải ──────────────────────────────

  router.get('/partner-suggestions', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      if (!isDirector(user) && scope.length === 0) {
        return res.json({ partners: [], deliverers: [], notes: [], addresses: [] });
      }

      let docSql = `SELECT partnerCode, partnerName, partnerAddress, deliverer, notes
         FROM stock_documents
         WHERE ((partnerCode IS NOT NULL AND partnerCode != '')
            OR (partnerName IS NOT NULL AND partnerName != '')
            OR (partnerAddress IS NOT NULL AND partnerAddress != '')
            OR (deliverer IS NOT NULL AND deliverer != '')
            OR (notes IS NOT NULL AND notes != ''))`;
      const docParams: any[] = [];
      if (!isDirector(user)) {
        docSql += ` AND (warehouseId IN (${scope.map(() => '?').join(', ')}) OR sourceWarehouseId IN (${scope.map(() => '?').join(', ')}) OR destWarehouseId IN (${scope.map(() => '?').join(', ')}))`;
        docParams.push(...scope, ...scope, ...scope);
      }
      docSql += ` ORDER BY updatedAt DESC, createdAt DESC LIMIT 500`;
      const docRows = await db.all(docSql, docParams).catch(() => []);

      const clientRows = await db.all('SELECT name, region FROM clients LIMIT 500').catch(() => []);
      const contractRows = await db.all('SELECT DISTINCT supplierName, clientName FROM contracts LIMIT 500').catch(() => []);
      const projectRows = await db.all('SELECT DISTINCT clientName, investor FROM projects LIMIT 500').catch(() => []);

      const partnerMap = new Map<string, { id: string; code: string; name: string; address?: string; deliverer?: string }>();
      const delivererSet = new Set<string>();
      const noteSet = new Set<string>();
      const addressSet = new Set<string>();

      let counter = 1;

      for (const r of docRows) {
        const code = (r.partnerCode || '').trim();
        const name = (r.partnerName || '').trim();
        const address = (r.partnerAddress || '').trim();
        const deliverer = (r.deliverer || '').trim();
        const note = (r.notes || '').trim();

        if (deliverer) delivererSet.add(deliverer);
        if (note) noteSet.add(note);
        if (address) addressSet.add(address);

        if (name || code) {
          const key = name ? 'name:' + name.toLowerCase() : 'code:' + code.toLowerCase();
          if (!partnerMap.has(key)) {
            partnerMap.set(key, { id: `doc-${counter++}`, code, name, address, deliverer });
          } else {
            const existing = partnerMap.get(key)!;
            if (!existing.code && code) existing.code = code;
            if (!existing.name && name) existing.name = name;
            if (!existing.address && address) existing.address = address;
            if (!existing.deliverer && deliverer) existing.deliverer = deliverer;
          }
        }
      }

      for (const r of clientRows) {
        const name = (r.name || '').trim();
        const address = (r.region || '').trim();
        if (address) addressSet.add(address);
        if (name) {
          const key = 'name:' + name.toLowerCase();
          if (!partnerMap.has(key)) {
            partnerMap.set(key, { id: `client-${counter++}`, code: '', name, address, deliverer: '' });
          } else {
            const existing = partnerMap.get(key)!;
            if (!existing.address && address) existing.address = address;
          }
        }
      }

      for (const r of contractRows) {
        for (const rawName of [r.supplierName, r.clientName]) {
          const n = (rawName || '').trim();
          if (n) {
            const key = 'name:' + n.toLowerCase();
            if (!partnerMap.has(key)) {
              partnerMap.set(key, { id: `contract-${counter++}`, code: '', name: n, address: '', deliverer: '' });
            }
          }
        }
      }

      for (const r of projectRows) {
        for (const rawName of [r.clientName, r.investor]) {
          const n = (rawName || '').trim();
          if (n) {
            const key = 'name:' + n.toLowerCase();
            if (!partnerMap.has(key)) {
              partnerMap.set(key, { id: `project-${counter++}`, code: '', name: n, address: '', deliverer: '' });
            }
          }
        }
      }

      res.json({
        partners: Array.from(partnerMap.values()).slice(0, 500),
        deliverers: Array.from(delivererSet).slice(0, 200),
        notes: Array.from(noteSet).slice(0, 200),
        addresses: Array.from(addressSet).slice(0, 200),
      });
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch partner suggestions' });
    }
  });
  return router;
}
