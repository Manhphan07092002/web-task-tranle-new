import { describe, expect, it } from 'vitest';
import {
  PackageError,
  activatePackages,
  buildPackageLineKey,
  cancelPendingPackages,
  consumePackageLines,
  createPackages,
  derivePackageStatus,
  findPackageByCode,
  holdPackages,
  listPackagesByIds,
  nextPackageCode,
  normalizePackageCode,
  releasePackages,
  restorePackageLines,
  validatePackages,
  type PackageInput,
} from '../services/packageService.js';

const YY = String(new Date().getFullYear()).slice(2);
const WH = 'wh-1';

const PRODUCTS = [
  { id: 'p1', name: 'Điều hòa 9000', tracking: 'QUANTITY', expiryRequired: 0 },
  { id: 'p2', name: 'Máy lọc nước', tracking: 'SERIAL', expiryRequired: 0 },
  { id: 'p3', name: ' tôn lạnh', tracking: 'LOT', expiryRequired: 0 },
  { id: 'p4', name: 'Keo silicon', tracking: 'QUANTITY', expiryRequired: 1 },
];

/**
 * In-memory double chỉ mô phỏng SQL mà packageService phát ra. Có chủ đích:
 * không có stock_balances/stock_moves — mọi test phải thấy ledger không đổi.
 */
