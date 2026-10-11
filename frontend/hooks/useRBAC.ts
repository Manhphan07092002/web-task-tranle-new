import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import {
  LEVELS,
  levelOf,
  getAccessibleDeptNames,
  canApprove as canApprovePure,
  canEditTask as canEditTaskPure,
  canDeleteTask as canDeleteTaskPure,
} from '../utils/rbac';

// Hook RBAC cho frontend (theo PATTERNS_PHASE1 Pattern 4).
// Chỉ lọc hiển thị + ẩn/hiện nút — backend enforce thật ở API.
export function useRBAC() {
  const { user } = useAuth();
  const { departments } = useData();

  return useMemo(() => {
    const managementLevel = user ? levelOf(user) : 0;
    const accessibleDepartments = user ? getAccessibleDeptNames(user, departments || []) : [];
    return {
      accessibleDepartments,
      managementLevel,
      isEmployee: managementLevel === LEVELS.EMPLOYEE,
      isManager: managementLevel === LEVELS.MANAGER,
      isDeputy: managementLevel === LEVELS.DEPUTY,
      isDirector: managementLevel === LEVELS.DIRECTOR,
      isAdmin: managementLevel === LEVELS.ADMIN,
      canApprove: (resourceType: 'quote' | 'contract' | 'payment' | 'purchase', amount?: number) =>
        canApprovePure(user, resourceType, amount),
      canEditResource: (resource: { createdBy?: string; assignees?: string[]; department?: string }) =>
        canEditTaskPure(user, resource, accessibleDepartments),
      canDeleteResource: (resource: { createdBy?: string }) => canDeleteTaskPure(user, resource),
    };
  }, [user, departments]);
}
