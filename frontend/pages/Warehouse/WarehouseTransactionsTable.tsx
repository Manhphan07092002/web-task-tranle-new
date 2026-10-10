import { Check, X } from 'lucide-react';
import { Card } from '../../components/UI';
import type { WarehouseTransaction } from '../../services/warehouseService';
import { WarehouseDocumentBadge } from './dashboard/WarehouseDocumentBadge';
import { WarehouseStatusBadge } from './dashboard/WarehouseStatusBadge';
import { formatDate } from './dashboard/warehouseLabels';

interface Props {
  rows: WarehouseTransaction[];
  canApprove: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  emptyText?: string;
}

// Shared transactions table used by /warehouse, /warehouse/inbound and transfer pages.
export function WarehouseTransactionsTable({ rows, canApprove, onApprove, onReject, emptyText = 'Chưa có phiếu kho nào.' }: Props) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
              <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã phiếu</th>
              <th className="p-3 text-xs font-bold text-gray-500 uppercase">Loại</th>
              <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hàng hóa</th>
              <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">SL</th>
              <th className="p-3 text-xs font-bold text-gray-500 uppercase">Người xử lý</th>
              <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hạn xử lý</th>
              <th className="p-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
              <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="p-8 text-center text-gray-400">{emptyText}</td></tr>
            ) : (
              rows.map((trans) => (
                <tr key={trans.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                  <td className="p-3 text-sm font-bold" title={trans.transactionCode}>{trans.transactionCode}</td>
                  <td className="p-3"><WarehouseDocumentBadge type={trans.type} /></td>
                  <td className="p-3 text-sm" title={trans.productCode}>{trans.productName}</td>
                  <td className="p-3 text-sm text-center">{Number(trans.quantity).toLocaleString('vi-VN')}</td>
                  <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{trans.assignedToName || trans.requestedByName || '-'}</td>
                  <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{formatDate(trans.dueDate)}</td>
                  <td className="p-3"><WarehouseStatusBadge status={trans.status} /></td>
                  <td className="p-3 text-center">
                    {trans.status === 'pending' && canApprove ? (
                      <div className="flex justify-center gap-2">
                        <button onClick={() => onApprove(trans.id)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Duyệt">
                          <Check size={16} />
                        </button>
                        <button onClick={() => onReject(trans.id)} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg" title="Từ chối">
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
