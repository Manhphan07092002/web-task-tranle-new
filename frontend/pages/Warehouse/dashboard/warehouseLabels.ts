// Shared labels/badges for Warehouse modules.
// Permission rule: UI never decides authority by job title —
// visibility is driven by useRBAC()/backend data scope.

export const TX_TYPE_META: Record<string, { label: string; badge: string; dot: string }> = {
  IN: { label: 'Nhập kho', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', dot: 'bg-emerald-500' },
  OUT: { label: 'Xuất kho', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', dot: 'bg-rose-500' },
  TRANSFER: { label: 'Điều chuyển', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', dot: 'bg-orange-500' },
  RETURN: { label: 'Trả hàng', badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', dot: 'bg-purple-500' },
  ADJUST: { label: 'Kiểm kê', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', dot: 'bg-blue-500' },
};

export const TX_STATUS_META: Record<string, { label: string; badge: string }> = {
  pending: { label: 'Chờ xử lý', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  approved: { label: 'Đã duyệt', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  completed: { label: 'Hoàn thành', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  rejected: { label: 'Từ chối', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
};

export const PRIORITY_META: Record<string, { label: string; badge: string }> = {
  urgent: { label: 'Khẩn', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  high: { label: 'Cao', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  normal: { label: 'Bình thường', badge: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  low: { label: 'Thấp', badge: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' },
};

export function txTypeLabel(type: string): string {
  return TX_TYPE_META[type]?.label || type;
}

export function txStatusLabel(status: string): string {
  return TX_STATUS_META[status]?.label || status;
}

export function formatDateTime(value?: string): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(value?: string): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatTime(value?: string): string {
  if (!value) return '--:--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function deltaText(pct: number | null, base: string): string | null {
  if (pct === null || pct === undefined) return null;
  if (pct === 0) return `Không đổi ${base}`;
  const arrow = pct > 0 ? '▲' : '▼';
  return `${arrow} ${Math.abs(pct)}% ${base}`;
}
