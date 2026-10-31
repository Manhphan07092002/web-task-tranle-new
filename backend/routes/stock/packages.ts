import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import {
  normalizePackageCode, recordPackageActivities, suggestPackages,
  type PackageStatus, type PackageSuggestionRule,
} from '../../services/packageService.js';
import type { StockContext } from './context.js';

/**
 * Đọc liệu mô hình Kiện (§4 KE_HOACH_NHAP_XUAT_LO_KIEN) + danh mục loại kiện.
 *
 * Router này không đổi số lượng kiện: tạo/nhập/xuất kiện thuộc luồng chứng từ
 * (R2) và đi qua `packageService`. Ở đây chỉ có list/lookup/detail/trace,
 * PATCH vị trí–ghi chú (Manager) và CRUD loại kiện (Manager).
 */

const PACKAGE_STATUSES: PackageStatus[] = ['PENDING', 'IN_STOCK', 'HELD', 'PARTIAL_ISSUED', 'ISSUED', 'IN_TRANSIT', 'CANCELLED'];
/** Kiện chỉ tính vào "tồn theo kiện" khi hàng đã về kho và chưa xuất hết (§3.3). */
const ON_HAND_STATUSES: PackageStatus[] = ['IN_STOCK', 'HELD', 'PARTIAL_ISSUED'];

const PACKAGE_FIELDS = `p.id, p.packageCode, p.packageTypeId, p.warehouseId, p.locationId,
  p.sourceReceiptId, p.sourcePackageId, p.parentPackageId, p.status, p.notes,
  p.receivedAt, p.receivedBy, p.pickedAt, p.pickedBy, p.createdAt, p.updatedAt,
  pt.code AS packageTypeCode, pt.name AS packageTypeName,
  w.code AS warehouseCode, w.name AS warehouseName,
  l.code AS locationCode, l.name AS locationName, l.purpose AS locationPurpose`;
const PACKAGE_SOURCE = `FROM stock_packages p
  LEFT JOIN stock_package_types pt ON pt.id = p.packageTypeId
  LEFT JOIN warehouses w ON w.id = p.warehouseId
  LEFT JOIN stock_locations l ON l.id = p.locationId AND l.warehouseId = p.warehouseId`;
const LINE_FIELDS = `pl.id AS packageLineId, pl.packageId, pl.productId, pl.lineKey, pl.qtyInitial, pl.qtyRemaining,
  pl.qtyHeld, pl.serialId, pl.lotId, pl.expiryDate, pl.unitCost,
  pl.receiptDocumentId, pl.receiptLineId,
  pr.name AS productName, pr.importCode AS productCode, pr.unit, pr.tracking,
  s.serialNumber, lt.lotCode, lt.coilCode`;

const marks = (count: number) => Array.from({ length: count }, () => '?').join(', ');
const round3 = (value: unknown) => Math.round((Number(value) || 0) * 1000) / 1000;
const parseJson = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  try { return JSON.parse(String(value)); } catch { return value; }
};

