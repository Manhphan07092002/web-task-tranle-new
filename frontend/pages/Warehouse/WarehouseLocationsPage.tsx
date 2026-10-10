import { Fragment, useCallback, useEffect, useState } from 'react';
import { MapPin, Package, TriangleAlert, Plus, Pencil, Trash2 } from 'lucide-react';
import { Card } from '../../components/UI';
import { useRBAC } from '../../hooks/useRBAC';
import {
  assignItemLocation, createLocation, deleteLocation, getInventory, getLocations, updateLocation,
  type InventoryItem, type LocationsResponse, type WarehouseLocationRow,
} from '../../services/warehouseService';

const TYPE_LABELS: Record<string, string> = {
  warehouse: 'Kho', zone: 'Khu vực', rack: 'Giá kệ', bin: 'Ô chứa', legacy: 'Vị trí cũ',
};

const EMPTY_FORM = { code: '', name: '', type: 'zone', parentId: '', notes: '' };

export default function WarehouseLocationsPage() {
  const { canApprove } = useRBAC();
  const isManager = canApprove('warehouse');
  const [data, setData] = useState<LocationsResponse | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WarehouseLocationRow | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [locs, inv] = await Promise.all([getLocations(), getInventory()]);
      setData(locs);
      setInventory(inv);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được vị trí kho.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  };

  const openEdit = (row: WarehouseLocationRow) => {
    setEditing(row);
    setForm({ code: row.code, name: row.name, type: row.type === 'legacy' ? 'zone' : row.type, parentId: row.parentId || '', notes: '' });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      setError('Mã và tên vị trí là bắt buộc.');
      return;
    }
    try {
      setActing(true);
      setError(null);
      if (editing?.id) {
        await updateLocation(editing.id, {
          name: form.name.trim(), type: form.type,
          parentId: form.parentId || null, notes: form.notes.trim() || undefined,
        });
      } else {
        await createLocation({
          code: form.code.trim(), name: form.name.trim(), type: form.type,
          parentId: form.parentId || undefined, notes: form.notes.trim() || undefined,
        });
      }
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu vị trí thất bại');
    } finally {
      setActing(false);
    }
  };

  const handleDelete = async (row: WarehouseLocationRow) => {
    if (!row.id) return;
    if (!window.confirm(`Xóa vị trí '${row.code}'?`)) return;
    try {
      setError(null);
      await deleteLocation(row.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xóa vị trí thất bại');
    }
  };

  const handleAssign = async (itemId: string, code: string | null) => {
    try {
      setError(null);
      await assignItemLocation(itemId, code);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xếp vị trí thất bại');
    }
  };

  const masterCodes = (data?.locations || []).filter((l) => l.id).map((l) => l.code);
  const filtered = (data?.locations || []).filter((r) =>
    r.code.toLowerCase().includes(search.toLowerCase()) ||
    r.name.toLowerCase().includes(search.toLowerCase())
  );
  const itemsOf = (code: string | null) => inventory.filter((i) =>
    code === null ? !i.warehouseLocation : i.warehouseLocation === code
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <MapPin className="text-emerald-500" /> Vị trí kho
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">
            {(data?.locations.length || 0)} vị trí • {Number(data?.unassigned.itemCount || 0)} mặt hàng chưa xếp vị trí
          </p>
        </div>
        {isManager && (
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-1"
          >
            <Plus size={15} /> Thêm kho / vị trí
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error} <button onClick={load} className="font-bold underline ml-2">Thử lại</button>
        </div>
      )}

      {showForm && (
        <Card className="p-4">
          <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-3">
            {editing ? `Sửa vị trí ${editing.code}` : 'Thêm kho / vị trí mới'}
          </h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Mã vị trí *
              <input
                value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="VD: KHO-A, A-01-02" disabled={!!editing}
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Tên vị trí *
              <input
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="VD: Kho A - Khu hàng điện" className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Loại
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100">
                <option value="warehouse">Kho</option>
                <option value="zone">Khu vực</option>
                <option value="rack">Giá kệ</option>
                <option value="bin">Ô chứa</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Thuộc (vị trí cha)
              <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100">
                <option value="">-- Không có --</option>
                {(data?.locations || []).filter((l) => l.id && l.id !== editing?.id).map((l) => (
                  <option key={l.id as string} value={l.id as string}>{l.code} - {l.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300 md:col-span-2">
              Ghi chú
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Ghi chú thêm..." className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100" />
            </label>
            <div className="md:col-span-3 flex justify-end gap-2">
              <button type="button" onClick={() => { setShowForm(false); setEditing(null); }}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm">
                Hủy
              </button>
              <button type="submit" disabled={acting}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                {editing ? 'Lưu' : 'Thêm vị trí'}
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700">
          <input
            type="text" placeholder="Tìm vị trí (VD: Khu A, A-01-02...)"
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/50 focus:ring-2 focus:ring-emerald-500 text-gray-800 dark:text-slate-100"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Vị trí</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Loại</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Mặt hàng</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Tổng SL</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Cảnh báo tồn</th>
                {isManager && <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thao tác</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : (
                <>
                  {filtered.map((row) => (
                    <Fragment key={row.id || row.code}>
                      <tr
                        key={row.id || row.code}
                        className="hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer"
                        onClick={() => setExpandedCode(expandedCode === row.code ? null : row.code)}
                      >
                        <td className="p-3 text-sm font-bold text-gray-800 dark:text-slate-100">
                          <span className="flex items-center gap-2">
                            <MapPin size={14} className="text-emerald-500 shrink-0" />
                            {row.code}
                            <span className="font-normal text-gray-500">- {row.name}</span>
                          </span>
                          {row.parentCode && <span className="block text-[11px] font-normal text-gray-400 ml-6">thuộc {row.parentCode}</span>}
                        </td>
                        <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{TYPE_LABELS[row.type] || row.type}</td>
                        <td className="p-3 text-sm text-center">
                          <span className="inline-flex items-center gap-1 font-bold"><Package size={13} className="text-blue-500" />{Number(row.itemCount)}</span>
                        </td>
                        <td className="p-3 text-sm text-center font-bold">{Number(row.totalQuantity).toLocaleString('vi-VN')}</td>
                        <td className="p-3 text-sm text-center">
                          {Number(row.alertCount) > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-rose-100 text-rose-700 rounded font-bold text-xs">
                              <TriangleAlert size={12} /> {Number(row.alertCount)}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">Ổn định</span>
                          )}
                        </td>
                        {isManager && (
                          <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                            {row.id ? (
                              <span className="inline-flex gap-1">
                                <button onClick={() => openEdit(row)} title="Sửa"
                                  className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg"><Pencil size={15} /></button>
                                <button onClick={() => handleDelete(row)} title="Xóa"
                                  className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 size={15} /></button>
                              </span>
                            ) : (
                              <span className="text-[11px] text-gray-400">Vị trí cũ</span>
                            )}
                          </td>
                        )}
                      </tr>
                      {expandedCode === row.code && (
                        <tr key={`${row.code}-items`}>
                          <td colSpan={6} className="p-0 bg-gray-50/60 dark:bg-slate-800/40">
                            <div className="p-4">
                              <p className="text-xs font-bold text-gray-500 uppercase mb-2">
                                Hàng hóa tại {row.code} ({itemsOf(row.code).length})
                              </p>
                              {itemsOf(row.code).length === 0 ? (
                                <p className="text-sm text-gray-400">Chưa có hàng hóa nào ở vị trí này.</p>
                              ) : (
                                <ul className="divide-y divide-gray-100 dark:divide-slate-700/50 bg-white dark:bg-slate-800 rounded-xl overflow-hidden">
                                  {itemsOf(row.code).map((item) => (
                                    <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                                      <span className="font-bold flex-1 min-w-[180px]">
                                        {item.productName}
                                        <span className="block text-xs font-normal text-gray-400">
                                          {item.productCode} • SL: {Number(item.quantity).toLocaleString('vi-VN')} {item.unit}
                                        </span>
                                      </span>
                                      <select
                                        value={item.warehouseLocation || ''}
                                        onChange={(e) => handleAssign(item.id, e.target.value || null)}
                                        className="text-xs px-2 py-1.5 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                                        title="Chuyển vị trí"
                                      >
                                        {masterCodes.map((code) => (
                                          <option key={code} value={code}>{code}</option>
                                        ))}
                                        <option value="">Bỏ vị trí</option>
                                      </select>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {data && Number(data.unassigned.itemCount) > 0 && (
                    <>
                      <tr
                        className="hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer bg-amber-50/50 dark:bg-amber-900/10"
                        onClick={() => setExpandedCode(expandedCode === '__unassigned' ? null : '__unassigned')}
                      >
                        <td className="p-3 text-sm font-bold text-gray-800 dark:text-slate-100">
                          <span className="flex items-center gap-2">
                            <MapPin size={14} className="text-amber-500 shrink-0" /> Chưa xếp vị trí
                          </span>
                        </td>
                        <td className="p-3 text-sm text-gray-500">-</td>
                        <td className="p-3 text-sm text-center font-bold">{Number(data.unassigned.itemCount)}</td>
                        <td className="p-3 text-sm text-center font-bold">{Number(data.unassigned.totalQuantity).toLocaleString('vi-VN')}</td>
                        <td className="p-3 text-sm text-center">
                          {Number(data.unassigned.alertCount) > 0 ? (
                            <span className="text-rose-600 font-bold text-xs">{Number(data.unassigned.alertCount)} cảnh báo</span>
                          ) : (
                            <span className="text-gray-400 text-xs">Ổn định</span>
                          )}
                        </td>
                        {isManager && <td className="p-3" />}
                      </tr>
                      {expandedCode === '__unassigned' && (
                        <tr>
                          <td colSpan={6} className="p-0 bg-gray-50/60 dark:bg-slate-800/40">
                            <div className="p-4">
                              <p className="text-xs font-bold text-gray-500 uppercase mb-2">
                                Xếp hàng vào vị trí ({itemsOf(null).length})
                              </p>
                              {masterCodes.length === 0 ? (
                                <p className="text-sm text-gray-400">Chưa có vị trí nào trong danh mục — bấm "Thêm kho / vị trí" ở trên.</p>
                              ) : (
                                <ul className="divide-y divide-gray-100 dark:divide-slate-700/50 bg-white dark:bg-slate-800 rounded-xl overflow-hidden">
                                  {itemsOf(null).map((item) => (
                                    <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                                      <span className="font-bold flex-1 min-w-[180px]">
                                        {item.productName}
                                        <span className="block text-xs font-normal text-gray-400">
                                          {item.productCode} • SL: {Number(item.quantity).toLocaleString('vi-VN')} {item.unit}
                                        </span>
                                      </span>
                                      <select
                                        defaultValue=""
                                        onChange={(e) => e.target.value && handleAssign(item.id, e.target.value)}
                                        className="text-xs px-2 py-1.5 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                                      >
                                        <option value="">-- Chọn vị trí --</option>
                                        {masterCodes.map((code) => (
                                          <option key={code} value={code}>{code}</option>
                                        ))}
                                      </select>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                  {filtered.length === 0 && Number(data?.unassigned.itemCount || 0) === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-gray-400">Không có vị trí nào.</td></tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
