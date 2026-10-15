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
      const page = paginationOf(req.query as Record<string, string | undefined>);
      query += ' LIMIT ? OFFSET ?';
      params.push(page.limit, page.offset);
      res.json(await db.all(query, params));
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch stock balances' }); }
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
