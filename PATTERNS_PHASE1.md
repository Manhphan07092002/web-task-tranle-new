# Phase 1 Implementation Patterns

**Date:** 2026-10-09  
**Phase:** 1 (Route Integration)  
**Purpose:** Code patterns phải follow khi integrate RBAC vào existing routes

---

## Pattern 1: Apply Department Scope to GET Endpoints

**Use Case:** User chỉ xem được data thuộc departments họ có quyền truy cập

**Example Route:** `backend/routes/tasks.ts`

### BEFORE (No RBAC)

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export function taskRoutes(db: any) {
  const router = Router();
  
  // ❌ Everyone sees ALL tasks - security issue
  router.get('/', requireAuth, async (req, res) => {
    try {
      const tasks = await db.all('SELECT * FROM tasks ORDER BY createdAt DESC');
      res.json(tasks);
    } catch (error) {
      console.error('Error fetching tasks:', error);
      res.status(500).json({ error: 'Failed to fetch tasks' });
    }
  });
  
  return router;
}
```

### AFTER (With RBAC)

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireDepartmentScope, applyDepartmentFilter } from '../middleware/rbac.js';

export function taskRoutes(db: any) {
  const router = Router();
  
  // ✅ User sees only tasks in accessible departments
  router.get('/', 
    requireAuth, 
    requireDepartmentScope('task'),
    async (req, res) => {
      try {
        // Get department filter based on user's management level
        const { condition, params } = await applyDepartmentFilter(req);
        
        const tasks = await db.all(
          `SELECT * FROM tasks WHERE ${condition} ORDER BY createdAt DESC`,
          params
        );
        
        res.json(tasks);
      } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({ error: 'Failed to fetch tasks' });
      }
    }
  );
  
  return router;
}
```

### What Happens Behind the Scenes

**`requireDepartmentScope('task')` middleware:**
1. Gets user from `req.user` (set by `requireAuth`)
2. Calls `RBACService.getAccessibleDepartments(user)`
3. Attaches to `req.rbacContext = { accessibleDepartments: [...] }`

**`applyDepartmentFilter(req)` helper:**
1. Reads `req.rbacContext.accessibleDepartments`
2. Generates SQL WHERE clause based on management level:

```typescript
// Employee (level 10): own + assigned only
condition = "(tasks.departmentId = ? OR tasks.createdBy = ? OR tasks.assignedTo = ?)"
params = [userDeptId, userId, userId]

// Manager (level 20): department + children
condition = "tasks.departmentId IN (?, ?, ?)"
params = [deptId1, deptId2, deptId3]  // own + child departments

// Deputy Director (level 30): managed departments only
condition = "tasks.departmentId IN (?, ?)"
params = [managedDept1, managedDept2]

// Director (level 40): all
condition = "1=1"  // No filter
params = []

// Admin (level 99): none
condition = "0=1"  // Block all
params = []
```

### Testing

