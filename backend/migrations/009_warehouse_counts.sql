-- Migration 009: Stock count periods & items (Kỳ kiểm kê + Biên bản thừa/thiếu)
-- Safe to run: uses IF NOT EXISTS / IF NOT EXISTS patterns

CREATE TABLE IF NOT EXISTS stock_count_periods (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  month VARCHAR(7) NOT NULL,
  location VARCHAR(100),
  status ENUM('planned', 'in_progress', 'completed', 'cancelled') DEFAULT 'planned',
  assignedTo VARCHAR(36),
  departmentId VARCHAR(36) DEFAULT 'dept-kho',
  notes TEXT,
  createdBy VARCHAR(36) NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (assignedTo) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_scp_month (month),
  INDEX idx_scp_status (status),
  INDEX idx_scp_dept (departmentId),
  INDEX idx_scp_assigned (assignedTo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_count_items (
  id VARCHAR(36) PRIMARY KEY,
  periodId VARCHAR(36) NOT NULL,
  productCode VARCHAR(50) NOT NULL,
  productName VARCHAR(255) NOT NULL,
  systemQty DECIMAL(10,2) NOT NULL DEFAULT 0,
  countedQty DECIMAL(10,2) NULL,
  unit VARCHAR(20) DEFAULT 'pcs',
  status ENUM('pending', 'counted', 'resolved') DEFAULT 'pending',
  resolution TEXT,
  resolvedBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (periodId) REFERENCES stock_count_periods(id) ON DELETE CASCADE,
  FOREIGN KEY (resolvedBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_sci_period (periodId),
  INDEX idx_sci_status (status),
  INDEX idx_sci_product (productCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
