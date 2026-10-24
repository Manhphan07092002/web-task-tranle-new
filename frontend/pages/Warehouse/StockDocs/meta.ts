// Meta dùng chung cho trang chứng từ kho (tách từ StockDocsPage.tsx).
export type Kind = 'RECEIPT' | 'ISSUE' | 'TRANSFER' | 'RETURN';

export const KIND_META: Record<Kind, { title: string; code: string; actionDone: string }> = {
  RECEIPT: { title: 'Nhập kho', code: 'PNK', actionDone: 'Hoàn tất nhận hàng' },
  ISSUE: { title: 'Xuất kho', code: 'PXK', actionDone: 'Hoàn tất xuất hàng' },
  TRANSFER: { title: 'Điều chuyển', code: 'DCK', actionDone: 'Xác nhận' },
  RETURN: { title: 'Trả hàng', code: 'PTH', actionDone: 'Hoàn tất nhận lại hàng' },
};

export const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Nháp', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  PROCESSING: { label: 'Đang xử lý', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  READY: { label: 'Sẵn sàng hoàn tất', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  IN_TRANSIT: { label: 'Đang vận chuyển', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  DONE: { label: 'Hoàn tất', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CANCELLED: { label: 'Đã hủy', cls: 'bg-red-50 text-red-600 border-red-200' },
};
