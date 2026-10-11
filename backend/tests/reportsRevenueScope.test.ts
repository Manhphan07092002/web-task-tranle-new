import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { reportRoutes } from '../routes/reports.js';
import { revenueRoutes } from '../routes/revenue.js';

const departments = [
  { id: 'd-kt', name: 'P KT', parentId: null },
  { id: 'd-kd', name: 'P KD', parentId: null },
];

const manager = { id: 'm', name: 'TP', role: 'Manager', department: 'P KT', primaryDepartmentId: 'd-kt', managementLevel: 20, permissions: ['approve_dept_reports', 'approve_dept_revenue'] };
const deputyManaged = { id: 'p', name: 'PGĐ', role: 'Deputy Director', department: 'P KD', primaryDepartmentId: 'd-kd', managementLevel: 30, permissions: ['approve_dept_reports', 'approve_dept_revenue'] };
const employee = { id: 'e', name: 'NV', role: 'Employee', department: 'P KT', primaryDepartmentId: 'd-kt', managementLevel: 10, permissions: ['create_report'] };
const viewer = { id: 'v', name: 'GĐ', role: 'Director', department: 'B', managementLevel: 40, permissions: ['view_all_reports', 'director_feedback'] };

function appFor(user: any, router: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(router);
  return app;
}

function listDb(scopes: Record<string, string[]> = {}) {
  return {
    all: vi.fn(async (sql: string, params?: any[]) => {
      if (String(sql).includes('FROM departments')) return departments;
      if (String(sql).includes('FROM management_scopes')) return (scopes[params?.[0]] ?? []).map((departmentId) => ({ departmentId }));
      if (/^SELECT \* FROM (reports|revenue_reports)/.test(sql)) return [];
      return [];
    }),
    get: vi.fn(),
    run: vi.fn().mockResolvedValue({ changes: 1 }),
  };
}

function rowsCall(db: any, table: string): [string, any[]] {
  const found = db.all.mock.calls.find(([sql]: string[]) => new RegExp(`^SELECT \\* FROM ${table}`).test(String(sql)));
  if (!found) throw new Error(`no ${table} query recorded`);
  return found;
}

describe('reports listing scope', () => {
  it('manager lists own plus department reports', async () => {
    const db = listDb();
    await request(appFor(manager, reportRoutes(db))).get('/').expect(200);
    const [sql, params] = rowsCall(db, 'reports');
    expect(sql).toContain('department IN (?)');
    expect(params).toEqual(expect.arrayContaining(['m', 'P KT']));
  });

  it('employee keeps the legacy author-only filter', async () => {
    const db = listDb();
    await request(appFor(employee, reportRoutes(db))).get('/archive').expect(200);
    const [sql] = rowsCall(db, 'reports');
    expect(sql).toContain('authorId = ?');
    expect(sql).not.toContain('department IN');
  });

  it('privileged viewers bypass every filter', async () => {
    const db = listDb();
    await request(appFor(viewer, reportRoutes(db))).get('/').expect(200);
    const [sql] = rowsCall(db, 'reports');
    expect(sql).not.toContain('authorId = ?');
  });
});

describe('reports PUT review with managed scope', () => {
  function putDb(row: any, scopes: Record<string, string[]> = {}) {
    return {
      get: vi.fn(async () => row),
      all: vi.fn(async (sql: string, params?: any[]) => {
        if (String(sql).includes('FROM departments')) return departments;
        if (String(sql).includes('FROM management_scopes')) return (scopes[params?.[0]] ?? []).map((departmentId) => ({ departmentId }));
        return [];
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  const pending = { id: 'r1', authorId: 'other', department: 'P KT', status: 'Pending', title: 'T' };
  const body = { title: 'T', status: 'Approved' };

  it('manager approves a pending report from their department', async () => {
    const db = putDb(pending);
    await request(appFor(manager, reportRoutes(db))).put('/r1').send(body).expect(200);
  });

  it('manager cannot approve another department report', async () => {
    const db = putDb({ ...pending, department: 'P KD' });
    await request(appFor(manager, reportRoutes(db))).put('/r1').send(body).expect(403);
  });

  it('deputy with a managed scope approves outside their own department', async () => {
    const db = putDb(pending, { p: ['d-kt'] });
    await request(appFor(deputyManaged, reportRoutes(db))).put('/r1').send(body).expect(200);
  });
});

describe('revenue listing scope', () => {
  it('manager lists own plus department revenue reports', async () => {
    const db = listDb();
    await request(appFor(manager, revenueRoutes(db))).get('/').expect(200);
    const [sql, params] = rowsCall(db, 'revenue_reports');
    expect(sql).toContain('department IN (?)');
    expect(params).toEqual(expect.arrayContaining(['m', 'P KT']));
  });

  it('employee keeps the legacy author-only filter', async () => {
    const db = listDb();
    await request(appFor(employee, revenueRoutes(db))).get('/').expect(200);
    const [sql] = rowsCall(db, 'revenue_reports');
    expect(sql).not.toContain('department IN');
  });
});

describe('revenue PUT review with managed scope', () => {
  function putDb(row: any, scopes: Record<string, string[]> = {}) {
    return {
      get: vi.fn(async () => row),
      all: vi.fn(async (sql: string, params?: any[]) => {
        if (String(sql).includes('FROM departments')) return departments;
        if (String(sql).includes('FROM management_scopes')) return (scopes[params?.[0]] ?? []).map((departmentId) => ({ departmentId }));
        if (String(sql).includes('FROM users WHERE role')) return [];
        return [];
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  const pending = { id: 'v1', authorId: 'other', department: 'P KT', status: 'Pending Manager', title: 'V' };
  const body = { title: 'V', status: 'Pending Director' };

  it('manager moves a department revenue report forward', async () => {
    const db = putDb(pending);
    await request(appFor(manager, revenueRoutes(db))).put('/v1').send(body).expect(200);
  });

  it('deputy with a managed scope moves it outside their own department', async () => {
    const db = putDb(pending, { p: ['d-kt'] });
    await request(appFor(deputyManaged, revenueRoutes(db))).put('/v1').send(body).expect(200);
  });

  it('manager cannot move another department revenue report', async () => {
    const db = putDb({ ...pending, department: 'P KD' });
    await request(appFor(manager, revenueRoutes(db))).put('/v1').send(body).expect(403);
  });
});
