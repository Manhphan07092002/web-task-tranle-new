# KẾ HOẠCH TRIỂN KHAI HỆ THỐNG PHÒNG BAN - TRAN LE TASKS

**Ngày:** 2026-10-09  
**Phiên bản:** v1.0  
**Dựa trên:** Phân tích `new-base/` và `tranle_system_docs_full_v8`

---

## 📋 TÓM TẮT PHÂN TÍCH

### Từ Screenshots (new-base/*.png)

Đã phân tích 20 screenshots bao gồm:
- **Tổng quan phòng ban** - Sơ đồ tổ chức 8 phòng ban
- **Admin** - 8 chức năng quản trị hệ thống
- **Giám đốc / Phó Giám đốc** - Dashboard điều hành
- **9 vai trò nhân viên** - Giao diện theo phòng ban
- **9 vai trò trưởng phòng** - Quản lý & phê duyệt

### Từ Documentation (tranle_system_docs/)

Đã đọc 44 files tài liệu kỹ thuật:
- Kiến trúc platform tổng thể
- Ma trận quyền 4 cấp quản lý
- 8 phòng ban với quy trình riêng
- Roadmap 12 phases
- Migration plan từ hệ thống cũ

---

## 🏢 CẤU TRÚC TỔ CHỨC TRAN LE

### 1. Cấp Quản Lý (Management Levels)

| Code | Cấp | Vai trò | Data Scope |
|------|-----|---------|------------|
| **10** | **Employee** | Nhân viên | OWN, ASSIGNED, RELATED |
| **20** | **Department Manager** | Trưởng phòng | DEPARTMENT (bao gồm phòng con) |
| **30** | **Deputy Director** | Phó Giám đốc | MANAGED_DEPARTMENTS (các phòng được giao) |
| **40** | **Director** | Giám đốc | COMPANY (toàn công ty) |
| **SYS** | **Admin** | Quản trị hệ thống | Cấu hình, không tự động duyệt nghiệp vụ |

### 2. 8 Phòng Ban Chính

```
Ban Giám Đốc
    ↓
├── Phòng Kế Toán
├── Phòng Hành Chính - Nhân Sự (HCNS)
├── Phòng Kinh Doanh
├── Phòng Dự Án
├── Phòng Kỹ Thuật - Bảo Hành
├── Phòng Marketing
├── Kho Vận
└── Mua Hàng
```

### 3. Luồng Nghiệp Vụ Xương Sống

```
Marketing/Sales → Lead → Opportunity → Yêu cầu kỹ thuật → Khảo sát
    ↓
Giải pháp + BOM → Báo giá → Hợp đồng → Dự án
    ↓
Yêu cầu vật tư → Kho/Mua hàng → Thi công → Nghiệm thu
    ↓
Bàn giao → Thanh toán → Công nợ → Bảo hành/O&M
```

---

## 🎯 KẾ HOẠCH TRIỂN KHAI

### PHASE 0: Chuẩn Bị Nền Tảng (2-3 tuần)

**Mục tiêu:** Quyết định kiến trúc, migration plan, test infrastructure

#### 0.1 Database Schema Upgrade

**Tạo Migration 006: Department Hierarchy & Management Levels**

