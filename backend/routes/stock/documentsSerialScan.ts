import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import { ScanSchema, SerialEditSchema, SmartScanSchema } from './documentSchemas.js';
import type { DocumentContext } from './documentContext.js';

/** Quét Serial theo dòng phiếu + tiến độ xử lý + xác nhận số lượng. */
export function documentsSerialScanRoutes(d: DocumentContext) {
  const {
    db, canReadDocument, canWriteDocument, recordWarehouseActivity, parseSerials, appendLineSerial,
    touchProcessing, refreshProcessingAfterSerialScan,
  } = d;
  const router = Router();
  // ── Quét Serial theo dòng phiếu ────────────────────────────────────────────
  // Nguồn sự thật duy nhất vẫn là ô serialLot của dòng (complete-time registration
  // ghi bảng serials). Scan API validate + nối mã vào serialLot + cập nhật
  // processingStatus + chuyển phiếu sang PROCESSING.
  router.post('/serials/edit', validate(SerialEditSchema), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, documentLineId, serial, replacement } = req.body;
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND documentId = ?', [documentLineId, documentId]);
      if (!doc || !line) return res.status(404).json({ error: 'Không tìm thấy phiếu hoặc dòng hàng' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING' && doc.status !== 'READY') return res.status(400).json({ error: 'Phiếu đã chốt, không thể sửa Serial' });
      const current = parseSerials(line.serialLot);
      const index = current.findIndex((value) => value.toLowerCase() === serial.toLowerCase());
      if (index < 0) return res.status(404).json({ error: `Không tìm thấy Serial ${serial} trên dòng hàng` });
      const next = replacement?.trim() || '';
      if (next && current.some((value, i) => i !== index && value.toLowerCase() === next.toLowerCase())) {
        return res.status(409).json({ error: `Serial ${next} đã có trong dòng hàng` });
      }
      await beginStockTransaction(db, [doc.warehouseId || doc.sourceWarehouseId].filter(Boolean) as string[]);
      transactionOpen = true;
      if (doc.docType === 'ISSUE' || doc.docType === 'TRANSFER') {
        const oldRow = await db.get(
          `SELECT * FROM stock_serials WHERE serialNumber = ? AND productId = ? AND warehouseId = ?
           AND stockStatus = 'RESERVED' AND issueDocumentId = ? AND issueLineId = ? LIMIT 1 FOR UPDATE`,
          [serial, line.productId, doc.docType === 'TRANSFER' ? doc.sourceWarehouseId : doc.warehouseId, doc.id, line.id]
        );
        if (!oldRow) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(400).json({ error: `Serial ${serial} không còn được giữ cho phiếu này` }); }
        if (next) {
          const newRow = await db.get(
            `SELECT * FROM stock_serials WHERE serialNumber = ? AND productId = ? AND warehouseId = ? AND status = 'SALEABLE'
             AND (stockStatus IS NULL OR stockStatus = 'IN_STOCK') LIMIT 1 FOR UPDATE`,
            [next, line.productId, doc.docType === 'TRANSFER' ? doc.sourceWarehouseId : doc.warehouseId]
          );
          if (!newRow) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(400).json({ error: `Serial ${next} không có trong tồn kho để thay thế` }); }
          await db.run(`UPDATE stock_serials SET stockStatus = 'IN_STOCK', issueDocumentId = NULL, issueLineId = NULL, updatedAt = ? WHERE id = ?`, [new Date().toISOString(), oldRow.id]);
          await db.run(`UPDATE stock_serials SET stockStatus = 'RESERVED', issueDocumentId = ?, issueLineId = ?, updatedAt = ? WHERE id = ?`, [doc.id, line.id, new Date().toISOString(), newRow.id]);
        } else {
          await db.run(`UPDATE stock_serials SET stockStatus = 'IN_STOCK', issueDocumentId = NULL, issueLineId = NULL, updatedAt = ? WHERE id = ?`, [new Date().toISOString(), oldRow.id]);
        }
      } else if (doc.docType === 'RETURN' && next) {
        const returnedRow = await db.get(
          `SELECT id FROM stock_serials
           WHERE serialNumber = ? AND productId = ? AND stockStatus = 'OUT' AND issueDocumentId = ?
           LIMIT 1 FOR UPDATE`,
          [next, line.productId, doc.referenceId]
        );
        if (!returnedRow) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(400).json({ error: `Serial ${next} không thuộc phiếu xuất gốc hoặc đã được trả trước đó` }); }
      } else if (next) {
        const exists = await db.get('SELECT id FROM stock_serials WHERE serialNumber = ? LIMIT 1', [next]);
        if (exists) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(409).json({ error: `Serial ${next} đã tồn tại trong hệ thống` }); }
      }
      if (next) current[index] = next;
      else current.splice(index, 1);
      await db.run(`UPDATE stock_document_lines SET serialLot = ?, processingStatus = ? WHERE id = ?`, [current.join('\n'), current.length === Number(line.quantity) ? 'COMPLETED' : current.length > 0 ? 'PARTIAL' : 'PENDING', line.id]);
      await touchProcessing(documentId);
      await recordWarehouseActivity(db.run.bind(db), {
        actionType: next ? 'SERIAL_EDITED' : 'SERIAL_REMOVED', entityType: 'SERIAL', documentId,
        entityId: next || serial, productId: line.productId,
        warehouseId: doc.warehouseId || doc.sourceWarehouseId, userId: user.id,
        oldData: { serial, serials: parseSerials(line.serialLot) },
        newData: { replacement: next || null, serials: current },
        metadata: { documentLineId },
      });
      await db.run('COMMIT'); transactionOpen = false;
      return res.json({ success: true, serials: current });
    } catch (e: any) {
      if (transactionOpen) await db.run('ROLLBACK');
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Không thể sửa Serial' });
    }
  });
  router.post('/serials/scan', validate(ScanSchema), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, documentLineId, serial } = req.body;
      const code = String(serial).trim();
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      if (!doc || doc.docType !== 'RECEIPT') return res.status(404).json({ error: 'Receipt not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft receipts can be processed' });
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND documentId = ?', [documentLineId, documentId]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      const qty = Number(line.quantity);
      const current = parseSerials(line.serialLot);
      if (current.some((s) => s.toLowerCase() === code.toLowerCase())) {
        return res.status(400).json({ error: 'Serial này đã được thêm vào phiếu' });
      }
      if (current.length >= qty) {
        return res.status(400).json({ error: `Phiếu yêu cầu ${qty} thiết bị, đã đủ ${current.length}/${qty}` });
      }
      const exists = await db.get('SELECT id FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
      if (exists) return res.status(409).json({ error: `Serial ${code} đã tồn tại trong hệ thống. Không thể quét lại thiết bị này; vui lòng kiểm tra phiếu nhập trước đó hoặc quét mã khác.` });

      await beginStockTransaction(db, [doc.warehouseId]);
      transactionOpen = true;
      try {
        const fresh = await db.get('SELECT * FROM stock_document_lines WHERE id = ? FOR UPDATE', [documentLineId]);
        if (!fresh) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(404).json({ error: 'Document line not found' }); }
        const freshSerials = parseSerials(fresh.serialLot);
        if (freshSerials.some((s) => s.toLowerCase() === code.toLowerCase())) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: 'Serial này đã được thêm vào phiếu' });
        }
        if (freshSerials.length >= qty) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: `Phiếu yêu cầu ${qty} thiết bị, đã đủ ${freshSerials.length}/${qty}` });
        }
        const dup = await db.get('SELECT id FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
        if (dup) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(409).json({ error: `Serial ${code} vừa được ghi nhận bởi người khác. Vui lòng quét lại mã khác.` });
        }
        const result = await appendLineSerial(fresh, code, true);
        const processingCompleted = await refreshProcessingAfterSerialScan(documentId);
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'SERIAL_SCANNED_IN', entityType: 'SERIAL', documentId, entityId: code,
          productId: fresh.productId, warehouseId: doc.warehouseId, quantity: 1, userId: user.id,
          metadata: { documentLineId, serial: code, processingCount: result.count },
        });
        await db.run('COMMIT'); transactionOpen = false;
        res.status(201).json({ serial: code, count: result.count, required: qty, completed: result.completed, processingCompleted });
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to scan serial' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  /** Quét Serial cho phiếu trả. Serial phải là thiết bị đã xuất đúng theo
   * phiếu xuất gốc; vì vậy không áp dụng kiểm tra "Serial đã tồn tại" của
   * phiếu nhập mới. */
  router.post('/serials/scan-return', validate(ScanSchema), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, documentLineId, serial } = req.body;
      const code = String(serial).trim();
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      if (!doc || doc.docType !== 'RETURN') return res.status(404).json({ error: 'Return document not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft returns can be processed' });
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND documentId = ?', [documentLineId, documentId]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      const current = parseSerials(line.serialLot);
      if (current.some((s) => s.toLowerCase() === code.toLowerCase())) return res.status(400).json({ error: 'Serial này đã được thêm vào phiếu trả' });
      if (current.length >= Number(line.quantity)) return res.status(400).json({ error: `Phiếu yêu cầu ${line.quantity} thiết bị, đã đủ ${current.length}/${line.quantity}` });

      const found = await db.get('SELECT * FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
      if (!found) return res.status(404).json({ error: `Không tìm thấy Serial ${code} trong lịch sử xuất kho.` });
      if (found.productId !== line.productId) return res.status(400).json({ error: `Serial này thuộc sản phẩm ${found.productId}, không phải sản phẩm ${line.productId} trên phiếu trả.` });
      if (found.stockStatus !== 'OUT') return res.status(409).json({ error: found.stockStatus === 'IN_STOCK' ? `Serial ${code} đã được trả về kho trước đó.` : `Serial ${code} chưa ở trạng thái đã xuất nên không thể nhận trả.` });
      const sourceIssue = await db.get(
        `SELECT id, code, partnerCode, partnerName, partnerAddress, deliverer
         FROM stock_documents WHERE id = ? AND docType = 'ISSUE' AND status = 'DONE' LIMIT 1`,
        [found.issueDocumentId]
      );
      if (!sourceIssue) return res.status(409).json({ error: `Serial ${code} không có phiếu xuất gốc hợp lệ để nhận trả.` });
      const referenceId = String(doc.referenceId || '').trim();
      if (referenceId && referenceId !== sourceIssue.id) {
        return res.status(400).json({ error: `Serial ${code} thuộc ${sourceIssue.code || 'một phiếu xuất khác'}. Mỗi phiếu trả chỉ xử lý Serial của một phiếu xuất gốc.` });
      }

      await beginStockTransaction(db, [doc.warehouseId]);
      transactionOpen = true;
      const locked = await db.get('SELECT * FROM stock_serials WHERE serialNumber = ? LIMIT 1 FOR UPDATE', [code]);
      if (!locked || locked.productId !== line.productId || locked.stockStatus !== 'OUT' || locked.issueDocumentId !== sourceIssue.id) {
        await db.run('ROLLBACK'); transactionOpen = false;
        return res.status(409).json({ error: `Serial ${code} vừa thay đổi trạng thái hoặc không còn hợp lệ để trả.` });
      }
      const fresh = await db.get('SELECT * FROM stock_document_lines WHERE id = ? FOR UPDATE', [documentLineId]);
      if (!fresh) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(404).json({ error: 'Document line not found' }); }
      const freshSerials = parseSerials(fresh.serialLot);
      if (freshSerials.some((s) => s.toLowerCase() === code.toLowerCase()) || freshSerials.length >= Number(fresh.quantity)) {
        await db.run('ROLLBACK'); transactionOpen = false;
        return res.status(400).json({ error: 'Serial đã được thêm hoặc dòng đã đủ số lượng' });
      }
      const result = await appendLineSerial(fresh, code, true);
      if (!referenceId) {
        await db.run(
          `UPDATE stock_documents
           SET referenceType = 'ISSUE', referenceId = ?, partnerCode = ?, partnerName = ?,
               partnerAddress = ?, deliverer = ?, updatedAt = ? WHERE id = ?`,
          [sourceIssue.id, sourceIssue.partnerCode || null, sourceIssue.partnerName || null,
            sourceIssue.partnerAddress || null, sourceIssue.deliverer || null, new Date().toISOString(), documentId]
        );
      }
      const processingCompleted = await refreshProcessingAfterSerialScan(documentId);
      await recordWarehouseActivity(db.run.bind(db), {
        actionType: 'SERIAL_SCANNED_RETURN', entityType: 'SERIAL', entityId: locked.id,
        documentId, documentCode: doc.code, productId: fresh.productId, serialId: locked.id,
        warehouseId: doc.warehouseId, quantity: 1, userId: user.id,
        metadata: { documentLineId, serial: code, sourceIssueDocumentId: sourceIssue.id, sourceIssueCode: sourceIssue.code, processingCount: result.count },
      });
      await db.run('COMMIT'); transactionOpen = false;
      return res.status(201).json({
        serial: code, count: result.count, required: Number(fresh.quantity), completed: result.completed, processingCompleted,
        sourceIssue: { id: sourceIssue.id, code: sourceIssue.code, partnerName: sourceIssue.partnerName || null },
      });
    } catch (e: any) {
      if (transactionOpen) await db.run('ROLLBACK');
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to scan return serial' });
    }
  });

  router.post('/serials/scan-out', validate(ScanSchema), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, documentLineId, serial } = req.body;
      const code = String(serial).trim();
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      if (!doc || (doc.docType !== 'ISSUE' && doc.docType !== 'TRANSFER')) return res.status(404).json({ error: 'Issue or transfer not found' });
      const sourceWarehouseId = doc.docType === 'TRANSFER' ? doc.sourceWarehouseId : doc.warehouseId;
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft issues/transfers can be processed' });

      // Đối chiếu trực tiếp với lịch sử nhập: tồn tại + đúng SP + IN_STOCK + đúng kho + có nguồn nhập.
      const row = await db.get('SELECT * FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
      if (!row) return res.status(404).json({ error: 'Không tìm thấy Serial trong lịch sử nhập kho. Không được phép xuất thiết bị này.' });
      const line0 = await db.get('SELECT * FROM stock_document_lines WHERE id = ? AND documentId = ?', [documentLineId, documentId]);
      if (!line0) return res.status(404).json({ error: 'Document line not found' });
      if (row.productId !== line0.productId) {
        return res.status(400).json({ error: `Serial này thuộc sản phẩm ${row.productId}, không phải sản phẩm ${line0.productId} trên phiếu xuất.` });
      }
      if (!row.receiptDocumentId) {
        return res.status(400).json({ error: 'Serial chưa từng nhập kho. Không được phép xuất thiết bị này.' });
      }
      const stockState = row.stockStatus || 'IN_STOCK';
      if (stockState === 'OUT') {
        const issueDoc = row.issueDocumentId
          ? await db.get('SELECT code FROM stock_documents WHERE id = ?', [row.issueDocumentId]).catch(() => null)
          : null;
        return res.status(400).json({ error: `Serial này đã được xuất theo ${issueDoc?.code || 'phiếu khác'}` });
      }
      if (stockState === 'RESERVED' && row.issueDocumentId !== documentId) {
        const reservedDoc = row.issueDocumentId
          ? await db.get('SELECT code FROM stock_documents WHERE id = ?', [row.issueDocumentId]).catch(() => null)
          : null;
        return res.status(400).json({ error: `Serial đang được giữ cho ${reservedDoc?.code || 'một phiếu xuất khác'}.` });
      }
      if (row.warehouseId !== sourceWarehouseId) {
        return res.status(400).json({ error: `Serial hiện không nằm tại kho đang xuất (kho hiện tại: ${row.warehouseId}, kho xuất: ${sourceWarehouseId}).` });
      }
      const qty = Number(line0.quantity);
      const current = parseSerials(line0.serialLot);
      if (current.some((s) => s.toLowerCase() === code.toLowerCase())) {
        return res.status(400).json({ error: 'Serial này đã được thêm vào phiếu' });
      }
      if (current.length + 1 > qty) {
        return res.status(400).json({ error: `Phiếu yêu cầu ${qty} thiết bị, đã đủ ${current.length}/${qty}` });
      }

      await beginStockTransaction(db, [sourceWarehouseId]);
      transactionOpen = true;
      try {
        const locked = await db.get('SELECT * FROM stock_serials WHERE serialNumber = ? LIMIT 1 FOR UPDATE', [code]);
        const lockedState = locked?.stockStatus || 'IN_STOCK';
        if (!locked || (lockedState !== 'IN_STOCK' && !(lockedState === 'RESERVED' && locked?.issueDocumentId === documentId))) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(409).json({ error: 'Serial vừa bị giữ/xuất bởi người khác, hãy quét lại' });
        }
        if (locked.warehouseId !== sourceWarehouseId || locked.productId !== line0.productId) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: 'Serial không còn hợp lệ để xuất (sai kho/sản phẩm)' });
        }
        const fresh = await db.get('SELECT * FROM stock_document_lines WHERE id = ? FOR UPDATE', [documentLineId]);
        if (!fresh) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(404).json({ error: 'Document line not found' }); }
        const freshSerials = parseSerials(fresh.serialLot);
        if (freshSerials.some((s) => s.toLowerCase() === code.toLowerCase()) || freshSerials.length >= qty) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: 'Serial đã được thêm hoặc dòng đã đủ số lượng' });
        }
        await db.run(
          `UPDATE stock_serials SET stockStatus = 'RESERVED', issueDocumentId = ?, issueLineId = ?, updatedAt = ? WHERE id = ?`,
          [documentId, documentLineId, new Date().toISOString(), locked.id]
        );
        const result = await appendLineSerial(fresh, code, true);
        const processingCompleted = await refreshProcessingAfterSerialScan(documentId);
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'SERIAL_SCANNED_OUT', entityType: 'SERIAL', documentId, entityId: locked.id,
          productId: fresh.productId, serialId: locked.id, warehouseId: sourceWarehouseId,
          quantity: -1, userId: user.id,
          metadata: { documentLineId, serial: code, processingCount: result.count },
        });
        await db.run('COMMIT'); transactionOpen = false;
        res.status(201).json({ serial: code, count: result.count, required: qty, completed: result.completed, processingCompleted });
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to scan serial for issue' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  /** Quét thông minh (Smart Scan): Tự động khớp Serial vào đúng dòng sản phẩm trên phiếu */
  router.post('/serials/scan-smart', validate(SmartScanSchema), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const { documentId, serial } = req.body;
      const code = String(serial).trim();
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [documentId]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING' && doc.status !== 'READY') {
        return res.status(400).json({ error: 'Phiếu đã đóng hoặc đã hủy, không thể quét thêm Serial' });
      }

      const lines = await db.all(
        `SELECT l.*, p.name AS productName, p.tracking FROM stock_document_lines l
         LEFT JOIN products p ON p.id = l.productId WHERE l.documentId = ?`,
        [documentId]
      );
      if (!lines || lines.length === 0) {
        return res.status(400).json({ error: 'Phiếu chưa có dòng hàng nào' });
      }

      if (doc.docType === 'ISSUE' || doc.docType === 'TRANSFER') {
        const sourceWarehouseId = doc.docType === 'TRANSFER' ? doc.sourceWarehouseId : doc.warehouseId;
        const row = await db.get('SELECT * FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
        if (!row) {
          return res.status(404).json({ error: `Không tìm thấy Serial "${code}" trong kho. Serial này chưa từng nhập kho.` });
        }
        if (row.stockStatus === 'OUT') {
          const issueDoc = row.issueDocumentId
            ? await db.get('SELECT code FROM stock_documents WHERE id = ?', [row.issueDocumentId]).catch(() => null)
            : null;
          return res.status(400).json({ error: `Serial "${code}" đã xuất theo ${issueDoc?.code || 'phiếu khác'}` });
        }
        if (row.stockStatus === 'RESERVED' && row.issueDocumentId !== documentId) {
          const resDoc = row.issueDocumentId
            ? await db.get('SELECT code FROM stock_documents WHERE id = ?', [row.issueDocumentId]).catch(() => null)
            : null;
          return res.status(400).json({ error: `Serial "${code}" đang được giữ cho ${resDoc?.code || 'phiếu khác'}` });
        }
        if (row.warehouseId !== sourceWarehouseId) {
          return res.status(400).json({ error: `Serial "${code}" không nằm tại kho đang xuất (kho hiện tại: ${row.warehouseId})` });
        }

        const matchingLines = lines.filter((l: any) => l.productId === row.productId);
        if (matchingLines.length === 0) {
          return res.status(400).json({ error: `Serial "${code}" thuộc sản phẩm [${row.productId}], nhưng sản phẩm này không có trên phiếu ${doc.code || ''}` });
        }

        const already = matchingLines.find((l: any) => parseSerials(l.serialLot).some((s: string) => s.toLowerCase() === code.toLowerCase()));
        if (already) {
          return res.status(400).json({ error: `Serial "${code}" đã được quét cho dòng "${already.productName || already.productId}"` });
        }

        const targetLine = matchingLines.find((l: any) => parseSerials(l.serialLot).length < Number(l.quantity));
        if (!targetLine) {
          return res.status(400).json({ error: `Dòng sản phẩm "${matchingLines[0].productName || row.productId}" đã được quét đủ số lượng yêu cầu` });
        }

        await beginStockTransaction(db, [sourceWarehouseId]);
        transactionOpen = true;
        const locked = await db.get('SELECT * FROM stock_serials WHERE serialNumber = ? LIMIT 1 FOR UPDATE', [code]);
        const lockedState = locked?.stockStatus || 'IN_STOCK';
        if (!locked || (lockedState !== 'IN_STOCK' && !(lockedState === 'RESERVED' && locked?.issueDocumentId === documentId))) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(409).json({ error: 'Serial vừa bị giữ/xuất bởi người khác, hãy quét lại' });
        }
        const fresh = await db.get('SELECT * FROM stock_document_lines WHERE id = ? FOR UPDATE', [targetLine.id]);
        if (!fresh) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(404).json({ error: 'Document line not found' }); }
        const freshSerials = parseSerials(fresh.serialLot);
        if (freshSerials.some((s) => s.toLowerCase() === code.toLowerCase()) || freshSerials.length >= Number(fresh.quantity)) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: 'Serial đã được thêm hoặc dòng đã đủ số lượng' });
        }
        await db.run(
          `UPDATE stock_serials SET stockStatus = 'RESERVED', issueDocumentId = ?, issueLineId = ?, updatedAt = ? WHERE id = ?`,
          [documentId, targetLine.id, new Date().toISOString(), locked.id]
        );
        const result = await appendLineSerial(fresh, code, true);
        const processingCompleted = await refreshProcessingAfterSerialScan(documentId);
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'SERIAL_SCANNED_OUT', entityType: 'SERIAL', documentId, entityId: locked.id,
          productId: fresh.productId, serialId: locked.id, warehouseId: sourceWarehouseId,
          quantity: -1, userId: user.id,
          metadata: { documentLineId: targetLine.id, serial: code, processingCount: result.count, smartMatch: true },
        });
        await db.run('COMMIT'); transactionOpen = false;
        return res.status(201).json({
          success: true, matchedLineId: targetLine.id, productId: fresh.productId,
          productName: targetLine.productName || fresh.productId, serial: code,
          count: result.count, required: Number(fresh.quantity), completed: result.completed, processingCompleted,
        });
      } else if (doc.docType === 'RECEIPT') {
        const exists = await db.get('SELECT id FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
        if (exists) {
          return res.status(409).json({ error: `Serial "${code}" đã tồn tại trong hệ thống. Không thể nhập lại mã này.` });
        }
        const alreadyInDoc = lines.find((l: any) => parseSerials(l.serialLot).some((s: string) => s.toLowerCase() === code.toLowerCase()));
        if (alreadyInDoc) {
          return res.status(400).json({ error: `Serial "${code}" đã được quét trên phiếu này` });
        }
        const targetLine = lines.find((l: any) => parseSerials(l.serialLot).length < Number(l.quantity));
        if (!targetLine) {
          return res.status(400).json({ error: 'Tất cả các dòng hàng trên phiếu nhập đã đủ số lượng' });
        }

        await beginStockTransaction(db, [doc.warehouseId]);
        transactionOpen = true;
        const fresh = await db.get('SELECT * FROM stock_document_lines WHERE id = ? FOR UPDATE', [targetLine.id]);
        if (!fresh) { await db.run('ROLLBACK'); transactionOpen = false; return res.status(404).json({ error: 'Document line not found' }); }
        const freshSerials = parseSerials(fresh.serialLot);
        if (freshSerials.length >= Number(fresh.quantity)) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(400).json({ error: 'Dòng sản phẩm đã đủ số lượng' });
        }
        const dup = await db.get('SELECT id FROM stock_serials WHERE serialNumber = ? LIMIT 1', [code]);
        if (dup) {
          await db.run('ROLLBACK'); transactionOpen = false;
          return res.status(409).json({ error: `Serial "${code}" vừa được ghi nhận bởi người khác.` });
        }
        const result = await appendLineSerial(fresh, code, true);
        const processingCompleted = await refreshProcessingAfterSerialScan(documentId);
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'SERIAL_SCANNED_IN', entityType: 'SERIAL', documentId, entityId: code,
          productId: fresh.productId, warehouseId: doc.warehouseId, quantity: 1, userId: user.id,
          metadata: { documentLineId: targetLine.id, serial: code, processingCount: result.count, smartMatch: true },
        });
        await db.run('COMMIT'); transactionOpen = false;
        return res.status(201).json({
          success: true, matchedLineId: targetLine.id, productId: fresh.productId,
          productName: targetLine.productName || fresh.productId, serial: code,
          count: result.count, required: Number(fresh.quantity), completed: result.completed, processingCompleted,
        });
      } else {
        return res.status(400).json({ error: 'Chức năng quét thông minh chưa hỗ trợ loại phiếu này' });
      }
    } catch (e: any) {
      if (transactionOpen) await db.run('ROLLBACK');
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Thao tác quét thông minh thất bại' });
    }
  });
  // ── Tiến độ xử lý + xác nhận số lượng + đăng ký lô ──────────────────────────

  /** Tiến độ từng dòng để SerialPage hiển thị: Yêu cầu / Đã xử lý / Còn thiếu / Đủ. */
  router.get('/documents/:id/progress', async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const id = String(req.params.id);
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [id]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (!(await canReadDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      const lines = await db.all(
        `SELECT l.*, p.name AS productName, p.tracking FROM stock_document_lines l
         LEFT JOIN products p ON p.id = l.productId WHERE l.documentId = ?`,
        [id]
      );
      const out = [];
      for (const line of lines || []) {
        const serialRequired = true;
        const serialSkipped = false;
        const tracking = 'SERIAL';
        const required = Number(line.quantity);
        const processed = parseSerials(line.serialLot).length;
        const lots: any[] = [];
        const completed = processed === required;
        let availability: any = null;
        if (doc.docType === 'ISSUE') {
          availability = await db.get(
            `SELECT COALESCE(SUM(onHand), 0) AS onHand, COALESCE(SUM(reserved), 0) AS reserved,
                    COALESCE(SUM(onHand - reserved), 0) AS available
             FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ?`,
            [line.productId, doc.warehouseId, line.locationId || '']
          ).catch(() => ({ onHand: 0, reserved: 0, available: 0 }));
          availability = { ...availability, afterIssue: Number(availability.available || 0) - required };
        }
        out.push({
          lineId: line.id, productId: line.productId,
          productName: (line as any).productName || line.productId,
          required, processed, tracking, lots,
          serials: parseSerials(line.serialLot),
          serialSkipped,
          canEnableSerial: !serialRequired
            && !serialSkipped
            && line.processingStatus === 'PENDING'
            && parseSerials(line.serialLot).length === 0,
          quantityConfirmed: line.processingStatus !== 'PENDING' || parseSerials(line.serialLot).length > 0,
          actualQty: line.actualQty ?? null, varianceQty: line.varianceQty ?? null,
          availability,
          status: completed ? 'COMPLETED' : (processed > 0 ? 'PARTIAL' : 'PENDING'),
        });
      }
      res.json({
        documentId: id, code: doc.code, status: doc.status,
        lines: out, allCompleted: out.length > 0 && out.every((l: any) => l.status === 'COMPLETED'),
      });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to fetch processing progress' }); }
  });

  /**
   * Chuyển một dòng xuất/điều chuyển cũ sang quy trình Serial chuẩn.
   * Phiếu mới đã lưu serialRequired = 1 từ lúc tạo; endpoint này chỉ là
   * đường nâng cấp có kiểm soát cho các phiếu còn ở trạng thái chưa xử lý.
   */
  router.post('/lines/:id/enable-serial', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ?', [String(req.params.id)]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [line.documentId]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') {
        return res.status(400).json({ error: 'Phiếu không còn ở bước xử lý hàng hóa' });
      }
      if (Number(line.serialRequired) === 1) return res.json({ success: true, serialRequired: true });
      if (Number(line.serialSkipped) === 1 || line.processingStatus !== 'PENDING' || parseSerials(line.serialLot).length > 0) {
        return res.status(400).json({ error: 'Dòng hàng đã được xử lý. Hãy đặt lại xử lý trước khi chuyển sang quét Serial.' });
      }

      await beginStockTransaction(db, [doc.warehouseId || doc.sourceWarehouseId].filter(Boolean) as string[]);
      transactionOpen = true;
      await db.run(
        `UPDATE stock_document_lines
         SET serialRequired = 1, serialSkipped = 0, actualQty = NULL, varianceQty = NULL,
             varianceReason = NULL, processingStatus = 'PENDING'
         WHERE id = ?`,
        [line.id]
      );
      await recordWarehouseActivity(db.run.bind(db), {
        actionType: 'SERIAL_TRACKING_ENABLED', entityType: 'DOCUMENT_LINE', entityId: line.id,
        documentId: doc.id, documentCode: doc.code, productId: line.productId,
        warehouseId: doc.warehouseId || doc.sourceWarehouseId, quantity: Number(line.quantity), userId: user.id,
        metadata: { source: 'legacy_document_line' },
      });
      await db.run('COMMIT'); transactionOpen = false;
      return res.json({ success: true, serialRequired: true });
    } catch (e: any) {
      if (transactionOpen) await db.run('ROLLBACK');
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Không thể chuyển dòng hàng sang quét Serial' });
    }
  });

  router.post('/lines/:id/confirm-qty', validate(z.object({
    actualQty: z.number().finite().min(0).max(1_000_000_000),
    varianceReason: z.string().trim().max(500).nullable().optional(),
  })), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    let transactionOpen = false;
    try {
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ?', [String(req.params.id)]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [line.documentId]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Only draft documents can be processed' });
      const expected = Number(line.quantity);
      const actual = Number(req.body.actualQty);
      if (actual !== expected) {
        return res.status(400).json({ error: `Mọi dòng hàng phải xác nhận đủ ${expected} sản phẩm rồi quét đủ ${expected} Serial.` });
      }
      await beginStockTransaction(db, [doc.warehouseId || doc.sourceWarehouseId].filter(Boolean) as string[]);
      transactionOpen = true;
      try {
        await db.run(
          `UPDATE stock_document_lines SET actualQty = NULL, varianceQty = NULL, varianceReason = NULL,
           processingStatus = CASE WHEN processingStatus = 'COMPLETED' THEN 'COMPLETED' ELSE 'PARTIAL' END WHERE id = ?`,
          [line.id]
        );
        await touchProcessing(doc.id);
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'QUANTITY_CONFIRMED', entityType: 'DOCUMENT_LINE', entityId: line.id,
          documentId: doc.id, documentCode: doc.code, productId: line.productId,
          warehouseId: doc.warehouseId || doc.sourceWarehouseId, quantity: expected, userId: user.id,
          metadata: { tracking: 'SERIAL', serialRequired: true, actualQty: expected },
        });
        await db.run('COMMIT'); transactionOpen = false;
        return res.json({ quantityConfirmed: true, requiredQty: expected });
      } catch (e) {
        await db.run('ROLLBACK'); transactionOpen = false;
        throw e;
      }
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to confirm quantity' }); } finally {
      if (transactionOpen) await db.run('ROLLBACK');
    }
  });

  router.post('/lines/:id/confirm-no-serial', validate(z.object({
    actualQty: z.number().finite().min(0).max(1_000_000_000),
    varianceReason: z.string().trim().max(500).nullable().optional(),
  })), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    return res.status(400).json({ error: 'Mọi dòng hàng phải quét đủ Serial. Không còn hỗ trợ hoàn tất phiếu bằng lựa chọn “Không có Serial”.' });
    /* Legacy implementation retained temporarily for migration context.
    let transactionOpen = false;
    try {
      const line = await db.get('SELECT * FROM stock_document_lines WHERE id = ?', [String(req.params.id)]);
      if (!line) return res.status(404).json({ error: 'Document line not found' });
      const doc = await db.get('SELECT * FROM stock_documents WHERE id = ?', [line.documentId]);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      if (!(await canWriteDocument(user, doc))) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (doc.status !== 'DRAFT' && doc.status !== 'PROCESSING') return res.status(400).json({ error: 'Phiếu không còn ở bước xử lý hàng hóa' });
      if (Number(line.serialRequired) !== 1) return res.status(400).json({ error: 'Dòng này không yêu cầu lựa chọn bỏ qua Serial' });
      const actual = Number(req.body.actualQty);
      const variance = actual - Number(line.quantity);
      if (variance !== 0 && !req.body.varianceReason?.trim()) {
        return res.status(400).json({ error: 'Số lượng thực nhận lệch phiếu — vui lòng nhập lý do' });
      }
      await beginStockTransaction(db, [doc.warehouseId || doc.sourceWarehouseId].filter(Boolean) as string[]);
      transactionOpen = true;
      await db.run(
        `UPDATE stock_document_lines SET serialSkipped = 1, actualQty = ?, varianceQty = ?, varianceReason = ?, processingStatus = 'COMPLETED' WHERE id = ?`,
        [actual, variance, req.body.varianceReason?.trim() || 'Hàng hóa không có Serial', line.id]
      );
      await touchProcessing(doc.id);
      await recordWarehouseActivity(db.run.bind(db), {
        actionType: 'SERIAL_SKIPPED', entityType: 'DOCUMENT_LINE', entityId: line.id,
        documentId: doc.id, documentCode: doc.code, productId: line.productId,
        warehouseId: doc.warehouseId || doc.sourceWarehouseId, quantity: actual, userId: user.id,
        metadata: { expectedQty: Number(line.quantity), actualQty: actual, variance, reason: req.body.varianceReason?.trim() || 'Hàng hóa không có Serial' },
      });
      await db.run('COMMIT'); transactionOpen = false;
      return res.json({ success: true, serialSkipped: true, actualQty: actual, varianceQty: variance });
    } catch (e: any) {
      if (transactionOpen) await db.run('ROLLBACK');
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to confirm line without serial' });
    } */
  });

  return router;
}
