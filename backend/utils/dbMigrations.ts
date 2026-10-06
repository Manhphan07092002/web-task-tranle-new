const MIGRATION_LOCK_NAME = 'tranle_tasks_schema_migrations';

export async function withMigrationLock<T>(db: any, migrate: () => Promise<T>): Promise<T> {
  const lock = await db.get('SELECT GET_LOCK(?, 30) AS acquired', [MIGRATION_LOCK_NAME]);
  if (Number(lock?.acquired) !== 1) throw new Error('Could not acquire database migration lock');

  try {
    return await migrate();
  } finally {
    await db.get('SELECT RELEASE_LOCK(?) AS released', [MIGRATION_LOCK_NAME]);
  }
}

export async function runVersionedMigration(
  db: any,
  version: number,
  name: string,
  apply: () => Promise<void>,
): Promise<boolean> {
  const existing = await db.get('SELECT version FROM _migrations WHERE version = ?', [version]);
  if (existing) return false;

  // MySQL DDL implicitly commits, so each step must itself be restart-safe.
  // The version row is written only after every operation succeeds.
  await apply();
  await db.run('INSERT INTO _migrations (version, name, appliedAt) VALUES (?, ?, ?)', [version, name, new Date().toISOString()]);
  return true;
}
