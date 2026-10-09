# Hướng Dẫn Triển Khai Hệ Thống Phòng Ban - TranLe Tasks

**Version:** 1.0  
**Last Updated:** 2026-10-09  
**Current Phase:** Phase 0 Complete → Ready for Phase 1

---

## 🎯 Mục đích file này

File này hướng dẫn **developer mới** hoặc **AI assistant** tiếp tục triển khai hệ thống phòng ban từ Phase 1 trở đi, dựa trên nền tảng Phase 0 đã hoàn thành.

---

## 📚 BƯỚC 1: Đọc file theo thứ tự

### 1.1. Hiểu context dự án (15 phút)

Đọc **THEO THỨ TỰ** để hiểu dự án:

```
1. CLAUDE.md                          (10 phút)
   → Tech stack, architecture, conventions
   → Database: MySQL 8, users/roles/departments
   → Auth: JWT, RBAC permissions
   
2. KE_HOACH_PHONG_BAN_TRAN_LE.md     (20 phút) 
   → Toàn bộ 12 phase roadmap
   → 9 phòng ban: BGD + 8 phòng chính
   → Management levels: 10/20/30/40/99
   → Approval matrix: quote/contract/payment/purchase
   
3. CONFLICT_RESOLUTION_PHASE0.md      (10 phút)
   → ⚠️ QUAN TRỌNG: Tại sao dùng ALTER TABLE không CREATE
   → departments table ĐÃ TỒN TẠI trước Phase 0
   → Backward compatibility strategy
   → users.department VARCHAR vs primaryDepartmentId FK
```

### 1.2. Hiểu Phase 0 đã làm gì (20 phút)

```
4. PHASE_0_COMPLETION_REPORT.md       (15 phút)
   → Deliverables: 4 bảng mới + 3 cột users
   → RBACService: 7 methods
   → RBAC middleware: 5 functions
   → Tests: 17 new tests, 160 total PASS
   → Metrics: 533 lines production code
   
5. backend/migrations/006_department_system.sql  (10 phút)
   → Part 1: ALTER departments (add code, parentId, level)
   → Part 2: CREATE positions, user_positions, management_scopes
   → Part 3: Seed 9 departments + 18 positions
   → Part 4: Data migration (users.department → primaryDepartmentId)
```

### 1.3. Hiểu RBAC implementation (30 phút)

```
6. backend/services/rbacService.ts    (20 phút)
   → getAccessibleDepartments() - core logic
   → canAccessResource() - ownership check
   → checkApprovalAuthority() - approval matrix
   → buildDepartmentScopeFilter() - SQL WHERE generator
   
7. backend/middleware/rbac.ts         (10 phút)
   → requireManagementLevel(minLevel)
   → requireDepartmentScope(resourceType)
   → requireApprovalAuthority(resourceType)
   → applyDepartmentFilter(req) - helper
   → checkResourceAccess(req, resource) - helper
   
8. backend/tests/rbac.test.ts         (20 phút)
   → 4 tests: Department scope (Employee/Manager/Deputy/Director)
   → 7 tests: Resource access (ownership + department)
   → 6 tests: Approval authority (amount limits)
   → Đây là TEMPLATE cho tests Phase 1
```

**Tổng thời gian đọc:** ~1.5 giờ

---

## 🚀 BƯỚC 2: Nhiệm vụ Phase 1

Phase 1 gồm **4 tuần**, chia làm **3 workstreams song song**:

### Week 1-2: Backend Route Integration (PRIORITY 1)

**Mục tiêu:** Áp dụng RBAC middleware vào 10-15 route hiện có

**Route cần update (theo thứ tự ưu tiên):**

1. ✅ **tasks.ts** (PRIORITY 1)
   - Endpoint: GET/POST/PUT/DELETE `/api/tasks`
   - Apply: `requireDepartmentScope('task')`
   - Logic: Employee xem own+assigned, Manager xem department, Deputy xem managed, Director xem all
   
2. ✅ **contracts.ts** (PRIORITY 2)
   - Endpoint: GET/POST/PUT/DELETE `/api/contracts`
   - Apply: `requireDepartmentScope('contract')` + `requireApprovalAuthority('contract')`
   - Logic: Thêm approval workflow
   
3. ✅ **reports.ts** (PRIORITY 3)
   - Endpoint: GET `/api/reports/*`
   - Apply: Department filtering
   - Logic: Manager xem own dept, Deputy xem managed, Director xem all
   
