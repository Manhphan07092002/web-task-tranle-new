import { describe, expect, it } from 'vitest';
import {
  LEVELS,
  levelOf,
  getAccessibleDeptNames,
  canApprove,
  canEditTask,
  canDeleteTask,
  canApproveContractValue,
} from '../utils/rbac.js';
import {
  DEPARTMENT_MENUS,
  asGroupList,
  deptFirstItem,
  deptFindItem,
  getDeptHomePath,
} from '../components/layout/menus/departmentMenus.js';
import { resolveDeptKey, resolveDeptKeyById } from '../components/layout/menus/resolveDepartment.js';
import type { User } from '../types.js';

const departments = [
  { id: 'tle-dept-bgd', name: 'Ban Giám Đốc', code: 'BGD', color: '#000' },
  { id: 'tle-dept-kt', name: 'Phòng Kế Toán', code: 'KT', color: '#000' },
  { id: 's1', name: 'Tổ Thu Chi', color: '#000' },
] as any;

const khoDepts = [
  ...departments,
  { id: 'tle-dept-kho', name: 'Kho vận', code: 'KHO', color: '#000' },
] as any;

function staff(overrides: Partial<User>): User {
  return {
    id: 'u', name: 'U', email: 'u@x.vn', role: 'Employee',
    department: 'Phòng Kế Toán', avatar: '', permissions: [],
    ...overrides,
  };
}

const nv = staff({ id: 'nv', managementLevel: 10, primaryDepartmentId: 'tle-dept-kt' });
const tp = staff({ id: 'tp', role: 'Manager', managementLevel: 20, primaryDepartmentId: 'tle-dept-kt' });
const pgd = staff({ id: 'p', role: 'Deputy Director', managementLevel: 30, primaryDepartmentId: 'tle-dept-bgd', department: 'Ban Giám Đốc', managedDepartments: ['tle-dept-kt'] });
const gd = staff({ id: 'd', role: 'Director', managementLevel: 40, department: 'Ban Giám Đốc' });
const admin = staff({ id: 'a', role: 'Admin', managementLevel: 99, department: 'Ban Giám Đốc', permissions: ['admin_panel'] });
const khoNv = staff({ id: 'k', managementLevel: 10, primaryDepartmentId: 'tle-dept-kho', department: 'Kho vận' });

describe('warehouse staff levels', () => {
  it('normalizes missing levels to Employee', () => {
    expect(levelOf(null)).toBe(LEVELS.EMPLOYEE);
    expect(levelOf({} as User)).toBe(LEVELS.EMPLOYEE);
    expect(levelOf(nv)).toBe(10);
  });

  it('resolves accessible department names per level', () => {
    expect(getAccessibleDeptNames(nv, departments)).toEqual(['Phòng Kế Toán']);
    expect(getAccessibleDeptNames(tp, departments)).toEqual(['Phòng Kế Toán']);
    expect(getAccessibleDeptNames(pgd, departments)).toEqual(['Phòng Kế Toán']);
    expect(getAccessibleDeptNames(gd, departments)).toHaveLength(3);
    expect(getAccessibleDeptNames(admin, departments)).toEqual([]);
    expect(getAccessibleDeptNames(null, departments)).toEqual([]);
  });
});

describe('warehouse approval buttons', () => {
  it('hides approve over the limit, shows within it', () => {
    expect(canApprove(tp, 'contract', 499_999_999)).toBe(true);
    expect(canApprove(tp, 'contract', 500_000_000)).toBe(false);
    expect(canApprove(pgd, 'contract', 1_999_999_999)).toBe(true);
    expect(canApprove(pgd, 'contract', 2_000_000_000)).toBe(false);
    expect(canApprove(nv, 'contract', 1)).toBe(false);
    expect(canApprove(admin, 'contract', 1)).toBe(false);
    expect(canApprove(gd, 'contract', 10_000_000_000)).toBe(true);
  });

  it('gates contract approve buttons by system role, scope and amount', () => {
    const small = { department: 'Phòng Kế Toán', preTaxValue: 100 };
    const big = { department: 'Phòng Kế Toán', preTaxValue: 600_000_000 };
    expect(canApproveContractValue(tp, small)).toBe(true);
    expect(canApproveContractValue(tp, big)).toBe(false);
    expect(canApproveContractValue(nv, small)).toBe(false);
    expect(canApproveContractValue(admin, big)).toBe(true);
    expect(canApproveContractValue(pgd, { department: 'Phòng Kế Toán', preTaxValue: 1_000_000_000 })).toBe(false);
    expect(canApproveContractValue(pgd, { department: 'Phòng Kế Toán', preTaxValue: 1_000_000_000 }, ['Phòng Kế Toán'])).toBe(true);
  });
});

