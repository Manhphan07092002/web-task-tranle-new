import { normalizeManagementLevel, MANAGEMENT_LEVELS } from '../middleware/auth.js';

// ─── RBAC theo thực trạng web ───────────────────────────────────────────────
// Thực tế thay vì lý thuyết trong PLAN/PATTERNS:
// - tasks.department là STRING tên phòng (không có departmentId), assignee nằm
//   ở bảng task_assignees, chủ task ở createdBy.
// - users có dual-column: department (string cũ, luôn có) + primaryDepartmentId
//   (FK mới, có thể NULL với hàng cũ) — resolve ưu tiên FK, fallback tên.
// - management_scopes đang trống (chưa có UI giao) nên Deputy không scope
//   thì fallback phòng mình để không bị mù dữ liệu.
// - Admin (99) không có business scope (D4).

export interface DeptScope {
  ids: string[];
  names: string[];
}

export interface ScopeFilter {
  condition: string;
  params: any[];
}

type Db = { all: (sql: string, params?: any[]) => Promise<any[]> };

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);

export async function getManagedDepartments(db: Db, userId: string): Promise<string[]> {
  try {
    const rows = await db.all('SELECT departmentId FROM management_scopes WHERE userId = ?', [userId]);
    return [...new Set(asArray(rows).map((r: any) => r.departmentId).filter(Boolean))];
  } catch {
    return [];
  }
}

// ─── Warehouse scope (D9): gán tường minh, Director thấy tất cả, Admin rỗng ──

export async function getWarehouseScope(db: Db, user: any): Promise<string[]> {
  const level = normalizeManagementLevel(user?.managementLevel);
  if (level === MANAGEMENT_LEVELS.ADMIN) return [];
  if (level >= MANAGEMENT_LEVELS.DIRECTOR) {
    try {
      return asArray(await db.all('SELECT id FROM warehouses WHERE isActive IS NULL OR isActive = 1')).map((w: any) => w.id).filter(Boolean);
    } catch {
      return [];
    }
  }
  if (!user?.id) return [];
  try {
    const rows = await db.all('SELECT warehouseId FROM user_warehouse_scopes WHERE userId = ?', [user.id]);
    return [...new Set(asArray(rows).map((r: any) => r.warehouseId).filter(Boolean))];
  } catch {
    return [];
  }
}

export async function getDepartmentAndChildren(db: Db, deptId: string): Promise<{ id: string; name: string }[]> {
  const all = asArray(await db.all('SELECT id, name, parentId FROM departments'));
  const byId = new Map(all.map((d: any) => [d.id, d]));
  const root = byId.get(deptId);
  if (!root) return [];
  const out: { id: string; name: string }[] = [{ id: root.id, name: root.name }];
  const childrenOf = (id: string) => all.filter((d: any) => d.parentId === id);
  const queue = childrenOf(root.id);
  while (queue.length > 0) {
    const next = queue.shift()!;
    out.push({ id: next.id, name: next.name });
    queue.push(...childrenOf(next.id));
  }
  return out;
}

function deptByName(all: any[], name: string): any | undefined {
  const norm = String(name || '').trim().toLowerCase();
  if (!norm) return undefined;
  return all.find((d: any) => String(d.name || '').trim().toLowerCase() === norm);
}

/** Phòng ban user được phép truy cập: { ids (FK), names (string để lọc tasks) }. */
export async function resolveUserDepartments(db: Db, user: any): Promise<DeptScope> {
  const level = normalizeManagementLevel(user?.managementLevel);
  if (level === MANAGEMENT_LEVELS.ADMIN) return { ids: [], names: [] };

  const all = asArray(await db.all('SELECT id, name, parentId FROM departments'));
  const uniq = (items: { id: string; name: string }[]) => {
    const ids = [...new Set(items.map((d) => d.id))];
    const names = [...new Set(items.map((d) => d.name).filter(Boolean))];
    return { ids, names };
  };

  if (level >= MANAGEMENT_LEVELS.DIRECTOR) {
    return uniq(all.map((d: any) => ({ id: d.id, name: d.name })));
  }

  if (level >= MANAGEMENT_LEVELS.DEPUTY) {
    const managed = await getManagedDepartments(db, user.id);
    if (managed.length > 0) {
      const byId = new Map(all.map((d: any) => [d.id, d]));
      return uniq(managed.filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id).name })));
    }
    // Chưa giao scope: fallback phòng mình như Manager để không mù dữ liệu.
  }

  if (user?.primaryDepartmentId) {
    const tree = await getDepartmentAndChildren(db, user.primaryDepartmentId);
    if (tree.length > 0) return uniq(tree);
  }
  const own = deptByName(all, user?.department);
  if (own) {
    const tree = await getDepartmentAndChildren(db, own.id);
    return uniq(tree.length > 0 ? tree : [{ id: own.id, name: own.name }]);
  }
  // Hàng legacy không khớp phòng nào: chỉ còn tên string để lọc.
  return user?.department ? { ids: [], names: [user.department] } : { ids: [], names: [] };
}

