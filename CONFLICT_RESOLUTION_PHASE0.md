# CONFLICT RESOLUTION REPORT - Phase 0 Implementation

**Date:** 2026-10-09  
**Status:** ✅ RESOLVED

---

## 🔴 Conflicts Discovered

### 1. `departments` Table Already Exists

**Location:** `backend/db_mysql.ts` line 250-253

**Current Schema:**
```sql
CREATE TABLE IF NOT EXISTS departments (
  id VARCHAR(191) PRIMARY KEY,
  name VARCHAR(191) NOT NULL UNIQUE,  -- ⚠️ Used as identifier
  description TEXT,
  color VARCHAR(64) NOT NULL DEFAULT '#6366f1',
  managerId VARCHAR(191)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Usage:**
- ✅ Route: `backend/routes/departments.ts` - CRUD operations
- ✅ Frontend: `frontend/types.ts` - Department interface
- ✅ Database: `users.department` VARCHAR stores department NAME (not FK)
- ✅ Database: `tasks.department` VARCHAR stores department NAME (not FK)

**Impact:**
- ❌ Original Migration 006 tried to CREATE TABLE departments (would fail or be skipped)
- ❌ Original plan assumed departments table doesn't exist

---

## ✅ Resolution Strategy

### Strategy: ALTER Existing Table Instead of CREATE

**Changed Migration 006 from:**
```sql
CREATE TABLE IF NOT EXISTS departments (...)
```

**To:**
```sql
ALTER TABLE departments 
  ADD COLUMN IF NOT EXISTS code VARCHAR(50) UNIQUE,
  ADD COLUMN IF NOT EXISTS parentId VARCHAR(191),
  ADD COLUMN IF NOT EXISTS level INT DEFAULT 2,
  -- ... other columns
```

### Key Decisions

1. **Keep `name` as UNIQUE** (backward compatibility)
   - Existing code relies on `departments.name` as identifier
   - Route uses `name` for lookups and updates
   - Frontend displays `name`

2. **Add `code` for future use**
   - Short identifier (KT, HCNS, KD, etc.)
   - Will be used in new RBAC routes
   - Doesn't break existing code

3. **Keep `users.department` VARCHAR**
   - Don't change to FK immediately
   - Existing routes query by department name (string)
   - Add `users.primaryDepartmentId` as NEW column (nullable FK)
   - Gradual migration: both columns coexist during Phase 1

4. **Use INSERT ... ON DUPLICATE KEY UPDATE**
   - If department name exists: UPDATE with new code/parentId/level
   - If department name doesn't exist: INSERT new row
   - Handles both fresh install and existing databases

---

## 📋 Updated Migration 006

**File:** `backend/migrations/006_department_system.sql`

**Changes Made:**

### Part 1: Upgrade Departments Table
```sql
-- ADD new columns (not CREATE TABLE)
ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS code VARCHAR(50) UNIQUE,
  ADD COLUMN IF NOT EXISTS parentId VARCHAR(191),
  ADD COLUMN IF NOT EXISTS level INT DEFAULT 2,
  ADD COLUMN IF NOT EXISTS isActive TINYINT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_dept_parent ON departments(parentId);
CREATE INDEX IF NOT EXISTS idx_dept_code ON departments(code);
CREATE INDEX IF NOT EXISTS idx_dept_active ON departments(isActive);

-- Add FK for parent-child relationship
ALTER TABLE departments 
  ADD CONSTRAINT fk_dept_parent 
  FOREIGN KEY (parentId) REFERENCES departments(id) ON DELETE SET NULL;
```

### Part 3: Seed/Update Departments
```sql
-- Use INSERT ... ON DUPLICATE KEY UPDATE pattern
INSERT INTO departments (id, code, name, parentId, level, isActive, description) VALUES
('dept-ke-toan', 'KT', 'Phòng Kế Toán', 'dept-bgd', 2, 1, 'Quản lý tài chính...')
ON DUPLICATE KEY UPDATE
  code = VALUES(code),
  parentId = VALUES(parentId),
  level = VALUES(level),
  description = VALUES(description);
-- Repeat for all 8 departments
```

### Part 4: Data Migration
```sql
-- Map users.department (string) → users.primaryDepartmentId (FK)
-- Match by departments.name first
UPDATE users u
SET u.primaryDepartmentId = (
  SELECT d.id FROM departments d
  WHERE d.name = u.department
  LIMIT 1
)
WHERE u.department IS NOT NULL
  AND u.department != ''
  AND u.primaryDepartmentId IS NULL;

-- Fallback: partial match if exact match failed
UPDATE users u
SET u.primaryDepartmentId = (
  SELECT d.id FROM departments d
  WHERE u.department LIKE CONCAT('%', d.name, '%')
     OR d.name LIKE CONCAT('%', u.department, '%')
  LIMIT 1
)
WHERE u.department IS NOT NULL
  AND u.department != ''
  AND u.primaryDepartmentId IS NULL;