```sql
-- Bảng departments: cấu trúc cây
CREATE TABLE IF NOT EXISTS departments (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  parentId VARCHAR(36),
  level INT NOT NULL, -- 1=BGD, 2=Phòng chính, 3=Bộ phận con
  managerId VARCHAR(36),
  description TEXT,
  isActive TINYINT DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (parentId) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (managerId) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_dept_parent (parentId),
  INDEX idx_dept_code (code),
  INDEX idx_dept_active (isActive)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bảng positions: chức vụ với management level
CREATE TABLE IF NOT EXISTS positions (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  departmentId VARCHAR(36),
  managementLevel INT NOT NULL, -- 10, 20, 30, 40
  description TEXT,
  isActive TINYINT DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE CASCADE,
  INDEX idx_pos_dept (departmentId),
  INDEX idx_pos_level (managementLevel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bảng user_positions: người dùng có thể có nhiều chức vụ
CREATE TABLE IF NOT EXISTS user_positions (
  id VARCHAR(36) PRIMARY KEY,
  userId VARCHAR(36) NOT NULL,
  positionId VARCHAR(36) NOT NULL,
  isPrimary TINYINT DEFAULT 0,
  startDate DATE,
  endDate DATE,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (positionId) REFERENCES positions(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_position (userId, positionId),
  INDEX idx_up_user (userId),
  INDEX idx_up_position (positionId),
  INDEX idx_up_primary (isPrimary)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bảng management_scopes: Phó GĐ được giao quản lý phòng nào
CREATE TABLE IF NOT EXISTS management_scopes (
  id VARCHAR(36) PRIMARY KEY,
  userId VARCHAR(36) NOT NULL,
  departmentId VARCHAR(36) NOT NULL,
  scopeType VARCHAR(50) NOT NULL, -- FULL, READ_ONLY, APPROVAL_ONLY
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_dept_scope (userId, departmentId),
  INDEX idx_ms_user (userId),
  INDEX idx_ms_dept (departmentId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Thêm cột mới vào bảng users
ALTER TABLE users 
  ADD COLUMN managementLevel INT DEFAULT 10,
  ADD COLUMN primaryDepartmentId VARCHAR(36),
  ADD COLUMN employeeCode VARCHAR(50),
  ADD INDEX idx_users_management_level (managementLevel),
  ADD INDEX idx_users_dept (primaryDepartmentId),
  ADD CONSTRAINT fk_users_dept FOREIGN KEY (primaryDepartmentId) 
    REFERENCES departments(id) ON DELETE SET NULL;
```

**Migration Strategy:**
1. Chạy schema mới
2. Seed 8 departments chính từ docs
3. Map users hiện tại vào departments (dựa vào `users.department` cũ)
4. Set `managementLevel` dựa vào role hiện tại
5. Giữ nguyên bảng `roles` để backward compatibility

#### 0.2 Seed Departments Chuẩn

**File:** `backend/seeds/departments_seed.sql`

```sql
-- Ban Giám Đốc (root)
INSERT INTO departments (id, code, name, level, isActive) VALUES
('dept-bgd', 'BGD', 'Ban Giám Đốc', 1, 1);

-- 8 phòng ban chính
INSERT INTO departments (id, code, name, parentId, level, isActive) VALUES
('dept-ke-toan', 'KT', 'Phòng Kế Toán', 'dept-bgd', 2, 1),
('dept-hcns', 'HCNS', 'Phòng Hành Chính - Nhân Sự', 'dept-bgd', 2, 1),
('dept-kinh-doanh', 'KD', 'Phòng Kinh Doanh', 'dept-bgd', 2, 1),
('dept-du-an', 'DA', 'Phòng Dự Án', 'dept-bgd', 2, 1),
('dept-ky-thuat', 'KT-BH', 'Phòng Kỹ Thuật - Bảo Hành', 'dept-bgd', 2, 1),
('dept-marketing', 'MKT', 'Phòng Marketing', 'dept-bgd', 2, 1),
('dept-kho', 'KHO', 'Kho Vận', 'dept-bgd', 2, 1),
('dept-mua-hang', 'MH', 'Mua Hàng', 'dept-bgd', 2, 1);
```

#### 0.3 Migration Plan Chi Tiết

**File:** `backend/migrations/006_department_system.sql`

Bao gồm:
- Tạo 4 bảng mới (departments, positions, user_positions, management_scopes)
- Thêm 3 cột vào users
- Seed 9 departments (BGD + 8 phòng)
- Map dữ liệu cũ:
  ```sql
  -- Map users.department (string) → users.primaryDepartmentId (FK)
  UPDATE users u 
  SET u.primaryDepartmentId = (
    SELECT d.id FROM departments d 
    WHERE d.code = u.department OR d.name LIKE CONCAT('%', u.department, '%')
    LIMIT 1
  )
  WHERE u.department IS NOT NULL;
  
  -- Set managementLevel từ role
  UPDATE users SET managementLevel = 
    CASE role
      WHEN 'Admin' THEN 99 -- System level
      WHEN 'Director' THEN 40
      WHEN 'Manager' THEN 20
      WHEN 'Employee' THEN 10
      ELSE 10
    END;
  ```

