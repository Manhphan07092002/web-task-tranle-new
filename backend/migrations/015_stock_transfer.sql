-- Migration 015: Transfer documents (A4)
-- toWarehouseId (destination), receiverId (NV đích), etaDate (KPI quá ETA)
-- Safe to run: uses ADD COLUMN IF NOT EXISTS

ALTER TABLE stock_documents
  ADD COLUMN IF NOT EXISTS toWarehouseId VARCHAR(36),
  ADD COLUMN IF NOT EXISTS receiverId VARCHAR(36),
  ADD COLUMN IF NOT EXISTS etaDate DATE;

CREATE INDEX IF NOT EXISTS idx_sdoc_towarehouse ON stock_documents(toWarehouseId);
CREATE INDEX IF NOT EXISTS idx_sdoc_receiver ON stock_documents(receiverId);
CREATE INDEX IF NOT EXISTS idx_sdoc_eta ON stock_documents(etaDate);
