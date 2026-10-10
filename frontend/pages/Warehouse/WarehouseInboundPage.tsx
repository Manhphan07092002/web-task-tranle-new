import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, Plus } from 'lucide-react';
import { useRBAC } from '../../hooks/useRBAC';
import {
  approveTransaction, getTransactions, rejectTransaction,
  type WarehouseTransaction,
} from '../../services/warehouseService';
import { WarehouseTransactionsTable } from './WarehouseTransactionsTable';

type InOutTab = 'IN' | 'OUT';

export default function WarehouseInboundPage() {
  const { canApprove } = useRBAC();
  const [tab, setTab] = useState<InOutTab>('IN');
  const [rows, setRows] = useState<WarehouseTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setRows(await getTransactions({ type: tab }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được phiếu.');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id: string) => {
    try {
      await approveTransaction(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Duyệt phiếu thất bại');
    }
  };

  const handleReject = async (id: string) => {
    const reason = window.prompt('Lý do từ chối phiếu kho:');
    if (reason === null) return;
    try {
      await rejectTransaction(id, reason);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Từ chối phiếu thất bại');
    }
  };

  const pending = rows.filter((r) => r.status === 'pending').length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100">Phiếu nhập / xuất</h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">
            {rows.length} phiếu • {pending} chờ duyệt
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/warehouse/inbound/new"
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-1"
          >
            <Plus size={15} /> Phiếu nhập kho mới
          </Link>
          <Link
            to="/warehouse/outbound/new"
            className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-bold text-gray-600 dark:text-slate-300 hover:bg-gray-50 transition-colors inline-flex items-center gap-1"
          >
            <Plus size={15} /> Phiếu xuất thi công
          </Link>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error} <button onClick={load} className="font-bold underline ml-2">Thử lại</button>
        </div>
      )}

      <div className="flex gap-2">
        {([
          { value: 'IN', label: 'Nhập kho', icon: ArrowDownToLine },
          { value: 'OUT', label: 'Xuất kho', icon: ArrowUpFromLine },
        ] as { value: InOutTab; label: string; icon: React.ElementType }[]).map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-4 py-2 rounded-xl font-bold text-sm transition-all inline-flex items-center gap-1.5 ${
              tab === t.value
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 border border-gray-200 dark:border-slate-700'
            }`}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-center text-gray-400 py-8">Đang tải...</p>
      ) : (
        <WarehouseTransactionsTable
          rows={rows}
          canApprove={canApprove('warehouse')}
          onApprove={handleApprove}
          onReject={handleReject}
          emptyText={tab === 'IN' ? 'Chưa có phiếu nhập kho nào.' : 'Chưa có phiếu xuất kho nào.'}
        />
      )}
    </div>
  );
}
