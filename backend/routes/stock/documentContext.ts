import { randomUUID } from 'crypto';
import { beginStockTransaction } from '../../utils/stockTransaction.js';
import { adjustReserved } from '../../utils/stockReserved.js';
import { resolveTracking } from '../../utils/tracking.js';
import { getWarrantyStartType, resolveWarrantyStart } from '../../utils/warranty.js';
import { DEFAULT_VAT_RATE, DOC_CODE_PREFIX } from './documentSchemas.js';
import type { StockContext } from './context.js';

/**
 * Bộ helper dùng chung của các sub-router chứng từ (tách ra từ documents.ts).
 * Không đăng ký route nào: mục đích là để 5 sub-router chia sẻ đúng MỘT bản
 * createDocument / preflightPosting / postDocumentMoves, vì nhân bản các hàm
 * ghi sổ này sẽ làm ledger lệch nhau giữa các luồng.
 */
export function createDocumentContext(ctx: StockContext) {
  const { db, requireWarehouseManager, availableOf, assertNotCounting, postMoves, recordWarehouseActivity, resolveAccountingDefaults, nextDocCode } = ctx;

  async function createDocument(docType: string, code: string, warehouses: { warehouseId?: string | null; sourceWarehouseId?: string | null; destWarehouseId?: string | null }, body: any, user: any) {
    const now = new Date().toISOString();
    const id = randomUUID();
    const userCode = (typeof body.code === 'string' && body.code.trim()) ? body.code.trim() : null;
    let finalCode = userCode || code;
    const canEditFinancials = requireWarehouseManager(user);

    let computedPreTax = 0;
    let computedVat = 0;
    for (const line of body.lines) {
      const q = Number(line.quantity) || 0;
      const p = Number(line.unitPrice) || 0;
      const rate = canEditFinancials && line.vatRate !== undefined ? Number(line.vatRate) : DEFAULT_VAT_RATE;
      const linePreTax = q * p;
      const lineVat = canEditFinancials && line.vatAmount !== undefined ? Number(line.vatAmount) : (linePreTax * rate / 100);
      computedPreTax += linePreTax;
      computedVat += lineVat;
    }
    const totalPreTax = computedPreTax;
    const vatAmount = computedVat;
    const totalAmount = totalPreTax + vatAmount;
    const shippingFee = canEditFinancials ? Number(body.shippingFee) || 0 : 0;
    const attachmentsStr = typeof body.attachments === 'string' ? body.attachments : (Array.isArray(body.attachments) ? JSON.stringify(body.attachments) : null);

    // Phiếu trả không yêu cầu người dùng chọn PXK từ lúc tạo. PXK và đơn vị
    // trả được xác định tự động khi quét Serial đầu tiên, để hỗ trợ trả lẻ
    // (ví dụ đã xuất 5 thiết bị nhưng chỉ nhận trả 1 thiết bị).
    if (docType === 'RETURN') {
      if (!String(body.notes || '').trim()) {
        throw Object.assign(new Error('Phiếu trả cần nhập lý do trả hàng.'), { status: 400 });
      }
      // Không nhận tham chiếu do client gửi lên: nguồn trả chỉ được tin từ
      // stock_serials sau khi kiểm tra Serial đang OUT.
      body.referenceId = null;
      body.referenceType = null;
    }

    // Khóa cả 2 đầu của TRANSFER; không khóa toàn bảng warehouses vì mọi
    // luồng tạo phiếu khác sẽ bị xếp hàng chờ.
    const lockWarehouseIds = [warehouses.warehouseId, warehouses.sourceWarehouseId, warehouses.destWarehouseId].filter(Boolean) as string[];
    await beginStockTransaction(db, lockWarehouseIds);
    let attempts = 0;
    for (;;) {
      attempts += 1;
      try {
        const validationError = await validateLines(body.lines, warehouses.warehouseId || warehouses.sourceWarehouseId || '');
        if (validationError) throw Object.assign(new Error(validationError), { status: 400 });

      await db.run(
        `INSERT INTO stock_documents (
          id, code, docType, status, receiptSubType, warehouseId, sourceWarehouseId, destWarehouseId,
          partnerCode, partnerName, partnerAddress, deliverer, purchaserId,
          postingDate, docDate, invoiceNumber, invoiceDate, customsDeclarationNumber,
          invoiceLookupCode, invoiceLookupUrl, totalPreTax, vatRate, vatAmount, totalAmount, shippingFee,
          paymentStatus, paymentDueDate, attachments, referenceType, referenceId, notes, createdBy, createdAt, updatedAt
        ) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, finalCode, docType, body.receiptSubType || (docType === 'RECEIPT' ? 'DOMESTIC_PURCHASE' : null),
          warehouses.warehouseId ?? null, warehouses.sourceWarehouseId ?? null, warehouses.destWarehouseId ?? null,
          body.partnerCode ?? null, body.partnerName ?? null, body.partnerAddress ?? null,
          body.deliverer ?? null, body.purchaserId ?? null,
          body.postingDate ?? now, body.docDate ?? now.slice(0, 10),
          body.invoiceNumber ?? null, body.invoiceDate ?? null, body.customsDeclarationNumber ?? null,
          body.invoiceLookupCode ?? null, body.invoiceLookupUrl ?? null,
          totalPreTax, canEditFinancials && body.vatRate !== undefined ? Number(body.vatRate) : DEFAULT_VAT_RATE, vatAmount, totalAmount, shippingFee,
          body.paymentStatus || 'UNPAID', body.paymentDueDate ?? null,
          attachmentsStr, body.referenceType ?? null, body.referenceId ?? null, body.notes ?? null,
          user.id, now, now
        ]
      );
      const savedLines: { id: string; productId: string; locationId: string; quantity: number }[] = [];
      for (const line of body.lines) {
        const q = Number(line.quantity) || 0;
        const p = Number(line.unitPrice) || 0;
        const rate = canEditFinancials && line.vatRate !== undefined ? Number(line.vatRate) : DEFAULT_VAT_RATE;
        const linePreTax = q * p;
        const lineVat = canEditFinancials && line.vatAmount !== undefined ? Number(line.vatAmount) : (linePreTax * rate / 100);
        const lineTotal = canEditFinancials && line.totalAmount !== undefined ? Number(line.totalAmount) : (linePreTax + lineVat);
        const lineId = randomUUID();
        savedLines.push({ id: lineId, productId: line.productId, locationId: line.locationId || '', quantity: q });
        await db.run(
          `INSERT INTO stock_document_lines (
            id, documentId, productId, quantity, unitPrice, locationId, note,
            accountDebit, accountCredit, vatRate, vatAmount, totalAmount, projectId, costItem, serialLot, costObjectId, serialRequired
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            lineId, id, line.productId, q, p, line.locationId ?? null, line.note ?? null,
            (requireWarehouseManager(user) ? line.accountDebit : null) || (await resolveAccountingDefaults(line.productId, body.partnerCode || body.partnerName, line.projectId)).accountDebit,
            (requireWarehouseManager(user) ? line.accountCredit : null) || (await resolveAccountingDefaults(line.productId, body.partnerCode || body.partnerName, line.projectId)).accountCredit,
            rate, lineVat, lineTotal, line.projectId ?? null,
            requireWarehouseManager(user) ? line.costItem ?? null : null,
            line.serialLot ?? null, requireWarehouseManager(user) ? line.costObjectId ?? null : null, 1
          ]
        );
      }
      if (docType === 'ISSUE') {
        await syncDocumentReservationLinks(
          warehouses.warehouseId || warehouses.sourceWarehouseId || '',
          body.lines,
          savedLines
        );
      }
      await recordWarehouseActivity(db.run.bind(db), {
        actionType: 'DOCUMENT_CREATED',
        entityType: 'DOCUMENT',
        entityId: id,
        documentId: id,
        documentCode: finalCode,
        warehouseId: warehouses.warehouseId || null,
        fromWarehouseId: warehouses.sourceWarehouseId || null,
        toWarehouseId: warehouses.destWarehouseId || null,
        userId: user.id,
        metadata: { docType, lineCount: body.lines.length, receiptSubType: body.receiptSubType || null },
      });
      await db.run('COMMIT');
      return { id, code: finalCode };
    } catch (error: any) {
      await db.run('ROLLBACK');
      // Mã tự sinh va chạm UNIQUE (random 4 ký tự): sinh lại và thử tiếp, tối đa 3 lần.
      // Mã do người dùng nhập thì báo 409 ngay.
      if (!userCode && error?.message?.includes('Duplicate') && attempts < 3) {
        finalCode = await nextDocCode(DOC_CODE_PREFIX[docType] || 'PXK');
        await beginStockTransaction(db, lockWarehouseIds);
        continue;
      }
      throw error;
    }
  }
  }
  // ── Chứng từ: hoàn tất (sinh moves + balances, transaction) ────────────────

  async function loadDocument(id: string, lock = false) {
    const doc = await db.get(`SELECT * FROM stock_documents WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
    if (!doc) return null;
    const lines = await db.all('SELECT * FROM stock_document_lines WHERE documentId = ?', [id]);
    return { doc, lines };
  }

  /** Số lượng thực sự ghi sổ. QUANTITY có thể được xác nhận lệch chứng từ;
   * SERIAL/LOT vẫn lấy quantity vì chúng được kiểm soát bằng entity/allocation. */
  function effectiveLineQuantity(line: any): number {
    const actual = Number(line?.actualQty);
    if (line?.actualQty !== null && line?.actualQty !== undefined && Number.isFinite(actual)) return actual;
    return Number(line?.quantity || 0);
  }

  function aggregateLines(lines: any[]): any[] {
    const totals = new Map<string, any>();
    for (const line of lines) {
      if (!line?.productId) continue;
      const key = JSON.stringify([line.productId, line.locationId || '']);
      const previous = totals.get(key);
      totals.set(key, { ...line, quantity: effectiveLineQuantity(line) + Number(previous?.quantity || 0) });
    }
    return [...totals.values()];
  }

  async function validateLines(lines: any[], warehouseId: string): Promise<string | null> {
    if (lines.length === 0) return 'Phiếu chưa có dòng hàng để xử lý.';
    for (const line of lines) {
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || !(quantity > 0)) return `Số lượng của sản phẩm ${line.productId} phải lớn hơn 0.`;
      if (!Number.isInteger(quantity)) return `Số lượng của sản phẩm ${line.productId} phải là số nguyên vì mỗi đơn vị cần quét một Serial riêng.`;
    }
    const productIds = [...new Set(lines.map((l: any) => l.productId))];
    const foundProducts = await db.all(
      `SELECT id FROM products WHERE id IN (${productIds.map(() => '?').join(', ')})`,
      productIds
    ).catch(() => []);
    const foundSet = new Set((foundProducts || []).map((r: any) => r.id));
    for (const pid of productIds) {
      if (!foundSet.has(pid)) return `Không tìm thấy sản phẩm có mã hệ thống ${pid}. Vui lòng kiểm tra lại dòng hàng.`;
    }
    const locationIds = [...new Set(lines.map((l: any) => l.locationId || '').filter(Boolean))];
    if (locationIds.length > 0) {
      const locRows = await db.all(
        `SELECT id FROM stock_locations WHERE warehouseId = ? AND id IN (${locationIds.map(() => '?').join(', ')}) AND isActive = 1`,
        [warehouseId, ...locationIds]
      ).catch(() => []);
      const locSet = new Set((locRows || []).map((r: any) => r.id));
      for (const lid of locationIds) {
        if (!locSet.has(lid)) return `Vị trí lưu kho ${lid} không tồn tại hoặc đã ngừng hoạt động trong kho này.`;
      }
    }
    return null;
  }

  /** Available theo từng (product, location) trong 1 query — thay N lần availableOf. */
  async function availableMap(warehouseId: string, keys: { productId: string; locationId: string }[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (keys.length === 0) return out;
    const pairs = keys.map((k) => `${k.productId}|${k.locationId || ''}`);
    const uniqPairs = [...new Set(pairs)];
    const productIds = [...new Set(keys.map((k) => k.productId))];
    const locationIds = [...new Set(keys.map((k) => k.locationId || '').filter(Boolean))];
    let query = 'SELECT productId, locationId, onHand, reserved FROM stock_balances WHERE warehouseId = ?';
    const params: any[] = [warehouseId];
    query += ` AND productId IN (${productIds.map(() => '?').join(', ')})`;
    params.push(...productIds);
    if (locationIds.length > 0) {
      query += ` AND (locationId = '' OR locationId IN (${locationIds.map(() => '?').join(', ')}))`;
      params.push(...locationIds);
    } else {
      query += ` AND locationId = ''`;
    }
    const rows = await db.all(query, params).catch(() => []);
    for (const r of rows || []) {
      out.set(`${r.productId}|${r.locationId || ''}`, Number(r.onHand ?? 0) - Number(r.reserved ?? 0));
    }
    for (const p of uniqPairs) if (!out.has(p)) out.set(p, 0);
    return out;
  }

  function formatStockQuantity(value: number): string {
    return Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 6 });
  }

  /** Thông báo đủ ngữ cảnh để người dùng biết cần sửa dữ liệu nào trước khi xuất. */
  async function insufficientStockMessage(warehouseId: string, line: any, available: number): Promise<string> {
    const [product, warehouse, location, balance] = await Promise.all([
      db.get('SELECT name, unit, importCode FROM products WHERE id = ?', [line.productId]).catch(() => undefined),
      db.get('SELECT name FROM warehouses WHERE id = ?', [warehouseId]).catch(() => undefined),
      line.locationId
        ? db.get('SELECT name, code FROM stock_locations WHERE id = ?', [line.locationId]).catch(() => undefined)
        : Promise.resolve(undefined),
      db.get(
        'SELECT onHand, reserved FROM stock_balances WHERE productId = ? AND warehouseId = ? AND locationId = ?',
        [line.productId, warehouseId, line.locationId || '']
      ).catch(() => undefined),
    ]);
    const productName = product?.name || line.productId;
    const productCode = product?.importCode ? ` (${product.importCode})` : '';
    const unit = product?.unit ? ` ${product.unit}` : '';
    const warehouseName = warehouse?.name || warehouseId;
    const locationName = location ? ` tại vị trí ${location.name || location.code || line.locationId}` : '';
    const onHand = Number(balance?.onHand ?? available);
    const reserved = Number(balance?.reserved ?? Math.max(0, onHand - available));
    const held = reserved > 0 ? ` Trong đó đang giữ ${formatStockQuantity(reserved)}${unit}.` : '';
    return `Không đủ tồn kho để xuất sản phẩm “${productName}”${productCode}. `
      + `Cần xuất ${formatStockQuantity(Number(line.quantity))}${unit}, `
      + `nhưng tồn khả dụng chỉ còn ${formatStockQuantity(available)}${unit} tại kho “${warehouseName}”${locationName}.`
      + held;
  }

  /** Tách serial/lot từ ô serialLot của dòng (phân tách , ; xuống dòng), khử trùng. */
  function parseSerials(serialLot: string | null | undefined): string[] {
    if (!serialLot) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of String(serialLot).split(/[,;\n]+/)) {
      const s = part.trim();
      if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
    }
    return out;
  }

  function serialError(message: string, status: number): Error {
    return Object.assign(new Error(message), { status });
  }

  /** Tracking từng sản phẩm (batch 1 query). Thiếu tracking (hàng cũ/mock) = QUANTITY. */
  async function productTrackings(productIds: string[]): Promise<Map<string, string>> {
    const uniq = [...new Set((productIds || []).filter(Boolean))];
    if (uniq.length === 0) return new Map();
    const rows = await db.all(
      `SELECT id, tracking FROM products WHERE id IN (${uniq.map(() => '?').join(', ')})`,
      uniq
    ).catch(() => []);
    return new Map((rows || []).map((r: any) => [r.id, resolveTracking(r.tracking)]));
  }

  /** Dòng có bắt buộc quản lý theo Serial? (tracking SERIAL hoặc cờ legacy serialRequired) */
  function requiresSerial(line: any, tracking: string): boolean {
    return Number(line?.serialRequired) === 1 || tracking === 'SERIAL';
  }

  /** Số lượng đã đăng ký (nhập) hoặc phân bổ (xuất/điều chuyển) theo Lô của dòng. */
  async function lotCoverage(doc: any, line: any): Promise<number> {
    if (doc.docType === 'RECEIPT') {
      const row = await db.get(
        `SELECT COALESCE(SUM(initialQty), 0) AS total FROM stock_lots
         WHERE receiptDocumentId = ? AND receiptLineId = ?`,
        [doc.id, line.id]
      ).catch(() => undefined);
      return Number(row?.total || 0);
    }
    const row = await db.get(
      `SELECT COALESCE(SUM(quantity), 0) AS total FROM stock_document_line_lots
       WHERE documentLineId = ?`,
      [line.id]
    ).catch(() => undefined);
    return Number(row?.total || 0);
  }

  /** Chốt hoàn tất theo từng dòng, tính lại từ DB (không tin client).
   * SERIAL: đủ serial từng chiếc; LOT: đủ số lượng đã đăng ký/phân bổ lô;
   * QUANTITY: chỉ kiểm tra tồn khi xuất. */
  async function canComplete(doc: any, lines: any[], reservationCredit?: Map<string, number>): Promise<{ ok: boolean; message?: string }> {
    const trackings = await productTrackings(lines.map((line) => line.productId));
    for (const line of lines) {
      const tracking = trackings.get(line.productId) || 'QUANTITY';
      const qty = Number(line.quantity);
      const label = line.productId;
      if (requiresSerial(line, tracking) && Number(line.serialSkipped) !== 1) {
        const serials = parseSerials(line.serialLot);
        if (serials.length !== qty) {
          if (serials.length === 0) {
            return { ok: false, message: `Chưa đủ Serial: dòng ${label} mới có 0/${qty}. Vui lòng mở Xử lý hàng hóa và quét đủ Serial trước khi hoàn tất.` };
          }
          return { ok: false, message: `Chưa đủ Serial: dòng ${label} mới có ${serials.length}/${qty}. Vui lòng tiếp tục xử lý hàng hóa để quét đủ Serial.` };
        }
        continue;
      }
      if (tracking === 'LOT' && doc.docType !== 'RETURN') {
        const covered = await lotCoverage(doc, line);
        if (covered < qty) {
          return { ok: false, message: `Chưa đủ Lô: dòng ${label} mới phân bổ ${covered}/${qty}. Vui lòng chọn đủ lô trước khi hoàn tất.` };
        }
      }
    }
    if (doc.docType === 'ISSUE') {
      const aggregate = aggregateLines(lines);
      const available = await availableMap(doc.warehouseId, aggregate.map((line) => ({ productId: line.productId, locationId: line.locationId || '' })));
      for (const line of aggregate) {
        const key = `${line.productId}|${line.locationId || ''}`;
        const current = (available.get(key) ?? 0) + (reservationCredit?.get(key) ?? 0);
        if (current < Number(line.quantity)) {
          return { ok: false, message: await insufficientStockMessage(doc.warehouseId, line, current) };
        }
      }
    }
    return { ok: true };
  }

  async function assertProcessable(doc: any, lines: any[], reservationCredit?: Map<string, number>): Promise<void> {
    const r = await canComplete(doc, lines, reservationCredit);
    if (!r.ok) throw Object.assign(new Error(r.message), { status: 400 });
  }

  /** Kiểm tra điều kiện ghi sổ theo đúng thứ tự ưu tiên: kho đang kiểm kê (409)
   * phải được báo trước mọi lỗi chi tiết dòng hàng (thiếu Serial, thiếu tồn...).
   * `warehouseId` là kho thực sự bị ghi sổ ở bước này (ship = nguồn, receive = đích). */
  async function preflightPosting(doc: any, lines: any[], warehouseId: string, reservationCredit?: Map<string, number>): Promise<void> {
    if (warehouseId) await assertNotCounting(warehouseId);
    await assertProcessable(doc, lines, reservationCredit);
  }

  /** Phiếu đã bắt đầu xử lý Serial/Lot? (serial đã gắn hoặc dòng đã PARTIAL/COMPLETED) */
  async function processingStarted(documentId: string): Promise<boolean> {
    const s = await db.get(
      'SELECT id FROM stock_serials WHERE receiptDocumentId = ? OR issueDocumentId = ? LIMIT 1',
      [documentId, documentId]
    );
    if (s) return true;
    const l = await db.get(
      `SELECT id FROM stock_document_lines WHERE documentId = ? AND processingStatus <> 'PENDING' LIMIT 1`,
      [documentId]
    );
    return !!l;
  }

  /** Reset xử lý nhưng không phá lịch sử Serial của hàng xuất/điều chuyển.
   * Phiếu nhập nháp chỉ được xóa Serial do chính nó tạo; phiếu xuất/điều chuyển
   * chỉ nhả RESERVED về IN_STOCK. */
  async function resetDocProcessing(documentId: string): Promise<void> {
    const doc = await db.get('SELECT docType FROM stock_documents WHERE id = ?', [documentId]);
    const issued = await db.get(
      `SELECT id FROM stock_serials WHERE receiptDocumentId = ? AND stockStatus = 'OUT' LIMIT 1`,
      [documentId]
    );
    if (issued) {
      throw Object.assign(new Error('Serial của phiếu đã xuất kho, không thể reset xử lý. Hãy dùng phiếu điều chỉnh/trả hàng.'), { status: 409 });
    }
    if (doc?.docType === 'RECEIPT') {
      await db.run(`DELETE FROM stock_serials WHERE receiptDocumentId = ? AND stockStatus IN ('IN_STOCK', 'RESERVED')`, [documentId]);
    } else {
      await releaseReservedSerials(documentId);
    }
    await db.run(`DELETE FROM stock_lot_movements WHERE referenceId = ?`, [documentId]);
    await db.run(`DELETE FROM stock_lots WHERE receiptDocumentId = ?`, [documentId]);
    await db.run(
      `DELETE a FROM stock_document_line_lots a
       INNER JOIN stock_document_lines l ON l.id = a.documentLineId
       WHERE l.documentId = ?`,
      [documentId]
    );
    await db.run(
      `UPDATE stock_document_lines SET processingStatus = 'PENDING', actualQty = NULL, varianceQty = NULL, varianceReason = NULL WHERE documentId = ?`,
      [documentId]
    );
  }

  /** Dọn lô/cuộn của phiếu hủy/xóa (chưa từng nhập kho chính thức). */
  async function dropDocLots(documentId: string): Promise<void> {
    await db.run(`DELETE FROM stock_lot_movements WHERE referenceId = ?`, [documentId]);
    await db.run(`DELETE FROM stock_lots WHERE receiptDocumentId = ?`, [documentId]);
    await db.run(
      `DELETE a FROM stock_document_line_lots a
       INNER JOIN stock_document_lines l ON l.id = a.documentLineId
       WHERE l.documentId = ?`,
      [documentId]
    );
  }

  /** Nhả serial đang RESERVED cho phiếu (hủy/xóa nháp): về IN_STOCK, xóa link xuất. */
  async function releaseReservedSerials(documentId: string): Promise<void> {
    await db.run(
      `UPDATE stock_serials SET stockStatus = 'IN_STOCK', issueDocumentId = NULL, issueLineId = NULL, updatedAt = ? WHERE issueDocumentId = ? AND stockStatus = 'RESERVED'`,
      [new Date().toISOString(), documentId]
    );
  }

  /** Bỏ liên kết giữ hàng của phiếu nhưng KHÔNG nhả reservation.
   * Reservation vẫn HELD để người dùng có thể gắn cho phiếu xuất khác. */
  async function dropDocReservationLinks(documentId: string): Promise<void> {
    await db.run(
      `DELETE rl FROM stock_document_line_reservations rl
       INNER JOIN stock_document_lines l ON l.id = rl.documentLineId
       WHERE l.documentId = ?`,
      [documentId]
    );
  }

  /** Liên kết giữ hàng còn hiệu lực của một phiếu xuất, kèm dữ liệu reservation. */
  async function loadIssueReservationLinks(documentId: string): Promise<any[]> {
    return db.all(
      `SELECT rl.id AS linkId, rl.documentLineId, rl.reservationId,
              rl.quantity AS allocatedQuantity,
              r.productId, r.warehouseId, r.locationId, r.quantity, r.consumedQuantity, r.status
       FROM stock_document_line_reservations rl
       INNER JOIN reservations r ON r.id = rl.reservationId
       INNER JOIN stock_document_lines l ON l.id = rl.documentLineId
       WHERE l.documentId = ? AND r.status = 'HELD'`,
      [documentId]
    ).catch(() => []);
  }

  /** Lượng đang giữ cho chính phiếu xuất này; được cộng lại khi kiểm tra khả dụng
   * vì stock_balances.reserved đã trừ phần đó. */
  function reservationCreditFromLinks(links: any[]): Map<string, number> {
    const credit = new Map<string, number>();
    for (const link of links || []) {
      const remaining = Math.max(0, Number(link.quantity || 0) - Number(link.consumedQuantity || 0));
      const quantity = Math.min(Number(link.allocatedQuantity || 0), remaining);
      if (!(quantity > 0)) continue;
      const key = `${link.productId}|${link.locationId || ''}`;
      credit.set(key, (credit.get(key) || 0) + quantity);
    }
    return credit;
  }

  /** Ghi liên kết reservation cho các dòng vừa lưu. Mỗi reservation chỉ được
   * gắn cho một dòng; số lượng link không vượt quá phần còn giữ của reservation
   * và không vượt quá số lượng dòng. */
  async function syncDocumentReservationLinks(
    warehouseId: string,
    lines: any[],
    savedLines: { id: string; productId: string; locationId: string; quantity: number }[]
  ): Promise<void> {
    const selections = lines
      .map((line, index) => ({ line, target: savedLines[index] }))
      .filter((entry) => entry.target && Array.isArray(entry.line?.reservationIds));
    if (selections.length === 0) return;

    const reservationIds = [...new Set(selections.flatMap(({ line }) =>
      (line.reservationIds as string[]).map((id: string) => String(id).trim()).filter(Boolean)
    ))];
    if (reservationIds.length === 0) return;

    const rows = await db.all(
      `SELECT * FROM reservations WHERE id IN (${reservationIds.map(() => '?').join(', ')}) FOR UPDATE`,
      reservationIds
    );
    const byId = new Map((rows || []).map((row: any) => [row.id, row]));
    const now = new Date().toISOString();

    for (const { line, target } of selections) {
      const ids = [...new Set((line.reservationIds as string[]).map((id: string) => String(id).trim()).filter(Boolean))];
      if (ids.length === 0) continue;
      let lineRemaining = Number(target.quantity || 0);
      for (const reservationId of ids) {
        const reservation: any = byId.get(reservationId);
        if (!reservation) {
          throw Object.assign(new Error(`Không tìm thấy giữ hàng ${reservationId}.`), { status: 400 });
        }
        if (reservation.status !== 'HELD') {
          throw Object.assign(new Error(`Giữ hàng ${reservationId} không còn ở trạng thái đang giữ.`), { status: 400 });
        }
        if (reservation.productId !== target.productId
          || reservation.warehouseId !== warehouseId
          || (reservation.locationId || '') !== (target.locationId || '')) {
          throw Object.assign(new Error(`Giữ hàng ${reservationId} không khớp sản phẩm/kho/vị trí của dòng.`), { status: 400 });
        }
        const reservedRemaining = Math.max(0, Number(reservation.quantity || 0) - Number(reservation.consumedQuantity || 0));
        const quantity = Math.min(lineRemaining, reservedRemaining);
        if (!(quantity > 0)) {
          throw Object.assign(new Error(`Giữ hàng ${reservationId} không còn đủ số lượng cho dòng.`), { status: 400 });
        }
        try {
          await db.run(
            `INSERT INTO stock_document_line_reservations
             (id, documentLineId, reservationId, quantity, createdAt)
             VALUES (?, ?, ?, ?, ?)`,
            [randomUUID(), target.id, reservationId, quantity, now]
          );
        } catch (e: any) {
          if (e?.message?.includes('Duplicate')) {
            throw Object.assign(new Error(`Giữ hàng ${reservationId} đang được gắn cho phiếu khác.`), { status: 409 });
          }
          throw e;
        }
        lineRemaining -= quantity;
      }
    }
  }

  /** Tiêu thụ phần reservation đã gắn cho phiếu xuất. Chỉ giảm reserved,
   * không tạo thêm stock_move vì move của phiếu đã trừ onHand. */
  async function consumeIssueReservationLinks(doc: any, links: any[]): Promise<void> {
    if (!links || links.length === 0) return;
    const now = new Date().toISOString();
    for (const link of links) {
      const reservationQuantity = Number(link.quantity || 0);
      const alreadyConsumed = Number(link.consumedQuantity || 0);
      const remaining = Math.max(0, reservationQuantity - alreadyConsumed);
      const quantity = Math.min(Number(link.allocatedQuantity || 0), remaining);
      if (!(quantity > 0)) continue;
      const nextConsumed = alreadyConsumed + quantity;
      const nextStatus = nextConsumed >= reservationQuantity ? 'CONSUMED' : 'HELD';
      await db.run(
        'UPDATE reservations SET consumedQuantity = ?, status = ? WHERE id = ?',
        [nextConsumed, nextStatus, link.reservationId]
      );
      await adjustReserved(db.run.bind(db), {
        kind: 'DECREMENT_CLAMPED', productId: link.productId, warehouseId: link.warehouseId,
        locationId: link.locationId, delta: quantity, now,
      });
    }
    await dropDocReservationLinks(doc.id);
  }

  /** Đăng ký serial/lot khi hoàn tất NHẬP: dòng nào NV đã nhập serial thì lưu
   * vết bảo hành (warrantyStart = ngày hạch toán, months theo sản phẩm).
   * 1 mã cho cả dòng SL>1 -> lưu dạng lô; nhiều mã -> mỗi mã 1 serial và
   * số lượng mã phải khớp số lượng (khi đã nhập). */
  async function registerReceiptSerials(doc: any, lines: any[], user: any): Promise<void> {
    const trackings = await productTrackings(lines.map((l) => l.productId));
    const withSerials = lines.filter(
      (l) => requiresSerial(l, trackings.get(l.productId) || 'QUANTITY') && parseSerials(l.serialLot).length > 0
    );
    if (withSerials.length === 0) return;
    const productIds = [...new Set(withSerials.map((l) => l.productId))];
    const products = await db.all(
      `SELECT id, warrantyMonths FROM products WHERE id IN (${productIds.map(() => '?').join(', ')})`,
      productIds
    ).catch(() => []);
    const warrantyByProduct = new Map((products || []).map((p: any) => [p.id, Math.max(0, Number(p.warrantyMonths) || 0)]));
    const warrantyStart = String(doc.postingDate || doc.docDate || new Date().toISOString()).slice(0, 10);
    const now = new Date().toISOString();
    const serialRows: { line: any; serial: string }[] = [];
    for (const line of withSerials) {
      const serials = parseSerials(line.serialLot);
      const qty = Number(line.quantity);
      if (serials.length !== qty) {
        throw serialError(`Dòng ${line.productId}: đã nhập ${serials.length} serial nhưng số lượng ${qty} — quét đủ serial từng chiếc`, 400);
      }
      for (const serial of serials) serialRows.push({ line, serial });
    }

    const allSerials = serialRows.map((row) => row.serial);
    const dupes = await db.all(
      `SELECT serialNumber FROM stock_serials WHERE serialNumber IN (${allSerials.map(() => '?').join(', ')})`,
      allSerials
    ).catch(() => []);
    if ((dupes || []).length > 0) {
      throw serialError(`Serial ${(dupes[0] as any).serialNumber} đã được ghi nhận trước đó. Hãy kiểm tra phiếu nhập cũ hoặc nhập một Serial khác.`, 409);
    }

    // Phiếu nhập lớn ghi theo lô; phiếu nhỏ giữ từng insert để không đổi hành vi cũ.
    if (serialRows.length > 20) {
      const CHUNK = 200;
      for (let offset = 0; offset < serialRows.length; offset += CHUNK) {
        const chunk = serialRows.slice(offset, offset + CHUNK);
        const placeholders = chunk.map(() => `(?, ?, ?, NULL, ?, ?, 'SALEABLE', ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, 'IN_STOCK', ?)`).join(', ');
        const params = chunk.flatMap(({ line, serial }) => [
          randomUUID(), line.productId, serial, doc.warehouseId, line.locationId || null,
          doc.partnerName ?? null, doc.id, warrantyStart, warrantyByProduct.get(line.productId) ?? 0,
          user.id, now, now, doc.id, line.id, now,
        ]);
        try {
          await db.run(
            `INSERT INTO stock_serials (id, productId, serialNumber, lotCode, warehouseId, locationId, status, supplier, receiptId, customerName, projectId, warrantyStart, warrantyMonths, notes, createdBy, createdAt, updatedAt, receiptDocumentId, receiptLineId, stockStatus, receivedAt)
             VALUES ${placeholders}`,
            params
          );
        } catch (e: any) {
          if (e.message?.includes('Duplicate')) {
            throw serialError(`Một Serial trong phiếu đã được ghi nhận trước đó. Hãy kiểm tra phiếu nhập cũ hoặc nhập Serial khác.`, 409);
          }
          throw e;
        }
      }
    } else {
      for (const { line, serial } of serialRows) {
        try {
          await db.run(
            `INSERT INTO stock_serials (id, productId, serialNumber, lotCode, warehouseId, locationId, status, supplier, receiptId, customerName, projectId, warrantyStart, warrantyMonths, notes, createdBy, createdAt, updatedAt, receiptDocumentId, receiptLineId, stockStatus, receivedAt)
             VALUES (?, ?, ?, NULL, ?, ?, 'SALEABLE', ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, 'IN_STOCK', ?)`,
            [randomUUID(), line.productId, serial, doc.warehouseId, line.locationId || null,
              doc.partnerName ?? null, doc.id, warrantyStart, warrantyByProduct.get(line.productId) ?? 0,
              user.id, now, now, doc.id, line.id, now]
          );
        } catch (e: any) {
          if (e.message?.includes('Duplicate')) {
            throw serialError(`Serial ${serial} đã được ghi nhận trước đó. Hãy kiểm tra phiếu nhập cũ hoặc nhập một Serial khác.`, 409);
          }
          throw e;
        }
      }
    }
  }

  /** Trừ số lượng LOT đã phân bổ cho dòng xuất và ghi audit movement.
   * Khóa từng lô trong cùng transaction với chứng từ để hai PXK không thể
   * cùng tiêu vượt remainingQty. */
  async function consumeIssueLots(doc: any, lines: any[], user: any): Promise<Map<string, any[]>> {
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const trackings = await productTrackings(productIds);
    const candidates = lines.filter((line) => Number(line.serialRequired) !== 1);
    const isLotTracked = (line: any) => trackings.get(line.productId) === 'LOT';
    const postingsByLine = new Map<string, any[]>();
    if (candidates.length === 0) return postingsByLine;

    const consumeAllocations = async (line: any, allocations: any[]) => {
      for (const allocation of allocations) {
        const lot = await db.get(
          `SELECT id, productId, warehouseId, lotCode, remainingQty, status
           FROM stock_lots WHERE id = ? FOR UPDATE`,
          [allocation.lotId]
        );
        const quantity = Number(allocation.quantity || 0);
        if (!lot || lot.productId !== line.productId || lot.warehouseId !== doc.warehouseId || lot.status !== 'ACTIVE') {
          throw serialError(`Lô ${allocation.lotCode || allocation.lotId} không còn hợp lệ trong kho`, 400);
        }
        if (Number(lot.remainingQty || 0) < quantity) {
          throw serialError(`Lô ${lot.lotCode} chỉ còn ${Number(lot.remainingQty || 0)}, không đủ xuất ${quantity}`, 400);
        }
        const now = new Date().toISOString();
        await db.run(
          `UPDATE stock_lots SET remainingQty = remainingQty - ?,
             status = CASE WHEN remainingQty - ? <= 0 THEN 'DEPLETED' ELSE status END,
             updatedAt = ? WHERE id = ?`,
          [quantity, quantity, now, lot.id]
        );
        await db.run(
          `INSERT INTO stock_lot_movements
           (id, lotId, productId, warehouseId, quantity, moveType, referenceType, referenceId, documentLineId, createdBy, createdAt)
           VALUES (?, ?, ?, ?, ?, 'ISSUE', 'ISSUE', ?, ?, ?, ?)`,
          [randomUUID(), lot.id, line.productId, doc.warehouseId, -quantity, doc.id, line.id, user.id, now]
        );
      }
    };

    // Một dòng LOT giữ nguyên truy vấn cũ (tương thích mock/legacy).
    if (candidates.length === 1) {
      const line = candidates[0];
      if (!isLotTracked(line)) return postingsByLine;
      const allocations = await db.all(
        `SELECT a.lotId, a.quantity, s.lotCode
         FROM stock_document_line_lots a
         INNER JOIN stock_lots s ON s.id = a.lotId
         WHERE a.documentLineId = ? ORDER BY s.createdAt ASC, s.id ASC`,
        [line.id]
      );
      const rows = allocations || [];
      const allocated = rows.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
      if (allocated < Number(line.quantity)) {
        throw serialError(`Dòng ${line.productId}: đã phân bổ ${allocated}/${Number(line.quantity)} theo lô`, 400);
      }
      postingsByLine.set(line.id, rows);
      await consumeAllocations(line, rows);
      return postingsByLine;
    }

    // Nhiều dòng: gom coverage + allocation thành hai truy vấn. Dòng QUANTITY
    // không có phân bổ lô vẫn đi tiếp như hàng số lượng.
    const lineIds = candidates.map((line) => line.id);
    const coverageRows = await db.all(
      `SELECT a.documentLineId, COALESCE(SUM(quantity), 0) AS covered
       FROM stock_document_line_lots a
       WHERE a.documentLineId IN (${lineIds.map(() => '?').join(', ')})
       GROUP BY a.documentLineId`,
      lineIds
    );
    const coverage = new Map<string, number>();
    for (const row of coverageRows || []) {
      const covered = row.covered !== undefined && row.covered !== null
        ? Number(row.covered || 0)
        : Number(row.quantity || 0);
      coverage.set(row.documentLineId, (coverage.get(row.documentLineId) || 0) + covered);
    }

    const allocationRows = await db.all(
      `SELECT a.documentLineId, a.lotId, a.quantity, s.lotCode
       FROM stock_document_line_lots a
       INNER JOIN stock_lots s ON s.id = a.lotId
       WHERE a.documentLineId IN (${lineIds.map(() => '?').join(', ')})
       ORDER BY s.createdAt ASC, s.id ASC`,
      lineIds
    );
    for (const line of candidates) {
      const allocations = (allocationRows || []).filter((row: any) => row.documentLineId === line.id);
      const allocated = coverage.get(line.id) ?? 0;
      if (!isLotTracked(line) && allocated <= 0) continue;
      postingsByLine.set(line.id, allocations);
      if (allocated < Number(line.quantity)) {
        throw serialError(`Dòng ${line.productId}: đã phân bổ ${allocated}/${Number(line.quantity)} theo lô`, 400);
      }
      await consumeAllocations(line, allocations);
    }
    return postingsByLine;
  }

  /** Trừ serial khi hoàn tất XUẤT: serial đã nhập phải tồn tại (IN_STOCK,
   * đúng kho) và đủ số lượng dòng -> đánh dấu SOLD + khách hàng. */
  async function consumeIssueSerials(doc: any, lines: any[], user: any): Promise<void> {
    const trackings = await productTrackings(lines.map((l) => l.productId));
    const withSerials = lines.filter(
      (l) => requiresSerial(l, trackings.get(l.productId) || 'QUANTITY') && parseSerials(l.serialLot).length > 0
    );
    if (withSerials.length === 0) return;
    const warrantyStartType = await getWarrantyStartType(db);
    for (const line of withSerials) {
      const serials = parseSerials(line.serialLot);
      const qty = Number(line.quantity);
      if (serials.length !== qty) {
        throw serialError(`Dòng ${line.productId}: đã nhập ${serials.length} serial nhưng số lượng ${qty} — chọn đúng từng chiếc xuất`, 400);
      }
      const nowOut = new Date().toISOString();
      const warrantyStartFor = (row: any) => resolveWarrantyStart({
        startType: warrantyStartType,
        outboundDate: nowOut,
        deliveryDate: doc.deliveryDate,
        installationDate: doc.installationDate,
        acceptanceDate: doc.acceptanceDate,
        fallbackDate: row?.warrantyStart,
      });

      if (serials.length > 20) {
        const rows = await db.all(
          `SELECT id, serialNumber, stockStatus, issueDocumentId, issueLineId, warrantyStart
           FROM stock_serials
           WHERE serialNumber IN (${serials.map(() => '?').join(', ')})
             AND productId = ? AND warehouseId = ? AND status = 'SALEABLE'
             AND (stockStatus IS NULL OR stockStatus = 'IN_STOCK'
               OR (stockStatus = 'RESERVED' AND issueDocumentId = ? AND issueLineId = ?))
           FOR UPDATE`,
          [...serials, line.productId, doc.warehouseId, doc.id, line.id]
        );
        const bySerial = new Map((rows || []).map((row: any) => [row.serialNumber, row]));
        const ordered = serials.map((sn) => {
          const row: any = bySerial.get(sn);
          if (!row) throw serialError(`Serial ${sn} không có trong tồn bán được của kho`, 400);
          if (row.issueDocumentId && row.issueDocumentId !== doc.id) {
            throw serialError(`Serial ${sn} đang được giữ cho phiếu khác`, 400);
          }
          return row;
        });
        const cases = ordered.map(() => 'WHEN ? THEN ?').join(' ');
        const ids = ordered.map((row) => row.id);
        await db.run(
          `UPDATE stock_serials
           SET status = 'SOLD', stockStatus = 'OUT',
               outDate = CASE id ${cases} END, customerName = ?,
               issueDocumentId = ?, issueLineId = ?,
               warrantyStart = COALESCE(CASE id ${cases} END, warrantyStart), updatedAt = ?
           WHERE id IN (${ids.map(() => '?').join(', ')})`,
          [...ordered.flatMap((row) => [row.id, nowOut]), doc.partnerName ?? null, doc.id, line.id,
            ...ordered.flatMap((row) => [row.id, warrantyStartFor(row)]), nowOut, ...ids]
        );
        continue;
      }

      for (const sn of serials) {
        const row = await db.get(
          `SELECT id, stockStatus, issueDocumentId, issueLineId FROM stock_serials WHERE serialNumber = ? AND productId = ? AND warehouseId = ? AND status = 'SALEABLE'
           AND (stockStatus IS NULL OR stockStatus = 'IN_STOCK' OR (stockStatus = 'RESERVED' AND issueDocumentId = ? AND issueLineId = ?)) LIMIT 1 FOR UPDATE`,
          [sn, line.productId, doc.warehouseId, doc.id, line.id]
        );
        if (!row) throw serialError(`Serial ${sn} không có trong tồn bán được của kho`, 400);
        // Hàng legacy/mock thiếu stockStatus được coi như IN_STOCK; RESERVED cho phiếu khác thì chặn.
        if (row.issueDocumentId && row.issueDocumentId !== doc.id) {
          throw serialError(`Serial ${sn} đang được giữ cho phiếu khác`, 400);
        }
        const wStart = warrantyStartFor(row);
        await db.run(
          `UPDATE stock_serials SET status = 'SOLD', stockStatus = 'OUT', outDate = ?, customerName = ?, issueDocumentId = ?, issueLineId = ?, warrantyStart = COALESCE(?, warrantyStart), updatedAt = ? WHERE id = ?`,
          [nowOut, doc.partnerName ?? null, doc.id, line.id, wStart, nowOut, (row as any).id]
        );
      }
    }
  }

  /** Kiểm tra các SERIAL đã RESERVED cho phiếu điều chuyển khi ship.
   * Scan-out đã giữ serial và gắn issueDocumentId/issueLineId; ship chỉ chốt
   * rằng toàn bộ serial của dòng vẫn còn đúng kho nguồn. */
  async function assertTransferSerialsReady(doc: any, lines: any[]): Promise<void> {
    const trackings = await productTrackings(lines.map((l) => l.productId));
    const serialLines = lines.filter((line) => requiresSerial(line, trackings.get(line.productId) || 'QUANTITY'));
    if (serialLines.length === 0) return;
    const rows = await db.all(
      `SELECT id, productId, serialNumber, issueLineId
       FROM stock_serials
       WHERE issueDocumentId = ? AND warehouseId = ? AND stockStatus = 'RESERVED'
       FOR UPDATE`,
      [doc.id, doc.sourceWarehouseId]
    );
    const bySerial = new Map((rows || []).map((row: any) => [row.serialNumber, row]));
    for (const line of serialLines) {
      const serials = parseSerials(line.serialLot);
      if (serials.length !== Number(line.quantity)) {
        throw serialError(`Dòng ${line.productId}: chưa đủ Serial (${serials.length}/${Number(line.quantity)})`, 400);
      }
      for (const serial of serials) {
        const row: any = bySerial.get(serial);
        if (!row || row.issueLineId !== line.id
          || (row.productId && row.productId !== line.productId)) {
          throw serialError(`Serial ${serial} chưa được giữ cho phiếu điều chuyển`, 400);
        }
      }
    }
  }

  /** Khi nhận điều chuyển, đưa các SERIAL đang RESERVED của phiếu vào kho đích. */
  async function receiveTransferSerials(doc: any, locationId: string): Promise<void> {
    const rows = await db.all(
      `SELECT id, productId, issueLineId FROM stock_serials
       WHERE issueDocumentId = ? AND stockStatus = 'RESERVED' FOR UPDATE`,
      [doc.id]
    ).catch(() => []);
    const now = new Date().toISOString();
    for (const row of rows || []) {
      await db.run(
        `UPDATE stock_serials SET warehouseId = ?, locationId = ?, stockStatus = 'IN_STOCK',
         issueDocumentId = NULL, issueLineId = NULL, updatedAt = ? WHERE id = ?`,
        [doc.destWarehouseId, locationId || null, now, row.id]
      );
    }
  }

  /** Trừ LOT ở kho nguồn khi ship và lưu mapping để receive tạo LOT đích. */
  async function consumeTransferLotsOnShip(doc: any, lines: any[], user: any): Promise<void> {
    const trackings = await productTrackings(lines.map((l) => l.productId));
    for (const line of lines) {
      if (Number(line.serialRequired) === 1 || trackings.get(line.productId) !== 'LOT') continue;
      const allocations = await db.all(
        `SELECT a.lotId, a.quantity, s.lotCode
         FROM stock_document_line_lots a INNER JOIN stock_lots s ON s.id = a.lotId
         WHERE a.documentLineId = ? ORDER BY s.createdAt ASC, s.id ASC`,
        [line.id]
      );
      const allocated = (allocations || []).reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
      if (allocated < Number(line.quantity)) {
        throw serialError(`Dòng ${line.productId}: đã phân bổ ${allocated}/${Number(line.quantity)} theo lô`, 400);
      }
      for (const allocation of allocations || []) {
        const lot = await db.get(
          `SELECT id, productId, warehouseId, lotCode, coilCode, remainingQty, initialQty, unit,
                  manufacturedAt, supplier, receiptDocumentId, receiptLineId, status
           FROM stock_lots WHERE id = ? FOR UPDATE`,
          [allocation.lotId]
        );
        const quantity = Number(allocation.quantity || 0);
        if (!lot || lot.productId !== line.productId || lot.warehouseId !== doc.sourceWarehouseId || lot.status !== 'ACTIVE') {
          throw serialError(`Lô ${allocation.lotCode || allocation.lotId} không còn hợp lệ ở kho nguồn`, 400);
        }
        if (Number(lot.remainingQty || 0) < quantity) {
          throw serialError(`Lô ${lot.lotCode} chỉ còn ${Number(lot.remainingQty || 0)}, không đủ điều chuyển ${quantity}`, 400);
        }
        const now = new Date().toISOString();
        await db.run(
          `UPDATE stock_lots SET remainingQty = remainingQty - ?,
             status = CASE WHEN remainingQty - ? <= 0 THEN 'DEPLETED' ELSE status END,
             updatedAt = ? WHERE id = ?`,
          [quantity, quantity, now, lot.id]
        );
        await db.run(
          `INSERT INTO stock_transfer_line_lots
           (id, documentLineId, sourceLotId, quantity, createdBy, createdAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [randomUUID(), line.id, lot.id, quantity, user.id, now]
        );
        await db.run(
          `INSERT INTO stock_lot_movements
           (id, lotId, productId, warehouseId, quantity, moveType, referenceType, referenceId, documentLineId, createdBy, createdAt)
           VALUES (?, ?, ?, ?, ?, 'TRANSFER_OUT', 'TRANSFER', ?, ?, ?, ?)`,
          [randomUUID(), lot.id, line.productId, doc.sourceWarehouseId, -quantity, doc.id, line.id, user.id, now]
        );
      }
    }
  }

  /** Tạo/cộng LOT tương ứng ở kho đích và ghi movement dương. */
  async function receiveTransferLots(doc: any, lines: any[], locationId: string, user: any): Promise<Set<string>> {
    const handledLines = new Set<string>();
    const trackings = await productTrackings(lines.map((l) => l.productId));
    for (const line of lines) {
      if (Number(line.serialRequired) === 1 || trackings.get(line.productId) !== 'LOT') continue;
      const links = await db.all(
        `SELECT t.id, t.sourceLotId, t.quantity, s.productId, s.lotCode, s.coilCode, s.unit,
                s.manufacturedAt, s.supplier, s.receiptDocumentId, s.receiptLineId
         FROM stock_transfer_line_lots t INNER JOIN stock_lots s ON s.id = t.sourceLotId
         WHERE t.documentLineId = ? FOR UPDATE`,
        [line.id]
      );
      for (const link of links || []) {
        const quantity = Number(link.quantity || 0);
        const now = new Date().toISOString();
        let destLot = await db.get(
          `SELECT * FROM stock_lots WHERE productId = ? AND warehouseId = ? AND lotCode = ? LIMIT 1 FOR UPDATE`,
          [link.productId, doc.destWarehouseId, link.lotCode]
        );
        if (destLot) {
          await db.run(
            `UPDATE stock_lots SET initialQty = initialQty + ?, remainingQty = remainingQty + ?,
             status = 'ACTIVE', locationId = ?, updatedAt = ? WHERE id = ?`,
            [quantity, quantity, locationId || null, now, destLot.id]
          );
        } else {
          const destLotId = randomUUID();
          await db.run(
            `INSERT INTO stock_lots
             (id, productId, lotCode, coilCode, warehouseId, locationId, initialQty, remainingQty, unit,
              manufacturedAt, supplier, receiptDocumentId, receiptLineId, status, createdBy, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
            [destLotId, link.productId, link.lotCode, link.coilCode, doc.destWarehouseId, locationId || null,
              quantity, quantity, link.unit, link.manufacturedAt, link.supplier, link.receiptDocumentId,
              link.receiptLineId, user.id, now, now]
          );
          destLot = { id: destLotId };
        }
        await db.run('UPDATE stock_transfer_line_lots SET destLotId = ? WHERE id = ?', [destLot.id, link.id]);
        await db.run(
          `INSERT INTO stock_lot_movements
           (id, lotId, productId, warehouseId, quantity, moveType, referenceType, referenceId, documentLineId, createdBy, createdAt)
           VALUES (?, ?, ?, ?, ?, 'TRANSFER_IN', 'TRANSFER', ?, ?, ?, ?)`,
          [randomUUID(), destLot.id, link.productId, doc.destWarehouseId, quantity, doc.id, line.id, user.id, now]
        );
        handledLines.add(line.id);
      }
    }
    return handledLines;
  }

  /** Ghi stock_moves theo đơn vị quản lý của từng dòng:
   * SERIAL = 1 move/chiếc, LOT = 1 move/lô đã đăng ký hoặc phân bổ,
   * QUANTITY = 1 move/dòng (theo số lượng thực tế đã xác nhận). */
  async function postDocumentMoves(
    doc: any,
    lines: any[],
    moveType: string,
    direction: 1 | -1,
    user: any,
    lotPostings?: Map<string, { lotId: string; quantity: number }[]>
  ): Promise<void> {
    const trackings = await productTrackings(lines.map((l) => l.productId));
    const moves: any[] = [];
    const serialLines = lines.filter((line) => {
      const tracking = trackings.get(line.productId) || 'QUANTITY';
      return requiresSerial(line, tracking) && Number(line.serialSkipped) !== 1;
    });

    // Một query cho mọi serial của chứng từ, tránh N+1 khi nhập/xuất hàng loạt.
    const serialByKey = new Map<string, any>();
    if (serialLines.length > 0) {
      const serials = serialLines.flatMap((line) => parseSerials(line.serialLot));
      if (serials.length > 0) {
        const rows = await db.all(
          `SELECT id, productId, serialNumber FROM stock_serials
           WHERE serialNumber IN (${serials.map(() => '?').join(', ')})
             AND (receiptDocumentId = ? OR issueDocumentId = ?)`,
          [...serials, doc.id, doc.id]
        ).catch(() => []);
        for (const row of rows || []) {
          serialByKey.set(`${row.productId}|${row.serialNumber}`, row);
        }
      }
    }

    const lotLines = lines.filter((line) => (trackings.get(line.productId) || 'QUANTITY') === 'LOT' || !!lotPostings?.has(line.id));
    const lotRowsByLine = new Map<string, any[]>();
    if (lotLines.length > 0) {
      if (doc.docType === 'RECEIPT') {
        if (lotLines.length === 1) {
          const line = lotLines[0];
          const rows = await db.all(
            `SELECT id AS lotId, initialQty AS quantity FROM stock_lots
             WHERE receiptDocumentId = ? AND receiptLineId = ?`,
            [doc.id, line.id]
          ).catch(() => []);
          lotRowsByLine.set(line.id, rows || []);
        } else {
          const rows = await db.all(
            `SELECT receiptLineId AS documentLineId, id AS lotId, initialQty AS quantity
             FROM stock_lots WHERE receiptDocumentId = ?`,
            [doc.id]
          ).catch(() => []);
          for (const row of rows || []) {
            const key = row.documentLineId;
            if (!lotRowsByLine.has(key)) lotRowsByLine.set(key, []);
            lotRowsByLine.get(key)!.push(row);
          }
        }
      } else if (doc.docType === 'RETURN') {
        for (const line of lotLines) lotRowsByLine.set(line.id, lotPostings?.get(line.id) || []);
      } else if (lotPostings) {
        for (const line of lotLines) lotRowsByLine.set(line.id, lotPostings.get(line.id) || []);
      } else {
        const lineIds = lotLines.map((line) => line.id);
        const rows = await db.all(
          `SELECT documentLineId, lotId, quantity FROM stock_document_line_lots
           WHERE documentLineId IN (${lineIds.map(() => '?').join(', ')})`,
          lineIds
        ).catch(() => []);
        for (const row of rows || []) {
          if (!lotRowsByLine.has(row.documentLineId)) lotRowsByLine.set(row.documentLineId, []);
          lotRowsByLine.get(row.documentLineId)!.push(row);
        }
      }
    }

    for (const line of lines) {
      const tracking = trackings.get(line.productId) || 'QUANTITY';
      if (requiresSerial(line, tracking) && Number(line.serialSkipped) !== 1) {
        for (const serial of parseSerials(line.serialLot)) {
          const serialRow = serialByKey.get(`${line.productId}|${serial}`);
          moves.push({
            productId: line.productId, warehouseId: doc.warehouseId, locationId: line.locationId || '',
            quantity: direction, moveType, referenceType: doc.docType, referenceId: doc.id,
            documentLineId: line.id, serialId: serialRow?.id ?? null, createdBy: user.id,
          });
        }
        continue;
      }
      if (tracking === 'LOT' || lotPostings?.has(line.id)) {
        const postings = lotRowsByLine.get(line.id) || [];
        for (const posting of postings) {
          const quantity = Number(posting.quantity || 0);
          if (!(quantity > 0)) continue;
          moves.push({
            productId: line.productId, warehouseId: doc.warehouseId, locationId: line.locationId || '',
            quantity: direction * quantity, moveType, referenceType: doc.docType, referenceId: doc.id,
            documentLineId: line.id, lotId: (posting as any).lotId ?? null, createdBy: user.id,
          });
        }
        continue;
      }
      moves.push({
        productId: line.productId, warehouseId: doc.warehouseId, locationId: line.locationId || '',
        quantity: direction * effectiveLineQuantity(line), moveType, referenceType: doc.docType, referenceId: doc.id,
        documentLineId: line.id, serialId: null, createdBy: user.id,
      });
    }
    await postMoves(db.run.bind(db), moves, { skipCountingCheck: true });
  }

  /** Ghi stock_moves cho điều chuyển theo tracking.
   * OUT lấy lô nguồn đã phân bổ; IN lấy lô đích đã tạo (destLotId). */
  async function postTransferMoves(
    doc: any,
    lines: any[],
    direction: 'OUT' | 'IN',
    destinationLocation: string,
    user: any
  ): Promise<void> {
    const isOut = direction === 'OUT';
    const warehouseId = isOut ? doc.sourceWarehouseId : doc.destWarehouseId;
    const moveType = isOut ? 'TRANSFER_OUT' : 'TRANSFER_IN';
    const trackings = await productTrackings(lines.map((l) => l.productId));
    const moves: any[] = [];
    const serialLines = lines.filter((line) => {
      const tracking = trackings.get(line.productId) || 'QUANTITY';
      return requiresSerial(line, tracking) && Number(line.serialSkipped) !== 1;
    });
    const serialByKey = new Map<string, any>();
    if (serialLines.length > 0) {
      const serials = serialLines.flatMap((line) => parseSerials(line.serialLot));
      if (serials.length > 0) {
        const rows = await db.all(
          isOut
            ? `SELECT id, productId, serialNumber FROM stock_serials
               WHERE serialNumber IN (${serials.map(() => '?').join(', ')})
                 AND warehouseId = ? AND stockStatus = 'RESERVED' AND issueDocumentId = ?`
            : `SELECT id, productId, serialNumber FROM stock_serials
               WHERE serialNumber IN (${serials.map(() => '?').join(', ')})
                 AND warehouseId = ?`,
          isOut ? [...serials, warehouseId, doc.id] : [...serials, warehouseId]
        ).catch(() => []);
        for (const row of rows || []) serialByKey.set(`${row.productId}|${row.serialNumber}`, row);
      }
    }

    for (const line of lines) {
      const tracking = trackings.get(line.productId) || 'QUANTITY';
      const locationId = isOut ? (line.locationId || '') : (destinationLocation || '');
      if (requiresSerial(line, tracking) && Number(line.serialSkipped) !== 1) {
        for (const serial of parseSerials(line.serialLot)) {
          const serialRow = serialByKey.get(`${line.productId}|${serial}`);
          moves.push({
            productId: line.productId, warehouseId, locationId,
            quantity: isOut ? -1 : 1, moveType, referenceType: 'TRANSFER', referenceId: doc.id,
            documentLineId: line.id, serialId: serialRow?.id ?? null, createdBy: user.id,
          });
        }
        continue;
      }
      if (tracking === 'LOT') {
        const postings = isOut
          ? await db.all(
              `SELECT lotId, quantity FROM stock_document_line_lots WHERE documentLineId = ?`,
              [line.id]
            )
          : await db.all(
              `SELECT destLotId AS lotId, quantity FROM stock_transfer_line_lots
               WHERE documentLineId = ? AND destLotId IS NOT NULL`,
              [line.id]
            );
        for (const posting of postings || []) {
          const quantity = Number(posting.quantity || 0);
          if (!(quantity > 0)) continue;
          moves.push({
            productId: line.productId, warehouseId, locationId,
            quantity: isOut ? -quantity : quantity, moveType, referenceType: 'TRANSFER', referenceId: doc.id,
            documentLineId: line.id, lotId: (posting as any).lotId ?? null, createdBy: user.id,
          });
        }
        continue;
      }
      moves.push({
        productId: line.productId, warehouseId, locationId,
        quantity: (isOut ? -1 : 1) * effectiveLineQuantity(line), moveType,
        referenceType: 'TRANSFER', referenceId: doc.id,
        documentLineId: line.id, serialId: null, createdBy: user.id,
      });
    }
    await postMoves(db.run.bind(db), moves, { skipCountingCheck: true });
  }

  /** Nhận lại serial khi hoàn tất TRẢ HÀNG: serial đã từng xuất (SOLD) được
   * đưa về SALEABLE tại vị trí trả + xóa khách; serial chưa từng đăng ký thì
   * ghi mới như nhập (giữ vết bảo hành theo sản phẩm). */
  async function registerReturnSerials(doc: any, lines: any[], user: any): Promise<void> {
    const trackings = await productTrackings(lines.map((l) => l.productId));
    const withSerials = lines.filter(
      (l) => requiresSerial(l, trackings.get(l.productId) || 'QUANTITY') && parseSerials(l.serialLot).length > 0
    );
    if (withSerials.length === 0) return;
    const productIds = [...new Set(withSerials.map((l) => l.productId))];
    const products = await db.all(
      `SELECT id, warrantyMonths FROM products WHERE id IN (${productIds.map(() => '?').join(', ')})`,
      productIds
    ).catch(() => []);
    const warrantyByProduct = new Map((products || []).map((p: any) => [p.id, Math.max(0, Number(p.warrantyMonths) || 0)]));
    const warrantyStart = String(doc.postingDate || doc.docDate || new Date().toISOString()).slice(0, 10);
    const now = new Date().toISOString();
    for (const line of withSerials) {
      const serials = parseSerials(line.serialLot);
      const qty = Number(line.quantity);
      if (serials.length !== qty) {
        throw serialError(`Dòng ${line.productId}: đã nhập ${serials.length} serial nhưng số lượng ${qty} — quét đủ serial từng chiếc`, 400);
      }
      for (const sn of serials) {
        const row = await db.get(
          `SELECT id, stockStatus, issueDocumentId FROM stock_serials WHERE serialNumber = ? AND productId = ? LIMIT 1 FOR UPDATE`,
          [sn, line.productId]
        );
        if (!row || (row as any).stockStatus !== 'OUT' || (row as any).issueDocumentId !== doc.referenceId) {
          throw serialError(`Serial ${sn} không còn ở trạng thái đã xuất của phiếu gốc; không thể hoàn tất phiếu trả.`, 409);
        }
        await db.run(
          `UPDATE stock_serials SET status = 'SALEABLE', stockStatus = 'IN_STOCK',
           warehouseId = ?, locationId = ?, receiptId = ?, receiptDocumentId = ?, receiptLineId = ?,
           issueDocumentId = NULL, issueLineId = NULL, customerName = NULL, receivedAt = ?,
           warrantyStart = ?, warrantyMonths = ?, updatedAt = ? WHERE id = ?`,
          [doc.warehouseId, line.locationId || null, doc.id, doc.id, line.id, now,
            warrantyStart, warrantyByProduct.get(line.productId) ?? 0, now, (row as any).id]
        );
      }
    }
  }

  /** Nhận lại hàng theo Lô khi hoàn tất TRẢ HÀNG: cộng/tạo lô ở kho trả,
   * ghi audit movement và trả về postings để ghi stock_moves đúng từng lô. */
  async function registerReturnLots(
    doc: any,
    lines: any[],
    user: any
  ): Promise<Map<string, { lotId: string; quantity: number }[]>> {
    const postings = new Map<string, { lotId: string; quantity: number }[]>();
    const trackings = await productTrackings(lines.map((l) => l.productId));
    for (const line of lines) {
      const tracking = trackings.get(line.productId) || 'QUANTITY';
      if (tracking !== 'LOT' || Number(line.serialRequired) === 1) continue;
      const quantity = effectiveLineQuantity(line);
      if (!(quantity > 0)) continue;
      const lotCode = parseSerials(line.serialLot)[0] || `RET-${doc.code || doc.id.slice(0, 8)}`;
      const now = new Date().toISOString();
      let lot = await db.get(
        `SELECT id FROM stock_lots
         WHERE productId = ? AND warehouseId = ? AND lotCode = ? LIMIT 1 FOR UPDATE`,
        [line.productId, doc.warehouseId, lotCode]
      );
      if (lot) {
        await db.run(
          `UPDATE stock_lots SET initialQty = initialQty + ?, remainingQty = remainingQty + ?,
           status = 'ACTIVE', locationId = ?, updatedAt = ? WHERE id = ?`,
          [quantity, quantity, line.locationId || null, now, lot.id]
        );
      } else {
        const lotId = randomUUID();
        await db.run(
          `INSERT INTO stock_lots
           (id, productId, lotCode, coilCode, warehouseId, locationId, initialQty, remainingQty, unit,
            manufacturedAt, supplier, receiptDocumentId, receiptLineId, status, createdBy, createdAt, updatedAt)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 'ACTIVE', ?, ?, ?)`,
          [lotId, line.productId, lotCode, doc.warehouseId, line.locationId || null,
            quantity, quantity, doc.id, line.id, user.id, now, now]
        );
        lot = { id: lotId };
      }
      await db.run(
        `INSERT INTO stock_lot_movements
         (id, lotId, productId, warehouseId, quantity, moveType, referenceType, referenceId, documentLineId, createdBy, createdAt)
         VALUES (?, ?, ?, ?, ?, 'RETURN', 'RETURN', ?, ?, ?, ?)`,
        [randomUUID(), lot.id, line.productId, doc.warehouseId, quantity, doc.id, line.id, user.id, now]
      );
      postings.set(line.id, [{ lotId: lot.id, quantity }]);
    }
    return postings;
  }

  async function appendLineSerial(line: any, serial: string, strictCount: boolean): Promise<{ count: number; completed: boolean }> {
    const current = parseSerials(line.serialLot);
    const next = [...current, serial.trim()];
    const qty = Number(line.quantity);
    // strict (quét từng chiếc): đủ khi count === qty. Legacy text flow cho
    // phép 1 mã phủ cả dòng SL>1 (lô) nên giữ rule nới lỏng ở complete-time.
    const completed = strictCount ? next.length === qty : (next.length === qty || (next.length === 1 && qty > 1));
    const joined = next.join('\n');
    await db.run(
      `UPDATE stock_document_lines SET serialLot = ?, processingStatus = ? WHERE id = ?`,
      [joined, completed ? 'COMPLETED' : 'PARTIAL', line.id]
    );
    return { count: next.length, completed };
  }

  async function touchProcessing(docId: string): Promise<void> {
    await db.run(`UPDATE stock_documents SET status = 'PROCESSING', updatedAt = ? WHERE id = ? AND status IN ('DRAFT', 'READY')`, [new Date().toISOString(), docId]);
  }

  /** Tự đóng bước xử lý hàng hóa khi toàn bộ dòng đã quét đủ Serial.
   * READY chỉ xác nhận xử lý, chưa tạo stock_move hay thay đổi tồn kho. */
  async function refreshProcessingAfterSerialScan(docId: string): Promise<boolean> {
    const pending = await db.get(
      `SELECT COUNT(*) AS incomplete FROM stock_document_lines
       WHERE documentId = ? AND processingStatus <> 'COMPLETED'`,
      [docId]
    );
    if (Number(pending?.incomplete || 0) > 0) {
      await touchProcessing(docId);
      return false;
    }
    await db.run(
      `UPDATE stock_documents SET status = ?, updatedAt = ?
       WHERE id = ? AND status IN ('DRAFT', 'PROCESSING')`,
      ['READY', new Date().toISOString(), docId]
    );
    return true;
  }

  return {
    createDocument,
    loadDocument,
    effectiveLineQuantity,
    aggregateLines,
    validateLines,
    availableMap,
    formatStockQuantity,
    insufficientStockMessage,
    parseSerials,
    serialError,
    productTrackings,
    requiresSerial,
    lotCoverage,
    canComplete,
    assertProcessable,
    preflightPosting,
    processingStarted,
    resetDocProcessing,
    dropDocLots,
    releaseReservedSerials,
    dropDocReservationLinks,
    loadIssueReservationLinks,
    reservationCreditFromLinks,
    syncDocumentReservationLinks,
    consumeIssueReservationLinks,
    registerReceiptSerials,
    consumeIssueLots,
    consumeIssueSerials,
    assertTransferSerialsReady,
    receiveTransferSerials,
    consumeTransferLotsOnShip,
    receiveTransferLots,
    postDocumentMoves,
    postTransferMoves,
    registerReturnSerials,
    registerReturnLots,
    appendLineSerial,
    touchProcessing,
    refreshProcessingAfterSerialScan,
  };
}

/** StockContext + helper chứng từ trong cùng một object phẳng để sub-router destructure. */
export type DocumentContext = StockContext & ReturnType<typeof createDocumentContext>;
