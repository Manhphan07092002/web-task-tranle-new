import type { ElementType } from 'react';

// Department keys: stable codes, never display names (which are Vietnamese labels only).
export type DeptKey =
  | 'WAREHOUSE'
  | 'SALES'
  | 'ACCOUNTING'
  | 'HR'
  | 'PROJECT'
  | 'TECHNICAL_WARRANTY'
  | 'MARKETING'
  | 'PROCUREMENT'
  | 'BOARD';

export interface NavChild {
  id: string;
  label: string;
  to: string;
}

export interface NavItem {
  id: string;
  label: string;
  icon: ElementType;
  /** Direct link. Ignored when children is present (toggle only). */
  path: string;
  /** Visible when user has ANY of these permissions. */
  permission: string[] | null;
  /** Visible when managementLevel >= minLevel (except Admin 99). OR-combined with permission. */
  minLevel?: number;
  children?: NavChild[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  /** Show role-scope badge (TRƯỞNG PHÒNG / NHÂN VIÊN / GIÁM ĐỐC). */
  scopeBadge?: boolean;
}

export const DEPT_LABELS: Record<DeptKey, string> = {
  WAREHOUSE: 'Kho vận',
  SALES: 'Kinh doanh',
  ACCOUNTING: 'Kế toán',
  HR: 'Hành chính - Nhân sự',
  PROJECT: 'Dự án',
  TECHNICAL_WARRANTY: 'Kỹ thuật - Bảo hành',
  MARKETING: 'Marketing',
  PROCUREMENT: 'Mua hàng',
  BOARD: 'Ban Giám đốc',
};
