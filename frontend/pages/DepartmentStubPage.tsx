import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Construction } from 'lucide-react';
import { Card } from '../components/UI';
import { DEPARTMENT_MENUS } from '../components/layout/menus/departmentMenus';
import { DEPT_LABELS, type DeptKey } from '../components/layout/menus/menuTypes';

// Placeholder for department modules that are planned but not built yet.
// One generic route (/dept/:key) serves all non-warehouse departments.
export default function DepartmentStubPage() {
  const { key } = useParams<{ key: string }>();
  const [searchParams] = useSearchParams();
  const deptKey = (key || '').toUpperCase() as DeptKey;
  const group = DEPARTMENT_MENUS[deptKey];
  const moduleId = searchParams.get('m');
  const moduleLabel = group?.items.find((i) => i.id === moduleId)?.label;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100">
          {moduleLabel || DEPT_LABELS[deptKey] || 'Module nghiệp vụ'}
        </h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">
          {DEPT_LABELS[deptKey] ? `Phân hệ ${DEPT_LABELS[deptKey]}.` : ''}
        </p>
      </div>
      <Card className="p-10 flex flex-col items-center text-center gap-3">
        <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">Đang phát triển</span>
        <Construction size={40} className="text-gray-300" />
        <p className="text-sm text-gray-500 dark:text-slate-400 max-w-md">
          Module này nằm trong lộ trình triển khai theo từng phòng ban. Các module dùng chung (Công việc, Lịch, Hộp thư, Thông báo...) vẫn hoạt động bình thường.
        </p>
        <Link
          to="/"
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition-colors"
        >
          Về Tổng quan
        </Link>
      </Card>
    </div>
  );
}
