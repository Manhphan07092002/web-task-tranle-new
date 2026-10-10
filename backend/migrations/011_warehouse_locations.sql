-- Migration 011: Warehouse location master (Kho / Khu vực / Giá kệ)
-- Safe to run: uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS warehouse_locations (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) DEFAULT 'zone',
  parentId VARCHAR(36),
  departmentId VARCHAR(36) DEFAULT 'dept-kho',
  notes TEXT,
  isActive TINYINT DEFAULT 1,
  createdBy VARCHAR(36),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_location_code (code),
  FOREIGN KEY (parentId) REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_whloc_parent (parentId),
  INDEX idx_whloc_dept (departmentId),
  INDEX idx_whloc_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
