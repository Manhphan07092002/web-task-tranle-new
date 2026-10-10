import { useCallback, useEffect, useState } from 'react';
import { Package, Plus, Pencil, Trash2, Search } from 'lucide-react';
import { Card } from '../../components/UI';
import {
  createStockProduct, deleteStockProduct, getStockProducts, updateStockProduct,
  type StockProduct,
} from '../../services/stockMasterService';

const TRACKING_LABELS: Record<string, string> = { NONE: 'Không', LOT: 'Lô', SERIAL: 'Serial' };
const EMPTY_FORM = {
  code: '', name: '', brand: '', model: '', category: '', unit: 'pcs', tracking: 'NONE',
  warrantyMonths: '0', minStock: '0', maxStock: '0', reorderPoint: '0',
  requiresCertificates: false, notes: '',
};

export default function StockProductsPage() {
  const [rows, setRows] = useState<StockProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [trackingFilter, setTrackingFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StockProduct | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setRows(await getStockProducts({
        search: search.trim() || undefined,
        tracking: trackingFilter || undefined,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được danh mục hàng hóa.');
    } finally {
      setLoading(false);
    }
  }, [search, trackingFilter]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  };

  const openEdit = (row: StockProduct) => {
    setEditing(row);
    setForm({
      code: row.code, name: row.name, brand: row.brand || '', model: row.model || '',
      category: row.category || '', unit: row.unit, tracking: row.tracking,
      warrantyMonths: String(row.warrantyMonths), minStock: String(row.minStock),
      maxStock: String(row.maxStock), reorderPoint: String(row.reorderPoint),
      requiresCertificates: !!row.requiresCertificates, notes: '',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActing(true);
      setError(null);
      const payload = {
        ...(editing ? {} : { code: form.code.trim() }),
        name: form.name.trim(),
        brand: form.brand.trim() || undefined,
        model: form.model.trim() || undefined,
        category: form.category.trim() || undefined,
        unit: form.unit.trim() || 'pcs',
        tracking: form.tracking,
        warrantyMonths: Number(form.warrantyMonths) || 0,
        minStock: Number(form.minStock) || 0,
        maxStock: Number(form.maxStock) || 0,
        reorderPoint: Number(form.reorderPoint) || 0,
        requiresCertificates: form.requiresCertificates,
      };
      if (editing) {
        await updateStockProduct(editing.id, payload);
      } else {
        await createStockProduct(payload);
      }
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu hàng hóa thất bại');
    } finally {
      setActing(false);
    }
  };

  const handleDelete = async (row: StockProduct) => {
    if (!window.confirm(`Xóa hàng hóa '${row.code}'?`)) return;
    try {
      setError(null);
      await deleteStockProduct(row.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xóa thất bại');
    }
  };

  const inputCls = 'px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <Package className="text-emerald-500" /> Danh mục hàng hóa
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">
            {rows.length} SKU • Cấu hình tracking, bảo hành, Min/Max tồn kho
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-1"
        >
          <Plus size={15} /> Thêm hàng hóa
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      {showForm && (
        <Card className="p-4">
          <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-3">
            {editing ? `Sửa hàng hóa ${editing.code}` : 'Thêm hàng hóa mới'}
          </h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Mã hàng (SKU) *
              <input value={form.code} disabled={!!editing} onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="VD: SAJ-R6-10K-T2" className={`${inputCls} disabled:opacity-60`} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300 md:col-span-2">
              Tên hàng hóa *
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="VD: Biến tần SAJ 10K 3 pha" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Thương hiệu
              <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="VD: SAJ" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Model
              <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="VD: R6-10K-T2" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Nhóm hàng
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="VD: Biến tần" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Đơn vị
              <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Truy vết
              <select value={form.tracking} onChange={(e) => setForm({ ...form, tracking: e.target.value })} className={inputCls}>
                <option value="NONE">Không (hàng thường)</option>
                <option value="LOT">Theo lô</option>
                <option value="SERIAL">Theo serial</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Bảo hành (tháng)
              <input type="number" min="0" value={form.warrantyMonths} onChange={(e) => setForm({ ...form, warrantyMonths: e.target.value })} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Tồn tối thiểu
              <input type="number" min="0" step="any" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Tồn tối đa
              <input type="number" min="0" step="any" value={form.maxStock} onChange={(e) => setForm({ ...form, maxStock: e.target.value })} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Điểm đặt hàng lại
              <input type="number" min="0" step="any" value={form.reorderPoint} onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })} className={inputCls} />
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-slate-300">
              <input type="checkbox" checked={form.requiresCertificates}
                onChange={(e) => setForm({ ...form, requiresCertificates: e.target.checked })}
                className="w-4 h-4 accent-emerald-600" />
              Yêu cầu CO/CQ
            </label>
            <div className="md:col-span-3 flex justify-end gap-2">
              <button type="button" onClick={() => { setShowForm(false); setEditing(null); }}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm">Hủy</button>
              <button type="submit" disabled={acting}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                {editing ? 'Lưu' : 'Thêm'}
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm mã / tên / thương hiệu / model"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/50 text-sm focus:ring-2 focus:ring-emerald-500 text-gray-800 dark:text-slate-100"
            />
          </div>
          <select value={trackingFilter} onChange={(e) => setTrackingFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm" aria-label="Lọc truy vết">
            <option value="">Mọi loại truy vết</option>
            <option value="NONE">Không</option>
            <option value="LOT">Lô</option>
            <option value="SERIAL">Serial</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã / Tên</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Thương hiệu / Model</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Nhóm / ĐVT</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Truy vết</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Min / Max</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Chưa có hàng hóa nào.</td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <td className="p-3 text-sm">
                      <span className="font-bold">{row.code}</span>
                      <span className="block text-gray-700 dark:text-slate-200">{row.name}</span>
                    </td>
                    <td className="p-3 text-sm text-gray-600 dark:text-slate-300">
                      {row.brand || '-'} {row.model ? `/ ${row.model}` : ''}
                      {row.warrantyMonths > 0 && <span className="block text-xs text-gray-400">BH {row.warrantyMonths} tháng</span>}
                    </td>
                    <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{row.category || '-'} / {row.unit}</td>
                    <td className="p-3 text-sm text-center">
                      <span className={`px-2 py-1 rounded font-bold text-xs ${row.tracking === 'SERIAL' ? 'bg-purple-100 text-purple-700' : row.tracking === 'LOT' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                        {TRACKING_LABELS[row.tracking] || row.tracking}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-center">{Number(row.minStock)} / {Number(row.maxStock)}</td>
                    <td className="p-3 text-center">
                      <span className="inline-flex gap-1">
                        <button onClick={() => openEdit(row)} title="Sửa" className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg"><Pencil size={15} /></button>
                        <button onClick={() => handleDelete(row)} title="Xóa" className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 size={15} /></button>
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
  );
}
