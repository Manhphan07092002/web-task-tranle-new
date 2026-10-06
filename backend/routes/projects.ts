import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { sendNotification } from '../utils/notify.js';
import { sanitizeActivityValue } from '../utils/activityPrivacy.js';

const optionalProjectText = (max: number) => z.string().max(max).nullable().optional();
const ProjectBodySchema = z.object({
  id: z.string().max(191).optional(),
  projectCode: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(300),
  clientName: optionalProjectText(300),
  department: z.string().max(191).optional(),
  managerId: z.string().max(191).optional(),
  status: z.string().trim().min(1).max(50),
  startDate: optionalProjectText(64),
  endDate: optionalProjectText(64),
  budget: z.number().finite().nonnegative().optional(),
  description: optionalProjectText(20_000),
  biddingCode: optionalProjectText(100),
  biddingDate: optionalProjectText(64),
  procurementMethod: optionalProjectText(200),
  investor: optionalProjectText(300),
  biddingPrice: z.number().finite().nonnegative().optional(),
  winningPrice: z.number().finite().nonnegative().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  phase: z.enum(['initiation', 'planning', 'execution', 'monitoring', 'closure']).optional(),
});
const CreateProjectSchema = ProjectBodySchema.extend({ status: z.string().trim().min(1).max(50).optional() });
const ProjectReportBodySchema = z.object({
  id: z.string().max(191).optional(),
  title: z.string().trim().min(1).max(300),
  content: z.string().max(100_000).optional(),
  progress: z.number().finite().min(0).max(100).optional(),
  status: z.string().trim().min(1).max(50).optional(),
});
const ProjectMilestoneBodySchema = z.object({
  id: z.string().max(191).optional(),
  title: z.string().trim().min(1).max(300),
  dueDate: z.string().max(64).nullable().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'overdue']).optional(),
  completedAt: z.string().max(64).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

