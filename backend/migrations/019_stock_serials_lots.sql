-- Migration 019: Serials & lots (B1: truy vết serial/lot)
-- Safe to run: uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS lots (
  id VARCHAR(36) PRIMARY KEY,
  lotCode VARCHAR(100) NOT NULL,
  productId VARCHAR(36) NOT NULL,
  productCode VARCHAR(50) NOT NULL,
  expiryDate DATE,
  supplierName VARCHAR(255),
  notes TEXT,
  createdBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_lot_code (lotCode),
  FOREIGN KEY (productId) REFERENCES stock_products(id) ON DELETE RESTRICT,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_lots_product (productId),
  INDEX idx_lots_expiry (expiryDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS serials (
  id VARCHAR(36) PRIMARY KEY,
  serialNo VARCHAR(100) NOT NULL,
  productId VARCHAR(36) NOT NULL,
  productCode VARCHAR(50) NOT NULL,
  productName VARCHAR(255) NOT NULL,
  lotId VARCHAR(36),
  status VARCHAR(20) NOT NULL DEFAULT 'IN_STOCK',
  warehouseId VARCHAR(36),
  locationId VARCHAR(36),
  receiptDocId VARCHAR(36),
  receiptLineId VARCHAR(36),
  issueDocId VARCHAR(36),
  issueLineId VARCHAR(36),
  customerRef VARCHAR(255),
  warrantyStart DATE,
  warrantyEnd DATE,
  notes TEXT,
  createdBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_serial_no (serialNo),
  FOREIGN KEY (productId) REFERENCES stock_products(id) ON DELETE RESTRICT,
  FOREIGN KEY (lotId) REFERENCES lots(id) ON DELETE SET NULL,
  FOREIGN KEY (warehouseId) REFERENCES warehouses(id) ON DELETE SET NULL,
  FOREIGN KEY (locationId) REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_serial_product (productId),
  INDEX idx_serial_status (status),
  INDEX idx_serial_warehouse (warehouseId),
  INDEX idx_serial_lot (lotId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
