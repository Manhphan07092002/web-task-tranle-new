import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createStockContext } from '../routes/stock/context.js';
import { packagesRoutes } from '../routes/stock/packages.js';

const EMPLOYEE = { id: 'emp-1', role: 'Employee', managementLevel: 10, permissions: [] };
const MANAGER = { id: 'mgr-1', role: 'Manager', managementLevel: 20, permissions: [] };
const DIRECTOR = { id: 'dir-1', role: 'Director', managementLevel: 40, permissions: [] };
const ADMIN = { id: 'adm-1', role: 'Admin', managementLevel: 99, permissions: [] };

const LOCATIONS = [
  { id: 'loc-1', warehouseId: 'wh-1', isActive: 1, purpose: 'PICKING' },
  { id: 'loc-2', warehouseId: 'wh-2', isActive: 1, purpose: 'SALEABLE' },
];

/** Kiện 1 là kiện chuẩn (còn hàng, còn khả dụng); các kiện sau dùng cho nhánh chặn. */
const PACKAGES = [
  { id: 'pkg-1', packageCode: 'KIEN-26-000001', packageTypeId: 'pkgtype-carton', warehouseId: 'wh-1', locationId: 'loc-1', sourceReceiptId: 'doc-r1', sourcePackageId: 'pkg-0', parentPackageId: null, status: 'IN_STOCK', notes: 'hang de san', receivedAt: '2026-10-01 08:00:00', pickedAt: null, createdAt: '2026-10-01 08:00:00', updatedAt: '2026-10-01 08:00:00' },
  { id: 'pkg-2', packageCode: 'KIEN-26-000002', packageTypeId: 'pkgtype-carton', warehouseId: 'wh-1', locationId: null, sourceReceiptId: null, sourcePackageId: null, parentPackageId: null, status: 'ISSUED', notes: null, createdAt: '2026-10-02 08:00:00', updatedAt: '2026-10-02 08:00:00' },
  { id: 'pkg-3', packageCode: 'KIEN-26-000003', packageTypeId: 'pkgtype-pallet', warehouseId: 'wh-1', locationId: null, sourceReceiptId: null, sourcePackageId: null, parentPackageId: null, status: 'HELD', notes: null, createdAt: '2026-10-03 08:00:00', updatedAt: '2026-10-03 08:00:00' },
  { id: 'pkg-4', packageCode: 'KIEN-26-000004', packageTypeId: 'pkgtype-pallet', warehouseId: 'wh-2', locationId: 'loc-2', sourceReceiptId: null, sourcePackageId: null, parentPackageId: null, status: 'IN_STOCK', notes: null, createdAt: '2026-10-04 08:00:00', updatedAt: '2026-10-04 08:00:00' },
  { id: 'pkg-0', packageCode: 'KIEN-26-000000', packageTypeId: null, warehouseId: 'wh-1', locationId: null, sourceReceiptId: null, sourcePackageId: null, parentPackageId: null, status: 'CANCELLED', notes: null, createdAt: '2026-09-30 08:00:00', updatedAt: '2026-09-30 08:00:00' },
  { id: 'pkg-5', packageCode: 'KIEN-26-000005', packageTypeId: null, warehouseId: 'wh-1', locationId: null, sourceReceiptId: null, sourcePackageId: 'pkg-1', parentPackageId: null, status: 'IN_STOCK', notes: null, createdAt: '2026-10-05 08:00:00', updatedAt: '2026-10-05 08:00:00' },
  { id: 'pkg-6', packageCode: 'KIEN-26-000006', packageTypeId: 'pkgtype-shrink', warehouseId: 'wh-1', locationId: null, sourceReceiptId: 'doc-r1', sourcePackageId: null, parentPackageId: null, status: 'PENDING', notes: null, createdAt: '2026-10-06 08:00:00', updatedAt: '2026-10-06 08:00:00' },
];

