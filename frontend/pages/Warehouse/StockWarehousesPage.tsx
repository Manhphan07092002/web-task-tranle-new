import { useCallback, useEffect, useState } from 'react';
import { Factory, Plus, Pencil, Trash2, MapPin } from 'lucide-react';
import { Card } from '../../components/UI';
import {
  createWarehouse, createWarehouseLocation, deleteWarehouse, deleteWarehouseLocation,
  getWarehouses, getWarehouseLocations, updateWarehouse, updateWarehouseLocation,
  type Warehouse, type WarehouseLocation,
} from '../../services/stockMasterService';

const TYPE_LABELS: Record<string, string> = {
  INTERNAL: 'Nội bộ', SUPPLIER: 'Nhà cung cấp', CUSTOMER: 'Khách hàng',
  TRANSIT: 'Trung chuyển', LOSS: 'Hao hụt', ADJUSTMENT: 'Điều chỉnh',
};
const PURPOSE_LABELS: Record<string, string> = {
  SALEABLE: 'Bán được', WARRANTY: 'Bảo hành', DAMAGED: 'Hàng lỗi', DEMO: 'Trưng bày',
  QUARANTINE: 'Cách ly', PICKING: 'Soạn hàng', RECEIVING: 'Nhận hàng', OTHER: 'Khác',
};

const EMPTY_WH = { code: '', name: '', region: '', address: '' };
const EMPTY_LOC = { code: '', name: '', type: 'INTERNAL', purpose: 'SALEABLE', parentId: '' };

