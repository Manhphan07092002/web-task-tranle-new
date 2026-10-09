import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RBACService } from '../services/rbacService.js';
import type { DataScopeContext } from '../services/rbacService.js';

// Mock database
const createMockDb = () => {
  const departments = new Map([
    ['dept-bgd', { id: 'dept-bgd', code: 'BGD', name: 'Ban Giám Đốc', parentId: null, level: 1 }],
    ['dept-ke-toan', { id: 'dept-ke-toan', code: 'KT', name: 'Phòng Kế Toán', parentId: 'dept-bgd', level: 2 }],
    ['dept-kinh-doanh', { id: 'dept-kinh-doanh', code: 'KD', name: 'Phòng Kinh Doanh', parentId: 'dept-bgd', level: 2 }],
    ['dept-du-an', { id: 'dept-du-an', code: 'DA', name: 'Phòng Dự Án', parentId: 'dept-bgd', level: 2 }],
  ]);

  const managementScopes = new Map([
    ['deputy1-kt', { userId: 'deputy1', departmentId: 'dept-ke-toan', scopeType: 'FULL' }],
    ['deputy1-kd', { userId: 'deputy1', departmentId: 'dept-kinh-doanh', scopeType: 'FULL' }],
  ]);

  return {
    get: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes('SELECT managementLevel FROM users')) {
        const userId = params[0];
        if (userId === 'deputy1') return { managementLevel: 30 };
        return { managementLevel: 10 };
      }
      return undefined;
    }),
    all: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM departments WHERE parentId')) {
        const parentId = params[0];
        return Array.from(departments.values()).filter(d => d.parentId === parentId);
      }
      if (sql.includes('FROM management_scopes')) {
        const userId = params[0];
        return Array.from(managementScopes.values()).filter(s => s.userId === userId);
      }
      return [];
    }),
    run: vi.fn(async () => ({ lastID: 1, changes: 1 })),
  };
};

