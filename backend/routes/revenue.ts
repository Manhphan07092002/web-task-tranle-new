import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { sendNotification } from '../utils/notify.js';
import { validate } from '../middleware/validate.js';

const RevenueStatusSchema = z.enum(['Draft', 'Pending Manager', 'Pending Director', 'Approved', 'Rejected']);
const RevenueCreateSchema = z.object({
  id: z.string().trim().min(1).max(191),
  title: z.string().trim().min(1).max(300),
  reportType: z.string().trim().min(1).max(64),
  periodStart: z.string().min(1).max(40),
  periodEnd: z.string().min(1).max(40),
  content: z.string().max(1_000_000).nullable().optional(),
  totalPreTax: z.coerce.number().finite().min(0).optional(),
  totalDelivered: z.coerce.number().finite().min(0).optional(),
  totalCumulative: z.coerce.number().finite().min(0).optional(),
  status: RevenueStatusSchema.optional(),
  generationMode: z.string().max(64).optional(),
});
const RevenueUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  content: z.string().max(1_000_000).nullable().optional(),
  reportType: z.string().trim().min(1).max(64).optional(),
  periodStart: z.string().min(1).max(40).optional(),
  periodEnd: z.string().min(1).max(40).optional(),
  totalPreTax: z.coerce.number().finite().min(0).optional(),
  totalDelivered: z.coerce.number().finite().min(0).optional(),
  totalCumulative: z.coerce.number().finite().min(0).optional(),
  status: RevenueStatusSchema,
  submittedAt: z.string().max(40).nullable().optional(),
  approvedAt: z.string().max(40).nullable().optional(),
  approvedBy: z.string().max(191).nullable().optional(),
  managerFeedback: z.string().max(10_000).nullable().optional(),
  directorFeedback: z.string().max(10_000).nullable().optional(),
  generationMode: z.string().max(64).optional(),
});

