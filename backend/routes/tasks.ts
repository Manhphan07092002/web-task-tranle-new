import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { sendNotification } from '../utils/notify.js';

const taskBodyFields = {
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).nullable().optional(),
  startDate: z.string().max(64).nullable().optional(),
  dueDate: z.string().max(64).nullable().optional(),
  estimatedEndAt: z.string().max(64).nullable().optional(),
  priority: z.enum(['Low', 'Medium', 'High']).nullable().optional(),
  status: z.enum(['Todo', 'In Progress', 'Done']).optional(),
  assignees: z.array(z.string().trim().min(1).max(191)).max(50).refine((ids) => new Set(ids).size === ids.length).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  subtasks: z.array(z.object({ id: z.string().max(191).optional(), title: z.string().trim().min(1).max(500), isCompleted: z.boolean().optional() })).max(100).optional(),
  comments: z.array(z.object({ id: z.string().max(191).optional(), userId: z.string().max(191).optional(), content: z.string().trim().min(1).max(5000), createdAt: z.string().max(64).optional() })).max(500).optional(),
  recurrence: z.enum(['None', 'Daily', 'Weekly', 'Monthly']).nullable().optional(),
  contractId: z.string().max(191).nullable().optional(),
  projectId: z.string().max(191).nullable().optional(),
  department: z.string().max(191).optional(),
  createdBy: z.string().max(191).optional(),
  id: z.string().max(191).optional(),
};
const CreateTaskSchema = z.object(taskBodyFields);
const UpdateTaskSchema = z.object(taskBodyFields).extend({ status: z.enum(['Todo', 'In Progress', 'Done']) });

