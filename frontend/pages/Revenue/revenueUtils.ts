import type { RevenueReport } from '../../services/revenueService.js';

// Pure helpers tách từ pages/Revenue/index.tsx (không JSX, không hooks, không DOM)
// để unit-test được trong môi trường node.

// ── Định dạng tiền ───────────────────────────────────────────────────────────

export const fmtMoney = (v: number) => v.toLocaleString('vi-VN') + ' ₫';

export const formatCompactVND = (val: number) => {
  if (val >= 1_000_000_000) return (val / 1_000_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tỷ';
  if (val >= 1_000_000) return (val / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(val) + ' ₫';
};

// Smart Y-axis formatter that adapts to data scale
export const makeYAxisFormatter = (data: { value: number }[]) => {
  const max = Math.max(...data.map(d => d.value), 1);
  if (max >= 1_000_000_000) return (val: number) => `${(val / 1_000_000_000).toFixed(1)}Tỷ`;
  if (max >= 1_000_000) return (val: number) => `${(val / 1_000_000).toFixed(1)}Tr`;
  if (max >= 1_000) return (val: number) => `${(val / 1_000).toFixed(0)}K`;
  return (val: number) => `${val.toFixed(0)}đ`;
};

// ── Kỳ báo cáo ───────────────────────────────────────────────────────────────

const fmtDay = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

export function getWeekRange() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d); start.setDate(diff);
  const end = new Date(start); end.setDate(start.getDate() + 4);
  return { start: fmtDay(start), end: fmtDay(end) };
}

export function getMonthRange() {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: fmtDay(start), end: fmtDay(end) };
}

export interface TodayParts {
  todayStr: string;
  todayWeek: WeekInfo;
  todayMonth: string;
  todayYear: number;
}

// Ngày hôm nay thực tế (dùng cho thống kê tuần/tháng/năm hiện tại).
// Tách riêng để test được và tránh hardcode ngày cố định trong component.
export function getTodayParts(): TodayParts {
  const today = new Date();
  const todayStr = fmtDay(today);
  return {
    todayStr,
    todayWeek: getWeekInfo(todayStr),
    todayMonth: todayStr.substring(0, 7),
    todayYear: today.getFullYear(),
  };
}

export interface WeekInfo {
  mondayStr: string;
  weekRange: string;
  weekNum: number;
  year: number;
  label: string;
}

// Helper to get week start date (Monday) and week label for a given date YYYY-MM-DD
export const getWeekInfo = (dateStr: string): WeekInfo => {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
  const monday = new Date(d.setDate(diff));

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = (date: Date) => date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const weekRange = `${fmt(monday)} - ${fmt(sunday)}`;

  // Week number
  const firstDayOfYear = new Date(monday.getFullYear(), 0, 1);
  const pastDaysOfYear = (monday.getTime() - firstDayOfYear.getTime()) / 86400000;
  const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);

  return {
    mondayStr: monday.toISOString().split('T')[0],
    weekRange,
    weekNum,
    year: monday.getFullYear(),
    label: `Tuần ${weekNum} (${weekRange})`
  };
};

// ── Tính toán từ hợp đồng ────────────────────────────────────────────────────

export interface ContractLike {
  products?: unknown;
  preTaxValue?: unknown;
}

// Lấy thuế VAT thực tế từ sản phẩm trong hợp đồng (ưu tiên hơn trường vatRate cấp HĐ)
export const getContractVatRate = (c: any): number => {
  try {
    const prods: any[] = Array.isArray(c.products) ? c.products
      : (c.products && typeof c.products === 'string' ? JSON.parse(c.products) : []);
    if (prods.length > 0) {
      const preTax = prods.reduce((s: number, p: any) => s + (Number(p.total) || 0), 0);
      const tax = prods.reduce((s: number, p: any) => s + ((Number(p.total) || 0) * (Number(p.vatRate) || 8) / 100), 0);
      if (preTax > 0) return Math.round(tax / preTax * 100);
      return Number(prods[0]?.vatRate) || 8;
    }
  } catch {}
  return Number(c.vatRate) || 8;
};

// Giá trị đã giao của hợp đồng: ưu tiên số lượng đã xuất × đơn giá theo dòng,
// fallback về giá trị trước thuế khi không có chi tiết sản phẩm.
export function computeDeliveredValue(c: ContractLike): number {
  const products: any[] = Array.isArray(c.products)
    ? c.products
    : (c.products && typeof c.products === 'string' ? JSON.parse(c.products) : []);
  if (products.length > 0) {
    return products.reduce((sum, p) => {
      const qty = Number(p.invoicedQuantity) || Number(p.exportedQuantity) || Number(p.quantity) || 0;
      const price = Number(p.unitPrice) || 0;
      return sum + (qty * price);
    }, 0);
  }
  return Number(c.preTaxValue) || 0;
}

