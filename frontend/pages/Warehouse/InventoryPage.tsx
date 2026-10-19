import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Search, AlertCircle, RefreshCw, ChevronDown } from 'lucide-react';
import { Card } from '../../components/UI';
import { Pagination } from '../../components/Pagination';
import { useAuth } from '../../contexts/AuthContext';
import { getStockBalances, getWarehouses, type StockBalanceRow, type Warehouse } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

// Trang Tồn kho Kho vận (§10–11): 1 trang chung, ưu tiên Available,
// backend enforce scope (NV chỉ kho được giao).
export default function InventoryPage({ deptKey }: { deptKey: DeptKey }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<StockBalanceRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    getWarehouses().then(setWarehouses).catch(() => {});
  }, []);

  const fetchRows = async () => {
    setLoading(true); setError(null);
    try {
      const result = await getStockBalances({
        warehouseId: warehouseId || undefined, q: debouncedQ || undefined, purpose: purpose || undefined,
        // Lấy dư một dòng để xác định còn trang sau, tránh tạo trang rỗng
        // khi tổng số dòng chia hết cho pageSize.
        limit: pageSize + 1, offset: (page - 1) * pageSize,
      });
      setHasMore(result.length > pageSize);
      setRows(result.slice(0, pageSize));
    } catch (e: any) {
      setError(e.message || 'Không tải được tồn kho');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setPage(1); }, [warehouseId, debouncedQ, purpose]);
  useEffect(() => { fetchRows(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [warehouseId, debouncedQ, purpose, page, pageSize]);

  const stats = useMemo(() => {
    const sku = new Set(rows.map((r) => r.productId)).size;
    const out = rows.filter((r) => Number(r.available) <= 0).length;
    const reserved = rows.filter((r) => Number(r.reserved) > 0).length;
    return [
      { label: 'Dòng tồn', value: rows.length },
      { label: 'SKU', value: sku },
      { label: 'Hết hàng', value: out },
      { label: 'Đang giữ', value: reserved },
    ];
  }, [rows]);

  const statusOf = (r: StockBalanceRow) => {
    if (Number(r.available) <= 0) return { label: 'Hết hàng', cls: 'bg-red-50 text-red-600 border-red-200' };
    if (Number(r.reserved) > 0) return { label: 'Có giữ hàng', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { label: 'Bình thường', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Kho vận · Tồn kho</p>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 mt-1">Tồn kho</h1>
        <p className="text-gray-500 text-sm mt-1">
          {user ? `Xin chào ${user.name} — ` : ''}số liệu khả dụng được ưu tiên hiển thị. Hàng bảo hành/lỗi/demo/cách ly không tính vào tồn bán được.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xl font-black text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-3 text-gray-400" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã hàng, tên hàng..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-emerald-200 outline-none shadow-sm" />
        </div>
        <div className="relative">
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
            className="pl-4 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm appearance-none">
            <option value="">Tất cả kho (phạm vi của tôi)</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
        </div>
        <div className="relative">
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)}
            className="pl-4 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm appearance-none">
            <option value="">Mọi trạng thái hàng</option>
            <option value="SALEABLE">Bán được</option>
            <option value="WARRANTY">Bảo hành</option>
            <option value="DAMAGED">Hàng lỗi</option>
            <option value="DEMO">Demo</option>
            <option value="QUARANTINE">Cách ly</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
        </div>
        <button onClick={() => fetchRows()} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
          <RefreshCw size={16} />
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải tồn kho...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center py-20 gap-3 text-red-500">
          <AlertCircle size={36} strokeWidth={1.5} /><p className="text-sm font-medium">{error}</p>
          <button onClick={() => fetchRows()} className="px-4 py-2 bg-red-50 rounded-xl text-sm">Thử lại</button>
        </div>
      ) : rows.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <Package size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Không có dòng tồn nào trong phạm vi của bạn</p>
          <p className="text-sm mt-1">Thử đổi kho, mục đích hàng hoặc từ khóa.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-2 px-5 text-xs font-bold text-gray-500 uppercase">Sản phẩm</th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">Kho / Vị trí</th>
                  <th className="text-right py-2 px-4 text-xs font-bold text-gray-500 uppercase">Khả dụng</th>
                  <th className="text-right py-2 px-4 text-xs font-bold text-gray-500 uppercase hidden lg:table-cell">Đã giữ</th>
                  <th className="text-right py-2 px-4 text-xs font-bold text-gray-500 uppercase">Thực tồn</th>
                  <th className="text-left py-2 px-5 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => {
                  const st = statusOf(r);
                  return (
                    <tr key={`${r.productId}|${r.warehouseId}|${r.locationId}`} className="hover:bg-gray-50/70">
                      <td className="py-2 px-5">
                        <p className="font-semibold text-gray-800">{r.productName || r.productId}</p>
                        <p className="text-xs text-gray-400 font-mono">{r.productId}</p>
                      </td>
                      <td className="py-2 px-4 text-gray-500 text-xs">
                        {r.warehouseName || r.warehouseId}
                        {r.locationCode && <span className="text-gray-400"> · {r.locationCode}</span>}
                      </td>
                      <td className="py-2 px-4 text-right font-black text-gray-900">{Number(r.available).toLocaleString('vi-VN')}</td>
                      <td className="py-2 px-4 text-right text-gray-500 hidden lg:table-cell">{Number(r.reserved).toLocaleString('vi-VN')}</td>
                      <td className="py-2 px-4 text-right text-gray-500">{Number(r.onHand).toLocaleString('vi-VN')}</td>
                      <td className="py-2 px-5"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${st.cls}`}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {!loading && rows.length > 0 && <Pagination currentPage={page} totalPages={hasMore ? page + 1 : page} onPageChange={setPage} itemsPerPage={pageSize} onItemsPerPageChange={(size) => { setPageSize(size); setPage(1); }} />}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}
