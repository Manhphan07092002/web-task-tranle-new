-- Migration 005: Drop Legacy Authentication Columns
-- Removes unused columns from security audit refactoring (commit 8515ee3)
-- Safe to run: these columns are no longer used by the application

-- Drop legacy auto-lock columns (replaced by manual isLocked flag)
ALTER TABLE users DROP COLUMN IF EXISTS failedLogins;
ALTER TABLE users DROP COLUMN IF EXISTS lockedUntil;
