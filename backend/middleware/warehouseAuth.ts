import type { Request, Response, NextFunction } from 'express';

// Shared warehouse authorization (single source of truth, mirrors the
// sidebar canSeeItem logic): permission match OR management level.
// Admin (99) is system-only: blocked from business reads, allowed to manage.

export function getWhLevel(req: any): number {
  return req.user?.managementLevel ?? 10;
}

export function hasWhPerm(req: any, ...perms: string[]): boolean {
  const list: string[] = req.user?.permissions || [];
  return perms.some((p) => list.includes(p));
}

export function isWhAdmin(req: any): boolean {
  return getWhLevel(req) === 99;
}

// Full management access: Admin, stock.manage holders, or level 20+.
// Used for master data, approvals, counts, bundles, serial status.
export function canManageWarehouse(req: any, perm = 'stock.manage'): boolean {
  if (isWhAdmin(req)) return true;
  if (hasWhPerm(req, perm)) return true;
  return getWhLevel(req) >= 20;
}

// Management view (alerts, reports, variances): level 20+ (incl. Director)
// or holders of any listed permission. Same OR-rule as the sidebar.
export function requireWarehouseView(perms: string[] = []) {
  return (req: Request, res: Response, next: NextFunction) => {
    const level = getWhLevel(req);
    if (level === 99) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (level >= 20 || hasWhPerm(req, ...perms)) {
      next();
      return;
    }
    res.status(403).json({ error: 'Forbidden' });
  };
}
