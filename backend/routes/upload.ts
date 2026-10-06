import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { fileTypeFromFile } from 'file-type';
import { createRequireAuth } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function canAccessContractUpload(contract: any, user: any): boolean {
  if (!contract || !user) return false;
  const permissions: string[] = user.permissions || [];
  const canViewAll = ['view_all_reports', 'director_feedback', 'admin_panel', 'view_all_tasks']
    .some((permission) => permissions.includes(permission));
  return canViewAll || contract.createdBy === user.id || contract.docAccountantUserId === user.id
    || Boolean(user.department && contract.department === user.department);
}

export async function canAccessUploadedEntity(db: any, stored: any, user: any): Promise<boolean> {
  if (!stored || !user) return false;
  if (stored.ownerId === user.id || user.role === 'Admin' || user.permissions?.includes('admin_panel')) return true;
  if (!stored.entityType || !stored.entityId) return false;

  if (stored.entityType === 'contracts') {
    const contract = await db.get(
      'SELECT createdBy, department, docAccountantUserId FROM contracts WHERE id = ? AND (isDeleted IS NULL OR isDeleted = 0)',
      [stored.entityId],
    );
    return canAccessContractUpload(contract, user);
  }
  if (stored.entityType === 'reports') {
    const report = await db.get('SELECT authorId, department FROM reports WHERE id = ? AND (isDeleted IS NULL OR isDeleted = 0)', [stored.entityId]);
    return report?.authorId === user.id || Boolean(report?.department === user.department && (
      user.role === 'Manager' || user.role?.startsWith('Trưởng')
      || user.permissions?.some((permission: string) => ['view_all_reports', 'director_feedback'].includes(permission))
    ));
  }
  if (stored.entityType === 'projects') {
    const project = await db.get('SELECT managerId, department FROM projects WHERE id = ? AND (isDeleted IS NULL OR isDeleted = 0)', [stored.entityId]);
    return project?.managerId === user.id || project?.department === user.department
      || user.permissions?.some((permission: string) => ['view_all_tasks', 'view_all_reports'].includes(permission));
  }
  return false;
}

const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx']);
const allowedMagic = new Set(['jpg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx']);
const maxFileBytes = 10 * 1024 * 1024;
const maxTotalBytes = 25 * 1024 * 1024;

function safeOriginalName(name: string) {
  const basename = name.split(/[\\/]/).pop() || 'file';
  return Buffer.from(basename, 'latin1').toString('utf8').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'file';
}

