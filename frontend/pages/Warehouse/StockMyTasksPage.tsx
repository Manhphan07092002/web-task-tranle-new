import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { Card } from '../../components/UI';
import { getStockDocuments, type StockDocument } from '../../services/stockMasterService';

const DOC_TYPE_LABELS: Record<string, string> = {
  RECEIPT: 'Nhập kho', ISSUE: 'Xuất kho', TRANSFER: 'Điều chuyển',
};
const DOC_STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'Chờ xử lý', RECEIVING: 'Đang nhận', PICKING: 'Đang soạn',
  READY: 'Chờ bàn giao', IN_TRANSIT: 'Đang vận chuyển', RECEIVED: 'Chờ nhận',
};
const DOC_ROUTES: Record<string, string> = {
  RECEIPT: '/warehouse/receipts', ISSUE: '/warehouse/issues', TRANSFER: '/warehouse/transfers',
};

const OPEN_STATUSES = ['CONFIRMED', 'RECEIVING', 'PICKING', 'IN_TRANSIT', 'READY'];

export default function StockMyTasksPage() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<StockDocument[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // Backend already scopes to own docs for level 10; TP sees all (their own tasks = assigned to them)
      const all = await getStockDocuments();
      setDocs(all.filter((d) => OPEN_STATUSES.includes(d.status)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được việc cần xử lý.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = typeFilter ? docs.filter((d) => d.type === typeFilter) : docs;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
          <ClipboardList className="text-emerald-500" /> Việc cần xử lý
        </h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">
          {visible.length} phiếu đang mở liên quan đến bạn
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error} <button onClick={load} className="font-bold underline ml-2">Thử lại</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {[
          { value: '', label: 'Tất cả' },
          { value: 'RECEIPT', label: 'Nhập kho' },
          { value: 'ISSUE', label: 'Xuất kho' },
          { value: 'TRANSFER', label: 'Điều chuyển' },
        ].map((t) => (
          <button
            key={t.value || 'all'}
            onClick={() => setTypeFilter(t.value)}
            className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
              typeFilter === t.value
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
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Loại</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Nội dung</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">SL</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hạn xử lý</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Không có việc tồn đọng. 🎉</td></tr>
              ) : (
                visible.map((d) => (
                  <tr
                    key={d.id}
                    className="hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer"
                    onClick={() => navigate(DOC_ROUTES[d.type] || '/warehouse/stock')}
                  >
                    <td className="p-3 text-sm font-bold">{d.code}</td>
                    <td className="p-3 text-sm">{DOC_TYPE_LABELS[d.type] || d.type}</td>
                    <td className="p-3 text-sm text-gray-600 dark:text-slate-300">
                      {d.warehouseName || d.warehouseCode}
                      {d.notes ? ` • ${d.notes}` : ''}
                    </td>
                    <td className="p-3 text-sm text-center font-bold">{Number(d.qtyOrdered).toLocaleString('vi-VN')}</td>
                    <td className="p-3 text-sm">
                      <span className="px-2 py-1 rounded font-bold text-xs bg-blue-100 text-blue-700">
                        {DOC_STATUS_LABELS[d.status] || d.status}
                      </span>
                    </td>
                    <td className="p-3 text-sm">{(d as any).dueDate || '-'}</td>
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
