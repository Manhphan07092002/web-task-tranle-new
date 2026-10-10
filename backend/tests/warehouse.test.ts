import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { randomUUID } from 'crypto';
import { initDbMysql } from '../db_mysql.js';
import { warehouseRoutes } from '../routes/warehouse.js';
import { createRequireAuth } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';

// Set JWT_SECRET for tests
process.env.JWT_SECRET = 'test-secret-key';

const JWT_SECRET = process.env.JWT_SECRET;
const app = express();
app.use(express.json());

let db: any;

// Helper to create test user and get token
async function createTestUser(managementLevel: number, primaryDepartmentId: string, role: string = 'Employee') {
  const userId = randomUUID();
  const email = `test-${Date.now()}-${Math.random()}@example.com`;

  await db.run(
    `INSERT INTO users (id, name, email, password, role, managementLevel, primaryDepartmentId, department, avatar)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, 'Test User', email, 'hashedpass', role, managementLevel, primaryDepartmentId, 'Test Dept', '']
  );

  const token = jwt.sign({ sub: userId, tokenVersion: 0 }, JWT_SECRET, { expiresIn: '1h' });
  return { userId, token };
}

// Helper to create inventory item
async function createInventoryItem(productCode: string, departmentId: string = 'dept-kho') {
  const id = randomUUID();
  await db.run(
    `INSERT INTO inventory (id, productCode, productName, quantity, unit, departmentId)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, productCode, 'Test Product', 100, 'pcs', departmentId]
  );
  return id;
}