export function revenueRoutes(db: any) {
  const router = Router();
  const canManageRevenue = (user: any) => user?.role === 'Admin'
    || user?.permissions?.includes('admin_panel')
    || user?.permissions?.includes('view_all_reports')
    || user?.permissions?.includes('director_feedback');
  const isAdmin = (user: any) => user?.role === 'Admin' || user?.permissions?.includes('admin_panel');

  // GET all revenue reports (not deleted, last 6 months)
  router.get('/', async (req, res) => {
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const rows = canManageRevenue(req.user)
        ? await db.all('SELECT * FROM revenue_reports WHERE (isDeleted IS NULL OR isDeleted = 0) AND createdAt >= ? ORDER BY createdAt DESC', [sixMonthsAgo.toISOString()])
        : await db.all('SELECT * FROM revenue_reports WHERE (isDeleted IS NULL OR isDeleted = 0) AND createdAt >= ? AND authorId = ? ORDER BY createdAt DESC', [sixMonthsAgo.toISOString(), req.user.id]);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: 'Failed to fetch revenue reports' }); }
  });

  // GET archive
  router.get('/archive', async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const rows = canManageRevenue(req.user)
        ? await db.all('SELECT * FROM revenue_reports WHERE isDeleted IS NULL OR isDeleted = 0 ORDER BY createdAt DESC')
        : await db.all('SELECT * FROM revenue_reports WHERE (isDeleted IS NULL OR isDeleted = 0) AND authorId = ? ORDER BY createdAt DESC', [req.user.id]);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: 'Failed to fetch revenue reports archive' }); }
  });

  // CREATE
  router.post('/', validate(RevenueCreateSchema), async (req, res) => {
    const { id, title, reportType, periodStart, periodEnd, content, totalPreTax, totalDelivered, totalCumulative, status, generationMode } = req.body;
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const authorId = req.user.id;
      const department = req.user.department;
      const maySubmitToDirector = req.user.permissions?.includes('approve_dept_revenue')
        || req.user.permissions?.includes('approve_all_revenue')
        || req.user.permissions?.includes('director_feedback')
        || isAdmin(req.user);
      const safeStatus = status === 'Draft' ? 'Draft'
        : status === 'Pending Manager' ? 'Pending Manager'
          : status === 'Pending Director' && maySubmitToDirector ? 'Pending Director'
            : 'Draft';
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO revenue_reports (id, title, reportType, periodStart, periodEnd, content, totalPreTax, totalDelivered, totalCumulative, authorId, department, status, createdAt, submittedAt, generationMode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, title, reportType, periodStart, periodEnd, content ?? null, totalPreTax ?? 0, totalDelivered ?? 0, totalCumulative ?? 0, authorId, department, safeStatus, now, safeStatus.startsWith('Pending') ? now : null, generationMode || 'manual']
      );

      // Log activity
      await db.run(
        'INSERT INTO activity_logs (id, userId, action, entityId, entityType, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [randomUUID(), authorId, 'revenue_report.created', id, 'revenue_report', now]
      );

      // Notify manager if submitting
      if (safeStatus.startsWith('Pending')) {
        const dept = await db.get('SELECT managerId FROM departments WHERE name = ? OR id = ?', [department, department]);
        if (dept?.managerId) {
          await sendNotification(db, dept.managerId, 'revenue_submitted', 'Báo cáo doanh thu mới', `Nhân viên vừa nộp báo cáo doanh thu: ${title}`, id);
        }
      }

      res.status(201).json({ id });
    } catch (e: any) { res.status(500).json({ error: 'Failed to create revenue report', detail: e.message }); }
  });

  // UPDATE (also used for approve/reject)
  router.put('/:id', validate(RevenueUpdateSchema), async (req, res) => {
    const reportId = String(req.params.id);
    const { title, content, reportType, periodStart, periodEnd, totalPreTax, totalDelivered, totalCumulative, status, submittedAt, approvedAt, approvedBy, managerFeedback, directorFeedback, generationMode } = req.body;
    try {
      const existing = await db.get('SELECT * FROM revenue_reports WHERE id = ?', [reportId]);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const maySubmitToDirector = req.user.permissions?.includes('approve_dept_revenue')
        || req.user.permissions?.includes('approve_all_revenue')
        || req.user.permissions?.includes('director_feedback')
        || isAdmin(req.user);
      const authorEdit = existing.authorId === req.user.id
        && ['Draft', 'Rejected'].includes(existing.status)
        && ['Draft', 'Pending Manager', ...(maySubmitToDirector ? ['Pending Director'] : [])].includes(status);
      const managerReview = !isAdmin(req.user)
        && req.user.permissions?.includes('approve_dept_revenue')
        && req.user.department === existing.department
        && existing.authorId !== req.user.id
        && existing.status === 'Pending Manager'
        && ['Pending Director', 'Rejected'].includes(status);
      const adminManagerReview = isAdmin(req.user)
        && req.user.department === existing.department
        && existing.authorId !== req.user.id
        && existing.status === 'Pending Manager'
        && ['Pending Director', 'Rejected'].includes(status);
      const directorReview = (isAdmin(req.user) || req.user.permissions?.includes('approve_all_revenue') || req.user.permissions?.includes('director_feedback'))
        && existing.authorId !== req.user.id
        && existing.status === 'Pending Director'
        && ['Approved', 'Rejected'].includes(status)
        && !managerReview
        && !adminManagerReview;
      const directorFeedbackEdit = (isAdmin(req.user) || req.user.permissions?.includes('approve_all_revenue') || req.user.permissions?.includes('director_feedback'))
        && existing.authorId !== req.user.id
        && existing.status === 'Approved'
        && status === 'Approved';
      const manager = Boolean(managerReview || adminManagerReview);
      const director = Boolean(directorReview || directorFeedbackEdit);
      if (!authorEdit && !manager && !director) return res.status(403).json({ error: 'Revenue report update is not allowed for this role or workflow state' });

      await db.run(
        `UPDATE revenue_reports SET title=?, content=?, reportType=?, periodStart=?, periodEnd=?, totalPreTax=?, totalDelivered=?, totalCumulative=?, status=?, submittedAt=?, approvedAt=?, approvedBy=?, managerFeedback=?, directorFeedback=?, generationMode=? WHERE id=?`,
        [title, content ?? null, reportType, periodStart, periodEnd, totalPreTax ?? 0, totalDelivered ?? 0, totalCumulative ?? 0, status, authorEdit && status.startsWith('Pending') ? new Date().toISOString() : existing.submittedAt ?? submittedAt ?? null, (manager || director) && status === 'Approved' ? new Date().toISOString() : existing.approvedAt ?? null, (manager || director) && status === 'Approved' ? req.user.id : existing.approvedBy ?? null, manager ? managerFeedback ?? null : existing.managerFeedback ?? null, director ? directorFeedback ?? null : existing.directorFeedback ?? null, generationMode || 'manual', reportId]
      );

      // Log
      await db.run(
        'INSERT INTO activity_logs (id, userId, action, entityId, entityType, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [randomUUID(), req.user.id, `revenue_report.${status}`, reportId, 'revenue_report', new Date().toISOString()]
      );

      // Notify on status change
      if (existing && existing.status !== status) {
        // 1. Notify the author
        let msg = `Báo cáo doanh thu đã chuyển sang: ${status}`;
        if (status === 'Approved') msg = `Báo cáo doanh thu "${title}" đã được Giám đốc phê duyệt hoàn tất.`;
        if (status === 'Rejected') msg = `Báo cáo doanh thu "${title}" đã bị từ chối.`;
        await sendNotification(db, existing.authorId, 'revenue_updated', 'Cập nhật báo cáo doanh thu', msg, reportId);

        // 2. TP DUYỆT XONG -> TỰ ĐỘNG GỬI GIÁM ĐỐC XEM
        if (status === 'Pending Director') {
          // Notify Director(s)
          const directors = await db.all("SELECT id FROM users WHERE role = 'Director' OR role = 'Admin'");
          for (const dir of directors) {
            await sendNotification(
              db,
              dir.id,
              'revenue_pending_director',
              'Báo cáo doanh thu chờ duyệt',
              `Trưởng phòng đã duyệt báo cáo doanh thu "${title}". Yêu cầu Giám đốc xem và phê duyệt.`,
              reportId
            );
          }
        }

        // 3. GIÁM ĐỐC DUYỆT XONG -> ĐẨY THÔNG BÁO LẠI CHO TP VÀ PHÒNG
        if (status === 'Approved') {
          const deptName = existing.department;
          
          // Find TP of department
          const deptInfo = await db.get("SELECT managerId FROM departments WHERE name = ? OR id = ?", [deptName, deptName]);
          
          // Find all users in the department
          const deptUsers = await db.all("SELECT id FROM users WHERE department = ?", [deptName]);
          
          const notifiedUserIds = new Set<string>();

          // Send to TP
          if (deptInfo?.managerId) {
            await sendNotification(
              db,
              deptInfo.managerId,
              'revenue_approved_tp',
              'Báo cáo doanh thu đã hoàn thành',
              `Giám đốc đã phê duyệt hoàn tất báo cáo doanh thu "${title}" của phòng ban.`,
              reportId
            );
            notifiedUserIds.add(deptInfo.managerId);
          }

          // Send to department staff (phòng)
          for (const u of deptUsers) {
            if (notifiedUserIds.has(u.id)) continue; // avoid duplicates
            await sendNotification(
              db,
              u.id,
              'revenue_approved_dept',
              'Báo cáo doanh thu đã hoàn thành',
              `Báo cáo doanh thu "${title}" của phòng ban đã được phê duyệt hoàn tất.`,
              reportId
            );
          }
        }
      }

      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to update revenue report' }); }
  });

  // SOFT DELETE (only Draft/Rejected, unless Admin/Giám đốc)
  router.delete('/:id', async (req, res) => {
    try {
      const report = await db.get('SELECT status, authorId FROM revenue_reports WHERE id = ?', [req.params.id]);
      if (!report) return res.status(404).json({ error: 'Not found' });
      
      const isSuperUser = isAdmin(req.user);
      if (!req.user || (!isSuperUser && report.authorId !== req.user.id)) return res.status(403).json({ error: 'Forbidden' });
      
      if (!isSuperUser && (report.status === 'Approved' || report.status.startsWith('Pending'))) {
        return res.status(403).json({ error: 'Cannot delete approved or pending report' });
      }
      
      if (isSuperUser) {
        await db.run('DELETE FROM revenue_reports WHERE id = ?', [req.params.id]);
      } else {
        await db.run('UPDATE revenue_reports SET isDeleted = 1 WHERE id = ?', [req.params.id]);
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to delete revenue report' }); }
  });

  return router;
}