const LINES = [
  { id: 'pl-1', packageId: 'pkg-1', productId: 'p1', lineKey: 'p1|Q', qtyInitial: 10, qtyRemaining: 6, qtyHeld: 2, serialId: null, lotId: null, expiryDate: '2026-12-31', unitCost: 5, receiptDocumentId: 'doc-r1', receiptLineId: 'dl-1' },
  { id: 'pl-2', packageId: 'pkg-1', productId: 'p2', lineKey: 'p2|S:SN-9', qtyInitial: 1, qtyRemaining: 1, qtyHeld: 0, serialId: 'ser-9', lotId: null, expiryDate: null, unitCost: 0, receiptDocumentId: 'doc-r1', receiptLineId: 'dl-2' },
  { id: 'pl-3', packageId: 'pkg-2', productId: 'p1', lineKey: 'p1|Q', qtyInitial: 5, qtyRemaining: 0, qtyHeld: 0, serialId: null, lotId: null, expiryDate: null, unitCost: 5, receiptDocumentId: null, receiptLineId: null },
  { id: 'pl-4', packageId: 'pkg-3', productId: 'p1', lineKey: 'p1|Q', qtyInitial: 4, qtyRemaining: 4, qtyHeld: 4, serialId: null, lotId: null, expiryDate: null, unitCost: 5, receiptDocumentId: null, receiptLineId: null },
];

const PRODUCT_NAMES: Record<string, string> = { p1: 'Coa MTP 20A', p2: 'Aptomet 3P' };
const MOVEMENTS = [
  { id: 'mv-1', packageLineId: 'pl-1', productId: 'p1', quantity: 10, moveType: 'RECEIPT', referenceType: 'STOCK_DOCUMENT', referenceId: 'doc-r1', documentLineId: 'dl-1', moveId: 'sm-1', createdAt: '2026-10-01 08:00:00' },
  { id: 'mv-2', packageLineId: 'pl-1', productId: 'p1', quantity: -4, moveType: 'ISSUE', referenceType: 'STOCK_DOCUMENT', referenceId: 'doc-x1', documentLineId: 'dl-9', moveId: 'sm-2', createdAt: '2026-10-06 08:00:00' },
];
const ACTIVITIES = [
  { id: 'ac-1', actionType: 'PACKAGE_ISSUED', documentId: 'doc-x1', documentCode: 'PXK-26-0007', productId: 'p1', quantity: 4, userId: 'mgr-1', packageCode: 'KIEN-26-000001', metadata: '{"status":"PARTIAL_ISSUED"}', createdAt: '2026-10-06 08:00:00' },
];
const DOCUMENTS = [
  { id: 'doc-r1', code: 'PNK-26-0003', docType: 'RECEIPT', status: 'DONE', docDate: '2026-10-01', postingDate: '2026-10-01', partnerName: 'CDC', customerName: null, warehouseName: 'Kho 1' },
  { id: 'doc-x1', code: 'PXK-26-0007', docType: 'ISSUE', status: 'DONE', docDate: '2026-10-06', postingDate: '2026-10-06', partnerName: 'KDC', customerName: 'KDC', warehouseName: 'Kho 1' },
];
const PACKAGE_TYPES = [
  { id: 'pkgtype-carton', code: 'CARTON', name: 'Thùng carton', lengthCm: 40, widthCm: 30, heightCm: 20, maxWeightKg: 20, maxLines: 20, isActive: 1 },
  { id: 'pkgtype-pallet', code: 'PALLET', name: 'Pallet', lengthCm: 120, widthCm: 60, heightCm: null, maxWeightKg: 800, maxLines: null, isActive: 0 },
  { id: 'pkgtype-shrink', code: 'MEMG_CO', name: 'Kiện màng co', lengthCm: null, widthCm: null, heightCm: null, maxWeightKg: null, maxLines: null, isActive: 1 },
  { id: 'pkgtype-wood', code: 'KIEN_GO', name: 'Kiện gỗ', lengthCm: null, widthCm: null, heightCm: null, maxWeightKg: null, maxLines: null, isActive: 1 },
];

const clone = (row: any) => ({ ...row });

