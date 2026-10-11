import type { Department, User } from '../types';

// Mirror backend managementLevel (10 NV / 20 TP / 30 P.GĐ / 40 GĐ / 99 Admin).
// Mọi so sánh dùng >= để gap còn mở rộng được.
export const LEVELS = { EMPLOYEE: 10, MANAGER: 20, DEPUTY: 30, DIRECTOR: 40, ADMIN: 99 } as const;

export const levelOf = (user: Pick<User, 'managementLevel'> | null | undefined): number => {
  const n = Number(user?.managementLevel);
  return user?.managementLevel == null || user.managementLevel === '' as unknown as number || !Number.isSafeInteger(n) ? 10 : n;
};

const norm = (s: unknown) => String(s || '').trim().toLowerCase();

function childIds(departments: Department[], parentId: string): string[] {
  const out: string[] = [];
  const queue = departments.filter((d) => (d as any).parentId === parentId).map((d) => d.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    for (const d of departments) if ((d as any).parentId === id) queue.push(d.id);
  }
  return out;
}

/** Tên các phòng user được thấy (để lọc hiển thị; backend mới là nơi enforce). */
export function getAccessibleDeptNames(user: User | null, departments: Department[] = []): string[] {
  if (!user) return [];
  const level = levelOf(user);
  if (level === LEVELS.ADMIN) return [];
  if (level >= LEVELS.DIRECTOR) return departments.map((d) => d.name);
  if (level >= LEVELS.DEPUTY && user.managedDepartments?.length) {
    const byId = new Map(departments.map((d) => [d.id, d.name]));
    const names = user.managedDepartments.map((id) => byId.get(id)).filter(Boolean) as string[];
    if (names.length > 0) return [...new Set(names)];
  }
  const own = departments.find((d) => d.id === user.primaryDepartmentId)
    || departments.find((d) => norm(d.name) === norm(user.department));
  if (!own) return user.department ? [user.department] : [];
  const ids = new Set([own.id, ...childIds(departments, own.id)]);
  return [...new Set(departments.filter((d) => ids.has(d.id)).map((d) => d.name))];
}

type ApprovalResource = 'quote' | 'contract' | 'payment' | 'purchase';

const APPROVAL_LIMITS: Record<ApprovalResource, Partial<Record<number, number>>> = {
  quote: { [LEVELS.MANAGER]: 500_000_000, [LEVELS.DEPUTY]: 2_000_000_000 },
  contract: { [LEVELS.MANAGER]: 500_000_000, [LEVELS.DEPUTY]: 2_000_000_000 },
  payment: { [LEVELS.MANAGER]: 100_000_000, [LEVELS.DEPUTY]: 500_000_000 },
  purchase: { [LEVELS.MANAGER]: 50_000_000, [LEVELS.DEPUTY]: 200_000_000 },
};

/** Frontend chỉ ẩn/hiện nút; backend enforce thật ở API. */
export function canApprove(user: User | null, resourceType: ApprovalResource, amount?: number): boolean {
  if (!user) return false;
  const level = levelOf(user);
  if (level === LEVELS.ADMIN || level < LEVELS.MANAGER) return false;
  if (level >= LEVELS.DIRECTOR) return true;
  if (amount === undefined) return true;
  const limit = APPROVAL_LIMITS[resourceType]?.[level];
  return limit !== undefined && Number(amount) < limit;
}

/** Task có department string + createdBy + assignees (khớp backend). */
export function canEditTask(user: User | null, task: { createdBy?: string; assignees?: string[]; department?: string }, deptNames: string[] = []): boolean {
  if (!user || !task) return false;
  const perms = user.permissions || [];
  if (perms.includes('admin_panel')) return false; // Admin không sửa business data
  if (task.createdBy === user.id || (task.assignees || []).includes(user.id)) return true;
  return levelOf(user) >= LEVELS.MANAGER && !!task.department && deptNames.includes(task.department);
}

export function canDeleteTask(user: User | null, task: { createdBy?: string }): boolean {
  if (!user || !task) return false;
  if (task.createdBy === user.id) return true;
  return levelOf(user) >= LEVELS.DIRECTOR;
}

/** Nút duyệt hợp đồng theo hàng: bypass hệ thống + cùng phòng + trong hạn mức. */
export function canApproveContractValue(
  user: User | null,
  contract: { department?: string; preTaxValue?: number; postTaxValue?: number },
): boolean {
  if (!user) return false;
  const perms = user.permissions || [];
  if (perms.includes('admin_panel') || perms.includes('director_feedback') || user.role === 'Admin' || user.role === 'Director') return true;
  const level = levelOf(user);
  if (level >= LEVELS.DIRECTOR) return true;
  const sameDept = !!user.department && !!contract.department && user.department === contract.department;
  if (!sameDept || level < LEVELS.MANAGER) return false;
  return canApprove(user, 'contract', Number(contract.preTaxValue ?? contract.postTaxValue ?? 0) || 0);
}
