import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gauge, RefreshCw, AlertCircle, ChevronDown } from 'lucide-react';
import { Card } from '../../components/UI';
import { getStockPolicies, getWarehouses, type StockPolicyRow, type Warehouse } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

// Báo cáo Tồn Min / Max (§30.3): chính sách đã đặt theo hàng + kho.
export default function MinMaxPage({ deptKey }: { deptKey: DeptKey }) {
  const [rows, setRows] = useState<StockPolicyRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState('');

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [p, w] = await Promise.all([
        getStockPolicies(warehouseId || undefined),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setRows(p); setWarehouses(w);
    } catch (e: any) {
      setError(e.message || 'Không tải được chính sách tồn');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [warehouseId]);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Báo cáo</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Tồn Min / Max</h1>
          <p className="text-gray-500 text-sm mt-1">Ngưỡng cảnh báo đã đặt. Đặt/sửa ở trang Cảnh báo tồn kho.</p>
        </div>
        <div className="flex gap-2">
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
          <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải chính sách...</p>
        </div>
      ) : rows.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <Gauge size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Chưa đặt ngưỡng nào</p>
          <p className="text-sm mt-1">Mở Cảnh báo tồn kho → Đặt ngưỡng trên từng dòng.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-5 text-xs font-bold text-gray-500 uppercase">Sản phẩm / Kho</th>
                  <th className="text-right py-3 px-4 text-xs font-bold text-gray-500 uppercase">Min</th>
                  <th className="text-right py-3 px-4 text-xs font-bold text-gray-500 uppercase">Điểm đặt</th>
                  <th className="text-right py-3 px-4 text-xs font-bold text-gray-500 uppercase">Max</th>
                  <th className="text-right py-3 px-5 text-xs font-bold text-gray-500 uppercase">Lead (ngày)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => (
                  <tr key={`${r.productId}|${r.warehouseId}`} className="hover:bg-gray-50/70">
                    <td className="py-3 px-5">
                      <p className="font-semibold text-gray-800">{r.productName || r.productId}</p>
                      <p className="text-xs text-gray-400">{r.warehouseName || r.warehouseId}</p>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-700">{Number(r.minStock).toLocaleString('vi-VN')}</td>
                    <td className="py-3 px-4 text-right text-gray-700">{Number(r.reorderPoint).toLocaleString('vi-VN')}</td>
                    <td className="py-3 px-4 text-right text-gray-700">{Number(r.maxStock).toLocaleString('vi-VN')}</td>
                    <td className="py-3 px-5 text-right text-gray-500">{r.leadTimeDays}</td>
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
