# Knowledge Transfer Package - TranLe Tasks Department System

**Version:** 1.0  
**Date:** 2026-10-09  
**Current Status:** Phase 0 Complete → Ready for Phase 1

---

## 🎯 Quick Start for New Developer/AI

**You are picking up implementation of a 12-phase department system for TranLe Tasks.**

### Current Status
✅ **Phase 0 COMPLETE** (commits: ffeb014, 75ec5e9, 38d62e4)
- Database: 4 new tables + 3 user columns
- RBAC service: 7 methods for authorization
- RBAC middleware: 5 functions for routes
- Tests: 17 new tests, 160 total PASS
- Documentation: Complete conflict resolution

🔄 **Phase 1 NEXT** (4 weeks, not started)
- Backend: Integrate RBAC into 10-15 existing routes
- Frontend: Create useRBAC() hook
- UI: Update 4 pages with department filtering

---

## 📚 Read These Files IN ORDER (2 hours total)

### Step 1: Understand the Project (30 min)

1. **`CLAUDE.md`** (15 min) → Tech stack, conventions, architecture
2. **`KE_HOACH_PHONG_BAN_TRAN_LE.md`** (15 min) → Full 12-phase roadmap

### Step 2: Understand Phase 0 Conflicts (30 min)

3. **`CONFLICT_RESOLUTION_PHASE0.md`** (15 min) → ⚠️ CRITICAL
   - Why departments table already existed
   - Why we use ALTER TABLE not CREATE
   - Backward compatibility strategy

4. **`PHASE_0_COMPLETION_REPORT.md`** (15 min)
   - What was delivered in Phase 0
   - Metrics, test results, deliverables

### Step 3: Understand Decisions (20 min)

5. **`DECISIONS_PHASE0.md`** (20 min)
   - D1: ALTER TABLE vs CREATE TABLE
   - D2: Dual column strategy (users.department + primaryDepartmentId)
   - D3: Numeric management levels (10/20/30/40/99)
   - D4: Admin cannot access business data
   - D5-D8: Other key decisions

### Step 4: Learn Code Patterns (40 min)

6. **`PATTERNS_PHASE1.md`** (20 min)
   - Pattern 1: Apply department scope to GET
   - Pattern 2: Ownership check for PUT/DELETE
   - Pattern 3: Approval authority
   - Pattern 4: Frontend useRBAC hook
   - Pattern 5-6: Component integration

7. **`backend/services/rbacService.ts`** (10 min)
   - Read the actual implementation
   - Understand getAccessibleDepartments()
   - Understand checkApprovalAuthority()

8. **`backend/tests/rbac.test.ts`** (10 min)
   - See test examples
   - Copy these patterns for Phase 1 tests

---

## 🚀 Your Phase 1 Mission

### Week 1-2: Backend (Priority 1)

**Update 10+ routes with RBAC middleware:**

```typescript
// Pattern to follow:
import { requireDepartmentScope, applyDepartmentFilter } from '../middleware/rbac.js';

router.get('/', requireAuth, requireDepartmentScope('task'), async (req, res) => {
  const { condition, params } = await applyDepartmentFilter(req);
  const data = await db.all(`SELECT * FROM tasks WHERE ${condition}`, params);
  res.json(data);
});
```

**Routes to update (in order):**
1. ✅ `tasks.ts` → Department filtering
2. ✅ `contracts.ts` → Department + approval authority
3. ✅ `reports.ts` → Department filtering
4. ✅ `revenue.ts` → Approval checks
5. `clients.ts`, `projects.ts`, `documents.ts`, `notes.ts`, `quotes.ts`, `payments.ts`

**For each route:**
- Add ~5 tests (Employee/Manager/Deputy/Director/Admin)
- Run `cd backend && npm test` → Must PASS
- Commit after each route update

### Week 3: Frontend Hook

**Create:** `frontend/hooks/useRBAC.ts`

```typescript
export function useRBAC() {
  return {
    accessibleDepartments: string[];
    canApprove: (type, amount?) => boolean;
    canEditResource: (resource) => boolean;
    managementLevel: number;
  };
}
```

See full implementation in `PATTERNS_PHASE1.md` Pattern 4.

### Week 4: Frontend Integration

**Update pages:**
- `Tasks.tsx` → Filter by accessibleDepartments
- `Contracts.tsx` → Show/hide approve button
- `Reports.tsx` → Department filtering
- `Dashboard.tsx` → Metrics for accessible departments

**Pattern:**
```typescript
const { accessibleDepartments, canApprove, canEditResource } = useRBAC();

const visibleTasks = tasks.filter(t => 
  accessibleDepartments.includes(t.departmentId) || t.assignedTo === user.id
);
```

---

## ✅ Rules You MUST Follow

### 1. Backward Compatibility
- ❌ NEVER delete old columns (users.department, departments.name)
- ❌ NEVER break existing routes
- ✅ Add new fields as optional/nullable
- ✅ Both old and new columns coexist

### 2. Testing
- ❌ NEVER skip tests
- ✅ Each route update needs ~5 tests
- ✅ Run `npm test` before commit
- ✅ All 160+ tests must PASS

### 3. Code Style
- ✅ Backend imports: `from '../middleware/rbac.js'` (with .js extension)
- ✅ Parameterized queries: `db.all(sql, [param1, param2])`
- ❌ Never concatenate SQL: `db.all('WHERE id = ' + userId)` ← WRONG