4. ✅ **revenue.ts** (PRIORITY 4)
   - Endpoint: GET/POST `/api/revenue/*`
   - Apply: Approval authority checks
   
**Thêm 6-10 routes khác:** clients.ts, projects.ts, documents.ts, notes.ts, quotes.ts, payments.ts

### Week 3: Frontend RBAC Hook

**Mục tiêu:** Tạo hook tái sử dụng cho frontend

**File mới:** `frontend/hooks/useRBAC.ts`

**Interface:**
```typescript
function useRBAC() {
  return {
    accessibleDepartments: string[];        // Departments user có quyền xem
    canApprove: (type, amount?) => boolean; // Kiểm tra approval authority
    canEditResource: (resource) => boolean; // Kiểm tra ownership
    managementLevel: number;                // 10/20/30/40/99
  };
}
```

### Week 4: Frontend Integration

**Mục tiêu:** Update các page dùng useRBAC()

**Pages cần update:**
- `Tasks.tsx` - Filter tasks by accessible departments
- `Contracts.tsx` - Show/hide approve button based on authority
- `Reports.tsx` - Filter reports by accessible departments
- `Dashboard.tsx` - Show metrics for accessible departments only

---

## 🛠️ BƯỚC 3: Code Patterns phải follow

### Pattern 1: Apply Department Scope to Route

**File:** `backend/routes/tasks.ts`

**TRƯỚC:**
```typescript
router.get('/', requireAuth, async (req, res) => {
  const tasks = await db.all('SELECT * FROM tasks');
  res.json(tasks);
});
```

**SAU:**
```typescript
import { requireDepartmentScope, applyDepartmentFilter } from '../middleware/rbac.js';

router.get('/', requireAuth, requireDepartmentScope('task'), async (req, res) => {
  try {
    // applyDepartmentFilter tạo WHERE clause dựa trên management level
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
});
```

**Giải thích:**
- `requireDepartmentScope('task')` → gắn `req.rbacContext` với accessible departments
- `applyDepartmentFilter(req)` → tạo `condition` SQL + `params` array
- Employee: `(departmentId = ? OR assignedTo = ?)`
- Manager: `departmentId IN (?, ?, ?)` (own + children)
- Deputy: `departmentId IN (?, ?)` (only managed)
- Director: `1=1` (no filter)

---

### Pattern 2: Add Approval Authority Check

**File:** `backend/routes/contracts.ts`

```typescript
import { requireApprovalAuthority } from '../middleware/rbac.js';

router.post('/:id/approve', 
  requireAuth, 
  requireApprovalAuthority('contract'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { amount } = req.body;
      
      // Middleware đã check authority, proceed với approval
      await db.run(
        'UPDATE contracts SET status = ?, approvedBy = ?, approvedAt = ? WHERE id = ?',
        ['approved', req.user.id, new Date().toISOString(), id]
      );
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error approving contract:', error);
      res.status(500).json({ error: 'Failed to approve contract' });
    }
  }
);
```

**Approval Matrix (đã implement trong middleware):**

| Resource Type | Employee (10) | Manager (20) | Deputy (30) | Director (40) |
|---------------|---------------|--------------|-------------|---------------|
| Quote         | ❌ 0          | ✅ < 500M    | ✅ < 2B     | ✅ Unlimited  |
| Contract      | ❌ 0          | ✅ < 500M    | ✅ < 2B     | ✅ Unlimited  |
| Payment       | ❌ 0          | ✅ < 100M    | ✅ < 500M   | ✅ Unlimited  |
| Purchase      | ❌ 0          | ✅ < 50M     | ✅ < 200M   | ✅ Unlimited  |

---

### Pattern 3: Frontend useRBAC Hook

**File:** `frontend/hooks/useRBAC.ts` (FILE MỚI - chưa tồn tại)

