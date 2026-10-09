import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface RBACHook {
  accessibleDepartments: string[];
  canApprove: (resourceType: string, amount?: number) => boolean;
  canEditResource: (resource: { createdBy?: string; assignedTo?: string | string[]; departmentId?: string }) => boolean;
  managementLevel: number;
  isManager: boolean;
  isDirector: boolean;
}

const APPROVAL_LIMITS: Record<string, Record<number, number>> = {
  quote: { 20: 500_000_000, 30: 2_000_000_000 },
  contract: { 20: 500_000_000, 30: 2_000_000_000 },
  payment: { 20: 100_000_000, 30: 500_000_000 },
  purchase: { 20: 50_000_000, 30: 200_000_000 },
  warehouse: { 20: 1, 30: 1 },
};

export function useRBAC(): RBACHook {
  const { user } = useAuth();

  const managementLevel = user?.managementLevel ?? 10;

  const accessibleDepartments = useMemo(() => {
    if (!user) return [];
    if (managementLevel >= 40) return ['ALL'];
    if (managementLevel === 99) return [];
    if (managementLevel === 30) return user.managedDepartments || [];
    if (user.primaryDepartmentId) return [user.primaryDepartmentId];
    return [];
  }, [user, managementLevel]);

  const canApprove = (resourceType: string, amount?: number): boolean => {
    if (!user) return false;
    if (managementLevel === 99) return false;
    if (managementLevel >= 40) return true;
    if (resourceType === 'warehouse') return managementLevel >= 20;
    const resourceLimits = APPROVAL_LIMITS[resourceType];
    if (!resourceLimits) return false;
    if (amount === undefined) return managementLevel >= 20;
    const userLimit = resourceLimits[managementLevel];
    return userLimit !== undefined && amount < userLimit;
  };

  const canEditResource = (resource: { createdBy?: string; assignedTo?: string | string[]; departmentId?: string }): boolean => {
    if (!user) return false;
    if (managementLevel === 99) return false;
    if (managementLevel >= 40) return true;
    if (resource.createdBy === user.id) return true;
    const assigned = resource.assignedTo;
    if (Array.isArray(assigned) ? assigned.includes(user.id) : assigned === user.id) return true;
    if (resource.departmentId && accessibleDepartments.includes(resource.departmentId)) return true;
    if (resource.departmentId && accessibleDepartments.includes('ALL')) return true;
    return false;
  };

  return {
    accessibleDepartments,
    canApprove,
    canEditResource,
    managementLevel,
    isManager: managementLevel >= 20 && managementLevel !== 99,
    isDirector: managementLevel >= 40,
  };
}
