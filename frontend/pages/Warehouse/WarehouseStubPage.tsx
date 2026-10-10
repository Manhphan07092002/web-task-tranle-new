import { Link } from 'react-router-dom';
import { Construction } from 'lucide-react';
import { Card } from '../../components/UI';

interface Props {
  title: string;
  description: string;
  backTo?: string;
  backLabel?: string;
}

// Placeholder for warehouse modules that are planned but not built yet.
// Keeps sidebar navigation honest: every item lands somewhere meaningful.
export default function WarehouseStubPage({ title, description, backTo = '/warehouse/dashboard', backLabel = 'Về Tổng quan kho' }: Props) {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100">{title}</h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">{description}</p>
      </div>
      <Card className="p-10 flex flex-col items-center text-center gap-3">
        <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">Đang phát triển</span>
        <Construction size={40} className="text-gray-300" />
        <p className="text-sm text-gray-500 dark:text-slate-400 max-w-md">
          Chức năng này nằm trong lộ trình Phòng Kho vận. Hiện tại bạn có thể quản lý phiếu và tồn kho ở các trang đã hoàn thành bên dưới.
        </p>
        <div className="flex flex-wrap justify-center gap-2 mt-2">
          <Link
            to={backTo}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition-colors"
          >
            {backLabel}
          </Link>
          <Link
            to="/warehouse"
            className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-bold text-gray-600 dark:text-slate-300 hover:bg-gray-50 transition-colors"
          >
            Tồn kho &amp; phiếu
          </Link>
        </div>
      </Card>
    </div>
  );
}
