import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const DepartmentSchema = z.object({
  id: z.string().trim().min(1).max(191).optional(),
  name: z.string().trim().min(1).max(191),
  description: z.string().max(5000).optional(),
  color: z.string().max(32).optional(),
  managerId: z.string().trim().max(191).nullable().optional(),
  code: z.string().trim().max(50).nullable().optional(),
  parentId: z.string().trim().max(191).nullable().optional(),
  level: z.number().int().min(1).max(9).nullable().optional(),
  isActive: z.number().int().min(0).max(1).nullable().optional(),
});
const DepartmentUpdateSchema = DepartmentSchema.omit({ id: true }).partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export function departmentRoutes(db: any) {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const depts = await db.all('SELECT * FROM departments ORDER BY name ASC');
      const result = await Promise.all(depts.map(async (d: any) => {
        // Đếm cả 2 cột: department string cũ + primaryDepartmentId FK mới
        const { count: userCount } = await db.get('SELECT COUNT(*) as count FROM users WHERE department = ? OR primaryDepartmentId = ?', [d.name, d.id]);
        const { count: taskCount } = await db.get('SELECT COUNT(*) as count FROM tasks WHERE department = ?', [d.name]);
        const manager = d.managerId ? await db.get('SELECT id, name, avatar FROM users WHERE id = ?', [d.managerId]) : null;
        const parent = (d as any).parentId ? await db.get('SELECT id, name FROM departments WHERE id = ?', [(d as any).parentId]) : null;
        return { ...d, userCount, taskCount, manager, parentName: parent?.name || null };
      }));
      res.json(result);
    } catch (e) { res.status(500).json({ error: 'Failed to fetch departments' }); }
  });

  router.post('/', requireAdmin, validate(DepartmentSchema), async (req, res) => {
    const { id, name, description, color, managerId, code, parentId, level, isActive } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Tên phòng ban không được trống' });
    try {
      const newId = id || `dept-${Date.now()}`;
      const normCode = code?.trim() ? code.trim().toUpperCase() : null;
      await db.run('INSERT INTO departments (id, name, description, color, managerId, code, parentId, level, isActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [newId, name.trim(), description || '', color || '#6366f1', managerId || null, normCode, parentId || null, level ?? 2, isActive ?? 1]);
      res.status(201).json({ id: newId });
    } catch (e: any) {
      if (e.message?.includes('UNIQUE') || e.message?.includes('Duplicate')) return res.status(409).json({ error: 'Tên hoặc mã phòng ban đã tồn tại' });
      res.status(500).json({ error: 'Failed to create department' });
    }
  });

  router.put('/:id', requireAdmin, validate(DepartmentUpdateSchema), async (req, res) => {
    const { name, description, color, managerId, code, parentId, level, isActive } = req.body;
    try {
      const existing = await db.get('SELECT * FROM departments WHERE id = ?', [req.params.id]);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const oldName = existing.name;
      const newName = name?.trim() ?? oldName;
      const normCode = code !== undefined ? (code?.trim() ? code.trim().toUpperCase() : null) : existing.code;
      await db.run('UPDATE departments SET name = ?, description = ?, color = ?, managerId = ?, code = ?, parentId = ?, level = ?, isActive = ? WHERE id = ?', [newName, description ?? existing.description, color ?? existing.color, managerId ?? existing.managerId, normCode, parentId ?? existing.parentId, level ?? existing.level ?? 2, isActive ?? existing.isActive ?? 1, req.params.id]);
      if (newName !== oldName) {
        // Cascade tên string cũ sang mọi bảng còn dùng department dạng tên
        await db.run('UPDATE users SET department = ? WHERE department = ?', [newName, oldName]);
        await db.run('UPDATE tasks SET department = ? WHERE department = ?', [newName, oldName]);
        await db.run('UPDATE reports SET department = ? WHERE department = ?', [newName, oldName]);
        await db.run('UPDATE contracts SET department = ? WHERE department = ?', [newName, oldName]);
        await db.run('UPDATE revenue_reports SET department = ? WHERE department = ?', [newName, oldName]);
        await db.run('UPDATE projects SET department = ? WHERE department = ?', [newName, oldName]);
      }
      res.json({ success: true });
    } catch (e: any) {
      if (e.message?.includes('UNIQUE') || e.message?.includes('Duplicate')) return res.status(409).json({ error: 'Tên hoặc mã phòng ban đã tồn tại' });
      res.status(500).json({ error: 'Failed to update department' });
    }
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    try {
      const dept = await db.get('SELECT * FROM departments WHERE id = ?', [req.params.id]);
      if (!dept) return res.status(404).json({ error: 'Not found' });
      const { count } = await db.get('SELECT COUNT(*) as count FROM users WHERE department = ? OR primaryDepartmentId = ?', [dept.name, dept.id]);
      if (count > 0) return res.status(409).json({ error: `Đang có ${count} nhân viên trong phòng ban này` });
      await db.run('DELETE FROM departments WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to delete department' }); }
  });

  return router;
}
