import { apiFetch } from './api';

export interface InventoryItem {
  id: string;
  productCode: string;
  productName: string;
  quantity: number;
  unit: string;
  warehouseLocation?: string;
  minStockLevel?: number;
  maxStockLevel?: number;
  departmentId: string;
  category?: string;
  specCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryPage {
  rows: InventoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InventoryLot {
  id: string;
  productCode: string;
  productName: string;
  lotCode: string;
  expiryDate?: string | null;
  quantity: number;
  unit: string;
  locationCode?: string | null;
  departmentId: string;
  notes?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  expiryStatus?: 'none' | 'expired' | 'soon' | 'ok';
}

export interface ProductCombo {
  id: string;
  code: string;
  name: string;
  unit: string;
  notes?: string;
  isActive: number;
  createdByName?: string;
  componentCount: number;
  assemblable: number;
  items: { id: string; productCode: string; productName: string; quantity: number; unit: string }[];
}

export const getInventoryPaged = async (filters: { search?: string; location?: string; category?: string; unit?: string; page: number; pageSize: number }): Promise<InventoryPage> => {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.location) params.set('location', filters.location);
  if (filters.category) params.set('category', filters.category);
  if (filters.unit) params.set('unit', filters.unit);
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  const res = await apiFetch(`/api/warehouse/inventory?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch inventory');
  return res.json();
};

export const getInventoryMeta = async (): Promise<{ categories: string[]; units: string[] }> => {
  const res = await apiFetch('/api/warehouse/inventory-meta');
  if (!res.ok) throw new Error('Failed to fetch inventory meta');
  return res.json();
};

export const updateInventoryItem = async (id: string, data: { category?: string | null; specCode?: string | null } & Record<string, unknown>) => {
  const current: InventoryItem = await apiFetch(`/api/warehouse/inventory/${id}`).then((r) => {
    if (!r.ok) throw new Error('Failed to fetch inventory item');
    return r.json();
  });
  const res = await apiFetch(`/api/warehouse/inventory/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      productCode: current.productCode,
      productName: current.productName,
      quantity: current.quantity,
      unit: current.unit,
      warehouseLocation: current.warehouseLocation,
      minStockLevel: current.minStockLevel,
      maxStockLevel: current.maxStockLevel,
      category: data.category ?? current.category ?? null,
      specCode: data.specCode ?? current.specCode ?? null,
    }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update inventory item');
  }
  return res.json();
};

export const getLots = async (filters?: { search?: string; location?: string; expiring?: string }): Promise<InventoryLot[]> => {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.location) params.set('location', filters.location);
  if (filters?.expiring) params.set('expiring', filters.expiring);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/api/warehouse/lots${query}`);
  if (!res.ok) throw new Error('Failed to fetch lots');
  return res.json();
};

export const createLot = async (data: { productCode: string; productName: string; lotCode: string; expiryDate?: string; quantity: number; unit?: string; locationCode?: string; notes?: string }) => {
  const res = await apiFetch('/api/warehouse/lots', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create lot');
  }
  return res.json();
};

export const updateLot = async (id: string, data: { quantity?: number; expiryDate?: string | null; locationCode?: string | null; notes?: string }) => {
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

export const getCombos = async (search?: string): Promise<ProductCombo[]> => {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  const res = await apiFetch(`/api/warehouse/combos${query}`);
  if (!res.ok) throw new Error('Failed to fetch combos');
  return res.json();
};

export const createCombo = async (data: { code: string; name: string; unit?: string; notes?: string; items: { productCode: string; productName: string; quantity: number; unit?: string }[] }) => {
  const res = await apiFetch('/api/warehouse/combos', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create combo');
  }
  return res.json();
};

export const deleteCombo = async (id: string) => {
  const res = await apiFetch(`/api/warehouse/combos/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete combo');
  }
  return res.json();
};

export interface WarehouseTransaction {
  id: string;
  transactionCode: string;
  type: 'IN' | 'OUT' | 'ADJUST' | 'TRANSFER' | 'RETURN';
  productCode: string;
  productName: string;
  quantity: number;
  unit: string;
  fromLocation?: string;
  toLocation?: string;
  requestedBy: string;
  requestedByName?: string;
  approvedBy?: string;
  approvedByName?: string;
  assignedTo?: string;
  assignedToName?: string;
  dueDate?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  transferScope?: 'internal' | 'site' | null;
  status: 'pending' | 'approved' | 'completed' | 'rejected';
  departmentId: string;
  notes?: string;
  referenceDoc?: string;
  createdAt: string;
}