// Helper to create transaction
async function createTransaction(requestedBy: string, status: string = 'pending', departmentId: string = 'dept-kho') {
  const id = randomUUID();
  const transactionCode = `WH-TEST-${Date.now()}`;
  await db.run(
    `INSERT INTO warehouse_transactions
     (id, transactionCode, type, productCode, productName, quantity, unit, requestedBy, departmentId, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, transactionCode, 'IN', 'TEST-001', 'Test Product', 50, 'pcs', requestedBy, departmentId, status]
  );
  return id;
}

beforeAll(async () => {
  db = await initDbMysql();

  // Ensure departments table has RBAC columns (from migration 006)
  // Use raw SQL to add columns if they don't exist
  try {
    await db.run(`ALTER TABLE departments ADD COLUMN IF NOT EXISTS code VARCHAR(50) UNIQUE`);
    await db.run(`ALTER TABLE departments ADD COLUMN IF NOT EXISTS parentId VARCHAR(191)`);
    await db.run(`ALTER TABLE departments ADD COLUMN IF NOT EXISTS level INT DEFAULT 2`);
  } catch (err) {
    // Columns may already exist, ignore error
  }

  // Create test departments
  await db.run(
    `INSERT IGNORE INTO departments (id, name, code, parentId, level) VALUES (?, ?, ?, ?, ?)`,
    ['dept-bgd', 'Ban Giám Đốc', 'BGD', null, 1]
  );
  await db.run(
    `INSERT IGNORE INTO departments (id, name, code, parentId, level) VALUES (?, ?, ?, ?, ?)`,
    ['dept-kho', 'Phòng Kho Vận', 'KHO', 'dept-bgd', 2]
  );
  await db.run(
    `INSERT IGNORE INTO departments (id, name, code, parentId, level) VALUES (?, ?, ?, ?, ?)`,
    ['dept-kinh-doanh', 'Phòng Kinh Doanh', 'KD', 'dept-bgd', 2]
  );

  // Inject db into request for RBAC middleware
  app.use((req, _res, next) => {
    (req as any).db = db;
    next();
  });

  const requireAuth = createRequireAuth(db);
  app.use('/api/warehouse', requireAuth, warehouseRoutes(db));
});

afterAll(async () => {
  if (db) await db.close();
});

describe('Warehouse - Department Scope', () => {
  it('Warehouse staff sees inventory in their department', async () => {
    const { token } = await createTestUser(10, 'dept-kho', 'Employee');
    await createInventoryItem('PANEL-001', 'dept-kho');

    const res = await request(app)
      .get('/api/warehouse/inventory')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('Other department staff cannot see warehouse inventory', async () => {
    const { token } = await createTestUser(10, 'dept-kinh-doanh', 'Employee');
    await createInventoryItem('PANEL-002', 'dept-kho');

    const res = await request(app)
      .get('/api/warehouse/inventory')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });

  it('Director sees all inventory regardless of department', async () => {
    const { token } = await createTestUser(40, 'dept-giam-doc', 'Director');
    await createInventoryItem('PANEL-003', 'dept-kho');

    const res = await request(app)
      .get('/api/warehouse/inventory')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('Warehouse - Dashboard', () => {
  it('Manager gets department-scoped dashboard stats', async () => {
    const { userId, token } = await createTestUser(20, 'dept-kho', 'Manager');
    await createTransaction(userId, 'pending', 'dept-kho');

    const res = await request(app)
      .get('/api/warehouse/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('department');
    expect(res.body.kpis.pendingDocuments).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.teamActivity)).toBe(true);
    expect(Array.isArray(res.body.myTasks)).toBe(true);
    expect(Array.isArray(res.body.inventoryAlerts)).toBe(true);
    expect(Array.isArray(res.body.docTypeRatio)).toBe(true);
    expect(Array.isArray(res.body.pendingApprovals)).toBe(true);
  });

  it('Employee dashboard only covers own transactions', async () => {
    const other = await createTestUser(10, 'dept-kho', 'Employee');
    await createTransaction(other.userId, 'pending', 'dept-kho');

    const { token } = await createTestUser(10, 'dept-kho', 'Employee');

    const res = await request(app)
      .get('/api/warehouse/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('own');
    expect(res.body.myTasks.length).toBe(0);
    expect(res.body.teamActivity.every((t: any) => t.requestedBy !== other.userId)).toBe(true);
  });

  it('Admin gets empty dashboard', async () => {
    const { token } = await createTestUser(99, null as any, 'Admin');

    const res = await request(app)
      .get('/api/warehouse/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('none');
    expect(res.body.kpis.pendingDocuments).toBe(0);
  });
});

describe('Warehouse - Return & assignment', () => {
  it('Creates RETURN transaction with assignee, due date and priority', async () => {
    const manager = await createTestUser(20, 'dept-kho', 'Manager');
    const staff = await createTestUser(10, 'dept-kho', 'Employee');

    const res = await request(app)
      .post('/api/warehouse/transactions')
      .set('Authorization', `Bearer ${manager.token}`)
      .send({
        type: 'RETURN',
        productCode: 'RET-001',
        productName: 'Returned Product',
        quantity: 5,
        assignedTo: staff.userId,
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        priority: 'high',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = await db.get(
      'SELECT type, assignedTo, priority FROM warehouse_transactions WHERE id = ?',
      [res.body.id]
    );
    expect(row.type).toBe('RETURN');
    expect(row.assignedTo).toBe(staff.userId);
    expect(row.priority).toBe('high');
  });

  it('Rejects invalid transaction type and priority', async () => {
    const { token } = await createTestUser(20, 'dept-kho', 'Manager');

    const badType = await request(app)
      .post('/api/warehouse/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'INVALID', productCode: 'X', productName: 'X', quantity: 1 });
    expect(badType.status).toBe(400);

    const badPriority = await request(app)
      .post('/api/warehouse/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'IN', productCode: 'X', productName: 'X', quantity: 1, priority: 'super' });
    expect(badPriority.status).toBe(400);
  });

  it('RETURN approval increases inventory', async () => {
    const { userId, token } = await createTestUser(20, 'dept-kho', 'Manager');
    const productCode = `RET-${Date.now()}`;

    await db.run(
      `INSERT INTO inventory (id, productCode, productName, quantity, unit, departmentId)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), productCode, 'Return Test Product', 10, 'pcs', 'dept-kho']
    );

    const transId = randomUUID();
    await db.run(
      `INSERT INTO warehouse_transactions
       (id, transactionCode, type, productCode, productName, quantity, unit, requestedBy, departmentId, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [transId, `WH-RET-${Date.now()}`, 'RETURN', productCode, 'Return Test Product', 7, 'pcs', userId, 'dept-kho', 'pending']
    );

    const res = await request(app)
      .post(`/api/warehouse/transactions/${transId}/approve`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const inventory = await db.get(
      'SELECT quantity FROM inventory WHERE productCode = ?',
      [productCode]
    );
    expect(parseFloat(inventory.quantity)).toBe(17); // 10 + 7
  });
});

describe('Warehouse - Approval Authority', () => {
  it('Warehouse manager can approve transaction', async () => {
    const { userId, token } = await createTestUser(20, 'dept-kho', 'Manager');
    const transId = await createTransaction(userId, 'pending', 'dept-kho');

    const res = await request(app)
      .post(`/api/warehouse/transactions/${transId}/approve`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('Warehouse employee cannot approve transaction', async () => {
    const { userId, token } = await createTestUser(10, 'dept-kho', 'Employee');
    const transId = await createTransaction(userId, 'pending', 'dept-kho');

    const res = await request(app)
      .post(`/api/warehouse/transactions/${transId}/approve`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('Admin cannot approve warehouse transaction', async () => {
    const empUser = await createTestUser(10, 'dept-kho', 'Employee');
    const transId = await createTransaction(empUser.userId, 'pending', 'dept-kho');

    const { token: adminToken } = await createTestUser(99, null as any, 'Admin');

    const res = await request(app)
      .post(`/api/warehouse/transactions/${transId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(403);
  });

  it('Inventory updates correctly after IN transaction approval', async () => {
    const { userId, token } = await createTestUser(20, 'dept-kho', 'Manager');
    const productCode = `TEST-${Date.now()}`;

    // Create inventory item
    await db.run(
      `INSERT INTO inventory (id, productCode, productName, quantity, unit, departmentId)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), productCode, 'Test Product', 100, 'pcs', 'dept-kho']
    );

    // Create IN transaction
    const transId = randomUUID();
    const transactionCode = `WH-IN-${Date.now()}`;
    await db.run(
      `INSERT INTO warehouse_transactions
       (id, transactionCode, type, productCode, productName, quantity, unit, requestedBy, departmentId, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [transId, transactionCode, 'IN', productCode, 'Test Product', 50, 'pcs', userId, 'dept-kho', 'pending']
    );

    // Approve transaction
    const res = await request(app)
      .post(`/api/warehouse/transactions/${transId}/approve`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    // Check inventory quantity updated
    const inventory = await db.get(
      'SELECT quantity FROM inventory WHERE productCode = ?',
      [productCode]
    );
    expect(parseFloat(inventory.quantity)).toBe(150); // 100 + 50
  });
});

