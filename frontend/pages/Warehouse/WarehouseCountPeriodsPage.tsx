import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Play, Check, X, Download } from 'lucide-react';
import { Card } from '../../components/UI';
import { useRBAC } from '../../hooks/useRBAC';
import { useData } from '../../contexts/DataContext';
import {
  createStockCount, getStockCountItems, getStockCounts, recordCountedQty,
  snapshotStockCount, updateStockCountStatus,
  type StockCountItem, type StockCountPeriod,
} from '../../services/warehouseService';
import { formatDate } from './dashboard/warehouseLabels';

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const PERIOD_STATUS: Record<string, { label: string; badge: string }> = {
  planned: { label: 'Đã lên kế hoạch', badge: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'Đang kiểm kê', badge: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Hoàn thành', badge: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Đã hủy', badge: 'bg-rose-100 text-rose-700' },
};

export default function WarehouseCountPeriodsPage() {
  const { canApprove } = useRBAC();
  const { users } = useData();
  const isManager = canApprove('warehouse');
  const [periods, setPeriods] = useState<StockCountPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, StockCountItem[]>>({});
  const [countInputs, setCountInputs] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ month: currentMonth(), location: '', assignedTo: '', notes: '' });
  const [showForm, setShowForm] = useState(false);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setPeriods(await getStockCounts());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được kỳ kiểm kê.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadItems = async (periodId: string) => {
    const data = await getStockCountItems(periodId);
    setItems((prev) => ({ ...prev, [periodId]: data.items }));
  };

  const toggleExpand = async (period: StockCountPeriod) => {
    if (expandedId === period.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(period.id);
    try {
      await loadItems(period.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được danh mục kiểm kê.');
    }
  };

  const runAction = async (fn: () => Promise<unknown>, refreshItemsFor?: string) => {
    try {
      setActing(true);
      setError(null);
      await fn();
      await load();
      if (refreshItemsFor) await loadItems(refreshItemsFor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Thao tác thất bại');
    } finally {
      setActing(false);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    runAction(() => createStockCount({
      month: form.month,
      location: form.location.trim() || undefined,
      assignedTo: form.assignedTo || undefined,
      notes: form.notes.trim() || undefined,
    }).then(() => {
      setForm({ month: currentMonth(), location: '', assignedTo: '', notes: '' });
      setShowForm(false);
    }));
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <ClipboardCheck className="text-emerald-500" /> Kỳ kiểm kê tháng
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">
            Lập kế hoạch, phân công, chốt số lượng thực tế từng mặt hàng.
          </p>
        </div>
        {isManager && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-sm"
          >
            {showForm ? 'Đóng' : '+ Lập kỳ kiểm kê'}
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
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Tháng *
              <input
                type="month" required value={form.month}
                onChange={(e) => setForm({ ...form, month: e.target.value })}
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Khu vực (để trống = toàn kho)
              <input
                value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="VD: Khu A"
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Người thực hiện
              <select
                value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100"
              >
                <option value="">-- Chọn --</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Ghi chú
              <input
                value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Ghi chú thêm..."
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100"
              />
            </label>
            <div className="md:col-span-4 flex justify-end">
              <button type="submit" disabled={acting} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                Tạo kỳ kiểm kê
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã kỳ</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Tháng / Khu vực</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Người thực hiện</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Tiến độ</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : periods.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Chưa có kỳ kiểm kê nào.</td></tr>
              ) : (
                periods.map((p) => (
                  <>
                    <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer" onClick={() => toggleExpand(p)}>
                      <td className="p-3 text-sm font-bold">{p.code}</td>
                      <td className="p-3 text-sm">{p.month}{p.location ? ` • ${p.location}` : ''}</td>
                      <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{p.assignedToName || '-'}</td>
                      <td className="p-3 text-sm text-center font-bold">
                        {p.countedCount}/{p.itemCount}
                        {p.varianceCount > 0 && <span className="ml-1 text-rose-600">({p.varianceCount} lệch)</span>}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded font-bold text-xs ${PERIOD_STATUS[p.status]?.badge || ''}`}>
                          {PERIOD_STATUS[p.status]?.label || p.status}
                        </span>
                      </td>
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-center gap-1 flex-wrap">
                          {isManager && p.status === 'planned' && (
                            <button onClick={() => runAction(() => updateStockCountStatus(p.id, 'in_progress'))} disabled={acting} title="Bắt đầu"
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-50"><Play size={15} /></button>
                          )}
                          {isManager && p.itemCount === 0 && p.status !== 'completed' && p.status !== 'cancelled' && (
                            <button onClick={() => runAction(() => snapshotStockCount(p.id), p.id)} disabled={acting} title="Nạp danh mục tồn kho"
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg disabled:opacity-50"><Download size={15} /></button>
                          )}
                          {isManager && (p.status === 'planned' || p.status === 'in_progress') && (
                            <button onClick={() => runAction(() => updateStockCountStatus(p.id, 'completed'))} disabled={acting} title="Hoàn thành kỳ"
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg disabled:opacity-50"><Check size={15} /></button>
                          )}
                          {isManager && (p.status === 'planned' || p.status === 'in_progress') && (
                            <button onClick={() => runAction(() => updateStockCountStatus(p.id, 'cancelled'))} disabled={acting} title="Hủy kỳ"
                              className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg disabled:opacity-50"><X size={15} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedId === p.id && (
                      <tr key={`${p.id}-items`}>
                        <td colSpan={6} className="p-0 bg-gray-50/60 dark:bg-slate-800/40">
                          <div className="p-4">
                            <p className="text-xs font-bold text-gray-500 uppercase mb-2">
                              Danh mục kiểm kê ({(items[p.id] || []).length}) • {p.createdByName ? `Tạo bởi ${p.createdByName}` : ''} {p.createdAt ? `• ${formatDate(p.createdAt)}` : ''}
                            </p>
                            {(items[p.id] || []).length === 0 ? (
                              <p className="text-sm text-gray-400">
                                {p.itemCount === 0 ? 'Chưa nạp danh mục — bấm nút Nạp danh mục tồn kho ở trên.' : 'Đang tải...'}
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
                                      <th className="p-2 text-xs font-bold text-gray-500 uppercase text-center">Chốt số</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                                    {items[p.id].map((item) => {
                                      const variance = item.countedQty !== null ? Number(item.countedQty) - Number(item.systemQty) : null;
                                      return (
                                        <tr key={item.id}>
                                          <td className="p-2 text-xs font-bold">{item.productName}
                                            <span className="block font-normal text-gray-400">{item.productCode}</span>
                                          </td>
                                          <td className="p-2 text-xs text-center">{Number(item.systemQty).toLocaleString('vi-VN')}</td>
                                          <td className="p-2 text-xs text-center font-bold">
                                            {item.countedQty !== null ? Number(item.countedQty).toLocaleString('vi-VN') : '-'}
                                          </td>
                                          <td className={`p-2 text-xs text-center font-bold ${variance !== null && variance !== 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                                            {variance === null ? '-' : `${variance > 0 ? '+' : ''}${variance.toLocaleString('vi-VN')}`}
                                          </td>
                                          <td className="p-2 text-center">
                                            {item.status === 'resolved' ? (
                                              <span className="text-[11px] font-bold text-emerald-600">Đã xử lý</span>
                                            ) : p.status === 'completed' || p.status === 'cancelled' ? (
                                              <span className="text-[11px] text-gray-400">-</span>
                                            ) : (
                                              <span className="inline-flex gap-1">
                                                <input
                                                  type="number" min="0" step="any" placeholder="SL thực tế"
                                                  value={countInputs[item.id] ?? ''}
                                                  onChange={(e) => setCountInputs((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                                  className="w-24 px-2 py-1 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                                                />
                                                <button
                                                  onClick={() => {
                                                    const val = Number(countInputs[item.id]);
                                                    if (countInputs[item.id] === '' || Number.isNaN(val) || val < 0) {
                                                      setError('Nhập số lượng thực tế hợp lệ.');
                                                      return;
                                                    }
                                                    runAction(() => recordCountedQty(p.id, item.id, val), p.id);
                                                  }}
                                                  disabled={acting}
                                                  className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold disabled:opacity-50"
                                                >
                                                  Lưu
                                                </button>
                                              </span>
                                            )}
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
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
