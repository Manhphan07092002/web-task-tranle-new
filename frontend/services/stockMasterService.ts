import { apiFetch } from './api';

export interface StockProduct {
  id: string;
  code: string;
  name: string;
  brand?: string;
  model?: string;
  category?: string;
  unit: string;
  tracking: 'NONE' | 'LOT' | 'SERIAL';
  warrantyMonths: number;
  minStock: number;
  maxStock: number;
  reorderPoint: number;
  requiresCertificates: number;
  isActive: number;
  notes?: string;
  createdByName?: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  region?: string;
  address?: string;
  managerId?: string;
  managerName?: string;
  isActive: number;
  locationCount: number;
}

export interface WarehouseLocation {
  id: string;
  warehouseId: string;
  warehouseCode?: string;
  warehouseName?: string;
  parentId?: string | null;
  parentCode?: string | null;
  code: string;
  name: string;
  type: string;
  purpose: string;
  isActive: number;
  childCount: number;
}

export const getStockProducts = async (filters?: { search?: string; category?: string; brand?: string; tracking?: string }): Promise<StockProduct[]> => {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.category) params.set('category', filters.category);
  if (filters?.brand) params.set('brand', filters.brand);
  if (filters?.tracking) params.set('tracking', filters.tracking);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/api/warehouse/products${query}`);
  if (!res.ok) throw new Error('Failed to fetch stock products');
  return res.json();
};

export const createStockProduct = async (data: Record<string, unknown>) => {
  const res = await apiFetch('/api/warehouse/products', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create stock product');
  }
  return res.json();
};

export const updateStockProduct = async (id: string, data: Record<string, unknown>) => {
  const res = await apiFetch(`/api/warehouse/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update stock product');
  }
  return res.json();
};

export const deleteStockProduct = async (id: string) => {
  const res = await apiFetch(`/api/warehouse/products/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete stock product');
  }
  return res.json();
};

export const getWarehouses = async (): Promise<Warehouse[]> => {
  const res = await apiFetch('/api/warehouse/warehouses');
  if (!res.ok) throw new Error('Failed to fetch warehouses');
  return res.json();
};

export const createWarehouse = async (data: Record<string, unknown>) => {
  const res = await apiFetch('/api/warehouse/warehouses', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create warehouse');
  }
  return res.json();
};

export const updateWarehouse = async (id: string, data: Record<string, unknown>) => {
  const res = await apiFetch(`/api/warehouse/warehouses/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update warehouse');
  }
  return res.json();
};

export const deleteWarehouse = async (id: string) => {
  const res = await apiFetch(`/api/warehouse/warehouses/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete warehouse');
  }
  return res.json();
};

export const getWarehouseLocations = async (warehouseId?: string): Promise<WarehouseLocation[]> => {
  const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : '';
  const res = await apiFetch(`/api/warehouse/locations${query}`);
  if (!res.ok) throw new Error('Failed to fetch warehouse locations');
  return res.json();
};

export const createWarehouseLocation = async (data: Record<string, unknown>) => {
  const res = await apiFetch('/api/warehouse/locations', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create warehouse location');
  }
  return res.json();
};

export const updateWarehouseLocation = async (id: string, data: Record<string, unknown>) => {
  const res = await apiFetch(`/api/warehouse/locations/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update warehouse location');
  }
  return res.json();
};

export const deleteWarehouseLocation = async (id: string) => {
  const res = await apiFetch(`/api/warehouse/locations/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete warehouse location');
  }
  return res.json();
};

export interface StockDocumentLine {
  id: string;
  docId: string;
  productId: string;
  productCode: string;
  productName: string;
  productTracking?: string;
  qtyOrdered: number;
  qtyReceived: number;
  unit: string;
  locationId?: string | null;
  notes?: string;
}

export interface StockDocument {
  id: string;
  code: string;
  type: string;
  status: string;
  sourceType: string;
  sourceId?: string;
  supplierName?: string;
  warehouseId: string;
  warehouseCode?: string;
  warehouseName?: string;
  toWarehouseId?: string;
  toWarehouseCode?: string;
  toWarehouseName?: string;
  requesterId?: string;
  requesterName?: string;
  assigneeId?: string;
  assigneeName?: string;
  receiverId?: string;
  receiverName?: string;
  etaDate?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  lineCount: number;
  qtyOrdered: number;
  qtyReceived: number;
  lines?: StockDocumentLine[];
}

export interface StockBalance {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  locationId: string;
  locationCode?: string;
  onHand: number;
  reserved: number;
  available: number;
  updatedAt: string;
}

export const getStockDocuments = async (filters?: { type?: string; status?: string }): Promise<StockDocument[]> => {
  const params = new URLSearchParams();
  if (filters?.type) params.set('type', filters.type);
  if (filters?.status) params.set('status', filters.status);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/api/warehouse/documents${query}`);
  if (!res.ok) throw new Error('Failed to fetch stock documents');
  return res.json();
};

