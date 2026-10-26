import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { userRoutes } from '../routes/users.js';
import { projectRoutes } from '../routes/projects.js';
import { roleRoutes } from '../routes/roles.js';
import { departmentRoutes } from '../routes/departments.js';

function adminApp(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).user = { id: 'admin-1', role: 'Admin', permissions: ['admin_panel', 'manage_users'], managementLevel: 99 }; next(); });
  app.use(router);
  return app;
}

const dupEntry = () => { const e: any = new Error("Duplicate entry 'X' for key 'roles.name'"); e.code = 'ER_DUP_ENTRY'; return e; };

// ─── Users CRUD ─────────────────────────────────────────────────────────────

describe('users CRUD', () => {
  function db(roleLevel: number | null = 10) {
    return {
      get: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM roles')) return { permissions: '[]', managementLevel: roleLevel };
        if (String(sql).includes('SELECT id, email FROM users')) return { id: 'u1', email: 'a@x.vn' };
        return undefined;
      }),
      all: vi.fn().mockResolvedValue([]),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  it('POST valid creates with synced level', async () => {
    const d = db(20);
    await request(adminApp(userRoutes(d, {}))).post('/').send({ name: 'A', email: 'a@x.vn', password: 'password1', role: 'Manager', department: 'P' }).expect(200);
    expect(d.run).toHaveBeenCalled();
  });

  it('POST invalid email/password is rejected', async () => {
    const d = db();
    await request(adminApp(userRoutes(d, {}))).post('/').send({ name: '', email: 'not-an-email', role: 'Employee' }).expect(400);
    expect(d.run).not.toHaveBeenCalled();
  });

  it('POST duplicate email surfaces conflict, not 500', async () => {
    const d = db();
    d.run.mockRejectedValueOnce(dupEntry());
    await request(adminApp(userRoutes(d, {}))).post('/').send({ name: 'A', email: 'a@x.vn', password: 'password12', role: 'Employee' }).expect(409);
  });

  it('PUT missing user is 404', async () => {
    const d: any = { get: vi.fn(async (sql: string) => String(sql).includes('FROM roles') ? { permissions: '[]', managementLevel: 10 } : undefined), all: vi.fn(), run: vi.fn() };
    await request(adminApp(userRoutes(d, {}))).put('/ghost').send({ name: 'A', email: 'a@x.vn', role: 'Employee' }).expect(404);
  });

  it('non-admin list still carries parsed permissions (no stale localStorage)', async () => {
    const rows = [{ id: 'u1', role: 'Manager', isLocked: 0, permissions: '["approve_dept_reports"]', preferences: null }];
    const d: any = { get: vi.fn(), all: vi.fn().mockResolvedValue(rows), run: vi.fn() };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { id: 'm', role: 'Manager', permissions: ['manage_dept_tasks'], managementLevel: 20 }; next(); });
    app.use(userRoutes(d, {}));
    const res = await request(app).get('/').expect(200);
    expect(res.body[0].permissions).toEqual(['approve_dept_reports']);
  });

  it('DELETE refuses self-deletion', async () => {
    const d = db();
    await request(adminApp(userRoutes(d, {}))).delete('/admin-1').expect(403);
    expect(d.run).not.toHaveBeenCalled();
  });

  it('DELETE other user works', async () => {
    const d = db();
    await request(adminApp(userRoutes(d, {}))).delete('/u9').expect(200);
  });
});

// ─── Management scopes ──────────────────────────────────────────────────────