export interface WarehouseKpis {
  pendingDocuments: number;
  pendingDeltaPct: number | null;
  receiptsToday: number;
  receiptsDeltaPct: number | null;
  issuesToday: number;
  issuesDeltaPct: number | null;
  transfersInProgress: number;
  pendingStockCounts: number;
  inventoryAlerts: number;
}

export interface InventoryAlertItem {
  id: string;
  productCode: string;
  productName: string;
  quantity: number;
  unit: string;
  warehouseLocation?: string;
  minStockLevel: number;
  shortage: number;
}

export interface DocTypeRatioItem {
  type: string;
  count: number;
}

export interface WarehouseDashboardData {
  scope: 'own' | 'department' | 'all' | 'none';
  month?: string;
  kpis: WarehouseKpis;
  teamActivity: WarehouseTransaction[];
  myTasks: WarehouseTransaction[];
  inventoryAlerts: InventoryAlertItem[];
  docTypeRatio: DocTypeRatioItem[];
  pendingApprovals: WarehouseTransaction[];
}

export const getInventory = async (): Promise<InventoryItem[]> => {
  const res = await apiFetch('/api/warehouse/inventory');
  if (!res.ok) throw new Error('Failed to fetch inventory');
  return res.json();
};

export const getDashboard = async (opts?: { top?: number; month?: string }): Promise<WarehouseDashboardData> => {
  const params = new URLSearchParams();
  if (opts?.top) params.set('top', String(opts.top));
  if (opts?.month) params.set('month', opts.month);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/api/warehouse/dashboard${query}`);
  if (!res.ok) throw new Error('Failed to fetch warehouse dashboard');
  return res.json();
};

export interface WarehouseReportData {
  scope: string;
  month: string;
  byType: { type: string; count: number; totalQty: number }[];
  byStatus: { status: string; count: number }[];
  topIn: { productCode: string; productName: string; totalQty: number; count: number }[];
  topOut: { productCode: string; productName: string; totalQty: number; count: number }[];
}

export interface StockCountPeriod {
  id: string;
  code: string;
  month: string;
  location?: string;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  assignedTo?: string;
  assignedToName?: string;
  departmentId: string;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  itemCount: number;
  countedCount: number;
  varianceCount: number;
}

export interface StockCountItem {
  id: string;
  periodId: string;
  productCode: string;
  productName: string;
  systemQty: number;
  countedQty: number | null;
  unit: string;
  status: 'pending' | 'counted' | 'resolved';
  resolution?: string;
  resolvedBy?: string;
  resolvedByName?: string;
}

export interface VarianceItem extends StockCountItem {
  periodCode: string;
  month: string;
  periodLocation?: string;
  periodStatus: string;
  variance: number;
}

export interface WarehouseLocationRow {
  id: string | null;
  code: string;
  name: string;
  type: 'warehouse' | 'zone' | 'rack' | 'bin' | 'legacy';
  parentId?: string | null;
  parentCode?: string | null;
  itemCount: number;
  totalQuantity: number;
  alertCount: number;
}

export interface LocationsResponse {
  locations: WarehouseLocationRow[];
  unassigned: { itemCount: number; totalQuantity: number; alertCount: number };
}

export const getReport = async (month?: string): Promise<WarehouseReportData> => {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  const res = await apiFetch(`/api/warehouse/report${query}`);
  if (!res.ok) throw new Error('Failed to fetch warehouse report');
  return res.json();
};

export const getLocations = async (): Promise<LocationsResponse> => {
  const res = await apiFetch('/api/warehouse/locations');
  if (!res.ok) throw new Error('Failed to fetch warehouse locations');
  return res.json();
};

export const createLocation = async (data: { code: string; name: string; type?: string; parentId?: string; notes?: string }) => {
  const res = await apiFetch('/api/warehouse/locations', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create location');
  }
  return res.json();
};

export const updateLocation = async (id: string, data: { name?: string; type?: string; parentId?: string | null; notes?: string; isActive?: boolean }) => {
  const res = await apiFetch(`/api/warehouse/locations/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update location');
  }
  return res.json();
};

