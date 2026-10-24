export type StockAlertType = 'OUT' | 'LOW' | 'MAX';

export interface StockAlertRow {
  productId: string;
  warehouseId: string;
  onHand: number;
  reserved: number;
  available: number;
  productName?: string | null;
  warehouseCode?: string | null;
  warehouseName?: string | null;
  minStock?: number | null;
  maxStock?: number | null;
  reorderPoint?: number | null;
}

export interface StockAlertQueryOptions {
  warehouseId?: string;
  scope?: string[];
  limit?: number;
  offset?: number;
}

/** Phân loại cảnh báo theo thứ tự ưu tiên: hết hàng > dưới ngưỡng > vượt Max. */
export function classifyStockAlert(row: StockAlertRow): StockAlertType | null {
  const available = Number(row.available ?? 0);
  const onHand = Number(row.onHand ?? 0);
  const reorderPoint = Number(row.reorderPoint ?? 0);
  const minStock = Number(row.minStock ?? 0);
  const maxStock = Number(row.maxStock ?? 0);
  if (available <= 0) return 'OUT';
  if ((reorderPoint > 0 && available < reorderPoint) || (minStock > 0 && available < minStock)) return 'LOW';
  if (maxStock > 0 && onHand > maxStock) return 'MAX';
  return null;
}

/**
 * Query cảnh báo tồn dùng chung cho `/api/stock/alerts` và scheduler.
 * `scope` chỉ áp dụng khi không truyền `warehouseId`; scope rỗng = không có kho.
 */
export async function listStockAlerts(db: any, options: StockAlertQueryOptions = {}): Promise<StockAlertRow[]> {
  if (!options.warehouseId && options.scope && options.scope.length === 0) return [];
  let query = `SELECT b.productId, b.warehouseId,
      SUM(b.onHand) AS onHand, SUM(b.reserved) AS reserved,
      SUM(CASE WHEN b.locationId = '' OR (l.isActive = 1 AND l.purpose = 'SALEABLE') THEN b.onHand - b.reserved ELSE 0 END) AS available,
      p.name AS productName, w.code AS warehouseCode, w.name AS warehouseName,
      pol.minStock, pol.maxStock, pol.reorderPoint
    FROM stock_balances b
    LEFT JOIN products p ON p.id = b.productId
    LEFT JOIN warehouses w ON w.id = b.warehouseId
    LEFT JOIN product_warehouse_policies pol ON pol.productId = b.productId AND pol.warehouseId = b.warehouseId
    LEFT JOIN stock_locations l ON l.id = b.locationId AND l.warehouseId = b.warehouseId
    WHERE 1=1`;
  const params: any[] = [];
  if (options.warehouseId) {
    query += ' AND b.warehouseId = ?';
    params.push(options.warehouseId);
  } else if (options.scope) {
    query += ` AND b.warehouseId IN (${options.scope.map(() => '?').join(', ')})`;
    params.push(...options.scope);
  }
  query += ` GROUP BY b.productId, b.warehouseId, p.name, w.code, w.name, pol.minStock, pol.maxStock, pol.reorderPoint
    HAVING available <= 0
      OR (pol.reorderPoint IS NOT NULL AND pol.reorderPoint > 0 AND available < pol.reorderPoint)
      OR (pol.minStock IS NOT NULL AND pol.minStock > 0 AND available < pol.minStock)
      OR (pol.maxStock IS NOT NULL AND pol.maxStock > 0 AND onHand > pol.maxStock)
    ORDER BY available ASC`;
  if (options.limit !== undefined) {
    query += ' LIMIT ? OFFSET ?';
    params.push(options.limit, options.offset ?? 0);
  }
  return db.all(query, params);
}
