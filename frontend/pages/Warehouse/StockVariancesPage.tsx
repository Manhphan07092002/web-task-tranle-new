import { useCallback, useEffect, useState } from 'react';
import { FileWarning } from 'lucide-react';
import { Card } from '../../components/UI';
import { getCountVariances, type CountVariance } from '../../services/stockMasterService';

export default function StockVariancesPage() {
  const [rows, setRows] = useState<CountVariance[]>([]);
  const [openOnly, setOpenOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setRows(await getCountVariances(openOnly));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được chênh lệch.');
    } finally {
      setLoading(false);
    }
  }, [openOnly]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
          <FileWarning className="text-amber-500" /> Chênh lệch kiểm kê
        </h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">
          {rows.length} chênh lệch • Sổ sách vs thực tế qua các kỳ kiểm kê
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error} <button onClick={load} className="font-bold underline ml-2">Thử lại</button>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox" checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
              className="w-4 h-4 accent-emerald-600"
            />
            Chỉ hiện chưa xử lý
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kỳ / Kho</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mặt hàng</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Sổ sách</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thực tế</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Chênh lệch</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Trạng thái / Xử lý</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Không có chênh lệch nào. 🎉</td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <td className="p-3 text-sm">
                      <span className="font-bold">{row.countCode}</span>
                      <span className="block text-xs text-gray-400">{row.warehouseCode} • {row.countStatus}</span>
                    </td>
                    <td className="p-3 text-sm">
                      <span className="font-bold">{row.productName}</span>
                      <span className="block text-xs text-gray-400">{row.productCode}</span>
                    </td>
                    <td className="p-3 text-sm text-center">{row.systemQty.toLocaleString('vi-VN')}</td>
                    <td className="p-3 text-sm text-center font-bold">{row.countedQty.toLocaleString('vi-VN')}</td>
                    <td className={`p-3 text-sm text-center font-black ${row.variance > 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                      {row.variance > 0 ? '+' : ''}{row.variance.toLocaleString('vi-VN')}
                    </td>
                    <td className="p-3 text-sm">
                      {row.status === 'resolved' ? (
                        <span className="text-emerald-600 font-bold text-xs">Đã xử lý{row.resolvedBy ? ` • ${row.counterName || ''}` : ''}</span>
                      ) : row.status === 'approved' ? (
                        <span className="text-purple-600 font-bold text-xs">Đã duyệt — chờ chốt kỳ</span>
                      ) : (
                        <span className="text-amber-600 font-bold text-xs">Chờ duyệt (xử lý ở trang Chờ duyệt)</span>
                      )}
                      {row.resolution && (
                        <span className="block text-xs text-gray-500 mt-0.5">{row.resolution}</span>
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
