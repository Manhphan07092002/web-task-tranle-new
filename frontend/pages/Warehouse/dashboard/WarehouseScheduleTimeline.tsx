import { Link } from 'react-router-dom';
import { Card } from '../../../components/UI';
import { TX_TYPE_META } from './warehouseLabels';

export interface ScheduleItem {
  id: string;
  time: string;
  title: string;
  code?: string;
  detail?: string;
  location?: string;
  type?: string;
  to?: string;
}

interface Props {
  title: string;
  dateLabel: string;
  items: ScheduleItem[];
  onAdd?: () => void;
}

export function WarehouseScheduleTimeline({ title, dateLabel, items, onAdd }: Props) {
  return (
    <Card className="overflow-hidden flex flex-col p-0 h-full">
      <div className="p-4 border-b border-gray-100 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-800 dark:text-slate-100">{title}</h2>
          {onAdd && (
            <button
              onClick={onAdd}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors"
            >
              + Thêm
            </button>
          )}
        </div>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{dateLabel}</p>
      </div>
      <div className="p-4 flex-1 overflow-y-auto max-h-[420px]">
        {items.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Không có lịch hôm nay.</p>
        ) : (
          <ol className="relative border-l-2 border-gray-100 dark:border-slate-700 ml-2 space-y-4">
            {items.map((item) => {
              const dot = (item.type && TX_TYPE_META[item.type]?.dot) || 'bg-slate-400';
              const content = (
                <div className="flex items-start justify-between gap-2 bg-gray-50 dark:bg-slate-700/40 rounded-xl px-3 py-2.5 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-800 dark:text-slate-100 truncate">{item.title}</p>
                    {(item.code || item.detail) && (
                      <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                        {[item.code, item.detail].filter(Boolean).join(' - ')}
                      </p>
                    )}
                  </div>
                  {item.location && (
                    <span className="text-[11px] font-semibold text-gray-500 dark:text-slate-400 whitespace-nowrap">{item.location}</span>
                  )}
                </div>
              );
              return (
                <li key={item.id} className="ml-4 relative">
                  <span className={`absolute -left-[25px] top-2 w-3 h-3 rounded-full border-2 border-white dark:border-slate-800 ${dot}`} />
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-500 dark:text-slate-400 w-10 shrink-0">{item.time}</span>
                    <div className="flex-1 min-w-0">
                      {item.to ? <Link to={item.to}>{content}</Link> : content}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}