export const createStockDocument = async (data: Record<string, unknown>) => {
  const res = await apiFetch('/api/warehouse/documents', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create stock document');
  }
  return res.json();
};

export const getStockDocument = async (id: string): Promise<StockDocument> => {
  const res = await apiFetch(`/api/warehouse/documents/${id}`);
  if (!res.ok) throw new Error('Failed to fetch stock document');
  return res.json();
};

export const updateStockDocument = async (id: string, data: Record<string, unknown>) => {
  const res = await apiFetch(`/api/warehouse/documents/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update stock document');
  }
  return res.json();
};

export const receiveDocumentLine = async (docId: string, lineId: string, data: { qty: number; locationId?: string | null }) => {  const res = await apiFetch(`/api/warehouse/documents/${docId}/lines/${lineId}/receive`, {
    method: 'POST', body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to record receipt');
  }
  return res.json();
};

export const pickDocumentLine = async (docId: string, lineId: string, data: { qty: number; locationId?: string | null }) => {
  const res = await apiFetch(`/api/warehouse/documents/${docId}/lines/${lineId}/pick`, {
    method: 'POST', body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to record pick');
  }
  return res.json();
};

export const transferReceiveLine = async (docId: string, lineId: string, data: { qty: number; locationId?: string | null; notes?: string }) => {
  const res = await apiFetch(`/api/warehouse/documents/${docId}/lines/${lineId}/transfer-receive`, {
    method: 'POST', body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to confirm transfer receipt');
  }
  return res.json();
};

export interface TransferSuggestion {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  toWarehouseId: string;
  toWarehouseCode: string;
  fromWarehouseId: string;
  fromWarehouseCode: string;
  shortageQty: number;
  suggestQty: number;
}

export const getTransferSuggestions = async (): Promise<TransferSuggestion[]> => {
  const res = await apiFetch('/api/warehouse/transfer-suggestions');
  if (!res.ok) throw new Error('Failed to fetch transfer suggestions');
  return res.json();
};

export interface Reservation {
  id: string;
  sourceType: string;
  sourceId?: string;
  productId: string;
  productCode: string;
  productName: string;
  warehouseId: string;
  warehouseCode?: string;
  warehouseName?: string;
  locationId?: string | null;
  locationCode?: string | null;
  qty: number;
  qtyConsumed: number;
  status: 'ACTIVE' | 'RELEASED' | 'CONSUMED';
  assigneeId?: string;
  assigneeName?: string;
  expiresAt?: string;
  notes?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  isExpired: number;
}

export const getReservations = async (status?: string): Promise<Reservation[]> => {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await apiFetch(`/api/warehouse/reservations${query}`);
  if (!res.ok) throw new Error('Failed to fetch reservations');
  return res.json();
};

export const createReservation = async (data: Record<string, unknown>) => {
  const res = await apiFetch('/api/warehouse/reservations', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create reservation');
  }
  return res.json();
};

export const releaseReservation = async (id: string) => {
  const res = await apiFetch(`/api/warehouse/reservations/${id}/release`, { method: 'POST' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to release reservation');
  }
  return res.json();
};

export const completeStockDocument = async (id: string) => {
  const res = await apiFetch(`/api/warehouse/documents/${id}/complete`, { method: 'POST' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to complete document');
  }
  return res.json();
};

export const cancelStockDocument = async (id: string) => {
  const res = await apiFetch(`/api/warehouse/documents/${id}/cancel`, { method: 'POST' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to cancel document');
  }
  return res.json();
};

export const getStockBalances = async (filters?: { warehouseId?: string; search?: string }): Promise<StockBalance[]> => {
  const params = new URLSearchParams();
  if (filters?.warehouseId) params.set('warehouseId', filters.warehouseId);
  if (filters?.search) params.set('search', filters.search);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/api/warehouse/balances${query}`);
  if (!res.ok) throw new Error('Failed to fetch stock balances');
  return res.json();
};

