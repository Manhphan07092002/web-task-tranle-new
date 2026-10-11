import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  createRequireAuth,
  requireManagementLevel,
  hasManagementLevel,
  getManagementLevel,
  MANAGEMENT_LEVELS,
} from '../middleware/auth.js';
import { roleRoutes } from '../routes/roles.js';
import { departmentRoutes } from '../routes/departments.js';
import { userRoutes } from '../routes/users.js';
import { authRoutes } from '../routes/auth.js';
import {
  resolveDeptKey,
  resolveDeptKeyById,
  keyOfDept,
} from '../../frontend/components/layout/menus/resolveDepartment.js';

const secret = 'test-only-rbac-standardization-secret-1234567890abcdef';

// ─── A. Helpers managementLevel (10/20/30/40/99, so sánh >=) ────────────────

describe('managementLevel helpers', () => {
  it('exposes the standardized discrete levels with gaps', () => {
    expect(MANAGEMENT_LEVELS).toMatchObject({ EMPLOYEE: 10, MANAGER: 20, DEPUTY: 30, DIRECTOR: 40, ADMIN: 99 });
  });

  it('defaults missing/garbage levels to Employee (10)', () => {
    expect(getManagementLevel(undefined)).toBe(10);
    expect(getManagementLevel(null)).toBe(10);
    expect(getManagementLevel({})).toBe(10);
    expect(getManagementLevel({ managementLevel: Number.NaN })).toBe(10);
    expect(getManagementLevel({ managementLevel: 20 })).toBe(20);
  });

  it('compares with >= so gaps stay extensible', () => {
    expect(hasManagementLevel({ id: 'x' } as any, 10)).toBe(true);
    expect(hasManagementLevel({ id: 'x', managementLevel: 25 } as any, 20)).toBe(true);
    expect(hasManagementLevel({ id: 'x', managementLevel: 25 } as any, 30)).toBe(false);
    expect(hasManagementLevel({ id: 'x', managementLevel: 99 } as any, 40)).toBe(true);
    expect(hasManagementLevel(undefined, 10)).toBe(false);
  });

  it('requireManagementLevel gates with 401/403', async () => {
    const app = express();
    app.get('/mgr', (req, _res, next) => { (req as any).user = (req.query.u as string) === 'mgr' ? { id: 'm', managementLevel: 20 } : { id: 'e', managementLevel: 10 }; next(); }, requireManagementLevel(20), (_req, res) => res.json({ ok: true }));
    app.get('/anon', requireManagementLevel(20), (_req, res) => res.json({ ok: true }));
    await request(app).get('/mgr?u=mgr').expect(200, { ok: true });
    await request(app).get('/mgr?u=emp').expect(403);
    await request(app).get('/anon').expect(401);
  });
});

// ─── B. Middleware chuẩn hóa level từ DB ─────────────────────────────────────

function authApp(db: any, token: string, extra?: (app: express.Express) => void) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.headers.authorization = `Bearer ${token}`; next(); });
  app.use(createRequireAuth(db));
  app.get('/', (req: any, res) => res.json(req.user));
  extra?.(app);
  return app;
}

describe('auth middleware level normalization', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('falls back to 10 when the user row predates the level column', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    const token = jwt.sign({ sub: 'u1', tokenVersion: 0 }, secret, { algorithm: 'HS256' });
    const db = { get: vi.fn().mockResolvedValue({ id: 'u1', role: 'Employee', tokenVersion: 0, managementLevel: null, permissions: '[]' }) };
    const body = (await request(authApp(db, token)).get('/').expect(200)).body;
    expect(body.managementLevel).toBe(10);
  });

  it('keeps numeric levels coming from the database', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    const token = jwt.sign({ sub: 'u2', tokenVersion: 0 }, secret, { algorithm: 'HS256' });
    const db = { get: vi.fn().mockResolvedValue({ id: 'u2', role: 'Manager', tokenVersion: 0, managementLevel: 20, primaryDepartmentId: 'd1', permissions: '[]' }) };
    const body = (await request(authApp(db, token)).get('/').expect(200)).body;
    expect(body).toMatchObject({ managementLevel: 20, primaryDepartmentId: 'd1' });
  });

  it('requireManagementLevel works end-to-end after authentication', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    const token = jwt.sign({ sub: 'u3', tokenVersion: 0 }, secret, { algorithm: 'HS256' });
    const db = { get: vi.fn().mockResolvedValue({ id: 'u3', role: 'Employee', tokenVersion: 0, managementLevel: 10, permissions: '[]' }) };
    const app = authApp(db, token, (a) => a.get('/tp', requireManagementLevel(20), (_req, res) => res.json({ ok: true })));
    await request(app).get('/tp').expect(403);
  });
});

// ─── C. Roles API theo level mới ─────────────────────────────────────────────

function adminApp(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).user = { id: 'admin', role: 'Admin', permissions: ['admin_panel', 'manage_users'], managementLevel: 99 }; next(); });
  app.use(router);
  return app;
}

