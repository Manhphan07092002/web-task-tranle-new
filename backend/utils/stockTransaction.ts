/** Keep stock checks and writes in the same transaction. Warehouse row locks
 * coordinate stock writers in separate application processes. Lock order
 * is stable (ORDER BY id); callers should pass only the warehouse ids they
 * touch so unrelated warehouses are not serialized. */
export async function beginStockTransaction(db: any, warehouseIds: string[] = []): Promise<void> {
  await db.run('START TRANSACTION');
  try {
    const ids = [...new Set((warehouseIds || []).filter(Boolean))].sort();
    if (ids.length > 0) {
      await db.all(
        `SELECT id FROM warehouses WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY id FOR UPDATE`,
        ids
      );
    } else {
      await db.all('SELECT id FROM warehouses ORDER BY id FOR UPDATE');
    }
  } catch (error) {
    await db.run('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