function packageDb(options: { scopes?: string[]; duplicateCode?: boolean } = {}) {
  const scopes = options.scopes ?? ['wh-1'];
  const packages = PACKAGES.map(clone);
  const packageTypes = PACKAGE_TYPES.map(clone);
  const state = {
    sql: [] as { sql: string; params: any[] }[],
    runs: [] as { sql: string; params: any[] }[],
    packages,
    packageTypes,
    activities: [] as any[],
    duplicateCode: options.duplicateCode === true,
  };

  /** Giả lập các JOIN của PACKAGE_FIELDS để router nhận đúng shape thật. */
  function decorate(row: any) {
    const type = packageTypes.find((item) => item.id === row.packageTypeId);
    const location = LOCATIONS.find((item) => item.id === row.locationId);
    return {
      ...row,
      packageTypeCode: type?.code ?? null,
      packageTypeName: type?.name ?? null,
      warehouseCode: row.warehouseId === 'wh-1' ? 'K1' : 'K2',
      warehouseName: row.warehouseId === 'wh-1' ? 'Kho 1' : 'Kho 2',
      locationCode: location?.id ?? null,
      locationName: location ? 'Vi tri ' + location.id : null,
      locationPurpose: location?.purpose ?? null,
    };
  }

  function selectPackages(sql: string, params: any[]) {
    if (sql.includes('WHERE p.packageCode = ?')) return packages.filter((row) => row.packageCode === params[0]).map(decorate);
    if (sql.includes('p.id IN (')) return packages.filter((row) => params.includes(row.id)).map(decorate);
    if (sql.includes('WHERE p.id = ?')) return packages.filter((row) => row.id === params[0]).map(decorate);
    if (sql.includes('WHERE p.sourcePackageId = ?')) {
      return packages.filter((row) => row.sourcePackageId === params[0] || row.parentPackageId === params[0]).map(decorate);
    }
    let rows = packages.map(decorate);
    if (sql.includes('LIMIT ? OFFSET ?')) {
      const limit = Number(params[params.length - 2]);
      const offset = Number(params[params.length - 1]);
      rows = rows.slice(offset, offset + limit);
    }
    return rows;
  }

  const db: any = {
    state,
    all: async (sql: string, params: any[] = []) => {
      state.sql.push({ sql, params });
      if (sql.includes('FROM user_warehouse_scopes')) return scopes.map((warehouseId) => ({ warehouseId }));
      if (sql.includes('FROM warehouses WHERE isActive')) return [{ id: 'wh-1' }, { id: 'wh-2' }];
      if (sql.includes('FROM stock_package_lines pl')) {
        const ids = sql.includes('pl.packageId IN (') ? params : [];
        return LINES.map(clone)
          .filter((line) => ids.length === 0 || ids.includes(line.packageId))
          .map((line) => ({
            packageLineId: line.id, packageId: line.packageId, productId: line.productId,
            lineKey: line.lineKey, qtyInitial: line.qtyInitial, qtyRemaining: line.qtyRemaining, qtyHeld: line.qtyHeld,
            serialId: line.serialId, lotId: line.lotId, expiryDate: line.expiryDate, unitCost: line.unitCost,
            receiptDocumentId: line.receiptDocumentId, receiptLineId: line.receiptLineId,
            productName: PRODUCT_NAMES[line.productId] || line.productId, productCode: line.productId.toUpperCase(),
            unit: 'cai', tracking: line.lineKey.includes('|S:') ? 'SERIAL' : 'QUANTITY',
            serialNumber: line.serialId ? 'SN-9' : null, lotCode: null, coilCode: null,
          }));
      }
      if (sql.includes('SELECT DISTINCT d.id')) return DOCUMENTS.map(clone);
      if (sql.includes('FROM stock_package_movements m')) return MOVEMENTS.map(clone);
      if (sql.includes('FROM warehouse_activity_logs')) return ACTIVITIES.map(clone);
      if (sql.includes('FROM stock_package_types t')) {
        const activeOnly = sql.includes('WHERE t.isActive = 1');
        return packageTypes
          .filter((row) => !activeOnly || Number(row.isActive) === 1)
          .map((row) => ({ ...row, packageCount: packages.filter((pkg) => pkg.packageTypeId === row.id).length }));
      }
      if (sql.includes('FROM stock_packages p')) return selectPackages(sql, params);
      return [];
    },
    get: async (sql: string, params: any[] = []) => {
      state.sql.push({ sql, params });
      if (sql.includes('COUNT(*) AS total FROM stock_packages WHERE packageTypeId')) {
        return { total: packages.filter((pkg) => pkg.packageTypeId === params[0]).length };
      }
      if (sql.includes('COUNT(*) AS total')) return { total: packages.length };
      if (sql.includes('FROM stock_documents')) return DOCUMENTS.find((doc) => doc.id === params[0]) || undefined;
      if (sql.includes('FROM stock_locations')) return LOCATIONS.find((loc) => loc.id === params[0]) || undefined;
      if (sql.includes('FROM stock_package_types')) return packageTypes.find((row) => row.id === params[0]) || undefined;
      return undefined;
    },
    run: async (sql: string, params: any[] = []) => {
      state.runs.push({ sql, params });
      if (sql.includes('INSERT INTO warehouse_activity_logs')) {
        const withPackage = sql.includes('packageId, packageCode');
        state.activities.push(withPackage
          ? { actionType: params[1], entityType: params[2], entityId: params[3], packageId: params[10], packageCode: params[11], metadata: params[12] }
          : { actionType: params[1], entityType: params[2], entityId: params[3] });
      }
      if (sql.includes('INSERT INTO stock_package_types')) {
        if (state.duplicateCode) throw Object.assign(new Error("Duplicate entry 'CARTON' for key 'code'"), { code: 'ER_DUP_ENTRY' });
        packageTypes.push({ id: params[0], code: params[1], name: params[2], isActive: params[8] });
      }
      if (sql.startsWith('UPDATE stock_packages SET locationId')) {
        const row = packages.find((pkg) => pkg.id === params[3]);
        if (row) { row.locationId = params[0]; row.notes = params[1]; }
      }
      if (sql.startsWith('UPDATE stock_package_types SET code')) {
        const row = packageTypes.find((item) => item.id === params[8]);
        if (row) Object.assign(row, { code: params[0], name: params[1], isActive: params[7] });
      }
      if (sql.startsWith('DELETE FROM stock_package_types')) {
        const index = packageTypes.findIndex((item) => item.id === params[0]);
        if (index >= 0) packageTypes.splice(index, 1);
        return { changes: index >= 0 ? 1 : 0 };
      }
      return { changes: 1 };
    },
  };
  return db;
}

