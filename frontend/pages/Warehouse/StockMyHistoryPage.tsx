import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { Card } from '../../components/UI';
import { getStockDocuments, getStockMoves, type StockDocument, type StockMove } from '../../services/stockMasterService';

const DOC_TYPE_LABELS: Record<string, string> = {
  RECEIPT: 'Nhập kho', ISSUE: 'Xuất kho', TRANSFER: 'Điều chuyển', ADJUSTMENT: 'Điều chỉnh',
};

export default function StockMyHistoryPage() {
  const [docs, setDocs] = useState<StockDocument[]>([]);
  const [moves, setMoves] = useState<StockMove[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [done, movesPage] = await Promise.all([
        getStockDocuments({ status: 'DONE,CANCELLED' }),
        getStockMoves({ page: 1, pageSize: 50 }),
      ]);
      setDocs(done);
      setMoves(movesPage.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được lịch sử.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
          <History className="text-emerald-500" /> Lịch sử xử lý
        </h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">
          Phiếu đã xử lý và thao tác của bạn
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error} <button onClick={load} className="font-bold underline ml-2">Thử lại</button>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700">
          <h2 className="font-bold text-gray-800 dark:text-slate-100">Phiếu đã xử lý ({docs.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[640px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Loại</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kho</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kết quả</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : docs.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">Chưa có phiếu nào đã xử lý.</td></tr>
              ) : (
                docs.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <td className="p-3 text-sm font-bold">{d.code}</td>
                    <td className="p-3 text-sm">{DOC_TYPE_LABELS[d.type] || d.type}</td>
                    <td className="p-3 text-sm text-gray-500">{d.warehouseName || d.warehouseCode}</td>
                    <td className="p-3 text-sm">
                      <span className={`px-2 py-1 rounded font-bold text-xs ${d.status === 'DONE' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                        {d.status === 'DONE' ? 'Hoàn thành' : 'Đã hủy'}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-gray-500">
                      {Number(d.qtyReceived).toLocaleString('vi-VN')}/{Number(d.qtyOrdered).toLocaleString('vi-VN')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700">
          <h2 className="font-bold text-gray-800 dark:text-slate-100">Thao tác gần đây</h2>
        </div>
        {moves.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Chưa có thao tác nào.</p>
        ) : (
          <ul className="divide-y divide-gray-50 dark:divide-slate-700/50">
            {moves.slice(0, 20).map((m) => (
              <li key={m.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>
                  <span className="font-bold">{m.moveType}</span>
                  <span className="text-gray-500"> • {m.productCode} • {m.docCode || ''}</span>
                </span>
                <span className={`font-black ${m.qty >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {m.qty >= 0 ? '+' : ''}{Number(m.qty).toLocaleString('vi-VN')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