```typescript
// backend/tests/tasks.test.ts
import { describe, test, expect, beforeEach } from 'vitest';
import request from 'supertest';

describe('Tasks - Department Scope', () => {
  let app, db;
  let employeeToken, managerToken, deputyToken, directorToken;
  let employeeId, managerId, deputyId, directorId;
  let employeeDeptId, managerDeptId, managedDeptId;
  
  beforeEach(async () => {
    // Setup test app and users
  });
  
  test('Employee sees only own + assigned tasks', async () => {
    // Create tasks
    const ownTask = await createTask(db, { 
      createdBy: employeeId,
      departmentId: employeeDeptId 
    });
    const assignedTask = await createTask(db, { 
      assignedTo: employeeId,
      departmentId: 'other-dept'
    });
    const otherTask = await createTask(db, { 
      createdBy: 'other-user',
      departmentId: 'other-dept'
    });
    
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${employeeToken}`);
    
    expect(res.status).toBe(200);
    const taskIds = res.body.map(t => t.id);
    expect(taskIds).toContain(ownTask.id);
    expect(taskIds).toContain(assignedTask.id);
    expect(taskIds).not.toContain(otherTask.id);
  });
  
  test('Manager sees department + child department tasks', async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${managerToken}`);
    
    expect(res.status).toBe(200);
    const deptIds = [...new Set(res.body.map(t => t.departmentId))];
    expect(deptIds).toContain(managerDeptId);
  });
  
  test('Director sees all tasks', async () => {
    const allTasks = await db.all('SELECT id FROM tasks');
    
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${directorToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(allTasks.length);
  });
  
  test('Admin cannot see business data', async () => {
    const adminToken = await createTestUser(db, { managementLevel: 99 });
    
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${adminToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);  // No tasks visible
  });
});
```

---

## Pattern 2: Apply Ownership Check to PUT/DELETE Endpoints

**Use Case:** User chỉ edit/delete được resources họ own hoặc có quyền quản lý

**Example:** `backend/routes/tasks.ts`

### BEFORE (No Ownership Check)

```typescript
// ❌ Anyone can edit any task - security issue
router.put('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { title, description, status } = req.body;
  
  await db.run(
    'UPDATE tasks SET title = ?, description = ?, status = ? WHERE id = ?',
    [title, description, status, id]
  );
  
  res.json({ success: true });
});
```

### AFTER (With Ownership Check)

```typescript
import { checkResourceAccess } from '../middleware/rbac.js';

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, status } = req.body;
    
    // Get the task first
    const task = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Check if user can access this task
    const canAccess = await checkResourceAccess(req, task);
    
    if (!canAccess) {
      return res.status(403).json({ 
        error: 'You do not have permission to edit this task' 
      });
    }
    
    // User has access, proceed with update
    await db.run(
      'UPDATE tasks SET title = ?, description = ?, status = ?, updatedAt = ? WHERE id = ?',
      [title, description, status, new Date().toISOString(), id]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get the task
    const task = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Check ownership - only creator or admin can delete
    if (task.createdBy !== req.user.id && req.user.managementLevel < 40) {
      return res.status(403).json({ 
        error: 'Only task creator or Director can delete tasks' 
      });
    }
    
    await db.run('DELETE FROM tasks WHERE id = ?', [id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});
```

### Testing

```typescript
describe('Tasks - Ownership', () => {
  test('Employee can edit own task', async () => {
    const task = await createTask(db, { createdBy: employeeId });
    
    const res = await request(app)
      .put(`/api/tasks/${task.id}`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ title: 'Updated by owner' });
    
    expect(res.status).toBe(200);
  });
  
  test('Employee can edit assigned task', async () => {
    const task = await createTask(db, { 
      createdBy: 'other-user',
      assignedTo: employeeId 
    });
    
    const res = await request(app)
      .put(`/api/tasks/${task.id}`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ status: 'in-progress' });
    
    expect(res.status).toBe(200);
  });
  
  test('Employee cannot edit other employee task', async () => {
    const task = await createTask(db, { 
      createdBy: 'other-user',
      assignedTo: 'another-user'
    });
    
    const res = await request(app)
      .put(`/api/tasks/${task.id}`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ title: 'Hacked!' });
    
    expect(res.status).toBe(403);
  });
  
  test('Manager can edit department task', async () => {
    const task = await createTask(db, { 
      createdBy: 'other-user',
      departmentId: managerDeptId
    });
    
    const res = await request(app)
      .put(`/api/tasks/${task.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'completed' });
    
    expect(res.status).toBe(200);
  });
  
  test('Employee cannot delete other user task', async () => {
    const task = await createTask(db, { createdBy: 'other-user' });
    
    const res = await request(app)
      .delete(`/api/tasks/${task.id}`)
      .set('Authorization', `Bearer ${employeeToken}`);
    
    expect(res.status).toBe(403);
  });
  
  test('Director can delete any task', async () => {
    const task = await createTask(db, { createdBy: 'other-user' });
    
    const res = await request(app)
      .delete(`/api/tasks/${task.id}`)
      .set('Authorization', `Bearer ${directorToken}`);
    
    expect(res.status).toBe(200);
  });
});
```

---

## Pattern 3: Apply Approval Authority Check

**Use Case:** Approve quotes/contracts/payments based on amount and management level

**Example:** `backend/routes/contracts.ts`

### Implementation

```typescript
import { requireApprovalAuthority } from '../middleware/rbac.js';

router.post('/:id/approve', 
  requireAuth,
  requireApprovalAuthority('contract'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { amount, notes } = req.body;
      
      // Middleware already validated authority, proceed
      await db.run(
        `UPDATE contracts 
         SET status = 'approved', 
             approvedBy = ?, 
             approvedAt = ?,
             approvalNotes = ?
         WHERE id = ?`,
        [req.user.id, new Date().toISOString(), notes, id]
      );
      
      // Send notification
      const contract = await db.get('SELECT * FROM contracts WHERE id = ?', [id]);
      // ... notification logic
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error approving contract:', error);
      res.status(500).json({ error: 'Failed to approve contract' });
    }
  }
);

