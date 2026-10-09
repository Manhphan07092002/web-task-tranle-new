import type { Database } from '../types/database.js';

export interface DataScopeContext {
  userId: string;
  managementLevel: number;
  primaryDepartmentId: string;
  managedDepartmentIds?: string[]; // For Deputy Directors
  action: 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE' | 'APPROVE';
  resourceType: 'task' | 'contract' | 'project' | 'report' | 'revenue' | 'document' | 'inventory' | 'warehouse_transaction' | 'warehouse';
}

export interface Resource {
  id?: string;
  departmentId: string;
  createdBy: string;
  assignedTo?: string[];
  status?: string;
}

export interface ApprovalAuthority {
  canApprove: boolean;
  maxAmount?: number;
  reason?: string;
}

/**
 * RBAC Service - Management Level & Department Scope Authorization
 *
 * Management Levels:
 * - 10: Employee (OWN, ASSIGNED, RELATED)
 * - 20: Department Manager (DEPARTMENT + children)
 * - 30: Deputy Director (MANAGED_DEPARTMENTS assigned by Director)
 * - 40: Director (COMPANY - all departments)
 * - 99: Admin (SYSTEM - configuration only, no auto-approval)
 */
export class RBACService {
  constructor(private db: Database) {}

  /**
   * Get list of department IDs user can access based on management level
   */
  async getAccessibleDepartments(ctx: DataScopeContext): Promise<string[]> {
    // Director sees everything
    if (ctx.managementLevel >= 40) {
      return ['ALL'];
    }

    // Deputy Director sees assigned departments only
    if (ctx.managementLevel === 30) {
      if (!ctx.managedDepartmentIds || ctx.managedDepartmentIds.length === 0) {
        // Fallback: query from management_scopes table
        const scopes = await this.db.all<{ departmentId: string }>(
          `SELECT departmentId FROM management_scopes WHERE userId = ?`,
          [ctx.userId]
        );
        return scopes.map(s => s.departmentId);
      }
      return ctx.managedDepartmentIds;
    }

    // Department Manager sees own department + children
    if (ctx.managementLevel === 20) {
      return await this.getDepartmentAndChildren(ctx.primaryDepartmentId);
    }

    // Employee sees only their own department
    return ctx.primaryDepartmentId ? [ctx.primaryDepartmentId] : [];
  }

  /**
   * Get department and all its child departments recursively
   */
  async getDepartmentAndChildren(departmentId: string): Promise<string[]> {
    const result: string[] = [departmentId];

    const children = await this.db.all<{ id: string }>(
      `SELECT id FROM departments WHERE parentId = ? AND isActive = 1`,
      [departmentId]
    );

    for (const child of children) {
      const childTree = await this.getDepartmentAndChildren(child.id);
      result.push(...childTree);
    }

    return result;
  }

  /**
   * Check if user can access a specific resource
   */
  async canAccessResource(ctx: DataScopeContext, resource: Resource): Promise<boolean> {
    // Admin cannot access business data (configuration only)
    if (ctx.managementLevel === 99) {
      return false;
    }

    // Director can access everything
    if (ctx.managementLevel >= 40) {
      return true;
    }

    // Employee: OWN or ASSIGNED
    if (ctx.managementLevel === 10) {
      const isOwner = resource.createdBy === ctx.userId;
      const isAssigned = resource.assignedTo?.includes(ctx.userId) ?? false;
      return isOwner || isAssigned;
    }

    // Manager & Deputy Director: check department scope
    const accessibleDepts = await this.getAccessibleDepartments(ctx);
    if (accessibleDepts.includes('ALL')) return true;

    return accessibleDepts.includes(resource.departmentId);
  }

