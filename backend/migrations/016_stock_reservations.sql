-- Migration 016: Reservations (A5: giữ hàng cho SO/Project/nội bộ)
-- Reservation KHÔNG sinh stock_move; chỉ tăng reserved trong balances.
-- Safe to run: uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS reservations (
  id VARCHAR(36) PRIMARY KEY,
  sourceType VARCHAR(20) DEFAULT 'INTERNAL',
  sourceId VARCHAR(100),
  productId VARCHAR(36) NOT NULL,
  productCode VARCHAR(50) NOT NULL,
  productName VARCHAR(255) NOT NULL,
  warehouseId VARCHAR(36) NOT NULL,
  locationId VARCHAR(36),
  qty DECIMAL(18,3) NOT NULL,
  qtyConsumed DECIMAL(18,3) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  assigneeId VARCHAR(36),
  expiresAt DATETIME,
  notes TEXT,
  createdBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (productId) REFERENCES stock_products(id) ON DELETE RESTRICT,
  FOREIGN KEY (warehouseId) REFERENCES warehouses(id) ON DELETE RESTRICT,
  FOREIGN KEY (locationId) REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  FOREIGN KEY (assigneeId) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_res_product_wh (productId, warehouseId),
  INDEX idx_res_status (status),
  INDEX idx_res_expiry (expiresAt),
  INDEX idx_res_assignee (assigneeId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
