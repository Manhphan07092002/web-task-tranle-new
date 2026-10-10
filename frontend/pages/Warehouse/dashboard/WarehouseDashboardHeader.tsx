import { CalendarDays } from 'lucide-react';

interface Props {
  title: string;
  subtitle: string;
  month: string;
  onMonthChange: (month: string) => void;
}

function monthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    options.push({ value, label: `Tháng ${d.getMonth() + 1}/${d.getFullYear()}` });
  }
  return options;
}

export function WarehouseDashboardHeader({ title, subtitle, month, onMonthChange }: Props) {
  return (
    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100">{title}</h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">{subtitle}</p>
      </div>
      <label className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-bold text-gray-600 dark:text-slate-300 shadow-sm">
        <CalendarDays size={16} className="text-emerald-600" />
        <select
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          className="bg-transparent outline-none cursor-pointer"
          aria-label="Lọc theo tháng"
        >
          {monthOptions().map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
