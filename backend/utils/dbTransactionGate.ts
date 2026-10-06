import { AsyncLocalStorage } from 'node:async_hooks';

type ActiveTransaction = {
  owner: symbol;
  done: Promise<void>;
  finish: () => void;
};

export class DatabaseTransactionGate {
  private readonly requestContext = new AsyncLocalStorage<symbol>();
  private queryQueue: Promise<void> = Promise.resolve();
  private activeTransaction: ActiveTransaction | null = null;

  runWithRequestContext<T>(callback: () => T): T {
    return this.requestContext.run(Symbol('database-request'), callback);
  }

  private async acquireQuerySlot() {
    let release!: () => void;
    const slot = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.queryQueue;
    this.queryQueue = previous.then(() => slot);
    await previous;
    return release;
  }

  private endTransaction(transaction: ActiveTransaction) {
    if (this.activeTransaction !== transaction) return;
    this.activeTransaction = null;
    transaction.finish();
  }

  async run<T>(sql: string, operation: () => Promise<T>): Promise<T> {
    const statement = sql.trim().replace(/;+$/, '').replace(/\s+/g, ' ').toUpperCase();
    const startsTransaction = statement === 'START TRANSACTION' || statement === 'BEGIN' || statement === 'BEGIN TRANSACTION';
    const endsTransaction = statement === 'COMMIT' || statement === 'ROLLBACK';
    const owner = this.requestContext.getStore();

    if (startsTransaction && !owner) {
      throw new Error('Database transactions require an active request context');
    }

    while (true) {
      const releaseSlot = await this.acquireQuerySlot();
      const active = this.activeTransaction;
      if (active && active.owner !== owner) {
        releaseSlot();
        await active.done;
        continue;
      }

      if (startsTransaction && active) {
        releaseSlot();
        throw new Error('Nested database transactions are not supported');
      }

      let started: ActiveTransaction | null = null;
      if (startsTransaction) {
        let finish!: () => void;
        const done = new Promise<void>((resolve) => { finish = resolve; });
        started = { owner: owner!, done, finish };
        this.activeTransaction = started;
      }

      try {
        const result = await operation();
        if (endsTransaction && active && active.owner === owner) this.endTransaction(active);
        return result;
      } catch (error) {
        if (started) this.endTransaction(started);
        if (endsTransaction && active && active.owner === owner) this.endTransaction(active);
        throw error;
      } finally {
        releaseSlot();
      }
    }
  }
}
