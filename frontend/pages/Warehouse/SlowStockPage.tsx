import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hourglass, RefreshCw, AlertCircle, ChevronDown } from 'lucide-react';
import { Card } from '../../components/UI';
import { getSlowStock, getWarehouses, type SlowStockRow, type Warehouse } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

const DAY_OPTIONS = [30, 60, 90, 180, 365];

// Tồn lâu TP (§26): còn tồn nhưng quá hạn không di chuyển.
export default function SlowStockPage({ deptKey }: { deptKey: DeptKey }) {
  const [rows, setRows] = useState<SlowStockRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [days, setDays] = useState(90);

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [s, w] = await Promise.all([
        getSlowStock(warehouseId || undefined, days),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setRows(s); setWarehouses(w);
    } catch (e: any) {
      setError(e.message || 'Không tải được tồn lâu');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [warehouseId, days]);

  const daysIdle = (iso: string | null) => {
    if (!iso) return null;
    return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Kho vận · Kiểm soát</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Tồn lâu</h1>
          <p className="text-gray-500 text-sm mt-1">Còn tồn nhưng không di chuyển trong số ngày đã chọn.</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}
              className="pl-4 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm appearance-none">
              {DAY_OPTIONS.map((d) => <option key={d} value={d}>Quá {d} ngày</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
          </div>
          <div className="relative">
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
              className="pl-4 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm appearance-none">
              <option value="">Tất cả kho (phạm vi của tôi)</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
          </div>
          <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
            <RefreshCw size={16} />
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
          <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải tồn lâu...</p>
        </div>
      ) : rows.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <Hourglass size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Không có tồn lâu quá {days} ngày</p>
          <p className="text-sm mt-1">Hàng hóa luân chuyển tốt.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-2 px-5 text-xs font-bold text-gray-500 uppercase">Sản phẩm / Kho</th>
                  <th className="text-right py-2 px-4 text-xs font-bold text-gray-500 uppercase">Tồn</th>
                  <th className="text-right py-2 px-4 text-xs font-bold text-gray-500 uppercase">Khả dụng</th>
                  <th className="text-left py-2 px-5 text-xs font-bold text-gray-500 uppercase">Di chuyển cuối</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => {
                  const idle = daysIdle(r.lastMoveAt);
                  return (
                    <tr key={`${r.productId}|${r.warehouseId}`} className="hover:bg-gray-50/70">
                      <td className="py-2 px-5">
                        <p className="font-semibold text-gray-800">{r.productName || r.productId}</p>
                        <p className="text-xs text-gray-400">{r.warehouseName || r.warehouseId}</p>
                      </td>
                      <td className="py-2 px-4 text-right font-black text-gray-900">{Number(r.onHand).toLocaleString('vi-VN')}</td>
                      <td className="py-2 px-4 text-right text-gray-500">{Number(r.available).toLocaleString('vi-VN')}</td>
                      <td className="py-2 px-5 text-xs">
                        {idle == null
                          ? <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-bold">Chưa từng di chuyển</span>
                          : <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-bold">{idle} ngày trước</span>}
                      </td>
                    </tr>
                  );
                })}
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