function packageDb(seed: { locations?: any[] } = {}) {
  const state = {
    products: PRODUCTS.map((product) => ({ ...product })),
    locations: (seed.locations ?? [{ id: 'loc-1', warehouseId: WH, isActive: 1 }]).map((row) => ({ ...row })),
    packages: [] as any[],
    packageLines: [] as any[],
    movements: [] as any[],
    activities: [] as any[],
    sql: [] as string[],
  };

  const insertShape = (sql: string) => {
    const flat = sql.replace(/\s+/g, ' ');
    const match = flat.match(/INSERT(?: IGNORE)? INTO (\w+) \(([^)]+)\) VALUES ([\s\S]*)$/);
    if (!match) throw new Error(`Unhandled INSERT: ${flat}`);
    const columns = match[2].split(',').map((column) => column.trim());
    const tuples = [...match[3].matchAll(/\(([^)]*)\)/g)].map((row) => row[1].split(',').map((token) => token.trim()));
    return { table: match[1], columns, tuples };
  };

  const db: any = {
    state,
    all: async (sql: string, params: any[] = []) => {
      state.sql.push(sql);
      const flat = sql.replace(/\s+/g, ' ');
      if (flat.includes('FROM products WHERE id IN')) {
        return state.products.filter((product) => params.includes(product.id)).map((product) => ({ ...product }));
      }
      if (flat.includes('FROM stock_locations WHERE id IN')) {
        return state.locations.filter((location) => params.includes(location.id)).map((location) => ({ ...location }));
      }
      if (flat.includes('FROM stock_package_lines')) {
        if (flat.includes('WHERE id IN')) return state.packageLines.filter((line) => params.includes(line.id)).sort((a, b) => a.id.localeCompare(b.id));
        return state.packageLines.filter((line) => params.includes(line.packageId)).sort((a, b) => `${a.packageId}${a.id}`.localeCompare(`${b.packageId}${b.id}`));
      }
      if (flat.includes('FROM stock_packages WHERE packageCode LIKE')) {
        const pattern = String(flat).includes('LIKE ?') ? String(params[0]) : '';
        const suffix = pattern.replace(/%$/, '');
        const codes = state.packages.map((pkg) => String(pkg.packageCode)).filter((code) => code.startsWith(suffix));
        if (codes.length === 0) return [];
        const max = codes.sort((a, b) => Number(a.split('-').pop()) - Number(b.split('-').pop())).pop()!;
        return [{ code: max }];
      }
      if (flat.includes('FROM stock_packages WHERE packageCode = ?')) {
        return state.packages.filter((pkg) => pkg.packageCode === params[0]).map((pkg) => ({ ...pkg }));
      }
      if (flat.includes('FROM stock_packages WHERE packageCode IN')) {
        return state.packages.filter((pkg) => params.includes(pkg.packageCode)).map((pkg) => ({ packageCode: pkg.packageCode }));
      }
      if (flat.includes('FROM stock_packages WHERE id IN')) {
        return state.packages.filter((pkg) => params.includes(pkg.id)).sort((a, b) => a.id.localeCompare(b.id)).map((pkg) => ({ ...pkg }));
      }
      if (flat.includes('FROM stock_package_movements') || flat.includes('FROM warehouse_activity_logs')) return [];
      throw new Error(`Unhandled SELECT: ${flat}`);
    },
    get: async () => undefined,
    run: async (sql: string, params: any[] = []) => {
      state.sql.push(sql);
      const flat = sql.replace(/\s+/g, ' ');
      if (flat.startsWith('INSERT INTO')) {
        const { table, columns, tuples } = insertShape(flat);
        let cursor = 0;
        const rows = tuples.map((tuple) => {
          const row: Record<string, any> = {};
          tuple.forEach((token, index) => {
            if (index >= columns.length) return;
            if (token === '?') row[columns[index]] = params[cursor++];
            else if (/^'.*'$/.test(token)) row[columns[index]] = token.slice(1, -1);
            else if (token === 'NULL') row[columns[index]] = null;
            else row[columns[index]] = Number(token);
          });
          return row;
        });
        if (table === 'stock_packages') state.packages.push(...rows);
        else if (table === 'stock_package_lines') state.packageLines.push(...rows.map((row) => ({ qtyHeld: 0, serialId: null, lotId: null, ...row })));
        else if (table === 'stock_package_movements') state.movements.push(...rows);
        else if (table === 'warehouse_activity_logs') state.activities.push(...rows.map((row) => ({ ...row, metadata: row.metadata ? JSON.parse(row.metadata) : null })));
        else throw new Error(`Unhandled INSERT table: ${table}`);
        return { changes: rows.length };
      }
      if (flat.includes('UPDATE stock_package_lines SET serialId = ?, lotId = ?')) {
        const line = state.packageLines.find((row) => row.id === params[3]);
        if (line) { line.serialId = params[0]; line.lotId = params[1]; }
        return { changes: 1 };
      }
      if (flat.includes('SET qtyRemaining = qtyRemaining - ?')) {
        const line = state.packageLines.find((row) => row.id === params[3]);
        if (line) {
          line.qtyRemaining = Number(line.qtyRemaining) - Number(params[0]);
          line.qtyHeld = Math.max(0, Number(line.qtyHeld) - Number(params[1]));
        }
        return { changes: 1 };
      }
      if (flat.includes('SET qtyRemaining = qtyRemaining + ?')) {
        const line = state.packageLines.find((row) => row.id === params[2]);
        if (line) line.qtyRemaining = Number(line.qtyRemaining) + Number(params[0]);
        return { changes: 1 };
      }
      if (flat.includes('SET qtyHeld = qtyRemaining')) {
        for (const line of state.packageLines.filter((row) => row.packageId === params[1])) line.qtyHeld = line.qtyRemaining;
        return { changes: 1 };
      }
      if (flat.includes('SET qtyHeld = 0')) {
        for (const line of state.packageLines.filter((row) => row.packageId === params[1])) line.qtyHeld = 0;
        return { changes: 1 };
      }
      if (flat.includes("SET status = 'CANCELLED'")) {
        const pkg = state.packages.find((row) => row.id === params[1] && row.status === 'PENDING');
        if (pkg) pkg.status = 'CANCELLED';
        return { changes: pkg ? 1 : 0 };
      }
      if (flat.includes("SET status = 'HELD'")) {
        const pkg = state.packages.find((row) => row.id === params[3]);
        if (pkg) { pkg.status = 'HELD'; pkg.pickedAt = params[0]; pkg.pickedBy = params[1]; }
        return { changes: pkg ? 1 : 0 };
      }
      if (flat.includes('SET status = ?, receivedAt = ?')) {
        const pkg = state.packages.find((row) => row.id === params[5] && row.status === 'PENDING');
        if (!pkg) return { changes: 0 };
        pkg.status = params[0];
        pkg.receivedAt = params[1];
        pkg.receivedBy = params[2];
        if (params[3]) pkg.locationId = params[3];
        return { changes: 1 };
      }
      if (flat.includes('SET status = ?, pickedAt = COALESCE')) {
        const pkg = state.packages.find((row) => row.id === params[4]);
        if (!pkg) return { changes: 0 };
        pkg.status = params[0];
        pkg.pickedAt = pkg.pickedAt ?? params[1];
        pkg.pickedBy = pkg.pickedBy ?? params[2];
        return { changes: 1 };
      }
      if (flat.includes('UPDATE stock_packages SET status = ?, updatedAt = ?')) {
        const pkg = state.packages.find((row) => row.id === params[2]);
        if (!pkg) return { changes: 0 };
        pkg.status = params[0];
        return { changes: 1 };
      }
      throw new Error(`Unhandled SQL: ${flat}`);
    },
  };
  return db;
}