describe('user management scopes', () => {
  function db() {
    return {
      get: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM users')) return { id: 'u1' };
        if (String(sql).includes('FROM departments')) return { id: 'd1' };
        return undefined;
      }),
      all: vi.fn(async () => [{ departmentId: 'd1' }, { departmentId: 'd2' }]),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  it('GET returns the department id list', async () => {
    const d = db();
    const res = await request(adminApp(userRoutes(d, {}))).get('/u1/scopes').expect(200);
    expect(res.body).toEqual(['d1', 'd2']);
  });

  it('PUT replaces scopes, dedupes and revokes tokens', async () => {
    const d = db();
    const res = await request(adminApp(userRoutes(d, {}))).put('/u1/scopes').send({ departmentIds: ['d1', 'd1', 'd2'] }).expect(200);
    expect(res.body).toEqual({ success: true, departmentIds: ['d1', 'd2'] });
    expect(d.run.mock.calls[0][0]).toBe('DELETE FROM management_scopes WHERE userId = ?');
    expect(d.run.mock.calls.some(([sql]: string[]) => String(sql).includes('tokenVersion = tokenVersion + 1'))).toBe(true);
  });

  it('PUT rejects unknown departments and bad payloads', async () => {
    const d: any = {
      get: vi.fn(async (sql: string) => String(sql).includes('FROM users') ? { id: 'u1' } : undefined),
      all: vi.fn(),
      run: vi.fn(),
    };
    await request(adminApp(userRoutes(d, {}))).put('/u1/scopes').send({ departmentIds: ['ghost'] }).expect(400);
    await request(adminApp(userRoutes(d, {}))).put('/u1/scopes').send({ departmentIds: 'd1' }).expect(400);
    expect(d.run).not.toHaveBeenCalled();
  });

  it('PUT missing user is 404', async () => {
    const d: any = { get: vi.fn().mockResolvedValue(undefined), all: vi.fn(), run: vi.fn() };
    await request(adminApp(userRoutes(d, {}))).put('/ghost/scopes').send({ departmentIds: [] }).expect(404);
  });

  it('employee cannot touch scopes', async () => {
    const d = db();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { id: 'e', role: 'Employee', permissions: [], managementLevel: 10 }; next(); });
    app.use(userRoutes(d, {}));
    await request(app).get('/u1/scopes').expect(403);
    await request(app).put('/u1/scopes').send({ departmentIds: [] }).expect(403);
  });

  it('GET assignments maps rows and degrades to [] without the table', async () => {
    const d: any = {
      get: vi.fn(),
      all: vi.fn().mockResolvedValue([{ id: 'tle-1', departmentId: 'd1', departmentName: 'P KT', title: 'Kế toán', isPrimary: 1, confirmationStatus: 'ok', effectiveFrom: null, note: null }]),
      run: vi.fn(),
    };
    const res = await request(adminApp(userRoutes(d, {}))).get('/u1/assignments').expect(200);
    expect(res.body).toEqual([{ id: 'tle-1', departmentId: 'd1', departmentName: 'P KT', title: 'Kế toán', isPrimary: true, confirmationStatus: 'ok', effectiveFrom: null, note: null }]);

    const nodb: any = { get: vi.fn(), all: vi.fn().mockRejectedValue(new Error('no table')), run: vi.fn() };
    await request(adminApp(userRoutes(nodb, {}))).get('/u1/assignments').expect(200, []);
  });
});

// ─── Warehouse scopes ───────────────────────────────────────────────────────

describe('user warehouse scopes', () => {
  function db() {
    return {
      get: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM users')) return { id: 'u1' };
        if (String(sql).includes('FROM warehouses')) return { id: 'wh-hn' };
        return undefined;
      }),
      all: vi.fn(async () => [{ warehouseId: 'wh-hn' }]),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  it('GET returns the warehouse id list', async () => {
    const res = await request(adminApp(userRoutes(db(), {}))).get('/u1/warehouse-scopes').expect(200);
    expect(res.body).toEqual(['wh-hn']);
  });

  it('PUT replaces scopes and revokes tokens', async () => {
    const d = db();
    const res = await request(adminApp(userRoutes(d, {}))).put('/u1/warehouse-scopes').send({ warehouseIds: ['wh-hn'] }).expect(200);
    expect(res.body).toEqual({ success: true, warehouseIds: ['wh-hn'] });
    expect(d.run.mock.calls[0][0]).toBe('DELETE FROM user_warehouse_scopes WHERE userId = ?');
    expect(d.run.mock.calls.some(([sql]: string[]) => String(sql).includes('tokenVersion = tokenVersion + 1'))).toBe(true);
  });

  it('PUT rejects unknown warehouses and bad payloads', async () => {
    const d: any = {
      get: vi.fn(async (sql: string) => String(sql).includes('FROM users') ? { id: 'u1' } : undefined),
      all: vi.fn(),
      run: vi.fn(),
    };
    await request(adminApp(userRoutes(d, {}))).put('/u1/warehouse-scopes').send({ warehouseIds: ['ghost'] }).expect(400);
    await request(adminApp(userRoutes(d, {}))).put('/u1/warehouse-scopes').send({ warehouseIds: 'wh-hn' }).expect(400);
    expect(d.run).not.toHaveBeenCalled();
  });

  it('warehouses list returns the master data', async () => {
    const { warehouseRoutes } = await import('../routes/warehouses.js');
    const d: any = { all: vi.fn().mockResolvedValue([{ id: 'wh-hn', code: 'HN', name: 'Kho Hà Nội', region: 'Bắc', address: null, isActive: 1 }]) };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { id: 'a', role: 'Admin', managementLevel: 99 }; next(); });
    app.use(warehouseRoutes(d));
    const res = await request(app).get('/').expect(200);
    expect(res.body).toEqual([{ id: 'wh-hn', code: 'HN', name: 'Kho Hà Nội', region: 'Bắc', address: null, isActive: true }]);
  });
});

