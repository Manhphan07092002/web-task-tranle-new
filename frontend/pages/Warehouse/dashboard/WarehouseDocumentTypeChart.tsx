import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Link } from 'react-router-dom';
import { Card } from '../../../components/UI';
import type { DocTypeRatioItem } from '../../../services/warehouseService';
import { TX_TYPE_META } from './warehouseLabels';

const FALLBACK_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#64748b', '#ef4444'];

interface Props {
  items: DocTypeRatioItem[];
  monthLabel: string;
}

export function WarehouseDocumentTypeChart({ items, monthLabel }: Props) {
  const total = items.reduce((sum, item) => sum + Number(item.count), 0);
  const data = items.map((item, idx) => ({
    name: TX_TYPE_META[item.type]?.label || item.type,
    value: Number(item.count),
    color: TX_TYPE_META[item.type] ? dotToHex(TX_TYPE_META[item.type].dot) : FALLBACK_COLORS[idx % FALLBACK_COLORS.length],
  }));

  return (
    <Card className="overflow-hidden flex flex-col p-0 h-full">
      <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
        <h2 className="font-bold text-gray-800 dark:text-slate-100">Tỷ lệ phiếu theo loại</h2>
        <Link to="/warehouse" className="text-sm font-bold text-emerald-600 hover:text-emerald-700">Xem chi tiết →</Link>
      </div>
      {total === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8 px-4">Chưa có phiếu nào trong {monthLabel}.</p>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-2 p-4 flex-1">
          <div className="relative w-[180px] h-[180px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={85} paddingAngle={2} strokeWidth={0}>
                  {data.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} (${Math.round((Number(value) / total) * 100)}%)`, name]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-3xl font-black text-gray-800 dark:text-slate-100">{total}</span>
              <span className="text-[11px] text-gray-500 dark:text-slate-400 font-medium">Tổng phiếu {monthLabel}</span>
            </div>
          </div>
          <ul className="flex-1 w-full space-y-1.5 min-w-0">
            {data.map((entry) => (
              <li key={entry.name} className="flex items-center gap-2 text-sm">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                <span className="text-gray-600 dark:text-slate-300 flex-1 truncate">{entry.name}</span>
                <span className="font-bold text-gray-800 dark:text-slate-100">{entry.value} ({Math.round((entry.value / total) * 100)}%)</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function dotToHex(dotClass: string): string {
  if (dotClass.includes('emerald')) return '#10b981';
  if (dotClass.includes('rose')) return '#f43f5e';
  if (dotClass.includes('orange')) return '#f59e0b';
  if (dotClass.includes('purple')) return '#8b5cf6';
  if (dotClass.includes('blue')) return '#3b82f6';
  return '#64748b';
}