const input = (overrides: Partial<PackageInput> = {}): PackageInput => ({
  packageCode: null,
  lines: [{ productId: 'p1', quantity: 10 }],
  ...overrides,
});

/** Kiện PENDING 1 dòng × 10 SP p1 đã sẵn sàng để activate. */
async function draftPackage(db: any, pkg: PackageInput = input()) {
  const normalized = await validatePackages(db, [pkg], { warehouseId: WH });
  return (await createPackages(db, { warehouseId: WH, createdBy: 'u1', sourceReceiptId: 'doc-1', packages: normalized }))[0];
}

describe('packageService pure helpers', () => {
  it('normalizes and validates package codes', () => {
    expect(normalizePackageCode(' kien-26-000001 ')).toBe('KIEN-26-000001');
    expect(normalizePackageCode('')).toBeNull();
    expect(() => normalizePackageCode('abc!')).toThrowError(/không hợp lệ/);
  });

  it('builds the §3.1 line key', () => {
    expect(buildPackageLineKey('p1', { serialNumber: ' sn-01 ' })).toBe('p1|S:SN-01');
    expect(buildPackageLineKey('p1', { lotCode: 'lot-a' })).toBe('p1|L:LOT-A');
    expect(buildPackageLineKey('p1', {})).toBe('p1|Q');
  });

  it('derives package status exactly like the design table', () => {
    const line = (qtyInitial: number, qtyRemaining: number, qtyHeld = 0) => ({ qtyInitial, qtyRemaining, qtyHeld });
    expect(derivePackageStatus({ status: 'PENDING' }, [line(10, 10)])).toBe('PENDING');
    expect(derivePackageStatus({ status: 'IN_TRANSIT' }, [line(10, 10)])).toBe('IN_TRANSIT');
    expect(derivePackageStatus({ status: 'IN_STOCK' }, [line(10, 0)])).toBe('ISSUED');
    expect(derivePackageStatus({ status: 'IN_STOCK' }, [line(10, 6, 6)])).toBe('HELD');
    expect(derivePackageStatus({ status: 'HELD' }, [line(10, 4, 0)])).toBe('PARTIAL_ISSUED');
    expect(derivePackageStatus({ status: 'IN_STOCK' }, [line(10, 10)])).toBe('IN_STOCK');
  });

  it('generates KIEN-YY-NNNNNN from MAX + 1', async () => {
    const db = packageDb();
    expect(await nextPackageCode(db)).toBe(`KIEN-${YY}-000001`);
    await draftPackage(db, input({ packageCode: 'KIEN-25-999999' }));
    await draftPackage(db, input({ packageCode: `KIEN-${YY}-000041` }));
    expect(await nextPackageCode(db)).toBe(`KIEN-${YY}-000042`);
  });
});

