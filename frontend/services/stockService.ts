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

export interface AvailableInventoryRow {
  productId: string;
  warehouseId: string;
  onHand: number;
  reserved: number;
  available: number;
  productName: string | null;
  unit: string | null;
  category: string | null;
  origin: string | null;
  tracking: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
}

export async function getAvailableInventory(params: { warehouseId?: string; q?: string; tracking?: string; onlyAvailable?: boolean; limit?: number; offset?: number } = {}): Promise<{ rows: AvailableInventoryRow[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.warehouseId) qs.set('warehouseId', params.warehouseId);
  if (params.q) qs.set('q', params.q);
  if (params.tracking) qs.set('tracking', params.tracking);
  if (params.onlyAvailable !== undefined) qs.set('onlyAvailable', String(params.onlyAvailable));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const res = await apiFetch(`/api/stock/available-inventory${qs.toString() ? `?${qs}` : ''}`);
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error(data.error || 'Không tải được tồn kho khả dụng');
  return { rows: Array.isArray(data) ? data : [], total: Number(res.headers.get('X-Total-Count') || (Array.isArray(data) ? data.length : 0)) };
}

export interface InventoryDetails {
  product: { id: string; name: string; unit?: string | null; category?: string | null; origin?: string | null; tracking?: string | null };
  warehouse: { id: string; code: string; name: string };
  summary: { onHand: number; reserved: number; available: number };
  serials: Array<{ id: string; serialNumber: string | null; stockStatus: string; status: string; receivedAt?: string | null; outDate?: string | null; supplier?: string | null; receiptCode?: string | null; receiptPartnerName?: string | null; issueCode?: string | null; issuePartnerName?: string | null }>;
  lots: Array<{ id: string; lotCode: string; coilCode?: string | null; initialQty: number; remainingQty: number; unit?: string | null; receivedAt?: string | null; supplier?: string | null; receiptCode?: string | null; receiptPartnerName?: string | null }>;
}