export interface StockSummaryRow {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  category?: string;
  brand?: string;
  model?: string;
  tracking?: string;
  minStock: number;
  maxStock: number;
  reorderPoint: number;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  status: 'ok' | 'low' | 'out';
}

export interface StockLocationRow extends StockSummaryRow {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  locationId: string;
  locationCode?: string;
}

export interface StockPage<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProductStockDetail {
  product: Record<string, unknown> & { id: string; code: string; name: string };
  breakdown: {
    warehouseId: string; warehouseCode: string; warehouseName: string;
    locationId: string; locationCode?: string;
    onHand: number; reserved: number; available: number;
  }[];
  moves: {
    id: string; qty: number; moveType: string; createdAt: string;
    docId?: string; docCode?: string; warehouseCode?: string;
  }[];
  totals: { onHand: number; reserved: number; available: number };
  reservations?: {
    id: string; qty: number; qtyConsumed: number; status: string;
    sourceType: string; sourceId?: string; warehouseCode: string;
    assigneeName?: string; expiresAt?: string;
  }[];
  incomingDocs?: {
    id: string; code: string; status: string; warehouseCode: string;
    productCode: string; qtyPending: number;
  }[];
}

export const getStock = async (filters: {
  view: 'summary' | 'by-location'; search?: string; warehouseId?: string;
  category?: string; brand?: string; tracking?: string; status?: string;
  page: number; pageSize: number;
}): Promise<StockPage<StockSummaryRow | StockLocationRow>> => {
  const params = new URLSearchParams();
  params.set('view', filters.view);
  if (filters.search) params.set('search', filters.search);
  if (filters.warehouseId) params.set('warehouseId', filters.warehouseId);
  if (filters.category) params.set('category', filters.category);
  if (filters.brand) params.set('brand', filters.brand);
  if (filters.tracking) params.set('tracking', filters.tracking);
  if (filters.status) params.set('status', filters.status);
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  const res = await apiFetch(`/api/warehouse/stock?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch stock');
  return res.json();
};

export const getProductStock = async (productId: string): Promise<ProductStockDetail> => {
  const res = await apiFetch(`/api/warehouse/stock/${productId}`);
  if (!res.ok) throw new Error('Failed to fetch product stock');
  return res.json();
};

export interface StaffOverview {
  role: 'staff';
  user: { id: string; name: string };
  date: string;
  kpis: { pendingReceipts: number; pendingIssues: number; pendingTransfers: number; pendingCounts: number };
  todayTasks: {
    id: string; code: string; type: string; status: string; dueDate?: string;
    warehouseId: string; warehouseCode: string; lineCount: number;
    qtyOrdered: number; qtyReceived: number; firstProduct?: string;
  }[];
  alerts: {
    overdue: { id: string; code: string; type: string; status: string; dueDate?: string }[];
    awaitingTransfers: { id: string; code: string; status: string; etaDate?: string }[];
  };
}

export interface ManagerOverview {
  role: 'manager';
  date: string;
  kpis: {
    skuCount: number; lowStock: number; outOfStock: number;
    pendingIssues: number; inTransit: number; openVariances: number;
  };
  warehouses: {
    id: string; code: string; name: string; sku: number;
    pendingReceipts: number; pendingIssues: number; alerts: number;
    status: 'ok' | 'attention' | 'action';
  }[];
  alerts: {
    outItems: { productCode: string; productName: string; warehouseCode: string; available: number }[];
    overdueTransfers: { id: string; code: string; etaDate?: string; warehouseCode: string; toWarehouseCode?: string }[];
    overdueDocs: { id: string; code: string; type: string; status: string; dueDate?: string; warehouseCode: string }[];
    expiringReservations: { id: string; productCode: string; qty: number; expiresAt?: string; warehouseCode: string }[];
  };
  performance: {
    id: string; name: string; handled: number; onTime: number; overdue: number; onTimeRate: number | null;
  }[];
}

export const getDashboardOverview = async (warehouseId?: string): Promise<StaffOverview | ManagerOverview | { role: 'none' }> => {
  const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : '';
  const res = await apiFetch(`/api/warehouse/dashboard/overview${query}`);
  if (!res.ok) throw new Error('Failed to fetch dashboard overview');
  return res.json();
};

export interface CountVariance {
  id: string;
  countId: string;
  countCode: string;
  countStatus: string;
  productId: string;
  productCode: string;
  productName: string;
  systemQty: number;
  countedQty: number;
  variance: number;
  status: string;
  resolution?: string;
  resolvedBy?: string;
  counterName?: string;
  warehouseCode: string;
  warehouseName: string;
}

export const getCountVariances = async (openOnly?: boolean): Promise<CountVariance[]> => {
  const query = openOnly ? '?open=1' : '';
  const res = await apiFetch(`/api/warehouse/count-variances${query}`);
  if (!res.ok) throw new Error('Failed to fetch count variances');
  return res.json();
};

export interface BundleItem {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unit: string;
}

export interface Bundle {
  id: string;
  code: string;
  name: string;
  unit: string;
  mode: 'VIRTUAL_BUNDLE' | 'STOCKED_KIT';
  kitProductId?: string | null;
  kitCode?: string;
  kitName?: string;
  notes?: string;
  isActive: number;
  createdByName?: string;
  componentCount: number;
  buildable: number;
  limiting?: { productId: string; productCode: string; sets: number } | null;
  items: BundleItem[];
}

export const getBundles = async (warehouseId?: string): Promise<Bundle[]> => {
  const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : '';
  const res = await apiFetch(`/api/warehouse/bundles${query}`);
  if (!res.ok) throw new Error('Failed to fetch bundles');
  return res.json();
};

export const getBundle = async (id: string, warehouseId?: string): Promise<Bundle> => {
  const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : '';
  const res = await apiFetch(`/api/warehouse/bundles/${id}${query}`);
  if (!res.ok) throw new Error('Failed to fetch bundle');
  return res.json();
};

export const createBundle = async (data: Record<string, unknown>) => {
  const res = await apiFetch('/api/warehouse/bundles', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create bundle');
  }
  return res.json();
};

export const updateBundle = async (id: string, data: Record<string, unknown>) => {
  const res = await apiFetch(`/api/warehouse/bundles/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update bundle');
  }
  return res.json();
};