export function taskRoutes(db: any) {
  const router = Router();

  const canManageTasks = (user: any) => user?.role === 'Admin'
    || user?.permissions?.includes('admin_panel')
    || user?.permissions?.includes('view_all_tasks');
  const canAssignTasks = (user: any) => canManageTasks(user) || user?.permissions?.includes('manage_dept_tasks');

  function groupByKey(rows: any[], key: string): Record<string, any[]> {
    return rows.reduce((acc: Record<string, any[]>, r: any) => {
      (acc[r[key]] ??= []).push(r);
      return acc;
    }, {});
  }

  async function buildTasks(user: any, thresholdDate?: string) {
    let tasksQuery = 'SELECT * FROM tasks WHERE 1=1';
    const params: any[] = [];
    if (thresholdDate) {
      tasksQuery += ' AND (startDate >= ? OR dueDate >= ? OR startDate IS NULL OR dueDate IS NULL)';
      params.push(thresholdDate, thresholdDate);
    }
    if (!canManageTasks(user)) {
      tasksQuery += ' AND (createdBy = ? OR id IN (SELECT taskId FROM task_assignees WHERE userId = ?))';
      params.push(user.id, user.id);
    }
    
    const [tasks, assignees, tags, subtasks, comments] = await Promise.all([
      db.all(tasksQuery, params),
      db.all('SELECT taskId, userId FROM task_assignees'),
      db.all('SELECT taskId, tag FROM task_tags'),
      db.all('SELECT id, taskId, title, isCompleted FROM task_subtasks ORDER BY sortOrder'),
      db.all('SELECT id, taskId, userId, content, createdAt FROM task_comments ORDER BY createdAt'),
    ]);

    const aMap = groupByKey(assignees, 'taskId');
    const tMap = groupByKey(tags, 'taskId');
    const sMap = groupByKey(subtasks, 'taskId');
    const cMap = groupByKey(comments, 'taskId');

    return tasks.map((t: any) => ({
      ...t,
      assignees: (aMap[t.id] ?? []).map((r: any) => r.userId),
      tags: (tMap[t.id] ?? []).map((r: any) => r.tag),
      subtasks: (sMap[t.id] ?? []).map((r: any) => ({
        id: r.id, title: r.title, isCompleted: Boolean(r.isCompleted),
      })),
      comments: (cMap[t.id] ?? []).map((r: any) => ({
        id: r.id, userId: r.userId, content: r.content, createdAt: r.createdAt,
      })),
    }));
  }

  async function saveRelated(taskId: string, t: any, actorId: string) {
    await db.run('DELETE FROM task_assignees WHERE taskId = ?', [taskId]);
    await db.run('DELETE FROM task_tags WHERE taskId = ?', [taskId]);
    await db.run('DELETE FROM task_subtasks WHERE taskId = ?', [taskId]);
    for (const userId of (t.assignees ?? [])) {
      await db.run('INSERT INTO task_assignees (taskId, userId) VALUES (?, ?)', [taskId, userId]);
    }
    for (const tag of (t.tags ?? [])) {
      await db.run('INSERT INTO task_tags (taskId, tag) VALUES (?, ?)', [taskId, tag]);
    }
    const subtasks: any[] = t.subtasks ?? [];
    for (let i = 0; i < subtasks.length; i++) {
      const s = subtasks[i];
      await db.run(
        'INSERT INTO task_subtasks (id, taskId, title, isCompleted, sortOrder) VALUES (?, ?, ?, ?, ?)',
        [s.id ?? randomUUID(), taskId, s.title, s.isCompleted ? 1 : 0, i],
      );
    }
    const existingComments = await db.all('SELECT id FROM task_comments WHERE taskId = ?', [taskId]);
    const knownCommentIds = new Set(existingComments.map((comment: any) => comment.id));
    for (const c of (t.comments ?? [])) {
      if (!c || typeof c.content !== 'string' || !c.content.trim() || c.content.length > 5000) continue;
      const commentId = typeof c.id === 'string' && c.id.length <= 191 ? c.id : randomUUID();
      if (knownCommentIds.has(commentId)) continue;
      knownCommentIds.add(commentId);
      await db.run(
        'INSERT INTO task_comments (id, taskId, userId, content, createdAt) VALUES (?, ?, ?, ?, ?)',
        [commentId, taskId, actorId, c.content.trim(), new Date().toISOString()],
      );
    }
  }

  async function validateAssignees(ids: unknown, user: any): Promise<string[] | null> {
    if (!Array.isArray(ids) || ids.length > 50 || ids.some((id) => typeof id !== 'string' || !id.trim())) return null;
    const uniqueIds = Array.from(new Set(ids as string[]));
    if (uniqueIds.length !== ids.length) return null;
    if (!canAssignTasks(user)) return uniqueIds.length === 1 && uniqueIds[0] === user.id ? uniqueIds : null;
    if (uniqueIds.length === 0) return [];

    const placeholders = uniqueIds.map(() => '?').join(',');
    const users = await db.all(`SELECT id, department, isLocked FROM users WHERE id IN (${placeholders})`, uniqueIds);
    if (users.length !== uniqueIds.length || users.some((assignee: any) => assignee.isLocked)) return null;
    if (!canManageTasks(user) && users.some((assignee: any) => assignee.department !== user.department)) return null;
    return uniqueIds;
  }

  async function validateTaskLinks(task: any, user: any): Promise<boolean> {
    if (task.contractId) {
      const contract = await db.get('SELECT createdBy, department, docAccountantUserId FROM contracts WHERE id = ? AND (isDeleted IS NULL OR isDeleted = 0)', [task.contractId]);
      if (!contract || (!canManageTasks(user) && contract.createdBy !== user.id && contract.docAccountantUserId !== user.id && contract.department !== user.department)) return false;
    }
    if (task.projectId) {
      const project = await db.get('SELECT managerId, department FROM projects WHERE id = ? AND (isDeleted IS NULL OR isDeleted = 0)', [task.projectId]);
      if (!project || (!canManageTasks(user) && project.managerId !== user.id && project.department !== user.department)) return false;
    }
    return true;
  }

  router.get('/', async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      res.json(await buildTasks(req.user, sixMonthsAgo.toISOString()));
    } catch (e) { res.status(500).json({ error: 'Failed to fetch tasks' }); }
  });

  router.get('/archive', async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      res.json(await buildTasks(req.user));
    } catch (e) { res.status(500).json({ error: 'Failed to fetch tasks archive' }); }
  });

  router.post('/', validate(CreateTaskSchema), async (req, res) => {
    const t = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > 500) return res.status(400).json({ error: 'Task title is required' });
      if (t.status !== undefined && !['Todo', 'In Progress', 'Done'].includes(t.status)) return res.status(400).json({ error: 'Invalid task status' });
      t.status = t.status || 'Todo';
      t.tags = Array.isArray(t.tags) ? t.tags : [];
      t.subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
      t.comments = Array.isArray(t.comments) ? t.comments : [];
      const assignees = canAssignTasks(req.user) ? await validateAssignees(t.assignees ?? [], req.user) : [req.user.id];
      if (!assignees) return res.status(400).json({ error: 'Task assignees are invalid or outside your department' });
      if (!canManageTasks(req.user)) t.department = req.user.department;
      t.id = randomUUID();
      t.createdBy = req.user.id;
      t.assignees = assignees;
      if (!Array.isArray(t.tags) || t.tags.length > 50 || !Array.isArray(t.subtasks) || t.subtasks.length > 100 || !Array.isArray(t.comments) || t.comments.length > 500) {
        return res.status(400).json({ error: 'Invalid task related data' });
      }
      if (!(await validateTaskLinks(t, req.user))) return res.status(403).json({ error: 'Task link is not accessible' });
      await db.run(
        'INSERT INTO tasks (id, title, description, startDate, dueDate, estimatedEndAt, priority, status, createdBy, department, recurrence, contractId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [t.id, t.title, t.description ?? null, t.startDate ?? null, t.dueDate ?? null,
          t.estimatedEndAt ?? null, t.priority ?? null, t.status ?? null,
          t.createdBy ?? null, t.department ?? null, t.recurrence ?? null, t.contractId ?? null],
      );
      await saveRelated(t.id, t, req.user.id);

      if (t.createdBy) {
        await db.run(
          'INSERT INTO activity_logs (id, userId, action, entityId, entityType, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
          [randomUUID(), t.createdBy, 'task.created', t.id, 'task', new Date().toISOString()],
        );
      }
      if (Array.isArray(t.assignees)) {
        for (const assigneeId of t.assignees) {
          if (assigneeId !== t.createdBy) {
            await sendNotification(db, assigneeId, 'task_assigned', 'Công việc mới', `Bạn vừa được giao một công việc mới: ${t.title}`, t.id);
          }
        }
      }
      res.status(201).json({ id: t.id });
    } catch (e) { res.status(500).json({ error: 'Failed task create' }); }
  });

  router.put('/:id', validate(UpdateTaskSchema), async (req, res) => {
    const t = req.body;
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const taskId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!taskId) return res.status(400).json({ error: 'Invalid task id' });
      const existing = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
      if (!existing) return res.status(404).json({ error: 'Task not found' });
      const assigned = await db.get('SELECT taskId FROM task_assignees WHERE taskId = ? AND userId = ?', [taskId, req.user.id]);
      if (!canManageTasks(req.user) && existing.createdBy !== req.user.id && !assigned) return res.status(403).json({ error: 'Forbidden' });

      if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > 500) return res.status(400).json({ error: 'Task title is required' });
      if (!['Todo', 'In Progress', 'Done'].includes(t.status)) return res.status(400).json({ error: 'Invalid task status' });
      if (!canManageTasks(req.user)) {
        t.department = existing.department;
        t.contractId = existing.contractId;
        t.projectId = existing.projectId;
      }
      if (!Array.isArray(t.tags)) {
        const previousTags = await db.all('SELECT tag FROM task_tags WHERE taskId = ?', [taskId]);
        t.tags = previousTags.map((row: any) => row.tag);
      }
      if (!Array.isArray(t.subtasks)) {
        t.subtasks = await db.all('SELECT id, title, isCompleted FROM task_subtasks WHERE taskId = ? ORDER BY sortOrder', [taskId]);
      }
      if (!Array.isArray(t.comments)) {
        t.comments = await db.all('SELECT id, userId, content, createdAt FROM task_comments WHERE taskId = ? ORDER BY createdAt', [taskId]);
      }
      if (!canAssignTasks(req.user) || !Array.isArray(t.assignees)) {
        const previousAssignees = await db.all('SELECT userId FROM task_assignees WHERE taskId = ?', [taskId]);
        t.assignees = previousAssignees.map((row: any) => row.userId);
      } else {
        const assignees = await validateAssignees(t.assignees ?? [], req.user);
        if (!assignees) return res.status(400).json({ error: 'Task assignees are invalid or outside your department' });
        t.assignees = assignees;
      }
      if (!Array.isArray(t.tags) || t.tags.length > 50 || !Array.isArray(t.subtasks) || t.subtasks.length > 100 || !Array.isArray(t.comments) || t.comments.length > 500) {
        return res.status(400).json({ error: 'Invalid task related data' });
      }
      if (!(await validateTaskLinks(t, req.user))) return res.status(403).json({ error: 'Task link is not accessible' });
      await db.run(
        'UPDATE tasks SET title=?, description=?, startDate=?, dueDate=?, estimatedEndAt=?, priority=?, status=?, department=?, recurrence=?, contractId=? WHERE id=?',
        [t.title, t.description ?? null, t.startDate ?? null, t.dueDate ?? null,
          t.estimatedEndAt ?? null, t.priority ?? null, t.status ?? null,
          t.department ?? null, t.recurrence ?? null, t.contractId ?? null, taskId],
      );
      await saveRelated(taskId, t, req.user.id);

      await db.run(
        'INSERT INTO activity_logs (id, userId, action, entityId, entityType, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [randomUUID(), req.user.id, 'task.updated', taskId, 'task', new Date().toISOString()],
      );
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed task update' }); }
  });

  router.delete('/:id', async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const existing = await db.get('SELECT createdBy, department FROM tasks WHERE id = ?', [req.params.id]);
      if (!existing) return res.status(404).json({ error: 'Task not found' });
      if (!canManageTasks(req.user) && existing.createdBy !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
      await db.run('DELETE FROM task_assignees WHERE taskId = ?', [req.params.id]);
      await db.run('DELETE FROM task_tags WHERE taskId = ?', [req.params.id]);
      await db.run('DELETE FROM task_subtasks WHERE taskId = ?', [req.params.id]);
      await db.run('DELETE FROM task_comments WHERE taskId = ?', [req.params.id]);
      await db.run('DELETE FROM tasks WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  return router;
}