---

### PHASE 1: Core RBAC Engine (3-4 tuần)

**Mục tiêu:** Xây dựng engine phân quyền dữ liệu theo cấp quản lý + phòng ban

#### 1.1 Backend: RBAC Service

**File:** `backend/services/rbacService.ts`

```typescript
export interface DataScopeContext {
  userId: string;
  managementLevel: number;
  primaryDepartmentId: string;
  managedDepartmentIds: string[]; // Cho Phó GĐ
  action: 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE' | 'APPROVE';
  resourceType: 'task' | 'contract' | 'project' | 'report' | 'revenue';
}

export class RBACService {
  // Lấy danh sách department IDs user được phép truy cập
  async getAccessibleDepartments(ctx: DataScopeContext): Promise<string[]> {
    if (ctx.managementLevel === 40) return ['ALL']; // Director
    if (ctx.managementLevel === 30) return ctx.managedDepartmentIds; // Phó GĐ
    if (ctx.managementLevel === 20) {
      // Trưởng phòng: phòng mình + phòng con
      return await this.getDepartmentAndChildren(ctx.primaryDepartmentId);
    }
    return [ctx.primaryDepartmentId]; // Employee: chỉ phòng mình
  }

  // Kiểm tra quyền trên resource cụ thể
  async canAccessResource(
    ctx: DataScopeContext, 
    resource: { departmentId: string; createdBy: string; assignedTo?: string[] }
  ): Promise<boolean> {
    // Employee: OWN | ASSIGNED
    if (ctx.managementLevel === 10) {
      return resource.createdBy === ctx.userId || 
             resource.assignedTo?.includes(ctx.userId);
    }
    
    // Manager+: kiểm tra department scope
    const accessible = await this.getAccessibleDepartments(ctx);
    if (accessible.includes('ALL')) return true;
    return accessible.includes(resource.departmentId);
  }
}
```

#### 1.2 Backend: Permission Middleware v2

**File:** `backend/middleware/rbac.ts`

```typescript
import { RBACService } from '../services/rbacService.js';

export function requireManagementLevel(minLevel: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user; // Từ requireAuth
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    
    if (user.managementLevel < minLevel) {
      return res.status(403).json({ 
        error: 'Insufficient management level',
        required: minLevel,
        current: user.managementLevel
      });
    }
    next();
  };
}

export function requireDepartmentScope(resourceType: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const rbac = new RBACService(req.db);
    const ctx: DataScopeContext = {
      userId: req.user.id,
      managementLevel: req.user.managementLevel,
      primaryDepartmentId: req.user.primaryDepartmentId,
      managedDepartmentIds: await rbac.getManagedDepartments(req.user.id),
      action: req.method === 'GET' ? 'VIEW' : 'EDIT',
      resourceType
    };
    
    req.rbacContext = ctx;
    next();
  };
}
```

#### 1.3 Frontend: useRBAC Hook

**File:** `frontend/hooks/useRBAC.ts`

```typescript
export function useRBAC() {
  const { user } = useAuth();
  const { departments } = useData();
  
  const canViewDepartment = (deptId: string): boolean => {
    if (user.managementLevel === 40) return true; // Director
    if (user.managementLevel === 30) {
      return user.managedDepartmentIds?.includes(deptId);
    }
    if (user.managementLevel === 20) {
      // Trưởng phòng: check hierarchy
      return isChildOf(deptId, user.primaryDepartmentId, departments);
    }
    return deptId === user.primaryDepartmentId;
  };
  
  const canApprove = (resourceType: string, amount?: number): boolean => {
    // Theo bảng thẩm quyền phê duyệt từ docs
    const limits = APPROVAL_LIMITS[user.managementLevel][resourceType];
    return !amount || amount <= limits.maxAmount;
  };
  
  return { canViewDepartment, canApprove, managementLevel: user.managementLevel };
}
```

---

### PHASE 2: Department Dashboards (4 tuần)

**Mục tiêu:** 9 dashboard riêng cho từng phòng ban

#### 2.1 Dashboard Architecture

**Pattern:** Dynamic dashboard theo `user.primaryDepartmentId`

