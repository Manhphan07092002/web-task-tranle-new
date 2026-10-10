import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { randomUUID } from 'crypto';
import { initDbMysql } from '../db_mysql.js';
import { warehouseMasterRoutes } from '../routes/warehouseMaster.js';
import { warehouseDocsRoutes } from '../routes/warehouseDocs.js';
import { warehouseStockRoutes } from '../routes/warehouseStock.js';
import { warehouseSerialsRoutes } from '../routes/warehouseSerials.js';
import { warehouseCountsRoutes } from '../routes/warehouseCounts.js';
import { warehouseAlertsRoutes } from '../routes/warehouseAlerts.js';
import { warehouseBundlesRoutes } from '../routes/warehouseBundles.js';
import { createRequireAuth } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-docs-secret';
const JWT_SECRET = process.env.JWT_SECRET;
const app = express();
app.use(express.json());

let db: any;
let productId: string;
let warehouseId: string;
let locationId: string;

async function createTestUser(managementLevel: number, permissions: string[]) {
  const userId = randomUUID();
  const email = `docs-${Date.now()}-${Math.random()}@example.com`;
  await db.run(
    `INSERT INTO users (id, name, email, password, role, managementLevel, primaryDepartmentId, department, avatar)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, 'Docs Test', email, 'hashedpass', 'Employee', managementLevel, 'dept-kho', 'Kho Van', '']
  );
  const roleName = `DocsRole${Date.now()}${Math.floor(Math.random() * 100000)}`;
  await db.run('INSERT INTO roles (id, name, description, color, permissions, isSystem) VALUES (?, ?, ?, ?, ?, ?)',
    [randomUUID(), roleName, '', '#000', JSON.stringify(permissions), 0]);
  await db.run('UPDATE users SET role = ? WHERE id = ?', [roleName, userId]);
  const token = jwt.sign({ sub: userId, tokenVersion: 0 }, JWT_SECRET, { expiresIn: '1h' });
  return { userId, token };
}

beforeAll(async () => {
  db = await initDbMysql();
  // Mirror production server.ts: run every request inside a DB request context
  app.use((_req, _res, next) => db.runWithRequestContext(next));
  const requireAuth = createRequireAuth(db);
  app.use('/api/warehouse', requireAuth, warehouseMasterRoutes(db));
  app.use('/api/warehouse', requireAuth, warehouseDocsRoutes(db));
  app.use('/api/warehouse', requireAuth, warehouseStockRoutes(db));
  app.use('/api/warehouse', requireAuth, warehouseSerialsRoutes(db));
  app.use('/api/warehouse', requireAuth, warehouseCountsRoutes(db));
  app.use('/api/warehouse', requireAuth, warehouseAlertsRoutes(db));
  app.use('/api/warehouse', requireAuth, warehouseBundlesRoutes(db));

  const stamp = Date.now();
  const p: any = await db.run(
    `INSERT INTO stock_products (id, code, name, unit) VALUES (?, ?, ?, ?)`,
    [randomUUID(), `DOC-SP-${stamp}`, 'Doc Test Product', 'pcs']
  );
  void p;
  const prod: any = await db.get('SELECT id FROM stock_products WHERE code = ?', [`DOC-SP-${stamp}`]);
  productId = prod.id;
  const w: any = await db.run(
    `INSERT INTO warehouses (id, code, name) VALUES (?, ?, ?)`,
    [randomUUID(), `DOC-WH-${stamp}`, 'Doc Test Warehouse']
  );
  void w;
  const wh: any = await db.get('SELECT id FROM warehouses WHERE code = ?', [`DOC-WH-${stamp}`]);
  warehouseId = wh.id;
  const l: any = await db.run(
    `INSERT INTO warehouse_locations (id, warehouseId, code, name) VALUES (?, ?, ?, ?)`,
    [randomUUID(), warehouseId, `DOC-LOC-${stamp}`, 'Doc Test Location']
  );
  void l;
  const loc: any = await db.get('SELECT id FROM warehouse_locations WHERE code = ?', [`DOC-LOC-${stamp}`]);
  locationId = loc.id;
});

afterAll(async () => {
  if (db) await db.close();
});

describe('Warehouse docs - receipt lifecycle', () => {
  it('TP creates, confirms, staff receives, completes; moves + balances emitted', async () => {
    const tp = await createTestUser(20, ['stock.manage', 'stock.receive']);
    const staff = await createTestUser(10, ['stock.receive']);

    const created = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({
        warehouseId, supplierName: 'SAJ', assigneeId: staff.userId,
        lines: [{ productId, qtyOrdered: 10, locationId }],
      });
    expect(created.status).toBe(200);
    expect(created.body.code).toMatch(/^PNK-/);
    const docId = created.body.id;

    // Staff cannot confirm without involvement? staff IS assignee -> involved but not creator/manager
    const staffConfirm = await request(app).patch(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ status: 'CONFIRMED' });
    expect(staffConfirm.status).toBe(400);

    const confirmed = await request(app).patch(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ status: 'CONFIRMED' });
    expect(confirmed.status).toBe(200);

    // Partial receive auto-moves to RECEIVING
    const recv1 = await request(app).post(`/api/warehouse/documents/${docId}/lines/any/receive`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ qty: 4 });
    expect(recv1.status).toBe(404); // wrong line id

    const detail: any = await request(app).get(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(detail.status).toBe(200);
    const lineId = detail.body.lines[0].id;

    const recv = await request(app).post(`/api/warehouse/documents/${docId}/lines/${lineId}/receive`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ qty: 4 });
    expect(recv.status).toBe(200);
    expect(recv.body.qtyReceived).toBe(4);

    // Over-receipt blocked
    const over = await request(app).post(`/api/warehouse/documents/${docId}/lines/${lineId}/receive`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ qty: 7 });
    expect(over.status).toBe(400);

    // Complete blocked while incomplete
    const earlyComplete = await request(app).post(`/api/warehouse/documents/${docId}/complete`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(earlyComplete.status).toBe(400);

    await request(app).post(`/api/warehouse/documents/${docId}/lines/${lineId}/receive`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ qty: 6 });

    const done = await request(app).post(`/api/warehouse/documents/${docId}/complete`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(done.status).toBe(200);

    // Moves emitted exactly once, balances updated
    const moves: any = await db.all('SELECT * FROM stock_moves WHERE docId = ?', [docId]);
    expect(moves.length).toBe(1);
    expect(Number(moves[0].qty)).toBe(10);
    expect(moves[0].moveType).toBe('RECEIPT');

    const bal: any = await db.get(
      'SELECT onHand, reserved FROM stock_balances WHERE productId = ? AND warehouseId = ?',
      [productId, warehouseId]
    );
    expect(Number(bal.onHand)).toBe(10);
    expect(Number(bal.reserved)).toBe(0);

    const balances = await request(app).get('/api/warehouse/balances')
      .set('Authorization', `Bearer ${tp.token}`);
    expect(balances.status).toBe(200);
    const row = balances.body.find((b: any) => b.productId === productId && b.warehouseId === warehouseId);
    expect(row.available).toBe(10);

    // Double complete blocked (no longer RECEIVING)
    const again = await request(app).post(`/api/warehouse/documents/${docId}/complete`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(again.status).toBe(400);
  });

  it('Employee without assignment cannot see or touch others docs', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const outsider = await createTestUser(10, ['stock.receive']);

    const created = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ warehouseId, lines: [{ productId, qtyOrdered: 2 }] });
    const docId = created.body.id;

    const detail = await request(app).get(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(detail.status).toBe(403);

    const list: any = await request(app).get('/api/warehouse/documents')
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(list.status).toBe(200);
    expect(list.body.some((d: any) => d.id === docId)).toBe(false);
  });

  it('Cancel rules enforced', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const created = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ warehouseId, lines: [{ productId, qtyOrdered: 1 }] });
    const docId = created.body.id;

    const cancel = await request(app).post(`/api/warehouse/documents/${docId}/cancel`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(cancel.status).toBe(200);

    const cancelAgain = await request(app).post(`/api/warehouse/documents/${docId}/cancel`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(cancelAgain.status).toBe(400);
  });

  it('Create validates warehouse, product, assignee', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const noLines = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ warehouseId, lines: [] });
    expect(noLines.status).toBe(400);

    const badProduct = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ warehouseId, lines: [{ productId: 'nope', qtyOrdered: 1 }] });
    expect(badProduct.status).toBe(400);

    const badWh = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ warehouseId: 'nope', lines: [{ productId, qtyOrdered: 1 }] });
    expect(badWh.status).toBe(400);
  });
});

describe('Warehouse docs - issue lifecycle', () => {
  it('TP creates issue, staff picks within available, handover, completes with -moves', async () => {
    const tp = await createTestUser(20, ['stock.manage', 'stock.issue']);
    const staff = await createTestUser(10, ['stock.issue']);

    // Seed available stock: 20 on hand via a completed receipt
    const receipt = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ warehouseId, lines: [{ productId, qtyOrdered: 20 }] });
    const receiptId = receipt.body.id;
    await request(app).patch(`/api/warehouse/documents/${receiptId}`)
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ status: 'CONFIRMED' });
    const receiptDetail: any = await request(app).get(`/api/warehouse/documents/${receiptId}`)
      .set('Authorization', `Bearer ${tp.token}`);
    const receiptLine = receiptDetail.body.lines[0].id;
    await request(app).post(`/api/warehouse/documents/${receiptId}/lines/${receiptLine}/receive`)
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ qty: 20 });
    await request(app).post(`/api/warehouse/documents/${receiptId}/complete`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect((await request(app).get(`/api/warehouse/documents/${receiptId}`)
      .set('Authorization', `Bearer ${tp.token}`)).body.status).toBe('DONE');

    // Create issue for 8 units, assign staff
    const created = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ type: 'ISSUE', warehouseId, assigneeId: staff.userId, lines: [{ productId, qtyOrdered: 8 }] });
    expect(created.status).toBe(200);
    expect(created.body.code).toMatch(/^PXK-/);
    const docId = created.body.id;

    await request(app).patch(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ status: 'CONFIRMED' });

    const detail: any = await request(app).get(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${staff.token}`);
    const lineId = detail.body.lines[0].id;

    // Over-pick blocked (more than available 20? no - more than ordered 8)
    const over = await request(app).post(`/api/warehouse/documents/${docId}/lines/${lineId}/pick`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ qty: 9 });
    expect(over.status).toBe(400);

    const pick = await request(app).post(`/api/warehouse/documents/${docId}/lines/${lineId}/pick`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ qty: 8 });
    expect(pick.status).toBe(200);

    // Handover requires full pick (it is full) -> READY
    const ready = await request(app).patch(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ status: 'READY' });
    expect(ready.status).toBe(200);

    const done = await request(app).post(`/api/warehouse/documents/${docId}/complete`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(done.status).toBe(200);

    // Balances: 20 - 8 = 12 on hand; moves: +20 RECEIPT, -8 ISSUE (for these docs)
    const bal: any = await db.get(
      'SELECT onHand FROM stock_balances WHERE productId = ? AND warehouseId = ?',
      [productId, warehouseId]
    );
    expect(Number(bal.onHand)).toBe(12);
    const moves: any = await db.all(
      'SELECT moveType, qty FROM stock_moves WHERE docId IN (?, ?) ORDER BY createdAt ASC',
      [receiptId, docId]
    );
    expect(moves.map((m: any) => [m.moveType, Number(m.qty)]).sort())
      .toEqual([['ISSUE', -8], ['RECEIPT', 20]]);
  });

  it('Pick beyond available stock blocked; quarantine locations rejected', async () => {
    const tp = await createTestUser(20, ['stock.manage', 'stock.issue']);
    const staff = await createTestUser(10, ['stock.issue']);
    // Fresh product with zero stock
    const stamp = Date.now();
    await db.run('INSERT INTO stock_products (id, code, name, unit) VALUES (?, ?, ?, ?)',
      [randomUUID(), `NOP-${stamp}`, 'No Stock Product', 'pcs']);
    const fresh: any = await db.get('SELECT id FROM stock_products WHERE code = ?', [`NOP-${stamp}`]);

    const created = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ type: 'ISSUE', warehouseId, assigneeId: staff.userId, lines: [{ productId: fresh.id, qtyOrdered: 5 }] });
    const docId = created.body.id;
    await request(app).patch(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ status: 'CONFIRMED' });
    const detail: any = await request(app).get(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${staff.token}`);
    const lineId = detail.body.lines[0].id;

    // Zero available -> any pick blocked
    const short = await request(app).post(`/api/warehouse/documents/${docId}/lines/${lineId}/pick`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ qty: 1 });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/Insufficient stock/);

    // Quarantine location rejected
    const qCode = `Q-${Date.now()}`;
    const qloc: any = await db.run(
      'INSERT INTO warehouse_locations (id, warehouseId, code, name, purpose) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), warehouseId, qCode, 'Quarantine', 'QUARANTINE']
    );
    void qloc;
    const qrow: any = await db.get('SELECT id FROM warehouse_locations WHERE code = ?', [qCode]);
    const qpick = await request(app).post(`/api/warehouse/documents/${docId}/lines/${lineId}/pick`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ qty: 1, locationId: qrow.id });
    expect(qpick.status).toBe(400);
    expect(qpick.body.error).toMatch(/Cannot pick from/);
  });

  it('Issue uses pick endpoint, not receive; receipt uses receive, not pick', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const created = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ type: 'ISSUE', warehouseId, lines: [{ productId, qtyOrdered: 1 }] });
    const docId = created.body.id;
    const detail: any = await request(app).get(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${tp.token}`);
    const lineId = detail.body.lines[0].id;

    const wrong = await request(app).post(`/api/warehouse/documents/${docId}/lines/${lineId}/receive`)
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ qty: 1 });
    expect(wrong.status).toBe(400);
  });
});

