export type WarrantyStartType = 'OUTBOUND' | 'DELIVERY' | 'INSTALLATION' | 'ACCEPTANCE';

const VALID: WarrantyStartType[] = ['OUTBOUND', 'DELIVERY', 'INSTALLATION', 'ACCEPTANCE'];

function toDateOnly(value: unknown): string | null {
  const s = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : s;
}

export async function getWarrantyStartType(db: any): Promise<WarrantyStartType> {
  try {
    const row = await db.get('SELECT `value` FROM system_config WHERE `key` = ?', ['warranty_start_type']);
    const v = String(row?.value || '').trim().toUpperCase();
    if ((VALID as string[]).includes(v)) return v as WarrantyStartType;
  } catch { /* thiếu config -> fallback */ }
  return 'OUTBOUND';
}

/** Ngày bắt đầu BH theo cấu hình, fallback về ngày xuất kho rồi ngày nhập. */
export function resolveWarrantyStart(args: {
  startType: WarrantyStartType;
  outboundDate?: unknown;
  deliveryDate?: unknown;
  installationDate?: unknown;
  acceptanceDate?: unknown;
  fallbackDate?: unknown;
}): string | null {
  const pick = (...vals: unknown[]): string | null => {
    for (const v of vals) {
      const d = toDateOnly(v);
      if (d) return d;
    }
    return null;
  };
  switch (args.startType) {
    case 'DELIVERY':
      return pick(args.deliveryDate, args.outboundDate, args.fallbackDate);
    case 'INSTALLATION':
      return pick(args.installationDate, args.outboundDate, args.fallbackDate);
    case 'ACCEPTANCE':
      return pick(args.acceptanceDate, args.outboundDate, args.fallbackDate);
    case 'OUTBOUND':
    default:
      return pick(args.outboundDate, args.fallbackDate);
  }
}

/** Ngày hết BH = start + số tháng (cộng tháng dương lịch, vd 15/10 + 1 tháng = 15/11). */
export function warrantyEndDate(startDate: string | null, months: number): string | null {
  if (!startDate || !(months > 0)) return null;
  const [y, m, d] = startDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}