function appFor(db: any, user?: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { if (user) req.user = user; next(); });
  app.use(packagesRoutes(createStockContext(db)));
  return app;
}

const sqlOf = (db: any) => db.state.runs.map((entry: any) => entry.sql);
const lastSelect = (db: any, needle: string) => [...db.state.sql].reverse().find((entry: any) => entry.sql.includes(needle));

describe('GET /packages', () => {
  it('returns packages with enriched lines, totals and X-Total-Count', async () => {
    const db = packageDb();
    const res = await request(appFor(db, MANAGER)).get('/packages').expect(200);
    const first = res.body.find((row: any) => row.id === 'pkg-1');
    expect(first).toMatchObject({
      packageCode: 'KIEN-26-000001',
      status: 'IN_STOCK',
      packageTypeName: 'Thùng carton',
      lineCount: 2,
      totalQty: 7,
      totalHeld: 2,
      availableQty: 5,
    });
    expect(first.lines[1]).toMatchObject({ packageLineId: 'pl-2', productName: 'Aptomet 3P', serialNumber: 'SN-9' });
    expect(res.headers['x-total-count']).toBe(String(db.state.packages.length));
  });

  it('limits the query to the warehouse scope of a non-director', async () => {
    const db = packageDb();
    await request(appFor(db, MANAGER)).get('/packages').expect(200);
    const list = lastSelect(db, 'ORDER BY p.createdAt DESC');
    expect(list.sql).toContain('p.warehouseId IN (?)');
    expect(list.params).toContain('wh-1');

    const directorDb = packageDb();
    await request(appFor(directorDb, DIRECTOR)).get('/packages').expect(200);
    expect(lastSelect(directorDb, 'ORDER BY p.createdAt DESC').sql).not.toContain('p.warehouseId IN');
  });

  it('rejects another warehouse, an unknown status and anonymous/Admin callers', async () => {
    const db = packageDb();
    await request(appFor(db, MANAGER)).get('/packages?warehouseId=wh-2').expect(403);
    const bad = await request(appFor(packageDb(), MANAGER)).get('/packages?status=NOT_A_STATUS').expect(400);
    expect(bad.body.code).toBe('PACKAGE_INVALID');
    await request(appFor(packageDb(), undefined)).get('/packages').expect(401);
    await request(appFor(packageDb(), ADMIN)).get('/packages').expect(403);
  });

  it('returns an empty array with zero total for a user without scope', async () => {
    const db = packageDb({ scopes: [] });
    const res = await request(appFor(db, MANAGER)).get('/packages').expect(200);
    expect(res.body).toEqual([]);
    expect(res.headers['x-total-count']).toBe('0');
  });

  it('threads limit/offset into the page query', async () => {
    const db = packageDb();
    const res = await request(appFor(db, DIRECTOR)).get('/packages?limit=1&offset=1').expect(200);
    expect(res.body.map((row: any) => row.id)).toEqual([PACKAGES[1].id]);
    expect(lastSelect(db, 'ORDER BY p.createdAt DESC').params.slice(-2)).toEqual([1, 1]);
  });
});