```typescript
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';

interface RBACHook {
  accessibleDepartments: string[];
  canApprove: (resourceType: string, amount?: number) => boolean;
  canEditResource: (resource: any) => boolean;
  managementLevel: number;
}

export function useRBAC(): RBACHook {
  const { user } = useAuth();
  const { departments } = useData();
  
  // Helper: get child departments recursively
  const getChildDepartments = (parentId: string): string[] => {
    const children = departments.filter(d => d.parentId === parentId);
    return children.flatMap(child => [child.id, ...getChildDepartments(child.id)]);
  };
  
  // Core logic: accessible departments based on management level
  const getAccessibleDepartments = (): string[] => {
    if (!user || !user.managementLevel) return [];
    
    // Director: all departments
    if (user.managementLevel === 40) {
      return departments.map(d => d.id);
    }
    
    // Deputy Director: only managed departments
    if (user.managementLevel === 30) {
      return user.managedDepartments || [];
    }
    
    // Manager: own department + children
    if (user.managementLevel === 20) {
      if (!user.primaryDepartmentId) return [];
      const children = getChildDepartments(user.primaryDepartmentId);
      return [user.primaryDepartmentId, ...children];
    }
    
    // Employee: own department only
    return user.primaryDepartmentId ? [user.primaryDepartmentId] : [];
  };
  
  // Approval authority check
  const canApprove = (resourceType: string, amount?: number): boolean => {
    if (!user || !user.managementLevel) return false;
    
    const level = user.managementLevel;
    
    // Admin cannot approve business operations
    if (level === 99) return false;
    
    // Director: unlimited
    if (level === 40) return true;
    
    // No amount specified: check if ANY approval possible
    if (amount === undefined) {
      return level >= 20; // Manager or higher
    }
    
    // Check amount limits
    const limits: Record<string, Record<number, number>> = {
      'quote': { 20: 500_000_000, 30: 2_000_000_000 },
      'contract': { 20: 500_000_000, 30: 2_000_000_000 },
      'payment': { 20: 100_000_000, 30: 500_000_000 },
      'purchase': { 20: 50_000_000, 30: 200_000_000 },
    };
    
    const resourceLimits = limits[resourceType];
    if (!resourceLimits) return false;
    
    const userLimit = resourceLimits[level];
    return userLimit !== undefined && amount < userLimit;
  };
  
  // Resource access check (ownership + department)
  const canEditResource = (resource: any): boolean => {
    if (!user) return false;
    
    // Admin has system access but not business data
    if (user.managementLevel === 99) return false;
    
    // Check ownership
    if (resource.createdBy === user.id || resource.assignedTo === user.id) {
      return true;
    }
    
    // Check department access
    const accessible = getAccessibleDepartments();
    return resource.departmentId && accessible.includes(resource.departmentId);
  };
  
  return {
    accessibleDepartments: getAccessibleDepartments(),
    canApprove,
    canEditResource,
    managementLevel: user?.managementLevel || 10,
  };
}
```

**Usage trong component:**

```typescript
import { useRBAC } from '../hooks/useRBAC';

function TasksPage() {
  const { tasks } = useData();
  const { accessibleDepartments, canEditResource } = useRBAC();
  
  // Filter tasks by accessible departments
  const visibleTasks = tasks.filter(task => 
    accessibleDepartments.includes(task.departmentId) ||
    task.assignedTo === user.id
  );
  
  return (
    <div>
      {visibleTasks.map(task => (
        <TaskCard 
          key={task.id}
          task={task}
          canEdit={canEditResource(task)}
        />
      ))}
    </div>
  );
}
```

---

## 🧪 BƯỚC 4: Testing Checklist

### 4.1. Backend Tests (cho MỖI route update)

**File:** `backend/tests/[route-name].test.ts`

**Template test cases:**

