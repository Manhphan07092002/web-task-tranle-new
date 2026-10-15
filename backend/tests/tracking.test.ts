import { describe, expect, it } from 'vitest';
import { isTrackingType, resolveTracking } from '../utils/tracking.js';

describe('resolveTracking', () => {
  it.each([['SERIAL', 'SERIAL'], ['LOT', 'LOT'], ['QUANTITY', 'QUANTITY']] as const)(
    'keeps %s', (input, expected) => {
      expect(resolveTracking(input)).toBe(expected);
    }
  );
  it.each([['NONE'], [''], [undefined], [null], ['SERIALX'], [123]])(
    'falls back to QUANTITY for %s',
    (input) => {
      expect(resolveTracking(input)).toBe('QUANTITY');
    }
  );
  it('validates enum values', () => {
    expect(isTrackingType('SERIAL')).toBe(true);
    expect(isTrackingType('NONE')).toBe(true);
    expect(isTrackingType('bogus')).toBe(false);
  });
});
