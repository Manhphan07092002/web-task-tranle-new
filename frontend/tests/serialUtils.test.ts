import { describe, expect, it } from 'vitest';
import { parseSerialList, serialMatchState } from '../services/serialUtils';

describe('parseSerialList', () => {
  it('splits by comma, semicolon and newline, trims and dedupes', () => {
    expect(parseSerialList('SN1, SN2\nSN3;SN1\n\n  ')).toEqual(['SN1', 'SN2', 'SN3']);
  });

  it('dedupes case-insensitively keeping first form', () => {
    expect(parseSerialList('sn1,SN1, Sn1 ')).toEqual(['sn1']);
  });

  it('handles empty input', () => {
    expect(parseSerialList('')).toEqual([]);
    expect(parseSerialList(null)).toEqual([]);
    expect(parseSerialList(undefined)).toEqual([]);
  });
});

describe('serialMatchState', () => {
  it('classifies empty, lot, match and mismatch', () => {
    expect(serialMatchState([], 3)).toBe('empty');
    expect(serialMatchState(['LOT9'], 5)).toBe('lot');
    expect(serialMatchState(['A'], 1)).toBe('match');
    expect(serialMatchState(['A', 'B'], 2)).toBe('match');
    expect(serialMatchState(['A'], 2)).toBe('lot');
    expect(serialMatchState(['A', 'B', 'C'], 2)).toBe('mismatch');
    expect(serialMatchState(['A', 'B'], 3)).toBe('mismatch');
  });
});
