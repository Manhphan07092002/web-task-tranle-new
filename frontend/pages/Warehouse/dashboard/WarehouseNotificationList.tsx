import { Link } from 'react-router-dom';
import { AlertTriangle, Bell, CheckCircle2, Info } from 'lucide-react';
import { Card } from '../../../components/UI';
import { useNotifications } from '../../../contexts/NotificationContext';
import { formatDateTime } from './warehouseLabels';

function typeBadge(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('alert') || t.includes('inventory') || t.includes('canh_bao') || t.includes('warning')) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
  }
  if (t.includes('assign') || t.includes('task') || t.includes('giao')) {
    return 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300';
  }
  if (t.includes('approv') || t.includes('duyet')) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
  }
  return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
}

function TypeIcon({ type }: { type: string }) {
  const t = type.toLowerCase();
  if (t.includes('alert') || t.includes('inventory') || t.includes('warning')) {
    return <AlertTriangle size={18} className="text-rose-500 shrink-0" />;
  }
  if (t.includes('approv') || t.includes('complete') || t.includes('hoan_thanh')) {
    return <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />;
  }
  if (t.includes('assign') || t.includes('task')) {
    return <Bell size={18} className="text-orange-500 shrink-0" />;
  }
  return <Info size={18} className="text-blue-500 shrink-0" />;
}

export function WarehouseNotificationList({ limit = 6 }: { limit?: number }) {
  const { notifications } = useNotifications();
  // Notifications are already scoped to the current user by the backend.
  const items = notifications.slice(0, limit);

  return (
    <Card className="overflow-hidden flex flex-col p-0 h-full">
      <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
        <h2 className="font-bold text-gray-800 dark:text-slate-100">Thông báo &amp; cảnh báo</h2>
        <Link to="/notifications" className="text-sm font-bold text-emerald-600 hover:text-emerald-700">Xem tất cả →</Link>
      </div>
      <div className="flex-1">
        {items.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Không có thông báo mới.</p>
        ) : (
          <ul className="divide-y divide-gray-50 dark:divide-slate-700/50">
            {items.map((n) => (
              <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.isRead ? '' : 'bg-emerald-50/50 dark:bg-emerald-900/10'}`}>
                <span className="mt-0.5"><TypeIcon type={n.type} /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-800 dark:text-slate-100">{n.title}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400 line-clamp-2">{n.message}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[11px] text-gray-400">{formatDateTime(n.createdAt)}</span>
                  <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${typeBadge(n.type)}`}>{n.type}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
