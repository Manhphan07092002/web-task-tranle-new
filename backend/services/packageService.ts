import { randomUUID } from 'node:crypto';
import { resolveTracking, type TrackingType } from '../utils/tracking.js';

/**
 * Nền tảng mô hình Kiện (§2 KE_HOACH_NHAP_XUAT_LO_KIEN).
 *
 * Kiện là phân hoạch của `onHand`, không phải nguồn tồn mới: không có dòng
 * `stock_balances` riêng cho kiện, và ledger (`stock_moves`) giữ nguyên SQL —
 * liên kết kiện được ghi ở `stock_package_movements`.
 *
 * Mọi hàm đổi `qtyRemaining`/`qtyHeld` đều phải chạy trong transaction đã khóa
 * kho (`beginStockTransaction`) và luôn ghi cả movement lẫn activity log, vì
 * §2.3 nghiêm cấm thay đổi số lượng kiện mà không có vết kiểm toán.
 */

export type PackageStatus = 'PENDING' | 'IN_STOCK' | 'HELD' | 'PARTIAL_ISSUED' | 'ISSUED' | 'IN_TRANSIT' | 'CANCELLED';

export type PackageMovementType =
  | 'RECEIPT' | 'ISSUE' | 'RETURN' | 'TRANSFER_OUT' | 'TRANSFER_IN'
  | 'SPLIT_OUT' | 'SPLIT_IN' | 'COUNT_ADJUST' | 'CANCEL';

export type PackageErrorCode =
  | 'PACKAGE_NOT_FOUND' | 'PACKAGE_WRONG_WAREHOUSE' | 'PACKAGE_HELD' | 'PACKAGE_ISSUED' | 'PACKAGE_PENDING'
  | 'PACKAGE_QTY_EXCEEDED' | 'PACKAGE_PRODUCT_MISMATCH' | 'PACKAGE_CODE_DUPLICATE'
  | 'PACKAGE_LINE_SERIAL_REQUIRED' | 'PACKAGE_LINE_LOT_REQUIRED' | 'PACKAGE_LINE_EXPIRY_REQUIRED'
  | 'PACKAGE_QTY_MISMATCH' | 'PACKAGE_INVALID';

export interface DbLike {
  all(sql: string, params?: any[]): Promise<any[]>;
  get(sql: string, params?: any[]): Promise<any>;
  run(sql: string, params?: any[]): Promise<any>;
}

export interface PackageLineInput {
  productId: string;
  quantity: number;
  serialNumber?: string | null;
  lotCode?: string | null;
  expiryDate?: string | null;
  unitCost?: number | null;
}

export interface PackageInput {
  packageCode?: string | null;
  packageTypeId?: string | null;
  locationId?: string | null;
  notes?: string | null;
  lines: PackageLineInput[];
}

export interface NormalizedPackageLine extends PackageLineInput {
  productName: string;
  tracking: Exclude<TrackingType, 'NONE'>;
  quantity: number;
  unitCost: number;
  lineKey: string;
}

export interface NormalizedPackage {
  packageCode: string | null;
  packageTypeId: string | null;
  locationId: string | null;
  notes: string | null;
  lines: NormalizedPackageLine[];
}

export interface StockPackageLine {
  id: string;
  packageId: string;
  productId: string;
  lineKey: string;
  qtyInitial: number;
  qtyRemaining: number;
  qtyHeld: number;
  serialId: string | null;
  lotId: string | null;
  expiryDate: string | null;
  unitCost: number;
}

export interface StockPackage {
  id: string;
  packageCode: string;
  packageTypeId: string | null;
  warehouseId: string;
  locationId: string | null;
  sourceReceiptId: string | null;
  sourcePackageId: string | null;
  parentPackageId: string | null;
  status: PackageStatus;
  notes: string | null;
  receivedAt: string | null;
  pickedAt: string | null;
  lineCount: number;
  totalQty: number;
  lines?: StockPackageLine[];
}

export interface PackageMovement {
  packageId: string;
  packageLineId: string | null;
  productId: string;
  warehouseId: string;
  quantity: number;
  moveType: PackageMovementType;
  referenceType?: string | null;
  referenceId?: string | null;
  documentLineId?: string | null;
  moveId?: string | null;
  userId?: string | null;
}

export interface PackageActivity {
  actionType: string;
  packageId: string;
  packageCode: string;
  warehouseId: string;
  productId?: string | null;
  quantity?: number | null;
  userId?: string | null;
  documentId?: string | null;
  documentCode?: string | null;
  metadata?: unknown;
}

export class PackageError extends Error {
  readonly status: number;
  readonly code: PackageErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: PackageErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PackageError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const QTY_EPSILON = 0.001;
const PACKAGE_CODE_PATTERN = /^[A-Z0-9._-]{3,50}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CODE_PREFIX = 'KIEN';

const PACKAGE_COLUMNS = 'id, packageCode, packageTypeId, warehouseId, locationId, sourceReceiptId, sourcePackageId, parentPackageId, status, notes, receivedAt, pickedAt';
const LINE_COLUMNS = 'id, packageId, productId, lineKey, qtyInitial, qtyRemaining, qtyHeld, serialId, lotId, expiryDate, unitCost';

const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ');
const nowIso = () => new Date().toISOString();
const asNumber = (value: unknown) => Number(value ?? 0) || 0;

export function normalizePackageCode(value: unknown): string | null {
  const code = String(value ?? '').trim().toUpperCase();
  if (!code) return null;
  if (!PACKAGE_CODE_PATTERN.test(code)) {
    throw new PackageError(400, 'PACKAGE_INVALID', `Mã kiện "${code}" không hợp lệ: 3–50 ký tự A-Z, 0-9, . _ -`);
  }
  return code;
}

/** `${productId}|S:${serial}` | `${productId}|L:${lot}` | `${productId}|Q` (§3.1). */
export function buildPackageLineKey(productId: string, line: Pick<PackageLineInput, 'serialNumber' | 'lotCode'>): string {
  const serial = String(line?.serialNumber ?? '').trim().toUpperCase();
  if (serial) return `${productId}|S:${serial}`;
  const lot = String(line?.lotCode ?? '').trim().toUpperCase();
  if (lot) return `${productId}|L:${lot}`;
  return `${productId}|Q`;
}

/** Suy ra trạng thái sau mỗi lần đổi số lượng kiện (§3.3). */
export function derivePackageStatus(pkg: { status: PackageStatus }, lines: Pick<StockPackageLine, 'qtyInitial' | 'qtyRemaining' | 'qtyHeld'>[]): PackageStatus {
  if (pkg.status === 'PENDING' || pkg.status === 'CANCELLED' || pkg.status === 'IN_TRANSIT') return pkg.status;
  const remaining = lines.reduce((sum, line) => sum + asNumber(line.qtyRemaining), 0);
  const held = lines.reduce((sum, line) => sum + asNumber(line.qtyHeld), 0);
  if (remaining <= 0) return 'ISSUED';
  if (held > 0 && held >= remaining) return 'HELD';
  if (lines.some((line) => asNumber(line.qtyRemaining) < asNumber(line.qtyInitial))) return 'PARTIAL_ISSUED';
  return 'IN_STOCK';
}

/** `KIEN-YY-NNNNNN`: MAX hiện có + 1, cùng kiểu sinh mã với `nextDocCode`. */
export async function nextPackageCode(db: DbLike): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(2);
  const numberStart = `${CODE_PREFIX}-${yy}-`.length + 1;
  const rows = await db.all(
    `SELECT packageCode AS code FROM stock_packages
      WHERE packageCode LIKE ? AND packageCode REGEXP ?
      ORDER BY CAST(SUBSTRING(packageCode, ${numberStart}) AS UNSIGNED) DESC
      LIMIT 1`,
    [`${CODE_PREFIX}-${yy}-%`, `^${CODE_PREFIX}-${yy}-[0-9]+$`]
  ).catch(() => [] as any[]);
  const pattern = new RegExp(`^${CODE_PREFIX}-${yy}-(\\d+)$`);
  let max = 0;
  for (const row of rows || []) {
    const match = String(row?.code || '').match(pattern);
    if (match) max = Math.max(max, parseInt(match[1], 10) || 0);
  }
  return `${CODE_PREFIX}-${yy}-${String(max + 1).padStart(6, '0')}`;
}