describe('warehouse task buttons', () => {
  const own = { createdBy: 'nv', assignees: [], department: 'Phòng Kế Toán' };
  const other = { createdBy: 'x', assignees: [], department: 'Phòng Kế Toán' };
  const foreign = { createdBy: 'x', assignees: [], department: 'Kho khác' };

  it('owners and assignees edit, managers edit their scope only', () => {
    const names = getAccessibleDeptNames(tp, departments);
    expect(canEditTask(nv, own, [])).toBe(true);
    expect(canEditTask(nv, other, [])).toBe(false);
    expect(canEditTask(tp, other, names)).toBe(true);
    expect(canEditTask(tp, foreign, names)).toBe(false);
    expect(canEditTask(admin, other, [])).toBe(false);
  });

  it('only creators and directors delete', () => {
    expect(canDeleteTask(nv, own)).toBe(true);
    expect(canDeleteTask(tp, other)).toBe(false);
    expect(canDeleteTask(gd, other)).toBe(true);
  });
});

describe('warehouse sidebar data', () => {
  function groupsAll() {
    return asGroupList(DEPARTMENT_MENUS.WAREHOUSE).flatMap((g) => g.items);
  }

  it('serves seven groups with the overview first', () => {
    const groups = asGroupList(DEPARTMENT_MENUS.WAREHOUSE);
    expect(groups).toHaveLength(7);
    expect(groups[0].items[0].id).toBe('wh_overview');
  });

  it('hides management items from staff via minLevel', () => {
    const all = groupsAll();
    const staffVisible = all.filter((i) => i.minLevel === undefined);
    const tpOnly = all.filter((i) => i.minLevel !== undefined);
    expect(tpOnly.length).toBeGreaterThan(10);
    expect(tpOnly.every((i) => i.minLevel === 20)).toBe(true);
    expect(staffVisible.map((i) => i.id)).toContain('wh_stock');
    expect(staffVisible.map((i) => i.id)).not.toContain('wh_alerts');
  });

  it('routes every warehouse module, home goes to the overview', () => {
    expect(getDeptHomePath('WAREHOUSE')).toBe('/dept/warehouse?m=wh_overview');
    expect(getDeptHomePath('BOARD')).toBeNull();
    for (const id of ['wh_stock', 'wh_receipt', 'wh_issue', 'wh_transfer', 'wh_count', 'wh_serial', 'wh_bundle', 'wh_alerts', 'wh_approvals']) {
      expect(deptFindItem('WAREHOUSE', id)?.id).toBe(id);
    }
    expect(deptFirstItem('WAREHOUSE')?.id).toBe('wh_overview');
  });
});

describe('warehouse department resolution', () => {
  it('maps warehouse staff to the warehouse menu by id, code and name', () => {
    expect(resolveDeptKey(khoNv, khoDepts)).toBe('WAREHOUSE');
    expect(resolveDeptKeyById('tle-dept-kho', khoDepts)).toBe('WAREHOUSE');
    expect(resolveDeptKey(staff({ department: 'Kho Vận', primaryDepartmentId: undefined }), [])).toBe('WAREHOUSE');
  });

  it('keeps accountants on their own menu', () => {
    expect(resolveDeptKey(nv, departments)).toBe('ACCOUNTING');
    expect(resolveDeptKeyById('tle-dept-kt', departments)).toBe('ACCOUNTING');
  });
});
