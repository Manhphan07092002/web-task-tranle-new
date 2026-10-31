import { resolveTracking } from './tracking';

export type LineProcessingMode = 'SERIAL' | 'LOT_RECEIPT' | 'LOT_ISSUE' | 'QUANTITY';

/** Chọn cách xử lý một dòng phiếu: quét Serial, đăng ký/phân bổ lô hay xác nhận
 * số lượng. RETURN + LOT dùng xác nhận số lượng vì lô trả được ghi nhận tự động
 * khi hoàn tất phiếu. Dòng xuất đã xác nhận xuất lẻ (loose) cũng đi theo số lượng
 * vì lô của toàn bộ mã hàng đã bị tách. */
export function resolveLineProcessingMode(
  tracking: string | null | undefined,
  docType: string,
  loose = false
): LineProcessingMode {
  const resolved = resolveTracking(tracking);
  if (resolved === 'SERIAL') return 'SERIAL';
  if (resolved === 'LOT' && docType === 'RECEIPT') return 'LOT_RECEIPT';
  if (resolved === 'LOT' && docType === 'ISSUE' && loose) return 'QUANTITY';
  if (resolved === 'LOT' && (docType === 'ISSUE' || docType === 'TRANSFER')) return 'LOT_ISSUE';
  return 'QUANTITY';
}
