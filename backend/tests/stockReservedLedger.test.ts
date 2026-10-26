import { describe, expect, it, vi } from 'vitest';
import { adjustReserved, RESERVED_SQL } from '../utils/stockReserved.js';

const NOW = '2026-10-26T02:00:00.000Z';

describe('adjustReserved', () => {
  it('emits the exact decrement SQL and parameter order', async () => {
    const run = vi.fn().mockResolvedValue({ changes: 1 });
    await adjustReserved(run, {
      kind: 'DECREMENT', productId: 'p1', warehouseId: 'w1', locationId: 'loc-1', delta: 4, now: NOW,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe(RESERVED_SQL.DECREMENT);
    expect(run.mock.calls[0][1]).toEqual([4, NOW, 'p1', 'w1', 'loc-1']);
  });

  it('emits the clamped decrement SQL used when consuming issue reservation links', async () => {
    const run = vi.fn().mockResolvedValue({ changes: 1 });
    await adjustReserved(run, {
      kind: 'DECREMENT_CLAMPED', productId: 'p1', warehouseId: 'w1', locationId: 'loc-1', delta: 2, now: NOW,
    });
    expect(run.mock.calls[0][0]).toBe(RESERVED_SQL.DECREMENT_CLAMPED);
    expect(run.mock.calls[0][1]).toEqual([2, NOW, 'p1', 'w1', 'loc-1']);
  });

  it('emits the hold upsert SQL with reserved in the values slot', async () => {
    const run = vi.fn().mockResolvedValue({ changes: 1 });
    await adjustReserved(run, {
      kind: 'HOLD_UPSERT', productId: 'p1', warehouseId: 'w1', locationId: 'loc-1', delta: 3, now: NOW,
    });
    expect(run.mock.calls[0][0]).toBe(RESERVED_SQL.HOLD_UPSERT);
    expect(run.mock.calls[0][1]).toEqual(['p1', 'w1', 'loc-1', 3, NOW]);
  });

  it('normalizes a missing location to the empty-string sentinel', async () => {
    for (const locationId of [null, undefined, '']) {
      const run = vi.fn().mockResolvedValue({ changes: 1 });
      await adjustReserved(run, { kind: 'DECREMENT', productId: 'p1', warehouseId: 'w1', locationId, delta: 1, now: NOW });
      expect(run.mock.calls[0][1][4]).toBe('');
    }
  });

  it('is a no-op for non-positive or non-finite deltas', async () => {
    for (const delta of [0, -1, Number.NaN]) {
      const run = vi.fn().mockResolvedValue({ changes: 1 });
      await adjustReserved(run, { kind: 'DECREMENT', productId: 'p1', warehouseId: 'w1', locationId: '', delta, now: NOW });
      expect(run).not.toHaveBeenCalled();
    }
  });

  it('defaults the timestamp when the caller does not pass one', async () => {
    const run = vi.fn().mockResolvedValue({ changes: 1 });
    await adjustReserved(run, { kind: 'DECREMENT', productId: 'p1', warehouseId: 'w1', locationId: '', delta: 1 });
    expect(Number.isNaN(Date.parse(run.mock.calls[0][1][1]))).toBe(false);
  });

  it('keeps the SQL text frozen so assertion-by-SQL tests stay valid', () => {
    expect(Object.values(RESERVED_SQL)).toMatchSnapshot();
  });
});
