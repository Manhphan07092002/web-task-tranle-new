import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { stockRoutes } from '../routes/stock.js';

/**
 * Luồng Kiện trên phiếu nhập (§4.1): tạo nháp → xử lý → hoàn tất ghi sổ, cộng
 * thêm sửa/hủy/xóa phiếu. Fake DB dưới đây mô phỏng đủ các bảng mà luồng này chạm
 * tới, có snapshot/rollback thật để chứng minh phiếu và kiện cùng sống hoặc cùng chết.
 */

const manager = { id: 'mgr', role: 'Manager', department: 'Kho', managementLevel: 20, permissions: [] };

const PRODUCTS = [
  { id: 'p1', name: 'Tấm pin 550W', tracking: 'QUANTITY', expiryRequired: 0 },
  { id: 'p2', name: 'Inverter', tracking: 'SERIAL', expiryRequired: 0 },
  { id: 'p3', name: 'Ắc quy', tracking: 'LOT', expiryRequired: 1 },
];
const LOCATIONS = [
  { id: 'loc-1', warehouseId: 'wh-1', isActive: 1, purpose: 'SALEABLE' },
  { id: 'loc-2', warehouseId: 'wh-2', isActive: 1, purpose: 'SALEABLE' },
];

const norm = (sql: unknown) => String(sql).trim().replace(/\s+/g, ' ');

/** INSERT một hoặc nhiều dòng, kể cả giá trị literal ('PENDING', NULL) trong VALUES. */
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

