# TranLe Database
Description: Change the MySQL data layer safely.

Steps:
1. Inspect `backend/db_mysql.ts` and existing migration conventions.
2. Identify schema/data dependencies.
3. Plan migration/backfill.
4. Preserve existing data.
5. Implement deterministically.
6. Check backward compatibility with legacy columns/tables.
7. Run relevant tests.
8. Report migration risks.