export default function StockWarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWhForm, setShowWhForm] = useState(false);
  const [editingWh, setEditingWh] = useState<Warehouse | null>(null);
  const [whForm, setWhForm] = useState({ ...EMPTY_WH });
  const [showLocForm, setShowLocForm] = useState(false);
  const [editingLoc, setEditingLoc] = useState<WarehouseLocation | null>(null);
  const [locForm, setLocForm] = useState({ ...EMPTY_LOC });
  const [acting, setActing] = useState(false);

  const loadWarehouses = useCallback(async () => {
    const list = await getWarehouses();
    setWarehouses(list);
    if (!selectedId && list.length > 0) setSelectedId(list[0].id);
    if (selectedId && !list.some((w) => w.id === selectedId)) {
      setSelectedId(list.length > 0 ? list[0].id : '');
    }
  }, [selectedId]);

  const loadLocations = useCallback(async () => {
    if (!selectedId) {
      setLocations([]);
      return;
    }
    setLocations(await getWarehouseLocations(selectedId));
  }, [selectedId]);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      await loadWarehouses();
      await loadLocations();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được kho / vị trí.');
    } finally {
      setLoading(false);
    }
  }, [loadWarehouses, loadLocations]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const selected = warehouses.find((w) => w.id === selectedId);
  const inputCls = 'px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100';

  const submitWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActing(true);
      setError(null);
      if (editingWh) {
        await updateWarehouse(editingWh.id, { name: whForm.name.trim(), region: whForm.region.trim() || undefined, address: whForm.address.trim() || undefined });
      } else {
        const created: any = await createWarehouse({ code: whForm.code.trim(), name: whForm.name.trim(), region: whForm.region.trim() || undefined, address: whForm.address.trim() || undefined });
        setSelectedId(created.id);
      }
      setShowWhForm(false);
      setEditingWh(null);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu kho thất bại');
    } finally {
      setActing(false);
    }
  };

  const removeWarehouse = async (row: Warehouse) => {
    if (!window.confirm(`Xóa kho '${row.code}'?`)) return;
    try {
      setError(null);
      await deleteWarehouse(row.id);
      setSelectedId('');
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xóa kho thất bại');
    }
  };

  const submitLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) {
      setError('Chọn kho trước khi thêm vị trí.');
      return;
    }
    try {
      setActing(true);
      setError(null);
      if (editingLoc) {
        await updateWarehouseLocation(editingLoc.id, {
          name: locForm.name.trim(), type: locForm.type, purpose: locForm.purpose,
          parentId: locForm.parentId || null,
        });
      } else {
        await createWarehouseLocation({
          warehouseId: selectedId, code: locForm.code.trim(), name: locForm.name.trim(),
          type: locForm.type, purpose: locForm.purpose, parentId: locForm.parentId || undefined,
        });
      }
      setShowLocForm(false);
      setEditingLoc(null);
      await loadLocations();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu vị trí thất bại');
    } finally {
      setActing(false);
    }
  };

  const removeLocation = async (row: WarehouseLocation) => {
    if (!window.confirm(`Xóa vị trí '${row.code}'?`)) return;
    try {
      setError(null);
      await deleteWarehouseLocation(row.id);
      await loadLocations();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xóa vị trí thất bại');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <Factory className="text-emerald-500" /> Kho &amp; Vị trí
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">
            {warehouses.length} kho • Mã vị trí kiểu HX-A-02-03 (Kho / Khu / Kệ / Tầng)
          </p>
        </div>
        <button
          onClick={() => { setEditingWh(null); setWhForm({ ...EMPTY_WH }); setShowWhForm(true); }}
          className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-1"
        >
          <Plus size={15} /> Thêm kho
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      {showWhForm && (
        <Card className="p-4">
          <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-3">{editingWh ? `Sửa kho ${editingWh.code}` : 'Thêm kho mới'}</h2>
          <form onSubmit={submitWarehouse} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Mã kho *
              <input value={whForm.code} disabled={!!editingWh} onChange={(e) => setWhForm({ ...whForm, code: e.target.value })}
                placeholder="VD: HX" className={`${inputCls} disabled:opacity-60`} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Tên kho *
              <input value={whForm.name} onChange={(e) => setWhForm({ ...whForm, name: e.target.value })}
                placeholder="VD: Kho Hòa Xuân" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Khu vực
              <input value={whForm.region} onChange={(e) => setWhForm({ ...whForm, region: e.target.value })}
                placeholder="VD: Đà Nẵng" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Địa chỉ
              <input value={whForm.address} onChange={(e) => setWhForm({ ...whForm, address: e.target.value })}
                placeholder="Địa chỉ kho" className={inputCls} />
            </label>
            <div className="md:col-span-4 flex justify-end gap-2">
              <button type="button" onClick={() => { setShowWhForm(false); setEditingWh(null); }}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm">Hủy</button>
              <button type="submit" disabled={acting}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                {editingWh ? 'Lưu' : 'Thêm kho'}
              </button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="p-4">
          <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-3">Danh sách kho</h2>
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-6">Đang tải...</p>
          ) : warehouses.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Chưa có kho nào.</p>
          ) : (
            <ul className="space-y-2">
              {warehouses.map((w) => (
                <li key={w.id}>
                  <div
                    onClick={() => setSelectedId(w.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                      selectedId === w.id
                        ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800'
                        : 'bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700 hover:border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-gray-800 dark:text-slate-100">
                        {w.code} - {w.name}
                      </p>
                      <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => { setEditingWh(w); setWhForm({ code: w.code, name: w.name, region: w.region || '', address: w.address || '' }); setShowWhForm(true); }}
                          title="Sửa kho" className="p-1 text-blue-500 hover:bg-blue-50 rounded-lg"><Pencil size={14} /></button>
                        <button onClick={() => removeWarehouse(w)} title="Xóa kho" className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 size={14} /></button>
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                      {w.region || 'Chưa rõ khu vực'} • {w.locationCount} vị trí {w.managerName ? `• QL: ${w.managerName}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-2 overflow-hidden p-0">
          <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
            <h2 className="font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
              <MapPin size={16} className="text-emerald-600" />
              Vị trí {selected ? `kho ${selected.code}` : ''} ({locations.length})
            </h2>
            {selectedId && (
              <button
                onClick={() => { setEditingLoc(null); setShowLocForm(true); }}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1"
              >
                <Plus size={13} /> Thêm vị trí
              </button>
            )}
          </div>

          {showLocForm && (
            <form
              onSubmit={submitLocation}
              className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 border-b border-gray-100 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/40"
            >
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                Mã vị trí *
                <input value={locForm.code} disabled={!!editingLoc} placeholder="VD: HX-A-02-03"
                  onChange={(e) => setLocForm({ ...locForm, code: e.target.value })} className={`${inputCls} disabled:opacity-60`} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                Tên vị trí *
                <input value={locForm.name} placeholder="VD: Kệ A-02 tầng 3"
                  onChange={(e) => setLocForm({ ...locForm, name: e.target.value })} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                Thuộc vị trí cha
                <select value={locForm.parentId} onChange={(e) => setLocForm({ ...locForm, parentId: e.target.value })} className={inputCls}>
                  <option value="">-- Gốc (trực thuộc kho) --</option>
                  {locations.filter((l) => l.id !== editingLoc?.id).map((l) => (
                    <option key={l.id} value={l.id}>{l.code} - {l.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                Loại
                <select value={locForm.type} onChange={(e) => setLocForm({ ...locForm, type: e.target.value })} className={inputCls}>
                  {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                Mục đích
                <select value={locForm.purpose} onChange={(e) => setLocForm({ ...locForm, purpose: e.target.value })} className={inputCls}>
                  {Object.entries(PURPOSE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <div className="flex items-end gap-2">
                <button type="button" onClick={() => { setShowLocForm(false); setEditingLoc(null); }}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs">Hủy</button>
                <button type="submit" disabled={acting}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs disabled:opacity-50">
                  {editingLoc ? 'Lưu' : 'Thêm'}
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[560px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã / Tên</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Loại / Mục đích</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                {!selectedId ? (
                  <tr><td colSpan={3} className="p-8 text-center text-gray-400">Chọn một kho để xem vị trí.</td></tr>
                ) : locations.length === 0 ? (
                  <tr><td colSpan={3} className="p-8 text-center text-gray-400">Kho chưa có vị trí nào.</td></tr>
                ) : (
                  locations.map((loc) => (
                    <tr key={loc.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                      <td className="p-3 text-sm">
                        <span className="font-bold">{loc.code}</span>
                        <span className="block text-gray-600 dark:text-slate-300">{loc.name}</span>
                        {loc.parentCode && <span className="block text-[11px] text-gray-400">thuộc {loc.parentCode}{loc.childCount > 0 ? ` • ${loc.childCount} vị trí con` : ''}</span>}
                      </td>
                      <td className="p-3 text-sm text-gray-600 dark:text-slate-300">
                        {TYPE_LABELS[loc.type] || loc.type} / {PURPOSE_LABELS[loc.purpose] || loc.purpose}
                      </td>
                      <td className="p-3 text-center">
                        <span className="inline-flex gap-1">
                          <button
                            onClick={() => {
                              setEditingLoc(loc);
                              setShowLocForm(true);
                            }}
                            title="Sửa" className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg"><Pencil size={15} /></button>
                          <button onClick={() => removeLocation(loc)} title="Xóa" className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 size={15} /></button>
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