```typescript
// frontend/pages/Dashboard.tsx
function Dashboard() {
  const { user } = useAuth();
  const DashboardComponent = DEPT_DASHBOARDS[user.primaryDepartmentId] 
    || GenericDashboard;
  
  return <DashboardComponent />;
}

const DEPT_DASHBOARDS = {
  'dept-ke-toan': lazy(() => import('./dashboards/AccountingDashboard')),
  'dept-kinh-doanh': lazy(() => import('./dashboards/SalesDashboard')),
  'dept-du-an': lazy(() => import('./dashboards/ProjectDashboard')),
  // ... 6 phòng khác
};
```

#### 2.2 Accounting Dashboard (Kế Toán)

**File:** `frontend/pages/dashboards/AccountingDashboard.tsx`

Widgets:
- **Công nợ phải thu** (theo hợp đồng, khách hàng)
- **Công nợ phải trả** (nhà cung cấp, vật tư)
- **Dòng tiền tháng** (thu/chi, biểu đồ cashflow)
- **Chờ thanh toán** (danh sách invoice pending)
- **Báo cáo doanh thu** (trạng thái approval)

Data sources:
```typescript
const { data: receivables } = useQuery(['receivables', { status: 'pending' }]);
const { data: payables } = useQuery(['payables', { dueDate: 'thisMonth' }]);
const { data: cashflow } = useQuery(['accounting/cashflow', { month: currentMonth }]);
```

#### 2.3 Sales Dashboard (Kinh Doanh)

Widgets:
- **Lead pipeline** (Kanban: New → Qualified → Proposal → Won/Lost)
- **Cơ hội đang theo dõi** (opportunities với tỷ lệ thành công)
- **Báo giá chờ duyệt**
- **Doanh số tháng/quý** (target vs actual)
- **Top khách hàng tiềm năng**

#### 2.4 Project Dashboard (Dự Án)

Widgets:
- **Dự án đang thi công** (timeline Gantt)
- **Tiến độ dự án** (% hoàn thành, milestone)
- **Yêu cầu vật tư chờ** (pending material requests)
- **Nghiệm thu sắp tới** (upcoming inspections)
- **Biểu đồ tài nguyên** (nhân lực phân bổ)

#### 2.5 Technical Dashboard (Kỹ Thuật - Bảo Hành)

Widgets:
- **Ticket bảo hành mở** (theo độ ưu tiên)
- **O&M schedule** (lịch bảo trì định kỳ)
- **Thiết bị cần kiểm tra**
- **Phản hồi khách hàng** (CSAT scores)
- **SLA compliance** (% đạt thời gian phản hồi)

---

### PHASE 3: Workflow & Approval Engine (5 tuần)

**Mục tiêu:** Luồng phê duyệt tự động theo ma trận thẩm quyền

#### 3.1 Approval Matrix từ Docs

| Loại nghiệp vụ | Employee | Manager | Deputy Director | Director |
|----------------|----------|---------|-----------------|----------|
| **Báo giá** | Tạo draft | Duyệt < 500M | Duyệt < 2B | Duyệt tất cả |
| **Hợp đồng** | - | Duyệt < 500M | Duyệt < 2B | Duyệt tất cả |
| **Thanh toán** | Đề xuất | < 100M | < 500M | Tất cả |
| **Mua hàng** | Đề xuất | < 50M | < 200M | Tất cả |
| **Báo cáo doanh thu** | - | Phòng mình | Xem/duyệt phòng quản lý | Tất cả |

#### 3.2 Workflow Engine Schema

**File:** `backend/migrations/007_approval_workflows.sql`

