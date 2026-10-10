import { useCallback, useEffect, useState } from 'react';
import { BookmarkPlus, Plus } from 'lucide-react';
import { Card } from '../../components/UI';
import { useData } from '../../contexts/DataContext';
import {
  createReservation, getReservations, getStockBalances, getStockProducts, getWarehouses, releaseReservation,
  type Reservation, type StockBalance, type StockProduct, type Warehouse,
} from '../../services/stockMasterService';

const STATUS_META: Record<string, { label: string; badge: string }> = {
  ACTIVE: { label: 'Đang giữ', badge: 'bg-blue-100 text-blue-700' },
  RELEASED: { label: 'Đã giải phóng', badge: 'bg-slate-100 text-slate-500' },
  CONSUMED: { label: 'Đã xuất', badge: 'bg-emerald-100 text-emerald-700' },
};

const SOURCE_LABELS: Record<string, string> = {
  INTERNAL: 'Nội bộ', SALES_ORDER: 'Đơn bán hàng', PROJECT: 'Dự án', WARRANTY: 'Bảo hành',
};

export default function StockReservationsPage() {
  const { users } = useData();
  const [rows, setRows] = useState<Reservation[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<StockProduct[]>([]);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [form, setForm] = useState({
    productId: '', warehouseId: '', qty: '1', sourceType: 'INTERNAL',
    sourceId: '', assigneeId: '', expiresAt: '', notes: '',
  });
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [list, wh, prods, bals] = await Promise.all([
        getReservations(statusFilter || undefined),
        getWarehouses(),
        getStockProducts(),
        getStockBalances(),
      ]);
      setRows(list);
      setWarehouses(wh.filter((w) => w.isActive));
      setProducts(prods);
      setBalances(bals);
      setForm((f) => ({ ...f, warehouseId: f.warehouseId || (wh[0]?.id || '') }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được giữ hàng.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const availableFor = (productId: string, warehouseId: string): number => {
    return balances
      .filter((b) => b.productId === productId && b.warehouseId === warehouseId)
      .reduce((s, b) => s + Number(b.available), 0);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    (async () => {
      try {
        setActing(true);
        setError(null);
        await createReservation({
          productId: form.productId,
          warehouseId: form.warehouseId,
          qty: Number(form.qty),
          sourceType: form.sourceType,
          sourceId: form.sourceId.trim() || undefined,
          assigneeId: form.assigneeId || undefined,
          expiresAt: form.expiresAt || undefined,
          notes: form.notes.trim() || undefined,
        });
        setShowForm(false);
        setForm({ productId: '', warehouseId: form.warehouseId, qty: '1', sourceType: 'INTERNAL', sourceId: '', assigneeId: '', expiresAt: '', notes: '' });
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Giữ hàng thất bại');
      } finally {
        setActing(false);
      }
    })();
  };

  const handleRelease = async (row: Reservation) => {
    const remaining = Number(row.qty) - Number(row.qtyConsumed);
    if (!window.confirm(`Giải phóng ${remaining} đang giữ cho '${row.productCode}'?`)) return;
    try {
      setError(null);
      await releaseReservation(row.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Giải phóng thất bại');
    }
  };

  const inputCls = 'px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100';
  const selectedAvailable = form.productId && form.warehouseId ? availableFor(form.productId, form.warehouseId) : null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <BookmarkPlus className="text-emerald-500" /> Giữ hàng / Phân bổ
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">
            {rows.filter((r) => r.status === 'ACTIVE').length} đang giữ • Chỉ giữ từ tồn khả dụng, không sinh biến động tồn
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-1"
        >
          <Plus size={15} /> Giữ hàng mới
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      {showForm && (
        <Card className="p-4">
          <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-3">Giữ hàng mới</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Hàng hóa *
              <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className={inputCls}>
                <option value="">-- Chọn hàng hóa --</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Kho *
              <select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} className={inputCls}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Số lượng giữ *
              <input
                type="number" min="0" step="any" value={form.qty}
                onChange={(e) => setForm({ ...form, qty: e.target.value })} className={inputCls} />
              {selectedAvailable !== null && (
                <span className="text-xs text-gray-400">Khả dụng hiện tại: {selectedAvailable.toLocaleString('vi-VN')}</span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Nguồn nhu cầu
              <select value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })} className={inputCls}>
                <option value="INTERNAL">Nội bộ</option>
                <option value="SALES_ORDER">Đơn bán hàng</option>
                <option value="PROJECT">Dự án</option>
                <option value="WARRANTY">Bảo hành</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Mã nguồn (VD: SO-001)
              <input value={form.sourceId} onChange={(e) => setForm({ ...form, sourceId: e.target.value })} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Người xử lý
              <select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })} className={inputCls}>
                <option value="">-- Không chỉ định --</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Hết hạn giữ
              <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300 md:col-span-2">
              Ghi chú
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} />
            </label>
            <div className="md:col-span-3 flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm">Hủy</button>
              <button type="submit" disabled={acting || !form.productId || !form.warehouseId}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                Giữ hàng
              </button>
            </div>
          </form>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {[
          { value: '', label: 'Tất cả' },
          { value: 'ACTIVE', label: 'Đang giữ' },
          { value: 'CONSUMED', label: 'Đã xuất' },
          { value: 'RELEASED', label: 'Đã giải phóng' },
        ].map((t) => (
          <button
            key={t.value || 'all'}
            onClick={() => setStatusFilter(t.value)}
            className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
              statusFilter === t.value
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
          <table className="w-full text-left border-collapse min-w-[860px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Nguồn / Hàng hóa</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kho / Người giữ</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Giữ / Đã xuất</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hết hạn</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Không có giữ hàng nào.</td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <td className="p-3 text-sm">
                      <span className="font-bold">{row.productName}</span>
                      <span className="block text-xs text-gray-400">
                        {row.productCode} • {SOURCE_LABELS[row.sourceType] || row.sourceType}{row.sourceId ? ` ${row.sourceId}` : ''}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-gray-600 dark:text-slate-300">
                      {row.warehouseName || row.warehouseCode}
                      <span className="block text-xs text-gray-400">{row.assigneeName || row.createdByName || '-'}</span>
                    </td>
                    <td className="p-3 text-sm text-center font-bold">
                      {Number(row.qty).toLocaleString('vi-VN')} / {Number(row.qtyConsumed).toLocaleString('vi-VN')}
                    </td>
                    <td className="p-3 text-sm">
                      {row.expiresAt ? row.expiresAt.slice(0, 10) : '-'}
                      {row.isExpired ? (
                        <span className="ml-1 px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded text-[10px] font-bold">Hết hạn</span>
                      ) : null}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded font-bold text-xs ${STATUS_META[row.status]?.badge || ''}`}>
                        {STATUS_META[row.status]?.label || row.status}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      {row.status === 'ACTIVE' ? (
                        <button
                          onClick={() => handleRelease(row)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold"
                        >
                          Giải phóng
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
