import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { useRBAC } from '../../hooks/useRBAC';
import {
  approveTransaction, getTransactions, rejectTransaction,
  type WarehouseTransaction,
} from '../../services/warehouseService';
import { WarehouseTransactionsTable } from './WarehouseTransactionsTable';
import { WarehouseTransactionForm } from './WarehouseTransactionForm';

export type TransferScopeFilter = 'all' | 'internal' | 'site';

const CONFIG: Record<TransferScopeFilter, { title: string; subtitle: string; emptyText: string }> = {
  all: {
    title: 'Điều chuyển',
    subtitle: 'Tất cả phiếu điều chuyển hàng hóa.',
    emptyText: 'Chưa có phiếu điều chuyển nào.',
  },
  internal: {
    title: 'Điều chuyển giữa các kho',
    subtitle: 'Luân chuyển hàng giữa các khu vực, giá kệ trong kho.',
    emptyText: 'Chưa có phiếu điều chuyển nội bộ nào.',
  },
  site: {
    title: 'Điều chuyển ra công trường',
    subtitle: 'Xuất hàng từ kho ra công trình thi công.',
    emptyText: 'Chưa có phiếu điều chuyển ra công trường nào.',
  },
};

export default function WarehouseTransfersPage({ scope = 'all' }: { scope?: TransferScopeFilter }) {
  const { canApprove } = useRBAC();
  const [rows, setRows] = useState<WarehouseTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const cfg = CONFIG[scope];

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setRows(await getTransactions({ type: 'TRANSFER', ...(scope === 'all' ? {} : { scope }) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được phiếu điều chuyển.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

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
    const reason = window.prompt('Lý do từ chối phiếu điều chuyển:');
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
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <ArrowLeftRight className="text-emerald-500" /> {cfg.title}
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">
            {cfg.subtitle} {rows.length} phiếu • {pending} chờ duyệt
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-sm"
        >
          {showForm ? 'Đóng' : '+ Tạo phiếu điều chuyển'}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error} <button onClick={load} className="font-bold underline ml-2">Thử lại</button>
        </div>
      )}

      {showForm && (
        <WarehouseTransactionForm
          presetType="TRANSFER"
          presetScope={scope === 'all' ? undefined : scope}
          showScopeSelect={scope === 'all'}
          title={scope === 'site' ? 'Tạo phiếu điều chuyển ra công trường' : 'Tạo phiếu điều chuyển'}
          onCreated={() => { setShowForm(false); load(); }}
          onError={setError}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading ? (
        <p className="text-center text-gray-400 py-8">Đang tải...</p>
      ) : (
        <WarehouseTransactionsTable
          rows={rows}
          canApprove={canApprove('warehouse')}
          onApprove={handleApprove}
          onReject={handleReject}
          emptyText={cfg.emptyText}
        />
      )}
    </div>
  );
}