```sql
CREATE TABLE IF NOT EXISTS approval_workflows (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  resourceType VARCHAR(50) NOT NULL, -- quote, contract, payment, purchase
  steps JSON NOT NULL, -- [{ level: 20, condition: 'amount < 500000000' }, ...]
  isActive TINYINT DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS approval_requests (
  id VARCHAR(36) PRIMARY KEY,
  workflowId VARCHAR(36) NOT NULL,
  resourceType VARCHAR(50) NOT NULL,
  resourceId VARCHAR(36) NOT NULL,
  requesterId VARCHAR(36) NOT NULL,
  currentStep INT NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL, -- pending, approved, rejected, cancelled
  metadata JSON, -- { amount, departmentId, description }
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (workflowId) REFERENCES approval_workflows(id),
  FOREIGN KEY (requesterId) REFERENCES users(id),
  INDEX idx_approval_status (status),
  INDEX idx_approval_resource (resourceType, resourceId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS approval_steps (
  id VARCHAR(36) PRIMARY KEY,
  requestId VARCHAR(36) NOT NULL,
  stepNumber INT NOT NULL,
  approverId VARCHAR(36),
  requiredLevel INT NOT NULL,
  status VARCHAR(50) NOT NULL, -- pending, approved, rejected, skipped
  comments TEXT,
  decidedAt DATETIME,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (requestId) REFERENCES approval_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (approverId) REFERENCES users(id),
  INDEX idx_step_request (requestId),
  INDEX idx_step_approver (approverId, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### 3.3 Approval Service

**File:** `backend/services/approvalService.ts`

```typescript
export class ApprovalService {
  async createApprovalRequest(params: {
    resourceType: string;
    resourceId: string;
    requesterId: string;
    metadata: { amount?: number; departmentId: string };
  }): Promise<string> {
    // 1. Tìm workflow phù hợp
    const workflow = await this.findWorkflow(params.resourceType, params.metadata);
    
    // 2. Tạo approval_request
    const requestId = randomUUID();
    await this.db.run(
      `INSERT INTO approval_requests (id, workflowId, resourceType, resourceId, 
       requesterId, metadata, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [requestId, workflow.id, params.resourceType, params.resourceId, 
       params.requesterId, JSON.stringify(params.metadata)]
    );
    
    // 3. Tạo approval_steps theo workflow.steps
    for (const [index, step] of workflow.steps.entries()) {
      await this.db.run(
        `INSERT INTO approval_steps (id, requestId, stepNumber, requiredLevel, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [randomUUID(), requestId, index + 1, step.level]
      );
    }
    
    // 4. Gửi notification cho approvers
    await this.notifyApprovers(requestId);
    
    return requestId;
  }
  
  async approveStep(requestId: string, approverId: string, comments?: string): Promise<void> {
    const approver = await this.db.get('SELECT managementLevel FROM users WHERE id = ?', [approverId]);
    const currentStep = await this.db.get(
      `SELECT * FROM approval_steps WHERE requestId = ? AND status = 'pending' ORDER BY stepNumber LIMIT 1`,
      [requestId]
    );
    
    if (!currentStep) throw new Error('No pending step');
    if (approver.managementLevel < currentStep.requiredLevel) {
      throw new Error('Insufficient approval authority');
    }
    
    // Duyệt step hiện tại
    await this.db.run(
      `UPDATE approval_steps SET status = 'approved', approverId = ?, comments = ?, decidedAt = NOW()
       WHERE id = ?`,
      [approverId, comments, currentStep.id]
    );
    
    // Kiểm tra còn step nào không
    const remainingSteps = await this.db.get(
      `SELECT COUNT(*) as count FROM approval_steps WHERE requestId = ? AND status = 'pending'`,
      [requestId]
    );
    
    if (remainingSteps.count === 0) {
      // Hoàn tất workflow
      await this.db.run(
        `UPDATE approval_requests SET status = 'approved', updatedAt = NOW() WHERE id = ?`,
        [requestId]
      );
      await this.finalizeResource(requestId);
    } else {
      // Chuyển sang step tiếp theo
      await this.notifyApprovers(requestId);
    }
  }
}
```

---

### PHASE 4-6: Business Modules (12 tuần)

#### PHASE 4: Lead & Opportunity Management (4 tuần)

**Modules:**
- Lead tracking (Marketing/Sales)
- Opportunity pipeline
- Quote generation
- Win/Loss analysis

**Key Tables:**
```sql
CREATE TABLE leads (
  id VARCHAR(36) PRIMARY KEY,
  source VARCHAR(100), -- website, referral, exhibition
  contactName VARCHAR(255),
  companyName VARCHAR(255),
  phone VARCHAR(20),
  email VARCHAR(255),
  interest TEXT,
  status VARCHAR(50), -- new, contacted, qualified, converted, lost
  assignedTo VARCHAR(36),
  departmentId VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assignedTo) REFERENCES users(id),
  FOREIGN KEY (departmentId) REFERENCES departments(id)
);