```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers/testApp.js';

describe('Tasks RBAC', () => {
  let app, db;
  let employeeToken, managerToken, deputyToken, directorToken;
  
  beforeEach(async () => {
    ({ app, db } = await createTestApp());
    // Setup test users with different management levels
    employeeToken = await createTestUser(db, { managementLevel: 10 });
    managerToken = await createTestUser(db, { managementLevel: 20 });
    deputyToken = await createTestUser(db, { managementLevel: 30 });
    directorToken = await createTestUser(db, { managementLevel: 40 });
  });
  
  // Department Scope Tests
  test('Employee sees only own + assigned tasks', async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${employeeToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.every(t => 
      t.createdBy === employeeId || t.assignedTo === employeeId
    )).toBe(true);
  });
  
  test('Manager sees department tasks', async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${managerToken}`);
    
    expect(res.status).toBe(200);
    const deptIds = res.body.map(t => t.departmentId);
    expect(deptIds).toContain(managerDeptId);
  });
  
  test('Deputy sees only managed departments', async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${deputyToken}`);
    
    expect(res.status).toBe(200);
    const deptIds = [...new Set(res.body.map(t => t.departmentId))];
    expect(deptIds.every(id => managedDeptIds.includes(id))).toBe(true);
  });
  
  test('Director sees all tasks', async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${directorToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
  
  // Ownership Tests
  test('Employee cannot edit other employee task', async () => {
    const otherTask = await createTask(db, { createdBy: 'other-user-id' });
    
    const res = await request(app)
      .put(`/api/tasks/${otherTask.id}`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ title: 'Updated' });
    
    expect(res.status).toBe(403);
  });
  
  test('Manager can edit department task', async () => {
    const deptTask = await createTask(db, { 
      departmentId: managerDeptId,
      createdBy: 'other-user-id'
    });
    
    const res = await request(app)
      .put(`/api/tasks/${deptTask.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ title: 'Updated by manager' });
    
    expect(res.status).toBe(200);
  });
});
```

**Checklist cho MỖI route:**
- [ ] Employee: own + assigned ✅, others ❌
- [ ] Manager: department ✅, other departments ❌
- [ ] Deputy: managed depts ✅, unmanaged ❌
- [ ] Director: all ✅
- [ ] Ownership: creator ✅, assignee ✅, others ❌

### 4.2. Frontend Tests

**Manual testing checklist:**

```
1. Login as Employee
   - [ ] Chỉ thấy task của mình + task được assign
   - [ ] KHÔNG thấy approve button
   - [ ] KHÔNG thấy edit button trên task người khác
   - [ ] Department dropdown chỉ có phòng mình

2. Login as Manager
   - [ ] Thấy task của cả phòng
   - [ ] Approve button hiện với contract < 500M
   - [ ] KHÔNG thấy approve với contract >= 500M
   - [ ] Edit button hiện trên task trong phòng

3. Login as Deputy Director
   - [ ] CHỈ thấy phòng được giao quản lý
   - [ ] KHÔNG thấy phòng khác
   - [ ] Approve button với contract < 2B
   - [ ] Department dropdown chỉ có các phòng được giao

4. Login as Director
   - [ ] Thấy TẤT CẢ departments
   - [ ] Approve button UNLIMITED
   - [ ] Edit mọi resource

5. Login as Admin
   - [ ] KHÔNG thấy business data (tasks/contracts)
   - [ ] CHỈ thấy admin pages (users/roles/settings)
```

---

## ✅ BƯỚC 5: Verification trước khi commit

### 5.1. Backend Tests

```bash
cd backend
npm test

# Expected output:
# Test Files: 21+ passed
# Tests: 180+ passed (160 old + 20+ new)
# Duration: ~30s
```

**Nếu test fail:**
- Đọc error message kỹ
- Check xem mock `req.user` có đầy đủ `managementLevel`, `primaryDepartmentId` không
- Check xem SQL query có đúng parameterized không (không nối chuỗi)
- Xem test example trong `backend/tests/rbac.test.ts`

### 5.2. Frontend Build

```bash
cd frontend
npm run build

# Expected output:
# vite v6.x.x building for production...
# ✓ built in XXXms
# dist/index.html                   X.XX kB
# dist/assets/index-XXXXX.js       XXX.XX kB
```

**Nếu build fail:**
- Check TypeScript errors
- Xem có import file không tồn tại không
- Xem có type mismatch không (vd: optional field bị treat như required)

### 5.3. Typecheck

```bash
# Backend
cd backend && npx tsc --noEmit

# Frontend  
cd frontend && npx tsc -b
```

### 5.4. Manual Test

```bash
# Start dev server
npm run dev

# Browser: http://localhost:5173
# 1. Login với các role khác nhau
# 2. Kiểm tra tasks/contracts hiển thị đúng
# 3. Kiểm tra approve button show/hide đúng
# 4. Kiểm tra edit button show/hide đúng
```

---

## 🚨 RULES PHẢI TUÂN THỦ

### Rule 1: Backward Compatibility

**KHÔNG ĐƯỢC:**
- ❌ Xoá cột `users.department` (VARCHAR)
- ❌ Xoá cột `departments.name` (UNIQUE)
- ❌ Đổi tên bảng/cột hiện có
- ❌ Break existing routes chưa update RBAC
- ❌ Require `primaryDepartmentId` NOT NULL ngay (vì data cũ có thể null)

**PHẢI:**
- ✅ Thêm cột mới với `nullable` hoặc `DEFAULT`
- ✅ Giữ logic cũ hoạt động song song với logic mới
- ✅ Update từng route một, test kỹ trước khi next
- ✅ Frontend types: add optional fields (`field?: type`)

### Rule 2: Import Convention (Backend)

**Backend dùng ES Modules với Node16 resolution:**

```typescript
// ✅ ĐÚNG - import kèm .js extension
import { requireAuth } from '../middleware/auth.js';
import { RBACService } from '../services/rbacService.js';

