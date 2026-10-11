import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, PlusCircle, RefreshCw, AlertCircle, X, Pencil } from 'lucide-react';
import { Card } from '../../components/UI';
import { getStockLocations, saveStockLocation, type StockLocation } from '../../services/locationService';
import { getWarehouses, type Warehouse } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

const TYPES = ['INTERNAL', 'SUPPLIER', 'CUSTOMER', 'TRANSIT', 'LOSS', 'ADJUSTMENT'];
const PURPOSES = ['SALEABLE', 'WARRANTY', 'DAMAGED', 'DEMO', 'QUARANTINE', 'PICKING', 'RECEIVING', 'OTHER'];

// Kho & Vị trí TP (§24): cây RECEIVING/SALEABLE/PICKING/WARRANTY.../QUARANTINE.
export default function LocationsPage({ deptKey }: { deptKey: DeptKey }) {
  const [rows, setRows] = useState<StockLocation[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [editing, setEditing] = useState<StockLocation | null | undefined>(undefined);

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [l, w] = await Promise.all([
        getStockLocations(warehouseId || undefined),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setRows(l); setWarehouses(w);
    } catch (e: any) {
      setError(e.message || 'Không tải được vị trí');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [warehouseId]);

  const byWarehouse = React.useMemo(() => {
    const map = new Map<string, StockLocation[]>();
    for (const r of rows) {
      const list = map.get(r.warehouseId) || [];
      list.push(r);
      map.set(r.warehouseId, list);
    }
    return [...map.entries()];
  }, [rows]);

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name || id;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Kho vận · Hàng hóa</p>
          <h1 className="text-2xl font-bold text-gray-800">Kho &amp; Vị trí</h1>
        </div>
        <div className="flex gap-2">
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
            className="px-4 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm appearance-none">
            <option value="">Tất cả kho (phạm vi của tôi)</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setEditing(null)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-md transition-colors">
            <PlusCircle size={16} /> Thêm vị trí
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          <AlertCircle size={15} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải vị trí...</p>
        </div>
      ) : byWarehouse.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <MapPin size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Chưa có vị trí nào trong phạm vi của bạn</p>
        </Card>
      ) : (
        byWarehouse.map(([whId, list]) => (
          <Card key={whId} className="overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 font-bold text-gray-700 text-sm">{whName(whId)}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase">
                    <th className="py-2.5 px-5">Mã / Tên</th>
                    <th className="py-2.5 px-4">Loại</th>
                    <th className="py-2.5 px-4">Mục đích</th>
                    <th className="py-2.5 px-4">Trạng thái</th>
                    <th className="py-2.5 px-5 text-right">Sửa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {list.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50/70">
                      <td className="py-2.5 px-5">
                        <span className="font-mono font-bold text-gray-800 text-xs">{l.code}</span>
                        <span className="text-gray-500 text-xs ml-2">{l.name}</span>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-gray-500">{l.type}</td>
                      <td className="py-2.5 px-4"><span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-600">{l.purpose}</span></td>
                      <td className="py-2.5 px-4 text-xs">{l.isActive ? <span className="text-emerald-600 font-bold">Hoạt động</span> : <span className="text-gray-400">Ngưng</span>}</td>
                      <td className="py-2.5 px-5 text-right">
                        <button onClick={() => setEditing(l)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Sửa">
                          <Pencil size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}

      {editing !== undefined && (
        <LocationModal
          initial={editing} warehouses={warehouses} locations={rows}
          onClose={() => setEditing(undefined)}
          onDone={async () => { setEditing(undefined); await fetchAll(); }}
        />
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}

function LocationModal({ initial, warehouses, locations, onClose, onDone }: {
  initial: StockLocation | null; warehouses: Warehouse[]; locations: StockLocation[];
  onClose: () => void; onDone: () => Promise<void>;
}) {
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId || '');
  const [code, setCode] = useState(initial?.code || '');
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || 'INTERNAL');
  const [purpose, setPurpose] = useState(initial?.purpose || 'SALEABLE');
  const [parentId, setParentId] = useState(initial?.parentId || '');
  const [isActive, setIsActive] = useState(initial ? !!initial.isActive : true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warehouseId || !code.trim() || !name.trim()) { setErr('Chọn kho, nhập mã và tên vị trí.'); return; }
    setSaving(true); setErr('');
    try {
      await saveStockLocation({
        id: initial?.id, warehouseId, code: code.trim(), name: name.trim(),
        type, purpose, parentId: parentId || null, isActive,
      });
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Lưu thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const parents = locations.filter((l) => l.warehouseId === warehouseId && l.id !== initial?.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{initial ? 'Sửa vị trí' : 'Thêm vị trí'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Kho</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required disabled={!!initial}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none disabled:bg-gray-50">
                <option value="">-- Chọn kho --</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mã</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="VD: A-01-02"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Tên</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Kệ A tầng 2"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Loại</label>
              <select value={type} onChange={(e) => setType(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mục đích</label>
              <select value={purpose} onChange={(e) => setPurpose(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Thuộc vị trí cha</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                <option value="">-- Không --</option>
                {parents.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4 rounded border-gray-300" />
                Hoạt động
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
              {saving ? 'Đang lưu...' : initial ? 'Lưu thay đổi' : 'Thêm vị trí'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