CREATE TABLE opportunities (
  id VARCHAR(36) PRIMARY KEY,
  leadId VARCHAR(36),
  name VARCHAR(255),
  estimatedValue DECIMAL(15,2),
  probability INT, -- 0-100%
  expectedCloseDate DATE,
  stage VARCHAR(50), -- qualified, proposal, negotiation, won, lost
  departmentId VARCHAR(36),
  assignedTo VARCHAR(36),
  FOREIGN KEY (leadId) REFERENCES leads(id),
  FOREIGN KEY (departmentId) REFERENCES departments(id)
);
```

#### PHASE 5: Technical Requirements & Survey (3 tuần)

**Modules:**
- Technical requirement form
- Site survey scheduler
- Survey report with photos
- BOM generation

**Integration:** Opportunity → Technical Req → Survey → Quote

#### PHASE 6: Advanced Project Management (5 tuần)

**Modules:**
- Gantt chart timeline
- Resource allocation
- Material request workflow
- Daily progress reports
- Inspection & handover

---

### PHASE 7-9: Finance & Operations (9 tuần)

#### PHASE 7: Contract & Payment (3 tuần)

- Contract templates
- Payment schedule
- Invoice generation
- Payment approval workflow

#### PHASE 8: Warehouse & Purchasing (3 tuần)

- Inventory management
- Stock alerts
- Purchase requests
- Supplier management
- Goods receipt

#### PHASE 9: Revenue & Financial Reports (3 tuần)

- Monthly revenue reports
- Department P&L
- Approval workflow for financial reports
- Export to Excel for accounting

---

### PHASE 10-12: Advanced Features (6 tuần)

#### PHASE 10: O&M & Warranty (2 tuần)

- Warranty ticket system
- Maintenance schedule
- SLA tracking
- Customer feedback

#### PHASE 11: Analytics & BI (2 tuần)

- Executive dashboard (Director)
- KPI tracking per department
- Predictive analytics (doanh số forecast)
- Performance reports

#### PHASE 12: Integration & Optimization (2 tuần)

- Email integration (Gmail/Outlook sync)
- Mobile app considerations
- Performance optimization
- Security audit

---

## 🧪 TESTING STRATEGY

### Unit Tests (Backend)

**File:** `backend/tests/rbac.test.ts`

```typescript
describe('RBAC Service', () => {
  it('Employee can only view own and assigned tasks', async () => {
    const employee = { id: 'u1', managementLevel: 10, primaryDepartmentId: 'dept-ke-toan' };
    const rbac = new RBACService(db);
    
    const ownTask = { departmentId: 'dept-ke-toan', createdBy: 'u1', assignedTo: [] };
    expect(await rbac.canAccessResource(employee, ownTask)).toBe(true);
    
    const otherTask = { departmentId: 'dept-ke-toan', createdBy: 'u2', assignedTo: [] };
    expect(await rbac.canAccessResource(employee, otherTask)).toBe(false);
  });
  
  it('Manager can view all tasks in department', async () => {
    const manager = { id: 'u2', managementLevel: 20, primaryDepartmentId: 'dept-ke-toan' };
    const rbac = new RBACService(db);
    
    const deptTask = { departmentId: 'dept-ke-toan', createdBy: 'u3', assignedTo: [] };
    expect(await rbac.canAccessResource(manager, deptTask)).toBe(true);
  });
  
  it('Deputy Director can view managed departments only', async () => {
    const deputy = { 
      id: 'u3', 
      managementLevel: 30, 
      primaryDepartmentId: 'dept-bgd',
      managedDepartmentIds: ['dept-ke-toan', 'dept-hcns']
    };
    const rbac = new RBACService(db);
    
    const managedTask = { departmentId: 'dept-ke-toan', createdBy: 'u4', assignedTo: [] };
    expect(await rbac.canAccessResource(deputy, managedTask)).toBe(true);
    
    const otherTask = { departmentId: 'dept-kinh-doanh', createdBy: 'u5', assignedTo: [] };
    expect(await rbac.canAccessResource(deputy, otherTask)).toBe(false);
  });
  
  it('Director can view everything', async () => {
    const director = { id: 'u4', managementLevel: 40, primaryDepartmentId: 'dept-bgd' };
    const rbac = new RBACService(db);
    
    const anyTask = { departmentId: 'dept-marketing', createdBy: 'u6', assignedTo: [] };
    expect(await rbac.canAccessResource(director, anyTask)).toBe(true);
  });
});
```

### Integration Tests

**File:** `backend/tests/approval-workflow.test.ts`

Test luồng:
1. Employee tạo báo giá 300M → Auto-assign Manager approval
2. Manager duyệt → Báo giá approved (< 500M không cần Deputy/Director)
3. Employee tạo báo giá 1B → Requires Deputy Director
4. Employee tạo hợp đồng 3B → Requires Director

### E2E Tests (Frontend)

**Tools:** Playwright

```typescript
test('Manager can view department dashboard', async ({ page }) => {
  await loginAs(page, 'manager@tranlecorp.com');
  await page.goto('/dashboard');
  
  // Chỉ thấy dữ liệu phòng Kế Toán
  await expect(page.locator('[data-department="dept-ke-toan"]')).toBeVisible();
  await expect(page.locator('[data-department="dept-kinh-doanh"]')).not.toBeVisible();
});

