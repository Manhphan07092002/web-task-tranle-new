import { Router } from 'express';
import { resolveTracking } from '../../utils/tracking.js';
import type { StockContext } from './context.js';

/** Trạng thái Lô/Xuất lẻ theo (sản phẩm, kho) và xác nhận xuất lẻ cho phiếu xuất.
 * Xuất lẻ phá lô TOÀN BỘ mã hàng trong kho; việc phá lô thật sự diễn ra khi
 * hoàn tất phiếu, nên hủy phiếu nháp không làm mất lô. */
export function lotTrackingRoutes(ctx: StockContext) {
  const { db, requireWarehouse, canWriteDocument, lotModeOf } = ctx;
  const router = Router();

  router.get('/lot-tracking/:productId/:warehouseId', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const productId = String(req.params.productId);
      const warehouseId = String(req.params.warehouseId);
      const access = await requireWarehouse(user, warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const tracking = await db.get(
        'SELECT * FROM stock_lot_tracking WHERE productId = ? AND warehouseId = ?',
        [productId, warehouseId]
      ).catch(() => undefined);
      const lots = await db.all(
        `SELECT id, lotCode, coilCode, initialQty, remainingQty, unit, status
         FROM stock_lots WHERE productId = ? AND warehouseId = ? ORDER BY createdAt ASC, id ASC`,
        [productId, warehouseId]
      ).catch(() => []);
      const balance = await db.get(
        'SELECT COALESCE(SUM(onHand), 0) AS onHand FROM stock_balances WHERE productId = ? AND warehouseId = ?',
        [productId, warehouseId]
      ).catch(() => undefined);
      const affected = (lots || []).filter((lot: any) => Number(lot.remainingQty || 0) > 0);
      res.json({
        productId, warehouseId,
        mode: tracking?.mode === 'LOOSE' ? 'LOOSE' : 'LOT',
        brokenAt: tracking?.brokenAt ?? null,
        brokenBy: tracking?.brokenBy ?? null,
        breakDocumentId: tracking?.breakDocumentId ?? null,
        breakReason: tracking?.breakReason ?? null,
        resetAt: tracking?.resetAt ?? null,
        onHand: Number(balance?.onHand ?? 0),
        lots: affected,
        affectedQuantity: affected.reduce((sum: number, lot: any) => sum + Number(lot.remainingQty || 0), 0),
        recordedLots: (lots || []).filter((lot: any) => lot.status === 'RECORDED'),
      });
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch lot tracking' });
    }
  });

  router.post('/lines/:id/confirm-loose-lot', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ?', [String(req.params.id)]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [line.documentId]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (doc.docType !== 'ISSUE') {
        return res.status(400).json({ error: 'Chỉ phiếu xuất mới hỗ trợ xuất lẻ theo số lượng.' });
      }
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') {
        return res.status(400).json({ error: 'Only draft issues can be processed' });
      }
      const product = await db.get('SELECT tracking FROM products WHERE id = ?', [line.productId]).catch(() => undefined);
      if (resolveTracking(product?.tracking) !== 'LOT') {
        return res.status(400).json({ error: 'Sản phẩm không quản lý theo Lô/Cuộn' });
      }

      const productLines = await db.all(
        'SELECT id FROM stock_document_lines WHERE documentId = ? AND productId = ?',
        [doc.id, line.productId]
      );
      const lineIds = (productLines || []).map((row: any) => row.id);
      const allocated = lineIds.length > 0
        ? await db.get(
          `SELECT a.id FROM stock_document_line_lots a
           WHERE a.documentLineId IN (${lineIds.map(() => '?').join(', ')}) LIMIT 1`,
          lineIds
        ).catch(() => undefined)
        : undefined;
      if (allocated) {
        return res.status(409).json({ error: 'Dòng hàng đã phân bổ lô — đặt lại xử lý trước khi chuyển sang xuất lẻ.' });
      }

      const mode = await lotModeOf(line.productId, doc.warehouseId);
      const affectedLots = mode === 'LOOSE' ? [] : await db.all(
        `SELECT id, lotCode, remainingQty FROM stock_lots
         WHERE productId = ? AND warehouseId = ? AND remainingQty > 0
         ORDER BY createdAt ASC, id ASC`,
        [line.productId, doc.warehouseId]
      ).catch(() => []);
      const now = new Date().toISOString();
      await db.run(
        `UPDATE stock_document_lines
         SET lotIssueMode = 'LOOSE', processingStatus = 'COMPLETED'
         WHERE documentId = ? AND productId = ?`,
        [doc.id, line.productId]
      );
      await db.run(
        `UPDATE stock_documents SET status = 'PROCESSING', updatedAt = ? WHERE id = ? AND status = 'DRAFT'`,
        [now, doc.id]
      );
      return res.json({
        success: true,
        alreadyBroken: mode === 'LOOSE',
        mode: 'LOOSE',
        lineIds,
        lots: affectedLots || [],
        quantity: (affectedLots || []).reduce((sum: number, lot: any) => sum + Number(lot.remainingQty || 0), 0),
      });
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to confirm loose lot issue' });
    }
  });

  return router;
}
