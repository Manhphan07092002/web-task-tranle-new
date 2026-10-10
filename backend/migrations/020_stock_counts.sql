-- Migration 020: Stock counts (B2: blind count + variance + adjustment)
-- Flow: planned -> in_progress -> reconciling -> done.
-- Adjustments are emitted only from approved variances (never direct edits).
-- Safe to run: uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS stock_counts (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  warehouseId VARCHAR(36) NOT NULL,
  locationId VARCHAR(36),
  status VARCHAR(20) NOT NULL DEFAULT 'planned',
  blindCount TINYINT DEFAULT 1,
  assigneeId VARCHAR(36),
  notes TEXT,
  createdBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_stock_count_code (code),
  FOREIGN KEY (warehouseId) REFERENCES warehouses(id) ON DELETE RESTRICT,
  FOREIGN KEY (locationId) REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  FOREIGN KEY (assigneeId) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_sc_warehouse (warehouseId),
  INDEX idx_sc_status (status),
  INDEX idx_sc_assignee (assigneeId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id VARCHAR(36) PRIMARY KEY,
  countId VARCHAR(36) NOT NULL,
  productId VARCHAR(36) NOT NULL,
  productCode VARCHAR(50) NOT NULL,
  productName VARCHAR(255) NOT NULL,
  systemQty DECIMAL(18,3) NOT NULL DEFAULT 0,
  countedQty DECIMAL(18,3),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  resolution TEXT,
  resolvedBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (countId) REFERENCES stock_counts(id) ON DELETE CASCADE,
  FOREIGN KEY (productId) REFERENCES stock_products(id) ON DELETE RESTRICT,
  FOREIGN KEY (resolvedBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_scl_count (countId),
  INDEX idx_scl_status (status),
  INDEX idx_scl_product (productId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
