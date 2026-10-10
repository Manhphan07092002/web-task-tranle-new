import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { randomUUID } from 'crypto';
import { initDbMysql } from '../db_mysql.js';
import { warehouseMasterRoutes } from '../routes/warehouseMaster.js';
import { createRequireAuth } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-master-secret';
const JWT_SECRET = process.env.JWT_SECRET;
const app = express();
app.use(express.json());

let db: any;

async function createTestUser(role: string, permissions: string[]) {
  const userId = randomUUID();
  const email = `master-${Date.now()}-${Math.random()}@example.com`;
  await db.run(
    `INSERT INTO users (id, name, email, password, role, managementLevel, primaryDepartmentId, department, avatar)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, 'Master Test', email, 'hashedpass', role, 20, 'dept-kho', 'Kho Van', '']
  );
  const roleRow: any = await db.get('SELECT permissions FROM roles WHERE name = ?', [role]);
  const base: string[] = roleRow?.permissions ? JSON.parse(roleRow.permissions) : [];
  await db.run('UPDATE users SET role = ? WHERE id = ?', [`Tmp${Date.now()}`, userId]);
  const tmpRole = `TmpRole${Date.now()}${Math.floor(Math.random() * 1000)}`;
  await db.run('INSERT INTO roles (id, name, description, color, permissions, isSystem) VALUES (?, ?, ?, ?, ?, ?)',
    [randomUUID(), tmpRole, '', '#000', JSON.stringify([...new Set([...base, ...permissions])]), 0]);
  await db.run('UPDATE users SET role = ? WHERE id = ?', [tmpRole, userId]);
  const token = jwt.sign({ sub: userId, tokenVersion: 0 }, JWT_SECRET, { expiresIn: '1h' });
  return { userId, token };
}

beforeAll(async () => {
  db = await initDbMysql();
  const requireAuth = createRequireAuth(db);
  app.use('/api/warehouse', requireAuth, warehouseMasterRoutes(db));
});

afterAll(async () => {
  if (db) await db.close();
});

describe('Warehouse master - products', () => {
  it('Manager with stock.manage creates/updates/deletes product', async () => {
    const { token } = await createTestUser('Manager', []);
    const code = `SP-${Date.now()}`;

    const created = await request(app).post('/api/warehouse/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ code, name: 'Tam pin test', brand: 'SAJ', tracking: 'SERIAL', warrantyMonths: 12 });
    expect(created.status).toBe(200);

    const dup = await request(app).post('/api/warehouse/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ code, name: 'Trung ma' });
    expect(dup.status).toBe(400);

    const badTracking = await request(app).post('/api/warehouse/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: `${code}-X`, name: 'Bad', tracking: ' quantum ' });
    expect(badTracking.status).toBe(400);

    const list = await request(app).get('/api/warehouse/products?search=' + code)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.some((p: any) => p.code === code)).toBe(true);

    const updated = await request(app).patch(`/api/warehouse/products/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ minStock: 5, maxStock: 100 });
    expect(updated.status).toBe(200);

    const deleted = await request(app).delete(`/api/warehouse/products/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleted.status).toBe(200);
  });

  it('Employee without stock.manage cannot write master data', async () => {
    // Strip stock.manage from a fresh role
    const userId = randomUUID();
    const email = `noaccess-${Date.now()}@example.com`;
    await db.run(
      `INSERT INTO users (id, name, email, password, role, managementLevel, primaryDepartmentId, department, avatar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, 'No Access', email, 'hashedpass', 'Employee', 10, 'dept-kho', 'Kho Van', '']
    );
    const bareRole = `Bare${Date.now()}`;
    await db.run('INSERT INTO roles (id, name, description, color, permissions, isSystem) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), bareRole, '', '#000', JSON.stringify(['view_own_tasks']), 0]);
    await db.run('UPDATE users SET role = ? WHERE id = ?', [bareRole, userId]);
    const token = jwt.sign({ sub: userId, tokenVersion: 0 }, JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app).post('/api/warehouse/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: `SP-DENY-${Date.now()}`, name: 'Denied' });
    expect(res.status).toBe(403);

    const list = await request(app).get('/api/warehouse/products')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
  });
});

describe('Warehouse master - warehouses & locations', () => {
  it('CRUD warehouse with location guard', async () => {
    const { token } = await createTestUser('Manager', []);
    const code = `WH-${Date.now()}`;

    const created = await request(app).post('/api/warehouse/warehouses')
      .set('Authorization', `Bearer ${token}`)
      .send({ code, name: 'Kho Test', region: 'Da Nang' });
    expect(created.status).toBe(200);

    const loc = await request(app).post('/api/warehouse/locations')
      .set('Authorization', `Bearer ${token}`)
      .send({ warehouseId: created.body.id, code: `${code}-A-01`, name: 'Khu A', type: 'INTERNAL', purpose: 'SALEABLE' });
    expect(loc.status).toBe(200);

    const badParent = await request(app).post('/api/warehouse/locations')
      .set('Authorization', `Bearer ${token}`)
      .send({ warehouseId: created.body.id, code: `${code}-X`, name: 'Bad', parentId: 'no-such-id' });
    expect(badParent.status).toBe(400);

    const delBlocked = await request(app).delete(`/api/warehouse/warehouses/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delBlocked.status).toBe(400);

    const list = await request(app).get('/api/warehouse/locations?warehouseId=' + created.body.id)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);

    await request(app).delete(`/api/warehouse/locations/${loc.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    const delOk = await request(app).delete(`/api/warehouse/warehouses/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delOk.status).toBe(200);
  });
});
