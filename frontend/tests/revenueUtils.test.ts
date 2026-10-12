import { describe, expect, it } from 'vitest';
import type { RevenueReport } from '../services/revenueService.js';
import {
  fmtMoney,
  formatCompactVND,
  makeYAxisFormatter,
  getWeekRange,
  getMonthRange,
  getWeekInfo,
  getContractVatRate,
  computeDeliveredValue,
  getAssignees,
  getDeduplicatedTotals,
  toCsvContent,
  buildInvoicedCsv,
  buildHistoryCsv,
  getTodayParts,
} from '../pages/Revenue/revenueUtils.js';

function report(overrides: Partial<RevenueReport>): RevenueReport {
  return {
    id: 'r1', title: 'T1', reportType: 'monthly', periodStart: '2026-10-01',
    periodEnd: '2026-10-31', content: '[]', totalPreTax: 0, totalDelivered: 0,
    totalCumulative: 0, authorId: 'u1', department: 'KD', status: 'Approved',
    createdAt: '2026-10-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('fmtMoney / formatCompactVND', () => {
  it('formats full VND', () => {
    expect(fmtMoney(1000000)).toBe('1.000.000 ₫');
  });
  it('compacts billions and millions', () => {
    expect(formatCompactVND(2500000000)).toContain('tỷ');
    expect(formatCompactVND(1500000)).toContain('tr');
    expect(formatCompactVND(500000)).toBe('500.000 ₫');
  });
});

describe('makeYAxisFormatter', () => {
  it('adapts to data scale', () => {
    expect(makeYAxisFormatter([{ value: 2000000000 }])(1000000000)).toBe('1.0Tỷ');
    expect(makeYAxisFormatter([{ value: 5000000 }])(2000000)).toBe('2.0Tr');
    expect(makeYAxisFormatter([{ value: 5000 }])(2400)).toBe('2K');
    expect(makeYAxisFormatter([{ value: 500 }])(250)).toBe('250đ');
  });
});

describe('getWeekRange / getMonthRange', () => {
  it('returns ordered ISO ranges', () => {
    const w = getWeekRange();
    expect(w.start <= w.end).toBe(true);
    expect(new Date(w.start).getDay()).toBe(1); // Monday
    const m = getMonthRange();
    expect(m.start.endsWith('-01')).toBe(true);
    expect(m.start <= m.end).toBe(true);
  });
});

describe('getWeekInfo', () => {
  it('resolves monday and label consistently', () => {
    const info = getWeekInfo('2026-10-14'); // Wednesday
    expect(info.mondayStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(info.label).toBe(`Tuần ${info.weekNum} (${info.weekRange})`);
    expect(info.weekRange).toContain('/');
  });
});

describe('getTodayParts', () => {
  it('reflects the actual current date', () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const expectedStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const parts = getTodayParts();
    expect(parts.todayStr).toBe(expectedStr);
    expect(parts.todayMonth).toBe(expectedStr.substring(0, 7));
    expect(parts.todayYear).toBe(now.getFullYear());
    expect(parts.todayWeek.label).toContain('Tuần ');
  });
});

describe('getContractVatRate', () => {
  it('weights VAT by product totals', () => {
    const c = { products: [{ total: 100, vatRate: 10 }, { total: 100, vatRate: 8 }] };
    expect(getContractVatRate(c)).toBe(9);
  });
  it('falls back to contract vatRate then 8', () => {
    expect(getContractVatRate({ vatRate: 5 })).toBe(5);
    expect(getContractVatRate({})).toBe(8);
    expect(getContractVatRate({ products: 'invalid json' })).toBe(8);
  });
});

describe('computeDeliveredValue', () => {
  it('sums invoiced quantities by unit price', () => {
    const c = { products: [{ invoicedQuantity: 2, unitPrice: 100 }, { exportedQuantity: 3, unitPrice: 50 }] };
    expect(computeDeliveredValue(c)).toBe(350);
  });
  it('parses JSON products and falls back to preTaxValue', () => {
    expect(computeDeliveredValue({ products: JSON.stringify([{ quantity: 4, unitPrice: 25 }]) })).toBe(100);
    expect(computeDeliveredValue({ preTaxValue: 777 })).toBe(777);
    expect(computeDeliveredValue({})).toBe(0);
  });
});

describe('getAssignees', () => {
  it('dedupes assignees and tolerates bad JSON', () => {
    const r = report({ content: JSON.stringify([{ assignee: 'a' }, { assignee: 'b' }, { assignee: 'a' }, {}]) });
    expect(getAssignees(r)).toEqual(['a', 'b']);
    expect(getAssignees(report({ content: 'nope' }))).toEqual([]);
  });
});

describe('getDeduplicatedTotals', () => {
  it('counts each contract once using the latest report', () => {
    const oldR = report({
      id: 'old', createdAt: '2026-09-01T00:00:00.000Z',
      content: JSON.stringify([{ contractId: 'c1', deliveredMonth: 100, preTaxValue: 1000 }]),
    });
    const newR = report({
      id: 'new', createdAt: '2026-10-01T00:00:00.000Z',
      content: JSON.stringify([{ contractId: 'c1', deliveredMonth: 300, preTaxValue: 1000 }]),
    });
    const totals = getDeduplicatedTotals([oldR, newR]);
    expect(totals.totalDelivered).toBe(300);
    expect(totals.totalPreTax).toBe(1000);
    expect(totals.maxReport).toBe(300);
  });
  it('falls back to report totals on unparsable content', () => {
    const totals = getDeduplicatedTotals([report({ id: 'x', content: 'bad', totalDelivered: 50, totalPreTax: 60 })]);
    expect(totals).toEqual({ totalDelivered: 50, totalPreTax: 60, maxReport: 50 });
  });
});

describe('CSV builders', () => {
  it('escapes commas, quotes and newlines', () => {
    const csv = toCsvContent(['a', 'b'], [['x,y', 'q"q'], ['l1\nl2', null]]);
    expect(csv).toBe('a,b\n"x,y","q""q"\n"l1\nl2",');
  });
  it('builds invoiced and history CSVs with headers', () => {
    const inv = buildInvoicedCsv([{ contractNumber: 'C1', deliveredValue: 10 }]);
    expect(inv.split('\n')).toHaveLength(2);
    expect(inv.startsWith('Số Hợp đồng')).toBe(true);
    const hist = buildHistoryCsv(
      [report({ reportType: 'weekly', generationMode: 'automatic', status: 'Approved' })],
      [{ id: 'u1', name: 'An' }]
    );
    expect(hist).toContain('Tuần');
    expect(hist).toContain('Tự động');
    expect(hist).toContain('Đã duyệt');
    expect(hist).toContain('An');
  });
});
