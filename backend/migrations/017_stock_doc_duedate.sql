-- Migration 017: Document due dates (A7: Hạn xử lý, quá hạn)
-- Safe to run: uses ADD COLUMN IF NOT EXISTS

ALTER TABLE stock_documents
  ADD COLUMN IF NOT EXISTS dueDate DATE;

CREATE INDEX IF NOT EXISTS idx_sdoc_due ON stock_documents(dueDate);