router.post('/:id/reject', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    // Get contract
    const contract = await db.get('SELECT * FROM contracts WHERE id = ?', [id]);
    
    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }
    
    // Check if user has any approval authority (can reject if can approve)
    const canApprove = await RBACService.checkApprovalAuthority(
      req.user,
      'contract',
      contract.amount
    );
    
    if (!canApprove) {
      return res.status(403).json({ 
        error: 'You do not have authority to reject this contract' 
      });
    }
    
    await db.run(
      `UPDATE contracts 
       SET status = 'rejected', 
           rejectedBy = ?, 
           rejectedAt = ?,
           rejectionReason = ?
       WHERE id = ?`,
      [req.user.id, new Date().toISOString(), reason, id]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error rejecting contract:', error);
    res.status(500).json({ error: 'Failed to reject contract' });
  }
});
```

### Approval Matrix Reference

| Resource Type | Employee (10) | Manager (20) | Deputy (30) | Director (40) |
|---------------|---------------|--------------|-------------|---------------|
| quote         | ❌            | < 500M       | < 2B        | Unlimited     |
| contract      | ❌            | < 500M       | < 2B        | Unlimited     |
| payment       | ❌            | < 100M       | < 500M      | Unlimited     |
| purchase      | ❌            | < 50M        | < 200M      | Unlimited     |

### Testing

```typescript
describe('Contracts - Approval Authority', () => {
  test('Employee cannot approve any contract', async () => {
    const contract = await createContract(db, { amount: 100_000_000 });
    
    const res = await request(app)
      .post(`/api/contracts/${contract.id}/approve`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ notes: 'Approved' });
    
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Insufficient approval authority');
  });
  
  test('Manager can approve contract < 500M', async () => {
    const contract = await createContract(db, { amount: 400_000_000 });
    
    const res = await request(app)
      .post(`/api/contracts/${contract.id}/approve`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ notes: 'Looks good' });
    
    expect(res.status).toBe(200);
  });
  
  test('Manager cannot approve contract >= 500M', async () => {
    const contract = await createContract(db, { amount: 600_000_000 });
    
    const res = await request(app)
      .post(`/api/contracts/${contract.id}/approve`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ notes: 'Approved' });
    
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('exceeds your approval limit');
  });
  
  test('Deputy can approve contract < 2B', async () => {
    const contract = await createContract(db, { amount: 1_500_000_000 });
    
    const res = await request(app)
      .post(`/api/contracts/${contract.id}/approve`)
      .set('Authorization', `Bearer ${deputyToken}`)
      .send({ notes: 'Approved' });
    
    expect(res.status).toBe(200);
  });
  
  test('Deputy cannot approve contract >= 2B', async () => {
    const contract = await createContract(db, { amount: 2_500_000_000 });
    
    const res = await request(app)
      .post(`/api/contracts/${contract.id}/approve`)
      .set('Authorization', `Bearer ${deputyToken}`)
      .send({ notes: 'Approved' });
    
    expect(res.status).toBe(403);
  });
  
  test('Director can approve unlimited amount', async () => {
    const contract = await createContract(db, { amount: 10_000_000_000 });
    
    const res = await request(app)
      .post(`/api/contracts/${contract.id}/approve`)
      .set('Authorization', `Bearer ${directorToken}`)
      .send({ notes: 'Approved by Director' });
    
    expect(res.status).toBe(200);
  });
  
  test('Admin cannot approve business operations', async () => {
    const adminToken = await createTestUser(db, { managementLevel: 99 });
    const contract = await createContract(db, { amount: 100_000_000 });
    
    const res = await request(app)
      .post(`/api/contracts/${contract.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Approved' });
    
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Admin cannot approve');
  });
});
```

---

## Pattern 4: Frontend useRBAC Hook

**File:** `frontend/hooks/useRBAC.ts` (NEW FILE - create this)

### Implementation

```typescript
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';

interface RBACHook {
  accessibleDepartments: string[];
  canApprove: (resourceType: string, amount?: number) => boolean;
  canEditResource: (resource: any) => boolean;
  canDeleteResource: (resource: any) => boolean;
  managementLevel: number;
  isEmployee: boolean;
  isManager: boolean;
  isDeputy: boolean;
  isDirector: boolean;
  isAdmin: boolean;
}

export function useRBAC(): RBACHook {
  const { user } = useAuth();
  const { departments } = useData();
  
  if (!user) {
    return {
      accessibleDepartments: [],
      canApprove: () => false,
      canEditResource: () => false,
      canDeleteResource: () => false,
      managementLevel: 0,
      isEmployee: false,
      isManager: false,
      isDeputy: false,
      isDirector: false,
      isAdmin: false,
    };
  }
  
  const managementLevel = user.managementLevel || 10;
  
  // Helper: get child departments recursively
  const getChildDepartments = (parentId: string): string[] => {
    const children = departments.filter(d => d.parentId === parentId);
    return children.flatMap(child => [child.id, ...getChildDepartments(child.id)]);
  };
  
  // Get accessible departments based on management level
  const getAccessibleDepartments = (): string[] => {
    // Director: all departments
    if (managementLevel === 40) {
      return departments.map(d => d.id);
    }
    
    // Deputy Director: only managed departments
    if (managementLevel === 30) {
      return user.managedDepartments || [];
    }
    
    // Manager: own department + children
    if (managementLevel === 20) {
      if (!user.primaryDepartmentId) return [];
      const children = getChildDepartments(user.primaryDepartmentId);
      return [user.primaryDepartmentId, ...children];
    }
    
    // Employee: own department only
    if (managementLevel === 10) {
      return user.primaryDepartmentId ? [user.primaryDepartmentId] : [];
    }
    
    // Admin: no department access
    return [];
  };
  
  // Check approval authority
  const canApprove = (resourceType: string, amount?: number): boolean => {
    // Admin cannot approve
    if (managementLevel === 99) return false;
    
    // Employee cannot approve
    if (managementLevel === 10) return false;
    
    // Director: unlimited
    if (managementLevel === 40) return true;
    
    // If no amount specified, check if ANY approval possible
    if (amount === undefined) {
      return managementLevel >= 20;
    }
    
    // Check amount limits
    const limits: Record<string, Record<number, number>> = {
      quote: { 20: 500_000_000, 30: 2_000_000_000 },
      contract: { 20: 500_000_000, 30: 2_000_000_000 },
      payment: { 20: 100_000_000, 30: 500_000_000 },
      purchase: { 20: 50_000_000, 30: 200_000_000 },
    };
    
    const resourceLimits = limits[resourceType];
    if (!resourceLimits) return false;
    
    const userLimit = resourceLimits[managementLevel];
    return userLimit !== undefined && amount < userLimit;
  };
  
  // Check if user can edit resource
  const canEditResource = (resource: any): boolean => {
    if (!resource) return false;
    
    // Admin cannot edit business data
    if (managementLevel === 99) return false;
    
    // Check ownership
    if (resource.createdBy === user.id || resource.assignedTo === user.id) {
      return true;
    }
    
    // Check department access
    const accessible = getAccessibleDepartments();
    return resource.departmentId && accessible.includes(resource.departmentId);
  };
  
  // Check if user can delete resource
  const canDeleteResource = (resource: any): boolean => {
    if (!resource) return false;
    
    // Only creator or Director can delete
    if (resource.createdBy === user.id) return true;
    if (managementLevel >= 40) return true;
    
    return false;
  };
  
  return {
    accessibleDepartments: getAccessibleDepartments(),
    canApprove,
    canEditResource,
    canDeleteResource,
    managementLevel,
    isEmployee: managementLevel === 10,
    isManager: managementLevel === 20,
    isDeputy: managementLevel === 30,
    isDirector: managementLevel === 40,
    isAdmin: managementLevel === 99,
  };
}
```

---

## Pattern 5: Frontend Component Integration

**Example:** `frontend/pages/Tasks.tsx`

### BEFORE

```typescript
function Tasks() {
  const { tasks } = useData();
  const { user } = useAuth();
  
  // ❌ No filtering - shows all tasks
  return (
    <div>
      {tasks.map(task => (
        <TaskCard 
          key={task.id} 
          task={task}
          onEdit={() => handleEdit(task)}
          onDelete={() => handleDelete(task)}
        />
      ))}
    </div>
  );
}
```

### AFTER

```typescript
import { useRBAC } from '../hooks/useRBAC';

function Tasks() {
  const { tasks } = useData();
  const { user } = useAuth();
  const { accessibleDepartments, canEditResource, canDeleteResource } = useRBAC();
  
  // ✅ Filter tasks by accessible departments
  const visibleTasks = tasks.filter(task => 
    accessibleDepartments.includes(task.departmentId) ||
    task.createdBy === user.id ||
    task.assignedTo === user.id
  );
  
  return (
    <div>
      {visibleTasks.map(task => (
        <TaskCard 
          key={task.id} 
          task={task}
          canEdit={canEditResource(task)}
          canDelete={canDeleteResource(task)}
          onEdit={() => handleEdit(task)}
          onDelete={() => handleDelete(task)}
        />
      ))}
    </div>
  );
}
```

### TaskCard Component

```typescript
interface TaskCardProps {
  task: Task;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function TaskCard({ task, canEdit, canDelete, onEdit, onDelete }: TaskCardProps) {
  return (
    <div className="task-card">
      <h3>{task.title}</h3>
      <p>{task.description}</p>
      
      <div className="actions">
        {/* ✅ Show edit button only if user has permission */}
        {canEdit && (
          <button onClick={onEdit}>Edit</button>
        )}
        
        {/* ✅ Show delete button only if user has permission */}
        {canDelete && (
          <button onClick={onDelete}>Delete</button>
        )}
      </div>
    </div>
  );
}
```

---

## Pattern 6: Contracts with Approval Button

**Example:** `frontend/pages/Contracts.tsx`

```typescript
import { useRBAC } from '../hooks/useRBAC';

function ContractCard({ contract }: { contract: Contract }) {
  const { canApprove } = useRBAC();
  const [approving, setApproving] = useState(false);
  
  const handleApprove = async () => {
    setApproving(true);
    try {
      await api.post(`/contracts/${contract.id}/approve`, {
        amount: contract.amount,
        notes: 'Approved'
      });
      // Refresh data
    } catch (error) {
      console.error('Approval failed:', error);
    } finally {
      setApproving(false);
    }
  };
  
  // ✅ Check approval authority based on contract amount
  const canApproveThis = canApprove('contract', contract.amount);
  
  return (
    <div className="contract-card">
      <h3>{contract.title}</h3>
      <p>Amount: {formatCurrency(contract.amount)}</p>
      <p>Status: {contract.status}</p>
      
      {/* ✅ Show approve button only if user has authority */}
      {contract.status === 'pending' && canApproveThis && (
        <button 
          onClick={handleApprove}
          disabled={approving}
        >
          {approving ? 'Approving...' : 'Approve Contract'}
        </button>
      )}
      
      {/* ✅ Show message if amount exceeds authority */}
      {contract.status === 'pending' && !canApproveThis && (
        <p className="text-gray-500">
          This contract requires higher approval authority
        </p>
      )}
    </div>
  );
}
```

---

## Summary: Patterns Checklist

When updating a route with RBAC, follow this checklist:

### Backend Route
- [ ] Import RBAC middleware: `import { requireDepartmentScope, applyDepartmentFilter, checkResourceAccess } from '../middleware/rbac.js'`
- [ ] GET endpoints: Add `requireDepartmentScope(resourceType)`
- [ ] GET endpoints: Use `applyDepartmentFilter(req)` in query
- [ ] PUT/DELETE endpoints: Check ownership with `checkResourceAccess(req, resource)`
- [ ] Approval endpoints: Add `requireApprovalAuthority(resourceType)`
- [ ] Error handling: 403 for unauthorized, 404 for not found
- [ ] Parameterized queries: NEVER concatenate SQL strings

### Backend Tests
- [ ] Test Employee: own + assigned ✅, others ❌
- [ ] Test Manager: department ✅, other departments ❌
- [ ] Test Deputy: managed ✅, unmanaged ❌
- [ ] Test Director: all ✅
- [ ] Test Admin: business data ❌
- [ ] Test approval: amount limits by management level
- [ ] Test ownership: edit own ✅, edit others ❌

### Frontend Hook
- [ ] Use `useRBAC()` in component
- [ ] Filter data by `accessibleDepartments`
- [ ] Show/hide buttons based on `canEditResource()`, `canDeleteResource()`
- [ ] Show/hide approve button based on `canApprove(type, amount)`

### Frontend Types
- [ ] Update `frontend/types.ts` with optional new fields:
  - `User.managementLevel?: number`
  - `User.primaryDepartmentId?: string`
  - `Department.code?: string`
  - `Department.parentId?: string`
  - `Department.level?: number`

---

**Next Steps:** Apply these patterns to 10-15 routes trong Phase 1

**Priority Order:**
1. tasks.ts
2. contracts.ts
3. reports.ts
4. revenue.ts
5. clients.ts, projects.ts, documents.ts, notes.ts, quotes.ts, payments.ts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