export function packagesRoutes(ctx: StockContext) {
  const { db, listScope, isDirector, requireWarehouse, requireWarehouseManager, assertLocation, paginationOf, recordWarehouseActivity } = ctx;
  const router = Router();

  /** PackageError/listScope ném ra có status → giữ nguyên message + code hợp đồng (§4.3). */
  function fail(res: any, error: any, fallback: string) {
    const status = Number(error?.status) || 500;
    const body: Record<string, unknown> = { error: status === 500 ? fallback : error.message };
    if (error?.code) body.code = error.code;
    if (error?.details) body.details = error.details;
    res.status(status).json(body);
  }

  /** Gắn lines đã enriched (tên hàng, serial, lô) + tổng lượng vào các header đã lấy. */
  async function withEnrichedLines(rows: any[]): Promise<any[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => String(row.id));
    const lines: any[] = await db.all(
      `SELECT ${LINE_FIELDS} FROM stock_package_lines pl
        LEFT JOIN products pr ON pr.id = pl.productId
        LEFT JOIN stock_serials s ON s.id = pl.serialId
        LEFT JOIN stock_lots lt ON lt.id = pl.lotId
        WHERE pl.packageId IN (${marks(ids.length)})
        ORDER BY pl.packageId ASC, pl.createdAt ASC, pl.id ASC`,
      ids
    ).catch(() => [] as any[]);
    const byPackage = new Map<string, any[]>();
    for (const line of lines || []) {
      if (!byPackage.has(line.packageId)) byPackage.set(line.packageId, []);
      byPackage.get(line.packageId)!.push(line);
    }
    return rows.map((row) => {
      const packageLines = byPackage.get(row.id) ?? [];
      const totalQty = round3(packageLines.reduce((sum, line) => sum + Number(line.qtyRemaining ?? 0), 0));
      const totalHeld = round3(packageLines.reduce((sum, line) => sum + Number(line.qtyHeld ?? 0), 0));
      return {
        ...row,
        lines: packageLines,
        lineCount: packageLines.length,
        totalQty,
        totalHeld,
        availableQty: round3(Math.max(0, totalQty - totalHeld)),
      };
    });
  }

  async function loadPackage(where: string, params: any[]): Promise<any | null> {
    const rows: any[] = await db.all(`SELECT ${PACKAGE_FIELDS} ${PACKAGE_SOURCE} WHERE ${where} LIMIT 1`, params).catch(() => [] as any[]);
    if (rows.length === 0) return null;
    const [packageRow] = await withEnrichedLines(rows);
    return packageRow ?? null;
  }

  function statusesFromQuery(value: string | undefined, fallback: PackageStatus[]): PackageStatus[] {
    const raw = String(value ?? '').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
    const list = raw.length > 0 ? raw : fallback;
    const invalid = list.filter((item) => !PACKAGE_STATUSES.includes(item as PackageStatus));
    if (invalid.length > 0) {
      throw Object.assign(new Error(`Trạng thái kiện không hợp lệ: ${invalid.join(', ')}`), { status: 400, code: 'PACKAGE_INVALID' });
    }
    return list as PackageStatus[];
  }

  /** Điều kiện WHERE chung cho /packages và /package-inventory (§4.1). */
  function packageFilters(
    query: Record<string, string | undefined>,
    options: { scope: string[] | null; statuses: PackageStatus[] | null; requireStock: boolean }
  ): { where: string[]; params: any[] } {
    const where: string[] = ['1=1'];
    const params: any[] = [];
    if (options.statuses && options.statuses.length > 0) {
      where.push(`p.status IN (${marks(options.statuses.length)})`);
      params.push(...options.statuses);
    }
    if (options.scope) {
      where.push(`p.warehouseId IN (${marks(options.scope.length)})`);
      params.push(...options.scope);
    }
    if (query.warehouseId?.trim()) { where.push('p.warehouseId = ?'); params.push(query.warehouseId.trim()); }
    if (query.packageTypeId?.trim()) { where.push('p.packageTypeId = ?'); params.push(query.packageTypeId.trim()); }
    if (query.locationId?.trim()) { where.push('p.locationId = ?'); params.push(query.locationId.trim()); }
    if (query.productId?.trim()) {
      where.push('EXISTS (SELECT 1 FROM stock_package_lines fp WHERE fp.packageId = p.id AND fp.productId = ?)');
      params.push(query.productId.trim());
    }
    if (query.expiryBefore?.trim()) {
      // expiryDate lưu chuỗi 'YYYY-MM-DD' nên so sánh chuỗi đúng thứ tự ngày.
      where.push('EXISTS (SELECT 1 FROM stock_package_lines fe WHERE fe.packageId = p.id AND fe.expiryDate IS NOT NULL AND fe.expiryDate <= ?)');
      params.push(query.expiryBefore.trim());
    }
    if (options.requireStock) {
      where.push('EXISTS (SELECT 1 FROM stock_package_lines fs WHERE fs.packageId = p.id AND fs.qtyRemaining > 0)');
    }
    const q = String(query.q ?? '').trim();
    if (q) {
      const needle = `%${q}%`;
      where.push(`(p.packageCode LIKE ? OR p.notes LIKE ?
        OR EXISTS (SELECT 1 FROM stock_package_lines fq LEFT JOIN products pq ON pq.id = fq.productId
                    WHERE fq.packageId = p.id AND (pq.name LIKE ? OR pq.importCode LIKE ?)))`);
      params.push(needle, needle, needle, needle);
    }
    return { where, params };
  }

  async function listPackages(req: any, res: any, options: { onHandOnly: boolean }) {
    const user = req.user;
    const scope = await listScope(user);
    const query = req.query as Record<string, string | undefined>;
    const warehouseId = String(query.warehouseId ?? '').trim();
    const directorView = isDirector(user);
    if (!directorView) {
      if (warehouseId && !scope.includes(warehouseId)) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (!warehouseId && scope.length === 0) {
        res.setHeader('X-Total-Count', '0');
        return res.json([]);
      }
    }
    const statusParam = String(query.status ?? '').trim();
    const statuses = options.onHandOnly
      ? statusesFromQuery(statusParam, ON_HAND_STATUSES)
      : (statusParam ? statusesFromQuery(statusParam, []) : null);
    const { where, params } = packageFilters(query, {
      scope: !directorView && !warehouseId ? scope : null,
      statuses,
      requireStock: options.onHandOnly && query.includeEmpty !== 'true',
    });
    const whereSql = where.join(' AND ');
    const totalRow = await db.get(`SELECT COUNT(*) AS total ${PACKAGE_SOURCE} WHERE ${whereSql}`, params);
    const page = paginationOf(query);
    const rows: any[] = await db.all(
      `SELECT ${PACKAGE_FIELDS} ${PACKAGE_SOURCE} WHERE ${whereSql}
        ORDER BY p.createdAt DESC, p.id DESC LIMIT ? OFFSET ?`,
      [...params, page.limit, page.offset]
    );
    const packages = await withEnrichedLines(rows);
    res.setHeader('X-Total-Count', String(Number(totalRow?.total || 0)));
    res.json(packages);
  }

  router.get('/packages', async (req, res) => {
    try {
      await listPackages(req, res, { onHandOnly: false });
    } catch (e: any) { fail(res, e, 'Failed to fetch packages'); }
  });

  /**
   * Quét kiện khi lập phiếu: FE chỉ thêm dòng khi `blocked === null` (§4.2).
   * Các chặn theo nghiệp vụ trả 200 + blocked; chỉ thiếu/sai mã mới là 4xx.
   */
  router.get('/packages/lookup', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const rawCode = String(req.query.code ?? '').trim();
      if (!rawCode) {
        return res.status(400).json({ error: 'Thiếu mã kiện cần quét', code: 'PACKAGE_INVALID' });
      }
      const code = normalizePackageCode(rawCode);
      const packageRow = await loadPackage('p.packageCode = ?', [code]);
      if (!packageRow) {
        return res.status(404).json({ error: `Không tìm thấy kiện ${code}`, code: 'PACKAGE_NOT_FOUND' });
      }
      if (!isDirector(user) && !scope.includes(packageRow.warehouseId)) {
        return res.status(403).json({ error: 'Warehouse outside your scope' });
      }
      // lines trả ở cấp cao nhất theo hợp đồng §4.2, không lặp lại trong package.
      const { lines, ...packageHead } = packageRow;
      res.json({
        package: packageHead,
        lines,
        blocked: lookupBlocked(packageRow, req.query as Record<string, string | undefined>),
      });
    } catch (e: any) { fail(res, e, 'Failed to lookup package'); }
  });

  /**
   * Gợi ý kiện cho một dòng xuất (FIFO/FEFO, §R3). Chỉ đọc: kết quả là đề xuất,
   * lượng hàng không bị giữ — bước ghi sổ vẫn tái kiểm tra khi khóa dòng kiện.
   * Phải đứng trước /packages/:id vì Express khớp theo thứ tự đăng ký.
   */
  router.get('/packages/suggest', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const productId = String(req.query.productId ?? '').trim();
      const warehouseId = String(req.query.warehouseId ?? '').trim();
      const quantity = Number(req.query.quantity);
      if (!productId || !warehouseId) {
        return res.status(400).json({ error: 'Gợi ý kiện cần productId và warehouseId', code: 'PACKAGE_INVALID' });
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ error: 'quantity phải là số lớn hơn 0', code: 'PACKAGE_INVALID' });
      }
      if (!isDirector(user) && !scope.includes(warehouseId)) {
        return res.status(403).json({ error: 'Warehouse outside your scope' });
      }
      // Mặc định theo cấu hình mã hàng, query rule chỉ override (§R3 "Cấu hình mặc định").
      const product = await db.get('SELECT id, suggestionRule FROM products WHERE id = ?', [productId]).catch(() => undefined);
      const rule = suggestRuleFromQuery(req.query.rule) ?? suggestRuleFromQuery(product?.suggestionRule);
      res.json({ productId, warehouseId, ...(await suggestPackages(db, { productId, warehouseId, quantity, rule })) });
    } catch (e: any) { fail(res, e, 'Failed to suggest packages'); }
  });

  router.get('/packages/:id', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const packageRow = await loadPackage('p.id = ?', [String(req.params.id)]);
      if (!packageRow) return res.status(404).json({ error: 'Package not found', code: 'PACKAGE_NOT_FOUND' });
      if (!isDirector(user) && !scope.includes(packageRow.warehouseId)) {
        return res.status(403).json({ error: 'Warehouse outside your scope' });
      }
      res.json(packageRow);
    } catch (e: any) { fail(res, e, 'Failed to fetch package'); }
  });

  /** Truy xuất nguồn gốc: phiếu nhập → dịch chuyển kiện → phiếu xuất (§"Báo cáo & truy xuất"). */
  router.get('/packages/:id/trace', async (req, res) => {
    try {
      const user = req.user;
      const scope = await listScope(user);
      const id = String(req.params.id);
      const packageRow = await loadPackage('p.id = ?', [id]);
      if (!packageRow) return res.status(404).json({ error: 'Package not found', code: 'PACKAGE_NOT_FOUND' });
      if (!isDirector(user) && !scope.includes(packageRow.warehouseId)) {
        return res.status(403).json({ error: 'Warehouse outside your scope' });
      }

      const movements = await db.all(
        `SELECT m.id, m.packageLineId, m.productId, m.quantity, m.moveType, m.referenceType, m.referenceId,
                m.documentLineId, m.moveId, m.createdAt, pr.name AS productName,
                d.code AS documentCode, d.docType AS documentType, d.status AS documentStatus, u.name AS userName
         FROM stock_package_movements m
         LEFT JOIN products pr ON pr.id = m.productId
         LEFT JOIN stock_documents d ON d.id = m.referenceId AND m.referenceType = 'STOCK_DOCUMENT'
         LEFT JOIN users u ON u.id = m.createdBy
         WHERE m.packageId = ? ORDER BY m.createdAt ASC, m.id ASC LIMIT 500`,
        [id]
      ).catch(() => [] as any[]);
      const documents = await db.all(
        `SELECT DISTINCT d.id, d.code, d.docType, d.status, d.docDate, d.postingDate, d.partnerName, d.customerName,
                w.name AS warehouseName
         FROM stock_package_movements m
         JOIN stock_documents d ON d.id = m.referenceId
         LEFT JOIN warehouses w ON w.id = d.warehouseId
         WHERE m.packageId = ? AND m.referenceType = 'STOCK_DOCUMENT'
         ORDER BY d.createdAt DESC LIMIT 200`,
        [id]
      ).catch(() => [] as any[]);
      const activities = await db.all(
        `SELECT a.id, a.actionType, a.documentId, a.documentCode, a.productId, a.quantity, a.userId,
                a.packageCode, a.metadata, a.createdAt, u.name AS userName, pr.name AS productName
         FROM warehouse_activity_logs a
         LEFT JOIN users u ON u.id = a.userId
         LEFT JOIN products pr ON pr.id = a.productId
         WHERE a.packageId = ? ORDER BY a.createdAt DESC, a.id DESC LIMIT 200`,
        [id]
      ).catch(() => [] as any[]);

      const ancestorIds = [packageRow.sourcePackageId, packageRow.parentPackageId].filter(Boolean);
      const sourcePackages = ancestorIds.length > 0
        ? await db.all(
          `SELECT p.id, p.packageCode, p.status, p.warehouseId, w.name AS warehouseName
           FROM stock_packages p LEFT JOIN warehouses w ON w.id = p.warehouseId
           WHERE p.id IN (${marks(ancestorIds.length)})`,
          ancestorIds
        ).catch(() => [] as any[])
        : [];
      const derivedPackages = await db.all(
        `SELECT p.id, p.packageCode, p.status, p.warehouseId, w.name AS warehouseName
         FROM stock_packages p LEFT JOIN warehouses w ON w.id = p.warehouseId
         WHERE p.sourcePackageId = ? OR p.parentPackageId = ? ORDER BY p.createdAt ASC`,
        [id, id]
      ).catch(() => [] as any[]);

      const { lines, ...packageHead } = packageRow;
      res.json({
        package: packageHead,
        lines,
        receiptDocument: packageRow.sourceReceiptId
          ? await db.get(
            `SELECT d.id, d.code, d.docType, d.status, d.docDate, d.postingDate, d.partnerName, w.name AS warehouseName
             FROM stock_documents d LEFT JOIN warehouses w ON w.id = d.warehouseId WHERE d.id = ?`,
            [packageRow.sourceReceiptId]
          ).catch(() => null)
          : null,
        documents,
        movements,
        activities: (activities || []).map((row: any) => ({ ...row, metadata: parseJson(row.metadata) })),
        sourcePackages,
        derivedPackages,
      });
    } catch (e: any) { fail(res, e, 'Failed to fetch package trace'); }
  });

  const PackagePatchSchema = z.object({
    locationId: z.string().trim().max(191).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  }).refine((value) => value.locationId !== undefined || value.notes !== undefined, {
    message: 'Cần gửi locationId hoặc notes',
  });

  /** Đổi vị trí/ghi chú — Manager, không đụng số lượng nên không cần movement. */
  router.patch('/packages/:id', validate(PackagePatchSchema), async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (!requireWarehouseManager(user)) return res.status(403).json({ error: 'Only warehouse managers can manage packages' });
      const existing = await loadPackage('p.id = ?', [String(req.params.id)]);
      if (!existing) return res.status(404).json({ error: 'Package not found', code: 'PACKAGE_NOT_FOUND' });
      const access = await requireWarehouse(user, existing.warehouseId);
      if (!access.ok) return res.status(403).json({ error: 'Warehouse outside your scope' });
      if (existing.status === 'ISSUED') {
        return res.status(409).json({ error: `Kiện ${existing.packageCode} đã xuất hết, không còn ở kho để sửa`, code: 'PACKAGE_ISSUED' });
      }
      if (existing.status === 'CANCELLED') {
        return res.status(409).json({ error: `Kiện ${existing.packageCode} đã hủy`, code: 'PACKAGE_INVALID' });
      }
      const locationId = req.body.locationId !== undefined
        ? (req.body.locationId ? String(req.body.locationId).trim() : null)
        : (existing.locationId || null);
      if (locationId && !(await assertLocation(existing.warehouseId, locationId))) {
        return res.status(400).json({ error: 'Vị trí không thuộc kho của kiện hoặc đã ngừng hoạt động', code: 'PACKAGE_INVALID' });
      }
      const notes = req.body.notes !== undefined ? String(req.body.notes ?? '').trim() : existing.notes;
      const now = new Date().toISOString();
      let transactionOpen = false;
      try {
        await db.run('START TRANSACTION');
        transactionOpen = true;
        await db.run(
          'UPDATE stock_packages SET locationId = ?, notes = ?, updatedAt = ? WHERE id = ?',
          [locationId, notes || null, now, existing.id]
        );
        await recordPackageActivities(db, [{
          actionType: 'PACKAGE_UPDATED', packageId: existing.id, packageCode: existing.packageCode,
          warehouseId: existing.warehouseId, userId: user.id,
          metadata: {
            old: { locationId: existing.locationId || null, notes: existing.notes || null },
            new: { locationId, notes: notes || null },
          },
        }]);
        await db.run('COMMIT');
        transactionOpen = false;
      } catch (e) {
        if (transactionOpen) await db.run('ROLLBACK').catch(() => undefined);
        throw e;
      }
      res.json({ success: true, package: await loadPackage('p.id = ?', [existing.id]) });
    } catch (e: any) { fail(res, e, 'Failed to update package'); }
  });

  /** Tồn theo kiện: mặc định chỉ kiện còn hàng trong kho (IN_STOCK/HELD/PARTIAL_ISSUED). */
  router.get('/package-inventory', async (req, res) => {
    try {
      await listPackages(req, res, { onHandOnly: true });
    } catch (e: any) { fail(res, e, 'Failed to fetch package inventory'); }
  });

  // ── Danh mục loại kiện (§4.1) ──────────────────────────────────────────────

  router.get('/package-types', async (req, res) => {
    try {
      await listScope(req.user);
      const includeInactive = String(req.query.includeInactive ?? '') === 'true';
      const rows = await db.all(
        `SELECT t.*, (SELECT COUNT(*) FROM stock_packages p WHERE p.packageTypeId = t.id) AS packageCount
         FROM stock_package_types t
         ${includeInactive ? '' : 'WHERE t.isActive = 1'}
         ORDER BY t.name ASC`
      );
      res.json((rows || []).map((row: any) => ({ ...row, isActive: Boolean(row.isActive) })));
    } catch (e: any) { fail(res, e, 'Failed to fetch package types'); }
  });

  const PackageTypeSchema = z.object({
    code: z.string().trim().min(2).max(50),
    name: z.string().trim().min(1).max(191),
    lengthCm: z.number().finite().nonnegative().nullable().optional(),
    widthCm: z.number().finite().nonnegative().nullable().optional(),
    heightCm: z.number().finite().nonnegative().nullable().optional(),
    maxWeightKg: z.number().finite().nonnegative().nullable().optional(),
    maxLines: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
  });

  /** Danh mục loại kiện là toàn cục (không gắn kho) → Manager, Admin vẫn bị chặn (D12). */
  function managerUser(req: any, res: any): any | null {
    const user = req.user;
    if (!user) { res.status(401).json({ error: 'Unauthorized' }); return null; }
    if (!requireWarehouseManager(user)) { res.status(403).json({ error: 'Only warehouse managers can manage package types' }); return null; }
    return user;
  }

  router.post('/package-types', validate(PackageTypeSchema), async (req, res) => {
    try {
      const user = managerUser(req, res);
      if (!user) return;
      const body = req.body as z.infer<typeof PackageTypeSchema>;
      const id = `pkgtype-${randomUUID().slice(0, 8)}`;
      let transactionOpen = false;
      try {
        await db.run('START TRANSACTION');
        transactionOpen = true;
        await db.run(
          `INSERT INTO stock_package_types (id, code, name, lengthCm, widthCm, heightCm, maxWeightKg, maxLines, isActive)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, body.code.toUpperCase(), body.name.trim(), body.lengthCm ?? null, body.widthCm ?? null,
            body.heightCm ?? null, body.maxWeightKg ?? null, body.maxLines ?? null, body.isActive === false ? 0 : 1]
        );
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'PACKAGE_TYPE_CREATED', entityType: 'PACKAGE_TYPE', entityId: id,
          userId: user.id, newData: { id, code: body.code.toUpperCase(), name: body.name.trim() },
        });
        await db.run('COMMIT');
        transactionOpen = false;
      } catch (e: any) {
        if (transactionOpen) await db.run('ROLLBACK').catch(() => undefined);
        if (String(e?.message || '').includes('Duplicate')) {
          return res.status(409).json({ error: 'Mã loại kiện đã tồn tại', code: 'PACKAGE_CODE_DUPLICATE' });
        }
        throw e;
      }
      res.status(201).json({ id });
    } catch (e: any) { fail(res, e, 'Failed to create package type'); }
  });

  router.put('/package-types/:id', validate(PackageTypeSchema.partial()), async (req, res) => {
    try {
      const user = managerUser(req, res);
      if (!user) return;
      const id = String(req.params.id);
      const existing = await db.get('SELECT * FROM stock_package_types WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: 'Package type not found' });
      const body = req.body as Partial<z.infer<typeof PackageTypeSchema>>;
      const next = {
        code: body.code ? body.code.trim().toUpperCase() : existing.code,
        name: body.name ? body.name.trim() : existing.name,
        lengthCm: body.lengthCm !== undefined ? (body.lengthCm ?? null) : existing.lengthCm,
        widthCm: body.widthCm !== undefined ? (body.widthCm ?? null) : existing.widthCm,
        heightCm: body.heightCm !== undefined ? (body.heightCm ?? null) : existing.heightCm,
        maxWeightKg: body.maxWeightKg !== undefined ? (body.maxWeightKg ?? null) : existing.maxWeightKg,
        maxLines: body.maxLines !== undefined ? (body.maxLines ?? null) : existing.maxLines,
        isActive: body.isActive === undefined ? existing.isActive : (body.isActive ? 1 : 0),
      };
      let transactionOpen = false;
      try {
        await db.run('START TRANSACTION');
        transactionOpen = true;
        await db.run(
          `UPDATE stock_package_types SET code = ?, name = ?, lengthCm = ?, widthCm = ?, heightCm = ?,
             maxWeightKg = ?, maxLines = ?, isActive = ? WHERE id = ?`,
          [next.code, next.name, next.lengthCm, next.widthCm, next.heightCm, next.maxWeightKg, next.maxLines, next.isActive, id]
        );
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'PACKAGE_TYPE_UPDATED', entityType: 'PACKAGE_TYPE', entityId: id,
          userId: user.id, oldData: existing, newData: next,
        });
        await db.run('COMMIT');
        transactionOpen = false;
      } catch (e: any) {
        if (transactionOpen) await db.run('ROLLBACK').catch(() => undefined);
        if (String(e?.message || '').includes('Duplicate')) {
          return res.status(409).json({ error: 'Mã loại kiện đã tồn tại', code: 'PACKAGE_CODE_DUPLICATE' });
        }
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { fail(res, e, 'Failed to update package type'); }
  });

  router.delete('/package-types/:id', async (req, res) => {
    try {
      const user = managerUser(req, res);
      if (!user) return;
      const id = String(req.params.id);
      const existing = await db.get('SELECT * FROM stock_package_types WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: 'Package type not found' });
      // Giống guard B4 của kho: loại kiện đang dùng thì ngừng hoạt động chứ không xóa.
      const usage = await db.get('SELECT COUNT(*) AS total FROM stock_packages WHERE packageTypeId = ?', [id]);
      const used = Number(usage?.total || 0);
      if (used > 0) {
        return res.status(409).json({
          error: `Loại kiện đang được ${used} kiện sử dụng — ngừng hoạt động thay vì xóa`,
          code: 'PACKAGE_TYPE_IN_USE',
        });
      }
      let transactionOpen = false;
      try {
        await db.run('START TRANSACTION');
        transactionOpen = true;
        const result = await db.run('DELETE FROM stock_package_types WHERE id = ?', [id]);
        if (result && Number(result.changes) === 0) {
          await db.run('ROLLBACK');
          transactionOpen = false;
          return res.status(404).json({ error: 'Package type not found' });
        }
        await recordWarehouseActivity(db.run.bind(db), {
          actionType: 'PACKAGE_TYPE_DELETED', entityType: 'PACKAGE_TYPE', entityId: id,
          userId: user.id, oldData: existing,
        });
        await db.run('COMMIT');
        transactionOpen = false;
      } catch (e) {
        if (transactionOpen) await db.run('ROLLBACK').catch(() => undefined);
        throw e;
      }
      res.json({ success: true });
    } catch (e: any) { fail(res, e, 'Failed to delete package type'); }
  });

  return router;
}

/** 'FIFO' / 'FEFO' không phân biệt hoa thường; giá trị khác trả null để lấy mặc định. */
function suggestRuleFromQuery(value: unknown): PackageSuggestionRule | null {
  const raw = String(value ?? '').trim().toUpperCase();
  return raw === 'FEFO' || raw === 'FIFO' ? raw : null;
}

/** Quy tắc chặn khi quét kiện (§4.2): FE chỉ thêm dòng khi trả về null. */
function lookupBlocked(
  pkg: any,
  query: Record<string, string | undefined>
): { code: string; message: string } | null {
  const warehouseId = String(query.warehouseId ?? '').trim();
  const docType = String(query.docType ?? '').trim().toUpperCase();
  if (warehouseId && pkg.warehouseId !== warehouseId) {
    return { code: 'PACKAGE_WRONG_WAREHOUSE', message: `Kiện ${pkg.packageCode} đang ở ${pkg.warehouseName || pkg.warehouseId}, không thuộc kho đang thao tác` };
  }
  if (docType === 'RECEIPT') {
    if (pkg.status !== 'PENDING' && pkg.status !== 'CANCELLED') {
      return { code: 'PACKAGE_CODE_DUPLICATE', message: `Kiện ${pkg.packageCode} đã có trong kho — không nhập trùng` };
    }
    return null;
  }
  // Phiếu trả cần chính kiện đã xuất để cộng trả lại tồn (§"Khách trả").
  if (docType === 'RETURN') return null;
  if (pkg.status === 'PENDING') return { code: 'PACKAGE_PENDING', message: `Kiện ${pkg.packageCode} chưa hoàn tất phiếu nhập` };
  if (pkg.status === 'CANCELLED') return { code: 'PACKAGE_INVALID', message: `Kiện ${pkg.packageCode} đã hủy` };
  if (pkg.status === 'ISSUED') return { code: 'PACKAGE_ISSUED', message: `Kiện ${pkg.packageCode} đã xuất hết` };
  if (pkg.status === 'IN_TRANSIT') return { code: 'PACKAGE_WRONG_WAREHOUSE', message: `Kiện ${pkg.packageCode} đang điều chuyển, chưa về kho đích` };
  if (Number(pkg.availableQty) <= 0) return { code: 'PACKAGE_HELD', message: `Kiện ${pkg.packageCode} đã bị giữ hết phần còn lại` };
  return null;
}
