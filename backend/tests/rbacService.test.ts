import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  resolveUserDepartments,
  getAccessibleDepartments,
  getDepartmentAndChildren,
  getManagedDepartments,
  getWarehouseScope,
  buildTaskScopeFilter,
  canAccessTask,
  checkApprovalAuthority,
} from '../services/rbacService.js';
import {
  requireDepartmentScope,
  applyTaskScopeFilter,
  checkResourceAccess,
  requireApprovalAuthority,
} from '../middleware/rbac.js';

const departments = [
  { id: 'd-bgd', name: 'Ban Giám Đốc', parentId: null },
  { id: 'd-kt', name: 'Phòng Kế Toán', parentId: 'd-bgd' },
  { id: 'd-kt-team', name: 'Tổ Thu Chi', parentId: 'd-kt' },
  { id: 'd-kd', name: 'Phòng Kinh Doanh', parentId: 'd-bgd' },
];

function db(scopes: Record<string, string[]> = {}) {
  return {
    all: async (sql: string, params?: any[]) => {
      if (String(sql).includes('FROM management_scopes')) return (scopes[params?.[0]] ?? []).map((departmentId) => ({ departmentId }));
      if (String(sql).includes('FROM departments')) return departments;
      return [];
    },
  };
}

const admin = { id: 'a', role: 'Admin', permissions: ['admin_panel'], managementLevel: 99 };
const director = { id: 'd', role: 'Director', permissions: ['view_all_tasks'], managementLevel: 40 };
const deputy = (extra: any = {}) => ({ id: 'p', role: 'Deputy Director', permissions: [], managementLevel: 30, primaryDepartmentId: 'd-kt', department: 'Phòng Kế Toán', ...extra });
const manager = { id: 'm', role: 'Manager', permissions: ['manage_dept_tasks'], managementLevel: 20, primaryDepartmentId: 'd-kt', department: 'Phòng Kế Toán' };
const employee = { id: 'e', role: 'Employee', permissions: ['view_own_tasks'], managementLevel: 10, primaryDepartmentId: 'd-kt', department: 'Phòng Kế Toán' };

describe('resolveUserDepartments (dual-column + fallback)', () => {
  it('Admin has no business scope', async () => {
    expect(await resolveUserDepartments(db(), admin)).toEqual({ ids: [], names: [] });
  });

  it('Director sees every department', async () => {
    const scope = await resolveUserDepartments(db(), director);
    expect(scope.ids).toHaveLength(4);
    expect(await getAccessibleDepartments(db(), director)).toHaveLength(4);
  });

  it('Manager sees own department plus children', async () => {
    expect(await resolveUserDepartments(db(), manager)).toEqual({
      ids: ['d-kt', 'd-kt-team'],
      names: ['Phòng Kế Toán', 'Tổ Thu Chi'],
    });
  });

  it('Deputy uses managed scopes when present', async () => {
    const scope = await resolveUserDepartments(db({ p: ['d-kd'] }), deputy());
    expect(scope).toEqual({ ids: ['d-kd'], names: ['Phòng Kinh Doanh'] });
  });

  it('Deputy without scopes falls back to own department (scopes table empty in practice)', async () => {
    expect(await resolveUserDepartments(db(), deputy())).toEqual({
      ids: ['d-kt', 'd-kt-team'],
      names: ['Phòng Kế Toán', 'Tổ Thu Chi'],
    });
  });

  it('legacy rows without primaryDepartmentId match by name', async () => {
    const legacy = { id: 'l', role: 'Employee', permissions: [], managementLevel: 10, department: 'Phòng Kinh Doanh' };
    expect(await resolveUserDepartments(db(), legacy)).toEqual({ ids: ['d-kd'], names: ['Phòng Kinh Doanh'] });
  });

  it('unknown department degrades to the raw name string', async () => {
    const scope = await resolveUserDepartments(db(), { id: 'x', managementLevel: 10, department: 'Phòng Ma' });
    expect(scope).toEqual({ ids: [], names: ['Phòng Ma'] });
  });

  it('getDepartmentAndChildren walks parentId', async () => {
    expect((await getDepartmentAndChildren(db(), 'd-kt')).map((d) => d.id)).toEqual(['d-kt', 'd-kt-team']);
    expect(await getDepartmentAndChildren(db(), 'ghost')).toEqual([]);
  });

  it('getManagedDepartments never throws when the table is missing', async () => {
    const broken = { all: async () => { throw new Error('no table'); } };
    expect(await getManagedDepartments(broken, 'p')).toEqual([]);
  });
});