test('Approval workflow for quote', async ({ page }) => {
  await loginAs(page, 'employee@tranlecorp.com');
  
  // Tạo báo giá
  await page.goto('/quotes/new');
  await page.fill('[name="amount"]', '800000000'); // 800M
  await page.click('button[type="submit"]');
  
  // Kiểm tra approval request được tạo
  await expect(page.locator('.approval-pending')).toHaveText('Chờ Phó Giám đốc duyệt');
  
  // Login Phó GĐ
  await loginAs(page, 'deputy@tranlecorp.com');
  await page.goto('/approvals');
  await page.click('button[data-action="approve"]');
  
  // Kiểm tra báo giá approved
  await expect(page.locator('.approval-status')).toHaveText('Đã duyệt');
});
```

---

## 📈 MIGRATION ROADMAP

### Tuần 1-2: Schema & Data Migration

**Checklist:**
- [x] Tạo migration 006 (departments, positions, user_positions, management_scopes)
- [ ] Seed 9 departments chuẩn
- [ ] Map users hiện tại → primaryDepartmentId
- [ ] Set managementLevel từ role
- [ ] Test migration trên DB dev
- [ ] Backup production DB
- [ ] Chạy migration production (downtime ~5 phút)

### Tuần 3-4: RBAC Backend

**Checklist:**
- [ ] Implement RBACService
- [ ] Middleware requireManagementLevel
- [ ] Middleware requireDepartmentScope
- [ ] Update tất cả routes với RBAC checks
- [ ] Write 50+ unit tests
- [ ] Integration test với Supertest

### Tuần 5-6: RBAC Frontend

**Checklist:**
- [ ] Hook useRBAC
- [ ] Context DepartmentContext
- [ ] Filter data theo accessible departments
- [ ] Ẩn/hiện UI theo managementLevel
- [ ] Test permission boundaries

### Tuần 7-10: Department Dashboards

**Checklist:**
- [ ] Generic dashboard template
- [ ] Accounting dashboard (5 widgets)
- [ ] Sales dashboard (5 widgets)
- [ ] Project dashboard (5 widgets)
- [ ] Technical dashboard (5 widgets)
- [ ] 4 dashboards còn lại (HR, Marketing, Warehouse, Purchasing)

### Tuần 11-15: Approval Workflows

**Checklist:**
- [ ] Schema approval_workflows/requests/steps
- [ ] ApprovalService backend
- [ ] Workflow UI component
- [ ] Approval center page
- [ ] Notifications cho approvers
- [ ] Test 4 loại approval (quote, contract, payment, purchase)

---

## 🚀 DEPLOYMENT PLAN

### Phase 0 → Production

**Chuẩn bị:**
```bash
# Backup DB
mysqldump -u root -p Tranle_task_new > backup_$(date +%Y%m%d).sql

