import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Download, Upload, FileText, TriangleAlert } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card } from '../../components/UI';
import { StatCard } from '../../components/StatCard';
import { getReport, type WarehouseReportData } from '../../services/warehouseService';
import { WarehouseDashboardHeader } from './dashboard/WarehouseDashboardHeader';
import { TX_TYPE_META } from './dashboard/warehouseLabels';

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

export default function WarehouseReportsPage() {
  const [data, setData] = useState<WarehouseReportData | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setData(await getReport(month));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được báo cáo.');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const countOf = (type: string) => data?.byType.find((t) => t.type === type)?.count || 0;
  const qtyOf = (type: string) => Number(data?.byType.find((t) => t.type === type)?.totalQty || 0);
  const totalDocs = (data?.byType || []).reduce((s, t) => s + Number(t.count), 0);
  const monthLabel = `tháng ${month.slice(5)}/${month.slice(0, 4)}`;

  const chartData = (data?.byType || []).map((t) => ({
    name: TX_TYPE_META[t.type]?.label || t.type,
    'Số phiếu': Number(t.count),
    'Tổng SL': Number(t.totalQty),
  }));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <WarehouseDashboardHeader
        title="Báo cáo phòng"
        subtitle={`Tình hình xuất nhập tồn Phòng Kho vận ${monthLabel}.`}
        month={month}
        onMonthChange={setMonth}
      />

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error} <button onClick={load} className="font-bold underline ml-2">Thử lại</button>
        </div>
      )}

      {loading && !data ? (
        <p className="text-center text-gray-400 py-8">Đang tải...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Tổng phiếu" value={totalDocs} icon={FileText} color="from-blue-500 to-blue-400" subtitle={monthLabel} />
            <StatCard label="Nhập kho" value={countOf('IN')} icon={Download} color="from-emerald-500 to-emerald-400" subtitle={`${qtyOf('IN').toLocaleString('vi-VN')} SP`} />
            <StatCard label="Xuất kho" value={countOf('OUT')} icon={Upload} color="from-rose-500 to-rose-400" subtitle={`${qtyOf('OUT').toLocaleString('vi-VN')} SP`} />
            <StatCard label="Điều chuyển" value={countOf('TRANSFER')} icon={BarChart3} color="from-orange-500 to-orange-400" subtitle={`${qtyOf('TRANSFER').toLocaleString('vi-VN')} SP`} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card className="p-4">
              <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-2 flex items-center gap-2">
                <BarChart3 size={16} className="text-emerald-600" /> Phiếu theo loại {monthLabel}
              </h2>
              {chartData.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Chưa có phiếu nào trong kỳ.</p>
              ) : (
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(value, name) => [Number(value).toLocaleString('vi-VN'), name]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Số phiếu" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Tổng SL" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-2 flex items-center gap-2">
                <TriangleAlert size={16} className="text-amber-500" /> Trạng thái phiếu {monthLabel}
              </h2>
              {(data?.byStatus || []).length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Chưa có dữ liệu.</p>
              ) : (
                <ul className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {(data?.byStatus || []).map((s) => (
                    <li key={s.status} className="flex items-center justify-between py-2.5 text-sm">
                      <span className="font-semibold text-gray-700 dark:text-slate-200">{s.status}</span>
                      <span className="font-black text-gray-800 dark:text-slate-100">{Number(s.count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {[{ title: 'Top nhập kho', rows: data?.topIn || [] }, { title: 'Top xuất kho', rows: data?.topOut || [] }].map((block) => (
              <Card key={block.title} className="overflow-hidden p-0">
                <div className="p-4 border-b border-gray-100 dark:border-slate-700">
                  <h2 className="font-bold text-gray-800 dark:text-slate-100">{block.title} {monthLabel}</h2>
                </div>
                {block.rows.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Chưa có dữ liệu.</p>
                ) : (
                  <ul className="divide-y divide-gray-50 dark:divide-slate-700/50">
                    {block.rows.map((row) => (
                      <li key={row.productCode} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <span className="font-semibold text-gray-700 dark:text-slate-200 truncate">
                          {row.productName}
                          <span className="block text-xs font-normal text-gray-400">{row.productCode} • {Number(row.count)} phiếu</span>
                        </span>
                        <span className="font-black text-gray-800 dark:text-slate-100 shrink-0 ml-2">
                          {Number(row.totalQty).toLocaleString('vi-VN')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
