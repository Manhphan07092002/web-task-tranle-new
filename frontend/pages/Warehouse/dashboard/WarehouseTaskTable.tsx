import { Link } from 'react-router-dom';
import { Card } from '../../../components/UI';
import type { WarehouseTransaction } from '../../../services/warehouseService';
import { WarehouseDocumentBadge } from './WarehouseDocumentBadge';
import { WarehouseStatusBadge } from './WarehouseStatusBadge';
import { PRIORITY_META, formatDate } from './warehouseLabels';

interface Props {
  title: string;
  rows: WarehouseTransaction[];
  mode: 'team' | 'mine';
  viewAllTo: string;
  viewAllLabel?: string;
}

export function WarehouseTaskTable({ title, rows, mode, viewAllTo, viewAllLabel = 'Xem tất cả' }: Props) {
  return (
    <Card className="overflow-hidden flex flex-col p-0">
      <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
        <h2 className="font-bold text-gray-800 dark:text-slate-100">{title}</h2>
        <Link to={viewAllTo} className="text-sm font-bold text-emerald-600 hover:text-emerald-700">
          {viewAllLabel} →
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[760px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
              <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase w-10 text-center">#</th>
              {mode === 'team' && <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase">Nhân viên</th>}
              <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase">Mã phiếu</th>
              <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase">Loại phiếu</th>
              {mode === 'mine' && <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase">Hàng hóa</th>}
              <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase">Vị trí kho</th>
              <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase">Hạn xử lý</th>
              <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="p-8 text-center text-gray-400 text-sm">Không có phiếu nào trong phạm vi của bạn.</td></tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                  <td className="p-3 text-sm text-gray-500 text-center">{idx + 1}</td>
                  {mode === 'team' && (
                    <td className="p-3 text-sm font-semibold text-gray-700 dark:text-slate-200">
                      {row.assignedToName || row.requestedByName || '-'}
                    </td>
                  )}
                  <td className="p-3 text-sm font-bold text-gray-800 dark:text-slate-100" title={row.transactionCode}>
                    {row.transactionCode}
                  </td>
                  <td className="p-3">
                    <WarehouseDocumentBadge type={row.type} />
                    {row.priority && row.priority !== 'normal' && (
                      <span className={`ml-1 px-2 py-1 rounded font-bold text-xs ${PRIORITY_META[row.priority]?.badge || ''}`}>
                        {PRIORITY_META[row.priority]?.label || row.priority}
                      </span>
                    )}
                  </td>
                  {mode === 'mine' && (
                    <td className="p-3 text-sm text-gray-700 dark:text-slate-200" title={row.productCode}>
                      {row.productName}
                    </td>
                  )}
                  <td className="p-3 text-sm text-gray-500">{row.toLocation || row.fromLocation || '-'}</td>
                  <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{formatDate(row.dueDate)}</td>
                  <td className="p-3"><WarehouseStatusBadge status={row.status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
