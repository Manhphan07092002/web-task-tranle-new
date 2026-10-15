export type TrackingType = 'NONE' | 'SERIAL' | 'LOT' | 'QUANTITY';

const VALID: TrackingType[] = ['NONE', 'SERIAL', 'LOT', 'QUANTITY'];

/** Chuẩn hóa cách quản lý hàng: hàng cũ NONE được coi như QUANTITY.
 * Mọi logic nghiệp vụ phải dùng helper này, không so sánh tracking trực tiếp. */
export function resolveTracking(tracking: unknown): Exclude<TrackingType, 'NONE'> {
  const t = String(tracking || '').trim().toUpperCase();
  if (t === 'SERIAL' || t === 'LOT' || t === 'QUANTITY') return t;
  return 'QUANTITY';
}

export function isTrackingType(value: unknown): value is TrackingType {
  return (VALID as string[]).includes(String(value || '').trim().toUpperCase());
}
