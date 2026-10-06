import { describe, expect, it } from 'vitest';
import { DatabaseTransactionGate } from '../utils/dbTransactionGate.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('request-isolated database transactions', () => {
  it('holds other request queries until the owning transaction commits', async () => {
    const gate = new DatabaseTransactionGate();
    const transactionReady = deferred();
    const finishTransaction = deferred();
    const events: string[] = [];

    const transactionRequest = gate.runWithRequestContext(async () => {
      await gate.run('START TRANSACTION', async () => { events.push('begin'); });
      await gate.run('UPDATE records SET value = 1', async () => { events.push('transaction-write'); });
      transactionReady.resolve();
      await finishTransaction.promise;
      await gate.run('COMMIT', async () => { events.push('commit'); });
    });

    await transactionReady.promise;
    const otherRequest = gate.runWithRequestContext(() => gate.run('UPDATE records SET value = 2', async () => { events.push('other-write'); }));
    await Promise.resolve();
    expect(events).toEqual(['begin', 'transaction-write']);

    finishTransaction.resolve();
    await Promise.all([transactionRequest, otherRequest]);
    expect(events).toEqual(['begin', 'transaction-write', 'commit', 'other-write']);
  });

  it('releases waiting requests when a transaction rolls back', async () => {
    const gate = new DatabaseTransactionGate();
    const transactionReady = deferred();
    const finishTransaction = deferred();
    const events: string[] = [];

    const transactionRequest = gate.runWithRequestContext(async () => {
      await gate.run('BEGIN TRANSACTION', async () => { events.push('begin'); });
      transactionReady.resolve();
      await finishTransaction.promise;
      await gate.run('ROLLBACK', async () => { events.push('rollback'); });
    });

    await transactionReady.promise;
    const otherRequest = gate.runWithRequestContext(() => gate.run('SELECT 1', async () => { events.push('other-query'); }));
    finishTransaction.resolve();
    await Promise.all([transactionRequest, otherRequest]);

    expect(events).toEqual(['begin', 'rollback', 'other-query']);
  });

  it('releases waiting requests when transaction finalization fails', async () => {
    const gate = new DatabaseTransactionGate();
    const transactionReady = deferred();
    const finishTransaction = deferred();
    const transactionRequest = gate.runWithRequestContext(async () => {
      await gate.run('START TRANSACTION', async () => undefined);
      transactionReady.resolve();
      await finishTransaction.promise;
      await expect(gate.run('COMMIT', async () => { throw new Error('commit failed'); })).rejects.toThrow('commit failed');
    });

    await transactionReady.promise;
    const nextRequest = gate.runWithRequestContext(() => gate.run('SELECT 1', async () => 'done'));
    finishTransaction.resolve();
    await expect(Promise.all([transactionRequest, nextRequest])).resolves.toEqual([undefined, 'done']);
  });

  it('rejects transaction starts outside a request context and nested starts', async () => {
    const gate = new DatabaseTransactionGate();
    await expect(gate.run('START TRANSACTION', async () => undefined)).rejects.toThrow('active request context');

    await gate.runWithRequestContext(async () => {
      await gate.run('START TRANSACTION', async () => undefined);
      await expect(gate.run('START TRANSACTION', async () => undefined)).rejects.toThrow('Nested database transactions');
      await gate.run('ROLLBACK', async () => undefined);
    });
  });
});