describe('Warehouse docs - transfer lifecycle', () => {
  it('TP creates, sender sends, receiver confirms with shortage, TP finalizes both-side moves', async () => {
    const tp = await createTestUser(20, ['stock.manage', 'stock.transfer']);
    const sender = await createTestUser(10, ['stock.transfer']);
    const receiver = await createTestUser(10, ['stock.transfer']);

    // Second warehouse for destination
    const stamp = Date.now();
    await db.run('INSERT INTO warehouses (id, code, name) VALUES (?, ?, ?)',
      [randomUUID(), `TR-WH-${stamp}`, 'Transfer Dest Warehouse']);
    const dest: any = await db.get('SELECT id FROM warehouses WHERE code = ?', [`TR-WH-${stamp}`]);

    // Seed 30 units at source via receipt
    const beforeSrc: any = await db.get(
      'SELECT COALESCE(SUM(onHand), 0) AS t FROM stock_balances WHERE productId = ? AND warehouseId = ?',
      [productId, warehouseId]
    );
    const srcBefore = Number(beforeSrc.t);
    const receipt = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ warehouseId, lines: [{ productId, qtyOrdered: 30 }] });
    const receiptId = receipt.body.id;
    await request(app).patch(`/api/warehouse/documents/${receiptId}`)
      .set('Authorization', `Bearer ${tp.token}`).send({ status: 'CONFIRMED' });
    const rDetail: any = await request(app).get(`/api/warehouse/documents/${receiptId}`)
      .set('Authorization', `Bearer ${tp.token}`);
    await request(app).post(`/api/warehouse/documents/${receiptId}/lines/${rDetail.body.lines[0].id}/receive`)
      .set('Authorization', `Bearer ${tp.token}`).send({ qty: 30 });
    await request(app).post(`/api/warehouse/documents/${receiptId}/complete`)
      .set('Authorization', `Bearer ${tp.token}`);

    // Create transfer 10 units source -> dest
    const created = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({
        type: 'TRANSFER', warehouseId, toWarehouseId: dest.id,
        assigneeId: sender.userId, receiverId: receiver.userId,
        lines: [{ productId, qtyOrdered: 10 }],
      });
    expect(created.status).toBe(200);
    expect(created.body.code).toMatch(/^DCK-/);
    const docId = created.body.id;

    // Same-warehouse transfer rejected
    const sameWh = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ type: 'TRANSFER', warehouseId, toWarehouseId: warehouseId, lines: [{ productId, qtyOrdered: 1 }] });
    expect(sameWh.status).toBe(400);

    await request(app).patch(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${tp.token}`).send({ status: 'CONFIRMED' });

    // Receiver cannot send; sender cannot receive
    const recvBySender = await request(app).patch(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${receiver.token}`).send({ status: 'IN_TRANSIT' });
    expect(recvBySender.status).toBe(400);
    const sendByReceiver = await request(app).patch(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${receiver.token}`).send({ status: 'RECEIVED' });
    expect(sendByReceiver.status).toBe(400);

    // Sender confirms send
    const sent = await request(app).patch(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${sender.token}`).send({ status: 'IN_TRANSIT' });
    expect(sent.status).toBe(200);

    const detail: any = await request(app).get(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${receiver.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.toWarehouseCode).toBe(`TR-WH-${stamp}`);
    const lineId = detail.body.lines[0].id;

    // Receiver confirms only 8 of 10 with damage note (shortage)
    const recv = await request(app).post(`/api/warehouse/documents/${docId}/lines/${lineId}/transfer-receive`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ qty: 8, notes: 'Vo 2 bo khi van chuyen' });
    expect(recv.status).toBe(200);

    // Receiver cannot finalize; TP finalizes
    const recvFinalize = await request(app).post(`/api/warehouse/documents/${docId}/complete`)
      .set('Authorization', `Bearer ${receiver.token}`);
    expect(recvFinalize.status).toBe(403);
    const done = await request(app).post(`/api/warehouse/documents/${docId}/complete`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(done.status).toBe(200);

    // Source: -10 ordered (sent), dest: +8 confirmed (shortage documented)
    const srcBal: any = await db.get(
      'SELECT COALESCE(SUM(onHand), 0) AS t FROM stock_balances WHERE productId = ? AND warehouseId = ?', [productId, warehouseId]);
    const destBal: any = await db.get(
      'SELECT COALESCE(SUM(onHand), 0) AS t FROM stock_balances WHERE productId = ? AND warehouseId = ?', [productId, dest.id]);
    expect(Number(srcBal.t)).toBe(srcBefore + 30 - 10);
    expect(Number(destBal.t)).toBe(8);

    // Both-side moves recorded
    const moves: any = await db.all(
      'SELECT warehouseId, qty FROM stock_moves WHERE docId = ?', [docId]);
    expect(moves.length).toBe(2);
    const byWh: any = {};
    moves.forEach((m: any) => { byWh[m.warehouseId] = Number(m.qty); });
    expect(byWh[warehouseId]).toBe(-10);
    expect(byWh[dest.id]).toBe(8);
  });

  it('Transfer cancel rules and overdue visibility', async () => {
    const tp = await createTestUser(20, ['stock.manage', 'stock.transfer']);
    const stamp = Date.now();
    await db.run('INSERT INTO warehouses (id, code, name) VALUES (?, ?, ?)',
      [randomUUID(), `TR-WH2-${stamp}`, 'Transfer Dest 2']);
    const dest: any = await db.get('SELECT id FROM warehouses WHERE code = ?', [`TR-WH2-${stamp}`]);

    const created = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ type: 'TRANSFER', warehouseId, toWarehouseId: dest.id, lines: [{ productId, qtyOrdered: 1 }] });
    const docId = created.body.id;

    const cancel = await request(app).post(`/api/warehouse/documents/${docId}/cancel`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(cancel.status).toBe(200);

    const list: any = await request(app).get('/api/warehouse/documents?type=TRANSFER&status=CANCELLED')
      .set('Authorization', `Bearer ${tp.token}`);
    expect(list.status).toBe(200);
    expect(list.body.some((d: any) => d.id === docId)).toBe(true);
  });
});

