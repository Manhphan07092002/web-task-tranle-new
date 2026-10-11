import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Construction, Users, ListTodo, CircleCheck, Timer, LayoutDashboard } from 'lucide-react';
import { Card, Avatar } from '../components/UI';
import { DEPARTMENT_MENUS, asGroupList, deptFindItem, deptAllItems, getDeptHomePath } from '../components/layout/menus/departmentMenus';
import InventoryPage from './Warehouse/InventoryPage';
import StockDocsPage from './Warehouse/StockDocsPage';
import WarehouseOverview from './Warehouse/OverviewPage';
import AlertsPage from './Warehouse/AlertsPage';
import ExceptionsPage from './Warehouse/ExceptionsPage';
import SlowStockPage from './Warehouse/SlowStockPage';
import SerialPage from './Warehouse/SerialPage';
import ApprovalsPage from './Warehouse/ApprovalsPage';
import BundlePage from './Warehouse/BundlePage';
import MyWorkPage from './Warehouse/MyWorkPage';
import CatalogPage from './Warehouse/CatalogPage';
import InTransitPage from './Warehouse/InTransitPage';
import WarehouseReportsPage from './Warehouse/ReportsPage';
import MovesPage from './Warehouse/MovesPage';
import MisaPage from './Warehouse/MisaPage';
import MinMaxPage from './Warehouse/MinMaxPage';
import CountPage from './Warehouse/CountPage';
import ReservationsPage from './Warehouse/ReservationsPage';
import LocationsPage from './Warehouse/LocationsPage';
import { CODE_MAP, ID_MAP, roleLabel } from '../components/layout/menus/resolveDepartment';
import { DEPT_LABELS, type DeptKey } from '../components/layout/menus/menuTypes';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';

// Tổng quát riêng từng phòng ban (landing sau login).
// Module overview (id *_overview) render số liệu thật của phòng;
// các module chi tiết chưa xây giữ placeholder.
export default function DepartmentStubPage() {
  const { key } = useParams<{ key: string }>();
  const [searchParams] = useSearchParams();
  const deptKey = (key || '').toUpperCase() as DeptKey;
  const groups = asGroupList(DEPARTMENT_MENUS[deptKey]);
  const moduleId = searchParams.get('m');
  const moduleLabel = deptFindItem(deptKey, moduleId)?.label;
  const isOverview = !moduleId || moduleId.endsWith('_overview') || deptAllItems(deptKey)[0]?.id === moduleId;

  if (groups.length === 0) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">Module nghiệp vụ</h1>
        <Card className="p-10 flex flex-col items-center text-center gap-3">
          <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">Đang phát triển</span>
          <Construction size={40} className="text-gray-300" />
          <Link to="/" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition-colors">
            Về Tổng quan
          </Link>
        </Card>
      </div>
    );
  }

  if (isOverview) {
    if (deptKey === 'WAREHOUSE') return <WarehouseOverview deptKey={deptKey} />;
    return <DeptOverview deptKey={deptKey} title={moduleLabel || `Tổng quan ${DEPT_LABELS[deptKey]}`} />;
  }

  // Module kho đã có trang thật thì render thật, còn lại giữ placeholder.
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_stock') return <InventoryPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_receipt') return <StockDocsPage deptKey={deptKey} kind="RECEIPT" />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_issue') return <StockDocsPage deptKey={deptKey} kind="ISSUE" />;
  if (deptKey === 'WAREHOUSE' && (moduleId === 'wh_transfer' || moduleId === 'wh_in_transit')) return <StockDocsPage deptKey={deptKey} kind="TRANSFER" />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_alerts') return <AlertsPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_exceptions') return <ExceptionsPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_slow') return <SlowStockPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_serial') return <SerialPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_approvals') return <ApprovalsPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_bundle') return <BundlePage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_my_tasks') return <MyWorkPage deptKey={deptKey} initialTab="tasks" />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_my_history') return <MyWorkPage deptKey={deptKey} initialTab="history" />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_products') return <CatalogPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_in_transit') return <InTransitPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && (moduleId === 'wh_report_nxt' || moduleId === 'wh_report_warehouse')) return <WarehouseReportsPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_history') return <MovesPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_misa') return <MisaPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_report_minmax') return <MinMaxPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_count') return <CountPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && (moduleId === 'wh_variance' || moduleId === 'wh_adjustment')) return <CountPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_reservation') return <ReservationsPage deptKey={deptKey} />;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_locations') return <LocationsPage deptKey={deptKey} />;

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
          to={getDeptHomePath(deptKey) || '/'}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition-colors"
        >
          Về Tổng quan {DEPT_LABELS[deptKey]}
        </Link>
      </Card>
    </div>
  );
}

