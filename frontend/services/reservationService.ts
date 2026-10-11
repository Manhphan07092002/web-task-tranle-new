import { apiFetch } from './api';

export interface Reservation {
  id: string;
  productId: string;
  warehouseId: string;
  locationId?: string | null;
  quantity: number;
  sourceType: 'SALES_ORDER' | 'PROJECT' | 'WARRANTY' | 'INTERNAL';
  sourceId?: string | null;
  requestedBy?: string | null;
  status: 'HELD' | 'RELEASED' | 'CONSUMED';
  expiresAt?: string | null;
  createdAt: string;
  productName?: string | null;
  warehouseName?: string | null;
}

export async function getReservations(warehouseId?: string, status?: string): Promise<Reservation[]> {
  const qs = new URLSearchParams();
  if (warehouseId) qs.set('warehouseId', warehouseId);
  if (status) qs.set('status', status);
  const res = await apiFetch(`/api/stock/reservations${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Không tải được giữ hàng');
  return res.json();
}

export async function holdStock(body: {
  productId: string; warehouseId: string; locationId?: string | null;
  quantity: number; sourceType?: string; sourceId?: string | null; expiresAt?: string | null;
}): Promise<{ id: string }> {
  const res = await apiFetch('/api/stock/reservations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Giữ hàng thất bại');
  return data;
}

export async function settleReservation(id: string, action: 'release' | 'consume'): Promise<void> {
  const res = await apiFetch(`/api/stock/reservations/${id}/${action}`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Thao tác thất bại');
}
