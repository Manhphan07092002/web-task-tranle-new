import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WAREHOUSE_PERMISSIONS } from '../middleware/warehouseAuth.js';

// The Admin Panel role editor is the ONLY way to grant warehouse permissions.
// This test fails if a permission the backend checks is missing from the
// editor's catalog — the exact bug that made the module unusable: the catalog
// listed 16 permissions, none of them stock.*, so no role could ever be granted
// access and the menu/API silently depended on migration seed instead.
const here = dirname(fileURLToPath(import.meta.url));
const roleEditor = readFileSync(
  join(here, '../../frontend/pages/Admin/RoleManagement.tsx'),
  'utf8'
);

function catalogIds(): string[] {
  return [...roleEditor.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]);
}

describe('Warehouse permission catalog', () => {
  it('every permission the backend checks is grantable from the Admin Panel', () => {
    const catalog = catalogIds();
    expect(catalog.length).toBeGreaterThan(0);
    const missing = WAREHOUSE_PERMISSIONS.filter((p) => !catalog.includes(p));
    expect(missing).toEqual([]);
  });

  it('backend permissions carry no duplicates', () => {
    expect(new Set(WAREHOUSE_PERMISSIONS).size).toBe(WAREHOUSE_PERMISSIONS.length);
  });

  it('catalog groups warehouse permissions under a visible "Kho vận" group', () => {
    expect(roleEditor).toContain("group: 'Kho vận'");
  });

  it('role presets grant warehouse permissions instead of the legacy manage_warehouse-only set', () => {
    // Presets compose from WH_* constants, so resolve them before asserting.
    const consts = new Map<string, string[]>();
    for (const m of roleEditor.matchAll(/const (WH_\w+) = \[([^\]]*)\]/g)) {
      consts.set(m[1], [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    }

    const presets = [...roleEditor.matchAll(/label:\s*'([^']+)'[\s\S]*?perms:\s*\[([^\]]*)\]/g)];
    const byLabel = new Map(presets.map((m) => [m[1], m[2]]));

    const resolve = (label: string): string[] => {
      const raw = byLabel.get(label) || '';
      const inline = [...raw.matchAll(/'([^']+)'/g)].map((x) => x[1]);
      const spread = [...raw.matchAll(/\.\.\.(WH_\w+)/g)].flatMap((x) => consts.get(x[1]) || []);
      return [...inline, ...spread];
    };

    const manager = resolve('Trưởng phòng kho');
    const staff = resolve('Nhân viên kho');
    const board = resolve('Giám đốc');

    // Manager: full operational control
    for (const p of ['stock.view', 'stock.receive', 'stock.issue', 'stock.transfer', 'stock.count',
      'stock.approve', 'stock.adjust', 'stock.manage', 'stock.reports']) {
      expect(manager).toContain(p);
    }
    // Staff: operations only, no approvals or master data
    for (const p of ['stock.view', 'stock.receive', 'stock.issue', 'stock.transfer', 'stock.count']) {
      expect(staff).toContain(p);
    }
    expect(staff).not.toContain('stock.approve');
    expect(staff).not.toContain('stock.manage');
    expect(staff).not.toContain('stock.adjust');
    // Board: oversight + MISA reconciliation
    expect(board).toContain('misa.reconcile');
    expect(board).toContain('stock.reports');
    expect(board).not.toContain('stock.receive');
  });
});