describe('packageService validation', () => {
  it('normalizes a valid package with product, tracking and line key', async () => {
    const db = packageDb();
    const [pkg] = await validatePackages(db, [input({ packageCode: 'kien-a1', notes: '  ', locationId: 'loc-1' })], { warehouseId: WH });
    expect(pkg.packageCode).toBe('KIEN-A1');
    expect(pkg.notes).toBeNull();
    expect(pkg.lines[0]).toMatchObject({ productId: 'p1', productName: 'Điều hòa 9000', tracking: 'QUANTITY', quantity: 10, unitCost: 0, lineKey: 'p1|Q' });
  });

  it('rejects empty packages, bad quantities and unknown products', async () => {
    const db = packageDb();
    await expect(validatePackages(db, [], { warehouseId: WH })).resolves.toEqual([]);
    await expect(validatePackages(db, [input({ lines: [] })], { warehouseId: WH })).rejects.toThrow(/ít nhất một dòng/);
    await expect(validatePackages(db, [input({ lines: [{ productId: 'p1', quantity: 0 }] })], { warehouseId: WH })).rejects.toThrow(/lớn hơn 0/);
    await expect(validatePackages(db, [input({ lines: [{ productId: 'p9', quantity: 1 }] })], { warehouseId: WH })).rejects.toThrow(/không tồn tại/);
  });

  it('rejects duplicate codes inside one request and codes already in DB', async () => {
    const db = packageDb();
    await expect(validatePackages(db, [input({ packageCode: 'KIEN-A1' }), input({ packageCode: 'kien-a1' })], { warehouseId: WH }))
      .rejects.toThrow(/hơn một lần/);
    await draftPackage(db, input({ packageCode: 'KIEN-A2' }));
    const error: any = await validatePackages(db, [input({ packageCode: 'KIEN-A2' })], { warehouseId: WH }).catch((err) => err);
    expect(error).toBeInstanceOf(PackageError);
    expect(error.code).toBe('PACKAGE_CODE_DUPLICATE');
    expect(error.status).toBe(409);
  });

  it('enforces SERIAL, LOT and expiry rules from product tracking', async () => {
    const db = packageDb();
    const serial = (line: any) => validatePackages(db, [input({ lines: [line] })], { warehouseId: WH });
    const serialError: any = await serial({ productId: 'p2', quantity: 2, serialNumber: 'SN-1' }).catch((err) => err);
    expect(serialError.code).toBe('PACKAGE_LINE_SERIAL_REQUIRED');
    await expect(serial({ productId: 'p2', quantity: 1 })).rejects.toThrow(/1 serial/);
    const lotError: any = await serial({ productId: 'p3', quantity: 5 }).catch((err) => err);
    expect(lotError.code).toBe('PACKAGE_LINE_LOT_REQUIRED');
    const expiryError: any = await serial({ productId: 'p4', quantity: 5, lotCode: 'L1' }).catch((err) => err);
    expect(expiryError.code).toBe('PACKAGE_LINE_EXPIRY_REQUIRED');
    await expect(serial({ productId: 'p4', quantity: 5, expiryDate: '05/10/2026' })).rejects.toThrow(/yyyy-mm-dd/);
    await expect(serial({ productId: 'p4', quantity: 5, expiryDate: '2026-10-05' })).resolves.toBeTruthy();
  });

  it('rejects a location outside the warehouse and duplicated line keys', async () => {
    const db = packageDb({ locations: [{ id: 'loc-1', warehouseId: 'wh-2', isActive: 1 }] });
    await expect(validatePackages(db, [input({ locationId: 'loc-1' })], { warehouseId: WH })).rejects.toThrow(/không thuộc kho/);
    const sameDb = packageDb();
    await expect(validatePackages(sameDb, [input({ lines: [
      { productId: 'p2', quantity: 1, serialNumber: 'SN-1' },
      { productId: 'p2', quantity: 1, serialNumber: 'sn-1' },
    ] })], { warehouseId: WH })).rejects.toThrow(/trùng trong cùng một kiện/);
  });

  it('blocks when packaged totals drift from the document lines', async () => {
    const db = packageDb();
    const split = [input({ packageCode: 'KIEN-A', lines: [{ productId: 'p1', quantity: 6 }] }), input({ packageCode: 'KIEN-B', lines: [{ productId: 'p1', quantity: 3 }] })];
    const error: any = await validatePackages(db, split, { warehouseId: WH, expectedQuantitiesByProduct: { p1: 10 } }).catch((err) => err);
    expect(error.code).toBe('PACKAGE_QTY_MISMATCH');
    expect(error.details).toMatchObject({ mismatches: [{ productId: 'p1', expectedQty: 10, packagedQty: 9 }] });
    await expect(validatePackages(db, [input({ lines: [{ productId: 'p1', quantity: 9.9999 }] })], { warehouseId: WH, expectedQuantitiesByProduct: { p1: 10 } }))
      .resolves.toBeTruthy();
    const extra: any = await validatePackages(db, [input()], { warehouseId: WH, expectedQuantitiesByProduct: { p3: 4 } }).catch((err) => err);
    expect(extra.details).toMatchObject({ productsWithoutDocumentLine: ['p1'] });
  });
});