function rolesDb(rows: any[]) {
  return {
    all: vi.fn().mockResolvedValue(rows),
    get: vi.fn(async (sql: string, params?: any[]) => {
      if (String(sql).includes('COUNT(*)')) return { count: 1 };
      return rows.find((r) => r.id === params?.[0]);
    }),
    run: vi.fn().mockResolvedValue({ changes: 1 }),
  };
}

describe('roles routes with managementLevel', () => {
  it('GET normalizes legacy rows missing the level to 10', async () => {
    const db = rolesDb([{ id: 'r1', name: 'Legacy', permissions: '[]', managementLevel: null, isSystem: 0 }]);
    const app = express(); app.use(express.json()); app.use(roleRoutes(db));
    const res = await request(app).get('/').expect(200);
    expect(res.body[0]).toMatchObject({ name: 'Legacy', managementLevel: 10, userCount: 1 });
  });

  it('POST persists the level', async () => {
    const db = rolesDb([]);
    const app = adminApp(roleRoutes(db));
    await request(app).post('/').send({ name: 'Kế toán', managementLevel: 20, permissions: [] }).expect(201);
    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('managementLevel');
    expect(params).toContain(20);
  });

  it('PUT syncs users.managementLevel when the role level changes', async () => {
    const db = rolesDb([{ id: 'role-manager', name: 'Manager', permissions: '[]', managementLevel: 20, isSystem: 1 }]);
    const app = adminApp(roleRoutes(db));
    await request(app).put('/role-manager').send({ name: 'Manager', managementLevel: 30, permissions: [] }).expect(200);
    const userSync = db.run.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE users SET managementLevel'));
    expect(userSync?.[1]).toContain(30);
  });
});

// ─── D. Users API tự sync level từ role ──────────────────────────────────────

function usersDb(roleLevel: number | null) {
  return {
    get: vi.fn(async (sql: string) => {
      if (String(sql).includes('FROM roles')) return { permissions: '[]', managementLevel: roleLevel };
      if (String(sql).includes('SELECT id, email FROM users')) return undefined;
      return undefined;
    }),
    all: vi.fn().mockResolvedValue([]),
    run: vi.fn().mockResolvedValue({ changes: 1 }),
  };
}

function usersApp(db: any) {
  return adminApp(userRoutes(db, { sendResetLinkEmail: vi.fn() }));
}

describe('users routes sync level from role', () => {
  it('POST assigns the role level to the new account', async () => {
    const db = usersDb(20);
    await request(usersApp(db)).post('/').send({ name: 'A', email: 'a@x.vn', role: 'Manager', department: 'P' }).expect(200);
    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('managementLevel');
    expect(params).toContain(20);
  });

  it('PUT refreshes the level when the role changes', async () => {
    const db: any = {
      get: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM roles')) return { permissions: '[]', managementLevel: 40 };
        return { id: 'u9', email: 'a@x.vn' };
      }),
      all: vi.fn().mockResolvedValue([]),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    await request(usersApp(db)).put('/u9').send({ name: 'A', email: 'a@x.vn', role: 'Director', department: 'P' }).expect(200);
    const update = db.run.mock.calls.find(([sql]: string[]) => String(sql).startsWith('UPDATE users SET'));
    expect(update?.[0]).toContain('managementLevel');
    expect(update?.[1]).toContain(40);
  });
});

// ─── E. Login fallback level theo roles ──────────────────────────────────────

describe('login managementLevel fallback', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('uses roles.managementLevel when the user row is stale', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    const passwordHash = await bcrypt.hash('CorrectPassword1', 4);
    const db = {
      get: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM users')) {
          return { id: 'u1', name: 'GĐ', email: 'gd@x.vn', password: passwordHash, role: 'Director', department: 'B', avatar: '', isLocked: 0, lockedUntil: null, tokenVersion: 0, managementLevel: null, primaryDepartmentId: null };
        }
        return { permissions: '[]', managementLevel: 40 };
      }),
      all: vi.fn().mockResolvedValue([]),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    const app = express(); app.use(express.json()); app.use(authRoutes(db));
    const res = await request(app).post('/login').send({ email: 'gd@x.vn', password: 'CorrectPassword1' }).expect(200);
    expect(res.body.user.managementLevel).toBe(40);
  });

  it('keeps a valid user level even without a role row', async () => {
    vi.stubEnv('JWT_SECRET', secret);
    const passwordHash = await bcrypt.hash('CorrectPassword1', 4);
    const db = {
      get: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM users')) {
          return { id: 'u2', name: 'TP', email: 'tp@x.vn', password: passwordHash, role: 'Custom', department: 'P', avatar: '', isLocked: 0, lockedUntil: null, tokenVersion: 0, managementLevel: 20, primaryDepartmentId: 'd9' };
        }
        return undefined;
      }),
      all: vi.fn().mockResolvedValue([]),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    const app = express(); app.use(express.json()); app.use(authRoutes(db));
    const res = await request(app).post('/login').send({ email: 'tp@x.vn', password: 'CorrectPassword1' }).expect(200);
    expect(res.body.user).toMatchObject({ managementLevel: 20, primaryDepartmentId: 'd9', permissions: [] });
  });
});

// ─── F. Chuẩn hóa DDL/migration (chống regression) ───────────────────────────

