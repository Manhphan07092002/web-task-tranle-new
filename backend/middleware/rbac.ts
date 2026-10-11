import { Request, Response, NextFunction } from 'express';
import { getManagementLevel, MANAGEMENT_LEVELS } from './auth.js';
import {
  resolveUserDepartments,
  buildTaskScopeFilter,
  canAccessTask,
  checkApprovalAuthority,
  type DeptScope,
  type ApprovalResource,
} from '../services/rbacService.js';

declare global {
  namespace Express {
    interface Request {
      rbacContext?: { deptIds: string[]; deptNames: string[] };
    }
  }
}

/** Gắn scope phòng ban vào request (chạy sau requireAuth). */
export function requireDepartmentScope(_resourceType?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const db = (req as any).db;
    if (!db || typeof db.all !== 'function') return res.status(500).json({ error: 'RBAC requires req.db' });
    try {
      const scope: DeptScope = await resolveUserDepartments(db, req.user);
      req.rbacContext = { deptIds: scope.ids, deptNames: scope.names };
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Sinh WHERE tasks từ rbacContext (không query lại DB). NV chỉ own + assigned. */
export function applyTaskScopeFilter(req: Request): { condition: string; params: any[] } {
  const user: any = req.user;
  if (!user) return { condition: '0=1', params: [] };
  if (user.role === 'Admin' || user.permissions?.includes('admin_panel') || user.permissions?.includes('view_all_tasks')) {
    return { condition: '1=1', params: [] };
  }
  const clauses = ['createdBy = ?', 'id IN (SELECT taskId FROM task_assignees WHERE userId = ?)'];
  const params: any[] = [user.id, user.id];
  const names = req.rbacContext?.deptNames ?? [];
  if (names.length > 0 && getManagementLevel(user) >= MANAGEMENT_LEVELS.MANAGER) {
    clauses.unshift(`department IN (${names.map(() => '?').join(', ')})`);
    params.unshift(...names);
  }
  return { condition: `(${clauses.join(' OR ')})`, params };
}

/** Check 1 task cụ thể (truyền assigneeIds nếu đã load từ task_assignees). */
export function checkResourceAccess(req: Request, task: any, assigneeIds: string[] = []): boolean {
  if (!req.user) return false;
  const scope: DeptScope = { ids: req.rbacContext?.deptIds ?? [], names: req.rbacContext?.deptNames ?? [] };
  return canAccessTask(req.user, task, scope, assigneeIds);
}

/** Chặn approve khi vượt hạn mức. Amount đọc từ body.amount (fallback preTaxValue/postTaxValue). */
export function requireApprovalAuthority(resourceType: ApprovalResource) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const raw = req.body?.amount ?? req.body?.preTaxValue ?? req.body?.postTaxValue;
    const amount = raw === undefined ? undefined : Number(raw);
    if (!checkApprovalAuthority(req.user, resourceType, amount)) {
      return res.status(403).json({ error: 'Forbidden: insufficient approval authority' });
    }
    next();
  };
}

// Re-export để route dùng 1 đầu import, và giữ tương thích tên trong PATTERNS.
export { buildTaskScopeFilter, checkApprovalAuthority };