describe('GET /package-inventory', () => {
  it('defaults to packages still holding stock', async () => {
    const db = packageDb();
    await request(appFor(db, DIRECTOR)).get('/package-inventory').expect(200);
    const list = lastSelect(db, 'ORDER BY p.createdAt DESC');
    expect(list.sql).toContain('p.status IN (?, ?, ?)');
    expect(list.params.slice(0, 3)).toEqual(['IN_STOCK', 'HELD', 'PARTIAL_ISSUED']);
    expect(list.sql).toContain('fs.qtyRemaining > 0');
  });

  it('lets the caller widen the status list but not invent one', async () => {
    const db = packageDb();
    await request(appFor(db, DIRECTOR)).get('/package-inventory?status=ISSUED&includeEmpty=true').expect(200);
    const list = lastSelect(db, 'ORDER BY p.createdAt DESC');
    expect(list.params).toContain('ISSUED');
    expect(list.sql).not.toContain('fs.qtyRemaining > 0');
    await request(appFor(packageDb(), DIRECTOR)).get('/package-inventory?status=XXX').expect(400);
  });
});

describe('GET /packages/lookup', () => {
  it('accepts a lowercase code and unblocks a free in-stock package', async () => {
    const db = packageDb();
    const res = await request(appFor(db, MANAGER)).get('/packages/lookup?code=kien-26-000001&warehouseId=wh-1&docType=ISSUE').expect(200);
    expect(res.body.package).toMatchObject({ id: 'pkg-1', packageCode: 'KIEN-26-000001', warehouseName: 'Kho 1', locationName: 'Vi tri loc-1' });
    expect(res.body.package.availableQty).toBe(5);
    expect(res.body.lines).toHaveLength(2);
    expect(res.body.blocked).toBeNull();
    expect(lastSelect(db, 'WHERE p.packageCode = ?').params).toEqual(['KIEN-26-000001']);
  });

  it('blocks pending, issued and fully held packages', async () => {
    const issued = await request(appFor(packageDb(), MANAGER)).get('/packages/lookup?code=KIEN-26-000002').expect(200);
    expect(issued.body.blocked).toMatchObject({ code: 'PACKAGE_ISSUED' });
    const held = await request(appFor(packageDb(), MANAGER)).get('/packages/lookup?code=KIEN-26-000003').expect(200);
    expect(held.body.blocked).toMatchObject({ code: 'PACKAGE_HELD' });
    const pending = await request(appFor(packageDb(), MANAGER)).get('/packages/lookup?code=KIEN-26-000006').expect(200);
    expect(pending.body.blocked).toMatchObject({ code: 'PACKAGE_PENDING' });
  });

  it('reopens issued and cancelled packages for return docs but refuses re-receipt', async () => {
    const cancelled = await request(appFor(packageDb(), MANAGER)).get('/packages/lookup?code=KIEN-26-000000&docType=RETURN').expect(200);
    expect(cancelled.body.blocked).toBeNull();
    const returned = await request(appFor(packageDb(), MANAGER)).get('/packages/lookup?code=KIEN-26-000002&docType=RETURN').expect(200);
    expect(returned.body.blocked).toBeNull();
    const receipt = await request(appFor(packageDb(), MANAGER)).get('/packages/lookup?code=KIEN-26-000001&docType=RECEIPT').expect(200);
    expect(receipt.body.blocked).toMatchObject({ code: 'PACKAGE_CODE_DUPLICATE' });
    const pendingReceipt = await request(appFor(packageDb(), MANAGER)).get('/packages/lookup?code=KIEN-26-000006&docType=RECEIPT').expect(200);
    expect(pendingReceipt.body.blocked).toBeNull();
  });

  it('blocks a package from another warehouse before anything else', async () => {
    const res = await request(appFor(packageDb(), DIRECTOR)).get('/packages/lookup?code=KIEN-26-000004&warehouseId=wh-1').expect(200);
    expect(res.body.blocked).toMatchObject({ code: 'PACKAGE_WRONG_WAREHOUSE' });
  });

  it('blocks a package that is still in transit', async () => {
    const db = packageDb();
    db.state.packages.find((row: any) => row.id === 'pkg-3').status = 'IN_TRANSIT';
    const res = await request(appFor(db, MANAGER)).get('/packages/lookup?code=KIEN-26-000003').expect(200);
    expect(res.body.blocked).toMatchObject({ code: 'PACKAGE_WRONG_WAREHOUSE' });
  });

  it('answers 400/404/403 for missing, unknown and out-of-scope codes', async () => {
    const missing = await request(appFor(packageDb(), MANAGER)).get('/packages/lookup').expect(400);
    expect(missing.body.code).toBe('PACKAGE_INVALID');
    const unknown = await request(appFor(packageDb(), MANAGER)).get('/packages/lookup?code=KIEN-26-999999').expect(404);
    expect(unknown.body.code).toBe('PACKAGE_NOT_FOUND');
    await request(appFor(packageDb(), MANAGER)).get('/packages/lookup?code=KIEN-26-000004').expect(403);
  });
});

