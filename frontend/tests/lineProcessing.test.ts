import { describe, expect, it } from 'vitest';
import { resolveLineProcessingMode } from '../utils/lineProcessing';

describe('line processing mode', () => {
  it('uses Serial scanning for SERIAL products on every document type', () => {
    for (const docType of ['RECEIPT', 'ISSUE', 'TRANSFER', 'RETURN']) {
      expect(resolveLineProcessingMode('SERIAL', docType)).toBe('SERIAL');
    }
  });

  it('registers lots on receipts and allocates lots on issues/transfers', () => {
    expect(resolveLineProcessingMode('LOT', 'RECEIPT')).toBe('LOT_RECEIPT');
    expect(resolveLineProcessingMode('LOT', 'ISSUE')).toBe('LOT_ISSUE');
    expect(resolveLineProcessingMode('LOT', 'TRANSFER')).toBe('LOT_ISSUE');
  });

  it('falls back to quantity confirmation for LOT returns and QUANTITY products', () => {
    expect(resolveLineProcessingMode('LOT', 'RETURN')).toBe('QUANTITY');
    expect(resolveLineProcessingMode('QUANTITY', 'RECEIPT')).toBe('QUANTITY');
    expect(resolveLineProcessingMode(undefined, 'ISSUE')).toBe('QUANTITY');
  });

  it('switches confirmed loose issues to quantity confirmation', () => {
    expect(resolveLineProcessingMode('LOT', 'ISSUE', true)).toBe('QUANTITY');
    expect(resolveLineProcessingMode('LOT', 'ISSUE', false)).toBe('LOT_ISSUE');
    expect(resolveLineProcessingMode('LOT', 'RECEIPT', true)).toBe('LOT_RECEIPT');
    expect(resolveLineProcessingMode('LOT', 'TRANSFER', true)).toBe('LOT_ISSUE');
    expect(resolveLineProcessingMode('SERIAL', 'ISSUE', true)).toBe('SERIAL');
  });
});