function receiptDb(seed: { scopes?: string[]; counting?: boolean } = {}) {
  const scopes = seed.scopes ?? ['wh-1'];
  let tables: Record<string, any[]> = {
    stock_documents: [], stock_document_lines: [], stock_packages: [], stock_package_lines: [],
    stock_serials: [], stock_lots: [], stock_package_movements: [], stock_moves: [],
    stock_balances: [], warehouse_activity_logs: [],
  };
  let snapshot: Record<string, any[]> | undefined;

  const list = (table: string) => (tables[table] ||= []);
  const strings = (params: any[] = []) => (params || []).map((value) => String(value));
  const packagesOf = (documentId: string, status?: string) => tables.stock_packages.filter(
    (pkg) => String(pkg.sourceReceiptId) === String(documentId) && (!status || pkg.status === status)
  );
  const doc = (id: unknown) => tables.stock_documents.find((row) => String(row.id) === String(id));

  const db: any = {
    state: {
      get tables() { return tables; },
      sql: [] as string[],
      transactions: 0,
      commits: 0,
      rollbacks: 0,
      packages: () => tables.stock_packages,
      packageLines: () => tables.stock_package_lines,
      activities: (actionType: string) => tables.warehouse_activity_logs.filter((row) => row.actionType === actionType),
    },
    all: async (sql: string, params: any[] = []) => {
      const s = norm(sql);
      db.state.sql.push(s);
      if (s.includes('FROM user_warehouse_scopes')) return scopes.map((warehouseId) => ({ warehouseId }));
      if (s.includes('FROM warehouses')) return [];
      if (s.includes('FROM misa_mappings')) return [];
      if (s.includes('FROM stock_lot_tracking')) return [];
      if (s.includes('FROM stock_counts')) return [];
      if (s.includes('FROM products')) return PRODUCTS.filter((product) => strings(params).includes(product.id));
      if (s.includes('FROM stock_locations')) return LOCATIONS.filter((loc) => strings(params).includes(loc.id));
      if (s.includes('FROM stock_document_lines')) {
        return tables.stock_document_lines.filter((line) => strings(params).includes(String(line.documentId)));
      }
      if (s.includes('FROM stock_package_movements')) {
        return tables.stock_package_movements.filter((move) => strings(params).includes(String(move.packageId)));
      }
      if (s.includes('SUM(pl.qtyRemaining)')) {
        const pending = new Set(packagesOf(String(params[0]), 'PENDING').map((pkg) => String(pkg.id)));
        const totals = new Map<string, number>();
        for (const line of tables.stock_package_lines) {
          if (!pending.has(String(line.packageId))) continue;
          totals.set(String(line.productId), (totals.get(String(line.productId)) ?? 0) + Number(line.qtyRemaining));
        }
        return [...totals].map(([productId, packagedQty]) => ({ productId, packagedQty }));
      }
      if (s.includes('FROM stock_package_lines')) {
        return tables.stock_package_lines.filter((line) => strings(params).includes(String(line.packageId)));
      }
      if (s.includes('FROM stock_packages')) {
        if (s.includes('packageCode LIKE')) return tables.stock_packages.map((pkg) => ({ code: pkg.packageCode }));
        if (s.includes('WHERE packageCode IN (')) {
          return tables.stock_packages
            .filter((pkg) => strings(params).includes(String(pkg.packageCode)))
            .map((pkg) => ({ packageCode: pkg.packageCode }));
        }
        if (s.includes('WHERE packageCode = ?')) {
          return tables.stock_packages.filter((pkg) => String(pkg.packageCode) === String(params[0]));
        }
        if (s.includes('WHERE id IN (')) return tables.stock_packages.filter((pkg) => strings(params).includes(String(pkg.id)));
        if (s.includes("status = 'PENDING'")) return packagesOf(String(params[0]), 'PENDING');
        return packagesOf(String(params[0]));
      }
      if (s.includes('FROM stock_serials')) {
        if (s.includes('WHERE serialNumber IN')) {
          return tables.stock_serials.filter((row) => strings(params).includes(String(row.serialNumber)));
        }
        if (s.includes('receiptDocumentId = ?')) {
          return tables.stock_serials.filter((row) => String(row.receiptDocumentId) === String(params[0]));
        }
        return [];
      }
      if (s.includes('FROM stock_lots')) {
        if (s.includes('WHERE receiptDocumentId = ?')) {
          return tables.stock_lots.filter((lot) => String(lot.receiptDocumentId) === String(params[0]));
        }
        if (s.includes('WHERE id IN (')) return tables.stock_lots.filter((lot) => strings(params).includes(String(lot.id)));
        return tables.stock_lots.filter((lot) => strings(params).includes(String(lot.productId)));
      }
      return [];
    },
    get: async (sql: string, params: any[] = []) => {
      const s = norm(sql);
      db.state.sql.push(s);
      if (s.includes('FROM stock_documents')) return doc(params?.[0]);
      if (s.includes('FROM stock_counts')) return seed.counting ? { id: 'count-1' } : undefined;
      if (s.includes('FROM stock_document_lines')) {
        return tables.stock_document_lines.find((line) => (
          String(line.documentId) === String(params?.[0])
          && (!s.includes("processingStatus <> 'PENDING'") || (line.processingStatus && line.processingStatus !== 'PENDING'))
        ));
      }
      if (s.includes('SUM(initialQty)')) {
        const covered = tables.stock_lots
          .filter((lot) => String(lot.receiptDocumentId) === String(params?.[0]) && String(lot.receiptLineId) === String(params?.[1]))
          .reduce((sum, lot) => sum + Number(lot.initialQty || 0), 0);
        return { total: covered };
      }
      if (s.includes('FROM stock_lots')) return tables.stock_lots.find((lot) => strings(params).includes(String(lot.id)));
      if (s.includes('FROM stock_serials')) {
        return tables.stock_serials.find((row) => (
          String(row.receiptDocumentId) === String(params?.[0]) || String(row.issueDocumentId) === String(params?.[0])
        ));
      }
      if (s.includes('FROM stock_locations')) return LOCATIONS.find((loc) => String(loc.id) === String(params?.[0]));
      if (s.includes('FROM products')) return PRODUCTS.find((product) => String(product.id) === String(params?.[0]));
      if (s.includes('FROM stock_balances')) {
        return tables.stock_balances.find((balance) => (
          String(balance.productId) === String(params?.[0]) && String(balance.warehouseId) === String(params?.[1])
        ));
      }
      return undefined;
    },
    run: async (sql: string, params: any[] = []) => {
      const s = norm(sql);
      db.state.sql.push(s);
      if (s === 'START TRANSACTION') { db.state.transactions += 1; snapshot = structuredClone(tables); return { changes: 0 }; }
      if (s === 'COMMIT') { db.state.commits += 1; snapshot = undefined; return { changes: 0 }; }
      if (s === 'ROLLBACK') {
        db.state.rollbacks += 1;
        if (snapshot) tables = snapshot;
        snapshot = undefined;
        return { changes: 0 };
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
    // Các UPDATE/DELETE mà luồng phiếu nhập có thể gửi tới.
    if (s.startsWith('UPDATE stock_documents SET status')) {
      const row = doc(params[2]);
      if (row) row.status = params[0];
      return;
    }
    if (s.startsWith('UPDATE stock_packages SET status = ?, receivedAt')) {
      const row = tables.stock_packages.find((pkg) => String(pkg.id) === String(params[5]) && pkg.status === 'PENDING');
      if (!row) return;
      row.status = params[0];
      row.receivedAt = params[1];
      row.receivedBy = params[2];
      if (params[3]) row.locationId = params[3];
      return;
    }
    if (s.startsWith("UPDATE stock_packages SET status = 'CANCELLED'")) {
      const row = tables.stock_packages.find((pkg) => String(pkg.id) === String(params[1]) && pkg.status === 'PENDING');
      if (row) { row.status = 'CANCELLED'; row.updatedAt = params[0]; }
      return;
    }
    if (s.startsWith('UPDATE stock_package_lines SET serialId')) {
      const row = tables.stock_package_lines.find((line) => String(line.id) === String(params[3]));
      if (row) { row.serialId = params[0]; row.lotId = params[1]; }
      return;
    }
    if (s.startsWith('DELETE FROM stock_package_lines')) {
      const ids = strings(params);
      tables.stock_package_lines = tables.stock_package_lines.filter((line) => !ids.includes(String(line.packageId)));
      return;
    }
    if (s.startsWith('DELETE FROM stock_packages')) {
      const ids = strings(params);
      tables.stock_packages = tables.stock_packages.filter((pkg) => !ids.includes(String(pkg.id)));
      return;
    }
    if (s.startsWith('DELETE FROM stock_document_lines')) {
      tables.stock_document_lines = tables.stock_document_lines.filter((line) => String(line.documentId) !== String(params[0]));
      return;
    }
    if (s.startsWith('DELETE FROM stock_documents')) {
      tables.stock_documents = tables.stock_documents.filter((row) => String(row.id) !== String(params[0]));
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

/** Phiếu nhập 2 dòng (p1 số lượng, p2 serial) + 2 kiện chia đủ 11 đơn vị. */
function receiptBody(overrides: Record<string, any> = {}) {
  return {
    warehouseId: 'wh-1',
    lines: [
      { productId: 'p1', quantity: 10, unitPrice: 5 },
      { productId: 'p2', quantity: 1, unitPrice: 7, serialLot: 'SN-01' },
    ],
    packages: [
      { packageCode: 'kien-a', locationId: 'loc-1', lines: [{ productId: 'p1', quantity: 6 }, { productId: 'p2', quantity: 1, serialNumber: 'sn-01' }] },
      { packageCode: 'KIEN-B', lines: [{ productId: 'p1', quantity: 4 }] },
    ],
    ...overrides,
  };
}

function createReceipt(db: any, body: Record<string, any> = receiptBody()) {
  return request(appFor(manager, db)).post('/receipts').send(body);
}

function toReady(db: any, id: string) {
  return request(appFor(manager, db)).post(`/documents/${id}/processing-complete`).send({});
}

function complete(db: any, id: string) {
  return request(appFor(manager, db)).post(`/receipts/${id}/complete`).send({});
}

const MOVES_SQL = 'INSERT INTO stock_moves (id, productId, warehouseId, locationId, quantity, moveType, referenceType, referenceId, documentLineId, serialId, lotId, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

describe('Kiện trên phiếu nhập nháp', () => {
  it('AC1: ghi 2 kiện PENDING chia đúng số lượng của phiếu, chưa đụng tới ledger', async () => {
    const db = receiptDb();
    const res = await createReceipt(db).expect(201);
    const documentId = res.body.id;

    expect(db.state.packages()).toHaveLength(2);
    expect(db.state.packages().map((pkg: any) => pkg.packageCode).sort()).toEqual(['KIEN-A', 'KIEN-B']);
    for (const pkg of db.state.packages()) {
      expect(pkg).toMatchObject({ status: 'PENDING', warehouseId: 'wh-1', sourceReceiptId: documentId });
    }
    expect(db.state.packages()[0].locationId).toBe('loc-1');

    expect(db.state.packageLines()).toHaveLength(3);
    expect(db.state.packageLines().map((line: any) => line.lineKey).sort()).toEqual(['p1|Q', 'p1|Q', 'p2|S:SN-01']);
    for (const line of db.state.packageLines()) {
      expect(line.qtyInitial).toBe(line.qtyRemaining);
      expect(line.receiptDocumentId).toBe(documentId);
    }
    // Bản nháp thì chưa có movement và chưa ghi sổ.
    expect(db.state.tables.stock_package_movements).toEqual([]);
    expect(db.state.tables.stock_moves).toEqual([]);
    expect(db.state.commits).toBe(1);
  });

  it('tự sinh mã kiện khi người dùng không nhập', async () => {
    const db = receiptDb();
    await createReceipt(db, receiptBody({
      packages: [{ lines: [{ productId: 'p1', quantity: 10 }, { productId: 'p2', quantity: 1, serialNumber: 'SN-01' }] }],
    })).expect(201);
    expect(db.state.packages()[0].packageCode).toMatch(/^KIEN-\d{2}-\d{6}$/);
  });

  it('AC2: chặn lưu khi tổng kiện lệch số lượng phiếu và rollback toàn bộ', async () => {
    const db = receiptDb();
    const res = await createReceipt(db, receiptBody({
      packages: [{ packageCode: 'KIEN-A', lines: [{ productId: 'p1', quantity: 9 }, { productId: 'p2', quantity: 1, serialNumber: 'SN-01' }] }],
    })).expect(400);

    expect(res.body.code).toBe('PACKAGE_QTY_MISMATCH');
    expect(res.body.details.mismatches).toEqual([{ productId: 'p1', expectedQty: 10, packagedQty: 9 }]);
    expect(db.state.tables.stock_documents).toEqual([]);
    expect(db.state.packages()).toEqual([]);
    expect(db.state.rollbacks).toBe(1);
  });

  it('từ chối mã kiện trùng với kiện đã tồn tại, không tạo phiếu', async () => {
    const db = receiptDb();
    await createReceipt(db).expect(201);

    const res = await createReceipt(db, receiptBody({
      lines: [{ productId: 'p1', quantity: 10, unitPrice: 5 }],
      packages: [{ packageCode: 'kien-a', lines: [{ productId: 'p1', quantity: 10 }] }],
    })).expect(409);
    expect(res.body.code).toBe('PACKAGE_CODE_DUPLICATE');
    expect(res.body.details.packageCode).toBe('KIEN-A');
    expect(db.state.tables.stock_documents).toHaveLength(1);
    expect(db.state.packages()).toHaveLength(2);
  });

  it('áp dụng từng ràng buộc dòng kiện ngay ở bước lập phiếu', async () => {
    const missingSerial = await createReceipt(receiptDb(), receiptBody({
      packages: [{ lines: [{ productId: 'p1', quantity: 10 }, { productId: 'p2', quantity: 1 }] }],
    })).expect(400);
    expect(missingSerial.body.code).toBe('PACKAGE_LINE_SERIAL_REQUIRED');

    const missingExpiry = await createReceipt(receiptDb(), receiptBody({
      lines: [{ productId: 'p3', quantity: 5 }],
      packages: [{ lines: [{ productId: 'p3', quantity: 5, lotCode: 'LOT-A' }] }],
    })).expect(400);
    expect(missingExpiry.body.code).toBe('PACKAGE_LINE_EXPIRY_REQUIRED');

    const foreignLocation = await createReceipt(receiptDb(), receiptBody({
      packages: [{ locationId: 'loc-2', lines: [{ productId: 'p1', quantity: 10 }, { productId: 'p2', quantity: 1, serialNumber: 'SN-01' }] }],
    })).expect(400);
    expect(foreignLocation.body.error).toMatch(/không thuộc kho/);
  });

  it('từ chối khai báo kiện trên phiếu không phải phiếu nhập', async () => {
    const issue = await request(appFor(manager, receiptDb())).post('/issues').send({
      warehouseId: 'wh-1',
      lines: [{ productId: 'p1', quantity: 4 }],
      packages: [{ lines: [{ productId: 'p1', quantity: 4 }] }],
    }).expect(400);
    expect(issue.body.error).toMatch(/chỉ được khai báo trên phiếu nhập/);
  });
});

describe('Hoàn tất phiếu nhập có kiện', () => {
  it('AC1: chuyển kiện sang IN_STOCK, gắn Serial vừa đăng ký và ghi movement bên bảng phụ', async () => {
    const db = receiptDb();
    const documentId = (await createReceipt(db)).body.id;
    await toReady(db, documentId).expect(200);
    await complete(db, documentId).expect(200);

    expect(db.state.packages()).toHaveLength(2);
    for (const pkg of db.state.packages()) {
      expect(pkg.status).toBe('IN_STOCK');
      expect(pkg.receivedBy).toBe(manager.id);
      expect(pkg.receivedAt).toBeTruthy();
    }
    const bound = db.state.packageLines().find((line: any) => line.lineKey === 'p2|S:SN-01');
    expect(bound.serialId).toBe(db.state.tables.stock_serials[0].id);

    expect(db.state.tables.stock_package_movements).toHaveLength(3);
    for (const movement of db.state.tables.stock_package_movements) {
      expect(movement).toMatchObject({ moveType: 'RECEIPT', referenceType: 'STOCK_DOCUMENT', referenceId: documentId });
    }
    expect(db.state.activities('PACKAGE_RECEIVED')).toHaveLength(2);
    expect(db.state.activities('DOCUMENT_CREATED')).toHaveLength(1);
  });

  it('giữ nguyên SQL ledger: stock_moves và stock_balances không đổi câu INSERT', async () => {
    const db = receiptDb();
    const documentId = (await createReceipt(db)).body.id;
    await toReady(db, documentId).expect(200);
    await complete(db, documentId).expect(200);

    expect(db.state.sql.filter((s: string) => s.startsWith('INSERT INTO stock_moves')).every((s: string) => s === MOVES_SQL)).toBe(true);
    expect(db.state.sql.filter((s: string) => s.startsWith('INSERT INTO stock_balances')).every(
      (s: string) => s.startsWith('INSERT INTO stock_balances (productId, warehouseId, locationId, onHand, reserved, updatedAt) VALUES')
    )).toBe(true);
    expect(db.state.tables.stock_moves).toHaveLength(2);
    expect(db.state.tables.stock_balances).toHaveLength(2);
  });

  it('gắn cả lotId của lô đã đăng ký cho dòng kiện quản lý theo lô', async () => {
    const db = receiptDb();
    const documentId = (await createReceipt(db, {
      warehouseId: 'wh-1',
      lines: [{ productId: 'p3', quantity: 5 }],
      packages: [{ lines: [{ productId: 'p3', quantity: 5, lotCode: 'lot-a', expiryDate: '2027-01-01' }] }],
    })).body.id;
    const lineId = db.state.tables.stock_document_lines[0].id;
    // Bước xử lý hàng hóa tạo lô trước khi ghi sổ; test chèn đúng vết đó.
    db.state.tables.stock_lots.push({
      id: 'lot-1', productId: 'p3', lotCode: 'LOT-A', warehouseId: 'wh-1', locationId: null,
      initialQty: 5, remainingQty: 5, status: 'ACTIVE', receiptDocumentId: documentId, receiptLineId: lineId,
    });

    await toReady(db, documentId).expect(200);
    await complete(db, documentId).expect(200);

    const pkgLine = db.state.packageLines().find((line: any) => line.lineKey === 'p3|L:LOT-A');
    expect(pkgLine.lotId).toBe('lot-1');
    expect(pkgLine.expiryDate).toBe('2027-01-01');
    expect(db.state.packages()[0].status).toBe('IN_STOCK');
  });

  it('AC2: chặn ghi sổ nếu kiện lệch số lượng thực nhận và không lại tồn', async () => {
    const db = receiptDb();
    const documentId = (await createReceipt(db)).body.id;
    await toReady(db, documentId).expect(200);
    db.state.packageLines().find((line: any) => line.packageCode !== 'KIEN-B' && line.lineKey === 'p1|Q').qtyRemaining = 1;

    const res = await complete(db, documentId).expect(400);
    expect(res.body.code).toBe('PACKAGE_QTY_MISMATCH');
    expect(docStatus(db, documentId)).toBe('READY');
    expect(db.state.tables.stock_moves).toEqual([]);
    expect(db.state.tables.stock_balances).toEqual([]);
    expect(db.state.packages().every((pkg: any) => pkg.status === 'PENDING')).toBe(true);
  });

  it('AC10: phiếu nhập không có kiện giữ nguyên hành vi cũ', async () => {
    const db = receiptDb();
    const body = receiptBody();
    delete (body as any).packages;
    const documentId = (await createReceipt(db, body)).body.id;
    await toReady(db, documentId).expect(200);
    await complete(db, documentId).expect(200);

    expect(docStatus(db, documentId)).toBe('DONE');
    expect(db.state.tables.stock_moves).toHaveLength(2);
    expect(db.state.packages()).toEqual([]);
    expect(db.state.tables.stock_package_movements).toEqual([]);
    expect(db.state.activities('PACKAGE_RECEIVED')).toEqual([]);
  });

  it('hoàn tất lại phiếu đã DONE không nhân movement của kiện', async () => {
    const db = receiptDb();
    const documentId = (await createReceipt(db)).body.id;
    await toReady(db, documentId).expect(200);
    await complete(db, documentId).expect(200);

    await complete(db, documentId).expect(200, { success: true, idempotent: true, status: 'DONE' });
    expect(db.state.tables.stock_package_movements).toHaveLength(3);
    expect(db.state.packages()).toHaveLength(2);
  });
});

describe('GET /documents/:id trả cây kiện', () => {
  it('kèm header + dòng kiện cho phiếu nhập', async () => {
    const db = receiptDb();
    const documentId = (await createReceipt(db)).body.id;
    const res = await request(appFor(manager, db)).get(`/documents/${documentId}`).expect(200);

    expect(res.body.packages).toHaveLength(2);
    const kienA = res.body.packages.find((pkg: any) => pkg.packageCode === 'KIEN-A');
    expect(kienA).toMatchObject({ status: 'PENDING', warehouseId: 'wh-1', lineCount: 2, totalQty: 7 });
    expect(kienA.lines.map((line: any) => line.lineKey).sort()).toEqual(['p1|Q', 'p2|S:SN-01']);
  });

  it('không thêm key packages cho phiếu xuất', async () => {
    const db = receiptDb();
    const created = await request(appFor(manager, db)).post('/issues').send({
      warehouseId: 'wh-1', lines: [{ productId: 'p1', quantity: 2 }],
    }).expect(201);
    const res = await request(appFor(manager, db)).get(`/documents/${created.body.id}`).expect(200);
    expect(res.body).not.toHaveProperty('packages');
  });
});

describe('Sửa phiếu nháp: thay cả danh sách kiện', () => {
  it('xóa bản nháp cũ và ghi danh sách mới, không để lại kiện CANCELLED', async () => {
    const db = receiptDb();
    const documentId = (await createReceipt(db)).body.id;

    await request(appFor(manager, db)).put(`/documents/${documentId}`).send({
      packages: [{ packageCode: 'KIEN-C', lines: [{ productId: 'p1', quantity: 10 }, { productId: 'p2', quantity: 1, serialNumber: 'SN-01' }] }],
    }).expect(200);

    expect(db.state.packages().map((pkg: any) => pkg.packageCode)).toEqual(['KIEN-C']);
    expect(db.state.packageLines()).toHaveLength(2);
    expect(db.state.activities('PACKAGE_CANCELLED')).toEqual([]);
    expect(db.state.tables.stock_documents[0].status).toBe('DRAFT');
  });

  it('lấy số lượng đối chiếu từ dòng đã lưu khi PUT không gửi lines', async () => {
    const db = receiptDb();
    const documentId = (await createReceipt(db)).body.id;
    const res = await request(appFor(manager, db)).put(`/documents/${documentId}`).send({
      packages: [{ lines: [{ productId: 'p1', quantity: 11 }, { productId: 'p2', quantity: 1, serialNumber: 'SN-01' }] }],
    }).expect(400);
    expect(res.body.code).toBe('PACKAGE_QTY_MISMATCH');
    // Rollback khôi phục đúng 2 kiện ban đầu.
    expect(db.state.packages().map((pkg: any) => pkg.packageCode).sort()).toEqual(['KIEN-A', 'KIEN-B']);
  });

  it('chặn xóa bản nháp nếu kiện đã phát sinh movement', async () => {
    const db = receiptDb();
    const documentId = (await createReceipt(db)).body.id;
    db.state.tables.stock_package_movements.push({ id: 'mv-1', packageId: db.state.packages()[0].id, productId: 'p1', warehouseId: 'wh-1', quantity: 6, moveType: 'RECEIPT' });

    const res = await request(appFor(manager, db)).put(`/documents/${documentId}`).send({
      packages: [{ lines: [{ productId: 'p1', quantity: 10 }, { productId: 'p2', quantity: 1, serialNumber: 'SN-01' }] }],
    }).expect(409);
    expect(res.body.code).toBe('PACKAGE_INVALID');
    expect(db.state.packages()).toHaveLength(2);
  });

  it('bắt buộc body packages là mảng và chỉ áp dụng cho phiếu nhập', async () => {
    const db = receiptDb();
    const documentId = (await createReceipt(db)).body.id;
    await request(appFor(manager, db)).put(`/documents/${documentId}`).send({ packages: 'KIEN-A' }).expect(400);

    const issueId = (await request(appFor(manager, db)).post('/issues').send({
      warehouseId: 'wh-1', lines: [{ productId: 'p1', quantity: 1 }],
    }).expect(201)).body.id;
    const res = await request(appFor(manager, db)).put(`/documents/${issueId}`).send({
      packages: [{ lines: [{ productId: 'p1', quantity: 1 }] }],
    }).expect(400);
    expect(res.body.error).toMatch(/chỉ được khai báo trên phiếu nhập/);
  });
});

describe('Hủy và xóa phiếu nhập có kiện', () => {
  it('hủy phiếu: kiện PENDING nghỉ cùng phiếu và có vết PACKAGE_CANCELLED', async () => {
    const db = receiptDb();
    const documentId = (await createReceipt(db)).body.id;
    const code = db.state.tables.stock_documents[0].code;

    await request(appFor(manager, db)).post(`/documents/${documentId}/cancel`).send({}).expect(200);

    expect(db.state.packages().every((pkg: any) => pkg.status === 'CANCELLED')).toBe(true);
    const cancelled = db.state.activities('PACKAGE_CANCELLED');
    expect(cancelled).toHaveLength(2);
    expect(cancelled[0].documentCode).toBe(code);
    expect(JSON.parse(cancelled[0].metadata)).toEqual({ reason: 'Hủy phiếu nhập' });
  });

  it('xóa phiếu: xóa hẳn bản nháp kiện, không để lại chứng từ mồ côi', async () => {
    const db = receiptDb();
    const documentId = (await createReceipt(db)).body.id;

    await request(appFor(manager, db)).delete(`/documents/${documentId}`).expect(200);

    expect(db.state.tables.stock_documents).toEqual([]);
    expect(db.state.packages()).toEqual([]);
    expect(db.state.packageLines()).toEqual([]);
  });

  it('phiếu đã ghi sổ thì không còn kiện PENDING để hủy', async () => {
    const db = receiptDb();
    const documentId = (await createReceipt(db)).body.id;
    await toReady(db, documentId).expect(200);
    await complete(db, documentId).expect(200);

    await request(appFor(manager, db)).post(`/documents/${documentId}/cancel`).send({}).expect(400);
    expect(db.state.packages().every((pkg: any) => pkg.status === 'IN_STOCK')).toBe(true);
    expect(db.state.activities('PACKAGE_CANCELLED')).toEqual([]);
  });
});

function docStatus(db: any, id: string) {
  return db.state.tables.stock_documents.find((row: any) => String(row.id) === String(id))?.status;
}