describe('packageService lifecycle', () => {
  it('creates PENDING packages with auto codes and no ledger writes', async () => {
    const db = packageDb();
    const normalized = await validatePackages(db, [input(), input({ lines: [{ productId: 'p1', quantity: 4 }, { productId: 'p3', quantity: 2, lotCode: 'L-7' }] })], { warehouseId: WH });
    const created = await createPackages(db, { warehouseId: WH, createdBy: 'u1', sourceReceiptId: 'doc-1', packages: normalized });
    expect(created.map((pkg) => pkg.packageCode).sort()).toEqual([`KIEN-${YY}-000001`, `KIEN-${YY}-000002`]);
    const mixed = created.find((pkg) => pkg.lines!.length === 2)!;
    expect(mixed.packageCode).toBe(`KIEN-${YY}-000002`);
    expect(mixed.lines!.find((line) => line.lineKey === 'p1|Q')).toMatchObject({ qtyInitial: 4, qtyRemaining: 4, qtyHeld: 0 });
    expect(mixed.lines!.find((line) => line.lineKey === 'p3|L:L-7')!.serialId).toBeNull();
    expect(created.every((pkg) => pkg.status === 'PENDING')).toBe(true);
    expect(Number(mixed.totalQty)).toBeCloseTo(6, 3);
    expect(db.state.movements).toEqual([]);
    expect(db.state.activities).toEqual([]);
    expect(stateSql(db)).toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO stock_packages')]));
    expect(stateSql(db).some((sql) => sql.includes('stock_moves') || sql.includes('stock_balances'))).toBe(false);
  });

  it('activates a package, binds serial/lot and records receipt audit', async () => {
    const db = packageDb();
    const draft = await draftPackage(db, input({ lines: [
      { productId: 'p1', quantity: 10 },
      { productId: 'p2', quantity: 1, serialNumber: 'SN-1' },
    ] }));
    const serialLine = draft.lines!.find((line) => line.lineKey === 'p2|S:SN-1')!;
    const looseLine = draft.lines!.find((line) => line.lineKey === 'p1|Q')!;
    const [pkg] = await activatePackages(db, {
      packageIds: [draft.id], receivedBy: 'u1', documentId: 'doc-1', documentCode: 'PNK-26-0001',
      bindings: [{ packageLineId: serialLine.id, serialId: 'serial-1' }, { packageLineId: looseLine.id, lotId: 'lot-1' }],
    });
    expect(pkg.status).toBe('IN_STOCK');
    expect(pkg.receivedAt).toBeTruthy();
    expect(pkg.lines!.find((line) => line.lineKey === 'p2|S:SN-1')!.serialId).toBe('serial-1');
    expect(pkg.lines!.find((line) => line.lineKey === 'p1|Q')!.lotId).toBe('lot-1');
    expect(db.state.movements).toHaveLength(2);
    expect(db.state.movements.every((movement: any) => movement.moveType === 'RECEIPT' && Number(movement.quantity) > 0)).toBe(true);
    expect(db.state.activities).toHaveLength(1);
    expect(db.state.activities[0]).toMatchObject({ actionType: 'PACKAGE_RECEIVED', entityType: 'PACKAGE', entityId: pkg.id, packageId: pkg.id, packageCode: pkg.packageCode });
    // activate lại không được nhân đôi movement/log (idempotent theo trạng thái).
    const again = await activatePackages(db, { packageIds: [pkg.id], receivedBy: 'u1' });
    expect(again[0].status).toBe('IN_STOCK');
    expect(db.state.movements).toHaveLength(2);
  });

  it('cancels only PENDING packages', async () => {
    const db = packageDb();
    const pending = await draftPackage(db);
    const active = await draftPackage(db, input({ packageCode: 'KIEN-ACTIVE' }));
    await activatePackages(db, { packageIds: [active.id], receivedBy: 'u1' });
    const result = await cancelPendingPackages(db, { packageIds: [pending.id, active.id], userId: 'u1', reason: 'Hủy phiếu nhập' });
    expect(result.find((pkg) => pkg.id === pending.id)!.status).toBe('CANCELLED');
    expect(result.find((pkg) => pkg.id === active.id)!.status).toBe('IN_STOCK');
    expect(db.state.activities.filter((log: any) => log.actionType === 'PACKAGE_CANCELLED')).toHaveLength(1);
    expect(db.state.activities.at(-1)).toMatchObject({ actionType: 'PACKAGE_CANCELLED', packageCode: pending.packageCode, metadata: { reason: 'Hủy phiếu nhập' } });
  });

  it('consumes partial then full, deriving status and writing signed movements', async () => {
    const db = packageDb();
    const draft = await draftPackage(db);
    const [stock] = await activatePackages(db, { packageIds: [draft.id], receivedBy: 'u1' });
    const lineId = stock.lines![0].id;

    const partial = await consumePackageLines(db, { entries: [{ packageLineId: lineId, quantity: 4, productId: 'p1', documentLineId: 'dl-1' }], userId: 'u1', documentId: 'doc-2' });
    expect(partial[0].status).toBe('PARTIAL_ISSUED');
    expect(Number(partial[0].lines![0].qtyRemaining)).toBe(6);
    expect(db.state.movements.filter((m: any) => m.moveType === 'ISSUE')).toHaveLength(1);
    expect(Number(db.state.movements.find((m: any) => m.moveType === 'ISSUE')!.quantity)).toBe(-4);
    expect(db.state.activities.at(-1)).toMatchObject({ actionType: 'PACKAGE_PARTIAL_ISSUED', packageCode: stock.packageCode, productId: 'p1', quantity: 4 });

    const rest = await consumePackageLines(db, { entries: [{ packageLineId: lineId, quantity: 6 }] });
    expect(rest[0].status).toBe('ISSUED');
    expect(db.state.activities.at(-1)!.actionType).toBe('PACKAGE_ISSUED');
    expect(Number(rest[0].totalQty)).toBe(0);
  });

  it('guards consumption: pending, held, issued, over-free and mismatched product', async () => {
    const db = packageDb();
    const pending = await draftPackage(db);
    const pendingError: any = await consumePackageLines(db, { entries: [{ packageLineId: pending.lines![0].id, quantity: 1 }] }).catch((err) => err);
    expect(pendingError.code).toBe('PACKAGE_PENDING');

    const stock = await activatePackages(db, { packageIds: [pending.id], receivedBy: 'u1' });
    const lineId = stock[0].lines![0].id;
    expect((await consumePackageLines(db, { entries: [{ packageLineId: lineId, quantity: 3 }] }))[0].status).toBe('PARTIAL_ISSUED');

    const exceeded: any = await consumePackageLines(db, { entries: [{ packageLineId: lineId, quantity: 8 }] }).catch((err) => err);
    expect(exceeded.code).toBe('PACKAGE_QTY_EXCEEDED');
    expect(exceeded.message).toContain('chỉ còn 7/10');

    const mismatch: any = await consumePackageLines(db, { entries: [{ packageLineId: lineId, quantity: 1, productId: 'p3' }] }).catch((err) => err);
    expect(mismatch.code).toBe('PACKAGE_PRODUCT_MISMATCH');

    const missing: any = await consumePackageLines(db, { entries: [{ packageLineId: 'nope', quantity: 1 }] }).catch((err) => err);
    expect(missing.code).toBe('PACKAGE_NOT_FOUND');

    const zero: any = await consumePackageLines(db, { entries: [{ packageLineId: lineId, quantity: 0 }] }).catch((err) => err);
    expect(zero.code).toBe('PACKAGE_INVALID');

    await holdPackages(db, { packageIds: [stock[0].id], userId: 'u1', reference: 'SO-2026-0042' });
    const held: any = await consumePackageLines(db, { entries: [{ packageLineId: lineId, quantity: 1 }] }).catch((err) => err);
    expect(held.code).toBe('PACKAGE_HELD');
    // Phiếu đang giữ kiện được phép xuất chính phần nó giữ.
    expect((await consumePackageLines(db, { entries: [{ packageLineId: lineId, quantity: 7 }], allowHeld: true }))[0].status).toBe('ISSUED');
    const issued: any = await consumePackageLines(db, { entries: [{ packageLineId: lineId, quantity: 1 }] }).catch((err) => err);
    expect(issued.code).toBe('PACKAGE_ISSUED');
  });

  it('locks package lines in a stable order before touching quantities (§3.4)', async () => {
    const db = packageDb();
    const draft = await draftPackage(db);
    const [stock] = await activatePackages(db, { packageIds: [draft.id], receivedBy: 'u1' });
    await consumePackageLines(db, { entries: [{ packageLineId: stock.lines![0].id, quantity: 1 }] });
    const lock = stateSql(db).find((sql) => sql.includes('FROM stock_package_lines WHERE id IN'));
    expect(lock).toContain('ORDER BY id FOR UPDATE');
    // §2.3: mọi UPDATE stock_package_lines phải đi kèm activity cùng packageId.
    expect(stateSql(db).some((sql) => sql.includes('UPDATE stock_package_lines'))).toBe(true);
    expect(db.state.activities.at(-1)!.packageId).toBe(stock.id);
  });

  it('holds and releases a whole package, restoring the prior status', async () => {
    const db = packageDb();
    const draft = await draftPackage(db, input({ lines: [{ productId: 'p1', quantity: 5 }, { productId: 'p3', quantity: 5, lotCode: 'L-1' }] }));
    const [stock] = await activatePackages(db, { packageIds: [draft.id], receivedBy: 'u1' });
    const [held] = await holdPackages(db, { packageIds: [stock.id], userId: 'u1', documentCode: 'SO-1' });
    expect(held.status).toBe('HELD');
    expect(held.lines!.every((line) => Number(line.qtyHeld) === Number(line.qtyRemaining))).toBe(true);
    expect(db.state.activities.at(-1)!.actionType).toBe('PACKAGE_HELD');

    const [released] = await releasePackages(db, { packageIds: [stock.id], userId: 'u1' });
    expect(released.status).toBe('IN_STOCK');
    expect(released.lines!.every((line) => Number(line.qtyHeld) === 0)).toBe(true);
    expect(db.state.activities.at(-1)!.actionType).toBe('PACKAGE_RELEASED');
    // Kiện chưa hold thì release là no-op, không log rác.
    const before = db.state.activities.length;
    await releasePackages(db, { packageIds: [stock.id], userId: 'u1' });
    expect(db.state.activities).toHaveLength(before);
  });

  it('restores returned goods into an ISSUED package', async () => {
    const db = packageDb();
    const draft = await draftPackage(db);
    const [stock] = await activatePackages(db, { packageIds: [draft.id], receivedBy: 'u1' });
    const lineId = stock.lines![0].id;
    await consumePackageLines(db, { entries: [{ packageLineId: lineId, quantity: 10 }] });
    const restored = await restorePackageLines(db, { entries: [{ packageLineId: lineId, quantity: 3 }], userId: 'u1', documentId: 'doc-3' });
    expect(restored[0].status).toBe('PARTIAL_ISSUED');
    expect(Number(restored[0].lines![0].qtyRemaining)).toBe(3);
    expect(db.state.movements.at(-1)!).toMatchObject({ moveType: 'RETURN', quantity: 3 });
    expect(db.state.activities.at(-1)!.actionType).toBe('PACKAGE_RETURNED');
  });

  it('reads a package back by code, including status fields', async () => {
    const db = packageDb();
    const draft = await draftPackage(db, input({ packageCode: 'KIEN-DOC-A' }));
    await activatePackages(db, { packageIds: [draft.id], receivedBy: 'u1' });
    const found = await findPackageByCode(db, 'kien-doc-a');
    expect(found).toMatchObject({ id: draft.id, packageCode: 'KIEN-DOC-A', status: 'IN_STOCK', warehouseId: WH, lineCount: 1 });
    expect(await findPackageByCode(db, 'KIEN-NOPE')).toBeNull();
    expect((await listPackagesByIds(db, []))).toEqual([]);
  });
});

function stateSql(db: any): string[] {
  return db.state.sql.map((sql: string) => sql.replace(/\s+/g, ' '));
}
