import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Avatar } from '../../../components/UI';
import { apiFetch } from '../../../services/api';
import type { Email } from '../../Mail/types';
import { formatDateTime } from './warehouseLabels';

export function WarehouseRecentMessages() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/mail/inbox?folder=inbox&page=1&limit=5');
        if (!res.ok) {
          if (!cancelled) setUnavailable(true);
          return;
        }
        const data: Email[] = await res.json();
        if (!cancelled) setEmails(Array.isArray(data) ? data.slice(0, 3) : []);
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Card className="overflow-hidden flex flex-col p-0 h-full">
      <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
        <h2 className="font-bold text-gray-800 dark:text-slate-100">Hộp thư / trao đổi gần đây</h2>
        <Link to="/mail" className="text-sm font-bold text-emerald-600 hover:text-emerald-700">Xem tất cả →</Link>
      </div>
      <div className="p-2 flex-1">
        {unavailable ? (
          <p className="text-sm text-gray-400 text-center py-8">Chưa kết nối hộp thư. <Link to="/mail" className="text-emerald-600 font-bold">Kết nối →</Link></p>
        ) : emails.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Không có thư mới.</p>
        ) : (
          <ul className="divide-y divide-gray-50 dark:divide-slate-700/50">
            {emails.map((mail) => (
              <li key={mail.id}>
                <Link to="/mail" className="flex items-start gap-3 px-2 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-700/30 rounded-xl">
                  <Avatar alt={mail.fromName || mail.from} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-gray-800 dark:text-slate-100 truncate">{mail.fromName || mail.from}</p>
                      <span className="text-[11px] text-gray-400 shrink-0">{formatDateTime(mail.date)}</span>
                    </div>
                    <p className="text-xs font-semibold text-gray-600 dark:text-slate-300 truncate">{mail.subject || '(Không có tiêu đề)'}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