// ❌ SAI - thiếu .js extension
import { requireAuth } from '../middleware/auth';
import { RBACService } from '../services/rbacService';
```

### Rule 3: SQL Query

**PHẢI dùng parameterized query:**

```typescript
// ✅ ĐÚNG
const tasks = await db.all(
  'SELECT * FROM tasks WHERE departmentId = ? AND assignedTo = ?',
  [deptId, userId]
);

// ❌ SAI - SQL injection vulnerability
const tasks = await db.all(
  `SELECT * FROM tasks WHERE departmentId = '${deptId}'`
);
```

### Rule 4: Error Handling

```typescript
// ✅ ĐÚNG - có try/catch, trả error message rõ ràng
router.get('/', requireAuth, async (req, res) => {
  try {
    const tasks = await db.all('SELECT * FROM tasks');
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// ❌ SAI - không handle error, crash server
router.get('/', requireAuth, async (req, res) => {
  const tasks = await db.all('SELECT * FROM tasks');
  res.json(tasks);
});
```

### Rule 5: Testing

**Mỗi route update PHẢI có test:**

```typescript
// Minimum test coverage cho 1 route:
// 1. Department scope (4 tests): Employee/Manager/Deputy/Director
// 2. Ownership (2 tests): can edit own, cannot edit others
// 3. Approval (3 tests nếu có approve): authority by amount

// Total: ~5-9 tests per route
```

---

## 🎯 EXPECTED OUTCOME Phase 1

Sau 4 tuần Phase 1, cần có:

### Deliverables

- [ ] **10-15 routes updated** với RBAC middleware
- [ ] **~50 new backend tests** (5 tests × 10 routes)
- [ ] **Total 210+ tests PASS** (160 old + 50 new)
- [ ] **useRBAC() hook** hoàn chỉnh trong frontend
- [ ] **4 pages updated:** Tasks, Contracts, Reports, Dashboard
- [ ] **Frontend build success** không lỗi TypeScript
- [ ] **Documentation updated:** 
  - DECISIONS_PHASE1.md (key decisions)
  - PHASE_1_COMPLETION_REPORT.md (deliverables)

### Git Commit

```bash
git add backend/routes/ backend/tests/ frontend/hooks/ frontend/pages/
git commit -m "feat(phase1): integrate RBAC into routes and frontend

- Update 10 backend routes with RBAC middleware
- Add 50 new authorization tests (total 210 PASS)
- Create useRBAC() hook for frontend
- Update Tasks/Contracts/Reports/Dashboard pages
- Department scope: Employee/Manager/Deputy/Director
- Approval authority: quote/contract/payment/purchase

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## 🆘 Troubleshooting

### Problem 1: Test fail sau khi thêm middleware

**Error:**
```
TypeError: Cannot read property 'managementLevel' of undefined
```

**Solution:**
Mock `req.user` đầy đủ trong test:
```typescript
beforeEach(() => {
  req.user = {
    id: 'user-123',
    role: 'Manager',
    managementLevel: 20,
    primaryDepartmentId: 'dept-ke-toan',
    department: 'Phòng Kế Toán' // Giữ cột cũ cho backward compat
  };
});
```

### Problem 2: Frontend type error với new fields

**Error:**
```
Property 'managementLevel' does not exist on type 'User'
```

**Solution:**
Update `frontend/types.ts`:
```typescript
export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;              // Keep old field
  primaryDepartmentId?: string;    // NEW - optional
  managementLevel?: number;        // NEW - optional
  employeeCode?: string;           // NEW - optional
  managedDepartments?: string[];   // NEW - for Deputy Director
}
```

### Problem 3: Query performance chậm

**Problem:**
Query tasks with department filter mất >1s

**Solution:**
Check indexes đã có:
```sql
-- Đã tạo trong migration 006
CREATE INDEX idx_users_dept ON users(primaryDepartmentId);
CREATE INDEX idx_dept_parent ON departments(parentId);

-- Có thể cần thêm cho tasks
CREATE INDEX idx_tasks_dept ON tasks(departmentId);
CREATE INDEX idx_tasks_assigned ON tasks(assignedTo);
```

### Problem 4: Conflict với existing permission logic

**Problem:**
Code cũ check `user.role === 'Manager'`, code mới check `user.managementLevel >= 20`

**Solution:**
- Phase 1: Giữ BOTH checks song song
- Frontend: `if (user.role === 'Manager' || user.managementLevel >= 20)`
- Phase 2 (sau này): Remove old role check

---

## 📞 Contacts

**Nếu gặp vấn đề không giải quyết được:**

1. Đọc lại `CONFLICT_RESOLUTION_PHASE0.md` - nhiều edge cases đã được document
2. Xem `backend/tests/rbac.test.ts` - test examples cho mọi scenario
3. Check `DECISIONS_PHASE0.md` - rationale của các quyết định kiến trúc
4. Hỏi maintainer dự án

---

## 🎓 Lessons Learned từ Phase 0

### Lesson 1: Always check existing schema first
❌ **Mistake:** Giả định departments table chưa tồn tại  
✅ **Fix:** Đọc `db_mysql.ts` DDL trước khi viết migration  
📝 **Document:** CONFLICT_RESOLUTION_PHASE0.md

### Lesson 2: Backward compatibility is critical
❌ **Mistake:** Muốn đổi `users.department` thành FK ngay  
✅ **Fix:** Thêm `primaryDepartmentId` mới, giữ cột cũ song song  
📝 **Document:** Dual column strategy trong KE_HOACH

### Lesson 3: VARCHAR department references are widespread
❌ **Discovery:** `users.department`, `tasks.department`, `contracts.department` đều dùng name (string)  
✅ **Strategy:** Không thể đổi sang FK một lúc, gradual migration qua 2 phase  
📝 **Impact:** Phase 1 giữ both, Phase 2 deprecate old column

### Lesson 4: INSERT...ON DUPLICATE KEY UPDATE > INSERT IGNORE
❌ **Mistake:** Dùng INSERT IGNORE → skip updates  
✅ **Fix:** Dùng ON DUPLICATE KEY UPDATE → upsert idempotent  
📝 **Benefit:** Migration chạy nhiều lần không lỗi

---

## ✅ Checklist Phase 1 Completion

Trước khi báo Phase 1 hoàn thành, check:

### Code
- [ ] 10+ routes updated với RBAC middleware
- [ ] useRBAC() hook created và tested
- [ ] 4+ frontend pages updated
- [ ] No hardcoded user IDs / department IDs trong code
- [ ] All imports có đuôi `.js` (backend)
- [ ] All queries dùng parameterized (không nối chuỗi SQL)

### Tests
- [ ] 50+ new backend tests added
- [ ] Total 210+ tests PASS
- [ ] No test skipped (`.skip()`)
- [ ] Coverage cho Employee/Manager/Deputy/Director scenarios
- [ ] Coverage cho approval authority matrix
- [ ] Coverage cho ownership checks

### Build & Typecheck
- [ ] `cd backend && npm test` → PASS
- [ ] `cd frontend && npm run build` → Success
- [ ] `cd backend && npx tsc --noEmit` → No errors
- [ ] `cd frontend && npx tsc -b` → No errors

### Documentation
- [ ] DECISIONS_PHASE1.md created với key decisions
- [ ] PHASE_1_COMPLETION_REPORT.md created
- [ ] Huong_dan.md updated nếu có thay đổi flow
- [ ] Comments trong code cho logic phức tạp

### Manual Test
- [ ] Login Employee → chỉ thấy own data ✅
- [ ] Login Manager → thấy department data ✅
- [ ] Login Deputy → chỉ thấy managed departments ✅
- [ ] Login Director → thấy all ✅
- [ ] Approve buttons show/hide đúng ✅
- [ ] Edit buttons show/hide đúng ✅

### Git
- [ ] `git status` → chỉ có intended files
- [ ] No secrets committed (.env, tokens, passwords)
- [ ] Commit message follow convention
- [ ] Attribution line added

---

**Chúc bạn triển khai thành công Phase 1! 🚀**

**Bắt đầu:** Đọc file theo thứ tự → Hiểu RBAC logic → Update tasks.ts đầu tiên → Test → Tiếp tục các route khác

**File này:** Bookmark để reference trong suốt quá trình implement Phase 1-12
