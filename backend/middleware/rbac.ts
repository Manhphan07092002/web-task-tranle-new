import type { Request, Response, NextFunction } from 'express';
import { RBACService, type DataScopeContext } from '../services/rbacService.js';

/**
 * Require minimum management level
 * Usage: router.get('/endpoint', requireManagementLevel(20), handler)
 */
export function requireManagementLevel(minLevel: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userLevel = user.managementLevel ?? 10;

    if (userLevel < minLevel) {
      return res.status(403).json({
        error: 'Insufficient management level',
        required: minLevel,
        current: userLevel,
      });
    }

    next();
  };
}

/**
 * Require department scope access for resource
 * Adds req.rbacContext for use in route handlers
 * Usage: router.get('/tasks', requireDepartmentScope('task'), handler)
 */
export function requireDepartmentScope(resourceType: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const db = (req as any).db;

    if (!user || !db) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const rbac = new RBACService(db);

    // Get managed departments for Deputy Directors
    let managedDepartmentIds: string[] = [];
    if (user.managementLevel === 30) {
      managedDepartmentIds = await rbac.getManagedDepartments(user.id);
    }

    const ctx: DataScopeContext = {
      userId: user.id,
      managementLevel: user.managementLevel ?? 10,
      primaryDepartmentId: user.primaryDepartmentId || user.department || '',
      managedDepartmentIds,
      action: req.method === 'GET' ? 'VIEW' : req.method === 'POST' ? 'CREATE' : 'EDIT',
      resourceType: resourceType as any,
    };

    // Attach context to request for handler use
    (req as any).rbacContext = ctx;
    (req as any).rbacService = rbac;

    next();
  };
}

/**
 * Require approval authority for resource type and amount
 * Usage: router.post('/approve', requireApprovalAuthority('contract'), handler)
 */
export function requireApprovalAuthority(resourceType: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const db = (req as any).db;
    const { amount } = req.body;

    if (!user || !db) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const rbac = new RBACService(db);

    const ctx: DataScopeContext = {
      userId: user.id,
      managementLevel: user.managementLevel ?? 10,
      primaryDepartmentId: user.primaryDepartmentId || '',
      action: 'APPROVE',
      resourceType: resourceType as any,
    };

    const authority = await rbac.checkApprovalAuthority(ctx, resourceType, amount);

    if (!authority.canApprove) {
      return res.status(403).json({
        error: 'Insufficient approval authority',
        reason: authority.reason,
        maxAmount: authority.maxAmount,
      });
    }

    // Attach approval context
    (req as any).approvalAuthority = authority;
    (req as any).rbacContext = ctx;
    (req as any).rbacService = rbac;

    next();
  };
}

/**
 * Filter query results by department scope
 * Must be used after requireDepartmentScope
 * Returns WHERE clause and params to apply in SQL query
 */
export async function applyDepartmentFilter(
  req: Request,
  tableAlias = 't'
): Promise<{ condition: string; params: any[] }> {
  const rbacContext = (req as any).rbacContext as DataScopeContext;
  const rbacService = (req as any).rbacService as RBACService;

  if (!rbacContext || !rbacService) {
    throw new Error('requireDepartmentScope middleware must be applied first');
  }

  return rbacService.buildDepartmentScopeFilter(rbacContext, tableAlias);
}

/**
 * Check resource ownership/access before allowing edit/delete
 * Usage: const canAccess = await checkResourceAccess(req, resource);
 */
export async function checkResourceAccess(
  req: Request,
  resource: { id?: string; departmentId: string; createdBy: string; assignedTo?: string[] }
): Promise<boolean> {
  const rbacContext = (req as any).rbacContext as DataScopeContext;
  const rbacService = (req as any).rbacService as RBACService;

  if (!rbacContext || !rbacService) {
    throw new Error('requireDepartmentScope middleware must be applied first');
  }

  return rbacService.canAccessResource(rbacContext, resource);
}
