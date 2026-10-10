import { Fragment, useCallback, useEffect, useState } from 'react';
import { Package, Plus, Trash2, Wrench, Box } from 'lucide-react';
import { Card } from '../../components/UI';
import { useAuth } from '../../contexts/AuthContext';
import {
  addBundleItem, assembleBundle, createBundle, deleteBundle, deleteBundleItem,
  disassembleBundle, getBundles, getStockProducts, getWarehouses, updateBundle,
  type Bundle, type StockProduct, type Warehouse,
} from '../../services/stockMasterService';

const MODE_META: Record<string, { label: string; badge: string }> = {
  VIRTUAL_BUNDLE: { label: 'Ảo (theo tồn)', badge: 'bg-blue-100 text-blue-700' },
  STOCKED_KIT: { label: 'Đóng gói sẵn', badge: 'bg-purple-100 text-purple-700' },
};

const inputCls = 'px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm text-gray-800 dark:text-slate-100';

export default function StockBundlesPage() {
  const { user } = useAuth();
  const isManager = (user?.permissions || []).includes('stock.manage');
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<StockProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', unit: 'set', mode: 'VIRTUAL_BUNDLE', kitProductId: '', notes: '' });
  const [formItems, setFormItems] = useState([{ productId: '', quantity: '1' }]);
  const [acting, setActing] = useState(false);
  const [assembleQty, setAssembleQty] = useState<Record<string, string>>({});
  const [newItem, setNewItem] = useState<Record<string, { productId: string; quantity: string }>>({});

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [list, wh, prods] = await Promise.all([
        getBundles(warehouseId || undefined),
        getWarehouses().catch(() => [] as Warehouse[]),
        getStockProducts().catch(() => [] as StockProduct[]),
      ]);
      setBundles(list);
      setWarehouses(wh.filter((w) => w.isActive));
      setProducts(prods);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được combo.');
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    (async () => {
      try {
        setActing(true);
        setError(null);
        await createBundle({
          code: form.code.trim(), name: form.name.trim(), unit: form.unit.trim() || 'set',
          mode: form.mode,
          kitProductId: form.mode === 'STOCKED_KIT' ? form.kitProductId || undefined : undefined,
          notes: form.notes.trim() || undefined,
          items: formItems.map((i) => ({ productId: i.productId, quantity: Number(i.quantity) })),
        });
        setShowForm(false);
        setForm({ code: '', name: '', unit: 'set', mode: 'VIRTUAL_BUNDLE', kitProductId: '', notes: '' });
        setFormItems([{ productId: '', quantity: '1' }]);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Tạo combo thất bại');
      } finally {
        setActing(false);
      }
    })();
  };

  const runOp = async (fn: () => Promise<unknown>) => {
    try {
      setActing(true);
      setError(null);
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Thao tác thất bại');
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <Package className="text-emerald-500" /> Combo / Bộ sản phẩm
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">
            {bundles.length} combo • Số lắp ráp được tính từ tồn khả dụng theo công thức MIN
          </p>
        </div>
        <div className="flex gap-2">
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
            className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-sm font-bold text-gray-600 dark:text-slate-300"
            aria-label="Tính theo kho">
            <option value="">Mọi kho</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
          </select>
          {isManager && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-1"
            >
              <Plus size={15} /> Tạo combo
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      {showForm && (
        <Card className="p-4">
          <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-3">Tạo combo mới</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                Mã combo *
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="VD: CB-SAJ-6KW" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300 md:col-span-2">
                Tên combo *
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="VD: Combo SAJ 1 Pha - 6kW" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                Chế độ
                <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className={inputCls}>
                  <option value="VIRTUAL_BUNDLE">Ảo (tính theo tồn)</option>
                  <option value="STOCKED_KIT">Đóng gói sẵn (có SKU)</option>
                </select>
              </label>
              {form.mode === 'STOCKED_KIT' && (
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300 md:col-span-2">
                  Hàng hóa đại diện bộ đã đóng gói *
                  <select value={form.kitProductId} onChange={(e) => setForm({ ...form, kitProductId: e.target.value })} className={inputCls}>
                    <option value="">-- Chọn SKU bộ --</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <p className="text-xs font-bold text-gray-500 uppercase">Thành phần</p>
            {formItems.map((item, idx) => (
              <div key={idx} className="grid grid-cols-5 gap-2">
                <select
                  value={item.productId}
                  onChange={(e) => setFormItems((prev) => prev.map((p, i) => i === idx ? { ...p, productId: e.target.value } : p))}
                  className={`${inputCls} col-span-3`}
                >
                  <option value="">-- Chọn hàng hóa * --</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                </select>
                <input
                  type="number" min="0" step="any" placeholder="SL/bộ *"
                  value={item.quantity}
                  onChange={(e) => setFormItems((prev) => prev.map((p, i) => i === idx ? { ...p, quantity: e.target.value } : p))}
                  className={inputCls}
                />
                <div className="flex gap-1">
                  {formItems.length > 1 && (
                    <button type="button"
                      onClick={() => setFormItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="px-2 py-1 text-rose-500 hover:bg-rose-50 rounded-lg text-sm font-bold">×</button>
                  )}
                  {idx === formItems.length - 1 && (
                    <button type="button"
                      onClick={() => setFormItems((prev) => [...prev, { productId: '', quantity: '1' }])}
                      className="px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg">+ Dòng</button>
                  )}
                </div>
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm">Hủy</button>
              <button type="submit" disabled={acting}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                Tạo combo
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Combo</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Chế độ</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Lắp ráp được</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Thiếu ở</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : bundles.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">Chưa có combo nào.</td></tr>
              ) : (
                bundles.map((bundle) => (
                  <Fragment key={bundle.id}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer"
                      onClick={() => setExpandedId(expandedId === bundle.id ? null : bundle.id)}>
                      <td className="p-3 text-sm">
                        <span className="font-bold">{bundle.code}</span>
                        <span className="block text-gray-600 dark:text-slate-300">{bundle.name} • {bundle.componentCount} thành phần</span>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded font-bold text-xs ${MODE_META[bundle.mode]?.badge || ''}`}>
                          {MODE_META[bundle.mode]?.label || bundle.mode}
                        </span>
                      </td>
                      <td className="p-3 text-sm text-center font-black text-blue-700 dark:text-blue-300">
                        {bundle.buildable.toLocaleString('vi-VN')} {bundle.unit}
                      </td>
                      <td className="p-3 text-sm text-gray-500">
                        {bundle.limiting && bundle.buildable < 10 ? (
                          <span className="text-amber-600 font-bold">{bundle.limiting.productCode} ({bundle.limiting.sets} bộ)</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        {isManager ? (
                          <button
                            onClick={() => {
                              if (!window.confirm(`Xóa combo '${bundle.code}'? (không ảnh hưởng tồn kho)`)) return;
                              runOp(() => deleteBundle(bundle.id));
                            }}
                            className="px-2 py-1 text-rose-500 hover:bg-rose-50 rounded-lg text-[11px] font-bold disabled:opacity-50"
                            disabled={acting}
                          >
                            Xóa
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">Xem</span>
                        )}
                      </td>
                    </tr>
                    {expandedId === bundle.id && (
                      <tr key={`${bundle.id}-detail`}>
                        <td colSpan={5} className="p-0 bg-gray-50/60 dark:bg-slate-800/40">
                          <div className="p-4 space-y-3">
                            <p className="text-xs font-bold text-gray-500 uppercase">
                              Thành phần ({bundle.componentCount}) — lắp ráp tối đa {bundle.buildable} {bundle.unit}
                            </p>
                            <ul className="divide-y divide-gray-100 dark:divide-slate-700/50 bg-white dark:bg-slate-800 rounded-xl overflow-hidden">
                              {bundle.items.map((it) => (
                                <li key={it.id} className="flex items-center justify-between px-3 py-2 text-sm">
                                  <span className="font-semibold">
                                    {it.productName}
                                    <span className="block text-xs font-normal text-gray-400">{it.productCode}</span>
                                  </span>
                                  <span className="font-bold">x {Number(it.quantity).toLocaleString('vi-VN')} {it.unit}</span>
                                </li>
                              ))}
                            </ul>
                            {isManager && (
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  value={newItem[bundle.id]?.productId || ''}
                                  onChange={(e) => setNewItem((prev) => ({
                                    ...prev,
                                    [bundle.id]: { productId: e.target.value, quantity: prev[bundle.id]?.quantity || '1' },
                                  }))}
                                  className={`${inputCls} flex-1 min-w-[200px]`}
                                  aria-label="Thêm thành phần"
                                >
                                  <option value="">-- Thêm thành phần --</option>
                                  {products
                                    .filter((p) => !bundle.items.some((i) => i.productId === p.id))
                                    .map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                                </select>
                                <input
                                  type="number" min="0" step="any" placeholder="SL/bộ"
                                  value={newItem[bundle.id]?.quantity || '1'}
                                  onChange={(e) => setNewItem((prev) => ({
                                    ...prev,
                                    [bundle.id]: { productId: prev[bundle.id]?.productId || '', quantity: e.target.value },
                                  }))}
                                  className={`${inputCls} w-24`}
                                />
                                <button
                                  disabled={acting || !newItem[bundle.id]?.productId}
                                  onClick={() => runOp(() => addBundleItem(bundle.id, {
                                    productId: newItem[bundle.id].productId,
                                    quantity: Number(newItem[bundle.id].quantity),
                                  }))}
                                  className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-xs font-bold disabled:opacity-50"
                                >
                                  Thêm
                                </button>
                              </div>
                            )}
                            {isManager && bundle.mode === 'STOCKED_KIT' && (
                              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-purple-100 dark:border-purple-900/40 bg-purple-50/50 dark:bg-purple-900/10 p-3">
                                <Box size={15} className="text-purple-600" />
                                <span className="text-xs font-bold text-gray-600 dark:text-slate-300">
                                  Đóng gói sẵn ({bundle.kitCode || 'SKU bộ'}):
                                </span>
                                <input
                                  type="number" min="1" step="1" placeholder="SL bộ"
                                  value={assembleQty[bundle.id] ?? ''}
                                  onChange={(e) => setAssembleQty((prev) => ({ ...prev, [bundle.id]: e.target.value }))}
                                  className={`${inputCls} w-24 !py-1.5 !text-xs`}
                                />
                                <button
                                  disabled={acting}
                                  onClick={() => {
                                    const qty = Number(assembleQty[bundle.id]);
                                    if (!qty || qty <= 0 || !Number.isInteger(qty)) {
                                      setError('Nhập số bộ nguyên dương.');
                                      return;
                                    }
                                    const whId = warehouseId || warehouses[0]?.id;
                                    if (!whId) {
                                      setError('Chọn kho để đóng gói (bộ lọc kho phía trên).');
                                      return;
                                    }
                                    runOp(() => assembleBundle(bundle.id, { qty, warehouseId: whId }));
                                  }}
                                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1"
                                >
                                  <Wrench size={13} /> Lắp ráp
                                </button>
                                <button
                                  disabled={acting}
                                  onClick={() => {
                                    const qty = Number(assembleQty[bundle.id]);
                                    if (!qty || qty <= 0 || !Number.isInteger(qty)) {
                                      setError('Nhập số bộ nguyên dương.');
                                      return;
                                    }
                                    const whId = warehouseId || warehouses[0]?.id;
                                    if (!whId) {
                                      setError('Chọn kho để rã bộ (bộ lọc kho phía trên).');
                                      return;
                                    }
                                    runOp(() => disassembleBundle(bundle.id, { qty, warehouseId: whId }));
                                  }}
                                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-xs font-bold disabled:opacity-50"
                                >
                                  Rã bộ
                                </button>
                              </div>
                            )}
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
      </Card>
    </div>
  );
}
