import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../components/UI';
import { getMeetings } from '../../../services/meetingService';
import type { Meeting } from '../../../types';
import { formatTime } from './warehouseLabels';

export function WarehouseUpcomingMeetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await getMeetings();
        const now = Date.now();
        const upcoming = (Array.isArray(all) ? all : [])
          .filter((m) => {
            const start = new Date(m.startTime).getTime();
            return !Number.isNaN(start) && start >= now - 60 * 60 * 1000 && m.status !== 'cancelled';
          })
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
          .slice(0, 4);
        if (!cancelled) setMeetings(upcoming);
      } catch {
        if (!cancelled) setMeetings([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Card className="overflow-hidden flex flex-col p-0 h-full">
      <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
        <h2 className="font-bold text-gray-800 dark:text-slate-100">Cuộc họp sắp tới</h2>
        <Link to="/meetings" className="text-sm font-bold text-emerald-600 hover:text-emerald-700">Xem tất cả →</Link>
      </div>
      <div className="p-2 flex-1">
        {meetings.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Không có cuộc họp sắp tới.</p>
        ) : (
          <ul className="divide-y divide-gray-50 dark:divide-slate-700/50">
            {meetings.map((m) => {
              const start = new Date(m.startTime);
              return (
                <li key={m.id}>
                  <Link to="/meetings" className="flex items-center gap-3 px-2 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-700/30 rounded-xl">
                    <div className="w-11 shrink-0 text-center bg-blue-50 dark:bg-slate-700 rounded-xl py-1.5">
                      <p className="text-lg font-black text-blue-700 dark:text-blue-300 leading-none">{start.getDate()}</p>
                      <p className="text-[10px] font-bold text-blue-500">Th{start.getMonth() + 1}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-800 dark:text-slate-100 truncate">{m.title}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        {formatTime(m.startTime)} - {formatTime(m.endTime)}
                        {m.participants?.length ? ` • ${m.participants.length} người` : ''}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