  /**
   * Check approval authority based on management level and amount
   * Based on the approval matrix from system docs
   */
  async checkApprovalAuthority(
    ctx: DataScopeContext,
    resourceType: string,
    amount?: number
  ): Promise<ApprovalAuthority> {
    // Admin cannot approve business operations
    if (ctx.managementLevel === 99) {
      return {
        canApprove: false,
        reason: 'Admin role is for system configuration only'
      };
    }

    // Approval limits by management level (in VND)
    const limits: Record<string, Record<number, number>> = {
      quote: {
        10: 0,              // Employee cannot approve
        20: 500_000_000,    // Manager: < 500M
        30: 2_000_000_000,  // Deputy: < 2B
        40: Infinity,       // Director: unlimited
      },
      contract: {
        10: 0,
        20: 500_000_000,
        30: 2_000_000_000,
        40: Infinity,
      },
      payment: {
        10: 0,              // Employee can only request
        20: 100_000_000,    // Manager: < 100M
        30: 500_000_000,    // Deputy: < 500M
        40: Infinity,       // Director: unlimited
      },
      purchase: {
        10: 0,
        20: 50_000_000,     // Manager: < 50M
        30: 200_000_000,    // Deputy: < 200M
        40: Infinity,
      },
      revenue_report: {
        10: 0,
        20: 1,              // Manager: own department only
        30: 1,              // Deputy: managed departments
        40: 1,              // Director: all
      },
      warehouse: {
        10: 0,              // Employee can only request
        20: 1,              // Manager can approve
        30: 1,              // Deputy can approve
        40: 1,              // Director can approve
      },
    };

    const resourceLimits = limits[resourceType];
    if (!resourceLimits) {
      return {
        canApprove: false,
        reason: `Unknown resource type: ${resourceType}`
      };
    }

    const maxAmount = resourceLimits[ctx.managementLevel] ?? 0;

    if (maxAmount === 0) {
      return {
        canApprove: false,
        maxAmount: 0,
        reason: 'Insufficient management level to approve'
      };
    }

    // For revenue reports, check is binary (can/cannot)
    if (resourceType === 'revenue_report') {
      return { canApprove: maxAmount > 0 };
    }

    // For financial operations, check amount
    if (amount === undefined) {
      return { canApprove: true, maxAmount };
    }

    if (amount <= maxAmount) {
      return { canApprove: true, maxAmount };
    }

    return {
      canApprove: false,
      maxAmount,
      reason: `Amount ${amount.toLocaleString()} exceeds limit ${maxAmount.toLocaleString()}`
    };
  }

  /**
   * Filter SQL query to apply department scope
   * Returns WHERE clause condition and parameters
   */
  async buildDepartmentScopeFilter(
    ctx: DataScopeContext,
    tableAlias = 't'
  ): Promise<{ condition: string; params: any[] }> {
    // Director sees all
    if (ctx.managementLevel >= 40) {
      return { condition: '1=1', params: [] };
    }

    // Admin sees nothing
    if (ctx.managementLevel === 99) {
      return { condition: '0=1', params: [] };
    }

    const accessibleDepts = await this.getAccessibleDepartments(ctx);

    // Employee: own + assigned
    if (ctx.managementLevel === 10) {
      return {
        condition: `(
          ${tableAlias}.createdBy = ? OR
          ${tableAlias}.id IN (
            SELECT resourceId FROM task_assignees WHERE userId = ? AND resourceType = ?
          )
        )`,
        params: [ctx.userId, ctx.userId, ctx.resourceType],
      };
    }

    // Manager/Deputy: department scope
    if (accessibleDepts.length === 0) {
      return { condition: '0=1', params: [] };
    }

    const placeholders = accessibleDepts.map(() => '?').join(',');
    return {
      condition: `${tableAlias}.departmentId IN (${placeholders})`,
      params: accessibleDepts,
    };
  }

  /**
   * Get managed departments for a Deputy Director
   */
  async getManagedDepartments(userId: string): Promise<string[]> {
    const scopes = await this.db.all<{ departmentId: string }>(
      `SELECT departmentId FROM management_scopes WHERE userId = ?`,
      [userId]
    );
    return scopes.map(s => s.departmentId);
  }

  /**
   * Assign a Deputy Director to manage departments
   */
  async assignManagementScope(
    userId: string,
    departmentIds: string[],
    scopeType: 'FULL' | 'READ_ONLY' | 'APPROVAL_ONLY' = 'FULL'
  ): Promise<void> {
    // Verify user is Deputy Director level
    const user = await this.db.get<{ managementLevel: number }>(
      `SELECT managementLevel FROM users WHERE id = ?`,
      [userId]
    );

    if (!user || user.managementLevel !== 30) {
      throw new Error('User must be Deputy Director level to assign management scopes');
    }

    // Remove existing scopes
    await this.db.run(
      `DELETE FROM management_scopes WHERE userId = ?`,
      [userId]
    );

    // Insert new scopes
    for (const deptId of departmentIds) {
      await this.db.run(
        `INSERT INTO management_scopes (id, userId, departmentId, scopeType)
         VALUES (UUID(), ?, ?, ?)`,
        [userId, deptId, scopeType]
      );
    }
  }
}