export async function listPackagesByIds(db: DbLike, ids: string[]): Promise<StockPackage[]> {
  if (ids.length === 0) return [];
  const rows = await db.all(
    `SELECT ${PACKAGE_COLUMNS} FROM stock_packages WHERE id IN (${placeholders(ids.length)}) ORDER BY id`,
    ids
  );
  return withLines(db, rows);
}

export async function findPackageByCode(db: DbLike, packageCode: string): Promise<StockPackage | null> {
  const code = normalizePackageCode(packageCode);
  if (!code) return null;
  const rows = await db.all(`SELECT ${PACKAGE_COLUMNS} FROM stock_packages WHERE packageCode = ?`, [code]);
  const packages = await withLines(db, rows);
  return packages[0] ?? null;
}

async function withLines(db: DbLike, rows: any[]): Promise<StockPackage[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const lines: StockPackageLine[] = await db.all(
    `SELECT ${LINE_COLUMNS} FROM stock_package_lines WHERE packageId IN (${placeholders(ids.length)}) ORDER BY packageId, createdAt, id`,
    ids
  );
  const byPackage = new Map<string, StockPackageLine[]>();
  for (const line of lines) {
    if (!byPackage.has(line.packageId)) byPackage.set(line.packageId, []);
    byPackage.get(line.packageId)!.push(line);
  }
  return rows.map((row) => {
    const packageLines = byPackage.get(row.id) ?? [];
    return {
      ...row,
      status: row.status as PackageStatus,
      lineCount: packageLines.length,
      totalQty: packageLines.reduce((sum, line) => sum + asNumber(line.qtyRemaining), 0),
      lines: packageLines,
    };
  });
}

