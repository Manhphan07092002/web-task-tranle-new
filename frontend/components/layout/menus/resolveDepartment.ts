import type { Department, User } from '../../../types';
import type { DeptKey } from './menuTypes';

// Database department codes (migration 006) -> stable menu keys.
const CODE_MAP: Record<string, DeptKey> = {
  KHO: 'WAREHOUSE',
  KD: 'SALES',
  KT: 'ACCOUNTING',
  HCNS: 'HR',
  DA: 'PROJECT',
  KTBH: 'TECHNICAL_WARRANTY',
  MKT: 'MARKETING',
  MH: 'PROCUREMENT',
  BGD: 'BOARD',
};

// Legacy department ids -> menu keys (fallback when code is unavailable).
const ID_MAP: Record<string, DeptKey> = {
  'dept-kho': 'WAREHOUSE',
  'dept-kinh-doanh': 'SALES',
  'dept-ke-toan': 'ACCOUNTING',
  'dept-hcns': 'HR',
  'dept-du-an': 'PROJECT',
  'dept-ky-thuat': 'TECHNICAL_WARRANTY',
  'dept-marketing': 'MARKETING',
  'dept-mua-hang': 'PROCUREMENT',
  'dept-bgd': 'BOARD',
};

function matchName(name: string): DeptKey | null {
  const n = name.toLowerCase();
  if (/kho vận|kho van|\bkho\b/.test(n)) return 'WAREHOUSE';
  if (/kinh doanh/.test(n)) return 'SALES';
  if (/kế toán|ke toan/.test(n)) return 'ACCOUNTING';
  if (/hành chính|hanh chinh|nhân sự|nhan su|hcns/.test(n)) return 'HR';
  if (/dự án|du an/.test(n)) return 'PROJECT';
  if (/kỹ thuật|ky thuat|bảo hành|bao hanh/.test(n)) return 'TECHNICAL_WARRANTY';
  if (/marketing|tiếp thị|tiep thi/.test(n)) return 'MARKETING';
  if (/mua hàng|mua hang/.test(n)) return 'PROCUREMENT';
  if (/giám đốc|giam doc|lãnh đạo|lanh dao|\bbgd\b/.test(n)) return 'BOARD';
  return null;
}

// Resolve which department menu to render. Priority: department code,
// then department id, then display-name matching. Never hard-code titles
// at call sites — all matching lives here.
export function resolveDeptKey(user: User | null, departments: Department[] = []): DeptKey | null {
  if (!user) return null;
  const dept = departments.find((d) => d.id === user.primaryDepartmentId);
  const code = (dept?.code || '').toUpperCase();
  if (code && CODE_MAP[code]) return CODE_MAP[code];
  if (user.primaryDepartmentId && ID_MAP[user.primaryDepartmentId]) {
    return ID_MAP[user.primaryDepartmentId];
  }
  return matchName(`${user.department || ''} ${dept?.name || ''}`);
}

// Friendly Vietnamese role label for sidebar badge + profile subtitle.
export function roleLabel(level: number | undefined): string {
  if (level === 99) return 'QUẢN TRỊ';
  if ((level ?? 10) >= 40) return 'GIÁM ĐỐC';
  if ((level ?? 10) >= 20) return 'TRƯỞNG PHÒNG';
  return 'NHÂN VIÊN';
}

export function roleSubtitle(user: User | null): string {
  if (!user) return '';
  const level = user.managementLevel ?? 10;
  if (level === 99) return 'Quản trị viên';
  const deptName = user.department || '';
  if (level >= 40) return deptName ? `Giám đốc ${deptName}` : 'Giám đốc';
  if (level >= 20) return deptName ? `Trưởng phòng ${deptName}` : 'Trưởng phòng';
  return deptName ? `Nhân viên ${deptName}` : 'Nhân viên';
}
