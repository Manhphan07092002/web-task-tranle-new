import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Search } from 'lucide-react';
import { Card } from '../../components/UI';
import { useAuth } from '../../contexts/AuthContext';
import {
  getProductStock, getStock, getWarehouses,
  type ProductStockDetail, type StockLocationRow, type StockSummaryRow, type Warehouse,
} from '../../services/stockMasterService';
import { ProductStockDrawer } from './ProductStockDrawer';

type View = 'summary' | 'by-location';

const STATUS_META: Record<string, { label: string; badge: string }> = {
  ok: { label: 'Bình thường', badge: 'bg-emerald-100 text-emerald-700' },
  low: { label: 'Thấp', badge: 'bg-amber-100 text-amber-700' },
  out: { label: 'Hết hàng', badge: 'bg-rose-100 text-rose-700' },
};

const PAGE_SIZES = [20, 50, 100];

export default function StockInventoryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isManager = (user?.permissions || []).includes('stock.manage');
  const [view, setView] = useState<View>('summary');
  const [rows, setRows] = useState<(StockSummaryRow | StockLocationRow)[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [tracking, setTracking] = useState('');
  const [status, setStatus] = useState('');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [drawerProductId, setDrawerProductId] = useState<string | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<ProductStockDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const load = useCallback(async (p: number, ps: number) => {
    try {
      setLoading(true);
      setError(null);
      const data = await getStock({
        view,
        search: search.trim() || undefined,
        warehouseId: warehouseId || undefined,
        category: category.trim() || undefined,
        brand: brand.trim() || undefined,
        tracking: tracking || undefined,
        status: status || undefined,
        page: p, pageSize: ps,
      });
      setRows(data.rows);
      setTotal(data.total);
      setPage(data.page);
      setPageSize(data.pageSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được tồn kho.');
    } finally {
      setLoading(false);
    }
  }, [view, search, warehouseId, category, brand, tracking, status]);

  useEffect(() => { load(1, pageSize); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    getWarehouses().then((list) => setWarehouses(list.filter((w) => w.isActive))).catch(() => {});
  }, []);

  const applyFilters = () => load(1, pageSize);

  const openDrawer = async (productId: string) => {
    setDrawerProductId(productId);
    setDrawerDetail(null);
    setDrawerLoading(true);
    try {
      setDrawerDetail(await getProductStock(productId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được chi tiết.');
      setDrawerProductId(null);
    } finally {
      setDrawerLoading(false);
    }
  };

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const rangeFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = Math.min(page * pageSize, total);
  const filterCls = 'px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm text-gray-800 dark:text-slate-100';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
          <Package className="text-emerald-500" /> Tồn kho
        </h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">
          Số liệu ưu tiên <span className="font-bold text-emerald-700">Khả dụng</span> (thực tồn − đã giữ) • {total.toLocaleString('vi-VN')} dòng
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {([
          { value: 'summary', label: 'Tổng hợp' },
          { value: 'by-location', label: 'Theo kho / vị trí' },
          { value: 'serials', label: 'Serial / Lô' },
          { value: 'combos', label: 'Combo / Bộ sản phẩm' },
        ] as { value: View | 'serials' | 'combos'; label: string }[]).map((t) => {
          const future = t.value === 'serials' || t.value === 'combos';
          return (
            <button
              key={t.value}
              disabled={future}
              onClick={() => !future && setView(t.value as View)}
              title={future ? (t.value === 'serials' ? 'Triển khai ở Phase B' : 'Triển khai ở Phase C') : undefined}
              className={`px-4 py-2 rounded-xl font-bold text-sm transition-all inline-flex items-center gap-1.5 ${
                view === t.value
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : future
                    ? 'bg-gray-50 dark:bg-slate-800 text-gray-400 border border-gray-100 dark:border-slate-700 cursor-not-allowed'
                    : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 border border-gray-200 dark:border-slate-700'
              }`}
            >
              {t.label}
              {future && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-700">
                  {t.value === 'serials' ? 'B' : 'C'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="relative lg:col-span-2">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              placeholder="Tìm mã hàng, tên hàng, model, serial..."
              className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/50 text-sm focus:ring-2 focus:ring-emerald-500 text-gray-800 dark:text-slate-100"
            />
          </div>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={filterCls} aria-label="Lọc kho">
            <option value="">Tất cả kho</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
          </select>
          <div className="flex gap-2">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${filterCls} flex-1`} aria-label="Lọc trạng thái">
              <option value="">Mọi trạng thái</option>
              <option value="ok">Bình thường</option>
              <option value="low">Sắp hết</option>
              <option value="out">Hết hàng</option>
            </select>
            <button onClick={applyFilters} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold">Lọc</button>
          </div>
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Nhóm hàng" className={filterCls} />
          <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Thương hiệu" className={filterCls} />
          <select value={tracking} onChange={(e) => setTracking(e.target.value)} className={filterCls} aria-label="Lọc truy vết">
            <option value="">Mọi truy vết</option>
            <option value="NONE">Không</option>
            <option value="LOT">Lô</option>
            <option value="SERIAL">Serial</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[860px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã hàng / Sản phẩm</th>
                {view === 'by-location' && <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kho / Vị trí</th>}
                {isManager && <th className="p-3 text-xs font-bold text-gray-500 uppercase text-right">Đang về</th>}
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-right">Khả dụng</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-right">Đã giữ</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-right">Thực tồn</th>
                {isManager && <th className="p-3 text-xs font-bold text-gray-500 uppercase text-right">Min</th>}
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-400">Không có dữ liệu tồn kho.</td></tr>
              ) : (
                rows.map((r: any) => (
                  <tr key={view === 'summary' ? r.productId : `${r.productId}-${r.warehouseId}-${r.locationId}`}
                    className="hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer"
                    onClick={() => openDrawer(r.productId)}>
                    <td className="p-3 text-sm">
                      <span className="font-bold">{r.productCode}</span>
                      <span className="block text-gray-600 dark:text-slate-300">{r.productName}</span>
                    </td>
                    {view === 'by-location' && (
                      <td className="p-3 text-sm text-gray-600 dark:text-slate-300">
                        {r.warehouseCode}{r.locationCode ? ` / ${r.locationCode}` : ''}
                      </td>
                    )}
                    {isManager && <td className="p-3 text-sm text-right text-gray-500">{Number(r.incoming || 0).toLocaleString('vi-VN')}</td>}
                    <td className="p-3 text-sm text-right font-black text-emerald-700 dark:text-emerald-300">
                      {Number(r.available).toLocaleString('vi-VN')}
                    </td>
                    <td className="p-3 text-sm text-right">{Number(r.reserved).toLocaleString('vi-VN')}</td>
                    <td className="p-3 text-sm text-right text-gray-500">{Number(r.onHand).toLocaleString('vi-VN')}</td>
                    {isManager && <td className="p-3 text-sm text-right text-gray-500">{Number(r.minStock || 0).toLocaleString('vi-VN')}</td>}
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded font-bold text-xs ${STATUS_META[r.status]?.badge || ''}`}>
                        {STATUS_META[r.status]?.label || r.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 border-t border-gray-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-bold">Tổng số <span className="text-gray-800 dark:text-slate-100">{total.toLocaleString('vi-VN')}</span></span>
          <div className="flex items-center gap-2 text-gray-500">
            <span>Số dòng/trang</span>
            <select
              value={pageSize}
              onChange={(e) => load(Number(1), Number(e.target.value))}
              className="px-2 py-1 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100"
            >
              {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="font-semibold">{rangeFrom} - {rangeTo}</span>
            <button disabled={page <= 1} onClick={() => load(page - 1, pageSize)}
              className="px-2 py-1 border rounded-lg disabled:opacity-40">‹</button>
            <button disabled={page >= totalPages} onClick={() => load(page + 1, pageSize)}
              className="px-2 py-1 border rounded-lg disabled:opacity-40">›</button>
          </div>
        </div>
      </Card>

      {drawerProductId && (
        <ProductStockDrawer
          detail={drawerDetail}
          loading={drawerLoading}
          isManager={isManager}
          onClose={() => { setDrawerProductId(null); setDrawerDetail(null); }}
          onTransfer={() => { setDrawerProductId(null); navigate('/warehouse/transfers'); }}
        />
      )}
    </div>
  );
}