export const getAssignees = (r: RevenueReport): string[] => {
  try {
    const rows: any[] = JSON.parse(r.content || '[]');
    return [...new Set(rows.map(row => row.assignee).filter(Boolean))] as string[];
  } catch {
    return [];
  }
};

/**
 * Compute deduplicated revenue totals from a list of reports.
 * Each contract (contractId) is counted only ONCE even if it appears in multiple reports.
 * Uses the value from the LATEST report (sorted by createdAt descending).
 */
export const getDeduplicatedTotals = (reports: RevenueReport[]) => {
  const contractMap = new Map<string, { delivered: number; preTax: number }>();
  // Sort newest first so newest report's value wins on conflict
  const sorted = [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  sorted.forEach(r => {
    try {
      const rows: any[] = JSON.parse(r.content || '[]');
      rows.forEach((row: any) => {
        const cid = row.contractId || row.contractNumber || `${r.id}_${row.contractNumber}`;
        if (!contractMap.has(cid)) {
          contractMap.set(cid, {
            delivered: Number(row.deliveredMonth) || 0,
            preTax: Number(row.preTaxValue) || 0,
          });
        }
      });
    } catch {
      // If content can't be parsed, fall back to report-level total
      if (!contractMap.has(`report_${r.id}`)) {
        contractMap.set(`report_${r.id}`, { delivered: r.totalDelivered, preTax: r.totalPreTax });
      }
    }
  });
  let totalDelivered = 0;
  let totalPreTax = 0;
  let maxVal = 0;
  contractMap.forEach(v => {
    totalDelivered += v.delivered;
    totalPreTax += v.preTax;
    if (v.delivered > maxVal) maxVal = v.delivered;
  });
  return { totalDelivered, totalPreTax, maxReport: maxVal };
};

// ── CSV (phần thuần string; Blob/download giữ ở component vì cần DOM) ─────────

export function toCsvContent(headers: string[], rows: unknown[][]): string {
  return [
    headers.join(','),
    ...rows.map(row => row.map(val => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(','))
  ].join('\n');
}

export interface InvoicedRow {
  contractNumber: string;
  clientName?: string;
  contractName?: string;
  invoiceDate?: string;
  invoiceNumber?: string;
  preTaxValue?: number;
  deliveredValue?: number;
  paidAmount?: number;
}

export function buildInvoicedCsv(list: InvoicedRow[]): string {
  const headers = ['Số Hợp đồng', 'Chủ đầu tư', 'Tên hợp đồng', 'Ngày xuất hóa đơn', 'Số hóa đơn', 'Giá trị trước thuế', 'Doanh thu đã xuất', 'Lũy kế thanh toán'];
  const rows = list.map(c => [
    c.contractNumber,
    c.clientName || '',
    c.contractName || '',
    c.invoiceDate || '',
    c.invoiceNumber || '',
    c.preTaxValue || 0,
    c.deliveredValue || 0,
    c.paidAmount || 0
  ]);
  return toCsvContent(headers, rows);
}

export interface DirectoryUser {
  id: string;
  name: string;
}

const HISTORY_STATUS_LABELS: Record<string, string> = {
  Draft: 'Nháp',
  'Pending Manager': 'Chờ TP duyệt',
  'Pending Director': 'Chờ GĐ duyệt',
  Approved: 'Đã duyệt',
  Rejected: 'Từ chối'
};

export function buildHistoryCsv(reports: RevenueReport[], users: DirectoryUser[]): string {
  const headers = ['Mã báo cáo', 'Tiêu đề', 'Loại', 'Từ ngày', 'Đến ngày', 'Phương thức', 'Phòng ban', 'Người thực hiện', 'Tổng doanh thu', 'Trạng thái', 'Ngày tạo'];
  const rows = reports.map(r => {
    const creatorName = users.find(u => u.id === r.authorId)?.name || r.authorId;
    const typeLabel = r.reportType === 'weekly' ? 'Tuần' : 'Tháng';
    const modeLabel = r.generationMode === 'automatic' ? 'Tự động' : 'Thủ công';
    const statusLabel = HISTORY_STATUS_LABELS[r.status] || r.status;
    return [
      r.id,
      r.title,
      typeLabel,
      r.periodStart || '',
      r.periodEnd || '',
      modeLabel,
      r.department || '',
      creatorName,
      r.totalDelivered,
      statusLabel,
      new Date(r.createdAt).toLocaleDateString('vi-VN')
    ];
  });
  return toCsvContent(headers, rows);
}
