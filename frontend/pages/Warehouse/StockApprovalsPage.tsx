import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckSquare, FileWarning } from 'lucide-react';
import { Card } from '../../components/UI';
import {
  approveCountVariance, getCountVariances, getStockDocuments,
  type CountVariance, type StockDocument,
} from '../../services/stockMasterService';

const DOC_TYPE_LABELS: Record<string, string> = {
  RECEIPT: 'Nhập kho', ISSUE: 'Xuất kho', TRANSFER: 'Điều chuyển',
};

export default function StockApprovalsPage() {
  const [drafts, setDrafts] = useState<StockDocument[]>([]);
  const [receiving, setReceiving] = useState<StockDocument[]>([]);
  const [variances, setVariances] = useState<CountVariance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [d, r, v] = await Promise.all([
        getStockDocuments({ status: 'DRAFT' }),
        getStockDocuments({ type: 'TRANSFER', status: 'RECEIVED' }),
        getCountVariances(true),
      ]);
      setDrafts(d);
      setReceiving(r);
      setVariances(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được danh sách chờ duyệt.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approveVariance = async (row: CountVariance) => {
    const text = (resolutions[row.id] || '').trim();
    if (!text) {
      setError('Nhập phương án xử lý trước khi duyệt.');
      return;
    }
    try {
      setActing(true);
      setError(null);
      await approveCountVariance(row.countId, row.id, text);
      setResolutions((prev) => ({ ...prev, [row.id]: '' }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Duyệt thất bại');
    } finally {
      setActing(false);
    }
  };

  const total = drafts.length + receiving.length + variances.length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
          <CheckSquare className="text-emerald-500" /> Chờ duyệt
        </h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">
          {total} việc cần quyết định: phiếu nháp, điều chuyển chờ chốt, chênh lệch kiểm kê
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-center text-gray-400 py-8">Đang tải...</p>
      ) : total === 0 ? (
        <Card className="p-10 text-center text-gray-400 text-sm">
          Không có gì chờ duyệt. 🎉
        </Card>
      ) : (
        <>
          {drafts.length > 0 && (
            <Card className="overflow-hidden p-0">
              <div className="p-4 border-b border-gray-100 dark:border-slate-700">
                <h2 className="font-bold text-gray-800 dark:text-slate-100">Phiếu nháp chờ xác nhận ({drafts.length})</h2>
              </div>
              <ul className="divide-y divide-gray-50 dark:divide-slate-700/50">
                {drafts.map((d) => (
                  <li key={d.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span>
                      <span className="font-bold">{d.code}</span>
                      <span className="text-gray-500"> • {DOC_TYPE_LABELS[d.type] || d.type} • {d.warehouseName || d.warehouseCode}</span>
                    </span>
                    <Link
                      to={d.type === 'RECEIPT' ? '/warehouse/receipts' : d.type === 'ISSUE' ? '/warehouse/issues' : '/warehouse/transfers'}
                      className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[11px] font-bold"
                    >
                      Mở phiếu
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {receiving.length > 0 && (
            <Card className="overflow-hidden p-0">
              <div className="p-4 border-b border-gray-100 dark:border-slate-700">
                <h2 className="font-bold text-gray-800 dark:text-slate-100">Điều chuyển chờ chốt ({receiving.length})</h2>
              </div>
              <ul className="divide-y divide-gray-50 dark:divide-slate-700/50">
                {receiving.map((d) => (
                  <li key={d.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span>
                      <span className="font-bold">{d.code}</span>
                      <span className="text-gray-500"> • {d.warehouseCode} → {(d as any).toWarehouseCode || '?'} • nhận {Number(d.qtyReceived)}/{Number(d.qtyOrdered)}</span>
                    </span>
                    <Link
                      to="/warehouse/transfers"
                      className="px-2 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-[11px] font-bold"
                    >
                      Chốt
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {variances.length > 0 && (
            <Card className="overflow-hidden p-0">
              <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2">
                <FileWarning size={16} className="text-amber-500" />
                <h2 className="font-bold text-gray-800 dark:text-slate-100">Chênh lệch kiểm kê chờ duyệt ({variances.length})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[720px]">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kỳ / Mặt hàng</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Sổ sách</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thực tế</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Chênh lệch</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase">Phương án / Duyệt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                    {variances.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                        <td className="p-3 text-sm">
                          <span className="font-bold">{row.productName}</span>
                          <span className="block text-xs text-gray-400">{row.productCode} • Kỳ {row.countCode} • {row.warehouseCode}</span>
                        </td>
                        <td className="p-3 text-sm text-center">{row.systemQty.toLocaleString('vi-VN')}</td>
                        <td className="p-3 text-sm text-center font-bold">{row.countedQty.toLocaleString('vi-VN')}</td>
                        <td className={`p-3 text-sm text-center font-black ${row.variance > 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                          {row.variance > 0 ? '+' : ''}{row.variance.toLocaleString('vi-VN')}
                        </td>
                        <td className="p-3">
                          <span className="flex gap-1">
                            <input
                              value={resolutions[row.id] || ''}
                              onChange={(e) => setResolutions((prev) => ({ ...prev, [row.id]: e.target.value }))}
                              placeholder="Phương án xử lý..."
                              className="flex-1 min-w-[160px] px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                            />
                            <button
                              onClick={() => approveVariance(row)} disabled={acting}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-50 shrink-0"
                            >
                              Duyệt
                            </button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
