-- Migration 012: Stock inquiry dimensions (MISA-style lookups)
-- 1. inventory: category + specCode (Loại hàng hóa, Mã quy cách)
-- 2. warehouse_transactions: category + specCode (carried into new inventory rows on approve)
-- 3. inventory_lots: batch tracking (Số lô, Hạn sử dụng)
-- 4. product_combos + product_combo_items: combo hàng hóa
-- Safe to run: uses ADD COLUMN IF NOT EXISTS / IF NOT EXISTS

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS specCode VARCHAR(100);

ALTER TABLE warehouse_transactions
  ADD COLUMN IF NOT EXISTS category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS specCode VARCHAR(100);

CREATE TABLE IF NOT EXISTS inventory_lots (
  id VARCHAR(36) PRIMARY KEY,
  productCode VARCHAR(50) NOT NULL,
  productName VARCHAR(255) NOT NULL,
  lotCode VARCHAR(100) NOT NULL,
  expiryDate DATE NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit VARCHAR(20) DEFAULT 'pcs',
  locationCode VARCHAR(50),
  departmentId VARCHAR(36) DEFAULT 'dept-kho',
  notes TEXT,
  createdBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_lots_product (productCode),
  INDEX idx_lots_lot (lotCode),
  INDEX idx_lots_expiry (expiryDate),
  INDEX idx_lots_location (locationCode),
  INDEX idx_lots_dept (departmentId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_combos (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(20) DEFAULT 'set',
  departmentId VARCHAR(36) DEFAULT 'dept-kho',
  notes TEXT,
  isActive TINYINT DEFAULT 1,
  createdBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_combo_code (code),
  FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_combo_dept (departmentId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_combo_items (
  id VARCHAR(36) PRIMARY KEY,
  comboId VARCHAR(36) NOT NULL,
  productCode VARCHAR(50) NOT NULL,
  productName VARCHAR(255) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit VARCHAR(20) DEFAULT 'pcs',
  FOREIGN KEY (comboId) REFERENCES product_combos(id) ON DELETE CASCADE,
  INDEX idx_combo_items_combo (comboId),
  INDEX idx_combo_items_product (productCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory(category);
CREATE INDEX IF NOT EXISTS idx_inventory_spec ON inventory(specCode);
