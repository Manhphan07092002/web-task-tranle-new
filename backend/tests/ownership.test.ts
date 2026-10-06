import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { noteRoutes } from '../routes/notes.js';
import { activityRoutes } from '../routes/activity.js';
import { revenueRoutes } from '../routes/revenue.js';
import { contractRoutes } from '../routes/contracts.js';
import { documentRoutes } from '../routes/documents.js';
import { projectRoutes } from '../routes/projects.js';
import { taskRoutes } from '../routes/tasks.js';
import { reportRoutes } from '../routes/reports.js';
import { revenueRoutes as secureRevenueRoutes } from '../routes/revenue.js';
import { contractLinkRoutes } from '../routes/contractLinks.js';
import { meetingRoutes } from '../routes/meetings.js';
import { forgotPasswordRoutes } from '../routes/auth.js';
import { aiRoutes } from '../routes/ai.js';
import { canAccessContractUpload } from '../routes/upload.js';
import { adminRoutes } from '../routes/admin.js';
import { userRoutes } from '../routes/users.js';
import { roleRoutes } from '../routes/roles.js';
import { requireAdmin } from '../middleware/auth.js';

const user = { id: 'user-1', role: 'Employee', department: 'Sales', permissions: [] };

function appFor(router: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(router);
  return app;
}

