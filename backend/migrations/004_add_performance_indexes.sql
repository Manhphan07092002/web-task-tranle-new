-- Migration 004: Add Performance Indexes
-- Adds critical indexes for common query patterns
-- Safe to run on existing databases (IF NOT EXISTS checks)

-- Tasks table indexes (most queried table)
CREATE INDEX IF NOT EXISTS idx_tasks_dept_status ON tasks(department, status);
CREATE INDEX IF NOT EXISTS idx_tasks_status_duedate ON tasks(status, dueDate);
CREATE INDEX IF NOT EXISTS idx_tasks_createdby ON tasks(createdBy);

-- Contracts table indexes
CREATE INDEX IF NOT EXISTS idx_contracts_status_deleted ON contracts(status, isDeleted);
CREATE INDEX IF NOT EXISTS idx_contracts_dept ON contracts(department);

-- Task assignees (ownership checks)
CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(userId);

-- Reports (approval workflows)
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_dept ON reports(department);

-- Revenue reports
CREATE INDEX IF NOT EXISTS idx_revenue_status ON revenue_reports(status);
CREATE INDEX IF NOT EXISTS idx_revenue_dept ON revenue_reports(department);

-- Notifications (realtime queries)
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(userId, isRead);

-- Products (inventory queries)
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