export async function getInventoryDetails(productId: string, warehouseId: string): Promise<InventoryDetails> {
  const res = await apiFetch(`/api/stock/inventory/${encodeURIComponent(productId)}/${encodeURIComponent(warehouseId)}/details`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Không tải được chi tiết tồn kho');
  return data;
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

export async function getStockDocuments(params: { docType?: string; status?: string; warehouseId?: string; from?: string; to?: string; limit?: number; offset?: number } = {}): Promise<StockDocument[]> {
  const qs = new URLSearchParams();
  if (params.docType) qs.set('docType', params.docType);
  if (params.status) qs.set('status', params.status);
  if (params.warehouseId) qs.set('warehouseId', params.warehouseId);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const res = await apiFetch(`/api/stock/documents${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Không tải được chứng từ kho');
  return res.json();
}

async function postDoc(path: string, body: unknown): Promise<{ id: string; code: string }> {
  const res = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Giữ HTTP status để giao diện phân biệt xung đột nghiệp vụ (409) với
    // lỗi nhập liệu hoặc lỗi máy chủ, thay vì chỉ hiện một câu chung chung.
    throw Object.assign(new Error(data.error || 'Thao tác thất bại'), { status: res.status });
  }
  return data;
}

export const createReceipt = (body: ReceiptDocBody) =>
  postDoc('/api/stock/receipts', body);
export const createIssue = (body: ReceiptDocBody) =>
  postDoc('/api/stock/issues', body);
export const createReturn = (body: ReceiptDocBody) =>
  postDoc('/api/stock/returns', body);
export const createTransfer = (body: { sourceWarehouseId: string; destWarehouseId: string; lines: StockDocLine[]; notes?: string }) =>
  postDoc('/api/stock/transfers', body);

export async function advanceDocument(kind: 'receipts' | 'issues' | 'returns', id: string, action: 'complete'): Promise<void> {
  await postDoc(`/api/stock/${kind}/${id}/${action}`, {});
}

export async function advanceTransfer(id: string, action: 'ship' | 'receive', locationId?: string): Promise<void> {
  await postDoc(`/api/stock/transfers/${id}/${action}`, { locationId });
}

export interface StockReportRow {
  productId: string; warehouseId: string; productName: string; warehouseName: string; unit: string;
  opening: number; inbound: number; outbound: number; adjustment: number; closing: number;
}

export async function getStockReport(from: string, to: string, page: { limit?: number; offset?: number } = {}): Promise<StockReportRow[]> {
  const params = new URLSearchParams({ from, to });
  if (page.limit !== undefined) params.set('limit', String(page.limit));
  if (page.offset) params.set('offset', String(page.offset));
  const res = await apiFetch(`/api/stock/reports?${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không tải được báo cáo kho');
  return data;
}

export interface StockReportSummary {
  totals: { inbound: number; outbound: number; adjustment: number; inboundDocuments: number; outboundDocuments: number; onHand: number; reserved: number; stockValue: number; slowCount: number };
  daily: { day: string; inbound: number; outbound: number }[];
}
export async function getStockReportSummary(from: string, to: string, warehouseId?: string): Promise<StockReportSummary> {
  const qs = new URLSearchParams({ from, to }); if (warehouseId) qs.set('warehouseId', warehouseId);
  const res = await apiFetch(`/api/stock/reports/summary?${qs}`); const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Không tải được tổng hợp báo cáo kho'); return data;
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

export async function getStockAlerts(warehouseId?: string, page: { limit?: number; offset?: number } = {}): Promise<StockAlertRow[]> {
  const qs = new URLSearchParams();
  if (warehouseId) qs.set('warehouseId', warehouseId);
  if (page.limit !== undefined) qs.set('limit', String(page.limit));
  if (page.offset) qs.set('offset', String(page.offset));
  const res = await apiFetch(`/api/stock/alerts${qs.toString() ? `?${qs}` : ''}`);
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

export async function getSlowStock(warehouseId?: string, days = 90, page: { limit?: number; offset?: number } = {}): Promise<SlowStockRow[]> {
  const qs = new URLSearchParams({ days: String(days) });
  if (warehouseId) qs.set('warehouseId', warehouseId);
  if (page.limit !== undefined) qs.set('limit', String(page.limit));
  if (page.offset) qs.set('offset', String(page.offset));
  const res = await apiFetch(`/api/stock/slow?${qs}`);
  if (!res.ok) throw new Error('Không tải được tồn lâu');
  return res.json();
}

export type SerialStatus = 'SALEABLE' | 'WARRANTY' | 'DAMAGED' | 'DEMO' | 'QUARANTINE' | 'SOLD';

export interface StockSerial {
  id: string;
  recordType?: 'SERIAL' | 'LOT';
  productId: string;
  serialNumber?: string | null;
  lotCode?: string | null;
  warehouseId: string;
  locationId?: string | null;
  status: SerialStatus;
  stockStatus?: 'IN_STOCK' | 'RESERVED' | 'OUT' | string;
  initialQty?: number | null;
  remainingQty?: number | null;
  unit?: string | null;
  receiptDocumentId?: string | null;
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
  productId: string; serialNumber: string; lotCode?: string | null;
  warehouseId: string; locationId?: string | null; status?: SerialStatus;
  receiptDocumentId: string; supplier?: string | null; warrantyMonths?: number; notes?: string | null;
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
export async function deleteSerial(id: string): Promise<void> {
  const res = await apiFetch(`/api/stock/serials/${id}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || 'Xóa Serial thất bại');
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
  serialId?: string | null;
  lotId?: string | null;
  createdBy?: string | null;
  createdAt: string;
  productName?: string | null;
  warehouseName?: string | null;
  createdByName?: string | null;
}

export async function getStockMoves(params: { warehouseId?: string; productId?: string; moveType?: string; q?: string; from?: string; to?: string; limit?: number; offset?: number } = {}): Promise<StockMove[]> {
  const qs = new URLSearchParams();
  if (params.warehouseId) qs.set('warehouseId', params.warehouseId);
  if (params.productId) qs.set('productId', params.productId);
  if (params.moveType) qs.set('moveType', params.moveType);
  if (params.q) qs.set('q', params.q);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const res = await apiFetch(`/api/stock/moves${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Không tải được lịch sử hàng hóa');
  return res.json();
}

export interface StockReconciliationRow {
  productId: string; warehouseId: string; locationId?: string | null; balanceOnHand: number; ledgerQty: number; difference: number;
  productName?: string | null; warehouseName?: string | null; unit?: string | null;
}
export interface StockAnomalyRow { anomalyType: string; productId?: string; productName?: string | null; warehouseId?: string; warehouseName?: string | null; message: string; [key: string]: unknown; }
export async function getStockReconciliation(params: { warehouseId?: string; productId?: string } = {}): Promise<{ rows: StockReconciliationRow[]; total: number }> {
  const qs = new URLSearchParams(); Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const res = await apiFetch(`/api/stock/reconciliation${qs.toString() ? `?${qs}` : ''}`); const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Không tải được đối soát tồn'); return data;
}
export async function getStockAnomalies(params: { warehouseId?: string; type?: string } = {}): Promise<{ rows: StockAnomalyRow[]; total: number }> {
  const qs = new URLSearchParams(); Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const res = await apiFetch(`/api/stock/anomalies${qs.toString() ? `?${qs}` : ''}`); const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Không tải được bất thường kho'); return data;
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

export async function getStockPolicies(warehouseId?: string, page: { limit?: number; offset?: number } = {}): Promise<StockPolicyRow[]> {
  const qs = new URLSearchParams();
  if (warehouseId) qs.set('warehouseId', warehouseId);
  if (page.limit !== undefined) qs.set('limit', String(page.limit));
  if (page.offset) qs.set('offset', String(page.offset));
  const res = await apiFetch(`/api/stock/policies${qs.toString() ? `?${qs}` : ''}`);
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
export async function prepareMisaSync(documentIds?: string[], warehouseId?: string): Promise<{ prepared: number; skipped: number; message: string }> {
  const res = await apiFetch('/api/stock/misa-sync/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentIds, warehouseId }) });
  const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || 'Không thể chuẩn bị hàng đợi MISA'); return data;
}

export interface WarehouseActivityLog {
  id: string;
  actionType: string;
  entityType: string;
  entityId?: string | null;
  documentId?: string | null;
  documentCode?: string | null;
  productId?: string | null;
  serialId?: string | null;
  lotId?: string | null;
  warehouseName?: string | null;
  productName?: string | null;
  userName?: string | null;
  quantity?: number | null;
  createdAt: string;
  oldData?: unknown;
  newData?: unknown;
  metadata?: unknown;
}

export async function getWarehouseActivityLogs(params: {
  q?: string; actionType?: string; entityType?: string; warehouseId?: string;
  from?: string; to?: string; limit?: number; offset?: number;
} = {}): Promise<{ rows: WarehouseActivityLog[]; total: number; limit: number; offset: number }> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== '') qs.set(key, String(value)); });
  const res = await apiFetch(`/api/stock/activity-logs${qs.toString() ? `?${qs}` : ''}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Không tải được Audit Log kho vận');
  return data;
}

export interface CountLine {
  id: string;
  productId: string;
  locationId?: string | null;
  expectedQty: number | null;
  actualQty: number | null;
  note?: string | null;
  productName?: string | null;
  productUnit?: string | null;
}

export interface StockCount {
  id: string;
  code?: string | null;
  warehouseId: string;
  warehouseName?: string | null;
  status: 'COUNTING' | 'DONE' | string;
  blindCount: boolean;
  createdAt: string;
  totalLines?: number;
  countedLines?: number;
  varianceLines?: number;
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

export async function getStockCountVariances(page?: { warehouseId?: string; status?: string; limit?: number; offset?: number }): Promise<StockCount[]> {
  const qs = new URLSearchParams();
  if (page?.warehouseId) qs.set('warehouseId', page.warehouseId);
  if (page?.status) qs.set('status', page.status);
  if (page?.limit !== undefined) qs.set('limit', String(page.limit));
  if (page?.offset) qs.set('offset', String(page.offset));
  const res = await apiFetch(`/api/stock/counts/variances${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Không tải được chênh lệch kiểm kê');
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

export interface DocLineProgress {
  lineId: string;
  productId: string;
  productName: string;
  required: number;
  processed: number;
  tracking: 'SERIAL' | 'LOT' | 'QUANTITY';
  lots: { id: string; lotCode: string; coilCode?: string | null; initialQty: number; remainingQty: number; allocatedQty?: number; unit?: string | null; status: string }[];
  serials: string[];
  actualQty: number | null;
  varianceQty: number | null;
  quantityConfirmed?: boolean;
  serialSkipped?: boolean;
  status: 'PENDING' | 'PARTIAL' | 'COMPLETED';
  availability?: { onHand: number; reserved: number; available: number; afterIssue: number } | null;
}

export interface DocProgress {
  documentId: string;
  code: string | null;
  status: string;
  lines: DocLineProgress[];
  allCompleted: boolean;
}

export async function getDocumentProgress(id: string): Promise<DocProgress> {
  const res = await apiFetch(`/api/stock/documents/${id}/progress`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Không tải được tiến độ xử lý');
  return data;
}

export async function completeDocumentProcessing(id: string): Promise<{ success: boolean; status: string }> {
  const res = await apiFetch(`/api/stock/documents/${id}/processing-complete`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Không thể hoàn tất xử lý hàng hóa');
  return data;
}

export async function confirmLineWithoutSerial(lineId: string, body: { actualQty: number; varianceReason?: string }): Promise<any> {
  const res = await apiFetch(`/api/stock/lines/${lineId}/confirm-no-serial`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Không thể xác nhận dòng không có Serial');
  return data;
}

async function postStock(path: string, body: unknown): Promise<any> {
  const res = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Thao tác thất bại');
  return data;
}

export const scanSerial = (documentId: string, documentLineId: string, serial: string) =>
  postStock('/api/stock/serials/scan', { documentId, documentLineId, serial });

export const scanOutSerial = (documentId: string, documentLineId: string, serial: string) =>
  postStock('/api/stock/serials/scan-out', { documentId, documentLineId, serial });

export const editLineSerial = (documentId: string, documentLineId: string, serial: string, replacement?: string) =>
  postStock('/api/stock/serials/edit', { documentId, documentLineId, serial, replacement });

export const confirmLineQty = (lineId: string, body: { actualQty: number; varianceReason?: string }) =>
  postStock(`/api/stock/lines/${lineId}/confirm-qty`, body);

export const registerLot = (body: {
  documentId: string; documentLineId: string; lotCode: string; coilCode?: string;
  quantity: number; unit?: string; manufacturedAt?: string; supplier?: string;
}) => postStock('/api/stock/lots/register', body);

export const allocateLot = (body: {
  documentId: string; documentLineId: string; lotCode: string; quantity: number;
}) => postStock('/api/stock/lots/allocate', body);

export interface SerialTimeline {
  serial: {
    id: string; serialNumber: string; productId: string; productName?: string | null;
    warehouseId: string; warehouseName?: string | null; status: string; stockStatus: string;
    supplier?: string | null; customerName?: string | null; projectId?: string | null;
    receivedAt?: string | null; outDate?: string | null;
  };
  receipt: { documentId: string; code: string | null; date?: string | null; supplier?: string | null; warehouseId?: string | null; warehouseName?: string | null } | null;
  issue: { documentId: string; code: string | null; date?: string | null; customerName?: string | null; projectId?: string | null; warehouseId?: string | null; warehouseName?: string | null } | null;
  warranty: { startType: string; start: string | null; months: number; end: string | null; daysLeft: number | null };
  moves: { id: string; quantity: number; moveType: string; referenceType?: string | null; referenceId?: string | null; warehouseName?: string | null; createdAt: string }[];
}

export async function getSerialTimeline(serialNumber: string): Promise<SerialTimeline> {
  const res = await apiFetch(`/api/stock/serials/timeline/${encodeURIComponent(serialNumber)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Không tải được vòng đời serial');
  return data;
}

export interface LotTimeline {
  lot: {
    id: string; lotCode: string; coilCode?: string | null; productId: string; productName?: string | null;
    warehouseId: string; warehouseName?: string | null; initialQty: number; remainingQty: number;
    unit?: string | null; status: string; supplier?: string | null; manufacturedAt?: string | null;
  };
  receipt: { documentId: string; code: string | null; date?: string | null; supplier?: string | null; warehouseId?: string | null; warehouseName?: string | null } | null;
  moves: { id: string; quantity: number; moveType: string; referenceType?: string | null; referenceId?: string | null; documentLineId?: string | null; warehouseName?: string | null; createdAt: string }[];
}

export async function getLotTimeline(lotId: string): Promise<LotTimeline> {
  const res = await apiFetch(`/api/stock/lots/timeline/${encodeURIComponent(lotId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Không tải được lịch sử Lô');
  return data;
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

export type ProcessingSummary = Record<string, { total: number; done: number }>;

export async function getProcessingSummary(params: { docType?: string; warehouseId?: string } = {}): Promise<ProcessingSummary> {
  const qs = new URLSearchParams();
  if (params.docType) qs.set('docType', params.docType);
  if (params.warehouseId) qs.set('warehouseId', params.warehouseId);
  const res = await apiFetch(`/api/stock/documents/processing-summary${qs.toString() ? `?${qs}` : ''}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Không tải được tiến độ');
  return data;
}


