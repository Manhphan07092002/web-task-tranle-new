import { Fragment, useCallback, useEffect, useState } from 'react';
import { Search, Download, Plus, Pencil, Trash2, Package } from 'lucide-react';
import { Card } from '../../components/UI';
import { useRBAC } from '../../hooks/useRBAC';
import {
  createCombo, createLot, deleteCombo, deleteLot, getCombos, getInventoryMeta, getInventoryPaged, getLocations, getLots,
  updateInventoryItem, updateLot,
  type InventoryLot, type InventoryPage, type ProductCombo,
} from '../../services/warehouseService';

type Tab = 'stock' | 'lots' | 'specs' | 'combos';
type ExpiringFilter = '' | 'expired' | 'soon';

const TABS: { value: Tab; label: string }[] = [
  { value: 'stock', label: 'Tra cứu hàng tồn kho' },
  { value: 'lots', label: 'Tra cứu tồn kho theo lô' },
  { value: 'specs', label: 'Tra cứu tồn kho theo mã quy cách' },
  { value: 'combos', label: 'Tra cứu tồn kho combo hàng hóa' },
];

const PAGE_SIZES = [10, 20, 50, 100];

function toCsv(rows: (string | number)[][]): string {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\n');
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const EXPIRY_META: Record<string, { label: string; badge: string }> = {
  none: { label: 'Không HSD', badge: 'bg-slate-100 text-slate-500' },
  ok: { label: 'Còn hạn', badge: 'bg-emerald-100 text-emerald-700' },
  soon: { label: 'Sắp hết hạn', badge: 'bg-amber-100 text-amber-700' },
  expired: { label: 'Quá hạn', badge: 'bg-rose-100 text-rose-700' },
};

const filterBarCls = 'px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm text-gray-800 dark:text-slate-100';

export default function WarehouseStockInquiryPage() {
  const { canApprove } = useRBAC();
  const isManager = canApprove('warehouse');
  const [tab, setTab] = useState<Tab>('stock');
  const [error, setError] = useState<string | null>(null);

  // ---- Tab 1: stock ----
  const [stock, setStock] = useState<InventoryPage>({ rows: [], total: 0, page: 1, pageSize: 20 });
  const [stockLoading, setStockLoading] = useState(false);
  const [stockSearch, setStockSearch] = useState('');
  const [stockLocation, setStockLocation] = useState('');
  const [stockCategory, setStockCategory] = useState('');
  const [stockUnit, setStockUnit] = useState('');
  const [meta, setMeta] = useState<{ categories: string[]; units: string[] }>({ categories: [], units: [] });
  const [locationOptions, setLocationOptions] = useState<string[]>([]);

  const loadStock = useCallback(async (page: number, pageSize: number) => {
    try {
      setStockLoading(true);
      setError(null);
      setStock(await getInventoryPaged({
        search: stockSearch.trim() || undefined,
        location: stockLocation || undefined,
        category: stockCategory || undefined,
        unit: stockUnit || undefined,
        page, pageSize,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được tồn kho.');
    } finally {
      setStockLoading(false);
    }
  }, [stockSearch, stockLocation, stockCategory, stockUnit]);

  useEffect(() => {
    if (tab !== 'stock') return;
    loadStock(1, stock.pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    (async () => {
      try {
        const [m, locs] = await Promise.all([
          getInventoryMeta(),
          getLocations().catch(() => ({ locations: [], unassigned: { itemCount: 0, totalQuantity: 0, alertCount: 0 } })),
        ]);
        setMeta(m);
        setLocationOptions(locs.locations.map((l) => l.code));
      } catch { /* optional filters */ }
    })();
  }, []);

  const applyStockFilters = () => loadStock(1, stock.pageSize);

  const exportStock = async () => {
    try {
      const all = await getInventoryPaged({
        search: stockSearch.trim() || undefined,
        location: stockLocation || undefined,
        category: stockCategory || undefined,
        unit: stockUnit || undefined,
        page: 1, pageSize: 5000,
      });
      downloadCsv('ton-kho-hang-hoa.csv', [
        ['Mã hàng hóa', 'Tên hàng hóa', 'Loại hàng hóa', 'Mã quy cách', 'Đơn vị tính', 'Vị trí', 'Số lượng tồn'],
        ...all.rows.map((r) => [r.productCode, r.productName, r.category || '', r.specCode || '', r.unit, r.warehouseLocation || '', r.quantity]),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xuất khẩu thất bại');
    }
  };

  const totalPages = Math.max(Math.ceil(stock.total / stock.pageSize), 1);
  const rangeFrom = stock.total === 0 ? 0 : (stock.page - 1) * stock.pageSize + 1;
  const rangeTo = Math.min(stock.page * stock.pageSize, stock.total);

  // ---- Tab 2: lots ----
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [lotSearch, setLotSearch] = useState('');
  const [lotLocation, setLotLocation] = useState('');
  const [lotExpiring, setLotExpiring] = useState<ExpiringFilter>('');
  const [showLotForm, setShowLotForm] = useState(false);
  const [editingLot, setEditingLot] = useState<InventoryLot | null>(null);
  const [lotForm, setLotForm] = useState({ productCode: '', productName: '', lotCode: '', expiryDate: '', quantity: '1', unit: 'pcs', locationCode: '', notes: '' });

  const loadLots = useCallback(async () => {
    try {
      setLotsLoading(true);
      setError(null);
      setLots(await getLots({
        search: lotSearch.trim() || undefined,
        location: lotLocation || undefined,
        expiring: lotExpiring || undefined,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được lô hàng.');
    } finally {
      setLotsLoading(false);
    }
  }, [lotSearch, lotLocation, lotExpiring]);

  useEffect(() => { if (tab === 'lots') loadLots(); }, [tab, loadLots]);

  const openLotCreate = () => {
    setEditingLot(null);
    setLotForm({ productCode: '', productName: '', lotCode: '', expiryDate: '', quantity: '1', unit: 'pcs', locationCode: '', notes: '' });
    setShowLotForm(true);
  };

  const openLotEdit = (lot: InventoryLot) => {
    setEditingLot(lot);
    setLotForm({
      productCode: lot.productCode, productName: lot.productName, lotCode: lot.lotCode,
      expiryDate: lot.expiryDate || '', quantity: String(lot.quantity), unit: lot.unit,
      locationCode: lot.locationCode || '', notes: '',
    });
    setShowLotForm(true);
  };

  const submitLot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      if (editingLot) {
        await updateLot(editingLot.id, {
          quantity: Number(lotForm.quantity),
          expiryDate: lotForm.expiryDate || null,
          locationCode: lotForm.locationCode || null,
        });
      } else {
        await createLot({
          productCode: lotForm.productCode.trim(), productName: lotForm.productName.trim(),
          lotCode: lotForm.lotCode.trim(), expiryDate: lotForm.expiryDate || undefined,
          quantity: Number(lotForm.quantity), unit: lotForm.unit.trim() || 'pcs',
          locationCode: lotForm.locationCode || undefined, notes: lotForm.notes.trim() || undefined,
        });
      }
      setShowLotForm(false);
      await loadLots();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu lô thất bại');
    }
  };

  const removeLot = async (lot: InventoryLot) => {
    if (!window.confirm(`Xóa lô '${lot.lotCode}'?`)) return;
    try {
      await deleteLot(lot.id);
      await loadLots();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xóa lô thất bại');
    }
  };

  // ---- Tab 3: specs (reuse stock data, grouped editing) ----
  const [specSearch, setSpecSearch] = useState('');
  const [specRows, setSpecRows] = useState<InventoryPage>({ rows: [], total: 0, page: 1, pageSize: 20 });
  const [specLoading, setSpecLoading] = useState(false);
  const [specEdits, setSpecEdits] = useState<Record<string, { category: string; specCode: string }>>({});

  const loadSpecs = useCallback(async (page: number, pageSize: number) => {
    try {
      setSpecLoading(true);
      setError(null);
      const data = await getInventoryPaged({ search: specSearch.trim() || undefined, page, pageSize });
      setSpecRows(data);
      const edits: Record<string, { category: string; specCode: string }> = {};
      data.rows.forEach((r) => { edits[r.id] = { category: r.category || '', specCode: r.specCode || '' }; });
      setSpecEdits(edits);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dữ liệu.');
    } finally {
      setSpecLoading(false);
    }
  }, [specSearch]);

  useEffect(() => { if (tab === 'specs') loadSpecs(1, specRows.pageSize); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSpec = async (id: string) => {
    try {
      const edit = specEdits[id];
      await updateInventoryItem(id, { category: edit.category.trim() || null, specCode: edit.specCode.trim() || null });
      await loadSpecs(specRows.page, specRows.pageSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu thất bại');
    }
  };

  // ---- Tab 4: combos ----
  const [combos, setCombos] = useState<ProductCombo[]>([]);
  const [combosLoading, setCombosLoading] = useState(false);
  const [comboSearch, setComboSearch] = useState('');
  const [expandedCombo, setExpandedCombo] = useState<string | null>(null);
  const [showComboForm, setShowComboForm] = useState(false);
  const [comboForm, setComboForm] = useState({ code: '', name: '', unit: 'set', notes: '' });
  const [comboItems, setComboItems] = useState([{ productCode: '', productName: '', quantity: '1', unit: 'pcs' }]);

  const loadCombos = useCallback(async () => {
    try {
      setCombosLoading(true);
      setError(null);
      setCombos(await getCombos(comboSearch.trim() || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được combo.');
    } finally {
      setCombosLoading(false);
    }
  }, [comboSearch]);

  useEffect(() => { if (tab === 'combos') loadCombos(); }, [tab, loadCombos]);

  const submitCombo = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      await createCombo({
        code: comboForm.code.trim(), name: comboForm.name.trim(),
        unit: comboForm.unit.trim() || 'set', notes: comboForm.notes.trim() || undefined,
        items: comboItems.map((i) => ({
          productCode: i.productCode.trim(), productName: i.productName.trim(),
          quantity: Number(i.quantity), unit: i.unit.trim() || 'pcs',
        })),
      });
      setShowComboForm(false);
      setComboForm({ code: '', name: '', unit: 'set', notes: '' });
      setComboItems([{ productCode: '', productName: '', quantity: '1', unit: 'pcs' }]);
      await loadCombos();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tạo combo thất bại');
    }
  };

  const removeCombo = async (combo: ProductCombo) => {
    if (!window.confirm(`Xóa combo '${combo.code}'?`)) return;
    try {
      await deleteCombo(combo.id);
      await loadCombos();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xóa combo thất bại');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100">Tra cứu tồn kho</h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">Tồn kho theo hàng hóa, lô, mã quy cách và combo — lọc, phân trang, xuất khẩu.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
              tab === t.value
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 border border-gray-200 dark:border-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      {tab === 'stock' && (
        <Card className="overflow-hidden p-0">
          <div className="p-4 border-b border-gray-100 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            <div className="relative lg:col-span-2">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={stockSearch} onChange={(e) => setStockSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyStockFilters()}
                placeholder="Tìm kiếm hàng hóa (mã / tên)"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/50 text-sm focus:ring-2 focus:ring-emerald-500 text-gray-800 dark:text-slate-100"
              />
            </div>
            <select value={stockLocation} onChange={(e) => setStockLocation(e.target.value)} className={filterBarCls} aria-label="Lọc theo kho">
              <option value="">Tất cả kho</option>
              {locationOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={stockCategory} onChange={(e) => setStockCategory(e.target.value)} className={filterBarCls} aria-label="Lọc loại hàng hóa">
              <option value="">Tất cả loại hàng hóa</option>
              {meta.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="flex gap-2">
              <select value={stockUnit} onChange={(e) => setStockUnit(e.target.value)} className={`${filterBarCls} flex-1`} aria-label="Lọc đơn vị tính">
                <option value="">Đơn vị tính chính</option>
                {meta.units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <button onClick={applyStockFilters} title="Tìm kiếm"
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold">Lọc</button>
              <button onClick={exportStock} title="Xuất khẩu CSV"
                className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold text-gray-600 dark:text-slate-300 hover:bg-gray-50 inline-flex items-center gap-1">
                <Download size={14} /> Xuất khẩu
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã hàng hóa</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Tên hàng hóa</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Loại hàng hóa</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Đơn vị tính</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase text-right">Số lượng tồn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                {stockLoading ? (
                  <tr><td colSpan={5} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
                ) : stock.rows.length === 0 ? (
                  <tr><td colSpan={5} className="p-8 text-center text-gray-400">Không tìm thấy hàng hóa nào.</td></tr>
                ) : (
                  stock.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                      <td className="p-3 text-sm font-semibold">{r.productCode}</td>
                      <td className="p-3 text-sm">{r.productName}</td>
                      <td className="p-3 text-sm text-gray-500">{r.category || <span className="text-gray-300">Hàng hóa</span>}</td>
                      <td className="p-3 text-sm">{r.unit}</td>
                      <td className="p-3 text-sm text-right font-bold text-blue-700 dark:text-blue-300">
                        {Number(r.quantity).toLocaleString('vi-VN')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-gray-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-bold">Tổng số <span className="text-gray-800 dark:text-slate-100">{stock.total.toLocaleString('vi-VN')}</span></span>
            <div className="flex items-center gap-2 text-gray-500">
              <span>Số dòng/trang</span>
              <select
                value={stock.pageSize}
                onChange={(e) => loadStock(1, Number(e.target.value))}
                className="px-2 py-1 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100"
              >
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="font-semibold">{rangeFrom} - {rangeTo}</span>
              <button disabled={stock.page <= 1} onClick={() => loadStock(stock.page - 1, stock.pageSize)}
                className="px-2 py-1 border rounded-lg disabled:opacity-40">‹</button>
              <button disabled={stock.page >= totalPages} onClick={() => loadStock(stock.page + 1, stock.pageSize)}
                className="px-2 py-1 border rounded-lg disabled:opacity-40">›</button>
            </div>
          </div>
        </Card>
      )}

      {tab === 'lots' && (
        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <div className="p-4 border-b border-gray-100 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div className="relative sm:col-span-2">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={lotSearch} onChange={(e) => setLotSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadLots()}
                  placeholder="Tìm kiếm hàng hóa / số lô"
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/50 text-sm focus:ring-2 focus:ring-emerald-500 text-gray-800 dark:text-slate-100"
                />
              </div>
              <select value={lotLocation} onChange={(e) => setLotLocation(e.target.value)} className={filterBarCls} aria-label="Lọc theo kho">
                <option value="">Tất cả kho</option>
                {locationOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className="flex gap-2">
                <select value={lotExpiring} onChange={(e) => setLotExpiring(e.target.value as ExpiringFilter)} className={`${filterBarCls} flex-1`} aria-label="Lọc hạn sử dụng">
                  <option value="">Mọi hạn dùng</option>
                  <option value="soon">Sắp hết hạn (90 ngày)</option>
                  <option value="expired">Quá hạn</option>
                </select>
                <button onClick={() => { setShowLotForm(false); openLotCreate(); }}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold inline-flex items-center gap-1">
                  <Plus size={14} /> Nhập lô
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[860px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kho</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã hàng hóa</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Tên hàng hóa</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Loại hàng hóa</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Đơn vị tính</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Số lô</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hạn sử dụng</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-right">Số lượng tồn</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {lotsLoading ? (
                    <tr><td colSpan={9} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
                  ) : lots.length === 0 ? (
                    <tr><td colSpan={9} className="p-8 text-center text-gray-400">Chưa có lô hàng nào.</td></tr>
                  ) : (
                    lots.map((lot) => {
                      const meta = EXPIRY_META[lot.expiryStatus || 'none'];
                      return (
                        <tr key={lot.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                          <td className="p-3 text-sm">{lot.locationCode || '-'}</td>
                          <td className="p-3 text-sm font-semibold">{lot.productCode}</td>
                          <td className="p-3 text-sm">{lot.productName}</td>
                          <td className="p-3 text-sm text-gray-500">Hàng hóa</td>
                          <td className="p-3 text-sm">{lot.unit}</td>
                          <td className="p-3 text-sm font-bold">{lot.lotCode}</td>
                          <td className="p-3 text-sm">
                            {lot.expiryDate ? (
                              <span className="flex flex-col gap-1">
                                <span>{lot.expiryDate}</span>
                                <span className={`px-2 py-0.5 rounded font-bold text-[11px] w-fit ${meta.badge}`}>{meta.label}</span>
                              </span>
                            ) : <span className="text-gray-300">-</span>}
                          </td>
                          <td className="p-3 text-sm text-right font-bold">{Number(lot.quantity).toLocaleString('vi-VN')}</td>
                          <td className="p-3 text-center">
                            <span className="inline-flex gap-1">
                              <button onClick={() => openLotEdit(lot)} title="Sửa lô" className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg"><Pencil size={15} /></button>
                              {isManager && (
                                <button onClick={() => removeLot(lot)} title="Xóa lô" className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 size={15} /></button>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-gray-100 dark:border-slate-700 text-sm font-bold">
              Tổng số <span className="text-gray-800 dark:text-slate-100">{lots.length}</span>
            </div>
          </Card>

          {showLotForm && (
            <Card className="p-4">
              <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-3">{editingLot ? 'Sửa lô hàng' : 'Nhập lô hàng mới'}</h2>
              <form onSubmit={submitLot} className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                  Mã hàng hóa *
                  <input value={lotForm.productCode} disabled={!!editingLot} onChange={(e) => setLotForm({ ...lotForm, productCode: e.target.value })}
                    className={`${filterBarCls} disabled:opacity-60`} placeholder="VD: SAJ-R6-10K-T2" />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                  Tên hàng hóa *
                  <input value={lotForm.productName} disabled={!!editingLot} onChange={(e) => setLotForm({ ...lotForm, productName: e.target.value })}
                    className={`${filterBarCls} disabled:opacity-60`} placeholder="VD: Biến tần SAJ 10K" />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                  Số lô *
                  <input value={lotForm.lotCode} disabled={!!editingLot} onChange={(e) => setLotForm({ ...lotForm, lotCode: e.target.value })}
                    className={`${filterBarCls} disabled:opacity-60`} placeholder="VD: LO-2026-001" />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                  Hạn sử dụng
                  <input type="date" value={lotForm.expiryDate} onChange={(e) => setLotForm({ ...lotForm, expiryDate: e.target.value })} className={filterBarCls} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                  Số lượng *
                  <input type="number" min="0" step="any" value={lotForm.quantity} onChange={(e) => setLotForm({ ...lotForm, quantity: e.target.value })} className={filterBarCls} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                  Kho / vị trí
                  <select value={lotForm.locationCode} onChange={(e) => setLotForm({ ...lotForm, locationCode: e.target.value })} className={filterBarCls}>
                    <option value="">-- Chưa chọn --</option>
                    {locationOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <div className="md:col-span-3 flex justify-end gap-2">
                  <button type="button" onClick={() => setShowLotForm(false)}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm">Hủy</button>
                  <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm">
                    {editingLot ? 'Lưu' : 'Thêm lô'}
                  </button>
                </div>
              </form>
            </Card>
          )}
        </div>
      )}

      {tab === 'specs' && (
        <Card className="overflow-hidden p-0">
          <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={specSearch} onChange={(e) => setSpecSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadSpecs(1, specRows.pageSize)}
                placeholder="Tìm kiếm hàng hóa"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/50 text-sm focus:ring-2 focus:ring-emerald-500 text-gray-800 dark:text-slate-100"
              />
            </div>
            <button onClick={() => loadSpecs(1, specRows.pageSize)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold">Lọc</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[860px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kho</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã hàng hóa</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Tên hàng hóa</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Loại hàng hóa</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Đơn vị tính</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã quy cách</th>
                  {isManager && <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Lưu</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                {specLoading ? (
                  <tr><td colSpan={7} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
                ) : specRows.rows.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-gray-400">Không tìm thấy hàng hóa nào.</td></tr>
                ) : (
                  specRows.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                      <td className="p-3 text-sm">{r.warehouseLocation || '-'}</td>
                      <td className="p-3 text-sm font-semibold">{r.productCode}</td>
                      <td className="p-3 text-sm">{r.productName}</td>
                      <td className="p-3 text-sm">
                        {isManager ? (
                          <input
                            value={specEdits[r.id]?.category || ''}
                            onChange={(e) => setSpecEdits((prev) => ({ ...prev, [r.id]: { ...prev[r.id], category: e.target.value } }))}
                            placeholder="Loại hàng hóa"
                            className="w-32 px-2 py-1 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                          />
                        ) : (r.category || <span className="text-gray-300">Hàng hóa</span>)}
                      </td>
                      <td className="p-3 text-sm">{r.unit}</td>
                      <td className="p-3 text-sm">
                        {isManager ? (
                          <input
                            value={specEdits[r.id]?.specCode || ''}
                            onChange={(e) => setSpecEdits((prev) => ({ ...prev, [r.id]: { ...prev[r.id], specCode: e.target.value } }))}
                            placeholder="VD: QC-1"
                            className="w-28 px-2 py-1 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                          />
                        ) : (r.specCode || <span className="text-gray-300">-</span>)}
                      </td>
                      {isManager && (
                        <td className="p-3 text-center">
                          <button onClick={() => saveSpec(r.id)} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold">Lưu</button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-gray-100 dark:border-slate-700 text-sm font-bold">
            Tổng số <span className="text-gray-800 dark:text-slate-100">{specRows.total.toLocaleString('vi-VN')}</span>
          </div>
        </Card>
      )}

      {tab === 'combos' && (
        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={comboSearch} onChange={(e) => setComboSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadCombos()}
                  placeholder="Tìm kiếm combo"
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/50 text-sm focus:ring-2 focus:ring-emerald-500 text-gray-800 dark:text-slate-100"
                />
              </div>
              <button onClick={loadCombos} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold">Lọc</button>
              {isManager && (
                <button onClick={() => setShowComboForm((v) => !v)}
                  className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold text-gray-600 dark:text-slate-300 hover:bg-gray-50 inline-flex items-center gap-1">
                  <Plus size={14} /> Tạo combo
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[680px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã hàng hóa</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Tên hàng hóa</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Loại hàng hóa</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Đơn vị tính</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-right">Số lượng tồn</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {combosLoading ? (
                    <tr><td colSpan={6} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
                  ) : combos.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-gray-400">Chưa có combo nào.</td></tr>
                  ) : (
                    combos.map((combo) => (
                      <Fragment key={combo.id}>
                        <tr
                          key={combo.id}
                          className="hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer"
                          onClick={() => setExpandedCombo(expandedCombo === combo.id ? null : combo.id)}
                        >
                          <td className="p-3 text-sm font-semibold">{combo.code}</td>
                          <td className="p-3 text-sm">{combo.name}</td>
                          <td className="p-3 text-sm text-gray-500">Hàng hóa</td>
                          <td className="p-3 text-sm">{combo.unit}</td>
                          <td className="p-3 text-sm text-right font-bold text-blue-700 dark:text-blue-300">
                            {combo.assemblable.toLocaleString('vi-VN')}
                          </td>
                          <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                            {isManager && (
                              <button onClick={() => removeCombo(combo)} title="Xóa combo" className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg">
                                <Trash2 size={15} />
                              </button>
                            )}
                          </td>
                        </tr>
                        {expandedCombo === combo.id && (
                          <tr key={`${combo.id}-items`}>
                            <td colSpan={6} className="p-0 bg-gray-50/60 dark:bg-slate-800/40">
                              <div className="p-4">
                                <p className="text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-1">
                                  <Package size={13} /> Thành phần ({combo.componentCount}) — lắp ráp tối đa {combo.assemblable} {combo.unit}
                                </p>
                                <ul className="divide-y divide-gray-100 dark:divide-slate-700/50 bg-white dark:bg-slate-800 rounded-xl overflow-hidden">
                                  {combo.items.map((it) => (
                                    <li key={it.id} className="flex items-center justify-between px-3 py-2 text-sm">
                                      <span className="font-semibold">{it.productName}
                                        <span className="block text-xs font-normal text-gray-400">{it.productCode}</span>
                                      </span>
                                      <span className="font-bold">x {Number(it.quantity).toLocaleString('vi-VN')} {it.unit}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-gray-100 dark:border-slate-700 text-sm font-bold">
              Tổng số <span className="text-gray-800 dark:text-slate-100">{combos.length}</span>
            </div>
          </Card>

          {showComboForm && (
            <Card className="p-4">
              <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-3">Tạo combo hàng hóa</h2>
              <form onSubmit={submitCombo} className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                    Mã combo *
                    <input value={comboForm.code} onChange={(e) => setComboForm({ ...comboForm, code: e.target.value })}
                      placeholder="VD: CB-SAJ-6KW" className={filterBarCls} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300 md:col-span-2">
                    Tên combo *
                    <input value={comboForm.name} onChange={(e) => setComboForm({ ...comboForm, name: e.target.value })}
                      placeholder="VD: Combo SAJ 1 Pha - 6kW" className={filterBarCls} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                    Đơn vị
                    <input value={comboForm.unit} onChange={(e) => setComboForm({ ...comboForm, unit: e.target.value })} className={filterBarCls} />
                  </label>
                </div>
                <p className="text-xs font-bold text-gray-500 uppercase">Thành phần</p>
                {comboItems.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <input value={item.productCode} onChange={(e) => setComboItems((prev) => prev.map((p, i) => i === idx ? { ...p, productCode: e.target.value } : p))}
                      placeholder="Mã SP *" className={filterBarCls} />
                    <input value={item.productName} onChange={(e) => setComboItems((prev) => prev.map((p, i) => i === idx ? { ...p, productName: e.target.value } : p))}
                      placeholder="Tên SP *" className={`${filterBarCls} md:col-span-2`} />
                    <input type="number" min="0" step="any" value={item.quantity} onChange={(e) => setComboItems((prev) => prev.map((p, i) => i === idx ? { ...p, quantity: e.target.value } : p))}
                      placeholder="SL *" className={filterBarCls} />
                    <div className="flex gap-1">
                      <input value={item.unit} onChange={(e) => setComboItems((prev) => prev.map((p, i) => i === idx ? { ...p, unit: e.target.value } : p))}
                        placeholder="ĐVT" className={`${filterBarCls} flex-1`} />
                      {comboItems.length > 1 && (
                        <button type="button" onClick={() => setComboItems((prev) => prev.filter((_, i) => i !== idx))}
                          className="px-2 py-1 text-rose-500 hover:bg-rose-50 rounded-lg text-sm font-bold">×</button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex justify-between">
                  <button type="button"
                    onClick={() => setComboItems((prev) => [...prev, { productCode: '', productName: '', quantity: '1', unit: 'pcs' }])}
                    className="px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg">+ Thêm thành phần</button>
                  <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm">Tạo combo</button>
                </div>
              </form>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
