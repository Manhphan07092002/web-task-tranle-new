import { describe, expect, it } from 'vitest';
import { stockRoutes } from '../routes/stock.js';

// Chốt bề mặt route của module kho TRƯỚC khi tách documents.ts (3.050 dòng).
// Danh sách dưới đây sinh từ chính router ngày 2026-10-26 và phải giữ nguyên
// thứ tự: thứ tự đăng ký quyết định route nào thắng khi 2 path cùng khớp.
const EXPECTED_SURFACE = [
  'GET /reports',
  'GET /reports/summary',
  'GET /balances',
  'GET /available-inventory',
  'GET /inventory/:productId/:warehouseId/details',
  'GET /partner-suggestions',
  'GET /documents',
  'GET /documents/processing-summary',
  'GET /documents/:id',
  'POST /documents/:id/cancel',
  'DELETE /documents/:id',
  'PUT /documents/:id',
  'GET /next-code',
  'POST /receipts',
  'POST /issues',
  'POST /transfers',
  'POST /returns',
  'POST /documents/:id/processing-complete',
  'POST /receipts/:id/complete',
  'POST /issues/:id/complete',
  'POST /returns/:id/complete',
  'POST /transfers/:id/ship',
  'POST /transfers/:id/receive',
  'POST /relocations',
  'POST /serials/edit',
  'POST /serials/scan',
  'POST /serials/scan-return',
  'POST /serials/scan-out',
  'POST /serials/scan-smart',
  'GET /documents/:id/progress',
  'POST /lines/:id/enable-serial',
  'POST /lines/:id/confirm-qty',
  'POST /lines/:id/confirm-no-serial',
  'POST /lots/allocate',
  'POST /lots/register',
  'GET /reservations',
  'POST /reservations',
  'POST /reservations/:id/release',
  'POST /reservations/:id/consume',
  'GET /locations',
  'POST /locations',
  'PUT /locations/:id',
  'GET /serials',
  'POST /serials',
  'PUT /serials/:id',
  'DELETE /serials/:id',
  'GET /serials/timeline/:serialNumber',
  'GET /lots/timeline/:lotId',
  'GET /bundles',
  'POST /bundles',
  'PUT /bundles/:id',
  'POST /bundles/:id/assemble',
  'POST /bundles/:id/disassemble',
  'GET /moves',
  'GET /reconciliation',
  'GET /anomalies',
  'GET /policies',
  'GET /alerts',
  'PUT /policies',
  'GET /slow',
  'GET /counts',
  'GET /counts/variances',
  'GET /counts/:id',
  'POST /counts',
  'POST /counts/:id/lines',
  'POST /counts/:id/recount',
  'POST /counts/:id/approve',
  'POST /counts/:id/cancel',
  'GET /misa-mappings',
  'POST /misa-mappings',
  'DELETE /misa-mappings/:id',
  'GET /misa-logs',
  'GET /misa-sync/queue',
  'POST /misa-sync/prepare',
  'GET /misa-reconcile',
  'POST /misa-reconcile/log',
  'GET /activity-logs',
];

function fakeDb() {
  return { all: async () => [], get: async () => undefined, run: async () => ({ changes: 1 }) };
}

function surfaceOf(router: any): string[] {
  const out: string[] = [];
  for (const layer of router.stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        if (layer.route.methods[method]) out.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
    } else if (layer.handle?.stack) {
      out.push(...surfaceOf(layer.handle));
    }
  }
  return out;
}

describe('stock route surface', () => {
  const surface = surfaceOf(stockRoutes(fakeDb()));

  it('keeps every route, method and registration order', () => {
    expect(surface).toEqual(EXPECTED_SURFACE);
  });

  it('declares the static document paths before the :id wildcard', () => {
    // Cùng GET nên nếu /documents/:id đứng trước thì "processing-summary" bị
    // hiểu là một document id và endpoint tổng hợp không bao giờ chạy.
    expect(surface.indexOf('GET /documents/processing-summary'))
      .toBeLessThan(surface.indexOf('GET /documents/:id'));
    expect(surface.indexOf('GET /documents/processing-summary'))
      .toBeLessThan(surface.indexOf('GET /documents/:id/progress'));
  });

  it('declares count variances before the :id wildcard', () => {
    expect(surface.indexOf('GET /counts/variances'))
      .toBeLessThan(surface.indexOf('GET /counts/:id'));
  });

  it('keeps the document serial routes ahead of the serial master routes', () => {
    // POST /serials/edit thuộc documents; serials.ts chỉ có POST /serials nên
    // không nuốt được, nhưng nếu ai thêm POST /serials/:id vào serials.ts thì
    // thứ tự mount trong routes/stock.ts sẽ quyết định route nào thắng.
    expect(surface.indexOf('POST /serials/edit'))
      .toBeLessThan(surface.indexOf('POST /serials'));
  });
});
