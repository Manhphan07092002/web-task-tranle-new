import { apiFetch } from './api';

export interface StockBalanceRow {
  productId: string;
  warehouseId: string;
  locationId: string;
  onHand: number;
  reserved: number;
  available: number;
  productName: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  locationCode: string | null;
  locationPurpose: string | null;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  region?: string;
  address?: string;
  isActive: boolean;
}

export async function getStockBalances(params: { warehouseId?: string; q?: string; purpose?: string; limit?: number; offset?: number } = {}): Promise<StockBalanceRow[]> {
  const qs = new URLSearchParams();
  if (params.warehouseId) qs.set('warehouseId', params.warehouseId);
  if (params.q) qs.set('q', params.q);
  if (params.purpose) qs.set('purpose', params.purpose);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const res = await apiFetch(`/api/stock/balances${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Không tải được tồn kho');
  return res.json();
}

let warehouseCache: { at: number; data: Warehouse[] } | null = null;
const WAREHOUSE_CACHE_TTL = 60_000;

export async function getWarehouses(): Promise<Warehouse[]> {
  if (warehouseCache && Date.now() - warehouseCache.at < WAREHOUSE_CACHE_TTL) return warehouseCache.data;
  const res = await apiFetch('/api/warehouses');
  if (!res.ok) throw new Error('Không tải được danh sách kho');
  const data = await res.json();
  warehouseCache = { at: Date.now(), data };
  return data;
}

export function invalidateWarehousesCache(): void {
  warehouseCache = null;
}

export async function createWarehouse(body: { code: string; name: string; region?: string | null; address?: string | null }): Promise<{ id: string }> {
  const res = await apiFetch('/api/warehouses', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Tạo kho thất bại');
  invalidateWarehousesCache();
  return data;
}

export async function updateWarehouse(id: string, body: Partial<{ code: string; name: string; region: string | null; address: string | null; isActive: boolean }>): Promise<void> {
  const res = await apiFetch(`/api/warehouses/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Cập nhật kho thất bại');
  invalidateWarehousesCache();
}

export async function deleteWarehouse(id: string): Promise<void> {
  const res = await apiFetch(`/api/warehouses/${id}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Xóa kho thất bại');
  invalidateWarehousesCache();
}

export interface StockDocument {
  id: string;
  code: string | null;
  docType: 'RECEIPT' | 'ISSUE' | 'TRANSFER' | 'RETURN' | 'ADJUSTMENT';
  status: string;
  warehouseId: string | null;
  sourceWarehouseId: string | null;
  destWarehouseId: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  createdAt: string;
  partnerCode?: string | null;
  partnerName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  postingDate?: string | null;
  accountingDate?: string | null;
  docDate?: string | null;
  paymentStatus?: string | null;
  paymentDueDate?: string | null;
  partnerAddress?: string | null;
  deliverer?: string | null;
  purchaserId?: string | null;
  vatRate?: number | null;
  vatAmount?: number | null;
  totalVat?: number | null;
  totalPreTax?: number | null;
  totalPreVat?: number | null;
  totalAmount?: number | null;
  shippingFee?: number | null;
  invoiceLookupCode?: string | null;
  invoiceLookupUrl?: string | null;
  customsDeclarationNumber?: string | null;
  attachments?: string | string[] | null;
  warehouseName?: string | null;
  sourceWarehouseName?: string | null;
  destWarehouseName?: string | null;
  createdByName?: string | null;
  missingSerials?: number | null;
  lines?: StockDocDetailLine[];
}

export interface StockDocDetailLine extends StockDocLine {
  id?: string;
  documentId?: string;
  productName?: string;
  productSku?: string;
  productCode?: string;
  unit?: string;
  uom?: string;
  locationCode?: string;
  locationName?: string;
  origin?: string;
  category?: string;
  tracking?: string;
  preVatAmount?: number;
  notes?: string | null;
}

export interface StockDocLine {
  productId: string;
  quantity: number;
  unitPrice?: number;
  locationId?: string | null;
  note?: string | null;
  vatRate?: number;
  vatAmount?: number;
  totalAmount?: number;
  accountDebit?: string | null;
  accountCredit?: string | null;
  projectId?: string | null;
  costItem?: string | null;
  serialLot?: string | null;
  unit?: string | null;
}

export interface ReceiptDocBody {
  warehouseId: string;
  lines: StockDocLine[];
  notes?: string;
  receiptSubType?: string;
  partnerCode?: string | null;
  partnerName?: string | null;
  partnerAddress?: string | null;
  deliverer?: string | null;
  purchaserId?: string | null;
  postingDate?: string | null;
  docDate?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  customsDeclarationNumber?: string | null;
  invoiceLookupCode?: string | null;
  invoiceLookupUrl?: string | null;
  paymentStatus?: string;
  paymentDueDate?: string | null;
  attachments?: string | string[] | null;
}

export async function getStockDocuments(params: { docType?: string; status?: string; warehouseId?: string; limit?: number; offset?: number } = {}): Promise<StockDocument[]> {
  const qs = new URLSearchParams();
  if (params.docType) qs.set('docType', params.docType);
  if (params.status) qs.set('status', params.status);
  if (params.warehouseId) qs.set('warehouseId', params.warehouseId);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const res = await apiFetch(`/api/stock/documents${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Không tải được chứng từ kho');
  return res.json();
}

async function postDoc(path: string, body: unknown): Promise<{ id: string; code: string }> {
  const res = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Thao tác thất bại');
  return data;
}

export const createReceipt = (body: ReceiptDocBody) =>
  postDoc('/api/stock/receipts', body);
export const createIssue = (body: ReceiptDocBody) =>
  postDoc('/api/stock/issues', body);
export const createTransfer = (body: { sourceWarehouseId: string; destWarehouseId: string; lines: StockDocLine[]; notes?: string }) =>
  postDoc('/api/stock/transfers', body);

export async function advanceDocument(kind: 'receipts' | 'issues', id: string, action: 'complete'): Promise<void> {
  await postDoc(`/api/stock/${kind}/${id}/${action}`, {});
}

export async function advanceTransfer(id: string, action: 'ship' | 'receive', locationId?: string): Promise<void> {
  await postDoc(`/api/stock/transfers/${id}/${action}`, { locationId });
}

export interface StockReportRow {
  productId: string; warehouseId: string; productName: string; warehouseName: string; unit: string;
  opening: number; inbound: number; outbound: number; adjustment: number; closing: number;
}

export async function getStockReport(from: string, to: string): Promise<StockReportRow[]> {
  const res = await apiFetch(`/api/stock/reports?${new URLSearchParams({ from, to })}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không tải được báo cáo kho');
  return data;
}

export interface StockAlertRow {
  productId: string;
  warehouseId: string;
  onHand: number;
  reserved: number;
  available: number;
  productName: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  minStock: number | null;
  maxStock: number | null;
  reorderPoint: number | null;
}

export async function getStockAlerts(warehouseId?: string): Promise<StockAlertRow[]> {
  const res = await apiFetch(`/api/stock/alerts${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ''}`);
  if (!res.ok) throw new Error('Không tải được cảnh báo tồn kho');
  return res.json();
}

export async function saveStockPolicy(body: {
  productId: string; warehouseId: string;
  minStock: number; maxStock: number; reorderPoint: number; leadTimeDays: number;
}): Promise<void> {
  const res = await apiFetch('/api/stock/policies', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Lưu chính sách thất bại');
}

export interface SlowStockRow {
  productId: string;
  warehouseId: string;
  onHand: number;
  available: number;
  productName: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  lastMoveAt: string | null;
}

export async function getSlowStock(warehouseId?: string, days = 90): Promise<SlowStockRow[]> {
  const qs = new URLSearchParams({ days: String(days) });
  if (warehouseId) qs.set('warehouseId', warehouseId);
  const res = await apiFetch(`/api/stock/slow?${qs}`);
  if (!res.ok) throw new Error('Không tải được tồn lâu');
  return res.json();
}

export type SerialStatus = 'SALEABLE' | 'WARRANTY' | 'DAMAGED' | 'DEMO' | 'QUARANTINE' | 'SOLD';

export interface StockSerial {
  id: string;
  productId: string;
  serialNumber?: string | null;
  lotCode?: string | null;
  warehouseId: string;
  locationId?: string | null;
  status: SerialStatus;
  supplier?: string | null;
  receiptId?: string | null;
  customerName?: string | null;
  projectId?: string | null;
  warrantyStart?: string | null;
  warrantyMonths?: number;
  notes?: string | null;
  productName?: string | null;
  warehouseName?: string | null;
}

export async function getStockSerials(params: { q?: string; status?: string; warehouseId?: string; productId?: string; limit?: number; offset?: number } = {}): Promise<StockSerial[]> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.status) qs.set('status', params.status);
  if (params.warehouseId) qs.set('warehouseId', params.warehouseId);
  if (params.productId) qs.set('productId', params.productId);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const res = await apiFetch(`/api/stock/serials${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Không tải được serial/lô');
  return res.json();
}

export async function registerSerial(body: {
  productId: string; serialNumber?: string | null; lotCode?: string | null;
  warehouseId: string; locationId?: string | null; status?: SerialStatus;
  supplier?: string | null; warrantyMonths?: number; notes?: string | null;
}): Promise<{ id: string }> {
  const res = await apiFetch('/api/stock/serials', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Đăng ký thất bại');
  return data;
}

export async function updateSerial(id: string, body: Partial<{
  status: SerialStatus; locationId: string | null; customerName: string | null;
  projectId: string | null; warrantyStart: string | null; warrantyMonths: number;
  notes: string | null; supplier: string | null;
}>): Promise<void> {
  const res = await apiFetch(`/api/stock/serials/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Cập nhật thất bại');
}

export interface BundleItem {
  productId: string;
  qtyPerBundle: number;
  productName?: string | null;
  available?: number;
  buildable?: number;
}

export interface ProductBundle {
  id: string;
  name: string;
  code?: string | null;
  bundleType: 'VIRTUAL_BUNDLE' | 'STOCKED_KIT';
  kitProductId?: string | null;
  description?: string | null;
  isActive: boolean;
  items: BundleItem[];
  buildable: number;
  limitingProductId: string | null;
}

export async function settleKit(id: string, action: 'assemble' | 'disassemble', body: { warehouseId: string; quantity: number }): Promise<void> {
  const res = await apiFetch(`/api/stock/bundles/${id}/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Thao tác kit thất bại');
}

export async function getBundles(warehouseId?: string): Promise<ProductBundle[]> {
  const res = await apiFetch(`/api/stock/bundles${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ''}`);
  if (!res.ok) throw new Error('Không tải được combo');
  return res.json();
}

export async function saveBundle(body: {
  id?: string; name: string; code?: string | null; bundleType?: string;
  kitProductId?: string | null;
  description?: string | null; items: { productId: string; qtyPerBundle: number }[];
}): Promise<{ id: string }> {
  const { id, ...rest } = body;
  const res = await apiFetch(id ? `/api/stock/bundles/${id}` : '/api/stock/bundles', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rest),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Lưu combo thất bại');
  return data;
}

export interface StockMove {
  id: string;
  productId: string;
  warehouseId: string;
  locationId?: string | null;
  quantity: number;
  moveType: string;
  referenceType?: string | null;
  referenceId?: string | null;
  createdBy?: string | null;
  createdAt: string;
  productName?: string | null;
  warehouseName?: string | null;
  createdByName?: string | null;
}

export async function getStockMoves(params: { warehouseId?: string; productId?: string; moveType?: string; limit?: number; offset?: number } = {}): Promise<StockMove[]> {
  const qs = new URLSearchParams();
  if (params.warehouseId) qs.set('warehouseId', params.warehouseId);
  if (params.productId) qs.set('productId', params.productId);
  if (params.moveType) qs.set('moveType', params.moveType);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const res = await apiFetch(`/api/stock/moves${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Không tải được lịch sử hàng hóa');
  return res.json();
}

export interface StockPolicyRow {
  productId: string;
  warehouseId: string;
  minStock: number;
  maxStock: number;
  reorderPoint: number;
  leadTimeDays: number;
  productName?: string | null;
  warehouseName?: string | null;
}

export async function getStockPolicies(warehouseId?: string): Promise<StockPolicyRow[]> {
  const res = await apiFetch(`/api/stock/policies${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ''}`);
  if (!res.ok) throw new Error('Không tải được chính sách tồn');
  return res.json();
}

export interface MisaMapping {
  id: string;
  entityType: string;
  entityId: string;
  misaCode: string;
  misaName?: string | null;
}

export interface MisaSyncLog {
  id: string;
  direction: string;
  entityType: string;
  entityId?: string | null;
  idempotencyKey: string;
  status: string;
  error?: string | null;
  createdAt: string;
  finishedAt?: string | null;
}

export async function getMisaMappings(): Promise<MisaMapping[]> {
  const res = await apiFetch('/api/stock/misa-mappings');
  if (!res.ok) throw new Error('Không tải được mapping MISA');
  return res.json();
}

export async function createMisaMapping(body: { entityType: string; entityId: string; misaCode: string; misaName?: string }): Promise<void> {
  const res = await apiFetch('/api/stock/misa-mappings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Tạo mapping thất bại');
}

export async function deleteMisaMapping(id: string): Promise<void> {
  const res = await apiFetch(`/api/stock/misa-mappings/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Xóa mapping thất bại');
}

export async function getMisaLogs(): Promise<MisaSyncLog[]> {
  const res = await apiFetch('/api/stock/misa-logs');
  if (!res.ok) throw new Error('Không tải được nhật ký đồng bộ');
  return res.json();
}

export interface CountLine {
  id: string;
  productId: string;
  locationId?: string | null;
  expectedQty: number | null;
  actualQty: number | null;
  note?: string | null;
  productName?: string | null;
}

export interface StockCount {
  id: string;
  code?: string | null;
  warehouseId: string;
  warehouseName?: string | null;
  status: 'COUNTING' | 'DONE' | string;
  blindCount: boolean;
  createdAt: string;
  lines?: CountLine[];
}

export async function getStockCounts(warehouseId?: string, status?: string, page?: { limit?: number; offset?: number }): Promise<StockCount[]> {
  const qs = new URLSearchParams();
  if (warehouseId) qs.set('warehouseId', warehouseId);
  if (status) qs.set('status', status);
  if (page?.limit !== undefined) qs.set('limit', String(page.limit));
  if (page?.offset) qs.set('offset', String(page.offset));
  const res = await apiFetch(`/api/stock/counts${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Không tải được đợt kiểm kê');
  return res.json();
}

export async function getStockCount(id: string): Promise<StockCount> {
  const res = await apiFetch(`/api/stock/counts/${id}`);
  if (!res.ok) throw new Error('Không tải được chi tiết kiểm kê');
  return res.json();
}

export async function openStockCount(body: { warehouseId: string; blindCount?: boolean; notes?: string }): Promise<{ id: string; code: string }> {
  const res = await apiFetch('/api/stock/counts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Mở đợt thất bại');
  return data;
}

export async function submitCountLines(id: string, lines: { productId: string; locationId?: string | null; actualQty: number; note?: string | null }[]): Promise<void> {
  const res = await apiFetch(`/api/stock/counts/${id}/lines`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Gửi số đếm thất bại');
}

export async function requestRecount(id: string, lineIds: string[]): Promise<void> {
  const res = await apiFetch(`/api/stock/counts/${id}/recount`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineIds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Yêu cầu kiểm lại thất bại');
}

export async function approveCount(id: string): Promise<void> {
  const res = await apiFetch(`/api/stock/counts/${id}/approve`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Duyệt chênh lệch thất bại');
}

export async function cancelCount(id: string): Promise<void> {
  await postDoc(`/api/stock/counts/${id}/cancel`, {});
}

export interface PartnerSuggestion {
  id: string;
  code: string;
  name: string;
  address?: string;
  deliverer?: string;
}

export interface PartnerSuggestionsData {
  partners: PartnerSuggestion[];
  deliverers: string[];
  notes: string[];
  addresses: string[];
}

export async function getPartnerSuggestions(): Promise<PartnerSuggestionsData> {
  const res = await apiFetch('/api/stock/partner-suggestions');
  if (!res.ok) throw new Error('Không tải được gợi ý đối tác');
  return res.json();
}

export async function getNextDocCode(docType: 'RECEIPT' | 'ISSUE' | 'TRANSFER' | 'RETURN'): Promise<{ code: string; docType: string }> {
  const res = await apiFetch(`/api/stock/next-code?docType=${docType}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Không lấy được số phiếu dự kiến');
  return data;
}

export function countLinesMissingSerials(lines: { productId?: string | null; quantity?: number | null; serialLot?: string | null }[]): number {
  return lines.filter((l) => l.productId && Number(l.quantity) > 0 && !(l.serialLot || '').trim()).length;
}

export async function getStockDocument(id: string): Promise<StockDocument & { lines: StockDocDetailLine[] }> {
  const res = await apiFetch(`/api/stock/documents/${id}`);
  if (!res.ok) throw new Error('Không tải được chi tiết chứng từ');
  return res.json();
}

export async function cancelStockDocument(id: string): Promise<void> {
  const res = await apiFetch(`/api/stock/documents/${id}/cancel`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Hủy chứng từ thất bại');
}

export async function updateStockDocument(id: string, body: Record<string, unknown>): Promise<void> {
  const res = await apiFetch(`/api/stock/documents/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Cập nhật chứng từ thất bại');
}

export async function deleteStockDocument(id: string): Promise<void> {
  const res = await apiFetch(`/api/stock/documents/${id}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Xóa chứng từ thất bại');
}


