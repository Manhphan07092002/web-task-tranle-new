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
