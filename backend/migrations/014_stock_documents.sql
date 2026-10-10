-- Migration 014: Stock documents + moves + balances (A2: Receipt core)
-- Immutable stock_moves; stock_balances is a rebuildable projection.
-- Safe to run: uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS stock_documents (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  sourceType VARCHAR(20) DEFAULT 'INTERNAL',
  sourceId VARCHAR(100),
  supplierName VARCHAR(255),
  warehouseId VARCHAR(36) NOT NULL,
  requesterId VARCHAR(36),
  assigneeId VARCHAR(36),
  notes TEXT,
  createdBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_stock_doc_code (code),
  FOREIGN KEY (warehouseId) REFERENCES warehouses(id) ON DELETE RESTRICT,
  FOREIGN KEY (requesterId) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (assigneeId) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_sdoc_type_status (type, status),
  INDEX idx_sdoc_warehouse (warehouseId),
  INDEX idx_sdoc_assignee (assigneeId),
  INDEX idx_sdoc_requester (requesterId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_document_lines (
  id VARCHAR(36) PRIMARY KEY,
  docId VARCHAR(36) NOT NULL,
  productId VARCHAR(36) NOT NULL,
  productCode VARCHAR(50) NOT NULL,
  productName VARCHAR(255) NOT NULL,
  qtyOrdered DECIMAL(18,3) NOT NULL DEFAULT 0,
  qtyReceived DECIMAL(18,3) NOT NULL DEFAULT 0,
  unit VARCHAR(20) DEFAULT 'pcs',
  locationId VARCHAR(36),
  notes TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (docId) REFERENCES stock_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (productId) REFERENCES stock_products(id) ON DELETE RESTRICT,
  FOREIGN KEY (locationId) REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  INDEX idx_sdline_doc (docId),
  INDEX idx_sdline_product (productId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_moves (
  id VARCHAR(36) PRIMARY KEY,
  productId VARCHAR(36) NOT NULL,
  productCode VARCHAR(50) NOT NULL,
  warehouseId VARCHAR(36) NOT NULL,
  locationId VARCHAR(36),
  lotId VARCHAR(36),
  serialNo VARCHAR(100),
  qty DECIMAL(18,3) NOT NULL,
  moveType VARCHAR(20) NOT NULL,
  docId VARCHAR(36),
  lineId VARCHAR(36),
  createdBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (productId) REFERENCES stock_products(id) ON DELETE RESTRICT,
  FOREIGN KEY (warehouseId) REFERENCES warehouses(id) ON DELETE RESTRICT,
  FOREIGN KEY (locationId) REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  FOREIGN KEY (docId) REFERENCES stock_documents(id) ON DELETE SET NULL,
  INDEX idx_smove_product_wh (productId, warehouseId),
  INDEX idx_smove_location (locationId),
  INDEX idx_smove_doc (docId),
  INDEX idx_smove_created (createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_balances (
  productId VARCHAR(36) NOT NULL,
  warehouseId VARCHAR(36) NOT NULL,
  locationId VARCHAR(36) NOT NULL DEFAULT '',
  onHand DECIMAL(18,3) NOT NULL DEFAULT 0,
  reserved DECIMAL(18,3) NOT NULL DEFAULT 0,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (productId, warehouseId, locationId),
  FOREIGN KEY (productId) REFERENCES stock_products(id) ON DELETE CASCADE,
  FOREIGN KEY (warehouseId) REFERENCES warehouses(id) ON DELETE CASCADE,
  INDEX idx_sbal_warehouse (warehouseId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