export function projectRoutes(db: any) {
  const router = Router();

  async function logActivity(userId: string, action: string, entityId: string, metadata: any) {
    const id = randomUUID();
    await db.run(
      'INSERT INTO activity_logs (id, userId, action, entityId, entityType, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, userId, action, entityId, 'project', JSON.stringify(sanitizeActivityValue(metadata)), new Date().toISOString()]
    );
  }

  const canManageProjects = (user: any) => user?.role === 'Admin'
    || user?.permissions?.includes('admin_panel')
    || user?.permissions?.includes('view_all_tasks')
    || user?.permissions?.includes('view_all_reports');
  const canManageProject = (project: any, user: any) => canManageProjects(user) || project?.managerId === user?.id;

  async function getProjectAccess(id: string, user: any) {
    const project = await db.get('SELECT * FROM projects WHERE id = ? AND (isDeleted IS NULL OR isDeleted = 0)', [id]);
    return { project, allowed: Boolean(project && user && (canManageProjects(user) || project.managerId === user.id || project.department === user.department)) };
  }

  // GET all projects
  router.get('/', async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const perms = user.permissions || [];
      const canViewAll = perms.includes('view_all_reports') || perms.includes('director_feedback') || perms.includes('admin_panel') || perms.includes('view_all_tasks');

      let query = 'SELECT * FROM projects WHERE (isDeleted IS NULL OR isDeleted = 0)';
      const params: any[] = [];

      if (!canViewAll) {
        query += ' AND (managerId = ? OR department = ?)';
        params.push(user.id, user.department || '');
      }
      
      query += ' ORDER BY createdAt DESC';
      const rows = await db.all(query, params);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: 'Failed to fetch projects' }); }
  });

  // GET single project with its contracts and reports
  router.get('/:id', async (req, res) => {
    try {
      const projectId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!projectId) return res.status(400).json({ error: 'Invalid project id' });
      const { project, allowed } = await getProjectAccess(projectId, req.user);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
      
      const contracts = await db.all('SELECT * FROM contracts WHERE projectId = ? AND (isDeleted IS NULL OR isDeleted = 0)', [req.params.id]);
      const reports = await db.all('SELECT * FROM project_reports WHERE projectId = ? ORDER BY createdAt DESC', [req.params.id]);
      
      res.json({ project, contracts, reports });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch project details' }); }
  });

  // CREATE project
  router.post('/', validate(CreateProjectSchema), async (req, res) => {
    const { projectCode, name, clientName, department: requestedDepartment, managerId: requestedManagerId, status, startDate, endDate, budget, description, biddingCode, biddingDate, procurementMethod, investor, biddingPrice, winningPrice, priority, phase } = req.body;
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const canAssignProject = canManageProjects(user);
      const targetDepartment = canAssignProject && typeof requestedDepartment === 'string' && requestedDepartment.trim()
        ? requestedDepartment.trim()
        : user.department;
      const targetManagerId = canAssignProject && requestedManagerId ? requestedManagerId : user.id;
      if (!targetDepartment) return res.status(400).json({ error: 'Project department is required' });
      if (canAssignProject) {
        const manager = await db.get('SELECT id, department, isLocked FROM users WHERE id = ?', [targetManagerId]);
        if (!manager || manager.isLocked || manager.department !== targetDepartment) {
          return res.status(400).json({ error: 'Project manager must be an active user in the selected department' });
        }
      }
      const projectId = randomUUID();
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO projects (id, projectCode, name, clientName, department, managerId, status, startDate, endDate, budget, description, biddingCode, biddingDate, procurementMethod, investor, biddingPrice, winningPrice, priority, phase, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [projectId, projectCode, name, clientName, targetDepartment, targetManagerId, status || 'planning', startDate, endDate, budget || 0, description, biddingCode, biddingDate, procurementMethod, investor, biddingPrice || 0, winningPrice || 0, priority || 'medium', phase || 'initiation', now]
      );

      // Auto-create a Task for this new project
      const taskId = randomUUID();
      const createdBy = user.id;
      await db.run(
        'INSERT INTO tasks (id, title, description, startDate, priority, status, createdBy, department, projectId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [taskId, `Thực hiện DA: ${projectCode || name}`, `Dự án: ${name}\nKhách hàng: ${clientName || ''}`, now.split('T')[0], 'Medium', 'Todo', createdBy, targetDepartment, projectId]
      );
      await db.run('INSERT INTO task_assignees (taskId, userId) VALUES (?, ?)', [taskId, createdBy]);

      await logActivity((req as any).user?.id || 'system', 'Tạo Dự án', projectId, { projectCode, name });

      res.status(201).json({ id: projectId });
    } catch (e: any) { res.status(500).json({ error: 'Failed to create project', detail: e.message }); }
  });

  // UPDATE project
  router.put('/:id', validate(ProjectBodySchema), async (req, res) => {
    const { projectCode, name, clientName, department, managerId, status, startDate, endDate, budget, description, biddingCode, biddingDate, procurementMethod, investor, biddingPrice, winningPrice, priority, phase } = req.body;
    try {
      const projectId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!projectId) return res.status(400).json({ error: 'Invalid project id' });
      const { project, allowed } = await getProjectAccess(projectId, req.user);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      if (!allowed || !canManageProject(project, req.user)) return res.status(403).json({ error: 'Forbidden' });
      const targetDepartment = canManageProjects(req.user) ? (department || project.department) : project.department;
      const targetManagerId = canManageProjects(req.user) ? (managerId || project.managerId) : project.managerId;
      if (canManageProjects(req.user) && (targetDepartment !== project.department || targetManagerId !== project.managerId)) {
        const manager = await db.get('SELECT id, department, isLocked FROM users WHERE id = ?', [targetManagerId]);
        if (!manager || manager.isLocked || manager.department !== targetDepartment) {
          return res.status(400).json({ error: 'Project manager must be an active user in the selected department' });
        }
      }
      await db.run(
        `UPDATE projects SET projectCode=?, name=?, clientName=?, department=?, managerId=?, status=?, startDate=?, endDate=?, budget=?, description=?, biddingCode=?, biddingDate=?, procurementMethod=?, investor=?, biddingPrice=?, winningPrice=?, priority=?, phase=?, updatedAt=? WHERE id=?`,
        [projectCode, name, clientName, targetDepartment, targetManagerId, status, startDate, endDate, budget, description, biddingCode, biddingDate, procurementMethod, investor, biddingPrice, winningPrice, priority || 'medium', phase || 'initiation', new Date().toISOString(), projectId]
      );

      await logActivity((req as any).user?.id || 'system', 'Cập nhật Dự án', projectId, { status, budget });

      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to update project' }); }
  });

  // DELETE project
  router.delete('/:id', async (req, res) => {
    try {
      const { project, allowed } = await getProjectAccess(req.params.id, req.user);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      if (!allowed || !canManageProject(project, req.user)) return res.status(403).json({ error: 'Forbidden' });
      await db.run('UPDATE projects SET isDeleted = 1 WHERE id = ?', [req.params.id]);
      await logActivity((req as any).user?.id || 'system', 'Xóa Dự án', req.params.id, {});
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to delete project' }); }
  });

  // --- PROJECT REPORTS ---
  
  router.get('/:id/reports', async (req, res) => {
    try {
      const { allowed } = await getProjectAccess(req.params.id, req.user);
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
      const rows = await db.all('SELECT * FROM project_reports WHERE projectId = ? ORDER BY createdAt DESC', [req.params.id]);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: 'Failed to fetch project reports' }); }
  });

  router.post('/:id/reports', validate(ProjectReportBodySchema), async (req, res) => {
    const { id, title, content, progress, authorId, status } = req.body;
    try {
      const projectId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!projectId) return res.status(400).json({ error: 'Invalid project id' });
      const { allowed } = await getProjectAccess(projectId, req.user);
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
      const reportId = id || randomUUID();
      await db.run(
        'INSERT INTO project_reports (id, projectId, title, content, progress, authorId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [reportId, projectId, title, content, progress || 0, req.user?.id, status || 'draft', new Date().toISOString()]
      );

      // notify manager
      if (status === 'submitted') {
        const project = await db.get('SELECT managerId, name FROM projects WHERE id = ?', [projectId]);
        if (project?.managerId) {
          await sendNotification(db, project.managerId, 'project_report_submitted', 'Báo cáo dự án mới', `Dự án: ${project.name} có báo cáo mới`, projectId);
        }
      }

      await logActivity((req as any).user?.id || 'system', 'Tạo Báo cáo DA', projectId, { reportId, title, progress });
      res.status(201).json({ id: reportId });
    } catch (e: any) { res.status(500).json({ error: 'Failed to create project report', detail: e.message }); }
  });

  router.put('/:id/reports/:reportId', validate(ProjectReportBodySchema.omit({ id: true })), async (req, res) => {
    const { title, content, progress, status } = req.body;
    try {
      const projectId = typeof req.params.id === 'string' ? req.params.id : '';
      const reportId = typeof req.params.reportId === 'string' ? req.params.reportId : '';
      if (!projectId || !reportId) return res.status(400).json({ error: 'Invalid project report id' });
      const { project, allowed } = await getProjectAccess(projectId, req.user);
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
      const report = await db.get('SELECT authorId FROM project_reports WHERE id = ? AND projectId = ?', [reportId, projectId]);
      if (!report) return res.status(404).json({ error: 'Project report not found' });
      if (report.authorId !== req.user?.id && !canManageProject(project, req.user)) return res.status(403).json({ error: 'Forbidden' });
      await db.run(
        'UPDATE project_reports SET title=?, content=?, progress=?, status=?, updatedAt=? WHERE id=? AND projectId=?',
        [title, content, progress, status, new Date().toISOString(), reportId, projectId]
      );
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to update project report' }); }
  });

  router.delete('/:id/reports/:reportId', async (req, res) => {
    try {
      const { project, allowed } = await getProjectAccess(req.params.id, req.user);
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
      const report = await db.get('SELECT authorId FROM project_reports WHERE id = ? AND projectId = ?', [req.params.reportId, req.params.id]);
      if (!report) return res.status(404).json({ error: 'Project report not found' });
      if (report.authorId !== req.user?.id && !canManageProject(project, req.user)) return res.status(403).json({ error: 'Forbidden' });
      await db.run('DELETE FROM project_reports WHERE id = ? AND projectId = ?', [req.params.reportId, req.params.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to delete project report' }); }
  });

  // --- PROJECT MILESTONES ---

  router.get('/:id/milestones', async (req, res) => {
    try {
      const { allowed } = await getProjectAccess(req.params.id, req.user);
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
      const rows = await db.all('SELECT * FROM project_milestones WHERE projectId = ? ORDER BY sortOrder ASC, createdAt ASC', [req.params.id]);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: 'Failed to fetch milestones' }); }
  });

  router.post('/:id/milestones', validate(ProjectMilestoneBodySchema), async (req, res) => {
    const { id, title, dueDate, status, sortOrder } = req.body;
    try {
      const projectId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!projectId) return res.status(400).json({ error: 'Invalid project id' });
      const { project, allowed } = await getProjectAccess(projectId, req.user);
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
      if (!canManageProject(project, req.user)) return res.status(403).json({ error: 'Only the project manager or an administrator can change milestones' });
      const mId = id || randomUUID();
      await db.run(
        'INSERT INTO project_milestones (id, projectId, title, dueDate, status, sortOrder, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [mId, projectId, title, dueDate, status || 'pending', sortOrder || 0, new Date().toISOString()]
      );
      res.status(201).json({ id: mId });
    } catch (e: any) { res.status(500).json({ error: 'Failed to create milestone', detail: e.message }); }
  });

  router.put('/:id/milestones/:milestoneId', validate(ProjectMilestoneBodySchema.omit({ id: true })), async (req, res) => {
    const { title, dueDate, status, completedAt, sortOrder } = req.body;
    try {
      const projectId = typeof req.params.id === 'string' ? req.params.id : '';
      const milestoneId = typeof req.params.milestoneId === 'string' ? req.params.milestoneId : '';
      if (!projectId || !milestoneId) return res.status(400).json({ error: 'Invalid milestone id' });
      const { project, allowed } = await getProjectAccess(projectId, req.user);
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
      if (!canManageProject(project, req.user)) return res.status(403).json({ error: 'Only the project manager or an administrator can change milestones' });
      await db.run(
        'UPDATE project_milestones SET title=?, dueDate=?, status=?, completedAt=?, sortOrder=? WHERE id=? AND projectId=?',
        [title, dueDate, status, completedAt, sortOrder, milestoneId, projectId]
      );
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to update milestone' }); }
  });

  router.delete('/:id/milestones/:milestoneId', async (req, res) => {
    try {
      const { project, allowed } = await getProjectAccess(req.params.id, req.user);
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
      if (!canManageProject(project, req.user)) return res.status(403).json({ error: 'Only the project manager or an administrator can change milestones' });
      await db.run('DELETE FROM project_milestones WHERE id = ? AND projectId = ?', [req.params.milestoneId, req.params.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to delete milestone' }); }
  });

  return router;
}