export const deleteBundle = async (id: string) => {
  const res = await apiFetch(`/api/warehouse/bundles/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete bundle');
  }
  return res.json();
};

export const addBundleItem = async (bundleId: string, data: Record<string, unknown>) => {
  const res = await apiFetch(`/api/warehouse/bundles/${bundleId}/items`, { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to add bundle item');
  }
  return res.json();
};

export const deleteBundleItem = async (bundleId: string, itemId: string) => {
  const res = await apiFetch(`/api/warehouse/bundles/${bundleId}/items/${itemId}`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete bundle item');
  }
  return res.json();
};

export const assembleBundle = async (id: string, data: { qty: number; warehouseId: string; locationId?: string }) => {
  const res = await apiFetch(`/api/warehouse/bundles/${id}/assemble`, { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to assemble bundle');
  }
  return res.json();
};

export const disassembleBundle = async (id: string, data: { qty: number; warehouseId: string; locationId?: string }) => {
  const res = await apiFetch(`/api/warehouse/bundles/${id}/disassemble`, { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to disassemble bundle');
  }
  return res.json();
};

export interface StockMove {
  id: string;
  qty: number;
  moveType: string;
  createdAt: string;
  docId?: string;
  docCode?: string;
  warehouseCode?: string;
  productCode?: string;
  createdByName?: string;
  serialNo?: string;
}

export interface MovesPage {
  rows: StockMove[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ReportSummary {
  month: string;
  byDay: { day: string; inbound: number; outbound: number }[];
  byType: { moveType: string; docs: number; qty: number }[];
  byWarehouse: {
    warehouseId: string; warehouseCode: string; warehouseName: string;
    onHand: number; reserved: number; available: number; sku: number;
  }[];
  inTransit: {
    id: string; code: string; etaDate?: string; createdAt: string;
    warehouseCode: string; toWarehouseCode?: string; lineCount: number; qty: number;
  }[];
}

export const getStockMoves = async (filters: {
  productId?: string; warehouseId?: string; moveType?: string;
  from?: string; to?: string; search?: string; page: number; pageSize: number;
}): Promise<MovesPage> => {
  const params = new URLSearchParams();
  if (filters.productId) params.set('productId', filters.productId);
  if (filters.warehouseId) params.set('warehouseId', filters.warehouseId);
  if (filters.moveType) params.set('moveType', filters.moveType);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.search) params.set('search', filters.search);
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  const res = await apiFetch(`/api/warehouse/moves?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch stock moves');
  return res.json();
};

export const getReportSummary = async (filters?: { month?: string; warehouseId?: string }): Promise<ReportSummary> => {
  const params = new URLSearchParams();
  if (filters?.month) params.set('month', filters.month);
  if (filters?.warehouseId) params.set('warehouseId', filters.warehouseId);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/api/warehouse/report/summary${query}`);
  if (!res.ok) throw new Error('Failed to fetch report summary');
  return res.json();
};

export interface AlertItem {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName?: string;
  onHand: number;
  available: number;
  minStock: number;
  maxStock: number;
  reorderPoint: number;
}

export interface SlowItem extends AlertItem {
  lastMoveAt?: string | null;
  daysSinceMove: number | null;
}

export interface AlertsData {
  out: AlertItem[];
  low: AlertItem[];
  slow: SlowItem[];
  incomingOverdue: { id: string; code: string; dueDate?: string; supplierName?: string; warehouseCode: string; lineCount: number }[];
  expiringReservations: { id: string; productCode: string; qty: number; expiresAt?: string; warehouseCode: string }[];
  exceptions: { WARRANTY: number; DAMAGED: number; QUARANTINE: number; LOST: number };
  slowDays: number;
}

export interface StockPolicy {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  minStock: number;
  maxStock: number;
  reorderPoint: number;
  preferredQty: number;
  leadTimeDays: number;
}

export const getAlerts = async (filters?: { warehouseId?: string; slowDays?: number }): Promise<AlertsData> => {
  const params = new URLSearchParams();
  if (filters?.warehouseId) params.set('warehouseId', filters.warehouseId);
  if (filters?.slowDays) params.set('slowDays', String(filters.slowDays));
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/api/warehouse/alerts${query}`);
  if (!res.ok) throw new Error('Failed to fetch alerts');
  return res.json();
};