### 4. Git
- ✅ Commit after each route update
- ✅ Message format: `feat(phase1): integrate RBAC into tasks route`
- ✅ Add attribution: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## 🧪 Verification Checklist

Before each commit:

```bash
# Backend tests
cd backend && npm test
# Expect: 160+ tests PASS (adds ~5 per route)

# Frontend build
cd frontend && npm run build
# Expect: Build success

# Typecheck
cd backend && npx tsc --noEmit
cd frontend && npx tsc -b
```

---

## 🆘 Common Problems & Solutions

### Problem: Test fails with "Cannot read property 'managementLevel' of undefined"

**Solution:** Mock req.user properly:
```typescript
req.user = {
  id: 'user-123',
  managementLevel: 20,
  primaryDepartmentId: 'dept-ke-toan',
  department: 'Phòng Kế Toán'
};
```

### Problem: Frontend type error "Property 'managementLevel' does not exist"

**Solution:** Update `frontend/types.ts`:
```typescript
export interface User {
  department: string;              // Keep old
  primaryDepartmentId?: string;    // NEW - optional
  managementLevel?: number;        // NEW - optional
}
```

### Problem: Query performance slow

**Solution:** Check indexes exist:
```sql
CREATE INDEX idx_tasks_dept ON tasks(departmentId);
CREATE INDEX idx_users_dept ON users(primaryDepartmentId);
```

---

## 📞 When You're Stuck

1. **Re-read** `CONFLICT_RESOLUTION_PHASE0.md` - many edge cases documented
2. **Check** `backend/tests/rbac.test.ts` - test examples for every scenario
3. **Review** `DECISIONS_PHASE0.md` - understand WHY decisions were made
4. **Ask** the user/maintainer - don't guess architectural decisions

---

## 🎯 Success Criteria for Phase 1

After 4 weeks, you should have:

- [ ] 10-15 backend routes updated with RBAC
- [ ] 50+ new backend tests (total 210+ PASS)
- [ ] `useRBAC()` hook implemented
- [ ] 4 frontend pages updated
- [ ] Frontend build success
- [ ] No breaking changes
- [ ] Documentation updated

**Then commit:**
```bash
git commit -m "feat(phase1): complete RBAC integration

- Update 10 backend routes with department scope
- Add 50 authorization tests (210 total PASS)
- Create useRBAC() hook for frontend
- Update Tasks/Contracts/Reports/Dashboard pages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## 📋 Quick Reference: Management Levels

| Level | Role             | Department Access          | Approval Limit (Contract) |
|-------|------------------|----------------------------|---------------------------|
| 10    | Employee         | Own dept only              | ❌ None                   |
| 20    | Manager          | Own + child depts          | < 500M                    |
| 30    | Deputy Director  | Managed depts only         | < 2B                      |
| 40    | Director         | All departments            | Unlimited                 |
| 99    | Admin            | ❌ No business data access | ❌ Cannot approve         |

---

## 📁 File Structure Reference

```
web-task-tranle-new/
├── CLAUDE.md                           # ← Start here: Project overview
├── KE_HOACH_PHONG_BAN_TRAN_LE.md      # ← Full 12-phase plan
├── CONFLICT_RESOLUTION_PHASE0.md       # ← ⚠️ CRITICAL: Conflicts & fixes
├── PHASE_0_COMPLETION_REPORT.md        # ← Phase 0 deliverables
├── DECISIONS_PHASE0.md                 # ← Why we made these choices
├── PATTERNS_PHASE1.md                  # ← Code patterns to follow
├── Huong_dan.md                        # ← This file (comprehensive guide)
│
├── backend/
│   ├── migrations/006_department_system.sql  # ← ALTER TABLE strategy
│   ├── services/rbacService.ts               # ← Authorization logic
│   ├── middleware/rbac.ts                    # ← Route middleware
│   ├── tests/rbac.test.ts                    # ← Test examples
│   └── routes/
│       ├── tasks.ts                          # ← Update this first
│       ├── contracts.ts                      # ← Then this
│       └── ... (10+ more routes)
│
└── frontend/
    ├── hooks/useRBAC.ts                      # ← CREATE THIS (Week 3)
    ├── pages/
    │   ├── Tasks.tsx                         # ← Update Week 4
    │   ├── Contracts.tsx
    │   └── Reports.tsx
    └── types.ts                              # ← Add optional fields
```

---

## 🎓 Key Lessons from Phase 0

1. **Always check existing schema** before writing migrations
2. **Backward compatibility is critical** - add new, don't replace old
3. **Test everything** - 17 tests caught many edge cases
4. **Document decisions** - future you will thank past you
5. **Idempotent migrations** - INSERT ON DUPLICATE KEY UPDATE pattern
6. **Admin ≠ Business Manager** - clear separation of concerns

---

## 🚀 Your First Step

```bash
# 1. Read the files (2 hours)
# 2. Start with tasks route
cd E:\web-task-tranle-new

# 3. Read current implementation
code backend/routes/tasks.ts

# 4. Read PATTERNS_PHASE1.md Pattern 1
code PATTERNS_PHASE1.md

# 5. Start implementing
# Update tasks.ts following the pattern
# Add 5 tests in backend/tests/tasks.test.ts
# Run: cd backend && npm test
# Commit: git commit -m "feat(phase1): integrate RBAC into tasks route"

# 6. Repeat for 9 more routes
```

---

**Good luck with Phase 1! 🎉**

**Remember:** Read → Understand → Follow Patterns → Test → Commit

**This knowledge package ensures you can continue the work with full context.**

---

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
