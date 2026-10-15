import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, PlusCircle, RefreshCw, AlertCircle, X, Pencil, ChevronDown } from 'lucide-react';
import { Card } from '../../components/UI';
import { getBundles, saveBundle, settleKit, getWarehouses, type ProductBundle, type Warehouse } from '../../services/stockService';
import { getProducts, type Product } from '../../services/productService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

// Combo / bộ solar (§23): VIRTUAL tính buildable từ available,
// STOCKED_KIT lắp/rã qua chứng từ (bước sau).
export default function BundlePage({ deptKey }: { deptKey: DeptKey }) {
  const [bundles, setBundles] = useState<ProductBundle[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [editing, setEditing] = useState<ProductBundle | null | undefined>(undefined);
  const [kitBusy, setKitBusy] = useState<string | null>(null);
  const [kitQty, setKitQty] = useState<Record<string, number>>({});
  const [kitErr, setKitErr] = useState('');

  const settle = async (b: ProductBundle, action: 'assemble' | 'disassemble') => {
    const qty = Number(kitQty[b.id]) || 0;
    if (!(qty > 0)) { setKitErr('Nhập số lượng bộ hợp lệ.'); return; }
    if (!warehouseId) { setKitErr('Chọn kho để lắp/rã.'); return; }
    setKitBusy(b.id + action); setKitErr('');
    try {
      await settleKit(b.id, action, { warehouseId, quantity: qty });
      await fetchAll();
    } catch (e: any) {
      setKitErr(e.message || 'Thao tác kit thất bại.');
    } finally {
      setKitBusy(null);
    }
  };

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [b, w] = await Promise.all([
        getBundles(warehouseId || undefined),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setBundles(b); setWarehouses(w);
      getProducts().then(setProducts).catch(() => {});
    } catch (e: any) {
      setError(e.message || 'Không tải được combo');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [warehouseId]);

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Hàng hóa</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Combo / Bộ sản phẩm</h1>
          <p className="text-gray-500 text-sm mt-1">Số bộ cấu hình được = linh kiện giới hạn (tính từ tồn khả dụng).</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
              className="pl-4 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm appearance-none">
              <option value="">Mọi kho (phạm vi của tôi)</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
          </div>
          <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setEditing(null)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-md transition-colors">
            <PlusCircle size={16} /> Tạo combo
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          <AlertCircle size={15} />{error}
        </div>
      )}

      {kitErr && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          <AlertCircle size={15} />{kitErr}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải combo...</p>
        </div>
      ) : bundles.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <Boxes size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Chưa có combo nào</p>
          <p className="text-sm mt-1">Tạo combo hệ mặt trời mẫu để bắt đầu.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {bundles.map((b) => (
            <Card key={b.id} className="p-5">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  <h2 className="font-bold text-gray-800">{b.name}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {b.bundleType === 'VIRTUAL_BUNDLE' ? 'Cấu hình ảo' : 'Bộ đóng gói sẵn'}
                    {b.code ? ` · ${b.code}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-black text-lg leading-none">
                    {b.buildable}
                  </span>
                  <button onClick={() => setEditing(b)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Sửa cấu hình">
                    <Pencil size={14} />
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-3">Có thể cấu hình {b.buildable} bộ trong phạm vi đã chọn.</p>
              {b.bundleType === 'STOCKED_KIT' && (
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <input type="number" min={1} step={1} placeholder="SL"
                    value={kitQty[b.id] ?? ''}
                    onChange={(e) => setKitQty((m) => ({ ...m, [b.id]: Number(e.target.value) }))}
                    className="w-20 px-2 py-1.5 border border-gray-200 rounded-lg text-sm outline-none" />
                  <button disabled={kitBusy === b.id + 'assemble'} onClick={() => settle(b, 'assemble')}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-60">
                    {kitBusy === b.id + 'assemble' ? 'Đang lắp...' : 'Lắp ráp'}
                  </button>
                  <button disabled={kitBusy === b.id + 'disassemble'} onClick={() => settle(b, 'disassemble')}
                    className="px-3 py-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg text-xs font-bold disabled:opacity-60">
                    {kitBusy === b.id + 'disassemble' ? 'Đang rã...' : 'Rã bộ'}
                  </button>
                </div>
              )}
              <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 uppercase text-[10px]">
                    <th className="text-left py-1.5 font-bold">Thành phần</th>
                    <th className="text-right font-bold">SL/bộ</th>
                    <th className="text-right font-bold">Khả dụng</th>
                    <th className="text-right font-bold">Được</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {b.items.map((i) => (
                    <tr key={i.productId} className={i.productId === b.limitingProductId ? 'bg-amber-50/60 font-semibold' : ''}>
                      <td className="py-1.5 text-gray-700">{i.productName || i.productId}</td>
                      <td className="py-1.5 text-right text-gray-500">{i.qtyPerBundle}</td>
                      <td className="py-1.5 text-right text-gray-500">{(i.available ?? 0).toLocaleString('vi-VN')}</td>
                      <td className="py-1.5 text-right font-black text-gray-800">{i.buildable ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing !== undefined && (
        <BundleModal initial={editing} products={products}
          onClose={() => setEditing(undefined)}
          onDone={async () => { setEditing(undefined); await fetchAll(); }} />
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}

function BundleModal({ initial, products, onClose, onDone }: {
  initial: ProductBundle | null; products: Product[];
  onClose: () => void; onDone: () => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [code, setCode] = useState(initial?.code || '');
  const [bundleType, setBundleType] = useState<string>(initial?.bundleType || 'VIRTUAL_BUNDLE');
  const [kitProductId, setKitProductId] = useState(initial?.kitProductId || '');
  const [items, setItems] = useState<{ productId: string; qtyPerBundle: number }[]>(
    initial?.items.map((i) => ({ productId: i.productId, qtyPerBundle: i.qtyPerBundle })) || [{ productId: '', qtyPerBundle: 1 }]
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = items.filter((i) => i.productId && Number(i.qtyPerBundle) > 0)
      .map((i) => ({ productId: i.productId, qtyPerBundle: Number(i.qtyPerBundle) }));
    if (!name.trim() || clean.length === 0) { setErr('Nhập tên combo và ít nhất 1 linh kiện hợp lệ.'); return; }
    if (bundleType === 'STOCKED_KIT' && !kitProductId) { setErr('Bộ đóng gói sẵn cần mã hàng vật lý để giữ tồn.'); return; }
    setSaving(true); setErr('');
    try {
      await saveBundle({ id: initial?.id, name: name.trim(), code: code.trim() || null, bundleType, kitProductId: bundleType === 'STOCKED_KIT' ? kitProductId : null, items: clean });
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Lưu thất bại.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{initial ? 'Sửa combo' : 'Tạo combo'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Tên combo</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Bộ 6kW 1 pha"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mã</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="VD: COMBO-6KW"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Loại</label>
              <select value={bundleType} onChange={(e) => setBundleType(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                <option value="VIRTUAL_BUNDLE">Cấu hình ảo</option>
                <option value="STOCKED_KIT">Bộ đóng gói sẵn</option>
              </select>
            </div>
          </div>
          {bundleType === 'STOCKED_KIT' && (
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mã hàng vật lý của bộ</label>
              <select value={kitProductId} onChange={(e) => setKitProductId(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                <option value="">-- Chọn mã hàng giữ tồn bộ --</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-1">Lắp ráp trừ linh kiện + cộng mã này; rã làm ngược lại.</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Linh kiện</label>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex gap-2">
                  <select value={item.productId}
                    onChange={(e) => setItems((ls) => ls.map((l, j) => (j === i ? { ...l, productId: e.target.value } : l)))}
                    className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                    <option value="">-- Chọn hàng --</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input type="number" min={1} step="any" value={item.qtyPerBundle}
                    onChange={(e) => setItems((ls) => ls.map((l, j) => (j === i ? { ...l, qtyPerBundle: Number(e.target.value) } : l)))}
                    className="w-24 px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none" title="SL/bộ" />
                  <button type="button" onClick={() => setItems((ls) => ls.filter((_, j) => j !== i))}
                    className="p-2 text-gray-300 hover:text-red-500" title="Xóa dòng">
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setItems((ls) => [...ls, { productId: '', qtyPerBundle: 1 }])}
              className="mt-2 text-xs font-bold text-emerald-600 hover:underline">+ Thêm linh kiện</button>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
              {saving ? 'Đang lưu...' : initial ? 'Lưu thay đổi' : 'Tạo combo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