export const getStockPolicies = async (filters?: { productId?: string; warehouseId?: string }): Promise<StockPolicy[]> => {
  const params = new URLSearchParams();
  if (filters?.productId) params.set('productId', filters.productId);
  if (filters?.warehouseId) params.set('warehouseId', filters.warehouseId);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/api/warehouse/policies${query}`);
  if (!res.ok) throw new Error('Failed to fetch stock policies');
  return res.json();
};

export const saveStockPolicy = async (data: { productId: string; warehouseId: string; minStock?: number; maxStock?: number; reorderPoint?: number; preferredQty?: number; leadTimeDays?: number }) => {
  const res = await apiFetch('/api/warehouse/policies', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to save stock policy');
  }
  return res.json();
};

export const deleteStockPolicy = async (id: string) => {
  const res = await apiFetch(`/api/warehouse/policies/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete stock policy');
  }
  return res.json();
};

export interface StockCount {
  id: string;
  code: string;
  warehouseId: string;
  warehouseCode?: string;
  warehouseName?: string;
  locationId?: string | null;
  locationCode?: string | null;
  status: 'planned' | 'in_progress' | 'reconciling' | 'done' | 'cancelled';
  blindCount: number;
  assigneeId?: string;
  assigneeName?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  lineCount: number;
  countedCount: number;
  varianceCount: number;
}

export interface StockCountLine {
  id: string;
  countId: string;
  productId: string;
  productCode: string;
  productName: string;
  systemQty: number | null;
  countedQty: number | null;
  status: 'pending' | 'counted' | 'approved' | 'resolved';
  resolution?: string;
  resolvedBy?: string;
}

export const getStockCounts = async (status?: string): Promise<StockCount[]> => {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await apiFetch(`/api/warehouse/counts${query}`);
  if (!res.ok) throw new Error('Failed to fetch stock counts');
  return res.json();
};

export const createStockCount = async (data: Record<string, unknown>) => {
  const res = await apiFetch('/api/warehouse/counts', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create stock count');
  }
  return res.json();
};

