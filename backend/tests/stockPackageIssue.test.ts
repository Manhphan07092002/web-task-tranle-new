import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { stockRoutes } from '../routes/stock.js';

/**
 * Luồng Kiện trên phiếu xuất (§4.2 R2, AC3): dòng phiếu mang packageId +
 * packageLineId, hoàn tất thì trừ kiện trong cùng transaction với stock_moves.
 * Fake DB dưới đây giữ snapshot/rollback thật để chứng minh kiện và ledger cùng
 * sống hoặc cùng chết, đồng thời so câu INSERT ledger từng byte.
 */

const manager = { id: 'mgr', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };

const PRODUCTS = [
  { id: 'p1', name: 'Tấm pin 550W', tracking: 'QUANTITY', expiryRequired: 0 },
  { id: 'p2', name: 'Inverter', tracking: 'SERIAL', expiryRequired: 0 },
];
const LOCATIONS = [
  { id: 'loc-1', warehouseId: 'wh-1', isActive: 1, purpose: 'SALEABLE' },
  { id: 'loc-2', warehouseId: 'wh-2', isActive: 1, purpose: 'SALEABLE' },
];

const norm = (sql: unknown) => String(sql).trim().replace(/\s+/g, ' ');

/** INSERT một hoặc nhiều dòng, kể cả giá trị literal ('ISSUE', NULL, 0) trong VALUES. */
function parseInsert(sql: string, params: any[]) {
  const match = sql.match(/^INSERT(?: IGNORE)? INTO (\w+) \(([^)]+)\)\s*VALUES([\s\S]*)$/i);
  if (!match) return null;
  const columns = match[2].split(',').map((column) => column.trim());
  const body = match[3].split(' ON DUPLICATE')[0];
  const rows: Record<string, any>[] = [];
  let cursor = 0;
  for (const tuple of body.matchAll(/\(([^)]*)\)/g)) {
    const row: Record<string, any> = {};
    tuple[1].split(',').forEach((rawToken, index) => {
      const token = rawToken.trim();
      if (token === '?') row[columns[index]] = params[cursor++];
      else if (token.toUpperCase() === 'NULL') row[columns[index]] = null;
      else row[columns[index]] = token.replace(/^'+|'+$/g, '');
    });
    rows.push(row);
  }
  return { table: match[1], rows };
}

const packageRow = (id: string, packageCode: string, warehouseId: string, status: string) => ({
  id, packageCode, packageTypeId: null, warehouseId, locationId: '', sourceReceiptId: 'recv-1',
  sourcePackageId: null, parentPackageId: null, status, notes: null,
  receivedAt: '2026-01-01T00:00:00.000Z', receivedBy: 'mgr', pickedAt: null, pickedBy: null, createdBy: 'mgr',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});