describe('Warehouse docs - reservations', () => {
  it('TP reserves from available, releases remainder, issue consumes FIFO', async () => {
    const tp = await createTestUser(20, ['stock.manage', 'stock.issue']);
    const staff = await createTestUser(10, ['stock.issue']);
    const before: any = await db.get(
      'SELECT COALESCE(SUM(onHand), 0) AS t, COALESCE(SUM(reserved), 0) AS r FROM stock_balances WHERE productId = ? AND warehouseId = ?',
      [productId, warehouseId]);
    const baseOn = Number(before.t);
    const baseRes = Number(before.r);

    // Seed 20 on hand via receipt
    const receipt = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ warehouseId, lines: [{ productId, qtyOrdered: 20 }] });
    const receiptId = receipt.body.id;
    await request(app).patch(`/api/warehouse/documents/${receiptId}`)
      .set('Authorization', `Bearer ${tp.token}`).send({ status: 'CONFIRMED' });
    const rDetail: any = await request(app).get(`/api/warehouse/documents/${receiptId}`)
      .set('Authorization', `Bearer ${tp.token}`);
    await request(app).post(`/api/warehouse/documents/${receiptId}/lines/${rDetail.body.lines[0].id}/receive`)
      .set('Authorization', `Bearer ${tp.token}`).send({ qty: 20 });
    await request(app).post(`/api/warehouse/documents/${receiptId}/complete`)
      .set('Authorization', `Bearer ${tp.token}`);

    // Over-reserve blocked (more than currently available)
    const availBefore: any = await db.get(
      'SELECT COALESCE(SUM(onHand - reserved), 0) AS a FROM stock_balances WHERE productId = ? AND warehouseId = ?',
      [productId, warehouseId]);
    const over = await request(app).post('/api/warehouse/reservations')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ productId, warehouseId, qty: Number(availBefore.a) + 5, sourceType: 'INTERNAL', sourceId: 'SO-001' });
    expect(over.status).toBe(400);

    // Reserve 12 for SO-001 assigned to staff
    const res1 = await request(app).post('/api/warehouse/reservations')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ productId, warehouseId, qty: 12, sourceType: 'SALES_ORDER', sourceId: 'SO-001', assigneeId: staff.userId });
    expect(res1.status).toBe(200);

    // Available now 8 (on top of pre-existing base)
    const bal1: any = await db.get(
      'SELECT COALESCE(SUM(onHand), 0) AS t, COALESCE(SUM(reserved), 0) AS r FROM stock_balances WHERE productId = ? AND warehouseId = ?',
      [productId, warehouseId]);
    expect(Number(bal1.t)).toBe(baseOn + 20);
    expect(Number(bal1.r)).toBe(baseRes + 12);

    // Staff sees the reservation assigned to them
    const staffList: any = await request(app).get('/api/warehouse/reservations')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(staffList.status).toBe(200);
    expect(staffList.body.some((r: any) => r.id === res1.body.id)).toBe(true);

    // Issue 5: consumes 5 of the reservation (FIFO), reserved drops accordingly
    const issue = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ type: 'ISSUE', warehouseId, assigneeId: staff.userId, lines: [{ productId, qtyOrdered: 5 }] });
    const issueId = issue.body.id;
    await request(app).patch(`/api/warehouse/documents/${issueId}`)
      .set('Authorization', `Bearer ${tp.token}`).send({ status: 'CONFIRMED' });
    const iDetail: any = await request(app).get(`/api/warehouse/documents/${issueId}`)
      .set('Authorization', `Bearer ${staff.token}`);
    await request(app).post(`/api/warehouse/documents/${issueId}/lines/${iDetail.body.lines[0].id}/pick`)
      .set('Authorization', `Bearer ${staff.token}`).send({ qty: 5 });
    await request(app).patch(`/api/warehouse/documents/${issueId}`)
      .set('Authorization', `Bearer ${staff.token}`).send({ status: 'READY' });
    const done = await request(app).post(`/api/warehouse/documents/${issueId}/complete`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(done.status).toBe(200);

    const resRow: any = await db.get('SELECT qtyConsumed, status FROM reservations WHERE id = ?', [res1.body.id]);
    expect(Number(resRow.qtyConsumed)).toBe(5);
    expect(resRow.status).toBe('ACTIVE');

    // Release remainder (12 - 5 = 7): reserved back to base
    const rel = await request(app).post(`/api/warehouse/reservations/${res1.body.id}/release`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(rel.status).toBe(200);
    expect(rel.body.released).toBe(7);

    const bal2: any = await db.get(
      'SELECT COALESCE(SUM(onHand), 0) AS t, COALESCE(SUM(reserved), 0) AS r FROM stock_balances WHERE productId = ? AND warehouseId = ?',
      [productId, warehouseId]);
    expect(Number(bal2.t)).toBe(baseOn + 20 - 5); // issued 5
    expect(Number(bal2.r)).toBe(baseRes); // consumed 5 + released 7

    // Double release blocked
    const rel2 = await request(app).post(`/api/warehouse/reservations/${res1.body.id}/release`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(rel2.status).toBe(400);
  });

  it('Employee cannot create reservations; outsider cannot release', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const staff = await createTestUser(10, ['stock.issue']);
    const outsider = await createTestUser(10, ['stock.issue']);

    const denied = await request(app).post('/api/warehouse/reservations')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ productId, warehouseId, qty: 1 });
    expect(denied.status).toBe(403);

    const res1 = await request(app).post('/api/warehouse/reservations')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ productId, warehouseId, qty: 1 });
    // May be 400 if no stock; ensure at least RBAC passes for TP (not 403)
    expect([200, 400]).toContain(res1.status);

    if (res1.status === 200) {
      const rel = await request(app).post(`/api/warehouse/reservations/${res1.body.id}/release`)
        .set('Authorization', `Bearer ${outsider.token}`);
      expect(rel.status).toBe(403);
      // Cleanup
      await request(app).post(`/api/warehouse/reservations/${res1.body.id}/release`)
        .set('Authorization', `Bearer ${tp.token}`);
    }
  });
});

