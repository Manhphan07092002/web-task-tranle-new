import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TriangleAlert, Plus } from 'lucide-react';
import { Card } from '../../components/UI';
import { getDashboard, type InventoryAlertItem } from '../../services/warehouseService';

export default function WarehouseAlertsPage() {
  const [items, setItems] = useState<InventoryAlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getDashboard({ top: 100 });
      setItems(data.inventoryAlerts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được cảnh báo tồn.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = items.filter((i) =>
    i.productName.toLowerCase().includes(search.toLowerCase()) ||
    i.productCode.toLowerCase().includes(search.toLowerCase())
  );
  const totalShortage = items.reduce((s, i) => s + Number(i.shortage), 0);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
          <TriangleAlert className="text-rose-500" /> Cảnh báo tồn
        </h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">
          {items.length} mặt hàng dưới mức tối thiểu • Thiếu tổng {totalShortage.toLocaleString('vi-VN')}
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error} <button onClick={load} className="font-bold underline ml-2">Thử lại</button>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700">
          <input
            type="text"
            placeholder="Tìm mặt hàng..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/50 focus:ring-2 focus:ring-emerald-500 text-gray-800 dark:text-slate-100"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase w-10 text-center">#</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mặt hàng</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Tồn hiện tại</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Tối thiểu</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Còn thiếu</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Không có cảnh báo tồn. 🎉</td></tr>
              ) : (
                filtered.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <td className="p-3 text-sm text-gray-500 text-center">{idx + 1}</td>
                    <td className="p-3 text-sm">
                      <span className="font-bold">{item.productName}</span>
                      <span className="block text-xs text-gray-400">{item.productCode} • {item.warehouseLocation || '-'}</span>
                    </td>
                    <td className="p-3 text-sm text-center font-bold text-rose-600">
                      {Number(item.quantity).toLocaleString('vi-VN')} {item.unit}
                    </td>
                    <td className="p-3 text-sm text-center">{Number(item.minStockLevel).toLocaleString('vi-VN')}</td>
                    <td className="p-3 text-sm text-center font-bold text-amber-600">
                      {Number(item.shortage).toLocaleString('vi-VN')}
                    </td>
                    <td className="p-3 text-center">
                      <Link
                        to={`/warehouse?type=IN&create=1&productCode=${encodeURIComponent(item.productCode)}&productName=${encodeURIComponent(item.productName)}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold"
                      >
                        <Plus size={13} /> Tạo phiếu nhập
                      </Link>
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
