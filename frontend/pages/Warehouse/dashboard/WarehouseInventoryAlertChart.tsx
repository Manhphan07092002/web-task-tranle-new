import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card } from '../../../components/UI';
import type { InventoryAlertItem } from '../../../services/warehouseService';

interface Props {
  items: InventoryAlertItem[];
  top: number;
  onTopChange: (top: number) => void;
}

export function WarehouseInventoryAlertChart({ items, top, onTopChange }: Props) {
  const [showAll, setShowAll] = useState(false);
  // Chart shows Top N by shortage; "Xem thêm" expands the table below, not the chart.
  const chartData = items.slice(0, top).map((item) => ({
    name: item.productName.length > 14 ? `${item.productName.slice(0, 14)}…` : item.productName,
    fullName: `${item.productName} (${item.productCode})`,
    'Tồn hiện tại': Number(item.quantity),
    'Mức tồn tối thiểu': Number(item.minStockLevel),
  }));
  const tableRows = showAll ? items : items.slice(0, 5);

  return (
    <Card className="overflow-hidden flex flex-col p-0 h-full">
      <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between gap-2">
        <h2 className="font-bold text-gray-800 dark:text-slate-100">⚠️ Tồn kho &amp; cảnh báo</h2>
        <select
          value={top}
          onChange={(e) => onTopChange(Number(e.target.value))}
          className="text-xs font-bold px-2 py-1.5 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200"
          aria-label="Top mặt hàng cảnh báo"
        >
          <option value={5}>Top 5 nhóm hàng</option>
          <option value={10}>Top 10 nhóm hàng</option>
        </select>
      </div>
      {chartData.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8 px-4">Không có mặt hàng nào dưới mức tồn tối thiểu. 🎉</p>
      ) : (
        <>
          <div className="px-2 pt-2 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-12} dy={8} height={48} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={(value, name) => [Number(value).toLocaleString('vi-VN'), name]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ''}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Tồn hiện tại" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Mức tồn tối thiểu" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {items.length > 5 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mx-4 mb-2 text-xs font-bold text-emerald-600 hover:text-emerald-700 self-start"
            >
              {showAll ? 'Thu gọn ↑' : `Xem thêm (${items.length - 5}) ↓`}
            </button>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[420px]">
              <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                {tableRows.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <td className="px-4 py-2 text-xs font-bold text-gray-700 dark:text-slate-200">
                      {item.productName}
                      <span className="block font-normal text-gray-400">{item.productCode} • {item.warehouseLocation || '-'}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-right font-bold text-rose-600">
                      {Number(item.quantity).toLocaleString('vi-VN')} {item.unit}
                      <span className="block font-normal text-gray-400">thiếu {Number(item.shortage).toLocaleString('vi-VN')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