const packageLineRow = (id: string, packageId: string, productId: string, lineKey: string, qty: number, opts: Record<string, any> = {}) => ({
  id, packageId, productId, lineKey,
  qtyInitial: qty, qtyRemaining: opts.remaining ?? qty, qtyHeld: opts.held ?? 0,
  serialId: opts.serialId ?? null, lotId: null, expiryDate: null, unitCost: 5,
  receiptDocumentId: 'recv-1', receiptLineId: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

function issueDb() {
  let tables: Record<string, any[]> = {
    stock_documents: [], stock_document_lines: [],
    stock_packages: [
      packageRow('pkg-a', 'KIEN-A', 'wh-1', 'IN_STOCK'),
      packageRow('pkg-b', 'KIEN-B', 'wh-2', 'IN_STOCK'),
      packageRow('pkg-h', 'KIEN-H', 'wh-1', 'HELD'),
      packageRow('pkg-x', 'KIEN-X', 'wh-1', 'ISSUED'),
      packageRow('pkg-p', 'KIEN-P', 'wh-1', 'PENDING'),
      packageRow('pkg-s', 'KIEN-S', 'wh-1', 'IN_STOCK'),
    ],
    stock_package_lines: [
      packageLineRow('pl-a1', 'pkg-a', 'p1', 'p1|Q', 10),
      packageLineRow('pl-a2', 'pkg-a', 'p2', 'p2|S:SN-01', 1, { serialId: 'ser-1' }),
      packageLineRow('pl-b1', 'pkg-b', 'p1', 'p1|Q', 4),
      packageLineRow('pl-h1', 'pkg-h', 'p1', 'p1|Q', 5, { held: 5 }),
      packageLineRow('pl-x1', 'pkg-x', 'p1', 'p1|Q', 3, { remaining: 0 }),
      packageLineRow('pl-p1', 'pkg-p', 'p1', 'p1|Q', 2),
      packageLineRow('pl-s1', 'pkg-s', 'p2', 'p2|S:SN-02', 1, { serialId: 'ser-2' }),
    ],
    stock_package_movements: [], stock_moves: [], stock_serials: [
      { id: 'ser-1', serialNumber: 'SN-01', productId: 'p2', warehouseId: 'wh-1', status: 'SALEABLE', stockStatus: 'IN_STOCK', issueDocumentId: null, issueLineId: null, receiptDocumentId: 'recv-1' },
      { id: 'ser-2', serialNumber: 'SN-02', productId: 'p2', warehouseId: 'wh-1', status: 'SALEABLE', stockStatus: 'IN_STOCK', issueDocumentId: null, issueLineId: null, receiptDocumentId: 'recv-1' },
    ],
    stock_lots: [], stock_balances: [
      { productId: 'p1', warehouseId: 'wh-1', locationId: '', onHand: 19, reserved: 0, updatedAt: '' },
      { productId: 'p2', warehouseId: 'wh-1', locationId: '', onHand: 2, reserved: 0, updatedAt: '' },
    ],
    warehouse_activity_logs: [], stock_document_line_reservations: [], reservations: [],
  };
  let snapshot: Record<string, any[]> | undefined;

  const list = (table: string) => (tables[table] ||= []);
  const strings = (params: any[] = []) => (params || []).map((value) => String(value));
  const sqlLog: string[] = [];
  const counters = { transactions: 0, commits: 0, rollbacks: 0 };

  const db = {
    state: {
      get tables() { return tables; },
      sql: sqlLog,
      get transactions() { return counters.transactions; },
      get commits() { return counters.commits; },
      get rollbacks() { return counters.rollbacks; },
      packages: () => tables.stock_packages,
      packageLines: () => tables.stock_package_lines,
      movements: () => tables.stock_package_movements,
      activities: (actionType: string) => tables.warehouse_activity_logs.filter((row) => row.actionType === actionType),
      balance: (productId: string) => tables.stock_balances.find((row) => String(row.productId) === productId),
      packageStatus: (packageId: string) => tables.stock_packages.find((pkg) => String(pkg.id) === packageId)?.status,
    },
    all: async (sql: string, params: any[] = []) => {
      const s = norm(sql);
      sqlLog.push(s);
      if (s.includes('FROM user_warehouse_scopes')) return [{ warehouseId: 'wh-1' }];
      if (s.includes('FROM warehouses')) return [];
      if (s.includes('FROM misa_mappings')) return [];
      if (s.includes('FROM stock_lot_tracking')) return [];
      if (s.includes('FROM stock_counts')) return [];
      if (s.includes('FROM reservations')) return [];
      if (s.includes('FROM stock_document_line_reservations')) return [];
      if (s.includes('FROM products')) return PRODUCTS.filter((product) => strings(params).includes(product.id));
      if (s.includes('FROM stock_locations')) return LOCATIONS.filter((loc) => strings(params).includes(loc.id));
      if (s.includes('FROM stock_balances')) {
        return tables.stock_balances.filter((row) => String(row.warehouseId) === String(params[0]));
      }
      // assertLinesFitPackages: dòng kiện + header kiện trong một query JOIN.
      if (s.includes('JOIN stock_packages p ON p.id = pl.packageId')) {
        const wanted = new Set(strings(params));
        return tables.stock_package_lines
          .filter((line) => wanted.has(String(line.id)))
          .map((line) => {
            const pkg = tables.stock_packages.find((candidate) => String(candidate.id) === String(line.packageId));
            return {
              packageLineId: line.id, packageId: line.packageId, productId: line.productId,
              qtyRemaining: line.qtyRemaining, qtyHeld: line.qtyHeld,
              packageCode: pkg?.packageCode, warehouseId: pkg?.warehouseId, status: pkg?.status,
            };
          });
      }
      if (s.includes('FROM stock_package_lines')) {
        const wanted = new Set(strings(params));
        // lockPackageLinesForUpdate gửi id của DÒNG kiện, các query khác gửi id KIỆN.
        if (s.includes('ORDER BY id FOR UPDATE')) {
          return tables.stock_package_lines.filter((line) => wanted.has(String(line.id))).sort();
        }
        return tables.stock_package_lines.filter((line) => wanted.has(String(line.packageId)));
      }
      if (s.includes('FROM stock_package_movements')) {
        return tables.stock_package_movements.filter((move) => strings(params).includes(String(move.packageId)));
      }
      if (s.includes('FROM stock_packages')) {
        if (s.includes('packageCode LIKE')) return tables.stock_packages.map((pkg) => ({ code: pkg.packageCode }));
        if (s.includes('WHERE packageCode IN (')) {
          return tables.stock_packages
            .filter((pkg) => strings(params).includes(String(pkg.packageCode)))
            .map((pkg) => ({ packageCode: pkg.packageCode }));
        }
        if (s.includes('WHERE id IN (')) return tables.stock_packages.filter((pkg) => strings(params).includes(String(pkg.id)));
        return tables.stock_packages.filter((pkg) => strings(params).includes(String(pkg.id)) || strings(params).includes(String(pkg.sourceReceiptId)));
      }
      if (s.includes('FROM stock_serials')) {
        return tables.stock_serials.filter((row) => strings(params).includes(String(row.serialNumber)) || strings(params).includes(String(row.receiptDocumentId)));
      }
      if (s.includes('FROM stock_lots')) return [];
      if (s.includes('FROM stock_document_lines')) {
        return tables.stock_document_lines.filter((line) => strings(params).includes(String(line.documentId)));
      }
      return [];
    },
    get: async (sql: string, params: any[] = []) => {
      const s = norm(sql);
      sqlLog.push(s);
      if (s.includes('FROM stock_documents')) return tables.stock_documents.find((row) => String(row.id) === String(params?.[0]));
      if (s.includes('FROM stock_counts')) return undefined;
      if (s.includes('FROM stock_locations')) return LOCATIONS.find((loc) => String(loc.id) === String(params?.[0]));
      if (s.includes('FROM products')) return PRODUCTS.find((product) => String(product.id) === String(params?.[0]));
      if (s.includes('FROM warehouses')) return { id: 'wh-1', name: 'Kho Hà Nội' };
      if (s.includes('FROM stock_balances')) {
        return tables.stock_balances.find((row) => (
          String(row.productId) === String(params?.[0]) && String(row.warehouseId) === String(params?.[1])
          && String(row.locationId || '') === String(params?.[2] || '')
        ));
      }
      if (s.includes('FROM stock_serials')) {
        return tables.stock_serials.find((row) => (
          String(row.serialNumber) === String(params?.[0]) && String(row.productId) === String(params?.[1])
          && String(row.warehouseId) === String(params?.[2])
        ));
      }
      if (s.includes('FROM stock_package_lines')) {
        return tables.stock_package_lines.find((line) => String(line.id) === String(params?.[0]));
      }
      if (s.includes('FROM stock_document_lines')) {
        const rows = tables.stock_document_lines.filter((line) => String(line.documentId) === String(params?.[0]));
        // Dòng nháp không ghi processingStatus → DB default 'PENDING', nên NULL là "chưa xử lý".
        if (s.includes("processingStatus <> 'PENDING'")) {
          return rows.find((line) => line.processingStatus && line.processingStatus !== 'PENDING');
        }
        return rows[0];
      }
      return undefined;
    },
    run: async (sql: string, params: any[] = []) => {
      const s = norm(sql);
      sqlLog.push(s);
      if (s === 'START TRANSACTION') { counters.transactions += 1; snapshot = structuredClone(tables); return { changes: 0 }; }
      if (s === 'COMMIT') { counters.commits += 1; snapshot = undefined; return { changes: 0 }; }
      if (s === 'ROLLBACK') {
        counters.rollbacks += 1;
        if (snapshot) tables = snapshot;
        snapshot = undefined;
        return { changes: 0 };
      }
      // PUT thay dòng phiếu: xóa hết dòng cũ rồi INSERT dòng mới.
      if (s.startsWith('DELETE FROM stock_document_lines WHERE documentId')) {
        tables.stock_document_lines = tables.stock_document_lines.filter(
          (line) => String(line.documentId) !== String(params[0])
        );
        return { changes: 1 };
      }
      const insert = parseInsert(s, params);
      if (insert) {
        for (const row of insert.rows) {
          const rows = list(insert.table);
          const key = insert.table === 'stock_balances'
            ? `${row.productId}|${row.warehouseId}|${row.locationId ?? ''}`
            : String(row.id);
          const existing = rows.find((candidate) => (
            insert.table === 'stock_balances'
              ? `${candidate.productId}|${candidate.warehouseId}|${candidate.locationId ?? ''}` === key
              : String(candidate.id) === key
          ));
          if (!existing) rows.push(row);
          else if (insert.table === 'stock_balances') existing.onHand = Number(existing.onHand) + Number(row.onHand);
        }
        return { changes: insert.rows.length };
      }
      applyWrites(s, params);
      return { changes: 1 };
    },
  };

  const applyWrites = (s: string, params: any[] = []) => {
    if (s.startsWith('UPDATE stock_documents SET status')) {
      const row = tables.stock_documents.find((doc) => String(doc.id) === String(params[2]));
      if (row) row.status = params[0];
      return;
    }
    if (s.startsWith('UPDATE stock_package_lines SET qtyRemaining = qtyRemaining - ?')) {
      const row = tables.stock_package_lines.find((line) => String(line.id) === String(params[3]));
      if (!row) return;
      row.qtyRemaining = Number(row.qtyRemaining) - Number(params[0]);
      row.qtyHeld = Math.max(0, Number(row.qtyHeld) - Number(params[1]));
      return;
    }
    if (s.startsWith('UPDATE stock_packages SET status = ?, pickedAt')) {
      const row = tables.stock_packages.find((pkg) => String(pkg.id) === String(params[4]));
      if (row) { row.status = params[0]; row.pickedAt = row.pickedAt ?? params[1]; row.pickedBy = row.pickedBy ?? params[2]; }
      return;
    }
    if (s.startsWith("UPDATE stock_serials SET status = 'SOLD'")) {
      const row = tables.stock_serials.find((serial) => String(serial.id) === String(params[6]));
      if (row) { row.status = 'SOLD'; row.stockStatus = 'OUT'; row.issueDocumentId = params[2]; }
      return;
    }
    if (s.startsWith('UPDATE stock_serials')) {
      const row = tables.stock_serials.find((serial) => String(serial.id) === String(params[params.length - 1]));
      if (row) { row.status = 'SOLD'; row.stockStatus = 'OUT'; }
      return;
    }
  };
  return db;
}

function appFor(user: any, db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(stockRoutes(db));
  return app;
}

/** Phiếu xuất 1 dòng p1 × 4 lấy từ kiện KIEN-A (còn 10). */
function issueBody(overrides: Record<string, any> = {}) {
  return {
    warehouseId: 'wh-1',
    lines: [{ productId: 'p1', quantity: 4, unitPrice: 5, packageLineId: 'pl-a1' }],
    ...overrides,
  };
}

function createIssue(db: any, body: Record<string, any> = issueBody()) {
  return request(appFor(manager, db)).post('/issues').send(body);
}

function toReady(db: any, id: string) {
  return request(appFor(manager, db)).post(`/documents/${id}/processing-complete`).send({});
}

function complete(db: any, id: string) {
  return request(appFor(manager, db)).post(`/issues/${id}/complete`).send({});
}

/** Tạo phiếu + chuyển sang READY, trả về id để các case ghi sổ dùng chung. */
async function readyIssue(db: any, body?: Record<string, any>) {
  const created = await createIssue(db, body);
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.body)}`);
  const id = created.body.id;
  const ready = await toReady(db, id);
  if (ready.status !== 200) throw new Error(`processing-complete failed: ${JSON.stringify(ready.body)}`);
  return id;
}

const MOVES_SQL = 'INSERT INTO stock_moves (id, productId, warehouseId, locationId, quantity, moveType, referenceType, referenceId, documentLineId, serialId, lotId, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
const BALANCES_SQL = 'INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt) VALUES (?, ?, ?, ?, 0, ?) ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), updatedAt = VALUES(updatedAt)';

describe('Kiện trên dòng phiếu xuất nháp', () => {
  it('AC §4.2: ghi packageId lấy từ DB, không tin packageId client gửi lên', async () => {
    const db = issueDb();
    const res = await createIssue(db, issueBody({
      lines: [{ productId: 'p1', quantity: 4, unitPrice: 5, packageLineId: 'pl-a1' }],
    })).expect(201);
    const line = db.state.tables.stock_document_lines.find((row) => String(row.packageLineId) === 'pl-a1');
    expect(line).toMatchObject({ packageId: 'pkg-a', packageLineId: 'pl-a1', productId: 'p1', quantity: 4 });
    expect(db.state.packageLines().find((row) => row.id === 'pl-a1').qtyRemaining).toBe(10);
    expect(db.state.movements()).toEqual([]);
    expect(db.state.tables.stock_moves).toEqual([]);
    expect(res.body.id).toBeTruthy();
  });

  it('gộp nhiều dòng cùng một dòng kiện rồi mới so với lượng khả dụng', async () => {
    const db = issueDb();
    const res = await createIssue(db, issueBody({
      lines: [
        { productId: 'p1', quantity: 6, unitPrice: 5, packageLineId: 'pl-a1' },
        { productId: 'p1', quantity: 5, unitPrice: 5, packageLineId: 'pl-a1' },
      ],
    })).expect(400);
    expect(res.body.code).toBe('PACKAGE_QTY_EXCEEDED');
    expect(res.body.details).toMatchObject({ packageCode: 'KIEN-A', available: 10, requested: 11 });
    expect(db.state.tables.stock_documents).toEqual([]);
    expect(db.state.rollbacks).toBe(1);
  });

  it('chặn từng lý do: sai kho, sai sản phẩm, kiện PENDING/HELD/ISSUED, dòng kiện không tồn tại', async () => {
    const cases: [string, number, string][] = [
      ['pl-b1', 409, 'PACKAGE_WRONG_WAREHOUSE'],
      ['pl-a2', 400, 'PACKAGE_PRODUCT_MISMATCH'],
      ['pl-p1', 409, 'PACKAGE_PENDING'],
      ['pl-h1', 409, 'PACKAGE_HELD'],
      ['pl-x1', 409, 'PACKAGE_ISSUED'],
      ['pl-nope', 404, 'PACKAGE_NOT_FOUND'],
    ];
    for (const [packageLineId, status, code] of cases) {
      const db = issueDb();
      const res = await createIssue(db, issueBody({
        lines: [{ productId: 'p1', quantity: 1, unitPrice: 5, packageLineId }],
      })).expect(status);
      expect(res.body.code, `dòng ${packageLineId}`).toBe(code);
      expect(db.state.tables.stock_documents).toEqual([]);
      expect(db.state.packageLines().find((line) => line.id === 'pl-a1').qtyRemaining).toBe(10);
    }
  });

  it('từ chối packageId khai báo lệch với kiện thật của dòng kiện', async () => {
    const db = issueDb();
    const res = await createIssue(db, issueBody({
      lines: [{ productId: 'p1', quantity: 1, unitPrice: 5, packageLineId: 'pl-a1', packageId: 'pkg-s' }],
    })).expect(400);
    expect(res.body.code).toBe('PACKAGE_INVALID');
    expect(db.state.tables.stock_documents).toEqual([]);
  });

  it('chỉ phiếu xuất mới được gắn dòng kiện vào dòng phiếu', async () => {
    const db = issueDb();
    const res = await request(appFor(manager, db)).post('/returns').send({
      warehouseId: 'wh-1',
      notes: 'Khách trả hàng bị lỗi',
      lines: [{ productId: 'p1', quantity: 1, unitPrice: 5, packageLineId: 'pl-a1' }],
    }).expect(400);
    expect(res.body.error).toContain('Chỉ phiếu xuất');
    expect(db.state.tables.stock_documents).toEqual([]);
  });

  it('AC10: phiếu xuất không dùng kiện vẫn chạy luồng cũ và không thêm key packages', async () => {
    const db = issueDb();
    const id = await readyIssue(db, issueBody({ lines: [{ productId: 'p1', quantity: 3, unitPrice: 5 }] }));
    await complete(db, id).expect(200);
    expect(db.state.movements()).toEqual([]);
    expect(db.state.activities('PACKAGE_ISSUED')).toEqual([]);
    expect(db.state.balance('p1').onHand).toBe(16);

    const detail = await request(appFor(manager, db)).get(`/documents/${id}`).expect(200);
    expect(detail.body).not.toHaveProperty('packages');
    expect(detail.body.lines.every((line: any) => !line.packageLineId)).toBe(true);
  });
});

describe('Hoàn tất phiếu xuất có kiện', () => {
  it('AC3: xuất đủ 10 của kiện → ISSUED, movement nối moveId của stock_moves, trừ tồn đúng', async () => {
    const db = issueDb();
    const id = await readyIssue(db, issueBody({
      lines: [
        { productId: 'p1', quantity: 10, unitPrice: 5, packageLineId: 'pl-a1' },
        { productId: 'p2', quantity: 1, unitPrice: 7, packageLineId: 'pl-a2', serialLot: 'SN-01' },
      ],
    }));
    await complete(db, id).expect(200);

    expect(db.state.packageStatus('pkg-a')).toBe('ISSUED');
    expect(db.state.packageLines().find((line) => line.id === 'pl-a1')).toMatchObject({ qtyRemaining: 0, qtyHeld: 0 });
    expect(db.state.packageLines().find((line) => line.id === 'pl-a2').qtyRemaining).toBe(0);

    const movements = db.state.movements();
    expect(movements).toHaveLength(2);
    for (const movement of movements) {
      expect(movement).toMatchObject({ moveType: 'ISSUE', referenceType: 'STOCK_DOCUMENT', referenceId: id, warehouseId: 'wh-1' });
      expect(Number(movement.quantity)).toBeLessThan(0);
      const move = db.state.tables.stock_moves.find((row) => String(row.id) === String(movement.moveId));
      expect(move, 'mỗi movement kiện phải nối được về một stock_moves thật').toBeTruthy();
      expect(move.documentLineId).toBe(movement.documentLineId);
    }

    expect(db.state.activities('PACKAGE_ISSUED').map((row: any) => row.packageCode).sort()).toEqual(['KIEN-A', 'KIEN-A']);
    expect(db.state.balance('p1').onHand).toBe(9);
    expect(db.state.balance('p2').onHand).toBe(1);
    expect(db.state.commits).toBe(3);
    expect(db.state.rollbacks).toBe(0);
  });

  it('giữ mã kiện cho phần còn lại và suy PARTIAL_ISSUED khi lấy 2/10', async () => {
    const db = issueDb();
    const id = await readyIssue(db, issueBody({
      lines: [{ productId: 'p1', quantity: 2, unitPrice: 5, packageLineId: 'pl-a1' }],
    }));
    await complete(db, id).expect(200);
    expect(db.state.packageStatus('pkg-a')).toBe('PARTIAL_ISSUED');
    expect(db.state.packageLines().find((line) => line.id === 'pl-a1').qtyRemaining).toBe(8);
    expect(db.state.activities('PACKAGE_PARTIAL_ISSUED')).toHaveLength(1);
    expect(db.state.tables.stock_packages.find((pkg) => pkg.id === 'pkg-a').packageCode).toBe('KIEN-A');
  });

  it('serial trong kiện: xuất 1 chiếc → serial SOLD và đúng 1 movement nối 1 move', async () => {
    const db = issueDb();
    const id = await readyIssue(db, issueBody({
      lines: [{ productId: 'p2', quantity: 1, unitPrice: 7, packageLineId: 'pl-s1', serialLot: 'SN-02' }],
    }));
    await complete(db, id).expect(200);
    expect(db.state.tables.stock_serials.find((row) => row.id === 'ser-2')).toMatchObject({ status: 'SOLD', stockStatus: 'OUT' });
    expect(db.state.packageStatus('pkg-s')).toBe('ISSUED');
    expect(db.state.movements()).toHaveLength(1);
    expect(db.state.movements()[0].moveId).toBeTruthy();
  });

  it('giữ nguyên SQL ledger: stock_moves và stock_balances không đổi câu INSERT', async () => {
    const db = issueDb();
    const id = await readyIssue(db);
    await complete(db, id).expect(200);
    const moveSqls = db.state.sql.filter((entry) => entry.startsWith('INSERT INTO stock_moves'));
    const balanceSqls = db.state.sql.filter((entry) => entry.startsWith('INSERT INTO stock_balances'));
    expect(moveSqls.length).toBeGreaterThan(0);
    expect(new Set(moveSqls)).toEqual(new Set([MOVES_SQL]));
    expect(new Set(balanceSqls)).toEqual(new Set([BALANCES_SQL]));
    expect(db.state.sql.some((entry) => entry.includes('stock_moves') && entry.includes('packageId'))).toBe(false);
  });

  it('kiện bị người khác lấy hết trước khi ghi sổ: rollback, phiếu vẫn READY, tồn không đổi', async () => {
    const db = issueDb();
    const id = await readyIssue(db, issueBody({
      lines: [{ productId: 'p1', quantity: 6, unitPrice: 5, packageLineId: 'pl-a1' }],
    }));
    // Giả lập transaction khác commit trước: chỉ còn 5 trong dòng kiện.
    db.state.packageLines().find((line) => line.id === 'pl-a1').qtyRemaining = 5;

    const res = await complete(db, id).expect(400);
    expect(res.body.code).toBe('PACKAGE_QTY_EXCEEDED');
    expect(db.state.tables.stock_documents.find((doc) => doc.id === id).status).toBe('READY');
    expect(db.state.balance('p1').onHand).toBe(19);
    expect(db.state.tables.stock_moves).toEqual([]);
    expect(db.state.movements()).toEqual([]);
    expect(db.state.packageLines().find((line) => line.id === 'pl-a1').qtyRemaining).toBe(5);
  });

  it('hoàn tất lại phiếu đã DONE không trừ kiện lần hai', async () => {
    const db = issueDb();
    const id = await readyIssue(db);
    await complete(db, id).expect(200);
    await complete(db, id).expect(200);
    expect(db.state.movements()).toHaveLength(1);
    expect(db.state.packageLines().find((line) => line.id === 'pl-a1').qtyRemaining).toBe(6);
  });
});

describe('Sửa và đọc phiếu xuất có kiện', () => {
  it('PUT thay dòng kiện: phải khớp kho/sản phẩm, packageId ghi lại theo DB', async () => {
    const db = issueDb();
    const created = await createIssue(db);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id;

    const rejected = await request(appFor(manager, db)).put(`/documents/${id}`).send({
      lines: [{ productId: 'p1', quantity: 1, unitPrice: 5, packageLineId: 'pl-b1' }],
    }).expect(409);
    expect(rejected.body.code).toBe('PACKAGE_WRONG_WAREHOUSE');
    expect(rejected.body.code).toBe('PACKAGE_WRONG_WAREHOUSE');
    expect(db.state.packageLines().find((line) => line.id === 'pl-a1').qtyRemaining).toBe(10);
    expect(db.state.tables.stock_document_lines.filter((line) => line.documentId === id)).toHaveLength(1);

    const saved = await request(appFor(manager, db)).put(`/documents/${id}`).send({
      lines: [{ productId: 'p1', quantity: 3, unitPrice: 5, packageLineId: 'pl-a1' }],
    }).expect(200);
    expect(saved.body.success).toBe(true);

    const detail = await request(appFor(manager, db)).get(`/documents/${id}`).expect(200);
    expect(detail.body.lines).toHaveLength(1);
    expect(detail.body.lines[0]).toMatchObject({ productId: 'p1', quantity: 3, packageId: 'pkg-a', packageLineId: 'pl-a1' });
  });

  it('GET /documents/:id trả đúng bộ kiện mà các dòng phiếu trỏ tới', async () => {
    const db = issueDb();
    const id = await readyIssue(db, issueBody({
      lines: [{ productId: 'p1', quantity: 2, unitPrice: 5, packageLineId: 'pl-a1' }],
    }));
    const detail = await request(appFor(manager, db)).get(`/documents/${id}`).expect(200);
    expect(detail.body.packages).toHaveLength(1);
    expect(detail.body.packages[0]).toMatchObject({ id: 'pkg-a', packageCode: 'KIEN-A', status: 'IN_STOCK' });
    expect(detail.body.packages[0].lines.map((line: any) => line.id)).toEqual(['pl-a1', 'pl-a2']);
    expect(detail.body.lines[0]).toMatchObject({ packageId: 'pkg-a', packageLineId: 'pl-a1' });
  });
});
