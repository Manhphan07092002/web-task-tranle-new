export type TrackingType = 'NONE' | 'SERIAL' | 'LOT' | 'QUANTITY';

/** Hàng cũ NONE/giá trị thiếu được xử lý như QUANTITY ở UI. */
export function resolveTracking(value: unknown): Exclude<TrackingType, 'NONE'> {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'SERIAL' || normalized === 'LOT' || normalized === 'QUANTITY') return normalized;
  return 'QUANTITY';
}
