import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { contractRoutes } from '../routes/contracts.js';

const departments = [{ id: 'd-kt', name: 'P KT', parentId: null }];

const manager = { id: 'm', name: 'TP', role: 'Manager', department: 'P KT', primaryDepartmentId: 'd-kt', managementLevel: 20, permissions: ['manage_dept_tasks'] };
const deputy = { id: 'p', name: 'PGĐ', role: 'Deputy Director', department: 'P KT', primaryDepartmentId: 'd-kt', managementLevel: 30, permissions: [] };
const employee = { id: 'e', name: 'NV', role: 'Employee', department: 'P KT', primaryDepartmentId: 'd-kt', managementLevel: 10, permissions: ['view_own_tasks'] };
const admin = { id: 'a', name: 'Admin', role: 'Admin', department: 'B', managementLevel: 99, permissions: ['admin_panel'] };

function appFor(user: any, db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(contractRoutes(db));
  return app;
}

function listDb() {
  return {
    all: vi.fn(async (sql: string) => {
      if (String(sql).includes('FROM departments')) return departments;
      if (String(sql).includes('FROM management_scopes')) return [];
      if (String(sql).startsWith('SELECT * FROM contracts')) return [];
      return [];
    }),
    get: vi.fn(),
    run: vi.fn().mockResolvedValue({ changes: 1 }),
  };
}

function contractsCall(db: any): [string, any[]] {
  return db.all.mock.calls.find(([sql]: string[]) => String(sql).startsWith('SELECT * FROM contracts'));
}

describe('contracts listing scope', () => {
  it('manager lists the whole department plus own and accountant rows', async () => {
    const db = listDb();
    await request(appFor(manager, db)).get('/').expect(200);
    const [sql, params] = contractsCall(db);
    expect(sql).toContain('department IN (?)');
    expect(params).toEqual(['m', 'P KT', 'm']);
  });

  it('employee keeps the legacy single-department filter', async () => {
    const db = listDb();
    await request(appFor(employee, db)).get('/').expect(200);
    const [sql] = contractsCall(db);
    expect(sql).not.toContain('department IN');
    expect(sql).toContain('department = ?');
  });

  it('privileged viewers bypass every filter', async () => {
    const db = listDb();
    await request(appFor(admin, db)).get('/archive').expect(200);
    const [sql] = contractsCall(db);
    expect(sql).not.toContain('createdBy = ?');
  });
});

describe('contracts approve authority', () => {
  function approveDb(contract: any) {
    return {
      get: vi.fn(async () => contract),
      all: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM departments')) return departments;
        if (String(sql).includes('FROM management_scopes')) return [];
        return [];
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  const small = { id: 'c1', createdBy: 'e', contractName: 'C1', contractNumber: 'N1', department: 'P KT', preTaxValue: 400_000_000 };
  const big = { ...small, id: 'c2', preTaxValue: 600_000_000 };
  const huge = { ...small, id: 'c3', preTaxValue: 1_500_000_000 };
  const enormous = { ...small, id: 'c4', preTaxValue: 2_500_000_000 };

  it('manager approves under 500M but not at/over it', async () => {
    await request(appFor(manager, approveDb(small))).put('/c1/approve').send({}).expect(200);
    const res = await request(appFor(manager, approveDb(big))).put('/c2/approve').send({}).expect(403);
    expect(res.body.error).toContain('vượt thẩm quyền');
  });

  it('deputy approves under 2B across the same department', async () => {
    await request(appFor(deputy, approveDb(huge))).put('/c3/approve').send({}).expect(200);
    await request(appFor(deputy, approveDb(enormous))).put('/c4/approve').send({}).expect(403);
  });

  it('employee cannot approve even small contracts', async () => {
    await request(appFor(employee, approveDb(small))).put('/c1/approve').send({}).expect(403);
  });

  it('admin bypass is preserved regardless of amount', async () => {
    await request(appFor(admin, approveDb(enormous))).put('/c4/approve').send({}).expect(200);
  });

  it('level-40 without a director role is still unlimited', async () => {
    const lvl40 = { ...manager, id: 'x', role: 'Custom', permissions: [] as string[], managementLevel: 40 };
    await request(appFor(lvl40, approveDb(enormous))).put('/c4/approve').send({}).expect(200);
  });

  it('missing contract is 404', async () => {
    await request(appFor(manager, approveDb(undefined))).put('/ghost/approve').send({}).expect(404);
  });

  it('reject shares the same authority gate', async () => {
    await request(appFor(manager, approveDb(small))).put('/c1/reject').send({ feedback: 'Sai số' }).expect(200);
    await request(appFor(manager, approveDb(big))).put('/c2/reject').send({ feedback: 'Sai số' }).expect(403);
    await request(appFor(manager, approveDb(small))).put('/c1/reject').send({}).expect(400);
  });
});
