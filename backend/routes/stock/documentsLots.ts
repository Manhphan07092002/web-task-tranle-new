import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import type { DocumentContext } from './documentContext.js';

/** Phân bổ / đăng ký lô (cuộn, mã lô) cho từng dòng phiếu. */
export function documentsLotsRoutes(d: DocumentContext) {
  const { db, canWriteDocument, parseSerials, productTrackings, touchProcessing, lotModeOf } = d;
  const router = Router();
  router.post('/lots/allocate', validate(z.object({
    documentId: z.string().trim().min(1).max(191),
    documentLineId: z.string().trim().min(1).max(191),
    lotCode: z.string().trim().min(1).max(191),
    quantity: z.number().finite().positive().max(1_000_000_000),
  })), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, documentLineId, lotCode, quantity } = req.body;
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      if (!doc || (doc.docType !== 'ISSUE' && doc.docType !== 'TRANSFER')) return res.status(404).json({ error: 'Issue or transfer not found' });
      const allocationWarehouseId = doc.docType === 'TRANSFER' ? doc.sourceWarehouseId : doc.warehouseId;
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft issues/transfers can be processed' });
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND documentId = ?', [documentLineId, documentId]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      if ((await productTrackings([line.productId])).get(line.productId) !== 'LOT') {
        return res.status(400).json({ error: 'Sản phẩm không quản lý theo Lô/Cuộn' });
      }
      if (line.lotIssueMode === 'LOOSE' || (await lotModeOf(line.productId, allocationWarehouseId)) === 'LOOSE') {
        return res.status(409).json({
          error: 'Mã hàng đã được xác nhận xuất lẻ; không thể phân bổ lô. Hãy đặt lại xử lý nếu muốn xuất theo lô.',
          code: 'LOT_MODE_BROKEN',
        });
      }

      await beginStockTransaction(db, [allocationWarehouseId]);
      transactionOpen = true;
      try {
        const lot = await db.get(
          `SELECT * FROM stock_lots
           WHERE lotCode = ? AND productId = ? AND warehouseId = ? AND status IN ('ACTIVE', 'DEPLETED')
           LIMIT 1 FOR UPDATE`,
          [lotCode, line.productId, allocationWarehouseId]
        );
        if (!lot) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(404).json({ error: `Không tìm thấy lô ${lotCode} trong kho` });
        }
        const existing = await db.get(
          'SELECT quantity FROM stock_document_line_lots WHERE documentLineId = ? AND lotId = ? FOR UPDATE',
          [documentLineId, lot.id]
        );
        const totalRow = await db.get(
          'SELECT COALESCE(SUM(quantity), 0) AS total FROM stock_document_line_lots WHERE documentLineId = ?',
          [documentLineId]
        );
        const oldQty = Number(existing?.quantity || 0);
        const total = Number(totalRow?.total || 0);
        const nextTotal = total + Number(quantity);
        if (nextTotal > Number(line.quantity)) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: `Dòng chỉ yêu cầu ${Number(line.quantity)}, đã phân bổ ${total}` });
        }
        if (Number(lot.remainingQty || 0) - oldQty < Number(quantity)) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: `Lô ${lotCode} chỉ còn ${Number(lot.remainingQty || 0)}, không đủ phân bổ ${Number(quantity)}` });
        }
        const now = new Date().toISOString();
        if (existing) {
          await db.run(
            'UPDATE stock_document_line_lots SET quantity = quantity + ?, createdBy = ?, createdAt = ? WHERE documentLineId = ? AND lotId = ?',
            [Number(quantity), user.id, now, documentLineId, lot.id]
          );
        } else {
          await db.run(
            `INSERT INTO stock_document_line_lots (id, documentLineId, lotId, quantity, createdBy, createdAt)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [randomUUID(), documentLineId, lot.id, Number(quantity), user.id, now]
          );
        }
        await db.run(
          `UPDATE stock_document_lines SET serialLot = ?, processingStatus = ?, lotIssueMode = 'LOT' WHERE id = ?`,
          [lotCode, nextTotal >= Number(line.quantity) ? 'COMPLETED' : 'PARTIAL', documentLineId]
        );
        await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ? AND status = \'DRAFT\'', ['PROCESSING', now, documentId]);
        await db.run('COMMIT'); transactionOpen = false;
        return res.status(201).json({ lotCode, allocated: nextTotal, required: Number(line.quantity), completed: nextTotal >= Number(line.quantity) });
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
    } catch (e: any) {
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to allocate lot' });
    } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/lots/register', validate(z.object({
    documentId: z.string().trim().min(1).max(191),
    documentLineId: z.string().trim().min(1).max(191),
    lotCode: z.string().trim().min(1).max(191),
    coilCode: z.string().trim().max(191).nullable().optional(),
    quantity: z.number().finite().positive().max(1_000_000_000),
    unit: z.string().trim().max(32).nullable().optional(),
    manufacturedAt: z.string().trim().max(40).nullable().optional(),
    supplier: z.string().trim().max(300).nullable().optional(),
  })), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, documentLineId, lotCode, coilCode, quantity, unit, manufacturedAt, supplier } = req.body;
      const code = String(lotCode).trim();
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      if (!doc || doc.docType !== 'RECEIPT') return res.status(404).json({ error: 'Receipt not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft receipts can be processed' });
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND documentId = ?', [documentLineId, documentId]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      const trackings = await productTrackings([line.productId]);
      if (trackings.get(line.productId) !== 'LOT') {
        return res.status(400).json({ error: 'Sản phẩm không quản lý theo Lô/Cuộn' });
      }
      const qty = Number(quantity);
      // Kho đang xuất lẻ: lô nhập chỉ lưu vết (RECORDED), không chọn để xuất.
      const receiptLoose = (await lotModeOf(line.productId, doc.warehouseId)) === 'LOOSE';
      await beginStockTransaction(db, [doc.warehouseId]);
      transactionOpen = true;
      try {
        const dup = await db.get(
          'SELECT id FROM stock_lots WHERE productId = ? AND warehouseId = ? AND lotCode = ? LIMIT 1',
          [line.productId, doc.warehouseId, code]
        );
        if (dup) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(409).json({ error: `Lô ${code} đã tồn tại trong kho` });
        }
        const coveredBefore = await db.get(
          'SELECT COALESCE(SUM(initialQty), 0) AS covered FROM stock_lots WHERE receiptDocumentId = ? AND receiptLineId = ?',
          [documentId, documentLineId]
        );
        if (Number(coveredBefore?.covered || 0) + qty > Number(line.quantity)) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: `Dòng chỉ yêu cầu ${Number(line.quantity)}, không thể đăng ký thêm ${qty}` });
        }
        const now = new Date().toISOString();
        const lotId = randomUUID();
        await db.run(
          `INSERT INTO stock_lots (id, productId, lotCode, coilCode, warehouseId, locationId, initialQty, remainingQty, unit, manufacturedAt, supplier, receiptDocumentId, receiptLineId, status, createdBy, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [lotId, line.productId, code, coilCode?.trim() || null, doc.warehouseId, line.locationId || null,
            qty, receiptLoose ? 0 : qty, unit?.trim() || null, manufacturedAt?.trim() || null,
            supplier?.trim() || doc.partnerName || null, documentId, documentLineId,
            receiptLoose ? 'RECORDED' : 'ACTIVE', user.id, now, now]
        );
        await db.run(
          `INSERT INTO stock_lot_movements (id, lotId, productId, warehouseId, quantity, moveType, referenceType, referenceId, documentLineId, createdBy, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, 'RECEIPT', ?, ?, ?, ?)`,
          [randomUUID(), lotId, line.productId, doc.warehouseId, qty,
            receiptLoose ? 'RECEIPT_RECORDED' : 'RECEIPT', documentId, documentLineId, user.id, now]
        );
        // Giữ text serialLot đồng bộ để luồng complete-time tương thích.
        const fresh = await db.get('SELECT serialLot FROM stock_document_lines WHERE id = ? FOR UPDATE', [documentLineId]);
        const existing = parseSerials(fresh?.serialLot);
        if (!existing.some((s) => s.toLowerCase() === code.toLowerCase())) {
          await db.run('UPDATE stock_document_lines SET serialLot = ? WHERE id = ?',
            [existing.length > 0 ? `${fresh.serialLot}\n${code}` : code, documentLineId]);
        }
        const covered = await db.all(
          'SELECT COALESCE(SUM(initialQty), 0) AS covered FROM stock_lots WHERE receiptDocumentId = ? AND receiptLineId = ?',
          [documentId, documentLineId]
        ).catch(() => []);
        const total = Number(covered?.[0]?.covered ?? 0);
        await db.run(
          `UPDATE stock_document_lines SET processingStatus = ? WHERE id = ?`,
          [total >= Number(line.quantity) ? 'COMPLETED' : 'PARTIAL', documentLineId]
        );
        await touchProcessing(documentId);
        await db.run('COMMIT'); transactionOpen = false;
        res.status(201).json({ lotId, lotCode: code, covered: total, required: Number(line.quantity), recorded: receiptLoose });
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to register lot' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  return router;
}