# Test migration local
mysql -u root -p Tranle_task_test < backend/migrations/006_department_system.sql

# Chạy test suite
cd backend && npm test

# Build frontend
cd frontend && npm run build
```

**Deployment:**
```bash
# Maintenance mode ON
pm2 stop tranle-tasks

# Run migration
mysql -u root -p Tranle_task_new < backend/migrations/006_department_system.sql

# Deploy code
git pull origin main
npm install --workspaces

# Start
pm2 start ecosystem.config.cjs

# Verify
curl https://tasks.tranlecorp.com.vn/health
```

**Rollback Plan:**
```sql
-- Nếu có vấn đề
DROP TABLE management_scopes;
DROP TABLE user_positions;
DROP TABLE positions;
DROP TABLE departments;

ALTER TABLE users 
  DROP COLUMN managementLevel,
  DROP COLUMN primaryDepartmentId,
  DROP COLUMN employeeCode;

-- Restore từ backup
mysql -u root -p Tranle_task_new < backup_20261009.sql
```

---

## 📊 SUCCESS METRICS

### Technical Metrics

| Metric | Target | Current |
|--------|--------|---------|
| API response time (p95) | < 200ms | TBD |
| Database query time (p95) | < 50ms | TBD |
| Frontend bundle size | < 2MB | 1.46MB ✅ |
| Test coverage (backend) | > 80% | 72% 🟡 |
| Zero RBAC bypass vulnerabilities | 0 | TBD |

### Business Metrics

| Metric | Target |
|--------|--------|
| User adoption per department | > 80% trong 3 tháng |
| Approval workflow efficiency | Giảm 50% thời gian duyệt so với thủ công |
| Dashboard satisfaction (NPS) | > 50 |
| Data isolation incidents | 0 |

---

## 🎯 RISKS & MITIGATION

### Risk 1: Migration Breaks Existing Functionality

**Probability:** Medium  
**Impact:** High

**Mitigation:**
- Giữ backward compatibility với bảng `roles`
- Không xoá cột `users.department` (string) ngay
- Feature flag để toggle RBAC v2 on/off
- Extensive testing trước production
- Rollback plan rõ ràng

### Risk 2: Performance Degradation

**Probability:** Low  
**Impact:** Medium

**Mitigation:**
- Đã thêm indexes cho departments, positions, user_positions
- Monitor query performance với slow query log
- Cache accessible departments per user session
- Optimize recursive department queries

### Risk 3: User Training & Adoption

**Probability:** Medium  
**Impact:** Medium

**Mitigation:**
- Tài liệu hướng dẫn chi tiết cho từng phòng ban
- Video demo dashboard mới
- Đào tạo trưởng phòng trước → cascade xuống nhân viên
- Hotline support tuần đầu tiên

---

## 📚 DOCUMENTATION DELIVERABLES

1. **Technical Specs**
   - API documentation (OpenAPI)
   - Database ER diagram
   - RBAC flow diagrams
   - Deployment runbook

2. **User Guides**
   - Admin guide (quản lý phòng ban, users, positions)
   - Manager guide (dashboard, approval workflows)
   - Employee guide (cách sử dụng theo từng phòng ban)

3. **Training Materials**
   - Video tutorials (10-15 phút per role)
   - FAQ per department
   - Troubleshooting guide

---

## 🎉 CONCLUSION

Kế hoạch này triển khai hệ thống phòng ban đầy đủ cho TranLe Tasks trong **6-9 tháng** (12 phases):

- **Phase 0-1** (5-7 tuần): Nền tảng RBAC
- **Phase 2-3** (9 tuần): Dashboards + Approval workflows
- **Phase 4-6** (12 tuần): Business modules (Lead → Project)
- **Phase 7-9** (9 tuần): Finance & Operations
- **Phase 10-12** (6 tuần): Advanced features

**Next immediate steps:**
1. Review kế hoạch với stakeholders
2. Approve Phase 0 scope
3. Tạo migration 006
4. Begin RBAC implementation

---

**Người lập:** Claude Sonnet 5  
**Ngày:** 2026-10-09  
**Trạng thái:** Ready for review