describe('Warehouse stock - central inquiry', () => {
  it('Summary aggregates, filters, paginates; drawer returns breakdown+moves', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const staff = await createTestUser(10, ['stock.view']);

    // Seed +25 on hand via receipt
    const receipt = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ warehouseId, lines: [{ productId, qtyOrdered: 25 }] });
    const receiptId = receipt.body.id;
    await request(app).patch(`/api/warehouse/documents/${receiptId}`)
      .set('Authorization', `Bearer ${tp.token}`).send({ status: 'CONFIRMED' });
    const rDetail: any = await request(app).get(`/api/warehouse/documents/${receiptId}`)
      .set('Authorization', `Bearer ${tp.token}`);
    await request(app).post(`/api/warehouse/documents/${receiptId}/lines/${rDetail.body.lines[0].id}/receive`)
      .set('Authorization', `Bearer ${tp.token}`).send({ qty: 25 });
    await request(app).post(`/api/warehouse/documents/${receiptId}/complete`)
      .set('Authorization', `Bearer ${tp.token}`);

    // Set reorder policy on the product
    await db.run('UPDATE stock_products SET reorderPoint = ?, minStock = ? WHERE id = ?', [1000000, 1000000, productId]);

    const prodCode: any = await db.get('SELECT code FROM stock_products WHERE id = ?', [productId]);
    const summary: any = await request(app).get(`/api/warehouse/stock?view=summary&page=1&pageSize=50&search=${encodeURIComponent(prodCode.code)}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(summary.status).toBe(200);
    expect(typeof summary.body.total).toBe('number');
    const row = summary.body.rows.find((r: any) => r.productId === productId);
    expect(row).toBeDefined();
    expect(row.available).toBeGreaterThanOrEqual(25);
    expect(row.status).toBe('low'); // available below huge reorder point
    expect(typeof row.incoming).toBe('number');

    const lowOnly: any = await request(app).get(`/api/warehouse/stock?view=summary&status=low&search=${encodeURIComponent(prodCode.code)}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(lowOnly.body.rows.every((r: any) => r.status === 'low')).toBe(true);

    const byLoc: any = await request(app).get(`/api/warehouse/stock?view=by-location&search=${encodeURIComponent(prodCode.code)}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(byLoc.status).toBe(200);
    expect(byLoc.body.rows.some((r: any) => r.productId === productId)).toBe(true);

    const drawer: any = await request(app).get(`/api/warehouse/stock/${productId}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(drawer.status).toBe(200);
    expect(drawer.body.product.id).toBe(productId);
    expect(Array.isArray(drawer.body.breakdown)).toBe(true);
    expect(Array.isArray(drawer.body.moves)).toBe(true);
    expect(drawer.body.reservations).toBeUndefined(); // staff: no TP extras

    const tpDrawer: any = await request(app).get(`/api/warehouse/stock/${productId}`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(Array.isArray(tpDrawer.body.reservations)).toBe(true);
    expect(Array.isArray(tpDrawer.body.incomingDocs)).toBe(true);

    const missing = await request(app).get('/api/warehouse/stock/nope')
      .set('Authorization', `Bearer ${tp.token}`);
    expect(missing.status).toBe(404);

    // Reset policy to avoid cross-test pollution
    await db.run('UPDATE stock_products SET reorderPoint = 0, minStock = 0 WHERE id = ?', [productId]);
  });
});