export async function recordPackageActivities(db: DbLike, args: PackageActivity[]): Promise<void> {
  if (args.length === 0) return;
  const createdAt = nowIso();
  const params = args.flatMap((entry) => [
    randomUUID(), entry.actionType, 'PACKAGE', entry.packageId, entry.documentId ?? null,
    entry.documentCode ?? null, entry.productId ?? null, entry.warehouseId,
    entry.quantity ?? null, entry.userId ?? null, entry.packageId, entry.packageCode,
    entry.metadata === undefined ? null : JSON.stringify(entry.metadata), createdAt,
  ]);
  await db.run(
    `INSERT INTO warehouse_activity_logs
     (id, actionType, entityType, entityId, documentId, documentCode, productId, warehouseId,
      quantity, userId, packageId, packageCode, metadata, createdAt)
     VALUES ${args.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
    params
  );
}

async function recordPackageMovements(db: DbLike, args: PackageMovement[]): Promise<void> {
  if (args.length === 0) return;
  const createdAt = nowIso();
  const params = args.flatMap((entry) => [
    randomUUID(), entry.packageId, entry.packageLineId, entry.productId, entry.warehouseId,
    entry.quantity, entry.moveType, entry.referenceType ?? null, entry.referenceId ?? null,
    entry.documentLineId ?? null, entry.moveId ?? null, entry.userId ?? null, createdAt,
  ]);
  await db.run(
    `INSERT INTO stock_package_movements
     (id, packageId, packageLineId, productId, warehouseId, quantity, moveType, referenceType, referenceId, documentLineId, moveId, createdBy, createdAt)
     VALUES ${args.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
    params
  );
}

/**
 * Chuẩn hóa + kiểm tra đầu vào (§4.1 POST /receipts). Trả về danh kiện đã sạch
 * để `createPackages` ghi; không tự sinh mã và không ghi DB.
 *
 * `expectedQuantitiesByProduct` (tổng SL theo mã hàng của phiếu) được dùng để
 * bắt lệch: chênh > 0.001 là BLOCK theo §4.1.
 */
export async function validatePackages(
  db: DbLike,
  inputs: PackageInput[],
  context: { warehouseId: string; expectedQuantitiesByProduct?: Record<string, number> }
): Promise<NormalizedPackage[]> {
  if (inputs.length === 0) return [];

  const codes = inputs.map((pkg) => normalizePackageCode(pkg?.packageCode));
  const seenCodes = new Set<string>();
  for (const code of codes) {
    if (!code) continue;
    if (seenCodes.has(code)) throw new PackageError(400, 'PACKAGE_CODE_DUPLICATE', `Mã kiện ${code} xuất hiện hơn một lần trong yêu cầu`, { packageCode: code });
    seenCodes.add(code);
  }
  const uniqueCodes = [...seenCodes];
  if (uniqueCodes.length > 0) {
    const existing = await db.all(
      `SELECT packageCode FROM stock_packages WHERE packageCode IN (${placeholders(uniqueCodes.length)})`,
      uniqueCodes
    );
    if (existing.length > 0) {
      const code = String(existing[0].packageCode);
      throw new PackageError(409, 'PACKAGE_CODE_DUPLICATE', `Mã kiện ${code} đã tồn tại`, { packageCode: code });
    }
  }

  const productIds = [...new Set(inputs.flatMap((pkg) => (pkg?.lines ?? []).map((line) => String(line?.productId ?? ''))))]
    .filter(Boolean);
  if (productIds.length === 0) throw new PackageError(400, 'PACKAGE_INVALID', 'Kiện phải có ít nhất một dòng sản phẩm');
  const products: { id: string; name: string; tracking: string | null; expiryRequired: number | null }[] = await db.all(
    `SELECT id, name, tracking, expiryRequired FROM products WHERE id IN (${placeholders(productIds.length)})`,
    productIds
  );
  const productById = new Map(products.map((product) => [product.id, product]));

  const locationIds = [...new Set(inputs.map((pkg) => String(pkg?.locationId ?? '')).filter(Boolean))];
  const validLocations = new Map<string, string>();
  if (locationIds.length > 0) {
    const rows: { id: string; warehouseId: string }[] = await db.all(
      `SELECT id, warehouseId FROM stock_locations WHERE id IN (${placeholders(locationIds.length)}) AND isActive = 1`,
      locationIds
    );
    for (const row of rows) validLocations.set(row.id, row.warehouseId);
  }

  const normalized: NormalizedPackage[] = [];
  for (let index = 0; index < inputs.length; index++) {
    const pkg = inputs[index];
    const lines = pkg?.lines ?? [];
    if (lines.length === 0) throw new PackageError(400, 'PACKAGE_INVALID', 'Kiện phải có ít nhất một dòng sản phẩm', { packageCode: codes[index] ?? undefined });

    const locationId = String(pkg?.locationId ?? '').trim() || null;
    if (locationId && validLocations.get(locationId) !== context.warehouseId) {
      throw new PackageError(400, 'PACKAGE_INVALID', `Vị trí ${locationId} không thuộc kho đang chọn`, { locationId });
    }

    const normalizedLines: NormalizedPackageLine[] = [];
    const keysInPackage = new Set<string>();
    for (const line of lines) {
      const productId = String(line?.productId ?? '').trim();
      const product = productById.get(productId);
      if (!product) throw new PackageError(400, 'PACKAGE_INVALID', `Sản phẩm ${productId || '(trống)'} không tồn tại`, { productId });
      const quantity = Number(line?.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new PackageError(400, 'PACKAGE_INVALID', `Số lượng cho ${product.name} phải lớn hơn 0`, { productId });
      }
      const unitCost = Number(line?.unitCost ?? 0);
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        throw new PackageError(400, 'PACKAGE_INVALID', `Đơn giá cho ${product.name} không hợp lệ`, { productId });
      }
      const tracking = resolveTracking(product.tracking);
      const serialNumber = String(line?.serialNumber ?? '').trim() || null;
      const lotCode = String(line?.lotCode ?? '').trim() || null;
      const expiryDate = String(line?.expiryDate ?? '').trim() || null;
      if (tracking === 'SERIAL' && (serialNumber === null || quantity !== 1)) {
        throw new PackageError(400, 'PACKAGE_LINE_SERIAL_REQUIRED', `Sản phẩm ${product.name} quản lý theo Serial: mỗi dòng kiện phải là 1 serial`, { productId });
      }
      if (tracking === 'LOT' && lotCode === null) {
        throw new PackageError(400, 'PACKAGE_LINE_LOT_REQUIRED', `Sản phẩm ${product.name} quản lý theo lô: dòng kiện phải có mã lô`, { productId });
      }
      if (asNumber(product.expiryRequired) === 1 && expiryDate === null) {
        throw new PackageError(400, 'PACKAGE_LINE_EXPIRY_REQUIRED', `Sản phẩm ${product.name} bắt buộc hạn dùng`, { productId });
      }
      if (expiryDate !== null && !ISO_DATE_PATTERN.test(expiryDate)) {
        throw new PackageError(400, 'PACKAGE_LINE_EXPIRY_REQUIRED', `Hạn dùng cho ${product.name} phải theo định dạng yyyy-mm-dd`, { productId });
      }
      const lineKey = buildPackageLineKey(productId, { serialNumber, lotCode });
      if (keysInPackage.has(lineKey)) {
        throw new PackageError(400, 'PACKAGE_INVALID', `Dòng ${serialNumber || lotCode || product.name} bị trùng trong cùng một kiện`, { productId, lineKey });
      }
      keysInPackage.add(lineKey);
      normalizedLines.push({ productId, productName: product.name, tracking, quantity, unitCost, serialNumber, lotCode, expiryDate, lineKey });
    }

    normalized.push({
      packageCode: codes[index],
      packageTypeId: String(pkg?.packageTypeId ?? '').trim() || null,
      locationId,
      notes: String(pkg?.notes ?? '').trim() || null,
      lines: normalizedLines,
    });
  }

  const expected = context.expectedQuantitiesByProduct;
  if (expected) {
    const totals = new Map<string, number>();
    for (const pkg of normalized) {
      for (const line of pkg.lines) totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.quantity);
    }
    const mismatches = Object.entries(expected)
      .map(([productId, expectedQty]) => ({ productId, expectedQty, packagedQty: totals.get(productId) ?? 0 }))
      .filter((entry) => Math.abs(entry.expectedQty - entry.packagedQty) > QTY_EPSILON);
    const extraProductIds = [...totals.keys()].filter((productId) => !(productId in expected));
    if (mismatches.length > 0 || extraProductIds.length > 0) {
      throw new PackageError(400, 'PACKAGE_QTY_MISMATCH', 'Tổng số lượng theo kiện không khớp với số lượng trên phiếu', {
        mismatches,
        productsWithoutDocumentLine: extraProductIds,
      });
    }
  }

  return normalized;
}

/**
 * Ghi kiện ở trạng thái PENDING (bản nháp của phiếu nhập). `qtyRemaining =
 * qtyInitial` ngay từ đầu để đối chiếu, nhưng chưa phải tồn khả dụng vì kiện
 * chỉ sang IN_STOCK khi phiếu hoàn tất.
 */
