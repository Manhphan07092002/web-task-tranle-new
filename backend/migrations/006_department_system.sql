-- Migration 006: Department System & Management Levels
-- Implements organizational hierarchy and management level-based RBAC
-- Safe to run: uses IF NOT EXISTS and preserves existing data
-- ⚠️ IMPORTANT: departments table ALREADY EXISTS - we ALTER it, not CREATE new

-- ============================================================
-- PART 1: UPGRADE EXISTING DEPARTMENTS TABLE
-- ============================================================

-- Check if departments table exists (it should from DDL)
-- Current schema: id, name (UNIQUE), description, color, managerId
-- Add new columns for hierarchy and RBAC

-- Add new columns to existing departments table
ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS code VARCHAR(50) UNIQUE,
  ADD COLUMN IF NOT EXISTS parentId VARCHAR(191),
  ADD COLUMN IF NOT EXISTS level INT DEFAULT 2 COMMENT '1=BGD, 2=Main dept, 3=Sub-dept',
  ADD COLUMN IF NOT EXISTS isActive TINYINT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_dept_parent ON departments(parentId);
CREATE INDEX IF NOT EXISTS idx_dept_code ON departments(code);
CREATE INDEX IF NOT EXISTS idx_dept_active ON departments(isActive);

-- Add foreign key constraint for parent-child relationship
-- Use a stored procedure pattern to check if FK exists first
SET @fk_dept_parent_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND TABLE_NAME = 'departments'
  AND CONSTRAINT_NAME = 'fk_dept_parent'
);

SET @sql_add_fk = IF(@fk_dept_parent_exists = 0,
  'ALTER TABLE departments ADD CONSTRAINT fk_dept_parent FOREIGN KEY (parentId) REFERENCES departments(id) ON DELETE SET NULL',
  'SELECT "FK fk_dept_parent already exists" AS msg'
);

