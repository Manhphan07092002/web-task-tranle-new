-- Migration 022: Product bundles (C1: VIRTUAL_BUNDLE / STOCKED_KIT)
-- VIRTUAL: config only, buildable computed from component available.
-- STOCKED_KIT: assemble/disassemble emits stock moves.
-- Safe to run: uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS bundles (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(20) DEFAULT 'set',
  mode VARCHAR(20) DEFAULT 'VIRTUAL_BUNDLE',
  kitProductId VARCHAR(36),
  notes TEXT,
  isActive TINYINT DEFAULT 1,
  createdBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_bundle_code (code),
  FOREIGN KEY (kitProductId) REFERENCES stock_products(id) ON DELETE SET NULL,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_bundle_mode (mode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bundle_items (
  id VARCHAR(36) PRIMARY KEY,
  bundleId VARCHAR(36) NOT NULL,
  productId VARCHAR(36) NOT NULL,
  productCode VARCHAR(50) NOT NULL,
  productName VARCHAR(255) NOT NULL,
  quantity DECIMAL(18,3) NOT NULL DEFAULT 1,
  unit VARCHAR(20) DEFAULT 'pcs',
  FOREIGN KEY (bundleId) REFERENCES bundles(id) ON DELETE CASCADE,
  FOREIGN KEY (productId) REFERENCES stock_products(id) ON DELETE RESTRICT,
  INDEX idx_bitem_bundle (bundleId),
  INDEX idx_bitem_product (productId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
