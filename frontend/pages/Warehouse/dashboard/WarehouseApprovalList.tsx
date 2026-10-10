import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { Card } from '../../../components/UI';
import type { WarehouseTransaction } from '../../../services/warehouseService';
import { approveTransaction, rejectTransaction } from '../../../services/warehouseService';
import { WarehouseDocumentBadge } from './WarehouseDocumentBadge';
import { formatDateTime, txTypeLabel } from './warehouseLabels';

interface Props {
  items: WarehouseTransaction[];
  canApprove: boolean;
  onChanged: () => void;
}

export function WarehouseApprovalList({ items, canApprove, onChanged }: Props) {
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    try {
      setActingId(id);
      setError(null);
      await approveTransaction(id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Phê duyệt thất bại');
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (id: string) => {
    const reason = window.prompt('Lý do từ chối phiếu kho:');
    if (reason === null) return;
    try {
      setActingId(id);
      setError(null);
      await rejectTransaction(id, reason);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Từ chối thất bại');
    } finally {
      setActingId(null);
    }
  };

  return (
    <Card className="overflow-hidden flex flex-col p-0 h-full">
      <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
        <h2 className="font-bold text-gray-800 dark:text-slate-100">Phiếu cần phê duyệt</h2>
        <Link to="/warehouse" className="text-sm font-bold text-emerald-600 hover:text-emerald-700">Xem tất cả →</Link>
      </div>
      <div className="p-2 flex-1 overflow-y-auto max-h-[380px]">
        {error && <p className="px-2 py-1 text-xs font-bold text-rose-600">{error}</p>}
        {items.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Không có phiếu nào chờ duyệt. 🎉</p>
        ) : (
          <ul className="divide-y divide-gray-50 dark:divide-slate-700/50">
            {items.map((item) => (
              <li key={item.id} className="px-2 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <WarehouseDocumentBadge type={item.type} />
                    <span className="text-xs font-bold text-gray-700 dark:text-slate-200 truncate">{item.transactionCode}</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400 truncate mt-0.5">
                    {item.productName} • {item.requestedByName || ''} • {formatDateTime(item.createdAt)}
                  </p>
                </div>
                {canApprove ? (
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => handleApprove(item.id)}
                      disabled={actingId === item.id}
                      className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold disabled:opacity-50 flex items-center gap-1"
                      title={`Phê duyệt ${txTypeLabel(item.type)}`}
                    >
                      <Check size={13} /> Duyệt
                    </button>
                    <button
                      onClick={() => handleReject(item.id)}
                      disabled={actingId === item.id}
                      className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg disabled:opacity-50"
                      title="Từ chối"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-gray-400 shrink-0">Chờ duyệt</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