export function uploadRoutes(db: any) {
  const router = Router();
  const requireAuth = createRequireAuth(db);

  const uploadsDir = path.join(__dirname, '../../uploads/reports');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = crypto.randomBytes(12).toString('hex');
      cb(null, `${name}${ext}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: maxFileBytes, files: 5, fields: 10, parts: 15 },
    fileFilter: (_req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase();
      if (!allowedExtensions.has(extension)) return cb(new Error('Unsupported file extension'));
      cb(null, true);
    },
  });
  const parseFiles = upload.array('files', 5);

  // Upload multiple files (max 5)
  router.post('/', requireAuth, (req: any, res: any, next: any) => {
    parseFiles(req, res, (error: any) => {
      if (!error) return next();
      const status = error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FILE_COUNT' ? 413 : 400;
      return res.status(status).json({ error: status === 413 ? 'Upload limit exceeded' : 'Unsupported upload' });
    });
  }, async (req: any, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const incomingFiles = req.files as any[];
    const cleanup = async () => Promise.all(incomingFiles.map(file => fs.promises.unlink(file.path).catch(() => {})));
    const entityType = req.body?.entityType;
    const entityId = req.body?.entityId;
    if ((entityType || entityId) && (!['contracts', 'reports', 'projects'].includes(entityType) || typeof entityId !== 'string' || !entityId || entityId.length > 191)) {
      await cleanup();
      return res.status(400).json({ error: 'Invalid upload entity' });
    }
    if (entityType && !(await canAccessUploadedEntity(db, { entityType, entityId }, req.user))) {
      await cleanup();
      return res.status(403).json({ error: 'You cannot upload files to this entity' });
    }
    if (incomingFiles.reduce((total, file) => total + file.size, 0) > maxTotalBytes) {
      await cleanup();
      return res.status(413).json({ error: 'Combined upload size exceeds 25 MB' });
    }
    const accepted: any[] = [];
    try {
      for (const f of incomingFiles) {
        const detected = await fileTypeFromFile(f.path);
        if (!detected || !allowedMagic.has(detected.ext)) {
          await cleanup();
          return res.status(400).json({ error: 'Unsupported or invalid file content' });
        }
        const safeFilename = `${path.parse(f.filename).name}.${detected.ext}`;
        const safePath = path.join(uploadsDir, safeFilename);
        await fs.promises.rename(f.path, safePath);
        f.filename = safeFilename;
        f.path = safePath;
        f.detectedMime = detected.mime;
        f.safeOriginalName = safeOriginalName(f.originalname);
        accepted.push(f);
      }
      for (const f of accepted) {
        await db.run(
          'INSERT INTO uploaded_files (filename, ownerId, originalName, size, mimeType, entityType, entityId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [f.filename, req.user.id, f.safeOriginalName, f.size, f.detectedMime, entityType || null, entityType ? entityId : null, new Date().toISOString()]
        );
      }
    } catch (error) {
      await Promise.all(accepted.map(file => db.run('DELETE FROM uploaded_files WHERE filename = ? AND ownerId = ?', [file.filename, req.user.id]).catch(() => {})));
      await Promise.all([...accepted, ...incomingFiles].map(file => fs.promises.unlink(file.path).catch(() => {})));
      throw error;
    }
    const files = accepted.map((f: any) => ({
      name: f.safeOriginalName,
      url: `/api/upload/files/${encodeURIComponent(f.filename)}`,
      size: f.size,
      type: f.detectedMime,
    }));
    res.json({ files });
  });

  router.get('/files/:filename', requireAuth, async (req: any, res) => {
    const filename = req.params.filename;
    if (!/^[a-f0-9]{24}\.(jpg|png|gif|webp|pdf|doc|docx|xls|xlsx)$/.test(filename)) {
      return res.status(404).json({ error: 'File not found' });
    }
    try {
      const stored = await db.get('SELECT * FROM uploaded_files WHERE filename = ?', [filename]);
      const filePath = path.join(uploadsDir, filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

      const user = req.user;
      const isAdmin = user?.role === 'Admin' || user?.permissions?.includes('admin_panel');
      let authorized = await canAccessUploadedEntity(db, stored, user) || isAdmin;
      let doc = await db.get('SELECT id, createdBy, category, linkedId FROM documents WHERE url = ? AND (isDeleted IS NULL OR isDeleted = 0)', [`/api/upload/files/${encodeURIComponent(filename)}`]);
      if (!doc) {
        // Support pre-migration document rows that still contain the old public URL.
        doc = await db.get('SELECT id, createdBy, category, linkedId FROM documents WHERE url = ? AND (isDeleted IS NULL OR isDeleted = 0)', [`/uploads/reports/${filename}`]);
      }
      if (!authorized && doc?.createdBy === user?.id) authorized = true;
      if (!authorized && doc?.category === 'contracts' && doc.linkedId) {
        const contract = await db.get(
          'SELECT createdBy, department, docAccountantUserId FROM contracts WHERE id = ? AND (isDeleted IS NULL OR isDeleted = 0)',
          [doc.linkedId],
        );
        authorized = canAccessContractUpload(contract, user);
      }
      if (!authorized && doc?.category === 'reports' && doc.linkedId) {
        const report = await db.get('SELECT authorId, department FROM reports WHERE id = ?', [doc.linkedId]);
        authorized = report?.authorId === user?.id
          || (report?.department === user?.department && (
            user?.role === 'Manager'
            || user?.role?.startsWith('Trưởng')
            || user?.permissions?.some((permission: string) => ['view_all_reports', 'director_feedback'].includes(permission))
          ));
      }
      if (!authorized) {
        const legacyContract = await db.get(
          'SELECT createdBy, department, docAccountantUserId FROM contracts WHERE attachments LIKE ? AND (isDeleted IS NULL OR isDeleted = 0)',
          [`%${filename}%`],
        );
        authorized = canAccessContractUpload(legacyContract, user);
      }
      if (!authorized && doc?.category === 'projects' && doc.linkedId) {
        const project = await db.get('SELECT managerId, department FROM projects WHERE id = ?', [doc.linkedId]);
        authorized = project?.managerId === user?.id
          || project?.department === user?.department
          || user?.permissions?.some((permission: string) => ['view_all_tasks', 'view_all_reports'].includes(permission));
      }
      if (!authorized) return res.status(403).json({ error: 'Forbidden' });

      const mimeType = stored?.mimeType || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(stored?.originalName || filename)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.sendFile(filePath);
    } catch {
      res.status(500).json({ error: 'Failed to download file' });
    }
  });

  return router;
}