describe('RBACService - Department Scope', () => {
  let db: any;
  let rbac: RBACService;

  beforeEach(() => {
    db = createMockDb();
    rbac = new RBACService(db);
  });

  describe('getAccessibleDepartments', () => {
    it('Director (level 40) can access all departments', async () => {
      const ctx: DataScopeContext = {
        userId: 'director1',
        managementLevel: 40,
        primaryDepartmentId: 'dept-bgd',
        action: 'VIEW',
        resourceType: 'task',
      };

      const accessible = await rbac.getAccessibleDepartments(ctx);
      expect(accessible).toEqual(['ALL']);
    });

    it('Deputy Director (level 30) can access only managed departments', async () => {
      const ctx: DataScopeContext = {
        userId: 'deputy1',
        managementLevel: 30,
        primaryDepartmentId: 'dept-bgd',
        managedDepartmentIds: ['dept-ke-toan', 'dept-kinh-doanh'],
        action: 'VIEW',
        resourceType: 'task',
      };

      const accessible = await rbac.getAccessibleDepartments(ctx);
      expect(accessible).toEqual(['dept-ke-toan', 'dept-kinh-doanh']);
    });

    it('Department Manager (level 20) can access own department + children', async () => {
      const ctx: DataScopeContext = {
        userId: 'manager1',
        managementLevel: 20,
        primaryDepartmentId: 'dept-bgd',
        action: 'VIEW',
        resourceType: 'task',
      };

      const accessible = await rbac.getAccessibleDepartments(ctx);
      expect(accessible).toContain('dept-bgd');
      expect(accessible).toContain('dept-ke-toan');
      expect(accessible).toContain('dept-kinh-doanh');
    });

    it('Employee (level 10) can access only own department', async () => {
      const ctx: DataScopeContext = {
        userId: 'employee1',
        managementLevel: 10,
        primaryDepartmentId: 'dept-ke-toan',
        action: 'VIEW',
        resourceType: 'task',
      };

      const accessible = await rbac.getAccessibleDepartments(ctx);
      expect(accessible).toEqual(['dept-ke-toan']);
    });
  });

  describe('canAccessResource', () => {
    it('Employee can view own tasks', async () => {
      const ctx: DataScopeContext = {
        userId: 'employee1',
        managementLevel: 10,
        primaryDepartmentId: 'dept-ke-toan',
        action: 'VIEW',
        resourceType: 'task',
      };

      const ownTask = {
        departmentId: 'dept-ke-toan',
        createdBy: 'employee1',
        assignedTo: [],
      };

      const canAccess = await rbac.canAccessResource(ctx, ownTask);
      expect(canAccess).toBe(true);
    });

    it('Employee can view assigned tasks', async () => {
      const ctx: DataScopeContext = {
        userId: 'employee1',
        managementLevel: 10,
        primaryDepartmentId: 'dept-ke-toan',
        action: 'VIEW',
        resourceType: 'task',
      };

      const assignedTask = {
        departmentId: 'dept-ke-toan',
        createdBy: 'manager1',
        assignedTo: ['employee1', 'employee2'],
      };

      const canAccess = await rbac.canAccessResource(ctx, assignedTask);
      expect(canAccess).toBe(true);
    });

    it('Employee cannot view other employee tasks', async () => {
      const ctx: DataScopeContext = {
        userId: 'employee1',
        managementLevel: 10,
        primaryDepartmentId: 'dept-ke-toan',
        action: 'VIEW',
        resourceType: 'task',
      };

      const otherTask = {
        departmentId: 'dept-ke-toan',
        createdBy: 'employee2',
        assignedTo: ['employee3'],
      };

      const canAccess = await rbac.canAccessResource(ctx, otherTask);
      expect(canAccess).toBe(false);
    });

    it('Manager can view all tasks in department', async () => {
      const ctx: DataScopeContext = {
        userId: 'manager1',
        managementLevel: 20,
        primaryDepartmentId: 'dept-bgd',
        action: 'VIEW',
        resourceType: 'task',
      };

      const deptTask = {
        departmentId: 'dept-ke-toan',
        createdBy: 'employee1',
        assignedTo: [],
      };

      const canAccess = await rbac.canAccessResource(ctx, deptTask);
      expect(canAccess).toBe(true);
    });

    it('Deputy Director can view only managed department tasks', async () => {
      const ctx: DataScopeContext = {
        userId: 'deputy1',
        managementLevel: 30,
        primaryDepartmentId: 'dept-bgd',
        managedDepartmentIds: ['dept-ke-toan', 'dept-kinh-doanh'],
        action: 'VIEW',
        resourceType: 'task',
      };

      const managedTask = {
        departmentId: 'dept-ke-toan',
        createdBy: 'employee1',
        assignedTo: [],
      };

      const canAccess = await rbac.canAccessResource(ctx, managedTask);
      expect(canAccess).toBe(true);

      const unmanagedTask = {
        departmentId: 'dept-du-an',
        createdBy: 'employee2',
        assignedTo: [],
      };

      const canAccessUnmanaged = await rbac.canAccessResource(ctx, unmanagedTask);
      expect(canAccessUnmanaged).toBe(false);
    });

    it('Director can view all tasks', async () => {
      const ctx: DataScopeContext = {
        userId: 'director1',
        managementLevel: 40,
        primaryDepartmentId: 'dept-bgd',
        action: 'VIEW',
        resourceType: 'task',
      };

      const anyTask = {
        departmentId: 'dept-du-an',
        createdBy: 'employee1',
        assignedTo: [],
      };

      const canAccess = await rbac.canAccessResource(ctx, anyTask);
      expect(canAccess).toBe(true);
    });

    it('Admin (level 99) cannot access business data', async () => {
      const ctx: DataScopeContext = {
        userId: 'admin1',
        managementLevel: 99,
        primaryDepartmentId: 'dept-bgd',
        action: 'VIEW',
        resourceType: 'task',
      };

      const task = {
        departmentId: 'dept-ke-toan',
        createdBy: 'employee1',
        assignedTo: [],
      };

      const canAccess = await rbac.canAccessResource(ctx, task);
      expect(canAccess).toBe(false);
    });
  });

  describe('checkApprovalAuthority', () => {
    it('Employee cannot approve quotes', async () => {
      const ctx: DataScopeContext = {
        userId: 'employee1',
        managementLevel: 10,
        primaryDepartmentId: 'dept-ke-toan',
        action: 'APPROVE',
        resourceType: 'contract',
      };

      const authority = await rbac.checkApprovalAuthority(ctx, 'quote', 100_000_000);
      expect(authority.canApprove).toBe(false);
      expect(authority.maxAmount).toBe(0);
    });

    it('Manager can approve quotes under 500M', async () => {
      const ctx: DataScopeContext = {
        userId: 'manager1',
        managementLevel: 20,
        primaryDepartmentId: 'dept-ke-toan',
        action: 'APPROVE',
        resourceType: 'contract',
      };

      const authority400M = await rbac.checkApprovalAuthority(ctx, 'quote', 400_000_000);
      expect(authority400M.canApprove).toBe(true);

      const authority600M = await rbac.checkApprovalAuthority(ctx, 'quote', 600_000_000);
      expect(authority600M.canApprove).toBe(false);
      expect(authority600M.reason).toContain('exceeds limit');
    });

    it('Deputy Director can approve quotes under 2B', async () => {
      const ctx: DataScopeContext = {
        userId: 'deputy1',
        managementLevel: 30,
        primaryDepartmentId: 'dept-bgd',
        action: 'APPROVE',
        resourceType: 'contract',
      };

      const authority1B = await rbac.checkApprovalAuthority(ctx, 'quote', 1_000_000_000);
      expect(authority1B.canApprove).toBe(true);

      const authority3B = await rbac.checkApprovalAuthority(ctx, 'quote', 3_000_000_000);
      expect(authority3B.canApprove).toBe(false);
    });

    it('Director can approve unlimited amount', async () => {
      const ctx: DataScopeContext = {
        userId: 'director1',
        managementLevel: 40,
        primaryDepartmentId: 'dept-bgd',
        action: 'APPROVE',
        resourceType: 'contract',
      };

      const authority10B = await rbac.checkApprovalAuthority(ctx, 'quote', 10_000_000_000);
      expect(authority10B.canApprove).toBe(true);
    });

    it('Manager can approve payments under 100M', async () => {
      const ctx: DataScopeContext = {
        userId: 'manager1',
        managementLevel: 20,
        primaryDepartmentId: 'dept-ke-toan',
        action: 'APPROVE',
        resourceType: 'contract',
      };

      const authority50M = await rbac.checkApprovalAuthority(ctx, 'payment', 50_000_000);
      expect(authority50M.canApprove).toBe(true);

      const authority200M = await rbac.checkApprovalAuthority(ctx, 'payment', 200_000_000);
      expect(authority200M.canApprove).toBe(false);
    });

    it('Admin cannot approve business operations', async () => {
      const ctx: DataScopeContext = {
        userId: 'admin1',
        managementLevel: 99,
        primaryDepartmentId: 'dept-bgd',
        action: 'APPROVE',
        resourceType: 'contract',
      };

      const authority = await rbac.checkApprovalAuthority(ctx, 'quote', 100_000_000);
      expect(authority.canApprove).toBe(false);
      expect(authority.reason).toContain('system configuration only');
    });
  });
});
