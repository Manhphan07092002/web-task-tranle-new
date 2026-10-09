# KẾ HOẠCH TRIỂN KHAI THEO TỪNG PHÒNG BAN

**Version:** 2.0  
**Date:** 2026-10-09  
**Strategy:** Incremental rollout - Code xong phòng ban nào → Test xong → Deploy → Chuyển sang phòng tiếp theo

---

## 🎯 CHIẾN LƯỢC TRIỂN KHAI

### Tại sao triển khai từng phòng ban?

✅ **Lợi ích:**
- Test kỹ từng phòng trước khi sang phòng khác
- Phát hiện bug sớm, scope nhỏ, dễ fix
- Deploy từng phòng → rủi ro thấp
- User từng phòng làm quen dần với hệ thống mới
- Feedback sớm → adjust cho phòng tiếp theo

❌ **Tránh:**
- Code 8 phòng cùng lúc → bug nhiều, khó debug
- Deploy toàn bộ → fail một phòng ảnh hưởng tất cả
- Không feedback sớm → đi sai hướng lâu

---

## 📊 THỨ TỰ TRIỂN KHAI

### Nguyên tắc chọn thứ tự

1. **Đơn giản trước, phức tạp sau**
2. **Phòng ban ít nhạy cảm trước** (không phải finance/legal)
3. **Phòng ban có ít user trước** → dễ test
4. **Phòng có workflow độc lập trước** → ít ảnh hưởng cross-department

### Thứ tự đề xuất

| Order | Phòng Ban | Lý do chọn | Complexity | Users | Timeline |
|-------|-----------|------------|------------|-------|----------|
| **1** | **Kho Vận** | Workflow đơn giản, ít nhạy cảm | ⭐ Low | 3-5 | 2 weeks |
| **2** | **Mua Hàng** | Liên quan Kho, approval đơn giản | ⭐⭐ Medium | 3-5 | 2 weeks |
| **3** | **Marketing** | Độc lập, ít integrate khác | ⭐ Low | 4-6 | 2 weeks |
| **4** | **HCNS** | Internal support, workflow clear | ⭐⭐ Medium | 4-6 | 3 weeks |
| **5** | **Kỹ Thuật - Bảo Hành** | Technical, nhiều checklist | ⭐⭐⭐ High | 6-8 | 3 weeks |
| **6** | **Kinh Doanh** | Sales pipeline phức tạp | ⭐⭐⭐ High | 8-10 | 4 weeks |
| **7** | **Dự Án** | Phụ thuộc nhiều phòng | ⭐⭐⭐⭐ Very High | 10-15 | 4 weeks |
| **8** | **Kế Toán** | Financial data, cần chính xác cao | ⭐⭐⭐⭐⭐ Critical | 4-6 | 4 weeks |

**Total estimated timeline:** 24 weeks (~6 months)

---

## 📦 DEPARTMENT 1: KHO VẬN (2 weeks)

### Week 1: Backend Implementation

#### 1.1. Database Schema (Day 1-2)
```sql
-- Bảng tồn kho
CREATE TABLE IF NOT EXISTS inventory (
  id VARCHAR(36) PRIMARY KEY,
  productCode VARCHAR(50) NOT NULL,
  productName VARCHAR(255) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit VARCHAR(20),
  warehouseLocation VARCHAR(100),
  departmentId VARCHAR(36), -- dept-kho
  lastStockTake DATETIME,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (departmentId) REFERENCES departments(id),
  INDEX idx_inventory_dept (departmentId),
  INDEX idx_inventory_product (productCode)
);

-- Nhập xuất kho
CREATE TABLE IF NOT EXISTS warehouse_transactions (
  id VARCHAR(36) PRIMARY KEY,
  type ENUM('IN', 'OUT', 'ADJUST', 'TRANSFER') NOT NULL,
  productCode VARCHAR(50) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  fromLocation VARCHAR(100),
  toLocation VARCHAR(100),
  requestedBy VARCHAR(36),
  approvedBy VARCHAR(36),
  status ENUM('pending', 'approved', 'completed', 'rejected') DEFAULT 'pending',
  departmentId VARCHAR(36), -- dept-kho
  notes TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (departmentId) REFERENCES departments(id),
  FOREIGN KEY (requestedBy) REFERENCES users(id),
  FOREIGN KEY (approvedBy) REFERENCES users(id),
  INDEX idx_wh_trans_dept (departmentId),
  INDEX idx_wh_trans_status (status),
  INDEX idx_wh_trans_type (type)
);
```

