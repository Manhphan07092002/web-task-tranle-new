import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Search, RefreshCw, AlertCircle, ChevronDown } from 'lucide-react';
import { Card } from '../../components/UI';
import { getStockBalances, type StockBalanceRow } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

// Danh mục hàng hóa theo tồn kho trong phạm vi (§TP quản trị, NV tra cứu scope).
// Khác catalog admin: không hiện giá vốn/nhập, chỉ số lượng theo kho.
export default function CatalogPage({ deptKey }: { deptKey: DeptKey }) {
  const [rows, setRows] = useState<StockBalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      setRows(await getStockBalances(debouncedQ ? { q: debouncedQ } : {}));
    } catch (e: any) {
      setError(e.message || 'Không tải được danh mục');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [debouncedQ]);

  const grouped = useMemo(() => {
    const map = new Map<string, { productId: string; productCode?: string | null; productName: string; onHand: number; reserved: number; available: number; warehouses: Set<string> }>();
    for (const r of rows) {
      const g = map.get(r.productId) || { productId: r.productId, productCode: r.productCode, productName: r.productName || r.productCode || r.productId, onHand: 0, reserved: 0, available: 0, warehouses: new Set<string>() };
      g.onHand += Number(r.onHand) || 0;
      g.reserved += Number(r.reserved) || 0;
      g.available += Number(r.available) || 0;
      if (r.warehouseName) g.warehouses.add(r.warehouseName);
      map.set(r.productId, g);
    }
    const list = [...map.values()];
    return onlyAvailable ? list.filter((g) => g.available > 0) : list;
  }, [rows, onlyAvailable]);

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Hàng hóa</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Danh mục hàng hóa</h1>
          <p className="text-gray-500 text-sm mt-1">{grouped.length} mặt hàng có tồn trong phạm vi của bạn.</p>
        </div>
        <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-3 text-gray-400" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã hàng, tên hàng..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-emerald-200 outline-none shadow-sm" />
        </div>
        <label className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm text-gray-600 shadow-sm cursor-pointer select-none">
          <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-emerald-600" />
          Chỉ hàng còn khả dụng
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          <AlertCircle size={15} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải danh mục...</p>
        </div>
      ) : grouped.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <Archive size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Không có mặt hàng nào</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="wh-table w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-2 px-5 text-xs font-bold text-gray-500 uppercase">Mặt hàng</th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">Kho có hàng</th>
                  <th className="text-right py-2 px-4 text-xs font-bold text-gray-500 uppercase">Khả dụng</th>
                  <th className="text-right py-2 px-4 text-xs font-bold text-gray-500 uppercase hidden lg:table-cell">Đã giữ</th>
                  <th className="text-right py-2 px-5 text-xs font-bold text-gray-500 uppercase">Thực tồn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {grouped.map((g) => (
                  <tr key={g.productId} className="hover:bg-gray-50/70">
                    <td className="py-2 px-5">
                      <p className="font-semibold text-gray-800">{g.productName}</p>
                      <p className="text-xs text-gray-400 font-mono" title={g.productId}>{g.productCode || g.productId}</p>
                    </td>
                    <td className="py-2 px-4 text-xs text-gray-500">{[...g.warehouses].join(', ') || '—'}</td>
                    <td className="py-2 px-4 text-right font-black text-gray-900">{g.available.toLocaleString('vi-VN')}</td>
                    <td className="py-2 px-4 text-right text-gray-500 hidden lg:table-cell">{g.reserved.toLocaleString('vi-VN')}</td>
                    <td className="py-2 px-5 text-right text-gray-500">{g.onHand.toLocaleString('vi-VN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}