describe('ownership boundaries', () => {
  it('notes ignore a userId query parameter supplied by the client', async () => {
    const db = { all: vi.fn().mockResolvedValue([]) };
    await request(appFor(noteRoutes(db))).get('/?userId=other-user').expect(200);
    expect(db.all).toHaveBeenCalledWith('SELECT * FROM notes WHERE userId = ?', ['user-1']);
  });

  it('activity logs cannot be queried for another user', async () => {
    const db = { all: vi.fn() };
    await request(appFor(activityRoutes(db))).get('/user/other-user').expect(403);
    expect(db.all).not.toHaveBeenCalled();
  });

  it('revenue report creation uses the authenticated identity', async () => {
    const db = {
      run: vi.fn().mockResolvedValue({ changes: 1 }),
      get: vi.fn().mockResolvedValue({ managerId: null }),
    };
    await request(appFor(revenueRoutes(db)))
      .post('/')
      .send({ id: 'rev-1', title: 'Report', reportType: 'monthly', periodStart: '2026-01-01', periodEnd: '2026-01-31', authorId: 'other-user', department: 'Other', status: 'Pending Manager' })
      .expect(201);

    const insert = db.run.mock.calls.find((call: any[]) => String(call[0]).includes('INSERT INTO revenue_reports'));
    expect(insert?.[1][9]).toBe('user-1');
    expect(insert?.[1][10]).toBe('Sales');
  });

  it('contract creation ignores client-supplied creator, department, and ID', async () => {
    const db = {
      run: vi.fn().mockResolvedValue({ changes: 1 }),
      get: vi.fn().mockResolvedValue(undefined),
      all: vi.fn().mockResolvedValue([]),
    };
    await request(appFor(contractRoutes(db)))
      .post('/')
      .send({
        id: 'chosen-by-client',
        createdBy: 'other-user',
        department: 'Other Department',
        status: 'draft',
        contractNumber: 'CT-SECURITY-1',
        clientName: 'Client',
        contractName: 'Contract',
      })
      .expect(201);

    const insert = db.run.mock.calls.find((call: any[]) => String(call[0]).includes('INSERT INTO contracts'));
    expect(insert?.[1][0]).not.toBe('chosen-by-client');
    expect(insert?.[1][10]).toBe('Sales');
    expect(insert?.[1][11]).toBe('user-1');
  });

  it('employees cannot assign a contract accountant during creation', async () => {
    const db = { run: vi.fn(), get: vi.fn(), all: vi.fn() };
    await request(appFor(contractRoutes(db)))
      .post('/')
      .send({
        status: 'draft',
        contractNumber: 'CT-SECURITY-2',
        clientName: 'Client',
        contractName: 'Contract',
        docAccountantUserId: 'other-user',
      })
      .expect(403);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('contract owners cannot change accountant handover or paid amount via the general update endpoint', async () => {
    const existing = {
      createdBy: 'user-1',
      status: 'draft',
      department: 'Sales',
      approvalFeedback: null,
      docAccountantUserId: null,
      docAccountantStatus: null,
      docSentDate: null,
      docReceivedDate: null,
      docAccountantDate: null,
      docReceiver: null,
      paidAmount: 0,
    };
    const db = { get: vi.fn().mockResolvedValue(existing), run: vi.fn(), all: vi.fn() };
    await request(appFor(contractRoutes(db)))
      .put('/contract-1')
      .send({
        contractNumber: 'CT-1',
        clientName: 'Client',
        contractName: 'Contract',
        status: 'draft',
        docAccountantUserId: 'other-user',
        paidAmount: 100000,
      })
      .expect(403);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('document listing scopes contract files to contracts visible to the user', async () => {
    const db = { all: vi.fn().mockResolvedValue([]) };
    await request(appFor(documentRoutes(db))).get('/?category=contracts').expect(200);
    const [query, params] = db.all.mock.calls[0];
    expect(query).toContain("category = 'contracts' AND linkedId IN");
    expect(query).toContain('docAccountantUserId = ?');
    expect(params).toContain('user-1');
    expect(params).toContain('Sales');
  });

  it('cannot attach an owned upload to a contract in another department', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({ createdBy: 'someone-else', department: 'Other', docAccountantUserId: null }),
      run: vi.fn(),
    };
    await request(appFor(documentRoutes(db)))
      .post('/')
      .send({
        name: 'private.pdf',
        url: `/api/upload/files/${'a'.repeat(24)}.pdf`,
        category: 'contracts',
        linkedId: 'foreign-contract',
      })
      .expect(403);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('project creation ignores client-supplied ID, department, and manager for regular users', async () => {
    const db = { run: vi.fn().mockResolvedValue({ changes: 1 }) };
    await request(appFor(projectRoutes(db)))
      .post('/')
      .send({
        id: 'chosen-by-client',
        projectCode: 'PRJ-1',
        name: 'Project',
        clientName: 'Client',
        department: 'Other Department',
        managerId: 'other-user',
      })
      .expect(201);

    const insert = db.run.mock.calls.find((call: any[]) => String(call[0]).includes('INSERT INTO projects'));
    expect(insert?.[1][0]).not.toBe('chosen-by-client');
    expect(insert?.[1][4]).toBe('Sales');
    expect(insert?.[1][5]).toBe('user-1');
  });

  it('department peers cannot edit project milestones they do not manage', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({ id: 'project-1', managerId: 'manager-2', department: 'Sales' }),
      run: vi.fn(),
    };
    await request(appFor(projectRoutes(db)))
      .put('/project-1/milestones/milestone-1')
      .send({ title: 'Changed', status: 'completed' })
      .expect(403);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('task creation uses the authenticated identity and self-assignment for regular users', async () => {
    const db = { run: vi.fn().mockResolvedValue({ changes: 1 }), all: vi.fn().mockResolvedValue([]) };
    await request(appFor(taskRoutes(db)))
      .post('/')
      .send({
        id: 'chosen-by-client',
        title: '  Task  ',
        createdBy: 'other-user',
        department: 'Other Department',
        assignees: ['other-user'],
      })
      .expect(201);

    const insert = db.run.mock.calls.find((call: any[]) => String(call[0]).includes('INSERT INTO tasks'));
    expect(insert?.[1][0]).not.toBe('chosen-by-client');
    expect(insert?.[1][1]).toBe('Task');
    expect(insert?.[1][7]).toBe('Todo');
    expect(insert?.[1][8]).toBe('user-1');
    expect(insert?.[1][9]).toBe('Sales');
    expect(db.run.mock.calls.some((call: any[]) => String(call[0]).includes('INSERT INTO task_assignees') && call[1][1] === 'user-1')).toBe(true);
  });

  it('assigned users cannot reassign a task or erase its comment history', async () => {
    const existing = {
      id: 'task-1',
      createdBy: 'creator-1',
      department: 'Sales',
      contractId: null,
      projectId: null,
      title: 'Task',
      status: 'Todo',
    };
    const db = {
      get: vi.fn(async (query: string) => query.includes('SELECT * FROM tasks') ? existing : { taskId: 'task-1' }),
      all: vi.fn(async (query: string) => query.includes('SELECT userId FROM task_assignees') ? [{ userId: 'user-1' }] : []),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    await request(appFor(taskRoutes(db)))
      .put('/task-1')
      .send({
        title: 'Task updated',
        status: 'In Progress',
        assignees: ['other-user'],
        tags: [],
        subtasks: [],
        comments: [],
      })
      .expect(200);

    expect(db.run.mock.calls.some((call: any[]) => String(call[0]).includes('INSERT INTO task_assignees') && call[1][1] === 'user-1')).toBe(true);
    expect(db.run.mock.calls.some((call: any[]) => String(call[0]).includes('INSERT INTO task_assignees') && call[1][1] === 'other-user')).toBe(false);
    expect(db.run.mock.calls.some((call: any[]) => String(call[0]).includes('DELETE FROM task_comments'))).toBe(false);
  });

  it('regular authors cannot create standard reports directly into director-only states', async () => {
    const db = { run: vi.fn().mockResolvedValue({ changes: 1 }), all: vi.fn().mockResolvedValue([]), get: vi.fn() };
    await request(appFor(reportRoutes(db)))
      .post('/')
      .send({ id: 'report-1', title: 'Report', content: '{}', status: 'Pending Director' })
      .expect(201);
    const insert = db.run.mock.calls.find((call: any[]) => String(call[0]).includes('INSERT INTO reports'));
    expect(insert?.[1][3]).toBe('user-1');
    expect(insert?.[1][4]).toBe('Sales');
    expect(insert?.[1][5]).toBe('Draft');
  });

  it('report authors cannot approve their own pending report', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({ id: 'report-1', authorId: 'user-1', department: 'Sales', status: 'Pending' }),
      run: vi.fn(),
    };
    await request(appFor(reportRoutes(db)))
      .put('/report-1')
      .send({ title: 'Report', content: '{}', status: 'Approved' })
      .expect(403);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('regular revenue report authors cannot skip the manager review stage', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({ id: 'revenue-1', authorId: 'user-1', department: 'Sales', status: 'Pending Manager' }),
      run: vi.fn(),
    };
    await request(appFor(secureRevenueRoutes(db)))
      .put('/revenue-1')
      .send({ title: 'Revenue', content: '[]', status: 'Approved' })
      .expect(403);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('contract link listing only includes links whose two contracts are visible', async () => {
    const links = [
      { id: 'visible', outputContractId: 'c1', inputContractId: 'c2' },
      { id: 'cross-scope', outputContractId: 'c1', inputContractId: 'private' },
    ];
    const db = { all: vi.fn().mockResolvedValueOnce(links).mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }]) };
    const response = await request(appFor(contractLinkRoutes(db))).get('/').expect(200);
    expect(response.body).toEqual([links[0]]);
    expect(db.all.mock.calls[1][1]).toEqual(['user-1', 'Sales', 'user-1']);
  });

  it('a user cannot create a contract link when either contract is outside their scope', async () => {
    const db = {
      get: vi.fn().mockResolvedValueOnce({ id: 'c1', createdBy: 'user-1', department: 'Sales' })
        .mockResolvedValueOnce({ id: 'private', createdBy: 'other', department: 'Finance' }),
      run: vi.fn(),
    };
    await request(appFor(contractLinkRoutes(db)))
      .post('/')
      .send({ outputContractId: 'c1', inputContractId: 'private' })
      .expect(404);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('sensitive create routes reject malformed bodies before touching the database', async () => {
    const linkDb = { get: vi.fn(), run: vi.fn() };
    await request(appFor(contractLinkRoutes(linkDb)))
      .post('/').send({ outputContractId: 'same', inputContractId: 'same' }).expect(400);
    expect(linkDb.get).not.toHaveBeenCalled();

    const meetingDb = { get: vi.fn(), all: vi.fn(), run: vi.fn() };
    await request(appFor(meetingRoutes(meetingDb)))
      .post('/').send({ title: '', startTime: 'not-a-date', endTime: 'not-a-date', status: 'admin', participants: [] }).expect(400);
    expect(meetingDb.run).not.toHaveBeenCalled();

    const noteDb = { run: vi.fn() };
    await request(appFor(noteRoutes(noteDb)))
      .post('/').send({ title: 'x'.repeat(301), content: '', color: '#fff' }).expect(400);
    expect(noteDb.run).not.toHaveBeenCalled();
  });

  it('task and project child routes reject out-of-range validation data before writes', async () => {
    const taskDb = { run: vi.fn(), all: vi.fn().mockResolvedValue([]) };
    await request(appFor(taskRoutes(taskDb)))
      .post('/').send({ title: 'Task', tags: ['x'.repeat(101)] }).expect(400);
    expect(taskDb.run).not.toHaveBeenCalled();

    const projectDb = { run: vi.fn(), get: vi.fn().mockResolvedValue({ id: 'project-1', managerId: 'user-1', department: 'Sales' }) };
    await request(appFor(projectRoutes(projectDb)))
      .post('/project-1/reports').send({ title: 'Progress', progress: 101 }).expect(400);
    await request(appFor(projectRoutes(projectDb)))
      .post('/project-1/milestones').send({ title: 'Milestone', status: 'admin' }).expect(400);
    expect(projectDb.run).not.toHaveBeenCalled();
  });

  it('admin user and role routes reject malformed input before database writes', async () => {
    const db = { run: vi.fn(), get: vi.fn(), all: vi.fn() };
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: 'admin-1', role: 'Admin', permissions: ['admin_panel'] }; next(); });
    app.use('/users', userRoutes(db, {}));
    app.use('/roles', roleRoutes(db));

    await request(app).post('/users').send({ name: '', email: 'not-an-email', role: 'Employee' }).expect(400);
    await request(app).post('/roles').send({ name: 'Role', permissions: ['x'.repeat(101)] }).expect(400);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('blocks employee access to all user and role write endpoints at the route boundary', async () => {
    const db = { run: vi.fn(), get: vi.fn(), all: vi.fn() };
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { id: 'employee-1', role: 'Employee', permissions: [] };
      next();
    });
    app.use('/users', userRoutes(db, {}));
    app.use('/roles', roleRoutes(db));

    await request(app).post('/users').send({}).expect(403);
    await request(app).put('/users/target-1').send({}).expect(403);
    await request(app).delete('/users/target-1').expect(403);
    await request(app).post('/users/target-1/reset-password').expect(403);
    await request(app).put('/users/target-1/lock').expect(403);
    await request(app).put('/users/target-1/unlock').expect(403);
    await request(app).post('/roles').send({}).expect(403);
    await request(app).put('/roles/role-1').send({}).expect(403);
    await request(app).delete('/roles/role-1').expect(403);

    expect(db.run).not.toHaveBeenCalled();
    expect(db.get).not.toHaveBeenCalled();
    expect(db.all).not.toHaveBeenCalled();
  });

  it('renaming a role migrates its users and revokes their prior tokens', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({ id: 'role-1', name: 'Old role', isSystem: 0, description: '', color: '#000000', permissions: '[]' }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: 'admin-1', role: 'Admin', permissions: ['admin_panel'] }; next(); });
    app.use(roleRoutes(db));

    await request(app).put('/role-1').send({ name: 'New role' }).expect(200);
    expect(db.run.mock.calls.some((call: any[]) => String(call[0]).includes('UPDATE users SET role = ?, tokenVersion = tokenVersion + 1') && call[1][0] === 'New role' && call[1][1] === 'Old role')).toBe(true);
  });

  it('a user manager cannot assign a role with permissions they do not hold', async () => {
    const db = { get: vi.fn().mockResolvedValue({ permissions: '["admin_panel"]' }), run: vi.fn() };
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: 'manager-1', role: 'Manager', permissions: ['manage_users'] }; next(); });
    app.use(userRoutes(db, {}));

    await request(app).post('/').send({ name: 'New user', email: 'new@example.com', role: 'Administrator' }).expect(403);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('admin password reset sends a link but never returns or stores the raw token', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({ id: 'target-1', email: 'target@example.com', name: 'Target' }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    const sendResetLinkEmail = vi.fn().mockResolvedValue(true);
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: 'manager-1', role: 'Manager', permissions: ['manage_users'] }; next(); });
    app.use(userRoutes(db, { sendResetLinkEmail }));

    const response = await request(app).post('/target-1/reset-password').send({}).expect(200);
    expect(response.body.resetLink).toBeUndefined();
    expect(response.body.generatedPassword).toBeUndefined();
    const insert = db.run.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO password_reset_tokens'));
    const storedToken = insert?.[1][3];
    const storedHash = insert?.[1][4];
    const emailLink = new URL(sendResetLinkEmail.mock.calls[0][1]).searchParams.get('token');
    expect(storedToken).toBe(storedHash);
    expect(storedHash).not.toBe(emailLink);
  });

  it('changing a user email invalidates outstanding reset links', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({ id: 'target-1', email: 'old@example.com' }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: 'admin-1', role: 'Admin', permissions: ['admin_panel'] }; next(); });
    app.use(userRoutes(db, {}));

    await request(app).put('/target-1').send({ name: 'Target', email: 'new@example.com', role: 'Employee' }).expect(200);
    expect(db.run.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM password_reset_tokens WHERE userId = ? AND usedAt IS NULL'))).toBe(true);
  });

  it('meeting signal polling only returns broadcasts and signals addressed to the caller', async () => {
    const db = { get: vi.fn(async (query: string) => query.includes('hostId') ? { hostId: 'host-1' } : { userId: 'user-1' }), all: vi.fn().mockResolvedValue([]) };
    await request(appFor(meetingRoutes(db))).get('/meeting-1/signals?since=0').expect(200);
    expect(db.all.mock.calls[0][0]).toContain('(`to` = ? OR `to` = \'all\')');
    expect(db.all.mock.calls[0][1]).toEqual(['meeting-1', 0, 'user-1']);
  });

  it('meeting participants cannot send force-mute moderation signals', async () => {
    const db = {
      get: vi.fn(async (query: string) => query.includes('hostId') ? { hostId: 'host-1' } : { userId: 'user-1' }),
      run: vi.fn(),
    };
    await request(appFor(meetingRoutes(db)))
      .post('/meeting-1/signals')
      .send({ to: 'user-2', type: 'force_mute', data: 'kick' })
      .expect(403);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('an authenticated user cannot join a meeting without an invitation', async () => {
    const db = {
      get: vi.fn(async (query: string) => query.includes('hostId') ? { id: 'meeting-1', hostId: 'host-1' } : undefined),
      run: vi.fn(),
    };
    await request(appFor(meetingRoutes(db))).put('/meeting-1/join').expect(403);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('forgot-password does not disclose whether an email is registered and rate-limits by email', async () => {
    const db = { get: vi.fn().mockResolvedValue(undefined), run: vi.fn() };
    const router = forgotPasswordRoutes(db, { sendResetLinkEmail: vi.fn() });
    const app = appFor(router);
    const response = await request(app).post('/forgot-password').send({ email: 'unknown@example.com' }).expect(200);
    expect(response.body).toEqual({ success: true, message: 'If an account matches that email, password reset instructions will be sent.' });
    await request(app).post('/forgot-password').send({ email: 'unknown@example.com' }).expect(200);
    await request(app).post('/forgot-password').send({ email: 'unknown@example.com' }).expect(200);
    await request(app).post('/forgot-password').send({ email: 'unknown@example.com' }).expect(429);
  });

  it('forgot-password stores only a reset-token hash and never returns the reset link', async () => {
    const db = {
      get: vi.fn().mockResolvedValueOnce({ id: 'user-1', email: 'user@example.com', isLocked: 0 }).mockResolvedValueOnce(undefined),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    const sendResetLinkEmail = vi.fn().mockResolvedValue(true);
    const response = await request(appFor(forgotPasswordRoutes(db, { sendResetLinkEmail })))
      .post('/forgot-password')
      .send({ email: 'user@example.com' })
      .expect(200);

    expect(response.body.resetLink).toBeUndefined();
    expect(response.body.emailSent).toBeUndefined();
    const insert = db.run.mock.calls.find((call: any[]) => String(call[0]).includes('INSERT INTO password_reset_tokens'));
    const storedToken = insert?.[1][3];
    const storedHash = insert?.[1][4];
    const sentLink = sendResetLinkEmail.mock.calls[0][1] as string;
    const rawToken = new URL(sentLink).searchParams.get('token');
    expect(rawToken).toBeTruthy();
    expect(storedToken).toBe(storedHash);
    expect(storedHash).not.toBe(rawToken);
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('AI endpoints enforce a per-IP request limit', async () => {
    const app = appFor(aiRoutes({ get: vi.fn().mockResolvedValue(undefined) }));
    for (let i = 0; i < 30; i++) await request(app).get('/status').expect(200);
    await request(app).get('/status').expect(429);
  });

  it('private contract uploads follow contract owner, department, accountant, and global permission visibility', () => {
    const contract = { createdBy: 'owner-1', department: 'Sales', docAccountantUserId: 'accountant-1' };
    expect(canAccessContractUpload(contract, { id: 'owner-1', department: 'Other', permissions: [] })).toBe(true);
    expect(canAccessContractUpload(contract, { id: 'user-2', department: 'Sales', permissions: [] })).toBe(true);
    expect(canAccessContractUpload(contract, { id: 'accountant-1', department: 'Other', permissions: [] })).toBe(true);
    expect(canAccessContractUpload(contract, { id: 'user-3', department: 'Other', permissions: [] })).toBe(false);
    expect(canAccessContractUpload(contract, { id: 'user-3', department: 'Other', permissions: ['view_all_tasks'] })).toBe(true);
  });

  it('admin database row deletion requires a scoped one-time confirmation and audits the change', async () => {
    const db = {
      run: vi.fn().mockResolvedValue({ changes: 1 }),
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ count: 0 }),
    };
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: 'admin-1', role: 'Admin', permissions: ['admin_panel'] }; next(); });
    app.use(requireAdmin, adminRoutes(db, {}));

    await request(app).delete('/database/table/tasks/row/task-1').send({}).expect(403);
    expect(db.run).not.toHaveBeenCalled();

    const confirmation = await request(app).post('/database/confirm')
      .send({ action: 'delete-row', table: 'tasks', id: 'task-1' }).expect(200);
    const token = confirmation.body.token;
    await request(app).delete('/database/table/tasks/row/task-1').send({ confirmToken: token }).expect(200);
    await request(app).delete('/database/table/tasks/row/task-1').send({ confirmToken: token }).expect(403);
    expect(db.run.mock.calls.some((call: any[]) => String(call[0]).includes('DELETE FROM `tasks`'))).toBe(true);
    expect(db.run.mock.calls.some((call: any[]) => String(call[0]).includes('INSERT INTO activity_logs'))).toBe(true);
  });
});