/** Alias đúng tên trong PLAN_TRIEN_KHAI_V7 (chỉ lấy ids). */
export async function getAccessibleDepartments(db: Db, user: any): Promise<string[]> {
  return (await resolveUserDepartments(db, user)).ids;
}

const canSeeAllTasks = (user: any) =>
  user?.role === 'Admin' ||
  user?.permissions?.includes('admin_panel') ||
  user?.permissions?.includes('view_all_tasks');

/**
 * WHERE cho bảng tasks (department string + createdBy + task_assignees).
 * Không đụng logic cũ: ai có view_all_tasks/admin vẫn 1=1.
 * NV (level < 20) chỉ own + assigned (đúng prod hiện tại + Pattern 1);
 * TP trở lên thêm department IN (phòng + con).
 */
export async function buildTaskScopeFilter(db: Db, user: any): Promise<ScopeFilter> {
  if (!user) return { condition: '0=1', params: [] };
  if (canSeeAllTasks(user)) return { condition: '1=1', params: [] };
  const clauses: string[] = ['createdBy = ?', 'id IN (SELECT taskId FROM task_assignees WHERE userId = ?)'];
  const params: any[] = [user.id, user.id];
  if (normalizeManagementLevel(user?.managementLevel) >= MANAGEMENT_LEVELS.MANAGER) {
    const scope = await resolveUserDepartments(db, user);
    if (scope.names.length > 0) {
      clauses.unshift(`department IN (${scope.names.map(() => '?').join(', ')})`);
      params.unshift(...scope.names);
    }
  }
  return { condition: `(${clauses.join(' OR ')})`, params };
}

/** Ownership + phòng ban cho 1 task (assigneeIds lấy từ task_assignees khi cần). */
export function canAccessTask(user: any, task: any, scope: DeptScope, assigneeIds: string[] = []): boolean {
  if (!user || !task) return false;
  if (canSeeAllTasks(user)) return true;
  if (task.createdBy && task.createdBy === user.id) return true;
  if (assigneeIds.includes(user.id)) return true;
  if (task.department && scope.names.includes(task.department)) {
    const level = normalizeManagementLevel(user?.managementLevel);
    if (level >= MANAGEMENT_LEVELS.MANAGER) return true;
  }
  return false;
}

// ─── Thẩm quyền phê duyệt (ma trận PLAN V7) ─────────────────────────────────

export type ApprovalResource = 'quote' | 'contract' | 'payment' | 'purchase';

const APPROVAL_LIMITS: Record<ApprovalResource, Partial<Record<number, number>>> = {
  quote: { [MANAGEMENT_LEVELS.MANAGER]: 500_000_000, [MANAGEMENT_LEVELS.DEPUTY]: 2_000_000_000 },
  contract: { [MANAGEMENT_LEVELS.MANAGER]: 500_000_000, [MANAGEMENT_LEVELS.DEPUTY]: 2_000_000_000 },
  payment: { [MANAGEMENT_LEVELS.MANAGER]: 100_000_000, [MANAGEMENT_LEVELS.DEPUTY]: 500_000_000 },
  purchase: { [MANAGEMENT_LEVELS.MANAGER]: 50_000_000, [MANAGEMENT_LEVELS.DEPUTY]: 200_000_000 },
};

export function checkApprovalAuthority(user: any, resourceType: ApprovalResource, amount?: number): boolean {
  const level = normalizeManagementLevel(user?.managementLevel);
  if (level === MANAGEMENT_LEVELS.ADMIN || level < MANAGEMENT_LEVELS.MANAGER) return false;
  if (level >= MANAGEMENT_LEVELS.DIRECTOR) return true;
  if (amount === undefined) return true;
  const limit = APPROVAL_LIMITS[resourceType]?.[level];
  return limit !== undefined && Number(amount) < limit;
}
