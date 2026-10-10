import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, Truck } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card } from '../../components/UI';
import { StatCard } from '../../components/StatCard';
import { WarehouseDashboardHeader } from './WarehouseDashboardHeader';
import {
  getReportSummary, getStockMoves, getWarehouses,
  type MovesPage, type ReportSummary, type Warehouse,
} from '../../services/stockMasterService';

type Tab = 'overview' | 'by-warehouse' | 'transit' | 'history';

const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Nhập – Xuất – Tồn' },
  { value: 'by-warehouse', label: 'Tồn theo kho' },
  { value: 'transit', label: 'Đang vận chuyển' },
  { value: 'history', label: 'Lịch sử hàng hóa' },
];

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (month: string) => `tháng ${month.slice(5)}/${month.slice(0, 4)}`;

export default function StockReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = ((): Tab => {
    const t = searchParams.get('tab');
    return t === 'by-warehouse' || t === 'transit' || t === 'history' ? t : 'overview';
  })();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [month, setMonth] = useState(currentMonth());
  const [warehouseId, setWarehouseId] = useState('');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [moves, setMoves] = useState<MovesPage>({ rows: [], total: 0, page: 1, pageSize: 20 });
  const [movesLoading, setMovesLoading] = useState(false);
  const [moveType, setMoveType] = useState('');
  const [moveSearch, setMoveSearch] = useState('');

  const loadSummary = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [data, wh] = await Promise.all([
        getReportSummary({ month, warehouseId: warehouseId || undefined }),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setSummary(data);
      setWarehouses(wh.filter((w) => w.isActive));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được báo cáo.');
    } finally {
      setLoading(false);
    }
  }, [month, warehouseId]);

  const loadMoves = useCallback(async (page: number, pageSize: number) => {
    try {
      setMovesLoading(true);
      setError(null);
      setMoves(await getStockMoves({
        warehouseId: warehouseId || undefined,
        moveType: moveType || undefined,
        search: moveSearch.trim() || undefined,
        page, pageSize,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được lịch sử.');
    } finally {
      setMovesLoading(false);
    }
  }, [warehouseId, moveType, moveSearch]);

  useEffect(() => {
    if (tab === 'history') {
      loadMoves(1, moves.pageSize);
    } else {
      loadSummary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, month, warehouseId]);

  const totalInbound = (summary?.byDay || []).reduce((s, d) => s + d.inbound, 0);
  const totalOutbound = (summary?.byDay || []).reduce((s, d) => s + d.outbound, 0);
  const totalPages = Math.max(Math.ceil(moves.total / moves.pageSize), 1);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <WarehouseDashboardHeader
        title="Báo cáo kho"
        subtitle={`Nhập – xuất – tồn ${summary ? monthLabel(summary.month) : ''} • Tồn theo kho • Đang vận chuyển • Lịch sử`}
        month={month}
        onMonthChange={setMonth}
      />

      <div className="flex flex-wrap gap-2 items-center">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => {
              setTab(t.value);
              setSearchParams(t.value === 'overview' ? {} : { tab: t.value }, { replace: true });
            }}
            className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
              tab === t.value
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 border border-gray-200 dark:border-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
        <select
          value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
          className="ml-auto px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-sm font-bold text-gray-600 dark:text-slate-300"
          aria-label="Lọc kho"
        >
          <option value="">Tất cả kho</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
        </select>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      {tab === 'overview' && (
        <>
          {loading && !summary ? (
            <p className="text-center text-gray-400 py-8">Đang tải...</p>
          ) : summary ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard label="Tổng nhập" value={Math.round(totalInbound)} icon={BarChart3} color="from-emerald-500 to-emerald-400" subtitle={monthLabel(summary.month)} />
                <StatCard label="Tổng xuất" value={Math.round(totalOutbound)} icon={BarChart3} color="from-rose-500 to-rose-400" subtitle={monthLabel(summary.month)} />
                <StatCard
                  label="Chênh lệch" value={Math.round(totalInbound - totalOutbound)} icon={BarChart3} color="from-blue-500 to-blue-400"
                  subtitle={`nhập − xuất ${monthLabel(summary.month)}`} />
              </div>
              <Card className="p-4">
                <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-2">Nhập / xuất theo ngày</h2>
                {summary.byDay.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Không có biến động trong kỳ.</p>
                ) : (
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={summary.byDay} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(8)} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value, name) => [Number(value).toLocaleString('vi-VN'), name]} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="inbound" name="Nhập" fill="#10b981" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="outbound" name="Xuất" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
              <Card className="overflow-hidden p-0">
                <div className="p-4 border-b border-gray-100 dark:border-slate-700">
                  <h2 className="font-bold text-gray-800 dark:text-slate-100">Theo loại chứng từ</h2>
                </div>
                <ul className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {summary.byType.length === 0 && <li className="p-4 text-sm text-gray-400 text-center">Chưa có dữ liệu.</li>}
                  {summary.byType.map((t) => (
                    <li key={t.moveType} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="font-bold">{t.moveType}</span>
                      <span className="text-gray-500">{t.docs} phiếu • {Number(t.qty).toLocaleString('vi-VN')} SP</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          ) : null}
        </>
      )}

      {tab === 'by-warehouse' && (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[680px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kho</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">SKU</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase text-right">Thực tồn</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase text-right">Đã giữ</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase text-right">Khả dụng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                {loading && !summary ? (
                  <tr><td colSpan={5} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
                ) : !summary || summary.byWarehouse.length === 0 ? (
                  <tr><td colSpan={5} className="p-8 text-center text-gray-400">Chưa có dữ liệu tồn.</td></tr>
                ) : (
                  summary.byWarehouse.map((w) => (
                    <tr key={w.warehouseId} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                      <td className="p-3 text-sm font-bold">{w.warehouseCode} - {w.warehouseName}</td>
                      <td className="p-3 text-sm text-center">{w.sku}</td>
                      <td className="p-3 text-sm text-right">{w.onHand.toLocaleString('vi-VN')}</td>
                      <td className="p-3 text-sm text-right">{w.reserved.toLocaleString('vi-VN')}</td>
                      <td className="p-3 text-sm text-right font-black text-emerald-700 dark:text-emerald-300">
                        {w.available.toLocaleString('vi-VN')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'transit' && (
        <Card className="overflow-hidden p-0">
          <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2">
            <Truck size={16} className="text-blue-600" />
            <h2 className="font-bold text-gray-800 dark:text-slate-100">
              Đang vận chuyển ({summary?.inTransit.length || 0})
            </h2>
          </div>
          {!summary || summary.inTransit.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Không có điều chuyển nào đang đi.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[680px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Phiếu</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Tuyến</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">SL</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">ETA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {summary.inTransit.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                      <td className="p-3 text-sm font-bold">{t.code}</td>
                      <td className="p-3 text-sm">{t.warehouseCode} → {t.toWarehouseCode || '?'}</td>
                      <td className="p-3 text-sm text-center">{Number(t.qty).toLocaleString('vi-VN')} ({t.lineCount} dòng)</td>
                      <td className="p-3 text-sm">{t.etaDate || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'history' && (
        <Card className="overflow-hidden p-0">
          <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex flex-col sm:flex-row gap-2">
            <input
              value={moveSearch} onChange={(e) => setMoveSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadMoves(1, moves.pageSize)}
              placeholder="Tìm mã hàng / serial / số phiếu..."
              className="flex-1 px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/50 text-sm focus:ring-2 focus:ring-emerald-500 text-gray-800 dark:text-slate-100"
            />
            <select value={moveType} onChange={(e) => setMoveType(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm" aria-label="Loại biến động">
              <option value="">Mọi loại</option>
              <option value="RECEIPT">Nhập kho</option>
              <option value="ISSUE">Xuất kho</option>
              <option value="TRANSFER">Điều chuyển</option>
              <option value="ADJUSTMENT">Điều chỉnh</option>
            </select>
            <button onClick={() => loadMoves(1, moves.pageSize)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold">Lọc</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Thời gian</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Loại</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hàng hóa</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase text-right">SL</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Phiếu / Kho</th>
                  <th className="p-3 text-xs font-bold text-gray-500 uppercase">Người thực hiện</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                {movesLoading ? (
                  <tr><td colSpan={6} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
                ) : moves.rows.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-gray-400">Không có biến động nào.</td></tr>
                ) : (
                  moves.rows.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                      <td className="p-3 text-xs text-gray-500">{new Date(m.createdAt).toLocaleString('vi-VN')}</td>
                      <td className="p-3 text-sm font-bold">{m.moveType}</td>
                      <td className="p-3 text-sm">{m.productCode || '-'}</td>
                      <td className={`p-3 text-sm text-right font-bold ${m.qty >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {m.qty >= 0 ? '+' : ''}{Number(m.qty).toLocaleString('vi-VN')}
                      </td>
                      <td className="p-3 text-xs text-gray-500">{m.docCode || '-'} • {m.warehouseCode || '-'}</td>
                      <td className="p-3 text-xs text-gray-500">{m.createdByName || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-gray-100 dark:border-slate-700 flex items-center justify-between text-sm">
            <span className="font-bold">Tổng số <span className="text-gray-800 dark:text-slate-100">{moves.total.toLocaleString('vi-VN')}</span></span>
            <div className="flex items-center gap-2 text-gray-500">
              <button disabled={moves.page <= 1} onClick={() => loadMoves(moves.page - 1, moves.pageSize)}
                className="px-2 py-1 border rounded-lg disabled:opacity-40">‹</button>
              <span className="font-semibold">{moves.page} / {Math.max(Math.ceil(moves.total / moves.pageSize), 1)}</span>
              <button disabled={moves.page >= Math.ceil(moves.total / moves.pageSize)} onClick={() => loadMoves(moves.page + 1, moves.pageSize)}
                className="px-2 py-1 border rounded-lg disabled:opacity-40">›</button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