describe('Warehouse dashboard overview', () => {
  it('Staff sees personal KPIs, tasks and alerts only', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const staff = await createTestUser(10, ['stock.view', 'stock.issue']);
    const other = await createTestUser(10, ['stock.view']);

    const created = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ type: 'ISSUE', warehouseId, assigneeId: staff.userId, dueDate: '2000-01-01', lines: [{ productId, qtyOrdered: 2 }] });
    const docId = created.body.id;
    await request(app).patch(`/api/warehouse/documents/${docId}`)
      .set('Authorization', `Bearer ${tp.token}`).send({ status: 'CONFIRMED' });

    const res: any = await request(app).get('/api/warehouse/dashboard/overview')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('staff');
    expect(res.body.kpis.pendingIssues).toBeGreaterThanOrEqual(1);
    expect(res.body.todayTasks.some((t: any) => t.id === docId)).toBe(true);
    // Overdue (due 2000) flagged
    expect(res.body.alerts.overdue.some((t: any) => t.id === docId)).toBe(true);

    const otherRes: any = await request(app).get('/api/warehouse/dashboard/overview')
      .set('Authorization', `Bearer ${other.token}`);
    expect(otherRes.body.todayTasks.some((t: any) => t.id === docId)).toBe(false);
    expect(otherRes.body.kpis.pendingIssues).toBe(0);
  });

  it('Manager sees department KPIs, warehouses, alerts and performance', async () => {
    const tp = await createTestUser(20, ['stock.manage']);

    const res: any = await request(app).get('/api/warehouse/dashboard/overview')
      .set('Authorization', `Bearer ${tp.token}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('manager');
    expect(typeof res.body.kpis.skuCount).toBe('number');
    expect(typeof res.body.kpis.lowStock).toBe('number');
    expect(typeof res.body.kpis.outOfStock).toBe('number');
    expect(typeof res.body.kpis.pendingIssues).toBe('number');
    expect(typeof res.body.kpis.inTransit).toBe('number');
    expect(Array.isArray(res.body.warehouses)).toBe(true);
    expect(res.body.warehouses.some((w: any) => w.id === warehouseId)).toBe(true);
    expect(Array.isArray(res.body.alerts.outItems)).toBe(true);
    expect(Array.isArray(res.body.alerts.overdueDocs)).toBe(true);
    expect(Array.isArray(res.body.performance)).toBe(true);

    const filtered: any = await request(app).get(`/api/warehouse/dashboard/overview?warehouseId=${warehouseId}`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.warehouses.every((w: any) => w.id === warehouseId)).toBe(true);
  });
});

describe('Warehouse serials & lots', () => {
  it('Registers serials on receipt, assigns on issue, blocks completion without serials', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const staff = await createTestUser(10, ['stock.receive', 'stock.issue']);

    // SERIAL-tracked product
    const stamp = Date.now();
    await db.run(
      'INSERT INTO stock_products (id, code, name, unit, tracking, warrantyMonths) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), `SER-${stamp}`, 'Serial Product', 'pcs', 'SERIAL', 12]
    );
    const prod: any = await db.get('SELECT id FROM stock_products WHERE code = ?', [`SER-${stamp}`]);
    const sn1 = `SN-${stamp}-001`;
    const sn2 = `SN-${stamp}-002`;

    // Receipt 2 units (staff assigned so they can handle it)
    const receipt = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ warehouseId, assigneeId: staff.userId, lines: [{ productId: prod.id, qtyOrdered: 2 }] });
    const receiptId = receipt.body.id;
    await request(app).patch(`/api/warehouse/documents/${receiptId}`)
      .set('Authorization', `Bearer ${tp.token}`).send({ status: 'CONFIRMED' });
    const rDetail: any = await request(app).get(`/api/warehouse/documents/${receiptId}`)
      .set('Authorization', `Bearer ${staff.token}`);
    const rLine = rDetail.body.lines[0].id;
    expect(rDetail.body.lines[0].productTracking).toBe('SERIAL');

    // Register serials (staff handler)
    const reg = await request(app).post(`/api/warehouse/documents/${receiptId}/lines/${rLine}/serials`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ serials: [sn1, sn2] });
    expect(reg.status).toBe(200);
    expect(reg.body.registered).toBe(2);

    // Duplicate serial blocked
    const dup = await request(app).post(`/api/warehouse/documents/${receiptId}/lines/${rLine}/serials`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ serials: [sn1] });
    expect(dup.status).toBe(400);

    await request(app).post(`/api/warehouse/documents/${receiptId}/lines/${rLine}/receive`)
      .set('Authorization', `Bearer ${staff.token}`).send({ qty: 2 });
    await request(app).post(`/api/warehouse/documents/${receiptId}/complete`)
      .set('Authorization', `Bearer ${staff.token}`);

    // Serial detail + timeline
    const detail: any = await request(app).get('/api/warehouse/serials/' + sn1 + '')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('IN_STOCK');
    expect(detail.body.warrantyEnd).toBeDefined();
    expect(Array.isArray(detail.body.timeline)).toBe(true);

    // Issue without assigned serials -> complete blocked
    const issue = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ type: 'ISSUE', warehouseId, assigneeId: staff.userId, lines: [{ productId: prod.id, qtyOrdered: 1 }] });
    const issueId = issue.body.id;
    await request(app).patch(`/api/warehouse/documents/${issueId}`)
      .set('Authorization', `Bearer ${tp.token}`).send({ status: 'CONFIRMED' });
    const iDetail: any = await request(app).get(`/api/warehouse/documents/${issueId}`)
      .set('Authorization', `Bearer ${staff.token}`);
    const iLine = iDetail.body.lines[0].id;
    await request(app).post(`/api/warehouse/documents/${issueId}/lines/${iLine}/pick`)
      .set('Authorization', `Bearer ${staff.token}`).send({ qty: 1 });
    await request(app).patch(`/api/warehouse/documents/${issueId}`)
      .set('Authorization', `Bearer ${staff.token}`).send({ status: 'READY' });
    const blocked = await request(app).post(`/api/warehouse/documents/${issueId}/complete`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(blocked.status).toBe(500);

    // Assign serial then complete works, serial flips to ISSUED
    const assign = await request(app).post(`/api/warehouse/documents/${issueId}/lines/${iLine}/serials`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ serials: [sn1] });
    expect(assign.status).toBe(200);
    const done = await request(app).post(`/api/warehouse/documents/${issueId}/complete`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(done.status).toBe(200);
    const after: any = await request(app).get('/api/warehouse/serials/' + sn1 + '')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(after.body.status).toBe('ISSUED');

    // TP status workflow with notes guard
    const noNote = await request(app).patch('/api/warehouse/serials/' + sn2 + '/status')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ status: 'DAMAGED' });
    expect(noNote.status).toBe(400);
    const damaged = await request(app).patch('/api/warehouse/serials/' + sn2 + '/status')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ status: 'DAMAGED', notes: 'Vo man hinh' });
    expect(damaged.status).toBe(200);

    // Staff cannot change serial status
    const staffChange = await request(app).patch('/api/warehouse/serials/' + sn2 + '/status')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ status: 'IN_STOCK', notes: 'x' });
    expect(staffChange.status).toBe(403);
  });

  it('Lots CRUD with duplicate and delete guards', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const staff = await createTestUser(10, ['stock.view']);
    const stamp = Date.now();
    await db.run('INSERT INTO stock_products (id, code, name, unit) VALUES (?, ?, ?, ?)',
      [randomUUID(), `LOTP-${stamp}`, 'Lot Product', 'pcs']);
    const prod: any = await db.get('SELECT id FROM stock_products WHERE code = ?', [`LOTP-${stamp}`]);

    const created = await request(app).post('/api/warehouse/lots')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ productId: prod.id, lotCode: `LO-${stamp}`, expiryDate: '2030-01-01', quantity: 50 });
    expect(created.status).toBe(200);

    const dup = await request(app).post('/api/warehouse/lots')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ productId: prod.id, lotCode: `LO-${stamp}`, quantity: 1 });
    expect(dup.status).toBe(400);

    const list: any = await request(app).get('/api/warehouse/lots?search=LO-')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(list.status).toBe(200);
    expect(list.body.some((l: any) => l.lotCode === `LO-${stamp}`)).toBe(true);

    const delStaff = await request(app).delete(`/api/warehouse/lots/${created.body.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(delStaff.status).toBe(403);

    const del = await request(app).delete(`/api/warehouse/lots/${created.body.id}`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(del.status).toBe(200);
  });
});

describe('Warehouse stock counts - blind count + variance + adjustment', () => {
  it('Full flow: create, snapshot, blind count, approve variance, close emits adjustment', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const staff = await createTestUser(10, ['stock.count']);

    // Stock product with 10 on hand
    const stamp = Date.now();
    await db.run('INSERT INTO stock_products (id, code, name, unit) VALUES (?, ?, ?, ?)',
      [randomUUID(), `CNT-${stamp}`, 'Count Product', 'pcs']);
    const prod: any = await db.get('SELECT id FROM stock_products WHERE code = ?', [`CNT-${stamp}`]);
    await db.run(
      'INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved) VALUES (?, ?, ?, ?, ?)',
      [prod.id, warehouseId, '', 10, 0]
    );

    // TP creates blind count assigned to staff
    const created = await request(app).post('/api/warehouse/counts')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ warehouseId, blindCount: true, assigneeId: staff.userId });
    expect(created.status).toBe(200);
    const countId = created.body.id;

    // Staff cannot snapshot (TP only)
    const staffSnap = await request(app).post(`/api/warehouse/counts/${countId}/snapshot`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(staffSnap.status).toBe(403);

    const snap = await request(app).post(`/api/warehouse/counts/${countId}/snapshot`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(snap.status).toBe(200);
    expect(snap.body.added).toBeGreaterThanOrEqual(1);

    // Blind: staff sees systemQty null on pending lines
    const blind: any = await request(app).get(`/api/warehouse/counts/${countId}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(blind.status).toBe(200);
    const target = blind.body.lines.find((l: any) => l.productCode === `CNT-${stamp}`);
    expect(target.systemQty).toBeNull();

    // Staff counts 7 (variance -3)
    const counted = await request(app).patch(`/api/warehouse/counts/${countId}/lines/${target.id}/count`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ countedQty: 7 });
    expect(counted.status).toBe(200);

    // Other pending lines block close; count remaining test lines for this product only.
    // Close blocked while other lines uncounted OR variances unapproved tested below via fresh count.
    const tpView: any = await request(app).get(`/api/warehouse/counts/${countId}`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(tpView.body.lines.find((l: any) => l.productCode === `CNT-${stamp}`).systemQty).toBe(10);

    // Staff cannot approve variance
    const staffApprove = await request(app).post(`/api/warehouse/counts/${countId}/lines/${target.id}/approve`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ resolution: 'staff tries' });
    expect(staffApprove.status).toBe(403);
  });

  it('Close flow with single-line count emits exact adjustment moves', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const staff = await createTestUser(10, ['stock.count']);
    const stamp = Date.now();
    await db.run('INSERT INTO stock_products (id, code, name, unit) VALUES (?, ?, ?, ?)',
      [randomUUID(), `CLS-${stamp}`, 'Close Product', 'pcs']);
    const prod: any = await db.get('SELECT id FROM stock_products WHERE code = ?', [`CLS-${stamp}`]);

    // Isolated warehouse so snapshot contains only this product
    await db.run('INSERT INTO warehouses (id, code, name) VALUES (?, ?, ?)',
      [randomUUID(), `CLS-WH-${stamp}`, 'Close Warehouse']);
    const wh: any = await db.get('SELECT id FROM warehouses WHERE code = ?', [`CLS-WH-${stamp}`]);
    await db.run(
      'INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved) VALUES (?, ?, ?, ?, ?)',
      [prod.id, wh.id, '', 10, 0]
    );

    const created = await request(app).post('/api/warehouse/counts')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ warehouseId: wh.id, assigneeId: staff.userId });
    const countId = created.body.id;
    const snap = await request(app).post(`/api/warehouse/counts/${countId}/snapshot`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(snap.body.added).toBe(1);

    const detail: any = await request(app).get(`/api/warehouse/counts/${countId}`)
      .set('Authorization', `Bearer ${staff.token}`);
    const lineId = detail.body.lines[0].id;

    await request(app).patch(`/api/warehouse/counts/${countId}/lines/${lineId}/count`)
      .set('Authorization', `Bearer ${staff.token}`).send({ countedQty: 7 });

    // Close blocked: variance not approved
    const blocked = await request(app).post(`/api/warehouse/counts/${countId}/close`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(blocked.status).toBe(400);

    const approved = await request(app).post(`/api/warehouse/counts/${countId}/lines/${lineId}/approve`)
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ resolution: 'Vo 3 cai, xac nhan hao hut' });
    expect(approved.status).toBe(200);

    const closed = await request(app).post(`/api/warehouse/counts/${countId}/close`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(closed.status).toBe(200);
    expect(closed.body.adjustments).toBe(1);

    // Balances: 10 - 3 = 7; moves: -3 ADJUSTMENT
    const bal: any = await db.get(
      'SELECT onHand FROM stock_balances WHERE productId = ? AND warehouseId = ?', [prod.id, wh.id]);
    expect(Number(bal.onHand)).toBe(7);
    const moves: any = await db.all(
      "SELECT qty, moveType FROM stock_moves WHERE productId = ? AND moveType = 'ADJUSTMENT'", [prod.id]);
    expect(moves.length).toBe(1);
    expect(Number(moves[0].qty)).toBe(-3);

    // Count is done; recount blocked
    const recount = await request(app).post(`/api/warehouse/counts/${countId}/lines/${lineId}/recount`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(recount.status).toBe(400);
  });
});

describe('Warehouse alerts & policies', () => {
  it('Policies override product defaults; alerts reflect effective policy', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const staff = await createTestUser(10, ['stock.view']);
    const stamp = Date.now();
    await db.run('INSERT INTO stock_products (id, code, name, unit, reorderPoint) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), `POL-${stamp}`, 'Policy Product', 'pcs', 100]);
    const prod: any = await db.get('SELECT id FROM stock_products WHERE code = ?', [`POL-${stamp}`]);
    await db.run(
      'INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved) VALUES (?, ?, ?, ?, ?)',
      [prod.id, warehouseId, '', 50, 0]
    );

    // No override: reorder 100 -> low
    let alerts: any = await request(app).get('/api/warehouse/alerts')
      .set('Authorization', `Bearer ${tp.token}`);
    expect(alerts.status).toBe(200);
    expect(alerts.body.low.some((r: any) => r.productId === prod.id)).toBe(true);

    // Override reorder to 10 at this warehouse -> ok
    const saved = await request(app).post('/api/warehouse/policies')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ productId: prod.id, warehouseId, reorderPoint: 10 });
    expect(saved.status).toBe(200);

    alerts = await request(app).get('/api/warehouse/alerts')
      .set('Authorization', `Bearer ${tp.token}`);
    expect(alerts.body.low.some((r: any) => r.productId === prod.id)).toBe(false);

    // Upsert same pair updates
    const again = await request(app).post('/api/warehouse/policies')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ productId: prod.id, warehouseId, reorderPoint: 5 });
    expect(again.status).toBe(200);
    expect(again.body.updated).toBe(true);

    // Staff cannot read alerts or write policies
    const staffAlerts = await request(app).get('/api/warehouse/alerts')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(staffAlerts.status).toBe(403);
    const staffWrite = await request(app).post('/api/warehouse/policies')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ productId: prod.id, warehouseId, reorderPoint: 1 });
    expect(staffWrite.status).toBe(403);

    // Delete override -> falls back to product default (low again)
    const del = await request(app).delete(`/api/warehouse/policies/${saved.body.id}`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(del.status).toBe(200);
    alerts = await request(app).get('/api/warehouse/alerts')
      .set('Authorization', `Bearer ${tp.token}`);
    expect(alerts.body.low.some((r: any) => r.productId === prod.id)).toBe(true);

    // Slow-moving includes untouched stock
    expect(Array.isArray(alerts.body.slow)).toBe(true);
    expect(alerts.body.exceptions).toBeDefined();
  });
});

describe('Warehouse reports', () => {
  it('Moves history filters/paginates; summary aggregates by day/type/warehouse', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const staff = await createTestUser(10, ['stock.view']);

    // Staff forbidden from summary (TP-only)
    const denied: any = await request(app).get('/api/warehouse/report/summary')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(denied.status).toBe(403);

    // Staff can read moves history
    const moves: any = await request(app)
      .get('/api/warehouse/moves?page=1&pageSize=5&moveType=RECEIPT')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(moves.status).toBe(200);
    expect(typeof moves.body.total).toBe('number');
    expect(moves.body.rows.length).toBeLessThanOrEqual(5);
    expect(moves.body.rows.every((r: any) => r.moveType === 'RECEIPT')).toBe(true);

    const summary: any = await request(app).get('/api/warehouse/report/summary')
      .set('Authorization', `Bearer ${tp.token}`);
    expect(summary.status).toBe(200);
    expect(/^[0-9]{4}-[0-9]{2}$/.test(summary.body.month)).toBe(true);
    expect(Array.isArray(summary.body.byDay)).toBe(true);
    expect(Array.isArray(summary.body.byType)).toBe(true);
    expect(Array.isArray(summary.body.byWarehouse)).toBe(true);
    expect(Array.isArray(summary.body.inTransit)).toBe(true);
    expect(summary.body.byWarehouse.every((w: any) => typeof w.available === 'number')).toBe(true);

    const filtered: any = await request(app)
      .get(`/api/warehouse/report/summary?warehouseId=${warehouseId}`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.byWarehouse.every((w: any) => w.warehouseId === warehouseId)).toBe(true);
  });
});

describe('Warehouse bundles', () => {
  it('VIRTUAL buildable from available; STOCKED assemble/disassemble moves stock', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const staff = await createTestUser(10, ['stock.view']);
    const stamp = Date.now();

    // Components with stock: A=10, B=30
    for (const [suffix, qty] of [['A', 10], ['B', 30]] as const) {
      await db.run('INSERT INTO stock_products (id, code, name, unit) VALUES (?, ?, ?, ?)',
        [randomUUID(), `BUN-${stamp}-${suffix}`, `Bundle Part ${suffix}`, 'pcs']);
      const pr: any = await db.get('SELECT id FROM stock_products WHERE code = ?', [`BUN-${stamp}-${suffix}`]);
      await db.run(
        'INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved) VALUES (?, ?, ?, ?, ?)',
        [pr.id, warehouseId, '', qty, 0]
      );
    }
    const prodA: any = await db.get('SELECT id FROM stock_products WHERE code = ?', [`BUN-${stamp}-A`]);
    const prodB: any = await db.get('SELECT id FROM stock_products WHERE code = ?', [`BUN-${stamp}-B`]);

    // VIRTUAL bundle: 2xA + 3xB -> min(10/2, 30/3) = 5
    const virtual = await request(app).post('/api/warehouse/bundles')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({
        code: `VB-${stamp}`, name: 'Virtual Bundle', mode: 'VIRTUAL_BUNDLE',
        items: [
          { productId: prodA.id, quantity: 2 },
          { productId: prodB.id, quantity: 3 },
        ],
      });
    expect(virtual.status).toBe(200);

    const list: any = await request(app).get('/api/warehouse/bundles')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(list.status).toBe(200);
    const vb = list.body.find((b: any) => b.code === `VB-${stamp}`);
    expect(vb.buildable).toBe(5);
    expect(vb.limiting.productCode).toBe(`BUN-${stamp}-A`);

    // VIRTUAL cannot assemble
    const noAsm = await request(app).post(`/api/warehouse/bundles/${virtual.body.id}/assemble`)
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ qty: 1, warehouseId });
    expect(noAsm.status).toBe(400);

    // STOCKED_KIT needs a kit product
    await db.run('INSERT INTO stock_products (id, code, name, unit) VALUES (?, ?, ?, ?)',
      [randomUUID(), `KIT-${stamp}`, 'Kit Product', 'set']);
    const kit: any = await db.get('SELECT id FROM stock_products WHERE code = ?', [`KIT-${stamp}`]);
    const stocked = await request(app).post('/api/warehouse/bundles')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({
        code: `SK-${stamp}`, name: 'Stocked Kit', mode: 'STOCKED_KIT', kitProductId: kit.id,
        items: [
          { productId: prodA.id, quantity: 2 },
          { productId: prodB.id, quantity: 3 },
        ],
      });
    expect(stocked.status).toBe(200);

    // Assemble 2 kits: A 10->6, B 30->24, kits 0->2
    const asm = await request(app).post(`/api/warehouse/bundles/${stocked.body.id}/assemble`)
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ qty: 2, warehouseId });
    expect(asm.status).toBe(200);

    const balA: any = await db.get(
      'SELECT COALESCE(SUM(onHand), 0) AS t FROM stock_balances WHERE productId = ?', [prodA.id]);
    const balB: any = await db.get(
      'SELECT COALESCE(SUM(onHand), 0) AS t FROM stock_balances WHERE productId = ?', [prodB.id]);
    const balK: any = await db.get(
      'SELECT COALESCE(SUM(onHand), 0) AS t FROM stock_balances WHERE productId = ?', [kit.id]);
    expect(Number(balA.t)).toBe(6);
    expect(Number(balB.t)).toBe(24);
    expect(Number(balK.t)).toBe(2);

    // Over-assemble blocked (needs 2xA per kit, only 6 left -> max 3, ask 4)
    const over = await request(app).post(`/api/warehouse/bundles/${stocked.body.id}/assemble`)
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ qty: 4, warehouseId });
    expect(over.status).toBe(400);

    // Disassemble 1 kit: A 6->8, B 24->27, kits 2->1
    const dis = await request(app).post(`/api/warehouse/bundles/${stocked.body.id}/disassemble`)
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ qty: 1, warehouseId });
    expect(dis.status).toBe(200);
    const balA2: any = await db.get(
      'SELECT COALESCE(SUM(onHand), 0) AS t FROM stock_balances WHERE productId = ?', [prodA.id]);
    const balK2: any = await db.get(
      'SELECT COALESCE(SUM(onHand), 0) AS t FROM stock_balances WHERE productId = ?', [kit.id]);
    expect(Number(balA2.t)).toBe(8);
    expect(Number(balK2.t)).toBe(1);

    // Staff cannot manage bundles, but can view
    const staffWrite = await request(app).post('/api/warehouse/bundles')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ code: `XX-${stamp}`, name: 'Denied', items: [{ productId: prodA.id, quantity: 1 }] });
    expect(staffWrite.status).toBe(403);

    // Cannot remove last component
    const detail: any = await request(app).get(`/api/warehouse/bundles/${virtual.body.id}`)
      .set('Authorization', `Bearer ${tp.token}`);
    const firstItem = detail.body.items[0].id;
    const secondItem = detail.body.items[1].id;
    await request(app).delete(`/api/warehouse/bundles/${virtual.body.id}/items/${firstItem}`)
      .set('Authorization', `Bearer ${tp.token}`);
    const lastOne = await request(app).delete(`/api/warehouse/bundles/${virtual.body.id}/items/${secondItem}`)
      .set('Authorization', `Bearer ${tp.token}`);
    expect(lastOne.status).toBe(400);
  });
});

describe('Warehouse transfer suggestions', () => {
  it('Suggests transfer from surplus to shortage warehouse; staff forbidden', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const staff = await createTestUser(10, ['stock.view']);
    const stamp = Date.now();

    // Two warehouses
    await db.run('INSERT INTO warehouses (id, code, name) VALUES (?, ?, ?)',
      [randomUUID(), `SG-A-${stamp}`, 'Suggest A']);
    await db.run('INSERT INTO warehouses (id, code, name) VALUES (?, ?, ?)',
      [randomUUID(), `SG-B-${stamp}`, 'Suggest B']);
    const whA: any = await db.get('SELECT id FROM warehouses WHERE code = ?', [`SG-A-${stamp}`]);
    const whB: any = await db.get('SELECT id FROM warehouses WHERE code = ?', [`SG-B-${stamp}`]);

    // Product with reorder 10; A holds 50 (surplus 40), B holds 3 (shortage 7)
    await db.run('INSERT INTO stock_products (id, code, name, unit, reorderPoint) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), `SGP-${stamp}`, 'Suggest Product', 'pcs', 10]);
    const prod: any = await db.get('SELECT id FROM stock_products WHERE code = ?', [`SGP-${stamp}`]);
    await db.run(
      'INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
      [prod.id, whA.id, '', 50, 0, prod.id, whB.id, '', 3, 0]
    );

    const denied: any = await request(app).get('/api/warehouse/transfer-suggestions')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(denied.status).toBe(403);

    const res: any = await request(app).get('/api/warehouse/transfer-suggestions')
      .set('Authorization', `Bearer ${tp.token}`);
    expect(res.status).toBe(200);
    const sug = res.body.find((x: any) => x.productId === prod.id && x.toWarehouseId === whB.id);
    expect(sug).toBeDefined();
    expect(sug.fromWarehouseId).toBe(whA.id);
    expect(sug.shortageQty).toBe(7);
    expect(sug.suggestQty).toBe(7);
  });
});

describe('Warehouse remaining pages (approvals/variances/adjustments/history)', () => {
  it('ADJUSTMENT docs listable but not creatable; variances aggregate; history filters', async () => {
    const tp = await createTestUser(20, ['stock.manage']);
    const staff = await createTestUser(10, ['stock.view']);
    const stamp = Date.now();

    // Adjustment doc exists only via counts flow; create one directly for listing
    await db.run(
      `INSERT INTO stock_documents (id, code, type, status, warehouseId, createdBy)
       VALUES (?, ?, 'ADJUSTMENT', 'DONE', ?, ?)`,
      [randomUUID(), `DC-${stamp}`, warehouseId, tp.userId]
    );

    const list: any = await request(app).get('/api/warehouse/documents?type=ADJUSTMENT')
      .set('Authorization', `Bearer ${tp.token}`);
    expect(list.status).toBe(200);
    expect(list.body.some((d: any) => d.code === `DC-${stamp}`)).toBe(true);

    // Cannot create ADJUSTMENT manually
    const manual: any = await request(app).post('/api/warehouse/documents')
      .set('Authorization', `Bearer ${tp.token}`)
      .send({ type: 'ADJUSTMENT', warehouseId, lines: [{ productId, qtyOrdered: 1 }] });
    expect(manual.status).toBe(400);

    // Multi-status filter for history
    const hist: any = await request(app).get('/api/warehouse/documents?status=DONE,CANCELLED')
      .set('Authorization', `Bearer ${tp.token}`);
    expect(hist.status).toBe(200);
    expect(hist.body.every((d: any) => ['DONE', 'CANCELLED'].includes(d.status))).toBe(true);

    // Variances endpoint: TP ok, staff forbidden
    const vari: any = await request(app).get('/api/warehouse/count-variances?open=1')
      .set('Authorization', `Bearer ${tp.token}`);
    expect(vari.status).toBe(200);
    expect(Array.isArray(vari.body)).toBe(true);
    const denied: any = await request(app).get('/api/warehouse/count-variances')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(denied.status).toBe(403);

    // Create an open variance and see it listed
    await db.run('INSERT INTO stock_products (id, code, name, unit) VALUES (?, ?, ?, ?)',
      [randomUUID(), `VAR-${stamp}`, 'Variance Product', 'pcs']);
    const prod: any = await db.get('SELECT id FROM stock_products WHERE code = ?', [`VAR-${stamp}`]);
    const cid = randomUUID();
    await db.run(
      `INSERT INTO stock_counts (id, code, warehouseId, status, createdBy) VALUES (?, ?, ?, 'reconciling', ?)`,
      [cid, `KKV-${stamp}`, warehouseId, tp.userId]
    );
    await db.run(
      `INSERT INTO stock_count_lines (id, countId, productId, productCode, productName, systemQty, countedQty, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'counted')`,
      [randomUUID(), cid, prod.id, `VAR-${stamp}`, 'Variance Product', 10, 7]
    );
    const vari2: any = await request(app).get('/api/warehouse/count-variances?open=1')
      .set('Authorization', `Bearer ${tp.token}`);
    const found = vari2.body.find((v: any) => v.productCode === `VAR-${stamp}`);
    expect(found).toBeDefined();
    expect(found.variance).toBe(-3);
  });
});

describe('Warehouse auth alignment (menu OR-rule)', () => {
  it('Level-10 user holding stock.* permissions passes manager-gated reads', async () => {
    // Mirror the sidebar canSeeItem OR-rule: permission match grants access
    // even when managementLevel is below 20.
    const userId = randomUUID();
    const email = `perm-${Date.now()}@example.com`;
    await db.run(
      `INSERT INTO users (id, name, email, password, role, managementLevel, primaryDepartmentId, department, avatar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, 'Perm User', email, 'hashedpass', 'Employee', 10, 'dept-kho', 'Kho Van', '']
    );
    const roleName = `PermRole${Date.now()}`;
    await db.run('INSERT INTO roles (id, name, description, color, permissions, isSystem) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), roleName, '', '#000',
       JSON.stringify(['stock.manage', 'stock.approve', 'stock.reports', 'stock.view']), 0]);
    await db.run('UPDATE users SET role = ? WHERE id = ?', [roleName, userId]);
    const token = jwt.sign({ sub: userId, tokenVersion: 0 }, JWT_SECRET, { expiresIn: '1h' });
    const auth = (r: any) => r.set('Authorization', `Bearer ${token}`);

    expect((await request(app).get('/api/warehouse/alerts').use(auth)).status).toBe(200);
    expect((await request(app).get('/api/warehouse/count-variances').use(auth)).status).toBe(200);
    expect((await request(app).get('/api/warehouse/report/summary').use(auth)).status).toBe(200);
    expect((await request(app).get('/api/warehouse/transfer-suggestions').use(auth)).status).toBe(200);
    expect((await request(app).post('/api/warehouse/products')
      .use(auth).send({ code: `PM-${Date.now()}`, name: 'Perm Product' })).status).toBe(200);
  });

  it('Level-10 user without permissions is still blocked from manager views', async () => {
    const userId = randomUUID();
    const email = `noperm-${Date.now()}@example.com`;
    await db.run(
      `INSERT INTO users (id, name, email, password, role, managementLevel, primaryDepartmentId, department, avatar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, 'NoPerm User', email, 'hashedpass', 'Employee', 10, 'dept-kho', 'Kho Van', '']
    );
    const roleName = `NoPermRole${Date.now()}`;
    await db.run('INSERT INTO roles (id, name, description, color, permissions, isSystem) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), roleName, '', '#000', JSON.stringify(['stock.view']), 0]);
    await db.run('UPDATE users SET role = ? WHERE id = ?', [roleName, userId]);
    const token = jwt.sign({ sub: userId, tokenVersion: 0 }, JWT_SECRET, { expiresIn: '1h' });
    const auth = (r: any) => r.set('Authorization', `Bearer ${token}`);

    expect((await request(app).get('/api/warehouse/alerts').use(auth)).status).toBe(403);
    expect((await request(app).get('/api/warehouse/count-variances').use(auth)).status).toBe(403);
    expect((await request(app).get('/api/warehouse/report/summary').use(auth)).status).toBe(403);
    // ...but scoped reads still work
    expect((await request(app).get('/api/warehouse/dashboard/overview').use(auth)).status).toBe(200);
  });
});
