import React, { Suspense } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Construction, Users, ListTodo, CircleCheck, Timer, LayoutDashboard } from 'lucide-react';
import { Card, Avatar } from '../components/UI';
import { DEPARTMENT_MENUS, asGroupList, deptFindItem, deptAllItems, getDeptHomePath } from '../components/layout/menus/departmentMenus';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { CODE_MAP, ID_MAP, roleLabel } from '../components/layout/menus/resolveDepartment';
import { DEPT_LABELS, type DeptKey } from '../components/layout/menus/menuTypes';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';

const InventoryPage = React.lazy(() => import('./Warehouse/InventoryPage'));
const StockDocsPage = React.lazy(() => import('./Warehouse/StockDocsPage'));
const WarehouseOverview = React.lazy(() => import('./Warehouse/OverviewPage'));
const AlertsPage = React.lazy(() => import('./Warehouse/AlertsPage'));
const ExceptionsPage = React.lazy(() => import('./Warehouse/ExceptionsPage'));
const SlowStockPage = React.lazy(() => import('./Warehouse/SlowStockPage'));
const SerialPage = React.lazy(() => import('./Warehouse/SerialPage'));
const ProcessingQueuePage = React.lazy(() => import('./Warehouse/ProcessingQueuePage'));
const ApprovalsPage = React.lazy(() => import('./Warehouse/ApprovalsPage'));
const BundlePage = React.lazy(() => import('./Warehouse/BundlePage'));
const MyWorkPage = React.lazy(() => import('./Warehouse/MyWorkPage'));
const CatalogPage = React.lazy(() => import('./Warehouse/CatalogPage'));
const InTransitPage = React.lazy(() => import('./Warehouse/InTransitPage'));
const WarehouseReportsPage = React.lazy(() => import('./Warehouse/ReportsPage'));
const MovesPage = React.lazy(() => import('./Warehouse/MovesPage'));
const MisaPage = React.lazy(() => import('./Warehouse/MisaPage'));
const AuditLogPage = React.lazy(() => import('./Warehouse/AuditLogPage'));
const StockControlPage = React.lazy(() => import('./Warehouse/StockControlPage'));
const MinMaxPage = React.lazy(() => import('./Warehouse/MinMaxPage'));
const CountPage = React.lazy(() => import('./Warehouse/CountPage'));
const CountVariancePage = React.lazy(() => import('./Warehouse/CountVariancePage'));
const StockAdjustmentPage = React.lazy(() => import('./Warehouse/StockAdjustmentPage'));
const WarehouseStockReportPage = React.lazy(() => import('./Warehouse/WarehouseStockReportPage'));
const ReservationsPage = React.lazy(() => import('./Warehouse/ReservationsPage'));
const LocationsPage = React.lazy(() => import('./Warehouse/LocationsPage'));

function WarehousePageSkeleton() {
  return <div className="animate-pulse space-y-4"><div className="h-8 w-48 rounded bg-slate-200" /><div className="h-40 rounded-xl bg-slate-100" /></div>;
}

function WarehousePageLoader({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary fallback={(_error, resetError) => (
      <div className="max-w-lg mx-auto p-6 text-center space-y-3">
        <p className="font-semibold text-slate-800">Không thể tải trang Kho vận.</p>
        <button className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold" onClick={() => { resetError(); window.location.reload(); }}>
          Tải lại
        </button>
      </div>
    )}>
      <Suspense fallback={<WarehousePageSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

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
    if (deptKey === 'WAREHOUSE') return <WarehousePageLoader><WarehouseOverview deptKey={deptKey} /></WarehousePageLoader>;
    return <DeptOverview deptKey={deptKey} title={moduleLabel || `Tổng quan ${DEPT_LABELS[deptKey]}`} />;
  }

  // Module kho đã có trang thật thì render thật, còn lại giữ placeholder.
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_stock') return <WarehousePageLoader><InventoryPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_receipt') return <WarehousePageLoader><StockDocsPage deptKey={deptKey} kind="RECEIPT" /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_issue') return <WarehousePageLoader><StockDocsPage deptKey={deptKey} kind="ISSUE" /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_return') return <WarehousePageLoader><StockDocsPage deptKey={deptKey} kind="RETURN" /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_transfer') return <WarehousePageLoader><StockDocsPage deptKey={deptKey} kind="TRANSFER" /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_processing') return <WarehousePageLoader><ProcessingQueuePage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_alerts') return <WarehousePageLoader><AlertsPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_exceptions') return <WarehousePageLoader><ExceptionsPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_slow') return <WarehousePageLoader><SlowStockPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_serial') return <WarehousePageLoader><SerialPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_approvals') return <WarehousePageLoader><ApprovalsPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_bundle') return <WarehousePageLoader><BundlePage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_my_tasks') return <WarehousePageLoader><MyWorkPage deptKey={deptKey} initialTab="tasks" /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_my_history') return <WarehousePageLoader><MyWorkPage deptKey={deptKey} initialTab="history" /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_products') return <WarehousePageLoader><CatalogPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_in_transit') return <WarehousePageLoader><InTransitPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_report_nxt') return <WarehousePageLoader><WarehouseReportsPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_report_warehouse') return <WarehousePageLoader><WarehouseStockReportPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_history') return <WarehousePageLoader><MovesPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_audit') return <WarehousePageLoader><AuditLogPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_control') return <WarehousePageLoader><StockControlPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_misa') return <WarehousePageLoader><MisaPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_report_minmax') return <WarehousePageLoader><MinMaxPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_count') return <WarehousePageLoader><CountPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_variance') return <WarehousePageLoader><CountVariancePage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_adjustment') return <WarehousePageLoader><StockAdjustmentPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_reservation') return <WarehousePageLoader><ReservationsPage deptKey={deptKey} /></WarehousePageLoader>;
  if (deptKey === 'WAREHOUSE' && moduleId === 'wh_locations') return <WarehousePageLoader><LocationsPage deptKey={deptKey} /></WarehousePageLoader>;

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
