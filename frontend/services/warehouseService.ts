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
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseTransaction {
  id: string;
  transactionCode: string;
  type: 'IN' | 'OUT' | 'ADJUST' | 'TRANSFER';
  productCode: string;
  productName: string;
  quantity: number;
  unit: string;
  fromLocation?: string;
  toLocation?: string;
  requestedBy: string;
  approvedBy?: string;
  status: 'pending' | 'approved' | 'completed' | 'rejected';
  departmentId: string;
  notes?: string;
  referenceDoc?: string;
  createdAt: string;
}

export const getInventory = async (): Promise<InventoryItem[]> => {
  const res = await apiFetch('/api/warehouse/inventory');
  if (!res.ok) throw new Error('Failed to fetch inventory');
  return res.json();
};

export const getTransactions = async (): Promise<WarehouseTransaction[]> => {
  const res = await apiFetch('/api/warehouse/transactions');
  if (!res.ok) throw new Error('Failed to fetch transactions');
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