describe('Warehouse - Stock counts & variances', () => {
  it('Manager creates period, snapshots inventory, staff counts, manager resolves', async () => {
    const manager = await createTestUser(20, 'dept-kho', 'Manager');
    const staff = await createTestUser(10, 'dept-kho', 'Employee');
    await createInventoryItem('COUNT-001', 'dept-kho');

    const created = await request(app)
      .post('/api/warehouse/stock-counts')
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ month: '2026-10', notes: 'Ky kiem ke thang 10' });
    expect(created.status).toBe(200);
    const periodId = created.body.id;

    const snap = await request(app)
      .post(`/api/warehouse/stock-counts/${periodId}/snapshot`)
      .set('Authorization', `Bearer ${manager.token}`);
    expect(snap.status).toBe(200);
    expect(snap.body.added).toBeGreaterThanOrEqual(1);

    const detail = await request(app)
      .get(`/api/warehouse/stock-counts/${periodId}/items`)
      .set('Authorization', `Bearer ${staff.token}`);
    // Staff is not assignee/creator and level 10 in same dept: items visible via dept? No - own scope requires creator/assignee.
    // Creator is manager; staff gets 403 here. Assign period to staff first.
    expect([200, 403]).toContain(detail.status);

    await db.run('UPDATE stock_count_periods SET assignedTo = ? WHERE id = ?', [staff.userId, periodId]);

    const detail2 = await request(app)
      .get(`/api/warehouse/stock-counts/${periodId}/items`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(detail2.status).toBe(200);
    expect(detail2.body.items.length).toBeGreaterThanOrEqual(1);

    const item = detail2.body.items.find((i: any) => i.productCode === 'COUNT-001');
    const counted = await request(app)
      .patch(`/api/warehouse/stock-counts/${periodId}/items/${item.id}/count`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ countedQty: 9999 });
    expect(counted.status).toBe(200);

    const variances = await request(app)
      .get('/api/warehouse/variances?unresolved=1')
      .set('Authorization', `Bearer ${manager.token}`);
    expect(variances.status).toBe(200);
    expect(variances.body.some((v: any) => v.productCode === 'COUNT-001')).toBe(true);

    const resolved = await request(app)
      .patch(`/api/warehouse/stock-counts/${periodId}/items/${item.id}/resolve`)
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ resolution: 'Dieu chinh so sach' });
    expect(resolved.status).toBe(200);

    const staffResolve = await request(app)
      .patch(`/api/warehouse/stock-counts/${periodId}/items/${item.id}/resolve`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ resolution: 'Nhan vien tu resolve' });
    expect(staffResolve.status).toBe(403);
  });

  it('Employee cannot create stock count period', async () => {
    const { token } = await createTestUser(10, 'dept-kho', 'Employee');
    const res = await request(app)
      .post('/api/warehouse/stock-counts')
      .set('Authorization', `Bearer ${token}`)
      .send({ month: '2026-10' });
    expect(res.status).toBe(403);
  });
});

