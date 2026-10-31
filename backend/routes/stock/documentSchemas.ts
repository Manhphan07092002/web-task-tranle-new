import { z } from 'zod';

// VAT mặc định theo quy ước nghiệp vụ hiện tại. Người có thẩm quyền vẫn có
// thể thay đổi trên từng dòng; không dùng mã tài khoản mặc định cứng.
export const DEFAULT_VAT_RATE = 8;

export const LineSchema = z.object({
  productId: z.string().trim().min(1).max(191),
  quantity: z.number().finite().positive().max(1_000_000_000),
  unitPrice: z.number().finite().min(0).max(1_000_000_000_000).optional(),
  locationId: z.string().trim().max(191).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  accountDebit: z.string().max(32).nullable().optional(),
  accountCredit: z.string().max(32).nullable().optional(),
  vatRate: z.number().finite().min(0).max(100).optional(),
  vatAmount: z.number().finite().min(0).optional(),
  totalAmount: z.number().finite().min(0).optional(),
  projectId: z.string().max(191).nullable().optional(),
  costItem: z.string().max(100).nullable().optional(),
  serialLot: z.string().max(191).nullable().optional(),
  costObjectId: z.string().max(191).nullable().optional(),
  reservationIds: z.array(z.string().trim().min(1).max(191)).max(100).optional(),
  /** Dòng kiện nguồn — chỉ phiếu xuất dùng (§4.2); `packageId` được ghi theo DB
   * chứ không theo giá trị client, vì nó suy ra từ packageLineId. */
  packageLineId: z.string().trim().max(191).nullable().optional(),
  packageId: z.string().trim().max(191).nullable().optional(),
});
/** Dòng hàng bên trong một kiện (§4.1). Số lượng kiện là phân hoạch của dòng phiếu. */
export const PackageLineSchema = z.object({
  productId: z.string().trim().min(1).max(191),
  quantity: z.number().finite().positive().max(1_000_000_000),
  serialNumber: z.string().trim().max(191).nullable().optional(),
  lotCode: z.string().trim().max(191).nullable().optional(),
  expiryDate: z.string().trim().max(40).nullable().optional(),
  unitCost: z.number().finite().min(0).max(1_000_000_000_000).nullable().optional(),
});
export const PackageInputSchema = z.object({
  packageCode: z.string().trim().max(50).nullable().optional(),
  packageTypeId: z.string().trim().max(191).nullable().optional(),
  locationId: z.string().trim().max(191).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(PackageLineSchema).min(1).max(500),
});

export const ReceiptSchema = z.object({
  code: z.string().trim().max(100).optional(),
  warehouseId: z.string().trim().min(1).max(191),
  lines: z.array(LineSchema).min(1).max(500),
  packages: z.array(PackageInputSchema).max(500).optional(),
  receiptSubType: z.string().max(64).optional(),
  partnerCode: z.string().max(100).nullable().optional(),
  partnerName: z.string().max(255).nullable().optional(),
  partnerAddress: z.string().max(1000).nullable().optional(),
  deliverer: z.string().max(191).nullable().optional(),
  purchaserId: z.string().max(191).nullable().optional(),
  postingDate: z.string().max(191).nullable().optional(),
  docDate: z.string().max(40).nullable().optional(),
  invoiceNumber: z.string().max(100).nullable().optional(),
  invoiceDate: z.string().max(40).nullable().optional(),
  customsDeclarationNumber: z.string().max(100).nullable().optional(),
  invoiceLookupCode: z.string().max(100).nullable().optional(),
  invoiceLookupUrl: z.string().max(1000).nullable().optional(),
  totalPreTax: z.number().finite().min(0).optional(),
  vatRate: z.number().finite().min(0).max(100).optional(),
  vatAmount: z.number().finite().min(0).optional(),
  totalAmount: z.number().finite().min(0).optional(),
  shippingFee: z.number().finite().min(0).optional(),
  paymentStatus: z.string().max(32).optional(),
  paymentDueDate: z.string().max(40).nullable().optional(),
  attachments: z.union([z.string(), z.array(z.any())]).nullable().optional(),
  referenceType: z.string().max(64).nullable().optional(),
  referenceId: z.string().max(191).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});
export const TransferSchema = z.object({
  code: z.string().trim().max(100).optional(),
  sourceWarehouseId: z.string().trim().min(1).max(191),
  destWarehouseId: z.string().trim().min(1).max(191),
  lines: z.array(LineSchema).min(1).max(500),
  notes: z.string().max(5000).nullable().optional(),
});

export const DOC_CODE_PREFIX: Record<string, string> = { RECEIPT: 'PNK', ISSUE: 'PXK', TRANSFER: 'DCK', RETURN: 'PTH' };

export const RelocationSchema = z.object({
  warehouseId: z.string().trim().min(1).max(191),
  productId: z.string().trim().min(1).max(191),
  fromLocationId: z.string().trim().min(1).max(191),
  toLocationId: z.string().trim().min(1).max(191),
  quantity: z.number().positive(),
  notes: z.string().trim().max(500).optional(),
});


export const ScanSchema = z.object({
  documentId: z.string().trim().min(1).max(191),
  documentLineId: z.string().trim().min(1).max(191),
  serial: z.string().trim().min(1).max(191),
});

export const SerialEditSchema = z.object({
  documentId: z.string().trim().min(1).max(191),
  documentLineId: z.string().trim().min(1).max(191),
  serial: z.string().trim().min(1).max(191),
  replacement: z.string().trim().min(1).max(191).optional(),
});

export const SmartScanSchema = z.object({
  documentId: z.string().trim().min(1).max(191),
  serial: z.string().trim().min(1).max(191),
});

/**
 * Body lỗi cho luồng chứng từ. Giữ `code`/`details` có cấu trúc của PackageError
 * để FE định vị đúng kiện/dòng hàng lệch số lượng; lỗi cũ chỉ có message thì
 * response không đổi so với trước khi có kiện.
 */
export function documentErrorBody(error: any, fallback: string): Record<string, unknown> {
  const body: Record<string, unknown> = { error: error?.status ? error.message : fallback };
  if (error?.code) body.code = String(error.code);
  if (error?.details !== undefined) body.details = error.details;
  return body;
}