describe('GET /packages/:id and /trace', () => {
  it('loads one package and hides packages outside the scope', async () => {
    const res = await request(appFor(packageDb(), MANAGER)).get('/packages/pkg-1').expect(200);
    expect(res.body).toMatchObject({ id: 'pkg-1', lineCount: 2, totalQty: 7 });
    await request(appFor(packageDb(), MANAGER)).get('/packages/pkg-4').expect(403);
    const missing = await request(appFor(packageDb(), MANAGER)).get('/packages/pkg-99').expect(404);
    expect(missing.body.code).toBe('PACKAGE_NOT_FOUND');
  });

  it('assembles movements, documents, activities and package lineage', async () => {
    const res = await request(appFor(packageDb(), MANAGER)).get('/packages/pkg-1/trace').expect(200);
    expect(res.body.package.id).toBe('pkg-1');
    expect(res.body.movements).toHaveLength(2);
    expect(res.body.documents).toHaveLength(2);
    expect(res.body.receiptDocument).toMatchObject({ code: 'PNK-26-0003' });
    expect(res.body.activities[0]).toMatchObject({ actionType: 'PACKAGE_ISSUED', metadata: { status: 'PARTIAL_ISSUED' } });
    expect(res.body.sourcePackages.map((row: any) => row.id)).toEqual(['pkg-0']);
    expect(res.body.derivedPackages.map((row: any) => row.id)).toEqual(['pkg-5']);
  });

  it('refuses the trace of a package in a warehouse outside scope', async () => {
    await request(appFor(packageDb(), MANAGER)).get('/packages/pkg-4/trace').expect(403);
  });
});

describe('PATCH /packages/:id', () => {
  it('moves the package and logs a package-scoped activity', async () => {
    const db = packageDb();
    const res = await request(appFor(db, MANAGER)).patch('/packages/pkg-1').send({ locationId: 'loc-1', notes: 'dich chuyen' }).expect(200);
    expect(res.body.package).toMatchObject({ id: 'pkg-1', notes: 'dich chuyen' });
    expect(sqlOf(db)).toContain('UPDATE stock_packages SET locationId = ?, notes = ?, updatedAt = ? WHERE id = ?');
    expect(db.state.packages.find((row: any) => row.id === 'pkg-1').notes).toBe('dich chuyen');
    const activity = db.state.activities.at(-1);
    expect(activity).toMatchObject({ actionType: 'PACKAGE_UPDATED', entityType: 'PACKAGE', packageId: 'pkg-1', packageCode: 'KIEN-26-000001' });
    expect(JSON.parse(activity.metadata)).toMatchObject({ new: { locationId: 'loc-1' } });
  });

  it('requires manager role, warehouse scope and a location of the same warehouse', async () => {
    await request(appFor(packageDb(), EMPLOYEE)).patch('/packages/pkg-1').send({ notes: 'x' }).expect(403);
    await request(appFor(packageDb(), undefined)).patch('/packages/pkg-1').send({ notes: 'x' }).expect(401);
    const otherWarehouse = await request(appFor(packageDb({ scopes: ['wh-2'] }), MANAGER)).patch('/packages/pkg-1').send({ notes: 'x' });
    expect(otherWarehouse.status).toBe(403);
    const badLocation = await request(appFor(packageDb(), MANAGER)).patch('/packages/pkg-1').send({ locationId: 'loc-2' }).expect(400);
    expect(badLocation.body.code).toBe('PACKAGE_INVALID');
  });

  it('refuses issued and cancelled packages and an empty body', async () => {
    const issued = await request(appFor(packageDb(), MANAGER)).patch('/packages/pkg-2').send({ notes: 'x' }).expect(409);
    expect(issued.body.code).toBe('PACKAGE_ISSUED');
    await request(appFor(packageDb(), MANAGER)).patch('/packages/pkg-0').send({ notes: 'x' }).expect(409);
    await request(appFor(packageDb(), MANAGER)).patch('/packages/pkg-1').send({}).expect(400);
    const db = packageDb();
    await request(appFor(db, MANAGER)).patch('/packages/pkg-99').send({ notes: 'x' }).expect(404);
    expect(sqlOf(db).some((sql: string) => sql.startsWith('UPDATE stock_packages'))).toBe(false);
  });
});