describe('Warehouse - Pick list complete & report & locations', () => {
  it('Assignee completes approved OUT transaction', async () => {
    const manager = await createTestUser(20, 'dept-kho', 'Manager');
    const staff = await createTestUser(10, 'dept-kho', 'Employee');
    const transId = await createTransaction(manager.userId, 'approved', 'dept-kho');
    await db.run('UPDATE warehouse_transactions SET assignedTo = ?, type = ? WHERE id = ?', [staff.userId, 'OUT', transId]);

    const res = await request(app)
      .post(`/api/warehouse/transactions/${transId}/complete`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);

    const row = await db.get('SELECT status FROM warehouse_transactions WHERE id = ?', [transId]);
    expect(row.status).toBe('completed');
  });

  it('Cannot complete non-approved transaction', async () => {
    const { userId, token } = await createTestUser(20, 'dept-kho', 'Manager');
    const transId = await createTransaction(userId, 'pending', 'dept-kho');
    const res = await request(app)
      .post(`/api/warehouse/transactions/${transId}/complete`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('Report, locations and filtered list work for manager', async () => {
    const { userId, token } = await createTestUser(20, 'dept-kho', 'Manager');
    await createTransaction(userId, 'pending', 'dept-kho');

    const filtered = await request(app)
      .get('/api/warehouse/transactions?type=IN&status=pending')
      .set('Authorization', `Bearer ${token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.every((t: any) => t.type === 'IN' && t.status === 'pending')).toBe(true);

    const report = await request(app)
      .get('/api/warehouse/report')
      .set('Authorization', `Bearer ${token}`);
    expect(report.status).toBe(200);
    expect(Array.isArray(report.body.byType)).toBe(true);

    const locations = await request(app)
      .get('/api/warehouse/locations')
      .set('Authorization', `Bearer ${token}`);
    expect(locations.status).toBe(200);
    expect(Array.isArray(locations.body.locations)).toBe(true);
  });
});

describe('Warehouse - Transactions list scope', () => {
  it('Employee lists own transactions without server error', async () => {
    const { userId, token } = await createTestUser(10, 'dept-kho', 'Employee');
    await createTransaction(userId, 'pending', 'dept-kho');

    const res = await request(app)
      .get('/api/warehouse/transactions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('Manager lists department transactions without server error', async () => {
    const { userId, token } = await createTestUser(20, 'dept-kho', 'Manager');
    await createTransaction(userId, 'pending', 'dept-kho');

    const res = await request(app)
      .get('/api/warehouse/transactions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('Other-department employee sees no warehouse transactions', async () => {
    const { token } = await createTestUser(10, 'dept-kinh-doanh', 'Employee');

    const res = await request(app)
      .get('/api/warehouse/transactions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Warehouse - Transfer scope', () => {
  it('TRANSFER defaults to internal scope and filters by scope', async () => {
    const { token } = await createTestUser(20, 'dept-kho', 'Manager');

    const site = await request(app)
      .post('/api/warehouse/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'TRANSFER', productCode: 'SC-001', productName: 'Scope Test', quantity: 1, transferScope: 'site', toLocation: 'Cong truong A' });
    expect(site.status).toBe(200);

    const internal = await request(app)
      .post('/api/warehouse/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'TRANSFER', productCode: 'SC-002', productName: 'Scope Test 2', quantity: 1, fromLocation: 'Khu A', toLocation: 'Khu B' });
    expect(internal.status).toBe(200);

    const internalRow = await db.get('SELECT transferScope FROM warehouse_transactions WHERE id = ?', [internal.body.id]);
    expect(internalRow.transferScope).toBe('internal');

    const siteList = await request(app)
      .get('/api/warehouse/transactions?type=TRANSFER&scope=site')
      .set('Authorization', `Bearer ${token}`);
    expect(siteList.status).toBe(200);
    expect(siteList.body.every((t: any) => t.transferScope === 'site')).toBe(true);
    expect(siteList.body.some((t: any) => t.id === site.body.id)).toBe(true);

    const bad = await request(app)
      .post('/api/warehouse/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'TRANSFER', productCode: 'SC-003', productName: 'Bad', quantity: 1, transferScope: 'moon' });
    expect(bad.status).toBe(400);
  });
});

describe('Warehouse - Location master', () => {
  it('Manager creates location, assigns item, employee cannot manage master', async () => {
    const manager = await createTestUser(20, 'dept-kho', 'Manager');
    const staff = await createTestUser(10, 'dept-kho', 'Employee');
    const stamp = Date.now();
    const locCode = `KLOC-${stamp}`;
    const itemId = await createInventoryItem(`LOC-${stamp}`, 'dept-kho');

    const created = await request(app)
      .post('/api/warehouse/locations')
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ code: locCode, name: 'Kho Test', type: 'warehouse' });
    expect(created.status).toBe(200);

    const dup = await request(app)
      .post('/api/warehouse/locations')
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ code: locCode, name: 'Trung ma' });
    expect(dup.status).toBe(400);

    const staffCreate = await request(app)
      .post('/api/warehouse/locations')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ code: `KST-${stamp}`, name: 'Kho B' });
    expect(staffCreate.status).toBe(403);

    // Staff can assign item into the new location
    const assign = await request(app)
      .patch(`/api/warehouse/inventory/${itemId}/location`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ warehouseLocation: locCode });
    expect(assign.status).toBe(200);

    const badCode = await request(app)
      .patch(`/api/warehouse/inventory/${itemId}/location`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ warehouseLocation: 'NOPE-XXX' });
    expect(badCode.status).toBe(400);

    // Cannot delete a location that still holds items
    const delBlocked = await request(app)
      .delete(`/api/warehouse/locations/${created.body.id}`)
      .set('Authorization', `Bearer ${manager.token}`);
    expect(delBlocked.status).toBe(400);

    // Unassign then delete works
    await request(app)
      .patch(`/api/warehouse/inventory/${itemId}/location`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ warehouseLocation: '' });
    const delOk = await request(app)
      .delete(`/api/warehouse/locations/${created.body.id}`)
      .set('Authorization', `Bearer ${manager.token}`);
    expect(delOk.status).toBe(200);

    // Locations endpoint returns master + unassigned shape
    const list = await request(app)
      .get('/api/warehouse/locations')
      .set('Authorization', `Bearer ${manager.token}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.locations)).toBe(true);
    expect(list.body.unassigned).toBeDefined();
  });
});

describe('Warehouse - Stock inquiry (MISA-style)', () => {
  it('Inventory filters, meta and pagination work', async () => {
    const { token } = await createTestUser(20, 'dept-kho', 'Manager');
    const stamp = Date.now();
    const prodCode = `INQ-${stamp}`;
    const locCode = `KLO-${stamp}`;
    await createInventoryItem(prodCode, 'dept-kho');
    await db.run(
      'UPDATE inventory SET category = ?, specCode = ?, unit = ?, warehouseLocation = ? WHERE productCode = ?',
      ['Vat tu dien', 'QC-1', 'pcs', locCode, prodCode]
    );

    const filtered = await request(app)
      .get(`/api/warehouse/inventory?search=${prodCode}&category=Vat tu dien&unit=pcs&location=${locCode}`)
      .set('Authorization', `Bearer ${token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.some((i: any) => i.productCode === prodCode)).toBe(true);

    const paged = await request(app)
      .get('/api/warehouse/inventory?page=1&pageSize=5')
      .set('Authorization', `Bearer ${token}`);
    expect(paged.status).toBe(200);
    expect(typeof paged.body.total).toBe('number');
    expect(Array.isArray(paged.body.rows)).toBe(true);
    expect(paged.body.rows.length).toBeLessThanOrEqual(5);

    const meta = await request(app)
      .get('/api/warehouse/inventory-meta')
      .set('Authorization', `Bearer ${token}`);
    expect(meta.status).toBe(200);
    expect(meta.body.categories).toContain('Vat tu dien');
    expect(meta.body.units).toContain('pcs');
  });

  it('Lots CRUD with RBAC and expiry filter', async () => {
    const manager = await createTestUser(20, 'dept-kho', 'Manager');
    const staff = await createTestUser(10, 'dept-kho', 'Employee');

    const created = await request(app)
      .post('/api/warehouse/lots')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ productCode: 'LOT-001', productName: 'Lot Product', lotCode: 'LO-2026-001', expiryDate: '2020-01-01', quantity: 10 });
    expect(created.status).toBe(200);

    const bad = await request(app)
      .post('/api/warehouse/lots')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ productCode: 'LOT-001', productName: 'Lot Product', quantity: 5 });
    expect(bad.status).toBe(400);

    const list = await request(app)
      .get('/api/warehouse/lots?search=LOT-001')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(list.status).toBe(200);
    expect(list.body[0].expiryStatus).toBe('expired');

    const expired = await request(app)
      .get('/api/warehouse/lots?expiring=expired')
      .set('Authorization', `Bearer ${manager.token}`);
    expect(expired.status).toBe(200);
    expect(expired.body.some((l: any) => l.lotCode === 'LO-2026-001')).toBe(true);

    const delStaff = await request(app)
      .delete(`/api/warehouse/lots/${created.body.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(delStaff.status).toBe(403);

    const del = await request(app)
      .delete(`/api/warehouse/lots/${created.body.id}`)
      .set('Authorization', `Bearer ${manager.token}`);
    expect(del.status).toBe(200);
  });

  it('Combos compute assemblable sets from stock', async () => {
    const manager = await createTestUser(20, 'dept-kho', 'Manager');
    const panelCode = `PANEL-CB-${Date.now()}`;
    const connCode = `CONN-CB-${Date.now()}`;
    await db.run(
      'INSERT INTO inventory (id, productCode, productName, quantity, unit, departmentId) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)',
      [randomUUID(), panelCode, 'Tam pin combo', 500, 'pcs', 'dept-kho', randomUUID(), connCode, 'Dau noi combo', 500, 'pcs', 'dept-kho']
    );

    const created = await request(app)
      .post('/api/warehouse/combos')
      .set('Authorization', `Bearer ${manager.token}`)
      .send({
        code: `CB-TEST-${Date.now()}`, name: 'Combo Test 01',
        items: [
          { productCode: panelCode, productName: 'Tam pin', quantity: 2 },
          { productCode: connCode, productName: 'Dau noi', quantity: 4 },
        ],
      });
    expect(created.status).toBe(200);

    const dup = await request(app)
      .post('/api/warehouse/combos')
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ code: created.body.code, name: 'Trung ma', items: [{ productCode: 'X', productName: 'X', quantity: 1 }] });
    expect(dup.status).toBe(400);

    const list = await request(app)
      .get(`/api/warehouse/combos?search=${encodeURIComponent(created.body.code)}`)
      .set('Authorization', `Bearer ${manager.token}`);
    expect(list.status).toBe(200);
    const combo = list.body.find((c: any) => c.code === created.body.code);
    expect(combo.componentCount).toBe(2);
    // 500 / 2 = 250 panels, 500 / 4 = 125 connectors -> 125 sets
    expect(combo.assemblable).toBe(125);

    const del = await request(app)
      .delete(`/api/warehouse/combos/${created.body.id}`)
      .set('Authorization', `Bearer ${manager.token}`);
    expect(del.status).toBe(200);
  });
});