// ─── Roles CRUD ─────────────────────────────────────────────────────────────

describe('roles CRUD', () => {
  function db(rows: any[] = []) {
    return {
      all: vi.fn().mockResolvedValue(rows),
      get: vi.fn(async (sql: string, params?: any[]) => {
        if (String(sql).includes('COUNT(*)')) return { count: 0 };
        return rows.find((r) => r.id === params?.[0]);
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  it('POST duplicate name surfaces conflict, not 500', async () => {
    const d = db();
    d.run.mockRejectedValueOnce(dupEntry());
    await request(adminApp(roleRoutes(d))).post('/').send({ name: 'Manager', permissions: [] }).expect(409);
  });

  it('PUT Admin role keeps level 99 even if a lower level is sent', async () => {
    const d = db([{ id: 'role-admin', name: 'Admin', permissions: '[]', managementLevel: 99, isSystem: 1 }]);
    await request(adminApp(roleRoutes(d))).put('/role-admin').send({ name: 'Admin', managementLevel: 10, permissions: [] }).expect(200);
    const update = d.run.mock.calls.find(([sql]: string[]) => String(sql).startsWith('UPDATE roles SET'));
    expect(update?.[1]).toContain(99);
  });

  it('PUT system role never renames', async () => {
    const d = db([{ id: 'r1', name: 'Director', permissions: '[]', managementLevel: 40, isSystem: 1 }]);
    await request(adminApp(roleRoutes(d))).put('/r1').send({ name: 'Hacker', permissions: [] }).expect(200);
    const update = d.run.mock.calls.find(([sql]: string[]) => String(sql).startsWith('UPDATE roles SET'));
    expect(String(update?.[0])).not.toContain('name = ?');
  });

  it('DELETE system role is forbidden', async () => {
    const d = db([{ id: 'r1', name: 'Director', permissions: '[]', managementLevel: 40, isSystem: 1 }]);
    await request(adminApp(roleRoutes(d))).delete('/r1').expect(403);
  });

  it('DELETE missing role is 404', async () => {
    const d = db([]);
    await request(adminApp(roleRoutes(d))).delete('/ghost').expect(404);
  });
});

// ─── Projects scope ─────────────────────────────────────────────────────────

describe('projects scope', () => {
  const departments = [
    { id: 'd-kt', name: 'P KT', parentId: null },
    { id: 'd-kd', name: 'P KD', parentId: null },
  ];
  const manager = { id: 'm', role: 'Manager', department: 'P KT', primaryDepartmentId: 'd-kt', managementLevel: 20, permissions: [] };
  const employee = { id: 'e', role: 'Employee', department: 'P KT', primaryDepartmentId: 'd-kt', managementLevel: 10, permissions: [] };

  function db() {
    return {
      all: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM departments')) return departments;
        if (String(sql).includes('FROM management_scopes')) return [];
        if (String(sql).startsWith('SELECT * FROM projects')) return [];
        return [];
      }),
      get: vi.fn(),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  function appFor(user: any, db: any) {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = user; next(); });
    app.use(projectRoutes(db));
    return app;
  }

  it('manager lists managed plus department projects', async () => {
    const d = db();
    await request(appFor(manager, d)).get('/').expect(200);
    const projectQuery = d.all.mock.calls.find(([s]: string[]) => String(s).startsWith('SELECT * FROM projects')) as unknown as [string, any[]] | undefined;
    const [sql, params] = projectQuery ?? ['', []];
    expect(sql).toContain('department IN (?)');
    expect(params).toEqual(['m', 'P KT']);
  });

  it('employee keeps the legacy manager-or-department filter', async () => {
    const d = db();
    await request(appFor(employee, d)).get('/').expect(200);
    const [sql] = d.all.mock.calls.find(([s]: string[]) => String(s).startsWith('SELECT * FROM projects'))!;
    expect(sql).toContain('department = ?');
    expect(sql).not.toContain('department IN');
  });

  it('single project allows same-department managers', async () => {
    const d: any = {
      all: vi.fn(async (sql: string) => String(sql).includes('FROM departments') ? departments : []),
      get: vi.fn(async (sql: string) => String(sql).includes('FROM projects') ? { id: 'p1', managerId: 'other', department: 'P KT' } : undefined),
      run: vi.fn(),
    };
    const res = await request(appFor(manager, d)).get('/p1').expect(200);
    expect(res.body.project.id).toBe('p1');
  });

  it('single project blocks other departments', async () => {
    const d: any = {
      all: vi.fn(async (sql: string) => String(sql).includes('FROM departments') ? departments : []),
      get: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM projects')) return { id: 'p2', managerId: 'other', department: 'P KD' };
        return undefined;
      }),
      run: vi.fn(),
    };
    await request(appFor(manager, d)).get('/p2').expect(403);
  });
});

