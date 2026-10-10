import { useCallback, useEffect, useState } from 'react';
import { FileWarning } from 'lucide-react';
import { Card } from '../../components/UI';
import { useRBAC } from '../../hooks/useRBAC';
import { getVariances, resolveVariance, type VarianceItem } from '../../services/warehouseService';
import { WarehouseDashboardHeader } from './dashboard/WarehouseDashboardHeader';

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

export default function WarehouseVariancePage() {
  const { canApprove } = useRBAC();
  const isManager = canApprove('warehouse');
  const [rows, setRows] = useState<VarianceItem[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setRows(await getVariances({ month, unresolved: unresolvedOnly }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được biên bản.');
    } finally {
      setLoading(false);
    }
  }, [month, unresolvedOnly]);

  useEffect(() => { load(); }, [load]);

  const handleResolve = async (row: VarianceItem) => {
    const text = (resolutions[row.id] || '').trim();
    if (!text) {
      setError('Nhập phương án xử lý trước khi chốt.');
      return;
    }
    try {
      setActing(true);
      setError(null);
      await resolveVariance(row.periodId, row.id, text);
      setResolutions((prev) => ({ ...prev, [row.id]: '' }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xử lý thất bại');
    } finally {
      setActing(false);
    }
  };

  const unresolved = rows.filter((r) => r.status !== 'resolved').length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <WarehouseDashboardHeader
        title="Biên bản xử lý thừa / thiếu"
        subtitle={`${rows.length} chênh lệch kiểm kê ${month.slice(5)}/${month.slice(0, 4)} • ${unresolved} chưa xử lý.`}
        month={month}
        onMonthChange={setMonth}
      />

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error} <button onClick={load} className="font-bold underline ml-2">Thử lại</button>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox" checked={unresolvedOnly}
              onChange={(e) => setUnresolvedOnly(e.target.checked)}
              className="w-4 h-4 accent-emerald-600"
            />
            Chỉ hiện chưa xử lý
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kỳ / Mặt hàng</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Sổ sách</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thực tế</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Chênh lệch</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Phương án xử lý</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">Không có chênh lệch nào. 🎉</td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <td className="p-3 text-sm">
                      <span className="inline-flex items-center gap-1 font-bold"><FileWarning size={13} className="text-amber-500" />{row.productName}</span>
                      <span className="block text-xs text-gray-400">{row.productCode} • Kỳ {row.periodCode} ({row.month})</span>
                    </td>
                    <td className="p-3 text-sm text-center">{Number(row.systemQty).toLocaleString('vi-VN')}</td>
                    <td className="p-3 text-sm text-center font-bold">{Number(row.countedQty).toLocaleString('vi-VN')}</td>
                    <td className={`p-3 text-sm text-center font-black ${Number(row.variance) > 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                      {Number(row.variance) > 0 ? '+' : ''}{Number(row.variance).toLocaleString('vi-VN')}
                    </td>
                    <td className="p-3">
                      {row.status === 'resolved' ? (
                        <p className="text-xs text-gray-600 dark:text-slate-300">
                          <span className="font-bold text-emerald-600">Đã xử lý{row.resolvedByName ? ` bởi ${row.resolvedByName}` : ''}: </span>
                          {row.resolution}
                        </p>
                      ) : isManager ? (
                        <span className="flex gap-1">
                          <input
                            value={resolutions[row.id] || ''}
                            onChange={(e) => setResolutions((prev) => ({ ...prev, [row.id]: e.target.value }))}
                            placeholder="VD: Nhập bổ sung 5 cái, xác nhận hao hụt..."
                            className="flex-1 min-w-[200px] px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                          />
                          <button
                            onClick={() => handleResolve(row)} disabled={acting}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-50 shrink-0"
                          >
                            Chốt
                          </button>
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Chờ Trưởng kho xử lý</span>
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
