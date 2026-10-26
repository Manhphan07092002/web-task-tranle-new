import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../../middleware/auth.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import { RelocationSchema } from './documentSchemas.js';
import type { DocumentContext } from './documentContext.js';

/** Chốt xử lý hàng hóa và GHI SỔ: sinh stock_moves + cập nhật balances. */
export function documentsPostingRoutes(d: DocumentContext) {
  const {
    db, requireWarehouse, canWriteDocument, assertLocation, saleableLocationSet, assertNotCounting, postMove,
    recordWarehouseActivity, docCode, loadDocument, aggregateLines, validateLines, availableMap, insufficientStockMessage,
    preflightPosting, loadIssueReservationLinks, reservationCreditFromLinks, consumeIssueReservationLinks,
    registerReceiptSerials, consumeIssueLots, consumeIssueSerials, assertTransferSerialsReady, receiveTransferSerials,
    consumeTransferLotsOnShip, receiveTransferLots, postDocumentMoves, postTransferMoves, registerReturnSerials,
    registerReturnLots,
  } = d;
  const router = Router();
  // Chốt bước kiểm tra hàng hóa, chưa ghi nhận nhập/xuất kho.
  // Bước ghi sổ thực tế vẫn nằm ở /receipts/:id/complete,
  // /issues/:id/complete hoặc /transfers/:id/ship.
  router.post('/documents/:id/processing-complete', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const pre = await loadDocument(String(req.params.id));
      if (!pre) return res.status(404).json({ error: 'Document not found' });
      if (!(await canWriteDocument(user, pre.doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (pre.doc.status === 'READY') return res.json({ success: true, status: 'READY', idempotent: true });
      if (pre.doc.status !== 'DRAFT' && pre.doc.status !== 'PROCESSING') {
        return res.status(400).json({ error: 'Phiếu không ở trạng thái có thể hoàn tất xử lý' });
      }
      await beginStockTransaction(db, [pre.doc.warehouseId || pre.doc.sourceWarehouseId].filter(Boolean) as string[]);
      transactionOpen = true;
      const loaded = await loadDocument(String(req.params.id), true);
      if (!loaded) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(404).json({ error: 'Document not found' }); }
      try {
        const reservationCredit = loaded.doc.docType === 'ISSUE'
          ? reservationCreditFromLinks(await loadIssueReservationLinks(loaded.doc.id))
          : undefined;
        await preflightPosting(
          loaded.doc,
          loaded.lines,
          loaded.doc.warehouseId || loaded.doc.sourceWarehouseId,
          reservationCredit
        );
      } catch (e: any) {
        await db.run('ROLLBACK'); transactionOpen = false;
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to validate document before posting' });
      }
      await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?', ['READY', new Date().toISOString(), loaded.doc.id]);
      await recordWarehouseActivity(db.run.bind(db), {
        actionType: 'PROCESSING_COMPLETED',
        entityType: 'DOCUMENT',
        entityId: loaded.doc.id,
        documentId: loaded.doc.id,
        documentCode: loaded.doc.code,
        warehouseId: loaded.doc.warehouseId || null,
        fromWarehouseId: loaded.doc.sourceWarehouseId || null,
        toWarehouseId: loaded.doc.destWarehouseId || null,
        userId: user.id,
        metadata: { lineCount: loaded.lines.length },
      });
      await db.run('COMMIT'); transactionOpen = false;
      return res.json({ success: true, status: 'READY' });
    } catch (e: any) {
      if (transactionOpen) await db.run('ROLLBACK');
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to complete processing' });
    }
  });
  router.post('/receipts/:id/complete', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const pre = await loadDocument(String(req.params.id));
      if (!pre || pre.doc.docType !== 'RECEIPT') return res.status(404).json({ error: 'Receipt not found' });
      await beginStockTransaction(db, [pre.doc.warehouseId]);
      transactionOpen = true;
      const loaded = await loadDocument(String(req.params.id), true);
      if (!loaded || loaded.doc.docType !== 'RECEIPT') return res.status(404).json({ error: 'Receipt not found' });
      const access = await requireWarehouse(user, loaded.doc.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (loaded.doc.status === 'DONE') return res.json({ success: true, idempotent: true, status: 'DONE' });
      if (loaded.doc.status !== 'READY') return res.status(400).json({ error: 'Phiếu nhập chưa qua bước xử lý hàng hóa. Vui lòng chuyển phiếu sang Sẵn sàng hoàn tất trước.' });
      const err = await validateLines(loaded.lines, loaded.doc.warehouseId);
      if (err) return res.status(400).json({ error: err });
      try {
        await preflightPosting(loaded.doc, loaded.lines, loaded.doc.warehouseId);
      } catch (e: any) {
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to validate document before posting' });
      }

      try {
        await registerReceiptSerials(loaded.doc, loaded.lines, user);
        await postDocumentMoves(loaded.doc, loaded.lines, 'RECEIPT', 1, user);
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
      const pre = await loadDocument(String(req.params.id));
      if (!pre || pre.doc.docType !== 'ISSUE') return res.status(404).json({ error: 'Issue not found' });
      await beginStockTransaction(db, [pre.doc.warehouseId]);
      transactionOpen = true;
      const loaded = await loadDocument(String(req.params.id), true);
      if (!loaded || loaded.doc.docType !== 'ISSUE') return res.status(404).json({ error: 'Issue not found' });
      const access = await requireWarehouse(user, loaded.doc.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (loaded.doc.status === 'DONE') return res.json({ success: true, idempotent: true, status: 'DONE' });
      if (loaded.doc.status !== 'READY') return res.status(400).json({ error: 'Phiếu xuất chưa qua bước xử lý hàng hóa. Vui lòng chuyển phiếu sang Sẵn sàng hoàn tất trước.' });
      const err = await validateLines(loaded.lines, loaded.doc.warehouseId);
      if (err) return res.status(400).json({ error: err });
      const reservationLinks = await loadIssueReservationLinks(loaded.doc.id);
      const reservedForIssue = reservationCreditFromLinks(reservationLinks);
      try {
        await preflightPosting(loaded.doc, loaded.lines, loaded.doc.warehouseId, reservedForIssue);
      } catch (e: any) {
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to validate document before posting' });
      }

      const agg = aggregateLines(loaded.lines);
      const saleable = await saleableLocationSet(loaded.doc.warehouseId, agg.map((l) => l.locationId || ''));
      for (const line of agg) {
        if (!saleable.has(line.locationId || '')) return res.status(400).json({ error: `Vị trí ${line.locationId} không phải vị trí được phép xuất hàng. Vui lòng chọn vị trí bán được.` });
      }
      const avail = await availableMap(loaded.doc.warehouseId, agg.map((l) => ({ productId: l.productId, locationId: l.locationId || '' })));
      for (const line of agg) {
        const key = `${line.productId}|${line.locationId || ''}`;
        const availableHere = (avail.get(key) ?? 0) + (reservedForIssue.get(key) ?? 0);
        if (availableHere < Number(line.quantity)) {
          return res.status(400).json({ error: await insufficientStockMessage(loaded.doc.warehouseId, line, availableHere) });
        }
      }

      try {
        const lotPostings = await consumeIssueLots(loaded.doc, loaded.lines, user);
        await consumeIssueSerials(loaded.doc, loaded.lines, user);
        await consumeIssueReservationLinks(loaded.doc, reservationLinks);
        await postDocumentMoves(loaded.doc, loaded.lines, 'ISSUE', -1, user, lotPostings);
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

  router.post('/returns/:id/complete', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const pre = await loadDocument(String(req.params.id));
      if (!pre || pre.doc.docType !== 'RETURN') return res.status(404).json({ error: 'Return not found' });
      await beginStockTransaction(db, [pre.doc.warehouseId]);
      transactionOpen = true;
      const loaded = await loadDocument(String(req.params.id), true);
      if (!loaded || loaded.doc.docType !== 'RETURN') return res.status(404).json({ error: 'Return not found' });
      const access = await requireWarehouse(user, loaded.doc.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (loaded.doc.status === 'DONE') return res.json({ success: true, idempotent: true, status: 'DONE' });
      if (loaded.doc.status !== 'READY') return res.status(400).json({ error: 'Phiếu trả hàng chưa qua bước xử lý hàng hóa. Vui lòng chuyển phiếu sang Sẵn sàng hoàn tất trước.' });
      const err = await validateLines(loaded.lines, loaded.doc.warehouseId);
      if (err) return res.status(400).json({ error: err });
      try {
        await preflightPosting(loaded.doc, loaded.lines, loaded.doc.warehouseId);
      } catch (e: any) {
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to validate document before posting' });
      }

      try {
        await registerReturnSerials(loaded.doc, loaded.lines, user);
        const returnLots = await registerReturnLots(loaded.doc, loaded.lines, user);
        await postDocumentMoves(loaded.doc, loaded.lines, 'RETURN', 1, user, returnLots);
        await db.run('UPDATE stock_documents SET status = ?, updatedAt = ? WHERE id = ?', ['DONE', new Date().toISOString(), loaded.doc.id]);
        await db.run('COMMIT'); transactionOpen = false;
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to complete return' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/transfers/:id/ship', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const pre = await loadDocument(String(req.params.id));
      if (!pre || pre.doc.docType !== 'TRANSFER') return res.status(404).json({ error: 'Transfer not found' });
      await beginStockTransaction(db, [pre.doc.sourceWarehouseId, pre.doc.destWarehouseId]);
      transactionOpen = true;
      const loaded = await loadDocument(String(req.params.id), true);
      if (!loaded || loaded.doc.docType !== 'TRANSFER') return res.status(404).json({ error: 'Transfer not found' });
      const from = await requireWarehouse(user, loaded.doc.sourceWarehouseId);
      const to = await requireWarehouse(user, loaded.doc.destWarehouseId);
      if (!from.ok || !to.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (loaded.doc.status === 'DONE') return res.json({ success: true, idempotent: true, status: 'DONE' });
      if (loaded.doc.status !== 'READY') return res.status(400).json({ error: 'Phiếu điều chuyển chưa qua bước xử lý hàng hóa. Vui lòng chuyển phiếu sang Sẵn sàng hoàn tất trước.' });
      const err = await validateLines(loaded.lines, loaded.doc.sourceWarehouseId);
      if (err) return res.status(400).json({ error: err });
      try {
        await preflightPosting(loaded.doc, loaded.lines, loaded.doc.sourceWarehouseId);
        await assertTransferSerialsReady(loaded.doc, loaded.lines);
      } catch (e: any) {
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to validate document before posting' });
      }
      const agg = aggregateLines(loaded.lines);
      const avail = await availableMap(loaded.doc.sourceWarehouseId, agg.map((l) => ({ productId: l.productId, locationId: l.locationId || '' })));
      for (const line of agg) {
        if ((avail.get(`${line.productId}|${line.locationId || ''}`) ?? 0) < Number(line.quantity)) {
          return res.status(400).json({ error: await insufficientStockMessage(loaded.doc.sourceWarehouseId, line, avail.get(`${line.productId}|${line.locationId || ''}`) ?? 0) });
        }
      }

      try {
        await consumeTransferLotsOnShip(loaded.doc, loaded.lines, user);
        await postTransferMoves(loaded.doc, loaded.lines, 'OUT', '', user);
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
      const pre = await loadDocument(String(req.params.id));
      if (!pre || pre.doc.docType !== 'TRANSFER') return res.status(404).json({ error: 'Transfer not found' });
      await beginStockTransaction(db, [pre.doc.destWarehouseId]);
      transactionOpen = true;
      const loaded = await loadDocument(String(req.params.id), true);
      if (!loaded || loaded.doc.docType !== 'TRANSFER') return res.status(404).json({ error: 'Transfer not found' });
      const destinationLocation = req.body.locationId || '';
      const to = await requireWarehouse(user, loaded.doc.destWarehouseId);
      if (!to.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (loaded.doc.status === 'DONE') return res.json({ success: true, idempotent: true, status: 'DONE' });
      if (loaded.doc.status !== 'IN_TRANSIT') return res.status(400).json({ error: 'Only in-transit transfers can be received' });
      if (!(await assertLocation(loaded.doc.destWarehouseId, destinationLocation))) return res.status(400).json({ error: 'Invalid destination location' });
      try {
        await preflightPosting(loaded.doc, loaded.lines, loaded.doc.destWarehouseId);
      } catch (e: any) {
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to validate document before posting' });
      }

      try {
        await receiveTransferSerials(loaded.doc, destinationLocation);
        await receiveTransferLots(loaded.doc, loaded.lines, destinationLocation, user);
        await postTransferMoves(loaded.doc, loaded.lines, 'IN', destinationLocation, user);
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
  router.post('/relocations', validate(RelocationSchema), async (req, res) => {
    let transactionOpen = false;
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (normalizeManagementLevel(user.managementLevel) === MANAGEMENT_LEVELS.ADMIN) {
        return res.status(403).json({ error: 'Admin cannot perform stock operations' });
      }
      const { warehouseId, productId, fromLocationId, toLocationId, quantity, notes } = req.body;
      if (fromLocationId === toLocationId) {
        return res.status(400).json({ error: 'Vị trí nguồn và vị trí đích phải khác nhau' });
      }

      const access = await requireWarehouse(user, warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });

      await beginStockTransaction(db, [warehouseId]);
      transactionOpen = true;

      // Đọc lại trong transaction — check available ngoài lock là TOCTOU.
      const [fromLoc, toLoc] = await Promise.all([
        db.get('SELECT * FROM stock_locations WHERE id = ? AND warehouseId = ? AND isActive = 1', [fromLocationId, warehouseId]),
        db.get('SELECT * FROM stock_locations WHERE id = ? AND warehouseId = ? AND isActive = 1', [toLocationId, warehouseId]),
      ]);
      if (!fromLoc) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(400).json({ error: 'Vị trí nguồn không hợp lệ hoặc đã khóa' }); }
      if (!toLoc) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(400).json({ error: 'Vị trí đích không hợp lệ hoặc đã khóa' }); }

      try {
        await assertNotCounting(warehouseId);
      } catch (e: any) {
        await db.run('ROLLBACK'); transactionOpen = false;
        return res.status(e.status || 409).json({ error: e.status ? e.message : 'Failed to check counting state' });
      }

      const fromBal = await db.get(
        'SELECT onHand, reserved FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ? FOR UPDATE',
        [productId, warehouseId, fromLocationId]
      );
      const onHand = Number(fromBal?.onHand ?? 0);
      const reserved = Number(fromBal?.reserved ?? 0);
      const available = onHand - reserved;
      if (available < quantity) {
        await db.run('ROLLBACK'); transactionOpen = false;
        return res.status(400).json({
          error: `Số lượng khả dụng tại vị trí ${fromLoc.name || fromLoc.code} không đủ (${available} < ${quantity})`,
        });
      }

      const code = docCode('DCV');

      await postMove(db.run.bind(db), {
        productId,
        warehouseId,
        locationId: fromLocationId,
        quantity: -quantity,
        moveType: 'INTERNAL_MOVE',
        referenceType: 'RELOCATION',
        referenceId: code,
        documentLineId: null,
        createdBy: user.id,
      });

      await postMove(db.run.bind(db), {
        productId,
        warehouseId,
        locationId: toLocationId,
        quantity: quantity,
        moveType: 'INTERNAL_MOVE',
        referenceType: 'RELOCATION',
        referenceId: code,
        documentLineId: null,
        createdBy: user.id,
      });

      await db.run('COMMIT');
      transactionOpen = false;

      res.status(201).json({ success: true, code, message: 'Điều chuyển vị trí nội bộ thành công' });
    } catch (e: any) {
      if (transactionOpen) await db.run('ROLLBACK');
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Lỗi khi điều chuyển vị trí' });
    } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  return router;
}