#### 1.2. Backend Routes (Day 3-4)
**File:** `backend/routes/warehouse.ts` (NEW)

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireDepartmentScope, applyDepartmentFilter, requireApprovalAuthority } from '../middleware/rbac.js';

export function warehouseRoutes(db: any) {
  const router = Router();
  
  // GET /api/warehouse/inventory - Xem tồn kho
  router.get('/inventory', 
    requireAuth, 
    requireDepartmentScope('inventory'),
    async (req, res) => {
      try {
        const { condition, params } = await applyDepartmentFilter(req);
        
        const inventory = await db.all(
          `SELECT * FROM inventory WHERE ${condition} ORDER BY productName`,
          params
        );
        
        res.json(inventory);
      } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({ error: 'Failed to fetch inventory' });
      }
    }
  );
  
  // POST /api/warehouse/transactions - Tạo phiếu xuất/nhập kho
  router.post('/transactions', requireAuth, async (req, res) => {
    try {
      const { type, productCode, quantity, toLocation, notes } = req.body;
      const id = randomUUID();
      
      await db.run(
        `INSERT INTO warehouse_transactions 
         (id, type, productCode, quantity, toLocation, requestedBy, departmentId, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, 'dept-kho', ?, 'pending')`,
        [id, type, productCode, quantity, toLocation, req.user.id, notes]
      );
      
      res.json({ id, success: true });
    } catch (error) {
      console.error('Error creating transaction:', error);
      res.status(500).json({ error: 'Failed to create transaction' });
    }
  });
  
  // POST /api/warehouse/transactions/:id/approve - Duyệt phiếu
  router.post('/transactions/:id/approve',
    requireAuth,
    requireApprovalAuthority('warehouse'),
    async (req, res) => {
      try {
        const { id } = req.params;
        
        // Update transaction
        await db.run(
          `UPDATE warehouse_transactions 
           SET status = 'approved', approvedBy = ?, updatedAt = ?
           WHERE id = ?`,
          [req.user.id, new Date().toISOString(), id]
        );
        
        // Update inventory
        const trans = await db.get('SELECT * FROM warehouse_transactions WHERE id = ?', [id]);
        if (trans.type === 'IN') {
          await db.run(
            `UPDATE inventory SET quantity = quantity + ? WHERE productCode = ?`,
            [trans.quantity, trans.productCode]
          );
        } else if (trans.type === 'OUT') {
          await db.run(
            `UPDATE inventory SET quantity = quantity - ? WHERE productCode = ?`,
            [trans.quantity, trans.productCode]
          );
        }
        
        res.json({ success: true });
      } catch (error) {
        console.error('Error approving transaction:', error);
        res.status(500).json({ error: 'Failed to approve transaction' });
      }
    }
  );
  
  return router;
}
```

#### 1.3. Backend Tests (Day 4-5)
**File:** `backend/tests/warehouse.test.ts` (NEW)

```typescript
describe('Warehouse - Department Scope', () => {
  test('Warehouse staff sees all inventory', async () => {
    const warehouseStaffToken = await createTestUser(db, { 
      managementLevel: 10,
      primaryDepartmentId: 'dept-kho'
    });
    
    const res = await request(app)
      .get('/api/warehouse/inventory')
      .set('Authorization', `Bearer ${warehouseStaffToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
  
  test('Other department cannot see warehouse inventory', async () => {
    const salesStaffToken = await createTestUser(db, {
      managementLevel: 10,
      primaryDepartmentId: 'dept-kinh-doanh'
    });
    
    const res = await request(app)
      .get('/api/warehouse/inventory')
      .set('Authorization', `Bearer ${salesStaffToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0); // No access
  });
  
  test('Manager can approve warehouse transaction', async () => {
    const transaction = await createTransaction(db, { status: 'pending' });
    
    const res = await request(app)
      .post(`/api/warehouse/transactions/${transaction.id}/approve`)
      .set('Authorization', `Bearer ${warehouseManagerToken}`);
    
    expect(res.status).toBe(200);
  });
  
  test('Employee cannot approve warehouse transaction', async () => {
    const transaction = await createTransaction(db, { status: 'pending' });
    
    const res = await request(app)
      .post(`/api/warehouse/transactions/${transaction.id}/approve`)
      .set('Authorization', `Bearer ${warehouseStaffToken}`);
    
    expect(res.status).toBe(403);
  });
});
```

**Run tests:**
```bash
cd backend && npm test -- warehouse.test.ts
# Expected: All tests PASS
```

### Week 2: Frontend Implementation

#### 2.1. Frontend Types (Day 1)
**File:** `frontend/types.ts` (UPDATE)

```typescript
export interface InventoryItem {
  id: string;
  productCode: string;
  productName: string;
  quantity: number;
  unit: string;
  warehouseLocation?: string;
  departmentId: string;
  lastStockTake?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseTransaction {
  id: string;
  type: 'IN' | 'OUT' | 'ADJUST' | 'TRANSFER';
  productCode: string;
  quantity: number;
  fromLocation?: string;
  toLocation?: string;
  requestedBy: string;
  approvedBy?: string;
  status: 'pending' | 'approved' | 'completed' | 'rejected';
  departmentId: string;
  notes?: string;
  createdAt: string;
}
```

#### 2.2. API Service (Day 1)
**File:** `frontend/services/warehouseService.ts` (NEW)

```typescript
import { api } from './api';

export const warehouseService = {
  getInventory: () => api.get('/warehouse/inventory'),
  
  getTransactions: () => api.get('/warehouse/transactions'),
  
  createTransaction: (data: {
    type: string;
    productCode: string;
    quantity: number;
    toLocation?: string;
    notes?: string;
  }) => api.post('/warehouse/transactions', data),
  
  approveTransaction: (id: string) => 
    api.post(`/warehouse/transactions/${id}/approve`),
  
  rejectTransaction: (id: string, reason: string) =>
    api.post(`/warehouse/transactions/${id}/reject`, { reason }),
};
```

#### 2.3. Warehouse Page (Day 2-4)
**File:** `frontend/pages/Warehouse.tsx` (NEW)

```typescript
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRBAC } from '../hooks/useRBAC';
import { warehouseService } from '../services/warehouseService';

export function Warehouse() {
  const { user } = useAuth();
  const { canApprove, isManager } = useRBAC();
  const [inventory, setInventory] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    loadData();
  }, []);
  
  const loadData = async () => {
    setLoading(true);
    try {
      const [inv, trans] = await Promise.all([
        warehouseService.getInventory(),
        warehouseService.getTransactions()
      ]);
      setInventory(inv);
      setTransactions(trans);
    } catch (error) {
      console.error('Error loading warehouse data:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleApprove = async (transactionId: string) => {
    try {
      await warehouseService.approveTransaction(transactionId);
      loadData();
    } catch (error) {
      console.error('Error approving transaction:', error);
    }
  };
  
  return (
    <div className="warehouse-page">
      <h1>Quản Lý Kho</h1>
      
      {/* Inventory Table */}
      <section>
        <h2>Tồn Kho</h2>
        <table>
          <thead>
            <tr>
              <th>Mã SP</th>
              <th>Tên SP</th>
              <th>Số lượng</th>
              <th>Đơn vị</th>
              <th>Vị trí</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map(item => (
              <tr key={item.id}>
                <td>{item.productCode}</td>
                <td>{item.productName}</td>
                <td>{item.quantity}</td>
                <td>{item.unit}</td>
                <td>{item.warehouseLocation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      
      {/* Transactions Table */}
      <section>
        <h2>Phiếu Xuất Nhập Kho</h2>
        <table>
          <thead>
            <tr>
              <th>Loại</th>
              <th>Mã SP</th>
              <th>Số lượng</th>
              <th>Trạng thái</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map(trans => (
              <tr key={trans.id}>
                <td>{trans.type}</td>
                <td>{trans.productCode}</td>
                <td>{trans.quantity}</td>
                <td>{trans.status}</td>
                <td>
                  {trans.status === 'pending' && canApprove('warehouse') && (
                    <button onClick={() => handleApprove(trans.id)}>
                      Duyệt
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

#### 2.4. Update Router (Day 4)
**File:** `frontend/App.tsx` (UPDATE)

```typescript
import { Warehouse } from './pages/Warehouse';

// Add route
<Route path="/warehouse" element={<Warehouse />} />
```

#### 2.5. Manual Testing (Day 5)

**Test Cases:**
```
Login as Warehouse Staff (managementLevel: 10, dept: Kho Vận)
- [ ] Xem được tất cả inventory
- [ ] Tạo phiếu xuất kho được
- [ ] KHÔNG thấy nút duyệt phiếu
- [ ] Xem được phiếu của mình

Login as Warehouse Manager (managementLevel: 20, dept: Kho Vận)
- [ ] Xem được tất cả inventory
- [ ] Tạo phiếu được
- [ ] THẤY nút duyệt phiếu
- [ ] Duyệt phiếu thành công → tồn kho cập nhật

Login as Sales Staff (managementLevel: 10, dept: Kinh Doanh)
- [ ] KHÔNG xem được inventory Kho Vận
- [ ] KHÔNG tạo được phiếu xuất kho
- [ ] Thấy message "Không có quyền truy cập"

Login as Director (managementLevel: 40)
- [ ] Xem được inventory TẤT CẢ phòng
- [ ] Duyệt được mọi phiếu
```

### Week 2 Day 5: Deploy Department 1

```bash
# 1. Run all tests
cd backend && npm test
# Expected: All tests PASS (including 5 new warehouse tests)

# 2. Build frontend
cd frontend && npm run build
# Expected: Build success

# 3. Deploy to staging
git add .
git commit -m "feat(warehouse): complete warehouse department integration

- Database: inventory, warehouse_transactions tables
- Backend: warehouse routes with RBAC
- Frontend: Warehouse page with inventory + transactions
- Tests: 5 tests PASS (department scope + approval)
- Manual testing: All scenarios PASS

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"

# 4. Deploy
npm run start:prod

# 5. Smoke test production
curl https://tasks.tranlecorp.com.vn/api/warehouse/inventory \
  -H "Authorization: Bearer <token>"
```

### Week 2 Day 5: User Acceptance Testing (UAT)

**Participants:**
- 1 Thủ kho (Warehouse Staff)
- 1 Trưởng kho (Warehouse Manager)
- 1 Giám đốc

**Duration:** 2-3 hours

**Feedback form:**
```
1. Có xem được tồn kho không? (Yes/No)
2. Tạo phiếu xuất/nhập có dễ không? (1-5 stars)
3. Duyệt phiếu có nhanh không? (1-5 stars)
4. Có bug gì không? (describe)
5. Cần thêm gì? (suggestions)
```

### Week 2 End: Retrospective

**Review checklist:**
- [ ] All backend tests PASS
- [ ] Frontend build success
- [ ] Deployed to production
- [ ] UAT completed
- [ ] Bugs documented (if any)
- [ ] Feedback collected

**Lessons learned:**
- Document trong `DECISIONS_DEPARTMENT_1_KHO.md`
- Note các pattern tốt để apply cho phòng tiếp theo
- Note các issue cần avoid

---

## 📦 DEPARTMENT 2: MUA HÀNG (2 weeks)

### Week 3: Backend Implementation

#### 3.1. Database Schema
```sql
CREATE TABLE IF NOT EXISTS purchase_requests (
  id VARCHAR(36) PRIMARY KEY,
  itemName VARCHAR(255) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  estimatedPrice DECIMAL(15,2),
  supplier VARCHAR(255),
  requestedBy VARCHAR(36),
  approvedBy VARCHAR(36),
  status ENUM('pending', 'approved', 'ordered', 'received', 'rejected'),
  departmentId VARCHAR(36), -- dept-mua-hang
  notes TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (departmentId) REFERENCES departments(id),
  FOREIGN KEY (requestedBy) REFERENCES users(id),
  INDEX idx_purchase_dept (departmentId),
  INDEX idx_purchase_status (status)
);
```

#### 3.2. Backend Routes
**File:** `backend/routes/purchasing.ts` (NEW)

Similar structure to warehouse routes:
- GET /api/purchasing/requests - List with department scope
- POST /api/purchasing/requests - Create request
- POST /api/purchasing/requests/:id/approve - Approve (requireApprovalAuthority)

#### 3.3. Tests
**File:** `backend/tests/purchasing.test.ts` (NEW)
- 5 tests covering department scope + approval authority

### Week 4: Frontend + Deploy

Similar to Warehouse:
- Frontend types
- API service
- Purchasing page
- Manual testing
- Deploy + UAT

**End Week 4:** Department 2 COMPLETE

---

## 📦 DEPARTMENTS 3-8: SAME PATTERN

Mỗi phòng ban follow cùng template:

### Week N: Backend
1. Database schema (specific to department)
2. Backend routes with RBAC
3. Backend tests (5 tests)

### Week N+1: Frontend + Deploy
4. Frontend types
5. API service
6. Department page
7. Manual testing
8. Deploy + UAT
9. Retrospective

---

## 📊 TIMELINE OVERVIEW

| Weeks | Department | Status | Tests | Deploy |
|-------|-----------|--------|-------|--------|
| 1-2 | Kho Vận | 🔄 Next | 5 tests | Staging → Prod |
| 3-4 | Mua Hàng | ⏳ Waiting | 5 tests | After Dept 1 |
| 5-6 | Marketing | ⏳ | 5 tests | After Dept 2 |
| 7-9 | HCNS | ⏳ | 7 tests | After Dept 3 |
| 10-12 | Kỹ Thuật-BH | ⏳ | 8 tests | After Dept 4 |
| 13-16 | Kinh Doanh | ⏳ | 10 tests | After Dept 5 |
| 17-20 | Dự Án | ⏳ | 12 tests | After Dept 6 |
| 21-24 | Kế Toán | ⏳ | 10 tests | After Dept 7 |

**Total:** 24 weeks (~6 months)

---

## ✅ CHECKLIST MỖI PHÒNG BAN

### Before Starting New Department

- [ ] Previous department UAT completed
- [ ] Previous department deployed to production
- [ ] No critical bugs from previous department
- [ ] Feedback từ department trước đã reviewed

### During Implementation

- [ ] Database schema designed
- [ ] Backend routes implemented
- [ ] Backend tests written (5+ tests)
- [ ] All tests PASS
- [ ] Frontend types defined
- [ ] Frontend page implemented
- [ ] Manual testing completed
- [ ] Documentation updated

### Before Deploy

- [ ] Code review completed
- [ ] All tests PASS (backend + frontend build)
- [ ] Staging deployment tested
- [ ] UAT participants scheduled
- [ ] Rollback plan documented

### After Deploy

- [ ] Production smoke test PASS
- [ ] UAT completed
- [ ] Feedback collected
- [ ] Bugs triaged
- [ ] Retrospective documented
- [ ] Ready for next department

---

## 🚀 BẮT ĐẦU TỪ ĐÂU?

**Next immediate step:** DEPARTMENT 1 - KHO VẬN

```bash
# 1. Create branch
git checkout -b feat/warehouse-department

# 2. Create migration
# File: backend/migrations/007_warehouse_department.sql

# 3. Create backend route
# File: backend/routes/warehouse.ts

# 4. Create tests
# File: backend/tests/warehouse.test.ts

# 5. Run tests
cd backend && npm test -- warehouse.test.ts

# 6. Create frontend
# File: frontend/pages/Warehouse.tsx

# 7. Manual test
npm run dev

# 8. Deploy
git commit -m "feat(warehouse): complete Department 1 - Kho Vận"
```

---

**Strategy:** Incremental, test-driven, one department at a time  
**Timeline:** 24 weeks for all 8 departments  
**Next:** Department 1 - Kho Vận (2 weeks)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