describe('getWarehouseScope (explicit assignment)', () => {
  const warehouses = [{ id: 'wh-hn' }, { id: 'wh-hx1' }];

  function db(assigned: string[] = []) {
    return {
      all: async (sql: string, params?: any[]) => {
        if (String(sql).includes('FROM warehouses')) return warehouses;
        if (String(sql).includes('FROM user_warehouse_scopes')) {
          if (params?.[0] === 'boom') throw new Error('no table');
          return assigned.map((warehouseId) => ({ warehouseId }));
        }
        return [];
      },
    };
  }

  it('returns only assigned warehouses and dedupes', async () => {
    const nv = { id: 'nv', managementLevel: 10 };
    expect(await getWarehouseScope(db(['wh-hn', 'wh-hn', 'wh-hx1']), nv)).toEqual(['wh-hn', 'wh-hx1']);
    expect(await getWarehouseScope(db([]), nv)).toEqual([]);
  });

  it('hides everything from Admin and opens everything to Director', async () => {
    expect(await getWarehouseScope(db(['wh-hn']), { id: 'a', managementLevel: 99 })).toEqual([]);
    expect(await getWarehouseScope(db(), { id: 'd', managementLevel: 40 })).toEqual(['wh-hn', 'wh-hx1']);
  });

  it('degrades to [] without a user or without the table', async () => {
    expect(await getWarehouseScope(db(['wh-hn']), null)).toEqual([]);
    expect(await getWarehouseScope(db(), { id: 'boom', managementLevel: 10 })).toEqual([]);
  });

  it('manager without assignment sees no warehouse (must be assigned explicitly)', async () => {
    expect(await getWarehouseScope(db(['wh-hn']), { id: 'm', managementLevel: 20 })).toEqual(['wh-hn']);
    expect(await getWarehouseScope(db(), { id: 'm', managementLevel: 20 })).toEqual([]);
  });
});

describe('buildTaskScopeFilter (string department + join table)', () => {
  it('bypass stays 1=1 for view_all_tasks', async () => {
    expect(await buildTaskScopeFilter(db(), director)).toEqual({ condition: '1=1', params: [] });
  });

  it('manager filters by department names plus ownership', async () => {
    const filter = await buildTaskScopeFilter(db(), manager);
    expect(filter.condition).toContain('department IN (?, ?)');
    expect(filter.condition).toContain('task_assignees');
    expect(filter.params).toEqual(['Phòng Kế Toán', 'Tổ Thu Chi', 'm', 'm']);
  });

  it('employee with a department still sees only own and assigned (Pattern 1)', async () => {
    const filter = await buildTaskScopeFilter(db(), employee);
    expect(filter.params).toEqual(['e', 'e']);
    expect(filter.condition).not.toContain('department IN');
  });

  it('employee without any department still sees own and assigned', async () => {
    const filter = await buildTaskScopeFilter(db(), { id: 'e', managementLevel: 10 });
    expect(filter.params).toEqual(['e', 'e']);
    expect(filter.condition).not.toContain('department IN');
  });

  it('no user sees nothing', async () => {
    expect(await buildTaskScopeFilter(db(), null)).toEqual({ condition: '0=1', params: [] });
  });
});

