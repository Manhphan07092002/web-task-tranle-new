---
name: tranle-database
description: MySQL database safety rules.
activation: model_decision
---

Before schema changes inspect:
- `backend/db_mysql.ts`
- versioned migration conventions (`runVersionedMigration`, `ensureColumn`)
- migration/initialization behavior
- affected queries/tests

Preserve existing data.
Prefer deterministic/idempotent migrations.
Check indexes, foreign keys, uniqueness and nullability.
Do not reset production data.
Do not add columns via CREATE TABLE on existing tables; use ensureColumn/ALTER.