function DeptOverview({ deptKey, title }: { deptKey: DeptKey; title: string }) {
  const { user } = useAuth();
  const { users = [], tasks = [], departments = [] } = useData();
  const groups = asGroupList(DEPARTMENT_MENUS[deptKey]);

  const dept = departments.find((d) => {
    const code = (d.code || '').toUpperCase();
    if (code && CODE_MAP[code] === deptKey) return true;
    if (ID_MAP[d.id] === deptKey) return true;
    return false;
  });
  const deptName = dept?.name || DEPT_LABELS[deptKey];

  const members = users.filter((u) =>
    (dept && (u.primaryDepartmentId === dept.id)) ||
    (u.department && deptName && u.department === deptName)
  );
  const memberIds = new Set(members.map((m) => m.id));
  const deptTasks = tasks.filter((t) =>
    (deptName && t.department === deptName) ||
    memberIds.has(t.createdBy) ||
    (t.assignees || []).some((a) => memberIds.has(a))
  );
  const done = deptTasks.filter((t) => String(t.status || '').toLowerCase() === 'done').length;
  const pending = deptTasks.length - done;
  const myTasks = user ? deptTasks.filter((t) => t.createdBy === user.id || (t.assignees || []).includes(user.id)).length : 0;

  const stats = [
    { icon: Users, label: 'Nhân sự phòng', value: members.length, bg: 'bg-blue-50', fg: 'text-blue-600' },
    { icon: ListTodo, label: 'Công việc', value: deptTasks.length, bg: 'bg-violet-50', fg: 'text-violet-600' },
    { icon: Timer, label: 'Chưa xong', value: pending, bg: 'bg-amber-50', fg: 'text-amber-600' },
    { icon: CircleCheck, label: 'Đã xong', value: done, bg: 'bg-emerald-50', fg: 'text-emerald-600' },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
            <LayoutDashboard size={12} /> {DEPT_LABELS[deptKey]}
            {user && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-blue-600 text-white tracking-normal">
                {roleLabel(user.managementLevel)}
              </span>
            )}
          </p>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 mt-1">{title}</h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1 text-sm">
            {user ? `Xin chào ${user.name} — ` : ''}Tổng quát hoạt động của {deptName}.
            {myTasks > 0 && user ? ` Bạn có ${myTasks} công việc liên quan.` : ''}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card key={s.label} className="p-4 flex items-center gap-3">
            <span className={`p-2.5 rounded-xl ${s.bg}`}>
              <s.icon size={18} className={s.fg} />
            </span>
            <span>
              <span className="block text-xl font-black text-gray-900">{s.value}</span>
              <span className="block text-xs text-gray-500">{s.label}</span>
            </span>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5">
          <h2 className="font-bold text-gray-800 mb-3 text-sm uppercase tracking-wider">Nhân sự ({members.length})</h2>
          {members.length === 0 ? (
            <p className="text-sm text-gray-400">Chưa có dữ liệu nhân sự phòng này.</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {members.slice(0, 12).map((m) => (
                <li key={m.id} className="flex items-center gap-2.5">
                  <Avatar src={m.avatar} alt={m.name} size={7} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-800 truncate">{m.name}</span>
                    <span className="block text-xs text-gray-400 truncate">{m.role}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-bold text-gray-800 mb-3 text-sm uppercase tracking-wider">Chức năng phòng</h2>
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1">{g.label}</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {g.items.map((item) => (
                    <Link
                      key={item.id}
                      to={item.path}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                    >
                      <item.icon size={16} className="text-gray-400" />
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">Các module chi tiết đang hoàn thiện dần theo lộ trình.</p>
        </Card>
      </div>
    </div>
  );
}