export const deleteLocation = async (id: string) => {
  const res = await apiFetch(`/api/warehouse/locations/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete location');
  }
  return res.json();
};

export const assignItemLocation = async (itemId: string, warehouseLocation: string | null) => {
  const res = await apiFetch(`/api/warehouse/inventory/${itemId}/location`, {
    method: 'PATCH', body: JSON.stringify({ warehouseLocation }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to assign location');
  }
  return res.json();
};

export const getStockCounts = async (month?: string): Promise<StockCountPeriod[]> => {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  const res = await apiFetch(`/api/warehouse/stock-counts${query}`);
  if (!res.ok) throw new Error('Failed to fetch stock count periods');
  return res.json();
};

export const createStockCount = async (data: { month: string; location?: string; assignedTo?: string; notes?: string }) => {
  const res = await apiFetch('/api/warehouse/stock-counts', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create stock count period');
  }
  return res.json();
};

export const updateStockCountStatus = async (id: string, status: string) => {
  const res = await apiFetch(`/api/warehouse/stock-counts/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update stock count period');
  }
  return res.json();
};

export const snapshotStockCount = async (id: string) => {
  const res = await apiFetch(`/api/warehouse/stock-counts/${id}/snapshot`, { method: 'POST' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to snapshot stock count');
  }
  return res.json();
};

export const getStockCountItems = async (id: string): Promise<{ period: StockCountPeriod; items: StockCountItem[] }> => {
  const res = await apiFetch(`/api/warehouse/stock-counts/${id}/items`);
  if (!res.ok) throw new Error('Failed to fetch stock count items');
  return res.json();
};

export const recordCountedQty = async (periodId: string, itemId: string, countedQty: number) => {
  const res = await apiFetch(`/api/warehouse/stock-counts/${periodId}/items/${itemId}/count`, {
    method: 'PATCH', body: JSON.stringify({ countedQty }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to record counted quantity');
  }
  return res.json();
};

export const resolveVariance = async (periodId: string, itemId: string, resolution: string) => {
  const res = await apiFetch(`/api/warehouse/stock-counts/${periodId}/items/${itemId}/resolve`, {
    method: 'PATCH', body: JSON.stringify({ resolution }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to resolve variance');
  }
  return res.json();
};

export const getVariances = async (opts?: { month?: string; unresolved?: boolean }): Promise<VarianceItem[]> => {
  const params = new URLSearchParams();
  if (opts?.month) params.set('month', opts.month);
  if (opts?.unresolved) params.set('unresolved', '1');
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/api/warehouse/variances${query}`);
  if (!res.ok) throw new Error('Failed to fetch variances');
  return res.json();
};

export const createTransaction = async (data: {
  type: string;
  productCode: string;
  productName: string;
  quantity: number;
  unit?: string;
  fromLocation?: string;
  toLocation?: string;
  notes?: string;
  referenceDoc?: string;
  assignedTo?: string;
  dueDate?: string;
  priority?: string;
  transferScope?: string;
  category?: string;
  specCode?: string;
}): Promise<{ id: string; transactionCode: string; success: boolean }> => {
  const res = await apiFetch('/api/warehouse/transactions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create transaction');
  }
  return res.json();
};

export const approveTransaction = async (id: string): Promise<{ success: boolean }> => {
  const res = await apiFetch(`/api/warehouse/transactions/${id}/approve`, {
    method: 'POST',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to approve transaction');
  }
  return res.json();
};

export const rejectTransaction = async (id: string, reason?: string): Promise<{ success: boolean }> => {
  const res = await apiFetch(`/api/warehouse/transactions/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to reject transaction');
  }
  return res.json();
};

export const completeTransaction = async (id: string): Promise<{ success: boolean }> => {
  const res = await apiFetch(`/api/warehouse/transactions/${id}/complete`, { method: 'POST' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to complete transaction');
  }
  return res.json();
};

export const getTransactions = async (filters?: { type?: string; status?: string; scope?: string }): Promise<WarehouseTransaction[]> => {
  const params = new URLSearchParams();
  if (filters?.type) params.set('type', filters.type);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.scope) params.set('scope', filters.scope);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/api/warehouse/transactions${query}`);
  if (!res.ok) throw new Error('Failed to fetch transactions');
  return res.json();
};
