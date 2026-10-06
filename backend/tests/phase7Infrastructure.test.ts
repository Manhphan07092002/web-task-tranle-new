import { describe, expect, it, vi } from 'vitest';
import { runVersionedMigration, withMigrationLock } from '../utils/dbMigrations.js';
import { notificationDedupeKey } from '../utils/notificationDedupe.js';

describe('database migration safety', () => {
  it('releases its MySQL advisory lock after successful migrations', async () => {
    const db = { get: vi.fn().mockResolvedValueOnce({ acquired: 1 }).mockResolvedValueOnce({ released: 1 }) };
    const result = await withMigrationLock(db, async () => 'complete');
    expect(result).toBe('complete');
    expect(db.get).toHaveBeenNthCalledWith(1, 'SELECT GET_LOCK(?, 30) AS acquired', ['tranle_tasks_schema_migrations']);
    expect(db.get).toHaveBeenNthCalledWith(2, 'SELECT RELEASE_LOCK(?) AS released', ['tranle_tasks_schema_migrations']);
  });

  it('does not execute work when the advisory lock could not be acquired', async () => {
    const db = { get: vi.fn().mockResolvedValue({ acquired: 0 }) };
    const migrate = vi.fn();
    await expect(withMigrationLock(db, migrate)).rejects.toThrow('Could not acquire database migration lock');
    expect(migrate).not.toHaveBeenCalled();
    expect(db.get).toHaveBeenCalledTimes(1);
  });

  it('releases its lock if a migration throws', async () => {
    const db = { get: vi.fn().mockResolvedValueOnce({ acquired: 1 }).mockResolvedValueOnce({ released: 1 }) };
    await expect(withMigrationLock(db, async () => { throw new Error('migration failed'); })).rejects.toThrow('migration failed');
    expect(db.get).toHaveBeenCalledTimes(2);
  });

  it('does not run a version already recorded and records only after a successful apply', async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const alreadyAppliedDb = { get: vi.fn().mockResolvedValue({ version: 1 }), run: vi.fn() };
    await expect(runVersionedMigration(alreadyAppliedDb, 1, 'schema', apply)).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(alreadyAppliedDb.run).not.toHaveBeenCalled();

    const db = { get: vi.fn().mockResolvedValue(undefined), run: vi.fn().mockResolvedValue({ changes: 1 }) };
    await expect(runVersionedMigration(db, 2, 'dedupe', apply)).resolves.toBe(true);
    expect(db.run).toHaveBeenCalledWith('INSERT INTO _migrations (version, name, appliedAt) VALUES (?, ?, ?)', [2, 'dedupe', expect.any(String)]);
  });

  it('does not record a failed migration so an idempotent migration can retry', async () => {
    const db = { get: vi.fn().mockResolvedValue(undefined), run: vi.fn() };
    await expect(runVersionedMigration(db, 3, 'failure', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    expect(db.run).not.toHaveBeenCalled();
  });
});

describe('notification dedupe keys', () => {
  it('is deterministic for the same recipient/event and unique for separate events', () => {
    const first = notificationDedupeKey('user-1', 'note_reminder', 'note-1');
    expect(first).toHaveLength(64);
    expect(notificationDedupeKey('user-1', 'note_reminder', 'note-1')).toBe(first);
    expect(notificationDedupeKey('user-2', 'note_reminder', 'note-1')).not.toBe(first);
    expect(notificationDedupeKey('user-1', 'note_reminder', null)).toBeNull();
  });
});
