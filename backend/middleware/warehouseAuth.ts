import type { Request, Response, NextFunction } from 'express';

// ─── Warehouse authorization (single source of truth) ────────────────────────
//
// Deliberately NOT keyed on managementLevel. That column defaults to 10 and no
// UI or API writes it (verified: no `UPDATE users SET ... managementLevel`
// anywhere in the backend), so a level-based gate would make warehouse access
// assignable only through migration seed — unreachable from Admin Panel.
//
// Access = permission match, exactly like the sidebar `canSeeItem` rule:
//   permission present  → allowed
//   no permission       → 403
// Admin (99) is a system account: it may manage master data but is blocked from
// business reads (same as the rest of the app, where admin_panel grants
// administration but not departmental data).

export const WH_PERMISSIONS = {
  view: 'stock.view',
  receive: 'stock.receive',
  issue: 'stock.issue',
  transfer: 'stock.transfer',
  count: 'stock.count',
  approve: 'stock.approve',
  adjust: 'stock.adjust',
  manage: 'stock.manage',
  reports: 'stock.reports',
  misa: 'misa.reconcile',
} as const;

// Kept in the same order/labels the Admin Panel catalog shows them, so a missing
// entry in RoleManagement.tsx shows up as a mismatch immediately.
export const WAREHOUSE_PERMISSIONS: readonly string[] = [
  WH_PERMISSIONS.view, WH_PERMISSIONS.receive, WH_PERMISSIONS.issue, WH_PERMISSIONS.transfer,
  WH_PERMISSIONS.count, WH_PERMISSIONS.approve, WH_PERMISSIONS.adjust, WH_PERMISSIONS.manage,
  WH_PERMISSIONS.reports, WH_PERMISSIONS.misa,
];

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

// Full management access: Admin (for master data) or holders of the permission.
// Used for master data, approvals, counts, bundles, serial status.
export function canManageWarehouse(req: any, perm = WH_PERMISSIONS.manage): boolean {
  if (isWhAdmin(req)) return true;
  return hasWhPerm(req, perm);
}

// "Quản lý kho" scope: sees every document (not just their own), drawer extras
// (reservations / incoming docs), department dashboard and non-blind counts.
// This is the department-manager role, granted from Admin Panel → Vai trò.
export function managesWarehouse(req: any): boolean {
  return hasWhPerm(req, WH_PERMISSIONS.manage);
}

// Management view (alerts, reports, variances): grants on permission only.
export function requireWarehouseView(perms: string[] = []) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isWhAdmin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (hasWhPerm(req, ...perms)) {
      next();
      return;
    }
    res.status(403).json({ error: 'Forbidden' });
  };
}
