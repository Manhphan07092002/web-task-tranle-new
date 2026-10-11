import { apiFetch } from './api';

export interface StockLocation {
  id: string;
  warehouseId: string;
  parentId?: string | null;
  code: string;
  name: string;
  type: string;
  purpose: string;
  isActive: boolean;
  warehouseName?: string | null;
}

export async function getStockLocations(warehouseId?: string): Promise<StockLocation[]> {
  const res = await apiFetch(`/api/stock/locations${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ''}`);
  if (!res.ok) throw new Error('Không tải được vị trí kho');
  return res.json();
}

export async function saveStockLocation(body: {
  id?: string; warehouseId: string; code: string; name: string;
  type?: string; purpose?: string; parentId?: string | null; isActive?: boolean;
}): Promise<{ id: string }> {
  const { id, ...rest } = body;
  const res = await apiFetch(id ? `/api/stock/locations/${id}` : '/api/stock/locations', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rest),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Lưu vị trí thất bại');
  return data;
}
