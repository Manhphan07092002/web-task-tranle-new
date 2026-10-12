import { DocumentChecklist } from '../../services/contractService';

export const fmtMoney = (v: number) => v.toLocaleString('vi-VN') + ' ₫';

/** Abbreviated money format: e.g. 150000000 → "150tr" */
export const fmtMoneyShort = (v: number) => {
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'tỷ';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'tr';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + 'k';
  return v.toString();
};

/** Calculate debt = max(0, postTaxValue - paidAmount) */
export const calcDebt = (postTaxValue: number, paidAmount: number) =>
  Math.max(0, (postTaxValue || 0) - (paidAmount || 0));

export const CHECKLIST_ITEMS: { key: keyof DocumentChecklist; label: string; short: string }[] = [
  { key: 'hopDongGoc', label: 'Hợp đồng gốc', short: 'HĐ' },
  { key: 'hoaDon', label: 'Hóa đơn', short: 'HĐn' },
  { key: 'bbbg', label: 'Biên bản bàn giao (BBBG)', short: 'BBBG' },
  { key: 'bbnt', label: 'Biên bản nghiệm thu (BBNT)', short: 'BBNT' },
  { key: 'deNghiTT', label: 'Đề nghị thanh toán', short: 'ĐNTT' },
  { key: 'thanhLy', label: 'Thanh lý hợp đồng', short: 'TL' },
  { key: 'camKetBH', label: 'Cam kết bảo hành', short: 'BH' },
  { key: 'coCq', label: 'CO-CQ', short: 'CO' },
  { key: 'phuluc', label: 'Phụ lục HĐ', short: 'PL' },
];

const readGroup = (group: number): string => {
  const digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
  let str = "";
  const h = Math.floor(group / 100);
  const t = Math.floor((group % 100) / 10);
  const u = group % 10;
  if (h > 0) str += digits[h] + " trăm ";
  if (t > 1) str += digits[t] + " mươi ";
  else if (t === 1) str += "mười ";
  else if (h > 0 && u > 0) str += "lẻ ";
  if (u === 1 && t > 1) str += "mốt ";
  else if (u === 5 && t > 0) str += "lăm ";
  else if (u > 0) str += digits[u] + " ";
  return str;
};

export const numToVnText = (num: number): string => {
  if (num === 0) return "Không đồng";
  if (num < 0) return "Âm " + numToVnText(Math.abs(num));
  let str = "";
  let groupIdx = 0;
  const units = ["", "nghìn ", "triệu ", "tỷ ", "nghìn tỷ "];
  while (num > 0) {
    const group = num % 1000;
    num = Math.floor(num / 1000);
    if (group > 0) str = readGroup(group) + units[groupIdx] + str;
    groupIdx++;
  }
  str = str.trim().replace(/\s+/g, ' ');
  return str.charAt(0).toUpperCase() + str.slice(1) + " đồng";
};

export const getStatusBadge = (status: string = 'draft') => {
  const s = {
    draft: { label: 'Bản nháp', classes: 'bg-gray-100 text-gray-700 border-gray-200' },
    pending: { label: 'Chờ duyệt', classes: 'bg-amber-100 text-amber-700 border-amber-200' },
    in_progress: { label: 'Đang thực hiện', classes: 'bg-blue-100 text-blue-700 border-blue-200' },
    completed: { label: 'Đã hoàn thành', classes: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    cancelled: { label: 'Đã hủy', classes: 'bg-red-100 text-red-700 border-red-200' },
  }[status] || { label: 'Bản nháp', classes: 'bg-gray-100 text-gray-700 border-gray-200' };

  return { label: s.label, classes: s.classes };
};

export const STATUS_OPTIONS = [
  { value: 'draft', label: 'Bản nháp', className: 'text-gray-700 bg-white' },
  { value: 'pending', label: 'Chờ duyệt', className: 'text-amber-700 bg-white' },
  { value: 'in_progress', label: 'Đang thực hiện', className: 'text-blue-700 bg-white' },
  { value: 'completed', label: 'Đã hoàn thành', className: 'text-emerald-700 bg-white' },
  { value: 'cancelled', label: 'Đã hủy', className: 'text-red-700 bg-white' },
];

export const getStatusSelectClasses = (status: string = 'draft') => {
  switch (status) {
    case 'draft': return 'bg-gray-100 text-gray-700 border-gray-200';
    case 'pending': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'in_progress': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'cancelled': return 'bg-red-100 text-red-700 border-red-200';
    default: return 'bg-gray-100 text-gray-700 border-gray-200';
  }
};
