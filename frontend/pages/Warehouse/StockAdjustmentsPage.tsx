import { useCallback, useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Card } from '../../components/UI';
import { getStockDocuments, type StockDocument } from '../../services/stockMasterService';

export default function StockAdjustmentsPage() {
  const [docs, setDocs] = useState<StockDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setDocs(await getStockDocuments({ type: 'ADJUSTMENT' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được điều chỉnh tồn.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
          <SlidersHorizontal className="text-emerald-500" /> Điều chỉnh tồn
        </h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">
          Mọi điều chỉnh chỉ sinh từ chênh lệch kiểm kê đã duyệt — không nhập số tồn trực tiếp
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error} <button onClick={load} className="font-bold underline ml-2">Thử lại</button>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[680px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã điều chỉnh</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kho</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Dòng</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">SL điều chỉnh</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Nguồn / Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : docs.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">Chưa có điều chỉnh tồn nào.</td></tr>
              ) : (
                docs.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <td className="p-3 text-sm font-bold">{d.code}</td>
                    <td className="p-3 text-sm text-gray-500">{d.warehouseName || d.warehouseCode}</td>
                    <td className="p-3 text-sm text-center">{d.lineCount}</td>
                    <td className={`p-3 text-sm text-center font-black ${Number(d.qtyReceived) >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                      {Number(d.qtyReceived) >= 0 ? '+' : ''}{Number(d.qtyReceived).toLocaleString('vi-VN')}
                    </td>
                    <td className="p-3 text-sm text-gray-500">{d.notes || '-'}</td>
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