describe('canAccessTask', () => {
  const scope = { ids: ['d-kt'], names: ['Phòng Kế Toán'] };

  it('owner, assignee, bypass and department manager pass', () => {
    expect(canAccessTask(employee, { createdBy: 'e' }, scope)).toBe(true);
    expect(canAccessTask(employee, { createdBy: 'x' }, scope, ['e'])).toBe(true);
    expect(canAccessTask(director, { createdBy: 'x', department: 'Y' }, scope)).toBe(true);
    expect(canAccessTask(manager, { createdBy: 'x', department: 'Phòng Kế Toán' }, scope)).toBe(true);
  });

  it('employee cannot peek into other departments', () => {
    expect(canAccessTask(employee, { createdBy: 'x', department: 'Phòng Kinh Doanh' }, scope)).toBe(false);
    expect(canAccessTask(null as any, {}, scope)).toBe(false);
  });
});

describe('checkApprovalAuthority matrix', () => {
  it('blocks Admin and Employee entirely', () => {
    expect(checkApprovalAuthority(admin, 'contract', 1)).toBe(false);
    expect(checkApprovalAuthority(employee, 'contract', 1)).toBe(false);
  });

  it('Director is unlimited', () => {
    expect(checkApprovalAuthority(director, 'contract', 10_000_000_000)).toBe(true);
  });

  it('enforces strict < limits per resource', () => {
    expect(checkApprovalAuthority(manager, 'contract', 499_999_999)).toBe(true);
    expect(checkApprovalAuthority(manager, 'contract', 500_000_000)).toBe(false);
    expect(checkApprovalAuthority(deputy(), 'contract', 1_999_999_999)).toBe(true);
    expect(checkApprovalAuthority(deputy(), 'contract', 2_000_000_000)).toBe(false);
    expect(checkApprovalAuthority(manager, 'payment', 99_999_999)).toBe(true);
    expect(checkApprovalAuthority(manager, 'payment', 100_000_000)).toBe(false);
    expect(checkApprovalAuthority(deputy(), 'purchase', 199_999_999)).toBe(true);
  });
});

describe('rbac middleware', () => {
  function app(user: any, scopes: Record<string, string[]> = {}) {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { (req as any).user = user; (req as any).db = db(scopes); next(); });
    return a;
  }

  it('requireDepartmentScope attaches context; applyTaskScopeFilter reuses it', async () => {
    const a = app(manager);
    a.get('/', requireDepartmentScope('task'), (req: any, res) => res.json({ ctx: req.rbacContext, filter: applyTaskScopeFilter(req) }));
    const res = await request(a).get('/').expect(200);
    expect(res.body.ctx).toEqual({ deptIds: ['d-kt', 'd-kt-team'], deptNames: ['Phòng Kế Toán', 'Tổ Thu Chi'], warehouseIds: [] });
    expect(res.body.filter.params).toEqual(['Phòng Kế Toán', 'Tổ Thu Chi', 'm', 'm']);
  });

  it('requireDepartmentScope rejects anonymous callers', async () => {
    const a = express();
    a.get('/', requireDepartmentScope(), (_req, res) => res.json({}));
    await request(a).get('/').expect(401);
  });

  it('checkResourceAccess mirrors the service', async () => {
    const a = app(manager);
    a.get('/own', requireDepartmentScope(), (req: any, res) => res.json({ ok: checkResourceAccess(req, { createdBy: 'x', department: 'Phòng Kế Toán' }) }));
    a.get('/other', requireDepartmentScope(), (req: any, res) => res.json({ ok: checkResourceAccess(req, { createdBy: 'x', department: 'Phòng Kinh Doanh' }) }));
    await request(a).get('/own').expect(200, { ok: true });
    await request(a).get('/other').expect(200, { ok: false });
  });

  it('requireApprovalAuthority reads amount and blocks over-limit', async () => {
    const a = app(manager);
    a.post('/approve', requireApprovalAuthority('contract'), (_req, res) => res.json({ ok: true }));
    await request(a).post('/approve').send({ amount: 100 }).expect(200, { ok: true });
    await request(a).post('/approve').send({ preTaxValue: 600_000_000 }).expect(403);
    const b = app(admin);
    b.post('/approve', requireApprovalAuthority('contract'), (_req, res) => res.json({ ok: true }));
    await request(b).post('/approve').send({ amount: 1 }).expect(403);
  });
});
