import { Fragment, useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Plus, Play, Check, X } from 'lucide-react';
import { Card } from '../../components/UI';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import {
  approveCountVariance, closeStockCount, createStockCount, getStockCountDetail,
  getStockCounts, getWarehouses, getWarehouseLocations, recountCountLine, recordCountedQty,
  snapshotStockCount, updateStockCount,
  type StockCount, type Warehouse, type WarehouseLocation,
} from '../../services/stockMasterService';

const NV_TABS = [
  { value: '', label: 'Việc của tôi', statuses: [] },
  { value: 'IN_PROGRESS', label: 'Đang đếm', statuses: ['in_progress'] },
  { value: 'DONE', label: 'Đã hoàn thành', statuses: ['done'] },
];
const TP_TABS = [
  { value: '', label: 'Tất cả', statuses: [] },
  { value: 'IN_PROGRESS', label: 'Đang đếm', statuses: ['in_progress'] },
  { value: 'RECONCILING', label: 'Chờ đối chiếu', statuses: ['reconciling'] },
  { value: 'VARIANCE', label: 'Có chênh lệch', statuses: ['reconciling'] },
  { value: 'DONE', label: 'Đã hoàn thành', statuses: ['done'] },
];

const STATUS_META: Record<string, { label: string; badge: string }> = {
  planned: { label: 'Đã lên kế hoạch', badge: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'Đang đếm', badge: 'bg-blue-100 text-blue-700' },
  reconciling: { label: 'Chờ đối chiếu', badge: 'bg-amber-100 text-amber-700' },
  done: { label: 'Hoàn thành', badge: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Đã hủy', badge: 'bg-rose-100 text-rose-700' },
};

const LINE_STATUS_META: Record<string, { label: string; badge: string }> = {
  pending: { label: 'Chưa đếm', badge: 'bg-slate-100 text-slate-500' },
  counted: { label: 'Đã đếm', badge: 'bg-blue-100 text-blue-700' },
  approved: { label: 'Đã duyệt', badge: 'bg-purple-100 text-purple-700' },
  resolved: { label: 'Đã xử lý', badge: 'bg-emerald-100 text-emerald-700' },
};

export default function StockCountsPage() {
  const { user } = useAuth();
  const { users } = useData();
  const isManager = (user?.permissions || []).includes('stock.manage');
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [tab, setTab] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<(StockCount & { lines: import('../../services/stockMasterService').StockCountLine[] }) | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ warehouseId: '', locationId: '', blindCount: true, assigneeId: '', notes: '' });
  const [countInputs, setCountInputs] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [acting, setActing] = useState(false);

  const tabs = isManager ? TP_TABS : NV_TABS;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      let all = await getStockCounts();
      if (tab === 'VARIANCE') {
        all = all.filter((c) => c.varianceCount > 0);
      } else {
        const active = tabs.find((t) => t.value === tab);
        if (active && active.statuses.length > 0) {
          all = all.filter((c) => active.statuses.includes(c.status));
        }
      }
      setCounts(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được đợt kiểm kê.');
    } finally {
      setLoading(false);
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const wh = await getWarehouses();
        const active = wh.filter((w) => w.isActive);
        setWarehouses(active);
        if (active.length > 0) {
          setForm((f) => ({ ...f, warehouseId: f.warehouseId || active[0].id }));
          setLocations(await getWarehouseLocations(active[0].id));
        }
      } catch { /* optional */ }
    })();
  }, []);

  const onWarehouseChange = async (warehouseId: string) => {
    setForm((f) => ({ ...f, warehouseId, locationId: '' }));
    try {
      setLocations(await getWarehouseLocations(warehouseId));
    } catch { setLocations([]); }
  };

  const openDetail = async (count: StockCount) => {
    if (expandedId === count.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    try {
      setExpandedId(count.id);
      setDetail(await getStockCountDetail(count.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được chi tiết.');
    }
  };

  const runAction = async (fn: () => Promise<unknown>, detailId?: string) => {
    try {
      setActing(true);
      setError(null);
      await fn();
      await load();
      if (detailId) {
        try {
          setDetail(await getStockCountDetail(detailId));
        } catch { /* keep old */ }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Thao tác thất bại');
    } finally {
      setActing(false);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    runAction(() => createStockCount({
      warehouseId: form.warehouseId,
      locationId: form.locationId || undefined,
      blindCount: form.blindCount,
      assigneeId: form.assigneeId || undefined,
      notes: form.notes.trim() || undefined,
    }).then(() => {
      setShowForm(false);
      setForm({ warehouseId: form.warehouseId, locationId: '', blindCount: true, assigneeId: '', notes: '' });
    }));
  };

  const inputCls = 'px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <ClipboardCheck className="text-emerald-500" /> Kiểm kê
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">
            {isManager ? 'Tạo đợt, đối chiếu chênh lệch, duyệt và chốt điều chỉnh tồn.' : 'Nhập số lượng thực tế các dòng được giao (không thấy số sổ sách).'}
          </p>
        </div>
        {isManager && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-1"
          >
            <Plus size={15} /> Tạo đợt kiểm kê
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      {showForm && (
        <Card className="p-4">
          <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-3">Tạo đợt kiểm kê mới</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Kho *
              <select value={form.warehouseId} onChange={(e) => onWarehouseChange(e.target.value)} className={inputCls}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Khu vực (để trống = toàn kho)
              <select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} className={inputCls}>
                <option value="">Toàn kho</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.code} - {l.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Người kiểm kê
              <select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })} className={inputCls}>
                <option value="">-- Chưa phân công --</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-slate-300">
              <input
                type="checkbox" checked={form.blindCount}
                onChange={(e) => setForm({ ...form, blindCount: e.target.checked })}
                className="w-4 h-4 accent-emerald-600" />
              Kiểm mù (NV không thấy số sổ sách)
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300 md:col-span-2">
              Ghi chú
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} />
            </label>
            <div className="md:col-span-3 flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm">Hủy</button>
              <button type="submit" disabled={acting || !form.warehouseId}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                Tạo đợt
              </button>
            </div>
          </form>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.value || 'all'}
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

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Đợt kiểm kê</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kho / Người đếm</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Đã đếm</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Chênh lệch</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : counts.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Không có đợt kiểm kê nào.</td></tr>
              ) : (
                counts.map((count) => (
                  <Fragment key={count.id}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer" onClick={() => openDetail(count)}>
                      <td className="p-3 text-sm font-bold">
                        {count.code}
                        {count.blindCount ? <span className="ml-1 text-[10px] font-black text-purple-600">MÙ</span> : null}
                      </td>
                      <td className="p-3 text-sm text-gray-600 dark:text-slate-300">
                        {count.warehouseName || count.warehouseId}
                        <span className="block text-xs text-gray-400">{count.assigneeName || 'Chưa phân công'}</span>
                      </td>
                      <td className="p-3 text-sm text-center font-bold">{count.countedCount}/{count.lineCount}</td>
                      <td className="p-3 text-sm text-center font-bold">
                        {count.varianceCount > 0 ? (
                          <span className="text-rose-600">{count.varianceCount} lệch</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded font-bold text-xs ${STATUS_META[count.status]?.badge || ''}`}>
                          {STATUS_META[count.status]?.label || count.status}
                        </span>
                      </td>
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex gap-1 flex-wrap justify-center">
                          {isManager && count.status === 'planned' && (
                            <button disabled={acting}
                              onClick={() => runAction(() => snapshotStockCount(count.id), expandedId === count.id ? count.id : undefined)}
                              className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[11px] font-bold disabled:opacity-50">
                              Chụp tồn
                            </button>
                          )}
                          {isManager && (count.status === 'planned' || count.status === 'in_progress') && (
                            <button disabled={acting}
                              onClick={() => runAction(() => updateStockCount(count.id, { status: 'in_progress' }), expandedId === count.id ? count.id : undefined)}
                              className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[11px] font-bold disabled:opacity-50">
                              <Play size={12} className="inline" /> Đếm
                            </button>
                          )}
                          {isManager && count.status === 'reconciling' && (
                            <button disabled={acting}
                              onClick={() => runAction(() => closeStockCount(count.id), expandedId === count.id ? count.id : undefined)}
                              className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-[11px] font-bold disabled:opacity-50">
                              <Check size={12} className="inline" /> Chốt
                            </button>
                          )}
                          {isManager && ['planned', 'in_progress'].includes(count.status) && (
                            <button disabled={acting}
                              onClick={() => runAction(() => updateStockCount(count.id, { status: 'cancelled' }), expandedId === count.id ? count.id : undefined)}
                              className="px-2 py-1 text-rose-500 hover:bg-rose-50 rounded-lg text-[11px] font-bold disabled:opacity-50">
                              <X size={12} className="inline" /> Hủy
                            </button>
                          )}
                          {!isManager && count.status === 'planned' && (
                            <button disabled={acting}
                              onClick={() => runAction(() => updateStockCount(count.id, { status: 'in_progress' }), expandedId === count.id ? count.id : undefined)}
                              className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[11px] font-bold disabled:opacity-50">
                              <Play size={12} className="inline" /> Bắt đầu đếm
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                    {expandedId === count.id && (
                      <tr key={`${count.id}-lines`}>
                        <td colSpan={6} className="p-0 bg-gray-50/60 dark:bg-slate-800/40">
                          <div className="p-4">
                            <p className="text-xs font-bold text-gray-500 uppercase mb-2">
                              Danh mục kiểm kê ({detail?.lines?.length || 0})
                              {detail?.notes ? ` • ${detail.notes}` : ''}
                            </p>
                            {!detail ? (
                              <p className="text-sm text-gray-400">Đang tải...</p>
                            ) : detail.lines.length === 0 ? (
                              <p className="text-sm text-gray-400">
                                Chưa chụp tồn — {isManager ? 'bấm nút "Chụp tồn" ở trên.' : 'chờ Trưởng kho chụp tồn.'}
                              </p>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-left min-w-[640px] bg-white dark:bg-slate-800 rounded-xl overflow-hidden">
                                  <thead>
                                    <tr className="border-b border-gray-100 dark:border-slate-700">
                                      <th className="p-2 text-xs font-bold text-gray-500 uppercase">Mặt hàng</th>
                                      <th className="p-2 text-xs font-bold text-gray-500 uppercase text-center">Sổ sách</th>
                                      <th className="p-2 text-xs font-bold text-gray-500 uppercase text-center">Thực tế</th>
                                      <th className="p-2 text-xs font-bold text-gray-500 uppercase text-center">Chênh lệch</th>
                                      <th className="p-2 text-xs font-bold text-gray-500 uppercase text-center">Trạng thái / Thao tác</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                                    {detail.lines.map((line) => {
                                      const variance = line.countedQty !== null && line.systemQty !== null
                                        ? Number(line.countedQty) - Number(line.systemQty) : null;
                                      const canCount = detail.status === 'in_progress' && line.status !== 'resolved';
                                      return (
                                        <tr key={line.id}>
                                          <td className="p-2 text-xs font-bold">
                                            {line.productName}
                                            <span className="block font-normal text-gray-400">{line.productCode}</span>
                                          </td>
                                          <td className="p-2 text-xs text-center font-bold">
                                            {line.systemQty === null ? (
                                              <span className="text-purple-500 tracking-widest">•••</span>
                                            ) : (
                                              Number(line.systemQty).toLocaleString('vi-VN')
                                            )}
                                          </td>
                                          <td className="p-2 text-xs text-center font-bold">
                                            {line.countedQty !== null ? Number(line.countedQty).toLocaleString('vi-VN') : '-'}
                                          </td>
                                          <td className={`p-2 text-xs text-center font-bold ${variance !== null && variance !== 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                                            {variance === null ? '-' : `${variance > 0 ? '+' : ''}${variance.toLocaleString('vi-VN')}`}
                                          </td>
                                          <td className="p-2 text-center">
                                            <div className="flex flex-col items-center gap-1">
                                              <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${LINE_STATUS_META[line.status]?.badge || ''}`}>
                                                {LINE_STATUS_META[line.status]?.label || line.status}
                                              </span>
                                              {canCount && (
                                                <span className="inline-flex gap-1">
                                                  <input
                                                    type="number" min="0" step="any" placeholder="SL thực tế"
                                                    value={countInputs[line.id] ?? ''}
                                                    onChange={(e) => setCountInputs((prev) => ({ ...prev, [line.id]: e.target.value }))}
                                                    className="w-24 px-2 py-1 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                                                  />
                                                  <button
                                                    disabled={acting}
                                                    onClick={() => {
                                                      const val = Number(countInputs[line.id]);
                                                      if (countInputs[line.id] === '' || Number.isNaN(val) || val < 0) {
                                                        setError('Nhập số lượng thực tế hợp lệ.');
                                                        return;
                                                      }
                                                      runAction(() => recordCountedQty(detail.id, line.id, val), detail.id);
                                                    }}
                                                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold disabled:opacity-50"
                                                  >
                                                    Lưu
                                                  </button>
                                                </span>
                                              )}
                                              {isManager && detail.status === 'reconciling' && line.status === 'counted' && variance !== null && variance !== 0 && (
                                                <span className="inline-flex gap-1 w-full max-w-[280px]">
                                                  <input
                                                    value={resolutions[line.id] ?? ''}
                                                    onChange={(e) => setResolutions((prev) => ({ ...prev, [line.id]: e.target.value }))}
                                                    placeholder="Phương án xử lý..."
                                                    className="flex-1 px-2 py-1 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                                                  />
                                                  <button
                                                    disabled={acting}
                                                    onClick={() => {
                                                      const text = (resolutions[line.id] || '').trim();
                                                      if (!text) {
                                                        setError('Nhập phương án xử lý trước khi duyệt.');
                                                        return;
                                                      }
                                                      runAction(() => approveCountVariance(detail.id, line.id, text), detail.id);
                                                    }}
                                                    className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-[11px] font-bold disabled:opacity-50"
                                                  >
                                                    Duyệt
                                                  </button>
                                                </span>
                                              )}
                                              {isManager && (detail.status === 'in_progress' || detail.status === 'reconciling') && line.status !== 'resolved' && (
                                                <button
                                                  disabled={acting}
                                                  onClick={() => runAction(() => recountCountLine(detail.id, line.id), detail.id)}
                                                  className="text-[11px] font-bold text-amber-600 hover:underline disabled:opacity-50"
                                                >
                                                  Yêu cầu đếm lại
                                                </button>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
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
