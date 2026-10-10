-- Migration 021: Stock policies per product+warehouse (B3: Min/Max alerts)
-- Falls back to stock_products defaults when no override row exists.
-- Safe to run: uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS stock_policies (
  id VARCHAR(36) PRIMARY KEY,
  productId VARCHAR(36) NOT NULL,
  warehouseId VARCHAR(36) NOT NULL,
  minStock DECIMAL(18,3) DEFAULT 0,
  maxStock DECIMAL(18,3) DEFAULT 0,
  reorderPoint DECIMAL(18,3) DEFAULT 0,
  preferredQty DECIMAL(18,3) DEFAULT 0,
  leadTimeDays INT DEFAULT 0,
  createdBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_stock_policy (productId, warehouseId),
  FOREIGN KEY (productId) REFERENCES stock_products(id) ON DELETE CASCADE,
  FOREIGN KEY (warehouseId) REFERENCES warehouses(id) ON DELETE CASCADE,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_spol_product (productId),
  INDEX idx_spol_warehouse (warehouseId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