export async function createPackages(db: DbLike, args: {
  warehouseId: string;
  createdBy?: string | null;
  sourceReceiptId?: string | null;
  packages: NormalizedPackage[];
}): Promise<StockPackage[]> {
  if (args.packages.length === 0) return [];
  const createdAt = nowIso();
  const createdIds: string[] = [];
  for (const pkg of args.packages) {
    const packageId = randomUUID();
    const packageCode = pkg.packageCode ?? await nextPackageCode(db);
    await db.run(
      `INSERT INTO stock_packages (id, packageCode, packageTypeId, warehouseId, locationId, sourceReceiptId, status, notes, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
      [packageId, packageCode, pkg.packageTypeId, args.warehouseId, pkg.locationId, args.sourceReceiptId ?? null, pkg.notes, args.createdBy ?? null, createdAt, createdAt]
    );
    if (pkg.lines.length > 0) {
      const params = pkg.lines.flatMap((line) => [
        randomUUID(), packageId, line.productId, line.lineKey, line.quantity, line.quantity,
        line.expiryDate, line.unitCost, args.sourceReceiptId ?? null, createdAt, createdAt,
      ]);
      await db.run(
        `INSERT INTO stock_package_lines (id, packageId, productId, lineKey, qtyInitial, qtyRemaining, serialId, lotId, expiryDate, unitCost, receiptDocumentId, createdAt, updatedAt)
         VALUES ${pkg.lines.map(() => '(?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)').join(', ')}`,
        params
      );
    }
    createdIds.push(packageId);
  }
  return listPackagesByIds(db, createdIds);
}

/**
 * Nhập hoàn tất: PENDING → IN_STOCK, gắn serialId/lotId do luồng phiếu vừa tạo
 * (§4.1 bắt buộc chạy trước `postDocumentMoves`). `bindings` do caller truyền vì
 * serial/lot chỉ tồn tại sau bước register trong cùng transaction.
 */
export async function activatePackages(db: DbLike, args: {
  packageIds: string[];
  receivedBy?: string | null;
  locationId?: string | null;
  documentId?: string | null;
  documentCode?: string | null;
  bindings?: { packageLineId: string; serialId?: string | null; lotId?: string | null }[];
}): Promise<StockPackage[]> {
  if (args.packageIds.length === 0) return [];
  const packages = await listPackagesByIds(db, args.packageIds);
  const pending = packages.filter((pkg) => pkg.status === 'PENDING');
  if (pending.length === 0) return packages;

  for (const binding of args.bindings ?? []) {
    await db.run(
      'UPDATE stock_package_lines SET serialId = ?, lotId = ?, updatedAt = ? WHERE id = ?',
      [binding.serialId ?? null, binding.lotId ?? null, nowIso(), binding.packageLineId]
    );
  }

  const refreshed = args.bindings?.length ? await listPackagesByIds(db, pending.map((pkg) => pkg.id)) : pending;
  const receivedAt = nowIso();
  const activity: PackageActivity[] = [];
  for (const pkg of refreshed) {
    const status = derivePackageStatus({ status: 'IN_STOCK' }, pkg.lines ?? []);
    await db.run(
      `UPDATE stock_packages SET status = ?, receivedAt = ?, receivedBy = ?, locationId = COALESCE(?, locationId), updatedAt = ?
       WHERE id = ? AND status = 'PENDING'`,
      [status, receivedAt, args.receivedBy ?? null, args.locationId ?? null, receivedAt, pkg.id]
    );
    await recordPackageMovements(db, (pkg.lines ?? []).filter((line) => asNumber(line.qtyRemaining) > 0).map((line) => ({
      packageId: pkg.id, packageLineId: line.id, productId: line.productId, warehouseId: pkg.warehouseId,
      quantity: asNumber(line.qtyRemaining), moveType: 'RECEIPT',
      referenceType: 'STOCK_DOCUMENT', referenceId: args.documentId ?? null, userId: args.receivedBy ?? null,
    })));
    activity.push({
      actionType: 'PACKAGE_RECEIVED', packageId: pkg.id, packageCode: pkg.packageCode,
      warehouseId: pkg.warehouseId, userId: args.receivedBy ?? null,
      documentId: args.documentId, documentCode: args.documentCode,
      quantity: pkg.totalQty, metadata: { lineCount: pkg.lineCount, status },
    });
  }
  await recordPackageActivities(db, activity);
  return listPackagesByIds(db, args.packageIds);
}

/** Hủy bản nháp phiếu nhập: chỉ kiện PENDING mới được CANCELLED (§4.1). */
export async function cancelPendingPackages(db: DbLike, args: {
  packageIds: string[];
  userId?: string | null;
  reason?: string | null;
  documentId?: string | null;
  documentCode?: string | null;
}): Promise<StockPackage[]> {
  if (args.packageIds.length === 0) return [];
  const packages = await listPackagesByIds(db, args.packageIds);
  const pending = packages.filter((pkg) => pkg.status === 'PENDING');
  const updatedAt = nowIso();
  for (const pkg of pending) {
    await db.run("UPDATE stock_packages SET status = 'CANCELLED', updatedAt = ? WHERE id = ? AND status = 'PENDING'", [updatedAt, pkg.id]);
  }
  await recordPackageActivities(db, pending.map((pkg) => ({
    actionType: 'PACKAGE_CANCELLED', packageId: pkg.id, packageCode: pkg.packageCode,
    warehouseId: pkg.warehouseId, userId: args.userId ?? null,
    documentId: args.documentId, documentCode: args.documentCode,
    quantity: pkg.totalQty, metadata: args.reason ? { reason: args.reason } : undefined,
  })));
  return packages.map((pkg) => (pkg.status === 'PENDING' ? { ...pkg, status: 'CANCELLED' as PackageStatus } : pkg));
}

/**
 * Phiếu nhập nháp sửa danh kiện: xóa hẳn bản PENDING để ghi lại theo danh sách
 * mới, vì mỗi lần lưu mà để lại một kiện CANCELLED thì history sẽ toàn rác.
 * Kiện đã có movement thì tuyệt đối không xóa (§2.3).
 */
export async function dropPendingPackages(db: DbLike, args: { sourceReceiptId: string }): Promise<number> {
  const rows = await db.all(
    `SELECT id, packageCode FROM stock_packages WHERE sourceReceiptId = ? AND status = 'PENDING'`,
    [args.sourceReceiptId]
  );
  if (rows.length === 0) return 0;
  const ids = rows.map((row: any) => String(row.id));
  const touched = await db.all(
    `SELECT packageId FROM stock_package_movements WHERE packageId IN (${placeholders(ids.length)}) GROUP BY packageId`,
    ids
  );
  if (touched.length > 0) {
    const packageId = String(touched[0].packageId);
    const packageCode = String(rows.find((row: any) => String(row.id) === packageId)?.packageCode ?? packageId);
    throw new PackageError(409, 'PACKAGE_INVALID', `Kiện ${packageCode} đã phát sinh movement, không thể xóa bản nháp`, { packageId, packageCode });
  }
  await db.run(`DELETE FROM stock_package_lines WHERE packageId IN (${placeholders(ids.length)})`, ids);
  await db.run(`DELETE FROM stock_packages WHERE id IN (${placeholders(ids.length)}) AND status = 'PENDING'`, ids);
  return ids.length;
}

/**
 * Chốt chặn cuối trước khi ghi sổ (§4.1 AC2): kiện là phân hoạch của tồn nên
 * tổng `qtyRemaining` của các kiện PENDING thuộc phiếu phải khớp từng mã hàng
 * với số lượng thực nhận. Kiểm tra lại ở đây vì dòng phiếu có thể đã bị sửa
 * hoặc xác nhận lệch sau khi tạo kiện.
 */
export async function assertPackagesMatchDocument(db: DbLike, args: {
  sourceReceiptId: string;
  expectedQuantitiesByProduct: Record<string, number>;
}): Promise<void> {
  const rows = await db.all(
    `SELECT pl.productId AS productId, SUM(pl.qtyRemaining) AS packagedQty
     FROM stock_package_lines pl
     JOIN stock_packages p ON p.id = pl.packageId
     WHERE p.sourceReceiptId = ? AND p.status = 'PENDING'
     GROUP BY pl.productId`,
    [args.sourceReceiptId]
  );
  const packaged = new Map((rows || []).map((row: any) => [String(row.productId), asNumber(row.packagedQty)]));
  const productIds = [...new Set([...Object.keys(args.expectedQuantitiesByProduct), ...packaged.keys()])];
  const mismatches = productIds
    .map((productId) => ({
      productId,
      expectedQty: Number(args.expectedQuantitiesByProduct[productId] ?? 0),
      packagedQty: packaged.get(productId) ?? 0,
    }))
    .filter((entry) => Math.abs(entry.expectedQty - entry.packagedQty) > QTY_EPSILON);
  if (mismatches.length > 0) {
    throw new PackageError(400, 'PACKAGE_QTY_MISMATCH', 'Tổng số lượng theo kiện không khớp với số lượng của phiếu. Vui lòng chỉnh lại kiện trước khi hoàn tất.', { mismatches });
  }
}

/**
 * §4.2 POST /issues: dòng phiếu xuất trỏ thẳng vào dòng kiện. Kiểm tra kho,
 * trạng thái, sản phẩm và lượng khả dụng *trước khi ghi dòng*; chưa khóa và chưa
 * đổi số lượng (cửa authoritative là `consumePackageLines` trong transaction ghi
 * sổ). Trả về `packageLineId -> packageId` lấy từ DB để caller ghi cột `packageId`
 * theo nguồn thật, không tin giá trị client gửi lên.
 */
export async function assertLinesFitPackages(db: DbLike, args: {
  warehouseId: string;
  lines: { productId?: string | null; quantity?: number | null; packageId?: string | null; packageLineId?: string | null }[];
}): Promise<Map<string, string>> {
  const refs = (args.lines || []).filter((line) => String(line?.packageLineId ?? '').trim());
  if (refs.length === 0) return new Map();

  const lineIds = [...new Set(refs.map((line) => String(line!.packageLineId).trim()))];
  const rows: any[] = await db.all(
    `SELECT pl.id AS packageLineId, pl.packageId AS packageId, pl.productId AS productId,
            pl.qtyRemaining AS qtyRemaining, pl.qtyHeld AS qtyHeld,
            p.packageCode AS packageCode, p.warehouseId AS warehouseId, p.status AS status
     FROM stock_package_lines pl
     JOIN stock_packages p ON p.id = pl.packageId
     WHERE pl.id IN (${placeholders(lineIds.length)})`,
    lineIds
  );
  const byId = new Map((rows || []).map((row) => [String(row.packageLineId), row]));

  const requestedByLine = new Map<string, number>();
  const packageIdByLine = new Map<string, string>();
  for (const line of refs) {
    const lineId = String(line!.packageLineId).trim();
    const row = byId.get(lineId);
    if (!row) throw new PackageError(404, 'PACKAGE_NOT_FOUND', `Không tìm thấy dòng kiện ${lineId}`, { packageLineId: lineId });
    const packageCode = String(row.packageCode);
    if (String(row.warehouseId) !== args.warehouseId) {
      throw new PackageError(409, 'PACKAGE_WRONG_WAREHOUSE', `Kiện ${packageCode} không thuộc kho đang chọn`, { packageCode, packageLineId: lineId });
    }
    const productId = String(line?.productId ?? '').trim();
    if (productId && String(row.productId) !== productId) {
      throw new PackageError(400, 'PACKAGE_PRODUCT_MISMATCH', `Sản phẩm ${productId} không có trong kiện ${packageCode}`, { packageCode, productId, packageLineId: lineId });
    }
    const claimedPackageId = String(line?.packageId ?? '').trim();
    if (claimedPackageId && claimedPackageId !== String(row.packageId)) {
      throw new PackageError(400, 'PACKAGE_INVALID', `Dòng kiện ${lineId} không thuộc kiện ${claimedPackageId}`, { packageLineId: lineId, packageCode });
    }
    const status = String(row.status) as PackageStatus;
    if (status === 'PENDING') throw new PackageError(409, 'PACKAGE_PENDING', `Kiện ${packageCode} chưa hoàn tất nhập kho`, { packageCode });
    if (status === 'ISSUED') throw new PackageError(409, 'PACKAGE_ISSUED', `Kiện ${packageCode} đã xuất hết`, { packageCode });
    if (status === 'HELD') throw new PackageError(409, 'PACKAGE_HELD', `Kiện ${packageCode} đang bị giữ`, { packageCode });
    if (status !== 'IN_STOCK' && status !== 'PARTIAL_ISSUED') {
      throw new PackageError(409, 'PACKAGE_INVALID', `Kiện ${packageCode} ở trạng thái ${status}, không xuất được`, { packageCode, status });
    }

    const quantity = Number(line?.quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new PackageError(400, 'PACKAGE_INVALID', `Số lượng cho kiện ${packageCode} phải lớn hơn 0`, { packageCode, packageLineId: lineId });
    }
    requestedByLine.set(lineId, (requestedByLine.get(lineId) ?? 0) + quantity);
    packageIdByLine.set(lineId, String(row.packageId));
  }

  for (const [lineId, requested] of requestedByLine) {
    const row = byId.get(lineId)!;
    const free = asNumber(row.qtyRemaining) - asNumber(row.qtyHeld);
    if (free + QTY_EPSILON < requested) {
      throw new PackageError(400, 'PACKAGE_QTY_EXCEEDED', `Kiện ${row.packageCode} chỉ còn ${free}/${asNumber(row.qtyRemaining)} cho sản phẩm ${row.productId}`, {
        packageCode: String(row.packageCode), packageLineId: lineId, available: free, requested,
      });
    }
  }
  return packageIdByLine;
}

/** Khóa dòng kiện theo thứ tự id cố định để tránh deadlock (§3.4). */
export async function lockPackageLinesForUpdate(db: DbLike, lineIds: string[]): Promise<StockPackageLine[]> {
  if (lineIds.length === 0) return [];
  return db.all(
    `SELECT ${LINE_COLUMNS} FROM stock_package_lines WHERE id IN (${placeholders(lineIds.length)}) ORDER BY id FOR UPDATE`,
    lineIds
  );
}

interface QtyEntry {
  packageLineId: string;
  quantity: number;
  productId?: string | null;
  documentLineId?: string | null;
  moveId?: string | null;
}

/**
 * Khóa dòng kiện rồi kiểm tra trạng thái/số lượng trước khi đổi (§3.4: không tin
 * số liệu client). RESTORE bỏ qua cửa ISSUED vì trả hàng phải mở lại kiện đã xuất.
 */
async function lockQuantifiedEntries(db: DbLike, entries: QtyEntry[], options: {
  mode: 'CONSUME' | 'RESTORE';
  allowHeld?: boolean;
}): Promise<{ lineById: Map<string, StockPackageLine>; packageById: Map<string, StockPackage> }> {
  const lines = await lockPackageLinesForUpdate(db, entries.map((entry) => entry.packageLineId));
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const packages = await listPackagesByIds(db, [...new Set(lines.map((line) => line.packageId))]);
  const packageById = new Map(packages.map((pkg) => [pkg.id, pkg]));
  for (const entry of entries) {
    const line = lineById.get(entry.packageLineId);
    if (!line) throw new PackageError(404, 'PACKAGE_NOT_FOUND', `Không tìm thấy dòng kiện ${entry.packageLineId}`, { packageLineId: entry.packageLineId });
    const pkg = packageById.get(line.packageId)!;
    const quantity = Number(entry.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new PackageError(400, 'PACKAGE_INVALID', `Số lượng cho kiện ${pkg.packageCode} phải lớn hơn 0`, { packageCode: pkg.packageCode });
    }
    if (entry.productId && entry.productId !== line.productId) {
      throw new PackageError(400, 'PACKAGE_PRODUCT_MISMATCH', `Sản phẩm ${entry.productId} không có trong kiện ${pkg.packageCode}`, { packageCode: pkg.packageCode, productId: entry.productId });
    }
    if (pkg.status === 'PENDING') throw new PackageError(409, 'PACKAGE_PENDING', `Kiện ${pkg.packageCode} chưa hoàn tất nhập kho`, { packageCode: pkg.packageCode });
    if (pkg.status === 'CANCELLED') throw new PackageError(409, 'PACKAGE_INVALID', `Kiện ${pkg.packageCode} đã hủy`, { packageCode: pkg.packageCode });
    if (options.mode === 'CONSUME') {
      if (pkg.status === 'ISSUED') throw new PackageError(409, 'PACKAGE_ISSUED', `Kiện ${pkg.packageCode} đã xuất hết`, { packageCode: pkg.packageCode });
      if (pkg.status === 'HELD' && !options.allowHeld) throw new PackageError(409, 'PACKAGE_HELD', `Kiện ${pkg.packageCode} đang bị giữ`, { packageCode: pkg.packageCode });
      // allowHeld = phiếu đang giữ kiện được xuất chính phần nó giữ, nên phần
      // held không bị trừ khỏi lượng khả dụng.
      const free = options.allowHeld ? asNumber(line.qtyRemaining) : asNumber(line.qtyRemaining) - asNumber(line.qtyHeld);
      if (free + QTY_EPSILON < quantity) {
        throw new PackageError(400, 'PACKAGE_QTY_EXCEEDED', `Kiện ${pkg.packageCode} chỉ còn ${free}/${asNumber(line.qtyInitial)} cho sản phẩm ${line.productId}`, {
          packageCode: pkg.packageCode, available: free, quantity,
        });
      }
    }
  }
  return { lineById, packageById };
}

/**
 * Xuất theo kiện: giảm `qtyRemaining`, giải phóng phần `qtyHeld` của chính phiếu
 * đang giữ, ghi movement (lượng âm) + activity rồi suy lại trạng thái.
 * `stock_moves` vẫn do luồng chứng từ ghi — bất biến ledger không đổi (§2.2).
 */
export async function consumePackageLines(db: DbLike, args: {
  entries: QtyEntry[];
  userId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  documentId?: string | null;
  documentCode?: string | null;
  allowHeld?: boolean;
}): Promise<StockPackage[]> {
  if (args.entries.length === 0) return [];
  const { lineById, packageById } = await lockQuantifiedEntries(db, args.entries, { mode: 'CONSUME', allowHeld: args.allowHeld });
  const updatedAt = nowIso();
  const movements: PackageMovement[] = [];
  for (const entry of args.entries) {
    const line = lineById.get(entry.packageLineId)!;
    const pkg = packageById.get(line.packageId)!;
    const quantity = Number(entry.quantity);
    await db.run(
      'UPDATE stock_package_lines SET qtyRemaining = qtyRemaining - ?, qtyHeld = GREATEST(0, qtyHeld - ?), updatedAt = ? WHERE id = ?',
      [quantity, quantity, updatedAt, line.id]
    );
    movements.push({
      packageId: pkg.id, packageLineId: line.id, productId: line.productId, warehouseId: pkg.warehouseId,
      quantity: -quantity, moveType: 'ISSUE',
      referenceType: args.referenceType ?? 'STOCK_DOCUMENT', referenceId: args.referenceId ?? args.documentId ?? null,
      documentLineId: entry.documentLineId ?? null, moveId: entry.moveId ?? null, userId: args.userId ?? null,
    });
  }
  return finalizePackageChanges(db, movements, {
    actionType: 'PACKAGE_ISSUED', partialActionType: 'PACKAGE_PARTIAL_ISSUED',
    updatedAt, userId: args.userId, documentId: args.documentId, documentCode: args.documentCode,
  });
}

/** Trả hàng về kiện cũ (§4.1 returns): tăng `qtyRemaining`, movement dương. */
export async function restorePackageLines(db: DbLike, args: {
  entries: QtyEntry[];
  userId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  documentId?: string | null;
  documentCode?: string | null;
}): Promise<StockPackage[]> {
  if (args.entries.length === 0) return [];
  const { lineById, packageById } = await lockQuantifiedEntries(db, args.entries, { mode: 'RESTORE' });
  const updatedAt = nowIso();
  const movements: PackageMovement[] = [];
  for (const entry of args.entries) {
    const line = lineById.get(entry.packageLineId)!;
    const pkg = packageById.get(line.packageId)!;
    const quantity = Number(entry.quantity);
    await db.run('UPDATE stock_package_lines SET qtyRemaining = qtyRemaining + ?, updatedAt = ? WHERE id = ?', [quantity, updatedAt, line.id]);
    movements.push({
      packageId: pkg.id, packageLineId: line.id, productId: line.productId, warehouseId: pkg.warehouseId,
      quantity, moveType: 'RETURN',
      referenceType: args.referenceType ?? 'STOCK_DOCUMENT', referenceId: args.referenceId ?? args.documentId ?? null,
      documentLineId: entry.documentLineId ?? null, moveId: entry.moveId ?? null, userId: args.userId ?? null,
    });
  }
  return finalizePackageChanges(db, movements, {
    actionType: 'PACKAGE_RETURNED', partialActionType: 'PACKAGE_RETURNED',
    updatedAt, userId: args.userId, documentId: args.documentId, documentCode: args.documentCode,
  });
}

/** Giữ nguyên kiện cho một đơn: toàn bộ dòng trong kiện được hold (§3.3). */
export async function holdPackages(db: DbLike, args: {
  packageIds: string[];
  userId?: string | null;
  documentId?: string | null;
  documentCode?: string | null;
  reference?: string | null;
}): Promise<StockPackage[]> {
  if (args.packageIds.length === 0) return [];
  const packages = await listPackagesByIds(db, args.packageIds);
  const updatedAt = nowIso();
  const held: StockPackage[] = [];
  for (const pkg of packages) {
    if (pkg.status === 'HELD') continue;
    if (pkg.status === 'PENDING') throw new PackageError(409, 'PACKAGE_PENDING', `Kiện ${pkg.packageCode} chưa hoàn tất nhập kho`, { packageCode: pkg.packageCode });
    if (pkg.status === 'ISSUED' || pkg.status === 'CANCELLED') throw new PackageError(409, 'PACKAGE_ISSUED', `Kiện ${pkg.packageCode} đã xuất hết`, { packageCode: pkg.packageCode });
    await db.run('UPDATE stock_package_lines SET qtyHeld = qtyRemaining, updatedAt = ? WHERE packageId = ?', [updatedAt, pkg.id]);
    await db.run("UPDATE stock_packages SET status = 'HELD', pickedAt = ?, pickedBy = ?, updatedAt = ? WHERE id = ?", [updatedAt, args.userId ?? null, updatedAt, pkg.id]);
    held.push(pkg);
  }
  await recordPackageActivities(db, held.map((pkg) => ({
    actionType: 'PACKAGE_HELD', packageId: pkg.id, packageCode: pkg.packageCode, warehouseId: pkg.warehouseId,
    userId: args.userId ?? null, documentId: args.documentId, documentCode: args.documentCode,
    quantity: pkg.totalQty, metadata: args.reference ? { reference: args.reference } : undefined,
  })));
  return listPackagesByIds(db, args.packageIds);
}

/** Bỏ giữ toàn kiện: `qtyHeld = 0` rồi suy lại trạng thái. */
export async function releasePackages(db: DbLike, args: {
  packageIds: string[];
  userId?: string | null;
  documentId?: string | null;
  documentCode?: string | null;
}): Promise<StockPackage[]> {
  if (args.packageIds.length === 0) return [];
  const packages = await listPackagesByIds(db, args.packageIds);
  const held = packages.filter((pkg) => pkg.status === 'HELD');
  if (held.length === 0) return packages;
  const updatedAt = nowIso();
  for (const pkg of held) {
    await db.run('UPDATE stock_package_lines SET qtyHeld = 0, updatedAt = ? WHERE packageId = ?', [updatedAt, pkg.id]);
    const status = derivePackageStatus(pkg, pkg.lines ?? []);
    await db.run('UPDATE stock_packages SET status = ?, updatedAt = ? WHERE id = ?', [status, updatedAt, pkg.id]);
  }
  await recordPackageActivities(db, held.map((pkg) => ({
    actionType: 'PACKAGE_RELEASED', packageId: pkg.id, packageCode: pkg.packageCode, warehouseId: pkg.warehouseId,
    userId: args.userId ?? null, documentId: args.documentId, documentCode: args.documentCode,
    quantity: pkg.totalQty,
  })));
  return listPackagesByIds(db, args.packageIds);
}

/**
 * Ghi movement + activity cho các kiện vừa đổi số lượng, rồi suy lại trạng thái
 * (§3.3). Trả về đúng trạng thái đã ghi để caller không phải đọc lại DB.
 */
async function finalizePackageChanges(db: DbLike, movements: PackageMovement[], args: {
  actionType: string;
  partialActionType: string;
  updatedAt: string;
  userId?: string | null;
  documentId?: string | null;
  documentCode?: string | null;
}): Promise<StockPackage[]> {
  if (movements.length === 0) return [];
  await recordPackageMovements(db, movements);
  const refreshed = await listPackagesByIds(db, [...new Set(movements.map((movement) => movement.packageId))]);
  const statuses = new Map<string, PackageStatus>();
  for (const pkg of refreshed) {
    const status = derivePackageStatus(pkg, pkg.lines ?? []);
    statuses.set(pkg.id, status);
    if (status !== pkg.status) {
      await db.run(
        'UPDATE stock_packages SET status = ?, pickedAt = COALESCE(pickedAt, ?), pickedBy = COALESCE(pickedBy, ?), updatedAt = ? WHERE id = ?',
        [status, args.updatedAt, args.userId ?? null, args.updatedAt, pkg.id]
      );
    }
  }
  await recordPackageActivities(db, movements.map((movement) => {
    const pkg = refreshed.find((candidate) => candidate.id === movement.packageId)!;
    const status = statuses.get(movement.packageId)!;
    return {
      actionType: status === 'PARTIAL_ISSUED' ? args.partialActionType : args.actionType,
      packageId: movement.packageId, packageCode: pkg.packageCode, warehouseId: movement.warehouseId,
      productId: movement.productId, quantity: Math.abs(movement.quantity),
      userId: args.userId ?? null, documentId: args.documentId ?? null, documentCode: args.documentCode ?? null,
      metadata: { status, moveType: movement.moveType, packageLineId: movement.packageLineId },
    };
  }));
  return refreshed.map((pkg) => ({ ...pkg, status: statuses.get(pkg.id) ?? pkg.status }));
}

// ── Đọc: tồn trong kiện + đối soát (AC9) ────────────────────────────────────

/**
 * Kiện còn hàng thực trong kho. HELD vẫn tính vì hàng chưa rời kho; PENDING
 * (mới khai trên nháp nhập, chưa ghi sổ), ISSUED/IN_TRANSIT/CANCELLED thì không.
 */
export const ON_HAND_PACKAGE_STATUSES: PackageStatus[] = ['IN_STOCK', 'HELD', 'PARTIAL_ISSUED'];
const ON_HAND_STATUS_LIST = ON_HAND_PACKAGE_STATUSES.map((status) => `'${status}'`).join(', ');

/** (sản phẩm, kho, vị trí) → `packagedQty`; JOIN 1:1 với một dòng stock_balances. */
export const PACKAGED_QTY_BY_LOCATION =
  `SELECT pl.productId, p.warehouseId, COALESCE(p.locationId, '') AS locationId, SUM(pl.qtyRemaining) AS packagedQty
   FROM stock_package_lines pl
   JOIN stock_packages p ON p.id = pl.packageId
   WHERE p.status IN (${ON_HAND_STATUS_LIST})
   GROUP BY pl.productId, p.warehouseId, COALESCE(p.locationId, '')`;

/** Bản gộp mọi vị trí trong kho — cho /available-inventory (đã GROUP BY sản phẩm + kho). */
export const PACKAGED_QTY_BY_WAREHOUSE =
  `SELECT pl.productId, p.warehouseId, SUM(pl.qtyRemaining) AS packagedQty
   FROM stock_package_lines pl
   JOIN stock_packages p ON p.id = pl.packageId
   WHERE p.status IN (${ON_HAND_STATUS_LIST})
   GROUP BY pl.productId, p.warehouseId`;

export interface PackageDriftRow {
  productId: string;
  warehouseId: string;
  productName: string | null;
  unit: string | null;
  warehouseName: string | null;
  packagedQty: number;
  onHand: number;
  excessQty: number;
  overInitialLines: number;
  heldOverQty: number;
}

/**
 * AC9: Kiện là tập con của onHand, nên tổng hàng trong kiện không được vượt tồn
 * ghi sổ của cùng mã hàng/kho; dòng kiện cũng không được vượt lượng ban đầu hoặc
 * giữ (HELD) quá lượng còn. Trả `[]` khi mọi bất biến đều đúng.
 */
export async function fetchPackageDrift(db: DbLike, filters: {
  warehouseId?: string | null;
  warehouseIds?: string[] | null;
  productId?: string | null;
} = {}): Promise<PackageDriftRow[]> {
  const warehouseId = String(filters.warehouseId ?? '').trim();
  const warehouseIds = (filters.warehouseIds ?? []).map((id) => String(id).trim()).filter(Boolean);
  const productId = String(filters.productId ?? '').trim();

  // Bộ lọc scope đẩy xuống cả hai subquery để không SUM toàn bảng (như /reconciliation).
  const pkgWhere: string[] = [`p.status IN (${ON_HAND_STATUS_LIST})`];
  const pkgParams: string[] = [];
  if (warehouseId) { pkgWhere.push('p.warehouseId = ?'); pkgParams.push(warehouseId); }
  else if (warehouseIds.length > 0) {
    pkgWhere.push(`p.warehouseId IN (${placeholders(warehouseIds.length)})`);
    pkgParams.push(...warehouseIds);
  }
  if (productId) { pkgWhere.push('pl.productId = ?'); pkgParams.push(productId); }

  const balWhere: string[] = [];
  const balParams: string[] = [];
  if (warehouseId) { balWhere.push('warehouseId = ?'); balParams.push(warehouseId); }
  else if (warehouseIds.length > 0) {
    balWhere.push(`warehouseId IN (${placeholders(warehouseIds.length)})`);
    balParams.push(...warehouseIds);
  }
  if (productId) { balWhere.push('productId = ?'); balParams.push(productId); }

  return db.all(
    `SELECT pkg.productId, pkg.warehouseId, pkg.packagedQty, COALESCE(bal.onHand, 0) AS onHand,
            pkg.packagedQty - COALESCE(bal.onHand, 0) AS excessQty,
            pkg.overInitialLines, pkg.heldOverQty,
            p.name AS productName, p.unit, w.name AS warehouseName
     FROM (
       SELECT pl.productId, p.warehouseId, SUM(pl.qtyRemaining) AS packagedQty,
              SUM(CASE WHEN pl.qtyRemaining > pl.qtyInitial THEN 1 ELSE 0 END) AS overInitialLines,
              SUM(CASE WHEN pl.qtyHeld > pl.qtyRemaining THEN pl.qtyHeld - pl.qtyRemaining ELSE 0 END) AS heldOverQty
       FROM stock_package_lines pl
       JOIN stock_packages p ON p.id = pl.packageId
       WHERE ${pkgWhere.join(' AND ')}
       GROUP BY pl.productId, p.warehouseId
     ) pkg
     LEFT JOIN (
       SELECT productId, warehouseId, SUM(onHand) AS onHand
       FROM stock_balances ${balWhere.length ? `WHERE ${balWhere.join(' AND ')}` : ''}
       GROUP BY productId, warehouseId
     ) bal ON bal.productId = pkg.productId AND bal.warehouseId = pkg.warehouseId
     LEFT JOIN products p ON p.id = pkg.productId
     LEFT JOIN warehouses w ON w.id = pkg.warehouseId
     WHERE pkg.packagedQty - COALESCE(bal.onHand, 0) > 0.000001
        OR pkg.overInitialLines > 0 OR pkg.heldOverQty > 0.000001
     ORDER BY pkg.packagedQty - COALESCE(bal.onHand, 0) DESC`,
    [...pkgParams, ...balParams]
  );
}

// ── Gợi ý kiện khi lập phiếu xuất ───────────────────────────────────────────

export type PackageSuggestionRule = 'FIFO' | 'FEFO';

export interface PackageSuggestion {
  packageId: string;
  packageCode: string;
  packageLineId: string;
  productId: string;
  warehouseId: string;
  locationId: string | null;
  status: PackageStatus;
  qtyAvailable: number;
  suggestedQty: number;
  receivedAt: string | null;
  expiryDate: string | null;
}

const round3 = (value: unknown) => Math.round((Number(value) || 0) * 1000) / 1000;

/**
 * Kiện đã mở (PARTIAL_ISSUED) dọn trước để giảm kiện treo; NULL mốc xuống cuối
 * vì kiện không có receivedAt/expiryDate không đủ điều kiện làm chuẩn FIFO/FEFO.
 */
const SUGGEST_ORDER: Record<PackageSuggestionRule, string> = {
  FIFO: `CASE WHEN p.status = 'PARTIAL_ISSUED' THEN 0 ELSE 1 END,
    CASE WHEN p.receivedAt IS NULL THEN 1 ELSE 0 END, p.receivedAt,
    CASE WHEN p.createdAt IS NULL THEN 1 ELSE 0 END, p.createdAt, p.id, pl.id`,
  FEFO: `CASE WHEN p.status = 'PARTIAL_ISSUED' THEN 0 ELSE 1 END,
    CASE WHEN pl.expiryDate IS NULL THEN 1 ELSE 0 END, pl.expiryDate,
    CASE WHEN p.receivedAt IS NULL THEN 1 ELSE 0 END, p.receivedAt, p.id, pl.id`,
};

/**
 * Đề xuất dòng kiện cho một lượng xuất (chỉ đọc, không khóa hàng). HELD và các
 * kiện chưa mở/nghĩa vụ khác không phải candidate (§3.3); phần khả dụng tính là
 * qtyRemaining - qtyHeld. Kết quả chỉ là gợi ý — bước ghi sổ vẫn phải qua
 * assertLinesFitPackages rồi consumePackageLines để tái kiểm tra khi khóa dòng.
 */
export async function suggestPackages(db: DbLike, args: {
  productId: string;
  warehouseId: string;
  quantity: number;
  rule?: PackageSuggestionRule | null;
}): Promise<{
  rule: PackageSuggestionRule;
  lines: PackageSuggestion[];
  requestedQty: number;
  suggestedQty: number;
  missingQty: number;
  sufficient: boolean;
}> {
  const rule: PackageSuggestionRule = args.rule === 'FEFO' ? 'FEFO' : 'FIFO';
  const requestedQty = round3(args.quantity);
  const rows: any[] = await db.all(
    `SELECT p.id AS packageId, p.packageCode, p.status, p.warehouseId, p.locationId,
            p.receivedAt, p.createdAt, pl.id AS packageLineId, pl.productId,
            pl.qtyRemaining, pl.qtyHeld, pl.expiryDate
     FROM stock_package_lines pl
     JOIN stock_packages p ON p.id = pl.packageId
     WHERE pl.productId = ? AND p.warehouseId = ? AND p.status IN ('IN_STOCK', 'PARTIAL_ISSUED')
     ORDER BY ${SUGGEST_ORDER[rule]}`,
    [args.productId, args.warehouseId]
  );

  let need = requestedQty;
  const lines: PackageSuggestion[] = [];
  for (const row of rows || []) {
    const available = round3(Number(row.qtyRemaining) - Number(row.qtyHeld));
    if (available <= 0) continue;
    const take = round3(Math.min(available, need));
    if (take <= 0) break;
    lines.push({
      packageId: String(row.packageId),
      packageCode: String(row.packageCode),
      packageLineId: String(row.packageLineId),
      productId: String(row.productId),
      warehouseId: String(row.warehouseId),
      locationId: row.locationId ?? null,
      status: row.status as PackageStatus,
      qtyAvailable: available,
      suggestedQty: take,
      receivedAt: row.receivedAt ?? null,
      expiryDate: row.expiryDate ?? null,
    });
    need = round3(need - take);
    if (need <= QTY_EPSILON) break;
  }
  const suggestedQty = round3(requestedQty - Math.max(0, need));
  return {
    rule,
    lines,
    requestedQty,
    suggestedQty,
    missingQty: round3(requestedQty - suggestedQty),
    sufficient: need <= QTY_EPSILON,
  };
}