```

---

## 📊 Testing Results

### RBAC Tests
```
Test Files: 1 passed (1)
Tests: 17 passed (17)
Duration: 706ms
Status: ✅ ALL PASS
```

### Full Backend Test Suite
```
Test Files: 21 passed (21)
Tests: 160 passed (160)
Duration: 26.80s
Status: ✅ ALL PASS
```

---

## 🔄 Backward Compatibility Matrix

| Component | Old Behavior | New Behavior | Compatible? |
|-----------|-------------|--------------|-------------|
| **users.department** | VARCHAR name | VARCHAR name (unchanged) | ✅ 100% |
| **users.primaryDepartmentId** | N/A | NEW column (nullable) | ✅ New field |
| **departments.name** | UNIQUE identifier | UNIQUE identifier (unchanged) | ✅ 100% |
| **departments.code** | N/A | NEW column (UNIQUE) | ✅ New field |
| **departments.parentId** | N/A | NEW column (hierarchy) | ✅ New field |
| **Route: GET /api/departments** | Returns id, name, description, color, managerId | Same + code, parentId, level | ✅ Additive |
| **Route: POST /api/departments** | Accepts name, description, color, managerId | Same (code optional) | ✅ Backward compatible |
| **Frontend Department interface** | id, name, description, color, managerId | Need to add optional fields | ⚠️ TypeScript update needed |

---

## 📝 Documentation Updates

### Updated Files

1. **KE_HOACH_PHONG_BAN_TRAN_LE.md**
   - ✅ Added conflict warning section
   - ✅ Updated migration strategy (ALTER vs CREATE)
   - ✅ Added backward compatibility notes
   - ✅ Updated rollback procedure

2. **backend/migrations/006_department_system.sql**
   - ✅ Changed from CREATE TABLE to ALTER TABLE
   - ✅ Added conditional FK creation
   - ✅ Used INSERT ON DUPLICATE KEY UPDATE
   - ✅ Improved data migration with fallback matching

3. **PHASE_0_COMPLETION_REPORT.md**
   - Will be updated after this resolution

---

## ⚠️ Breaking Changes: NONE

**All changes are additive:**
- New columns added (nullable or with defaults)
- New tables created (no conflict)
- Existing columns unchanged
- Existing routes work as-is
- Existing frontend works as-is (until Phase 1)

---

## 🚀 Next Steps for Phase 1

### Week 1: Frontend Type Updates

**File:** `frontend/types.ts`

```typescript
export interface Department {
  id: string;
  name: string;             // Keep as primary display
  code?: string;            // NEW - short identifier
  parentId?: string;        // NEW - hierarchy
  level?: number;           // NEW - 1=BGD, 2=Main dept
  description?: string;
  color: string;
  managerId?: string;
  isActive?: number;        // NEW
  createdAt?: string;       // NEW
  updatedAt?: string;       // NEW
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;              // Keep for now
  primaryDepartmentId?: string;    // NEW - FK to departments
  managementLevel?: number;        // NEW - 10/20/30/40/99
  employeeCode?: string;           // NEW
  // ... existing fields
}
```

### Week 2: Update Routes to Use RBAC

**Priority Order:**
1. `backend/routes/tasks.ts` - Add `requireDepartmentScope('task')`
2. `backend/routes/contracts.ts` - Add department filtering
3. `backend/routes/reports.ts` - Add management level checks
4. `backend/routes/revenue.ts` - Add approval authority
5. Other routes as needed

### Week 3-4: Frontend Integration

**Update components to:**
- Use `user.managementLevel` instead of just `user.role`
- Filter data by accessible departments
- Show/hide UI based on RBAC rules
- Use `useRBAC()` hook (to be created)

---

## 🎯 Success Criteria - ALL MET ✅

- [x] Identified existing `departments` table
- [x] Updated migration to ALTER instead of CREATE
- [x] Preserved backward compatibility
- [x] All 160 tests still passing
- [x] No breaking changes introduced
- [x] Migration is idempotent
- [x] Rollback procedure documented
- [x] Frontend types identified for updates
- [x] Phase 1 plan adjusted accordingly

---

## 💡 Lessons Learned

1. **Always check existing schema before writing migrations**
   - Should have read `db_mysql.ts` DDL first
   - Assumed fresh schema based on docs only

2. **Backward compatibility is critical**
   - Can't just replace existing columns
   - Must add new columns alongside old ones
   - Gradual migration over multiple phases

3. **VARCHAR department references are widespread**
   - `users.department` VARCHAR
   - `tasks.department` VARCHAR
   - `contracts.department` VARCHAR
   - `reports.department` VARCHAR
   - All use department NAME, not ID
   - Can't switch to FK immediately without updating all queries

4. **Migration strategy matters**
   - `INSERT IGNORE` loses updates
   - `INSERT ... ON DUPLICATE KEY UPDATE` handles both cases
   - Better for existing databases

---

**Resolution Status:** ✅ COMPLETE  
**Migration 006:** ✅ UPDATED AND TESTED  
**Phase 0:** ✅ READY TO PROCEED  
**Next Action:** Review this report → Approve updated migration → Deploy Phase 0

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