PREPARE stmt FROM @sql_add_fk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Positions table: job positions with management levels
CREATE TABLE IF NOT EXISTS positions (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  departmentId VARCHAR(36),
  managementLevel INT NOT NULL COMMENT '10=Employee, 20=Manager, 30=Deputy, 40=Director',
  description TEXT,
  isActive TINYINT DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE CASCADE,
  INDEX idx_pos_dept (departmentId),
  INDEX idx_pos_level (managementLevel),
  INDEX idx_pos_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- User positions: users can have multiple positions
CREATE TABLE IF NOT EXISTS user_positions (
  id VARCHAR(36) PRIMARY KEY,
  userId VARCHAR(36) NOT NULL,
  positionId VARCHAR(36) NOT NULL,
  isPrimary TINYINT DEFAULT 0 COMMENT '1=Primary position',
  startDate DATE,
  endDate DATE,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (positionId) REFERENCES positions(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_position (userId, positionId),
  INDEX idx_up_user (userId),
  INDEX idx_up_position (positionId),
  INDEX idx_up_primary (isPrimary)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Management scopes: Deputy Directors assigned to manage departments
CREATE TABLE IF NOT EXISTS management_scopes (
  id VARCHAR(36) PRIMARY KEY,
  userId VARCHAR(36) NOT NULL,
  departmentId VARCHAR(36) NOT NULL,
  scopeType VARCHAR(50) NOT NULL DEFAULT 'FULL' COMMENT 'FULL, READ_ONLY, APPROVAL_ONLY',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_dept_scope (userId, departmentId),
  INDEX idx_ms_user (userId),
  INDEX idx_ms_dept (departmentId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PART 2: ALTER USERS TABLE
-- ============================================================

-- Add new columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS managementLevel INT DEFAULT 10
    COMMENT '10=Employee, 20=Manager, 30=Deputy, 40=Director, 99=Admin',
  ADD COLUMN IF NOT EXISTS primaryDepartmentId VARCHAR(36),
  ADD COLUMN IF NOT EXISTS employeeCode VARCHAR(50);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_management_level ON users(managementLevel);
CREATE INDEX IF NOT EXISTS idx_users_dept ON users(primaryDepartmentId);
CREATE INDEX IF NOT EXISTS idx_users_employee_code ON users(employeeCode);

-- Add foreign key (only if column exists and FK doesn't exist yet)
SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND CONSTRAINT_NAME = 'fk_users_dept');

SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE users ADD CONSTRAINT fk_users_dept FOREIGN KEY (primaryDepartmentId) REFERENCES departments(id) ON DELETE SET NULL',
  'SELECT "FK already exists" AS msg'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================
-- PART 3: SEED/UPDATE DEPARTMENTS
-- ============================================================

-- Insert Ban Giám Đốc (root department) if not exists
INSERT IGNORE INTO departments (id, code, name, level, isActive, description) VALUES
('dept-bgd', 'BGD', 'Ban Giám Đốc', 1, 1, 'Ban điều hành công ty');

-- Update existing departments OR insert if not exists
-- Using INSERT ... ON DUPLICATE KEY UPDATE pattern

INSERT INTO departments (id, code, name, parentId, level, isActive, description) VALUES
('dept-ke-toan', 'KT', 'Phòng Kế Toán', 'dept-bgd', 2, 1, 'Quản lý tài chính, kế toán, công nợ')
ON DUPLICATE KEY UPDATE
  code = VALUES(code),
  parentId = VALUES(parentId),
  level = VALUES(level),
  description = VALUES(description);

INSERT INTO departments (id, code, name, parentId, level, isActive, description) VALUES
('dept-hcns', 'HCNS', 'Phòng Hành Chính - Nhân Sự', 'dept-bgd', 2, 1, 'Quản lý nhân sự, hành chính, văn phòng')
ON DUPLICATE KEY UPDATE
  code = VALUES(code),
  parentId = VALUES(parentId),
  level = VALUES(level),
  description = VALUES(description);

INSERT INTO departments (id, code, name, parentId, level, isActive, description) VALUES
('dept-kinh-doanh', 'KD', 'Phòng Kinh Doanh', 'dept-bgd', 2, 1, 'Bán hàng, chăm sóc khách hàng, lead generation')
ON DUPLICATE KEY UPDATE
  code = VALUES(code),
  parentId = VALUES(parentId),
  level = VALUES(level),
  description = VALUES(description);

INSERT INTO departments (id, code, name, parentId, level, isActive, description) VALUES
('dept-du-an', 'DA', 'Phòng Dự Án', 'dept-bgd', 2, 1, 'Quản lý dự án, thi công, giám sát')
ON DUPLICATE KEY UPDATE
  code = VALUES(code),
  parentId = VALUES(parentId),
  level = VALUES(level),
  description = VALUES(description);

INSERT INTO departments (id, code, name, parentId, level, isActive, description) VALUES
('dept-ky-thuat', 'KTBH', 'Phòng Kỹ Thuật - Bảo Hành', 'dept-bgd', 2, 1, 'Thiết kế kỹ thuật, bảo hành, O&M')
ON DUPLICATE KEY UPDATE
  code = VALUES(code),
  parentId = VALUES(parentId),
  level = VALUES(level),
  description = VALUES(description);

INSERT INTO departments (id, code, name, parentId, level, isActive, description) VALUES
('dept-marketing', 'MKT', 'Phòng Marketing', 'dept-bgd', 2, 1, 'Marketing, truyền thông, xây dựng thương hiệu')
ON DUPLICATE KEY UPDATE
  code = VALUES(code),
  parentId = VALUES(parentId),
  level = VALUES(level),
  description = VALUES(description);

INSERT INTO departments (id, code, name, parentId, level, isActive, description) VALUES
('dept-kho', 'KHO', 'Kho Vận', 'dept-bgd', 2, 1, 'Quản lý kho, xuất nhập tồn, logistics')
ON DUPLICATE KEY UPDATE
  code = VALUES(code),
  parentId = VALUES(parentId),
  level = VALUES(level),
  description = VALUES(description);

INSERT INTO departments (id, code, name, parentId, level, isActive, description) VALUES
('dept-mua-hang', 'MH', 'Mua Hàng', 'dept-bgd', 2, 1, 'Mua sắm, đàm phán nhà cung cấp')
ON DUPLICATE KEY UPDATE
  code = VALUES(code),
  parentId = VALUES(parentId),
  level = VALUES(level),
  description = VALUES(description);

-- ============================================================
-- PART 4: MIGRATE EXISTING DATA
-- ============================================================

-- Map users.department (old string field) to primaryDepartmentId (new FK)
-- Strategy: Match by department name (departments.name) to get department ID
-- ⚠️ users.department is VARCHAR, not FK yet - keep it for backward compatibility

UPDATE users u
SET u.primaryDepartmentId = (
  SELECT d.id FROM departments d
  WHERE d.name = u.department
  LIMIT 1
)
WHERE u.department IS NOT NULL
  AND u.department != ''
  AND u.primaryDepartmentId IS NULL;

-- Fallback: Try matching by partial name if exact match failed
UPDATE users u
SET u.primaryDepartmentId = (
  SELECT d.id FROM departments d
  WHERE u.department LIKE CONCAT('%', d.name, '%')
     OR d.name LIKE CONCAT('%', u.department, '%')
  LIMIT 1
)
WHERE u.department IS NOT NULL
  AND u.department != ''
  AND u.primaryDepartmentId IS NULL;

-- Set managementLevel based on current role
-- Admin = 99 (system level, no business approval)
-- Director = 40 (company-wide)
-- Manager = 20 (department-wide)
-- Employee = 10 (own data only)
UPDATE users
SET managementLevel = CASE role
  WHEN 'Admin' THEN 99
  WHEN 'Director' THEN 40
  WHEN 'Deputy Director' THEN 30
  WHEN 'Manager' THEN 20
  WHEN 'Employee' THEN 10
  ELSE 10
END
WHERE managementLevel IS NULL OR managementLevel = 10;

-- Generate employee codes for users without one
-- Format: EMP-YYYYMMDD-### based on creation order
UPDATE users
SET employeeCode = CONCAT('EMP-', DATE_FORMAT(NOW(), '%Y%m%d'), '-', LPAD(SUBSTRING(id, 1, 3), 3, '0'))
WHERE employeeCode IS NULL OR employeeCode = '';

-- ============================================================
-- PART 5: CREATE DEFAULT POSITIONS
-- ============================================================

-- Create standard positions for each department
INSERT IGNORE INTO positions (id, code, name, departmentId, managementLevel, isActive) VALUES
-- Ban Giám Đốc
('pos-director', 'GD', 'Giám Đốc', 'dept-bgd', 40, 1),
('pos-deputy', 'PGD', 'Phó Giám Đốc', 'dept-bgd', 30, 1),

-- Phòng Kế Toán
('pos-kt-manager', 'TP-KT', 'Trưởng Phòng Kế Toán', 'dept-ke-toan', 20, 1),
('pos-kt-staff', 'NV-KT', 'Nhân Viên Kế Toán', 'dept-ke-toan', 10, 1),

-- Phòng HCNS
('pos-hcns-manager', 'TP-HCNS', 'Trưởng Phòng HCNS', 'dept-hcns', 20, 1),
('pos-hcns-staff', 'NV-HCNS', 'Nhân Viên HCNS', 'dept-hcns', 10, 1),

-- Phòng Kinh Doanh
('pos-kd-manager', 'TP-KD', 'Trưởng Phòng Kinh Doanh', 'dept-kinh-doanh', 20, 1),
('pos-kd-staff', 'NV-KD', 'Nhân Viên Kinh Doanh', 'dept-kinh-doanh', 10, 1),

-- Phòng Dự Án
('pos-da-manager', 'TP-DA', 'Trưởng Phòng Dự Án', 'dept-du-an', 20, 1),
('pos-da-pm', 'PM', 'Quản Lý Dự Án', 'dept-du-an', 10, 1),
('pos-da-staff', 'NV-DA', 'Nhân Viên Dự Án', 'dept-du-an', 10, 1),

-- Phòng Kỹ Thuật - Bảo Hành
('pos-kt-manager', 'TP-KTBH', 'Trưởng Phòng Kỹ Thuật', 'dept-ky-thuat', 20, 1),
('pos-kt-engineer', 'KS', 'Kỹ Sư', 'dept-ky-thuat', 10, 1),
('pos-kt-tech', 'KTV', 'Kỹ Thuật Viên', 'dept-ky-thuat', 10, 1),

-- Phòng Marketing
('pos-mkt-manager', 'TP-MKT', 'Trưởng Phòng Marketing', 'dept-marketing', 20, 1),
('pos-mkt-staff', 'NV-MKT', 'Nhân Viên Marketing', 'dept-marketing', 10, 1),

-- Kho Vận
('pos-kho-manager', 'TP-KHO', 'Trưởng Kho', 'dept-kho', 20, 1),
('pos-kho-staff', 'NV-KHO', 'Thủ Kho', 'dept-kho', 10, 1),

-- Mua Hàng
('pos-mh-manager', 'TP-MH', 'Trưởng Phòng Mua Hàng', 'dept-mua-hang', 20, 1),
('pos-mh-staff', 'NV-MH', 'Nhân Viên Mua Hàng', 'dept-mua-hang', 10, 1);

-- ============================================================
-- PART 6: VERIFICATION QUERIES (for manual check)
-- ============================================================

-- Check department structure
-- SELECT d.name, d.code, d.level, p.name as parent
-- FROM departments d
-- LEFT JOIN departments p ON d.parentId = p.id
-- ORDER BY d.level, d.name;

-- Check users with new fields
-- SELECT u.fullName, u.email, u.role, u.managementLevel, d.name as department, u.employeeCode
-- FROM users u
-- LEFT JOIN departments d ON u.primaryDepartmentId = d.id
-- LIMIT 10;

-- Check position count
-- SELECT d.name, COUNT(p.id) as position_count
-- FROM departments d
-- LEFT JOIN positions p ON d.id = p.departmentId
-- GROUP BY d.id, d.name
-- ORDER BY d.name;