describe('database standardization guardrails', () => {
  const src = readFileSync(new URL('../db_mysql.ts', import.meta.url), 'utf8');

  it('users DDL matches code usage + level columns', () => {
    for (const col of ['lockedUntil', 'failedLogins', 'managementLevel', 'primaryDepartmentId', 'employeeCode', 'jobTitle']) {
      expect(src).toContain(col);
    }
    expect(src).toContain('idx_users_management_level');
    expect(src).toContain('idx_users_primary_dept');
  });

  it('roles DDL + seed carry the 5 system levels', () => {
    expect(src).toContain('managementLevel INT NOT NULL DEFAULT 10');
    for (const [name, level] of [['Admin', 99], ['Director', 40], ['Deputy Director', 30], ['Manager', 20], ['Employee', 10]] as const) {
      expect(src).toContain(name);
      expect(src).toContain(`managementLevel: ${level}`);
    }
  });

  it('keeps the level migrations instead of dropping lock columns', () => {
    expect(src).toContain("runVersionedMigration(db, 11, 'standardize_users_rbac_level'");
    expect(src).toContain("runVersionedMigration(db, 12, 'roles_management_level'");
    expect(src).not.toMatch(/DROP COLUMN [`'](failedLogins|lockedUntil)/);
  });
});

// ─── G. Phòng ban: đếm 2 cột + cascade + mã/cây ─────────────────────────────

describe('departments routes dual-column + cascade', () => {
  function deptDb(depts: any[]) {
    return {
      all: vi.fn().mockResolvedValue(depts),
      get: vi.fn(async (sql: string, params?: any[]) => {
        if (String(sql).includes('SELECT id, name FROM departments')) {
          return depts.find((d) => d.id === params?.[0]);
        }
        if (String(sql).includes('COUNT(*)')) return { count: 0 };
        if (String(sql).includes('SELECT * FROM departments')) {
          return depts.find((d) => d.id === params?.[0]);
        }
        return undefined;
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  function deptApp(db: any) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { id: 'a', role: 'Admin', permissions: ['admin_panel'], managementLevel: 99 }; next(); });
    app.use(departmentRoutes(db));
    return app;
  }

  it('counts users by name OR primaryDepartmentId', async () => {
    const db = deptDb([{ id: 'd1', name: 'P KT', managerId: null }]);
    await request(deptApp(db)).get('/').expect(200);
    const countCall = db.get.mock.calls.find(([sql]: string[]) => String(sql).includes('FROM users'));
    expect(countCall?.[0]).toContain('primaryDepartmentId');
    expect(countCall?.[1]).toEqual(['P KT', 'd1']);
  });

  it('rename cascades to all name-based department columns', async () => {
    const db = deptDb([{ id: 'd1', name: 'Old', managerId: null }]);
    await request(deptApp(db)).put('/d1').send({ name: 'New' }).expect(200);
    const updated = db.run.mock.calls.map(([sql]: string[]) => String(sql));
    for (const table of ['users', 'tasks', 'reports', 'contracts', 'revenue_reports', 'projects']) {
      expect(updated.some((s) => s === `UPDATE ${table} SET department = ? WHERE department = ?`)).toBe(true);
    }
  });

  it('persists code/parent/level/isActive on create', async () => {
    const db = deptDb([]);
    await request(deptApp(db)).post('/').send({ name: 'Kho mới', code: 'kho', parentId: 'd0', level: 3, isActive: 1 }).expect(201);
    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('code');
    expect(params).toContain('KHO');
    expect(params).toContain(3);
  });

  it('blocks delete when users attach via either column', async () => {
    const db: any = {
      all: vi.fn(),
      get: vi.fn(async (sql: string) => {
        if (String(sql).includes('SELECT * FROM departments')) return { id: 'd1', name: 'P' };
        return { count: 2 };
      }),
      run: vi.fn(),
    };
    const res = await request(deptApp(db)).delete('/d1').expect(409);
    expect(res.body.error).toContain('2 nhân viên');
    expect(db.run).not.toHaveBeenCalled();
  });
});

// ─── H. resolveDepartment (dùng chung sidebar + guard) ───────────────────────

describe('department resolution', () => {
  const departments = [
    { id: 'tle-dept-bgd', name: 'Ban Giám Đốc', code: 'BGD', color: '#000' },
    { id: 'dept-kho', name: 'Kho Vận', color: '#000' },
    { id: 'd-sales', name: 'Phòng Kinh Doanh', code: 'KD', color: '#000' },
  ] as any;

  it('resolves by code, legacy id, then name', () => {
    expect(resolveDeptKey({ primaryDepartmentId: 'tle-dept-bgd' } as any, departments)).toBe('BOARD');
    expect(resolveDeptKey({ primaryDepartmentId: 'dept-kho' } as any, departments)).toBe('WAREHOUSE');
    expect(resolveDeptKey({ department: 'Phòng Kinh Doanh' } as any, [])).toBe('SALES');
    expect(resolveDeptKeyById('d-sales', departments)).toBe('SALES');
    expect(keyOfDept(undefined)).toBeNull();
  });
});