describe('package types', () => {
  it('lists the active catalog and can include inactive rows', async () => {
    const active = await request(appFor(packageDb(), EMPLOYEE)).get('/package-types').expect(200);
    expect(active.body.map((row: any) => row.id).sort()).toEqual(['pkgtype-carton', 'pkgtype-shrink', 'pkgtype-wood']);
    expect(active.body[0]).toMatchObject({ code: 'CARTON', isActive: true, packageCount: 2 });
    const all = await request(appFor(packageDb(), EMPLOYEE)).get('/package-types?includeInactive=true').expect(200);
    expect(all.body).toHaveLength(4);
    await request(appFor(packageDb(), ADMIN)).get('/package-types').expect(403);
  });

  it('creates a type for managers, upper-casing the code', async () => {
    const db = packageDb();
    const res = await request(appFor(db, MANAGER)).post('/package-types').send({ code: 'kien_go', name: 'Kiện gỗ', maxLines: 12 }).expect(201);
    expect(String(res.body.id)).toContain('pkgtype-');
    const insert = db.state.runs.find((entry: any) => entry.sql.includes('INSERT INTO stock_package_types'));
    expect(insert.params.slice(1, 3)).toEqual(['KIEN_GO', 'Kiện gỗ']);
    expect(insert.params[7]).toBe(12);
    expect(db.state.activities.at(-1)).toMatchObject({ actionType: 'PACKAGE_TYPE_CREATED', entityType: 'PACKAGE_TYPE' });
    await request(appFor(packageDb(), EMPLOYEE)).post('/package-types').send({ code: 'XX', name: 'Y' }).expect(403);
    await request(appFor(packageDb(), ADMIN)).post('/package-types').send({ code: 'XX', name: 'Y' }).expect(403);
  });

  it('validates the payload and maps a duplicate code to 409', async () => {
    const invalid = await request(appFor(packageDb(), MANAGER)).post('/package-types').send({ code: 'X', name: '' }).expect(400);
    expect(invalid.body.error).toBe('Validation failed');
    const dupDb = packageDb({ duplicateCode: true });
    const duplicate = await request(appFor(dupDb, MANAGER)).post('/package-types').send({ code: 'CARTON', name: 'Thùng' }).expect(409);
    expect(duplicate.body.code).toBe('PACKAGE_CODE_DUPLICATE');
    expect(sqlOf(dupDb).some((sql: string) => sql.includes('COMMIT'))).toBe(false);
  });

  it('updates a type and 404s when it is gone', async () => {
    const db = packageDb();
    await request(appFor(db, MANAGER)).put('/package-types/pkgtype-carton').send({ name: 'Thùng carton 40' }).expect(200);
    expect(db.state.packageTypes.find((row: any) => row.id === 'pkgtype-carton').name).toBe('Thùng carton 40');
    await request(appFor(packageDb(), MANAGER)).put('/package-types/pkgtype-none').send({ name: 'X' }).expect(404);
  });

  it('blocks deletion while packages still use the type', async () => {
    const inUse = await request(appFor(packageDb(), MANAGER)).delete('/package-types/pkgtype-carton').expect(409);
    expect(inUse.body.code).toBe('PACKAGE_TYPE_IN_USE');
    expect(inUse.body.error).toContain('2 kiện');

    const db = packageDb();
    await request(appFor(db, MANAGER)).delete('/package-types/pkgtype-wood').expect(200);
    expect(db.state.packageTypes.some((row: any) => row.id === 'pkgtype-wood')).toBe(false);
    expect(db.state.activities.at(-1)).toMatchObject({ actionType: 'PACKAGE_TYPE_DELETED' });
  });
});
