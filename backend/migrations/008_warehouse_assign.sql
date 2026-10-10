-- Migration 008: Warehouse assignment & return documents
-- Adds assignee, due date, priority to warehouse transactions
-- Extends transaction type ENUM with RETURN (Trả hàng)
-- Safe to run: uses ADD COLUMN IF NOT EXISTS

ALTER TABLE warehouse_transactions
  ADD COLUMN IF NOT EXISTS assignedTo VARCHAR(36),
  ADD COLUMN IF NOT EXISTS dueDate DATETIME,
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal',
  MODIFY COLUMN type ENUM('IN', 'OUT', 'ADJUST', 'TRANSFER', 'RETURN') NOT NULL;

-- Index for "my tasks" lookups
CREATE INDEX IF NOT EXISTS idx_wh_trans_assigned ON warehouse_transactions(assignedTo);
CREATE INDEX IF NOT EXISTS idx_wh_trans_duedate ON warehouse_transactions(dueDate);
