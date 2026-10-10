-- Migration 010: Transfer scope (Điều chuyển giữa các kho / ra công trường)
-- Safe to run: uses ADD COLUMN IF NOT EXISTS

ALTER TABLE warehouse_transactions
  ADD COLUMN IF NOT EXISTS transferScope VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_wh_trans_scope ON warehouse_transactions(transferScope);
