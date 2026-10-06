import { Router } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { validate } from '../middleware/validate.js';

const DocumentCategorySchema = z.enum(['contracts', 'projects', 'reports', 'others']);
const DocumentCreateSchema = z.object({
  id: z.string().trim().min(1).max(191).optional(),
  name: z.string().trim().min(1).max(500),
  url: z.string().regex(/^\/api\/upload\/files\/[a-f0-9]{24}\.(?:jpg|png|gif|webp|pdf|doc|docx|xls|xlsx)$/i),
  size: z.coerce.number().int().min(0).max(100 * 1024 * 1024).optional(),
  type: z.string().max(191).optional(),
  category: DocumentCategorySchema,
  linkedId: z.string().trim().min(1).max(191).nullable().optional(),
});
const DocumentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  category: DocumentCategorySchema,
  linkedId: z.string().trim().min(1).max(191).nullable().optional(),
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function documentRoutes(db: any) {
  const router = Router();
  const canViewAll = (user: any) => user?.role === 'Admin'
    || user?.permissions?.some((permission: string) => ['admin_panel', 'view_all_reports', 'view_all_tasks'].includes(permission));
  const isDepartmentManager = (user: any) => user?.role === 'Manager'
    || user?.role?.startsWith('Trưởng')
    || user?.role?.includes('Trưởng');

  async function canAccessLinkedEntity(category: string, linkedId: string, user: any): Promise<boolean> {
    if (!linkedId) return true;
    if (canViewAll(user)) return true;
    if (category === 'contracts') {
      const contract = await db.get('SELECT createdBy, department, docAccountantUserId FROM contracts WHERE id = ? AND (isDeleted IS NULL OR isDeleted = 0)', [linkedId]);
      return Boolean(contract && (contract.createdBy === user.id || contract.docAccountantUserId === user.id || contract.department === user.department));
    }
    if (category === 'projects') {
      const project = await db.get('SELECT managerId, department FROM projects WHERE id = ? AND (isDeleted IS NULL OR isDeleted = 0)', [linkedId]);
      return Boolean(project && (project.managerId === user.id || project.department === user.department));
    }
    if (category === 'reports') {
      const report = await db.get('SELECT authorId FROM reports WHERE id = ? AND (isDeleted IS NULL OR isDeleted = 0)', [linkedId]);
      return Boolean(report && report.authorId === user.id);
    }
    return false;
  }

  // GET: Lấy danh sách tài liệu với bộ lọc
  router.get('/', async (req, res) => {
    try {
      const currentUser = req.user;
      if (!currentUser) return res.status(401).json({ error: 'Unauthorized' });

      let query = 'SELECT * FROM documents WHERE (isDeleted IS NULL OR isDeleted = 0)';
      const params: any[] = [];

      if (!canViewAll(currentUser)) {
        const visibleReportsClause = isDepartmentManager(currentUser)
          ? " OR (category = 'reports' AND linkedId IN (SELECT id FROM reports WHERE (isDeleted IS NULL OR isDeleted = 0) AND department = ?))"
          : '';
        query += ` AND (
          createdBy = ?
          OR (category = 'contracts' AND linkedId IN (
            SELECT id FROM contracts WHERE (isDeleted IS NULL OR isDeleted = 0)
              AND (createdBy = ? OR docAccountantUserId = ? OR department = ?)
          ))
          OR (category = 'projects' AND linkedId IN (
            SELECT id FROM projects WHERE (isDeleted IS NULL OR isDeleted = 0) AND department = ?
          ))${visibleReportsClause}
        )`;
        params.push(currentUser.id, currentUser.id, currentUser.id, currentUser.department || '', currentUser.department || '');
        if (isDepartmentManager(currentUser)) params.push(currentUser.department || '');
      } else {
        // Admin/Manager có thể lọc theo bất cứ nhân viên nào
        const filterUser = req.query.createdBy as string | undefined;
        if (filterUser) {
          query += ' AND createdBy = ?';
          params.push(filterUser);
        }
      }

      // Lọc theo Category
      const filterCategory = req.query.category as string | undefined;
      if (filterCategory) {
        query += ' AND category = ?';
        params.push(filterCategory);
      }

      // Lọc theo thực thể liên kết (linkedId)
      const filterLinkedId = req.query.linkedId as string | undefined;
      if (filterLinkedId) {
        query += ' AND linkedId = ?';
        params.push(filterLinkedId);
      }

      // Tìm kiếm theo tên file
      const filterSearch = req.query.search as string | undefined;
      if (filterSearch && filterSearch.trim()) {
        query += ' AND name LIKE ?';
        params.push(`%${filterSearch.trim()}%`);
      }

      query += ' ORDER BY createdAt DESC';

      const documents = await db.all(query, params);
      res.json(documents.map((document: any) => ({
        ...document,
        url: typeof document.url === 'string'
          ? document.url.replace(/^\/uploads\/reports\/([a-f0-9]{24}\.[a-z0-9]+)$/i, '/api/upload/files/$1')
          : document.url,
      })));
    } catch (e: any) {
      res.status(500).json({ error: 'Lỗi server khi tải tài liệu', detail: e.message });
    }
  });

  // POST: Lưu thông tin tài liệu mới tải lên thành công
  router.post('/', validate(DocumentCreateSchema), async (req, res) => {
    try {
      const currentUser = req.user;
      if (!currentUser) return res.status(401).json({ error: 'Unauthorized' });

      const { id, name, url, size, type, category, linkedId } = req.body;

      if (!name || !url || !category) {
        return res.status(400).json({ error: 'Tên, URL và phân loại tài liệu là bắt buộc' });
      }
      if (!['contracts', 'projects', 'reports', 'others'].includes(category)) {
        return res.status(400).json({ error: 'Phân loại tài liệu không hợp lệ' });
      }
      if (category === 'others' && linkedId) return res.status(400).json({ error: 'Tài liệu khác không được gắn với thực thể nghiệp vụ' });
      if (linkedId && !(await canAccessLinkedEntity(category, linkedId, currentUser))) {
        return res.status(403).json({ error: 'Bạn không có quyền gắn tài liệu vào mục này' });
      }
      const uploadMatch = /^\/api\/upload\/files\/([a-f0-9]{24}\.(?:jpg|png|gif|webp|pdf|doc|docx|xls|xlsx))$/.exec(url);
      if (!uploadMatch) return res.status(400).json({ error: 'Invalid uploaded file URL' });
      const uploadedFile = await db.get('SELECT ownerId FROM uploaded_files WHERE filename = ?', [uploadMatch[1]]);
      if (!uploadedFile || uploadedFile.ownerId !== currentUser.id) return res.status(403).json({ error: 'You can only attach files you uploaded' });

      const docId = id || 'doc-' + Math.random().toString(36).substr(2, 9);
      const createdAt = new Date().toISOString();

      await db.run(
        'INSERT INTO documents (id, name, url, size, type, category, linkedId, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [docId, name, url, Number(size) || 0, type || '', category, linkedId || null, currentUser.id, createdAt]
      );
      await db.run(
        'UPDATE uploaded_files SET entityType = ?, entityId = ? WHERE filename = ? AND ownerId = ?',
        [linkedId ? category : null, linkedId || null, uploadMatch[1], currentUser.id],
      );

      // Đồng bộ hóa real-time với bảng contracts nếu tài liệu thuộc hợp đồng
      if (category === 'contracts' && linkedId) {
        const docs = await db.all(
          'SELECT url FROM documents WHERE linkedId = ? AND category = ? AND (isDeleted IS NULL OR isDeleted = 0)',
          [linkedId, 'contracts']
        );
        const urls = docs.map((d: any) => d.url);
        await db.run('UPDATE contracts SET attachments = ? WHERE id = ?', [JSON.stringify(urls), linkedId]);
      }

      // Đồng bộ hóa real-time với bảng reports nếu tài liệu thuộc báo cáo
      if (category === 'reports' && linkedId) {
        const report = await db.get('SELECT content FROM reports WHERE id = ?', [linkedId]);
        if (report && report.content) {
          try {
            const parsed = JSON.parse(report.content);
            const docs = await db.all(
              'SELECT name, url, size, type FROM documents WHERE linkedId = ? AND category = ? AND (isDeleted IS NULL OR isDeleted = 0)',
              [linkedId, 'reports']
            );
            parsed.attachments = docs.map((d: any) => ({
              name: d.name,
              url: d.url,
              size: d.size,
              type: d.type
            }));
            await db.run('UPDATE reports SET content = ? WHERE id = ?', [JSON.stringify(parsed), linkedId]);
          } catch (err) {
            console.error('Lỗi đồng bộ tài liệu đính kèm báo cáo:', err);
          }
        }
      }

      res.status(201).json({ id: docId });
    } catch (e: any) {
      res.status(500).json({ error: 'Lỗi server khi lưu thông tin tài liệu', detail: e.message });
    }
  });

  // PUT: Cập nhật metadata tài liệu (sửa tên, phân loại, liên kết)
  router.put('/:id', validate(DocumentUpdateSchema), async (req, res) => {
    try {
      const currentUser = req.user;
      if (!currentUser) return res.status(401).json({ error: 'Unauthorized' });

      const docId = req.params.id;
      const { name, category, linkedId } = req.body;

      const existingDoc = await db.get('SELECT createdBy, category, linkedId, url FROM documents WHERE id = ? AND (isDeleted IS NULL OR isDeleted = 0)', [docId]);
      if (!existingDoc) {
        return res.status(404).json({ error: 'Tài liệu không tồn tại' });
      }

      // Kiểm tra quyền: Chỉ chủ sở hữu tài liệu hoặc Admin/Manager mới được phép sửa
      const perms = currentUser.permissions || [];
      const isAdmin = canViewAll(currentUser) || isDepartmentManager(currentUser);
      if (existingDoc.createdBy !== currentUser.id && !isAdmin) {
        return res.status(403).json({ error: 'Bạn không có quyền sửa tài liệu này' });
      }
      if ((category !== existingDoc.category || (linkedId || null) !== (existingDoc.linkedId || null)) && !isAdmin) {
        return res.status(403).json({ error: 'Chỉ quản lý được đổi phân loại hoặc mục liên kết của tài liệu' });
      }
      if (!['contracts', 'projects', 'reports', 'others'].includes(category) || (category === 'others' && linkedId)) {
        return res.status(400).json({ error: 'Phân loại/liên kết tài liệu không hợp lệ' });
      }
      if (linkedId && !(await canAccessLinkedEntity(category, linkedId, currentUser))) {
        return res.status(403).json({ error: 'Bạn không có quyền gắn tài liệu vào mục này' });
      }

      await db.run(
        'UPDATE documents SET name = ?, category = ?, linkedId = ?, updatedAt = ? WHERE id = ?',
        [name, category, linkedId || null, new Date().toISOString(), docId]
      );
      const uploadMatch = /^\/api\/upload\/files\/([a-f0-9]{24}\.(?:jpg|png|gif|webp|pdf|doc|docx|xls|xlsx))$/.exec(existingDoc.url || '');
      if (uploadMatch) {
        await db.run(
          'UPDATE uploaded_files SET entityType = ?, entityId = ? WHERE filename = ?',
          [linkedId ? category : null, linkedId || null, uploadMatch[1]],
        );
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Lỗi server khi cập nhật tài liệu', detail: e.message });
    }
  });

  // DELETE: Xóa tài liệu khỏi database và xóa tệp vật lý trên ổ đĩa
  router.delete('/:id', async (req, res) => {
    try {
      const currentUser = req.user;
      if (!currentUser) return res.status(401).json({ error: 'Unauthorized' });

      const docId = req.params.id;

      const doc = await db.get('SELECT * FROM documents WHERE id = ? AND (isDeleted IS NULL OR isDeleted = 0)', [docId]);
      if (!doc) {
        return res.status(404).json({ error: 'Tài liệu không tồn tại' });
      }

      // Kiểm tra quyền: Chỉ chủ sở hữu tài liệu hoặc Admin/Manager mới được phép xóa
      const perms = currentUser.permissions || [];
      const isAdmin = canViewAll(currentUser) || isDepartmentManager(currentUser);
      if (doc.createdBy !== currentUser.id && !isAdmin) {
        return res.status(403).json({ error: 'Bạn không có quyền xóa tài liệu này' });
      }

      // 1. Xóa tệp vật lý vật lý trên đĩa
      if (doc.url) {
        const match = /^\/(?:api\/upload\/files|uploads\/reports)\/([a-f0-9]{24}\.[a-z0-9]+)$/i.exec(doc.url);
        const absolutePath = match ? path.join(__dirname, '../../uploads/reports', match[1]) : null;
        if (absolutePath && fs.existsSync(absolutePath)) {
          try {
            fs.unlinkSync(absolutePath);
          } catch (unlinkErr) {
            console.error('Lỗi khi xóa tệp vật lý khỏi đĩa:', unlinkErr);
          }
        }
        if (match) await db.run('DELETE FROM uploaded_files WHERE filename = ?', [match[1]]);
      }

      // 2. Xóa bản ghi khỏi cơ sở dữ liệu
      await db.run('DELETE FROM documents WHERE id = ?', [docId]);

      // Đồng bộ hóa real-time với bảng contracts nếu tài liệu thuộc hợp đồng
      if (doc.category === 'contracts' && doc.linkedId) {
        const docs = await db.all(
          'SELECT url FROM documents WHERE linkedId = ? AND category = ? AND (isDeleted IS NULL OR isDeleted = 0)',
          [doc.linkedId, 'contracts']
        );
        const urls = docs.map((d: any) => d.url);
        await db.run('UPDATE contracts SET attachments = ? WHERE id = ?', [JSON.stringify(urls), doc.linkedId]);
      }

      // Đồng bộ hóa real-time với bảng reports nếu tài liệu thuộc báo cáo
      if (doc.category === 'reports' && doc.linkedId) {
        const report = await db.get('SELECT content FROM reports WHERE id = ?', [doc.linkedId]);
        if (report && report.content) {
          try {
            const parsed = JSON.parse(report.content);
            const docs = await db.all(
              'SELECT name, url, size, type FROM documents WHERE linkedId = ? AND category = ? AND (isDeleted IS NULL OR isDeleted = 0)',
              [doc.linkedId, 'reports']
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
            await db.run('UPDATE reports SET content = ? WHERE id = ?', [JSON.stringify(parsed), doc.linkedId]);
          } catch (err) {
            console.error('Lỗi đồng bộ tài liệu đính kèm báo cáo khi xóa:', err);
          }
        }
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Lỗi server khi xóa tài liệu', detail: e.message });
    }
  });

  return router;
}
