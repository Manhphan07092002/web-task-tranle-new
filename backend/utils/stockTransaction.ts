/** Keep stock checks and writes in the same transaction. Warehouse row locks
 * also coordinate stock writers in separate application processes. Lock order
 * is stable; this deliberately matches the adapter's serialized write model. */
export async function beginStockTransaction(db: any): Promise<void> {
  await db.run('START TRANSACTION');
  try {
    await db.all('SELECT id FROM warehouses ORDER BY id FOR UPDATE');
  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}
