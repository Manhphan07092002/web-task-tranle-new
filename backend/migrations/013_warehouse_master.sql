-- Migration 013: Warehouse master data (A1)
-- stock_products (SKU master), warehouses, warehouse_locations
-- Safe to run: uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS stock_products (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  brand VARCHAR(100),
  model VARCHAR(100),
  category VARCHAR(100),
  unit VARCHAR(20) DEFAULT 'pcs',
  tracking VARCHAR(20) DEFAULT 'NONE',
  warrantyMonths INT DEFAULT 0,
  minStock DECIMAL(18,3) DEFAULT 0,
  maxStock DECIMAL(18,3) DEFAULT 0,
  reorderPoint DECIMAL(18,3) DEFAULT 0,
  requiresCertificates TINYINT DEFAULT 0,
  isActive TINYINT DEFAULT 1,
  notes TEXT,
  createdBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_stock_product_code (code),
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_sp_code (code),
  INDEX idx_sp_category (category),
  INDEX idx_sp_brand (brand),
  INDEX idx_sp_tracking (tracking)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warehouses (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  region VARCHAR(100),
  address TEXT,
  managerId VARCHAR(36),
  isActive TINYINT DEFAULT 1,
  createdBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_warehouse_code (code),
  FOREIGN KEY (managerId) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_wh_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warehouse_locations (
  id VARCHAR(36) PRIMARY KEY,
  warehouseId VARCHAR(36) NOT NULL,
  parentId VARCHAR(36),
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) DEFAULT 'INTERNAL',
  purpose VARCHAR(20) DEFAULT 'SALEABLE',
  isActive TINYINT DEFAULT 1,
  createdBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_wh_location_code (code),
  FOREIGN KEY (warehouseId) REFERENCES warehouses(id) ON DELETE CASCADE,
  FOREIGN KEY (parentId) REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_whl_warehouse (warehouseId),
  INDEX idx_whl_parent (parentId),
  INDEX idx_whl_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
