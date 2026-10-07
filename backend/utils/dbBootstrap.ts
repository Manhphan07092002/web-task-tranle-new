interface BootstrapDb {
  exec(sql: string): Promise<void>;
  get(sql: string, params?: any[]): Promise<any>;
  run(sql: string, params?: any[]): Promise<unknown>;
  runWithRequestContext<T>(callback: () => T): T;
}

// Call while holding the schema migration lock, before creating application tables.
export async function initializeDatabaseOnce(
  db: BootstrapDb,
  migrateSchema: () => Promise<void>,
  seed: () => Promise<void>,
): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _bootstrap (
      id TINYINT PRIMARY KEY,
      completed TINYINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  let state = await db.get('SELECT completed FROM _bootstrap WHERE id = 1');
  if (!state) {
    // Existing installations, even with empty tables, must never be reseeded.
    const existing = await db.get(`
      SELECT COUNT(*) AS count FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN ('users', 'roles', 'departments', 'tasks', 'system_config', '_migrations')
    `);
    state = { completed: Number(existing.count) > 0 ? 1 : 0 };
    // Persist pending state before DDL so an interrupted fresh install can retry.
    await db.run('INSERT INTO _bootstrap (id, completed) VALUES (1, ?)', [state.completed]);
  }

  await migrateSchema();
  if (Number(state.completed) === 1) return;

  await db.runWithRequestContext(async () => {
    await db.run('START TRANSACTION');
    try {
      await seed();
      await db.run('UPDATE _bootstrap SET completed = 1 WHERE id = 1');
      await db.run('COMMIT');
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  });
}
