-- Migration 007: Warehouse Department System
-- Implements inventory management and warehouse transactions for Kho Vận department
-- Safe to run: uses IF NOT EXISTS

-- ============================================================
-- PART 1: INVENTORY TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory (
  id VARCHAR(36) PRIMARY KEY,
  productCode VARCHAR(50) NOT NULL,
  productName VARCHAR(255) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit VARCHAR(20) DEFAULT 'pcs',
  warehouseLocation VARCHAR(100),
  minStockLevel DECIMAL(10,2) DEFAULT 0,
  maxStockLevel DECIMAL(10,2) DEFAULT 0,
  departmentId VARCHAR(36) DEFAULT 'dept-kho',
  lastStockTake DATETIME,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE SET NULL,
  INDEX idx_inventory_dept (departmentId),
  INDEX idx_inventory_product (productCode),
  INDEX idx_inventory_location (warehouseLocation)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PART 2: WAREHOUSE TRANSACTIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS warehouse_transactions (
  id VARCHAR(36) PRIMARY KEY,
  transactionCode VARCHAR(50) UNIQUE NOT NULL,
  type ENUM('IN', 'OUT', 'ADJUST', 'TRANSFER') NOT NULL,
  productCode VARCHAR(50) NOT NULL,
  productName VARCHAR(255) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  unit VARCHAR(20) DEFAULT 'pcs',
  fromLocation VARCHAR(100),
  toLocation VARCHAR(100),
  requestedBy VARCHAR(36) NOT NULL,
  approvedBy VARCHAR(36),
  status ENUM('pending', 'approved', 'completed', 'rejected') DEFAULT 'pending',
  departmentId VARCHAR(36) DEFAULT 'dept-kho',
  notes TEXT,
  referenceDoc VARCHAR(100),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (requestedBy) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (approvedBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_wh_trans_dept (departmentId),
  INDEX idx_wh_trans_status (status),
  INDEX idx_wh_trans_type (type),
  INDEX idx_wh_trans_code (transactionCode),
  INDEX idx_wh_trans_product (productCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PART 3: SEED SAMPLE INVENTORY DATA
-- ============================================================

INSERT IGNORE INTO inventory (id, productCode, productName, quantity, unit, warehouseLocation, minStockLevel, maxStockLevel, departmentId) VALUES
('inv-001', 'PANEL-MONO-450W', 'Tấm pin mặt trời Mono 450W', 500.00, 'pcs', 'Khu A-Giá 01', 100.00, 1000.00, 'dept-kho'),
('inv-002', 'INVERTER-5KW', 'Inverter hòa lưới 5KW', 50.00, 'pcs', 'Khu B-Giá 03', 10.00, 100.00, 'dept-kho'),
('inv-003', 'CABLE-4MM', 'Dây cáp DC 4mm', 2000.00, 'm', 'Khu C-Giá 05', 500.00, 5000.00, 'dept-kho'),
('inv-004', 'MOUNTING-KIT', 'Bộ giá đỡ tấm pin', 100.00, 'set', 'Khu A-Giá 02', 20.00, 200.00, 'dept-kho'),
('inv-005', 'CONNECTOR-MC4', 'Đầu nối MC4', 500.00, 'pcs', 'Khu C-Giá 07', 100.00, 1000.00, 'dept-kho');

-- ============================================================
-- PART 4: VERIFICATION QUERIES (for manual check)
-- ============================================================

-- Check inventory count
-- SELECT COUNT(*) as inventory_items, SUM(quantity) as total_quantity FROM inventory;

-- Check warehouse transactions
-- SELECT COUNT(*) as total_transactions,
--        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
--        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count
-- FROM warehouse_transactions;

-- Check inventory by location
-- SELECT warehouseLocation, COUNT(*) as item_count, SUM(quantity) as total_qty
-- FROM inventory
-- GROUP BY warehouseLocation
-- ORDER BY warehouseLocation;