export const updateStockCount = async (id: string, data: Record<string, unknown>) => {
  const res = await apiFetch(`/api/warehouse/counts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update stock count');
  }
  return res.json();
};

export const snapshotStockCount = async (id: string) => {
  const res = await apiFetch(`/api/warehouse/counts/${id}/snapshot`, { method: 'POST' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to snapshot stock count');
  }
  return res.json();
};

export const getStockCountDetail = async (id: string): Promise<StockCount & { lines: StockCountLine[] }> => {
  const res = await apiFetch(`/api/warehouse/counts/${id}`);
  if (!res.ok) throw new Error('Failed to fetch stock count');
  return res.json();
};

export const recordCountedQty = async (countId: string, lineId: string, countedQty: number) => {
  const res = await apiFetch(`/api/warehouse/counts/${countId}/lines/${lineId}/count`, {
    method: 'PATCH', body: JSON.stringify({ countedQty }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to record count');
  }
  return res.json();
};

export const recountCountLine = async (countId: string, lineId: string) => {
  const res = await apiFetch(`/api/warehouse/counts/${countId}/lines/${lineId}/recount`, { method: 'POST' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to reopen line');
  }
  return res.json();
};

export const approveCountVariance = async (countId: string, lineId: string, resolution: string) => {
  const res = await apiFetch(`/api/warehouse/counts/${countId}/lines/${lineId}/approve`, {
    method: 'POST', body: JSON.stringify({ resolution }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to approve variance');
  }
  return res.json();
};

export const closeStockCount = async (id: string) => {
  const res = await apiFetch(`/api/warehouse/counts/${id}/close`, { method: 'POST' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to close count');
  }
  return res.json();
};

export interface InventoryLot {
  id: string;
  lotCode: string;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  expiryDate?: string | null;
  supplierName?: string;
  notes?: string;
  createdByName?: string;
  serialCount: number;
}

export interface SerialItem {
  id: string;
  serialNo: string;
  productId: string;
  productCode: string;
  productName: string;
  model?: string;
  brand?: string;
  warrantyMonths: number;
  lotId?: string | null;
  lotCode?: string;
  lotExpiry?: string | null;
  status: 'IN_STOCK' | 'RESERVED' | 'ISSUED' | 'WARRANTY' | 'DAMAGED' | 'LOST';
  warehouseId?: string | null;
  warehouseCode?: string;
  warehouseName?: string;
  locationId?: string | null;
  locationCode?: string;
  receiptCode?: string;
  issueCode?: string;
  customerRef?: string;
  warrantyStart?: string;
  warrantyEnd?: string;
  notes?: string;
  createdAt: string;
  timeline: {
    id: string; qty: number; moveType: string; createdAt: string;
    docId?: string; docCode?: string; warehouseCode?: string;
  }[];
}

export const getLots = async (filters?: { search?: string; productId?: string }): Promise<InventoryLot[]> => {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.productId) params.set('productId', filters.productId);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/api/warehouse/lots${query}`);
  if (!res.ok) throw new Error('Failed to fetch lots');
  return res.json();
};

export const createLot = async (data: Record<string, unknown>) => {
  const res = await apiFetch('/api/warehouse/lots', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create lot');
  }
  return res.json();
};

export const updateLot = async (id: string, data: Record<string, unknown>) => {
  const res = await apiFetch(`/api/warehouse/lots/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update lot');
  }
  return res.json();
};

export const deleteLot = async (id: string) => {
  const res = await apiFetch(`/api/warehouse/lots/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete lot');
  }
  return res.json();
};

export const searchSerials = async (filters?: { search?: string; status?: string; productId?: string; lineId?: string }): Promise<SerialItem[]> => {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.productId) params.set('productId', filters.productId);
  if (filters?.lineId) params.set('lineId', filters.lineId);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/api/warehouse/serials${query}`);
  if (!res.ok) throw new Error('Failed to fetch serials');
  return res.json();
};

export const getSerialDetail = async (serialNo: string): Promise<SerialItem> => {
  const res = await apiFetch(`/api/warehouse/serials/${encodeURIComponent(serialNo)}`);
  if (!res.ok) throw new Error('Failed to fetch serial');
  return res.json();
};

export const updateSerialStatus = async (serialNo: string, data: { status: string; notes?: string; customerRef?: string }) => {
  const res = await apiFetch(`/api/warehouse/serials/${encodeURIComponent(serialNo)}/status`, {
    method: 'PATCH', body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update serial status');
  }
  return res.json();
};

export const registerDocSerials = async (docId: string, lineId: string, data: { serials: string[]; lotId?: string }) => {
  const res = await apiFetch(`/api/warehouse/documents/${docId}/lines/${lineId}/serials`, {
    method: 'POST', body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to handle serials');
  }
  return res.json();
};
