import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { taskRoutes } from '../routes/tasks.js';

const departments = [
  { id: 'd-kt', name: 'Phòng Kế Toán', parentId: null },
  { id: 'd-kd', name: 'Phòng Kinh Doanh', parentId: null },
];

const manager = { id: 'mgr-1', role: 'Manager', department: 'Phòng Kế Toán', primaryDepartmentId: 'd-kt', managementLevel: 20, permissions: ['manage_dept_tasks'] };
const employee = { id: 'emp-1', role: 'Employee', department: 'Phòng Kế Toán', primaryDepartmentId: 'd-kt', managementLevel: 10, permissions: ['view_own_tasks'] };
const viewer = { id: 'dir-1', role: 'Director', department: 'Ban', managementLevel: 40, permissions: ['view_all_tasks'] };

function appFor(user: any, db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(taskRoutes(db));
  return app;
}

function listDb() {
  return {
    all: vi.fn(async (sql: string) => {
      if (String(sql).includes('FROM departments')) return departments;
      if (String(sql).includes('FROM management_scopes')) return [];
      if (String(sql).startsWith('SELECT * FROM tasks')) return [];
      return [];
    }),
    get: vi.fn(),
    run: vi.fn().mockResolvedValue({ changes: 1 }),
  };
}

function tasksCall(db: any): [string, any[]] {
  return db.all.mock.calls.find(([sql]: string[]) => String(sql).startsWith('SELECT * FROM tasks'));
}

describe('tasks department scope (Phase 1 integration)', () => {
  it('manager lists department tasks plus own and assigned', async () => {
    const db = listDb();
    await request(appFor(manager, db)).get('/').expect(200);
    const [sql, params] = tasksCall(db);
    expect(sql).toContain('department IN (?)');
    expect(params).toEqual(expect.arrayContaining(['Phòng Kế Toán', 'mgr-1']));
  });

  it('employee keeps the legacy own-plus-assigned filter', async () => {
    const db = listDb();
    await request(appFor(employee, db)).get('/').expect(200);
    const [sql, params] = tasksCall(db);
    expect(sql).not.toContain('department IN');
    expect(params.slice(-2)).toEqual(['emp-1', 'emp-1']);
  });

  it('view_all_tasks still bypasses every filter', async () => {
    const db = listDb();
    await request(appFor(viewer, db)).get('/').expect(200);
    const [sql] = tasksCall(db);
    expect(sql).not.toContain('createdBy = ?');
  });

  it('archive respects the same scope', async () => {
    const db = listDb();
    await request(appFor(manager, db)).get('/archive').expect(200);
    expect(tasksCall(db)[0]).toContain('department IN (?)');
  });
});

describe('tasks PUT ownership with department scope', () => {
  function putDb(task: any, assigned: any) {
    return {
      get: vi.fn(async (sql: string) => {
        if (String(sql).includes('SELECT * FROM tasks')) return task;
        if (String(sql).includes('FROM task_assignees WHERE taskId = ? AND userId = ?')) return assigned;
        return undefined;
      }),
      all: vi.fn(async (sql: string) => {
        if (String(sql).includes('FROM departments')) return departments;
        if (String(sql).includes('FROM management_scopes')) return [];
        return [];
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
  }

  const body = { title: 'Updated', status: 'In Progress', tags: [], subtasks: [], comments: [], assignees: [] };

  it('manager can edit a department task they neither created nor own', async () => {
    const db = putDb({ id: 't1', createdBy: 'other', department: 'Phòng Kế Toán' }, undefined);
    await request(appFor(manager, db)).put('/t1').send(body).expect(200);
    expect(db.run.mock.calls.some(([sql]: string[]) => String(sql).startsWith('UPDATE tasks SET'))).toBe(true);
  });

  it('manager cannot edit a task from another department', async () => {
    const db = putDb({ id: 't2', createdBy: 'other', department: 'Phòng Kinh Doanh' }, undefined);
    await request(appFor(manager, db)).put('/t2').send(body).expect(403);
  });

  it('employee still cannot edit unrelated tasks', async () => {
    const db = putDb({ id: 't3', createdBy: 'other', department: 'Phòng Kế Toán' }, undefined);
    await request(appFor(employee, db)).put('/t3').send(body).expect(403);
  });
});
