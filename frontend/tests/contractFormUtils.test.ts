import { describe, expect, it } from 'vitest';
import type { ContractProduct } from '../services/contractService.js';
import {
  statusToStepIndex,
  isChecklistComplete,
  filterAccountantUsers,
  mapInputContractProducts,
  mapWarehouseProducts,
  summarizeVatByRate,
} from '../pages/Contracts/contractUtils.js';

describe('statusToStepIndex', () => {
  it('maps pipeline statuses', () => {
    expect(statusToStepIndex('draft')).toBe(0);
    expect(statusToStepIndex('pending')).toBe(1);
    expect(statusToStepIndex('in_progress')).toBe(2);
    expect(statusToStepIndex('completed')).toBe(3);
    expect(statusToStepIndex('cancelled')).toBe(-1);
    expect(statusToStepIndex(undefined)).toBe(-1);
  });
});

describe('isChecklistComplete', () => {
  it('requires every checklist item', () => {
    expect(isChecklistComplete(undefined)).toBe(false);
    expect(isChecklistComplete({})).toBe(false);
    expect(isChecklistComplete({ hoaDon: true })).toBe(false);
  });
});

describe('filterAccountantUsers', () => {
  const users = [
    { id: 'kt', department: 'Phòng Kế Toán', role: 'Staff' },
    { id: 'fin', department: 'Finance Dept', role: 'Staff' },
    { id: 'acc', department: 'Sales', role: 'Accountant' },
    { id: 'sale', department: 'Sales', role: 'Staff' },
  ];
  it('matches finance/accounting staff', () => {
    expect(filterAccountantUsers(users).map(u => u.id).sort()).toEqual(['acc', 'fin', 'kt']);
  });
  it('falls back to all users when nobody matches', () => {
    const others = [{ id: 'a', department: 'IT', role: 'Dev' }];
    expect(filterAccountantUsers(others)).toEqual(others);
  });
  it('returns empty for undefined', () => {
    expect(filterAccountantUsers(undefined)).toEqual([]);
  });
});

describe('mapInputContractProducts', () => {
  const catalog = [
    { id: 'p1', name: 'Pin 550W', importCode: 'HD1-1', salePrice: 200 },
    { id: 'p2', name: 'Inverter', importCode: 'OTHER', salePrice: 0 },
  ];
  const products = [
    { name: 'Pin 550W', unit: 'tấm', origin: 'CN', quantity: 2, unitPrice: 150, total: 300 },
    { name: 'Inverter', unit: 'cái', origin: 'CN', quantity: 1, unitPrice: 500, total: 500 },
    { name: 'Lạ', unit: '', origin: '', quantity: 1, unitPrice: 99, total: 99 },
  ] as ContractProduct[];
  it('uses sale price on exact import-code match, falls back otherwise', () => {
    const { items, triggeredFallback } = mapInputContractProducts(products, 'HD1', catalog);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ unitPrice: 200, total: 400, isBuyingPriceFallback: false, sourceProductId: 'p1', importCode: 'HD1-1' });
    expect(items[1]).toMatchObject({ unitPrice: 500, isBuyingPriceFallback: true });
    expect(items[2]).toMatchObject({ unitPrice: 99, isBuyingPriceFallback: true, importCode: 'HD1-3' });
    expect(triggeredFallback).toBe(true);
  });
  it('reports no fallback when everything has a sale price', () => {
    const { triggeredFallback } = mapInputContractProducts([products[0]], 'HD1', catalog);
    expect(triggeredFallback).toBe(false);
  });
});

describe('mapWarehouseProducts', () => {
  const contracts = [
    { contractType: 'output', status: 'completed', products: [{ name: 'Pin 550W', unitPrice: 210 }] },
    { contractType: 'output', status: 'cancelled', products: [{ name: 'Pin 550W', unitPrice: 999 }] },
  ];
  it('takes price from matching output contracts, skips cancelled', () => {
    const [line] = mapWarehouseProducts(
      [{ product: { id: 'p1', name: 'Pin 550W', unit: 'tấm', salePrice: 200, importCode: 'X' }, quantity: 3 }],
      contracts
    );
    expect(line).toMatchObject({ unitPrice: 210, total: 630, exportedQuantity: 3 });
  });
  it('falls back to product sale/default price', () => {
    const [line] = mapWarehouseProducts(
      [{ product: { id: 'p9', name: 'Khác', unit: 'cái', defaultPrice: 50, importCode: 'Y' }, quantity: 2 }],
      contracts
    );
    expect(line).toMatchObject({ unitPrice: 50, total: 100 });
  });
});

describe('summarizeVatByRate', () => {
  it('groups VAT by rate and defaults to [8] when empty', () => {
    expect(summarizeVatByRate([])).toEqual({ rates: [8], amounts: {} });
    const { rates, amounts } = summarizeVatByRate([
      { vatRate: 10, total: 100 },
      { total: 200 },
      { vatRate: 10, total: 50 },
    ]);
    expect(rates).toEqual([8, 10]);
    expect(amounts[10]).toBe(15);
    expect(amounts[8]).toBe(16);
  });
});
