# Database rules

TranLe Tasks uses MySQL 8 only (`mysql2` via `DATABASE_URL`). There is no SQLite/PostgreSQL path (`backend/db.ts` / `backend/db_pg.ts` were removed).

- Inspect `backend/db_mysql.ts` before making storage assumptions.
- Preserve existing records during schema changes.
- Prefer deterministic/idempotent migrations (`runVersionedMigration` + `ensureColumn`).
- Check indexes, foreign keys, uniqueness and nullability.
- Do not reset the production database.
- Do not add columns via `CREATE TABLE IF NOT EXISTS` on existing tables — use `ensureColumn`/ALTER (see v24/v25 reconciliations).
- When changing `db_mysql.ts`, inspect initialization, migration and seed behavior.
- When changing schema, update affected backend types, queries and tests.
- For large-data or concurrency concerns, explicitly assess index and lock behavior (migration lock via `withMigrationLock`).