// ─── Departments CRUD ───────────────────────────────────────────────────────

describe('departments CRUD', () => {
  function db(depts: any[] = []) {
    return {
      all: vi.fn().mockResolvedValue(depts),
      get: vi.fn(async (sql: string, params?: any[]) => {
        if (String(sql).includes('COUNT(*)')) return { count: 0 };
        if (String(sql).includes('SELECT id, name FROM departments')) return depts.find((d) => d.id === params?.[0]);
        return depts.find((d) => d.id === params?.[0]);
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  function app(d: any) {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { (req as any).user = { id: 'a', role: 'Admin', permissions: ['admin_panel'], managementLevel: 99 }; next(); });
    a.use(departmentRoutes(d));
    return a;
  }

  it('POST requires a non-blank name', async () => {
    const d = db();
    await request(app(d)).post('/').send({ name: '   ' }).expect(400);
    expect(d.run).not.toHaveBeenCalled();
  });

  it('PUT whitespace-only name is rejected, not saved as empty', async () => {
    const d = db([{ id: 'd1', name: 'Old', managerId: null }]);
    await request(app(d)).put('/d1').send({ name: '   ' }).expect(400);
    expect(d.run).not.toHaveBeenCalled();
  });

  it('PUT missing department is 404', async () => {
    const d = db([]);
    await request(app(d)).put('/ghost').send({ name: 'New' }).expect(404);
  });

  it('DELETE blocked when users attach via primaryDepartmentId', async () => {
    const d: any = {
      all: vi.fn(),
      get: vi.fn(async (sql: string) => String(sql).includes('SELECT * FROM departments') ? { id: 'd1', name: 'P' } : { count: 3 }),
      run: vi.fn(),
    };
    await request(app(d)).delete('/d1').expect(409);
    expect(d.run).not.toHaveBeenCalled();
  });

  it('non-admin cannot write departments', async () => {
    const d = db([]);
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { (req as any).user = { id: 'e', role: 'Employee', permissions: [], managementLevel: 10 }; next(); });
    a.use(departmentRoutes(d));
    await request(a).post('/').send({ name: 'X' }).expect(403);
    await request(a).put('/d1').send({ name: 'X' }).expect(403);
    await request(a).delete('/d1').expect(403);
    expect(d.run).not.toHaveBeenCalled();
  });
});
