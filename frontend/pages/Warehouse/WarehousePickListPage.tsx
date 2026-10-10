import { useCallback, useEffect, useState } from 'react';
import { ShoppingCart, Check } from 'lucide-react';
import { Card } from '../../components/UI';
import { completeTransaction, getTransactions, type WarehouseTransaction } from '../../services/warehouseService';
import { WarehouseDocumentBadge } from './dashboard/WarehouseDocumentBadge';
import { WarehouseStatusBadge } from './dashboard/WarehouseStatusBadge';
import { formatDate } from './dashboard/warehouseLabels';

export default function WarehousePickListPage() {
  const [rows, setRows] = useState<WarehouseTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getTransactions({ type: 'OUT' });
      setRows(data.filter((t) => t.status === 'pending' || t.status === 'approved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được danh sách lấy hàng.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleComplete = async (id: string) => {
    if (!window.confirm('Xác nhận đã lấy đủ hàng cho phiếu này?')) return;
    try {
      setActingId(id);
      setError(null);
      await completeTransaction(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hoàn thành thất bại');
    } finally {
      setActingId(null);
    }
  };

  const pending = rows.filter((r) => r.status === 'pending').length;
  const ready = rows.filter((r) => r.status === 'approved').length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
          <ShoppingCart className="text-emerald-500" /> Danh sách lấy hàng
        </h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">
          {rows.length} phiếu xuất cần lấy • {pending} chờ duyệt • {ready} sẵn sàng lấy
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error} <button onClick={load} className="font-bold underline ml-2">Thử lại</button>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[860px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase w-10 text-center">#</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã phiếu</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hàng hóa</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">SL</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Người xử lý</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hạn xử lý</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Lấy hàng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-400">Không có phiếu xuất nào cần lấy hàng.</td></tr>
              ) : (
                rows.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <td className="p-3 text-sm text-gray-500 text-center">{idx + 1}</td>
                    <td className="p-3 text-sm font-bold" title={row.transactionCode}>{row.transactionCode}</td>
                    <td className="p-3 text-sm">
                      <span className="font-bold">{row.productName}</span>
                      <span className="block text-xs text-gray-400">{row.productCode} • {row.fromLocation || row.toLocation || '-'}</span>
                    </td>
                    <td className="p-3 text-sm text-center font-bold">{Number(row.quantity).toLocaleString('vi-VN')}</td>
                    <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{row.assignedToName || row.requestedByName || '-'}</td>
                    <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{formatDate(row.dueDate)}</td>
                    <td className="p-3"><WarehouseStatusBadge status={row.status} /></td>
                    <td className="p-3 text-center">
                      {row.status === 'approved' ? (
                        <button
                          onClick={() => handleComplete(row.id)}
                          disabled={actingId === row.id}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          <Check size={13} /> Đã lấy đủ
                        </button>
                      ) : (
                        <WarehouseDocumentBadge type={row.type} />
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
