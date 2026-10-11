import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks, History, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card } from '../../components/UI';
import { useAuth } from '../../contexts/AuthContext';
import { getStockDocuments, type StockDocument } from '../../services/stockService';
import { getTasks } from '../../services/taskService';
import type { Task } from '../../types';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

const DOC_LABEL: Record<string, string> = { RECEIPT: 'Nhập', ISSUE: 'Xuất', TRANSFER: 'Điều chuyển' };

// Việc của tôi — NV (§7.4 + §29): phiếu cần xử lý + lịch sử đã làm.
export default function MyWorkPage({ deptKey, initialTab }: { deptKey: DeptKey; initialTab: 'tasks' | 'history' }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<'tasks' | 'history'>(initialTab);
  const [docs, setDocs] = useState<StockDocument[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [d, t] = await Promise.all([
        getStockDocuments().catch(() => [] as StockDocument[]),
        getTasks().catch(() => [] as Task[]),
      ]);
      setDocs(d); setTasks(t);
    } catch (e: any) {
      setError(e.message || 'Không tải được việc của bạn');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const myId = user?.id;
  const pendingDocs = useMemo(
    () => docs.filter((d) => d.status === 'DRAFT' || d.status === 'IN_TRANSIT'),
    [docs]
  );
  const myTasks = useMemo(() => {
    if (!myId) return [];
    return tasks.filter((t) => t.status !== 'Done' && (t.createdBy === myId || (t.assignees || []).includes(myId)));
  }, [tasks, myId]);
  const historyDocs = useMemo(() => docs.filter((d) => d.status === 'DONE').slice(0, 30), [docs]);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Của tôi</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">{tab === 'tasks' ? 'Việc cần xử lý' : 'Lịch sử xử lý'}</h1>
          {user && <p className="text-gray-500 text-sm mt-1">Xin chào {user.name} — đây là việc thuộc về bạn hôm nay.</p>}
        </div>
        <div className="flex gap-2">
          <div className="flex bg-gray-100 rounded-xl p-1">
            {([['tasks', 'Cần xử lý'], ['history', 'Lịch sử']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors ${tab === id ? 'bg-white shadow text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          <AlertCircle size={15} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải...</p>
        </div>
      ) : tab === 'tasks' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-5">
            <h2 className="font-bold text-gray-800 mb-3 text-sm uppercase tracking-wider flex items-center gap-2">
              <ListChecks size={15} /> Phiếu kho ({pendingDocs.length})
            </h2>
            {pendingDocs.length === 0 ? (
              <p className="text-sm text-gray-400">Không có phiếu nào chờ — kho thông thoáng.</p>
            ) : (
              <ul className="space-y-2">
                {pendingDocs.slice(0, 10).map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-sm">
                    <span className="font-mono font-bold text-gray-700 text-xs">{d.code || d.id.slice(0, 8)}</span>
                    <span className="text-gray-400 text-xs">{DOC_LABEL[d.docType] || d.docType}</span>
                    <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold border ${d.status === 'DRAFT' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                      {d.status === 'DRAFT' ? 'Nháp' : 'Đang đi'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="font-bold text-gray-800 mb-3 text-sm uppercase tracking-wider flex items-center gap-2">
              <CheckCircle2 size={15} /> Công việc ({myTasks.length})
            </h2>
            {myTasks.length === 0 ? (
              <p className="text-sm text-gray-400">Bạn không có công việc dở dang nào.</p>
            ) : (
              <ul className="space-y-2">
                {myTasks.slice(0, 10).map((t) => (
                  <li key={t.id}>
                    <Link to="/tasks" className="block text-sm text-gray-700 hover:text-emerald-600 font-medium truncate">{t.title}</Link>
                    <p className="text-xs text-gray-400">{t.status} · đến {t.dueDate || '—'}</p>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/tasks" className="inline-block mt-3 text-xs font-bold text-emerald-600 hover:underline">Mở trang Công việc →</Link>
          </Card>
        </div>
      ) : (
        <Card className="p-5">
          <h2 className="font-bold text-gray-800 mb-3 text-sm uppercase tracking-wider flex items-center gap-2">
            <History size={15} /> Phiếu đã hoàn tất ({historyDocs.length})
          </h2>
          {historyDocs.length === 0 ? (
            <p className="text-sm text-gray-400">Chưa có phiếu hoàn tất nào trong phạm vi.</p>
          ) : (
            <ul className="space-y-2">
              {historyDocs.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                  <span className="font-mono font-bold text-gray-700 text-xs">{d.code || d.id.slice(0, 8)}</span>
                  <span className="text-gray-400 text-xs">{DOC_LABEL[d.docType] || d.docType}</span>
                  <span className="ml-auto text-xs text-gray-400">{d.createdAt ? new Date(d.createdAt).toLocaleString('vi-VN') : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}
