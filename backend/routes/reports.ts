import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { sendNotification } from '../utils/notify.js';
import { validate } from '../middleware/validate.js';

const ReportCreateSchema = z.object({
  id: z.string().trim().min(1).max(191),
  title: z.string().trim().min(1).max(300),
  content: z.string().max(1_000_000).nullable().optional(),
  status: z.enum(['Draft', 'Pending', 'Pending Director', 'Approved', 'Rejected']).optional(),
});
const ReportUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  content: z.string().max(1_000_000).nullable().optional(),
  status: z.enum(['Draft', 'Pending', 'Approved', 'Rejected']),
  submittedAt: z.string().max(40).nullable().optional(),
  approvedAt: z.string().max(40).nullable().optional(),
  approvedBy: z.string().max(191).nullable().optional(),
  directorFeedback: z.string().max(10_000).nullable().optional(),
  managerFeedback: z.string().max(10_000).nullable().optional(),
});

export function reportRoutes(db: any) {
  const router = Router();

  const canManageReports = (user: any) => user?.role === 'Admin'
    || user?.permissions?.includes('admin_panel')
    || user?.permissions?.includes('view_all_reports')
    || user?.permissions?.includes('director_feedback');
  const isAdmin = (user: any) => user?.role === 'Admin' || user?.permissions?.includes('admin_panel');

  router.get('/', async (req, res) => {
    try {
      // Time-boxing: only load data from the last 6 months
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const thresholdDate = sixMonthsAgo.toISOString();
      
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const reports = canManageReports(req.user)
        ? await db.all('SELECT * FROM reports WHERE (isDeleted IS NULL OR isDeleted = 0) AND createdAt >= ?', [thresholdDate])
        : await db.all('SELECT * FROM reports WHERE (isDeleted IS NULL OR isDeleted = 0) AND createdAt >= ? AND authorId = ?', [thresholdDate, req.user.id]);
      res.json(reports);
    } catch (e) { res.status(500).json({ error: 'Failed to fetch reports' }); }
  });

  router.get('/archive', async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const reports = canManageReports(req.user)
        ? await db.all('SELECT * FROM reports WHERE isDeleted IS NULL OR isDeleted = 0')
        : await db.all('SELECT * FROM reports WHERE (isDeleted IS NULL OR isDeleted = 0) AND authorId = ?', [req.user.id]);
      res.json(reports);
    } catch (e) { res.status(500).json({ error: 'Failed to fetch reports archive' }); }
  });

  router.post('/', validate(ReportCreateSchema), async (req, res) => {
    const { id, title, content, status } = req.body;
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const authorId = req.user.id;
      const department = req.user.department;
      const createdAt = new Date().toISOString();
      const safeStatus = ['Draft', 'Pending'].includes(status) ? status : 'Draft';
      let finalContent = content;
      try {
        if (content) {
          const parsed = JSON.parse(content);
          const docs = await db.all(
            'SELECT name, url, size, type FROM documents WHERE linkedId = ? AND category = ? AND (isDeleted IS NULL OR isDeleted = 0)',
            [id, 'reports']
          );
          if (docs && docs.length > 0) {
            parsed.attachments = docs.map((d: any) => ({
              name: d.name,
              url: d.url,
              size: d.size,
              type: d.type
            }));
          } else {
            delete parsed.attachments;
          }
          finalContent = JSON.stringify(parsed);
        }
      } catch (err) {
        console.error('Lỗi đồng bộ đính kèm báo cáo:', err);
      }

      await db.run(
        'INSERT INTO reports (id, title, content, authorId, department, status, createdAt, submittedAt, approvedAt, approvedBy, directorFeedback, managerFeedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, title, finalContent ?? null, authorId, department, safeStatus, createdAt, safeStatus.startsWith('Pending') ? createdAt : null, null, null, null, null],
      );
      await db.run(
        'INSERT INTO activity_logs (id, userId, action, entityId, entityType, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [randomUUID(), authorId, 'report.created', id, 'report', new Date().toISOString()],
      );

      if (safeStatus.startsWith('Pending')) {
        const dept = await db.get('SELECT managerId FROM departments WHERE name = ? OR id = ?', [department, department]);
        if (dept?.managerId) {
          await sendNotification(db, dept.managerId, 'report_submitted', 'Báo cáo mới', `Nhân viên vừa nộp báo cáo: ${title}`, id);
        }
      }

      res.status(201).json({ id });
    } catch (e) { res.status(500).json({ error: 'Failed to create report' }); }
  });

  router.put('/:id', validate(ReportUpdateSchema), async (req, res) => {
    const reportId = String(req.params.id);
    const { title, content, status, submittedAt, approvedAt, approvedBy, directorFeedback, managerFeedback } = req.body;
    try {
      const existing = await db.get('SELECT * FROM reports WHERE id = ?', [reportId]);
      if (!existing) return res.status(404).json({ error: 'Report not found' });
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const authorEdit = existing.authorId === req.user.id && ['Draft', 'Rejected'].includes(existing.status) && ['Draft', 'Pending'].includes(status);
      const managerReview = !isAdmin(req.user)
        && req.user.permissions?.includes('approve_dept_reports')
        && req.user.department === existing.department
        && existing.authorId !== req.user.id
        && existing.status === 'Pending'
        && ['Approved', 'Rejected'].includes(status);
      const adminManagerReview = isAdmin(req.user)
        && req.user.department === existing.department
        && existing.authorId !== req.user.id
        && existing.status === 'Pending'
        && ['Approved', 'Rejected'].includes(status);
      const directorReview = (isAdmin(req.user) || req.user.permissions?.includes('director_feedback'))
        && existing.authorId !== req.user.id
        && existing.status === 'Pending'
        && ['Approved', 'Rejected'].includes(status)
        && !managerReview
        && !adminManagerReview;
      const directorFeedbackEdit = (isAdmin(req.user) || req.user.permissions?.includes('director_feedback'))
        && existing.authorId !== req.user.id
        && existing.status === 'Approved'
        && status === 'Approved';
      const manager = Boolean(managerReview || adminManagerReview);
      const director = Boolean(directorReview || directorFeedbackEdit);
      if (!authorEdit && !manager && !director) return res.status(403).json({ error: 'Report update is not allowed for this role or workflow state' });

      let finalContent = content;
      try {
        if (content) {
          const parsed = JSON.parse(content);
          const docs = await db.all(
            'SELECT name, url, size, type FROM documents WHERE linkedId = ? AND category = ? AND (isDeleted IS NULL OR isDeleted = 0)',
            [reportId, 'reports']
          );
          if (docs && docs.length > 0) {
            parsed.attachments = docs.map((d: any) => ({
              name: d.name,
              url: d.url,
              size: d.size,
              type: d.type
            }));
          } else {
            delete parsed.attachments;
          }
          finalContent = JSON.stringify(parsed);
        }
      } catch (err) {
        console.error('Lỗi đồng bộ đính kèm báo cáo:', err);
      }

      await db.run(
        'UPDATE reports SET title=?, content=?, status=?, submittedAt=?, approvedAt=?, approvedBy=?, directorFeedback=?, managerFeedback=? WHERE id=?',
        [title, finalContent ?? null, status, authorEdit && status === 'Pending' ? new Date().toISOString() : existing.submittedAt ?? submittedAt ?? null, (manager || director) && status === 'Approved' ? new Date().toISOString() : existing.approvedAt ?? null, (manager || director) && status === 'Approved' ? req.user.id : existing.approvedBy ?? null, director ? directorFeedback ?? null : existing.directorFeedback ?? null, manager ? managerFeedback ?? null : existing.managerFeedback ?? null, reportId],
      );
      await db.run(
        'INSERT INTO activity_logs (id, userId, action, entityId, entityType, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [randomUUID(), req.user.id, `report.${status}`, reportId, 'report', new Date().toISOString()],
      );

      if (existing && existing.status !== status) {
        let msg = `Báo cáo của bạn đã chuyển sang trạng thái: ${status}`;
        if (status === 'Approved') msg = 'Báo cáo của bạn đã được duyệt.';
        if (status === 'Rejected') msg = 'Báo cáo của bạn đã bị từ chối.';
        await sendNotification(db, existing.authorId, 'report_updated', 'Cập nhật báo cáo', msg, reportId);
      }

      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to update report' }); }
  });

  // Soft delete – only allow deleting Draft or Rejected reports, unless user is Admin or Giám đốc
  router.delete('/:id', async (req, res) => {
    try {
      const report = await db.get('SELECT status, authorId FROM reports WHERE id = ?', [req.params.id]);
      if (!report) return res.status(404).json({ error: 'Report not found' });
      
      const isSuperUser = isAdmin(req.user);
      if (!req.user || (!isSuperUser && report.authorId !== req.user.id)) return res.status(403).json({ error: 'Forbidden' });

      if (!isSuperUser && (report.status === 'Approved' || report.status.startsWith('Pending'))) {
        return res.status(403).json({ error: 'Cannot delete an approved or pending report' });
      }
      
      if (!req.user || isSuperUser) {
        await db.run('DELETE FROM reports WHERE id = ?', [req.params.id]);
      } else {
        await db.run('UPDATE reports SET isDeleted = 1 WHERE id = ?', [req.params.id]);
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to delete report' }); }
  });

  return router;
}
