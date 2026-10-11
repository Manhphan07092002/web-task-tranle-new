import {
  LayoutDashboard, FileText, Users, Briefcase,
  DollarSign, TrendingUp, HeartHandshake, ClipboardList, Wrench, Megaphone,
  Calculator, Truck, Factory, Presentation, UserCheck, Package, TriangleAlert, BarChart3,
  ShoppingCart, ClipboardCheck, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight,
  ScanLine, Boxes, Archive, MapPin, Bell, Hourglass, CheckCircle2, Scale,
  SlidersHorizontal, History, RefreshCw, TrendingDown, ListChecks, PackageCheck,
} from 'lucide-react';
import type { DeptKey, NavGroup, NavItem } from './menuTypes';

const stub = (dept: string, id: string): string => `/dept/${dept}?m=${id}`;

// Trang tổng quát riêng của từng phòng ban sau login.
// BOARD (Ban Giám đốc) giữ "/" (dashboard điều hành chung).
// Các phòng còn lại về module overview đầu tiên của chính phòng đó.
export function getDeptHomePath(key: DeptKey | null): string | null {
  if (!key || key === 'BOARD') return null;
  const first = deptFirstItem(key);
  return first?.path ?? `/dept/${key.toLowerCase()}`;
}

// Một phòng có thể có 1 group (BOARD/các stub) hoặc nhiều group
// (Kho vận: Vận hành / Hàng hóa / Kiểm soát / Phê duyệt / Báo cáo theo 09_KHO_VAN).
export function asGroupList(entry: NavGroup | NavGroup[] | undefined): NavGroup[] {
  if (!entry) return [];
  return Array.isArray(entry) ? entry : [entry];
}

export function deptFirstItem(key: DeptKey): NavItem | undefined {
  return asGroupList(DEPARTMENT_MENUS[key])[0]?.items?.[0];
}

export function deptFindItem(key: DeptKey, id: string | null): NavItem | undefined {
  if (!id) return undefined;
  for (const g of asGroupList(DEPARTMENT_MENUS[key])) {
    const found = g.items.find((i) => i.id === id);
    if (found) return found;
  }
  return undefined;
}

export function deptAllItems(key: DeptKey): NavItem[] {
  return asGroupList(DEPARTMENT_MENUS[key]).flatMap((g) => g.items);
}

// Full menu configs per department. Only BOARD links to real
// pages today; other departments point to a placeholder until built.
const BOARD_GROUP: NavGroup = {
  label: 'Ban Giám đốc',
  scopeBadge: true,
  items: [
    { id: 'board_exec', label: 'Tổng quan điều hành', icon: LayoutDashboard, path: '/', permission: null },
    { id: 'board_depts', label: 'Tình hình phòng ban', icon: Users, path: '/team', permission: null },
    { id: 'board_revenue', label: 'Doanh thu & tài chính', icon: DollarSign, path: '/revenue', permission: null },
    { id: 'board_projects', label: 'Dự án', icon: Briefcase, path: '/projects', permission: null },
    { id: 'board_sales', label: 'Kinh doanh', icon: TrendingUp, path: '/contracts', permission: null },
    { id: 'board_warehouse', label: 'Kho vận', icon: Package, path: '/dept/warehouse', permission: null },
    { id: 'board_alerts', label: 'Cảnh báo', icon: TriangleAlert, path: '/notifications', permission: null },
    { id: 'board_reports', label: 'Báo cáo tổng hợp', icon: BarChart3, path: '/reports', permission: null },
  ],
};

function stubGroup(key: Lowercase<DeptKey>, label: string, items: { id: string; label: string; icon: typeof LayoutDashboard }[]): NavGroup {
  return {
    label,
    scopeBadge: true,
    items: items.map((item) => ({
      ...item,
      path: stub(key, item.id),
      permission: null as string[] | null,
    })),
  };
}

export const DEPARTMENT_MENUS: Partial<Record<DeptKey, NavGroup | NavGroup[]>> = {
  BOARD: BOARD_GROUP,
  SALES: stubGroup('sales', 'Kinh doanh', [
    { id: 'sales_overview', label: 'Tổng quan kinh doanh', icon: LayoutDashboard },
    { id: 'sales_customers', label: 'Khách hàng', icon: Users },
    { id: 'sales_leads', label: 'Cơ hội kinh doanh', icon: TrendingUp },
    { id: 'sales_quotes', label: 'Báo giá', icon: FileText },
    { id: 'sales_orders', label: 'Đơn hàng', icon: ShoppingCart },
    { id: 'sales_contracts', label: 'Hợp đồng', icon: Briefcase },
    { id: 'sales_aftercare', label: 'Chăm sóc khách hàng', icon: HeartHandshake },
    { id: 'sales_reports', label: 'Báo cáo phòng', icon: BarChart3 },
  ]),
  PROJECT: stubGroup('project', 'Dự án', [
    { id: 'project_overview', label: 'Tổng quan dự án', icon: LayoutDashboard },
    { id: 'project_list', label: 'Danh sách dự án', icon: Briefcase },
    { id: 'project_progress', label: 'Tiến độ dự án', icon: TrendingUp },
    { id: 'project_tasks', label: 'Công việc dự án', icon: ClipboardList },
    { id: 'project_hr', label: 'Nhân sự dự án', icon: Users },
    { id: 'project_materials', label: 'Vật tư dự án', icon: Package },
    { id: 'project_docs', label: 'Hồ sơ dự án', icon: FileText },
    { id: 'project_reports', label: 'Báo cáo phòng', icon: BarChart3 },
  ]),
  TECHNICAL_WARRANTY: stubGroup('technical_warranty', 'Kỹ thuật - Bảo hành', [
    { id: 'tech_overview', label: 'Tổng quan kỹ thuật', icon: LayoutDashboard },
    { id: 'tech_requests', label: 'Yêu cầu kỹ thuật', icon: Wrench },
    { id: 'tech_tickets', label: 'Phiếu xử lý', icon: ClipboardList },
    { id: 'tech_warranty', label: 'Bảo hành', icon: ClipboardCheck },
    { id: 'tech_maintenance', label: 'Bảo trì', icon: Wrench },
    { id: 'tech_devices', label: 'Thiết bị', icon: Package },
    { id: 'tech_reports', label: 'Báo cáo phòng', icon: BarChart3 },
  ]),
  MARKETING: stubGroup('marketing', 'Marketing', [
    { id: 'mkt_overview', label: 'Tổng quan Marketing', icon: LayoutDashboard },
    { id: 'mkt_campaigns', label: 'Chiến dịch', icon: Megaphone },
    { id: 'mkt_content', label: 'Nội dung', icon: FileText },
    { id: 'mkt_channels', label: 'Kênh truyền thông', icon: Presentation },
    { id: 'mkt_leads', label: 'Leads Marketing', icon: TrendingUp },
    { id: 'mkt_reports', label: 'Báo cáo phòng', icon: BarChart3 },
  ]),
  PROCUREMENT: stubGroup('procurement', 'Mua hàng', [
    { id: 'po_overview', label: 'Tổng quan mua hàng', icon: LayoutDashboard },
    { id: 'po_requests', label: 'Yêu cầu mua hàng', icon: ClipboardList },
    { id: 'po_suppliers', label: 'Nhà cung cấp', icon: Factory },
    { id: 'po_quotes', label: 'Báo giá nhà cung cấp', icon: FileText },
    { id: 'po_orders', label: 'Đơn mua hàng', icon: ShoppingCart },
    { id: 'po_tracking', label: 'Theo dõi đơn hàng', icon: Truck },
    { id: 'po_reports', label: 'Báo cáo phòng', icon: BarChart3 },
  ]),
  ACCOUNTING: stubGroup('accounting', 'Kế toán', [
    { id: 'acc_overview', label: 'Tổng quan kế toán', icon: LayoutDashboard },
    { id: 'acc_payments', label: 'Đề nghị thanh toán', icon: FileText },
    { id: 'acc_cashflow', label: 'Thu / Chi', icon: DollarSign },
    { id: 'acc_debts', label: 'Công nợ', icon: ClipboardList },
    { id: 'acc_invoices', label: 'Hóa đơn', icon: FileText },
    { id: 'acc_reports', label: 'Báo cáo phòng', icon: BarChart3 },
  ]),
  HR: stubGroup('hr', 'Hành chính - Nhân sự', [
    { id: 'hr_overview', label: 'Tổng quan HCNS', icon: LayoutDashboard },
    { id: 'hr_staff', label: 'Nhân viên', icon: Users },
    { id: 'hr_attendance', label: 'Chấm công', icon: UserCheck },
    { id: 'hr_leave', label: 'Nghỉ phép', icon: ClipboardList },
    { id: 'hr_recruit', label: 'Tuyển dụng', icon: Megaphone },
    { id: 'hr_reports', label: 'Báo cáo phòng', icon: BarChart3 },
  ]),
  // Kho vận — theo new-base/tranle_system_docs/09_KHO_VAN (§5-6, V8.2).
  // Chung route/component cho NV (level 10) và TP (level >= 20), khác data scope.
  // Mục TP-only gắn minLevel: 20 (NV không thấy; Admin 99 cũng ẩn theo D4).
  WAREHOUSE: [
    {
      label: 'Kho vận',
      scopeBadge: true,
      items: [
        { id: 'wh_overview', label: 'Tổng quan kho vận', icon: LayoutDashboard, path: stub('warehouse', 'wh_overview'), permission: null },
      ],
    },
    {
      label: 'Vận hành',
      items: [
        { id: 'wh_stock', label: 'Tồn kho', icon: Package, path: stub('warehouse', 'wh_stock'), permission: null },
        { id: 'wh_receipt', label: 'Nhập kho', icon: ArrowDownToLine, path: stub('warehouse', 'wh_receipt'), permission: null },
        { id: 'wh_issue', label: 'Xuất kho', icon: ArrowUpFromLine, path: stub('warehouse', 'wh_issue'), permission: null },
        { id: 'wh_transfer', label: 'Điều chuyển', icon: ArrowLeftRight, path: stub('warehouse', 'wh_transfer'), permission: null },
        { id: 'wh_count', label: 'Kiểm kê', icon: ClipboardCheck, path: stub('warehouse', 'wh_count'), permission: null },
        { id: 'wh_reservation', label: 'Giữ hàng / Phân bổ', icon: PackageCheck, path: stub('warehouse', 'wh_reservation'), permission: null, minLevel: 20 },
      ],
    },
    {
      label: 'Hàng hóa',
      items: [
        { id: 'wh_serial', label: 'Serial / Lô', icon: ScanLine, path: stub('warehouse', 'wh_serial'), permission: null },
        { id: 'wh_bundle', label: 'Combo / Bộ sản phẩm', icon: Boxes, path: stub('warehouse', 'wh_bundle'), permission: null },
        { id: 'wh_products', label: 'Danh mục hàng hóa', icon: Archive, path: stub('warehouse', 'wh_products'), permission: null, minLevel: 20 },
        { id: 'wh_locations', label: 'Kho & Vị trí', icon: MapPin, path: stub('warehouse', 'wh_locations'), permission: null, minLevel: 20 },
      ],
    },
    {
      label: 'Của tôi',
      items: [
        { id: 'wh_my_tasks', label: 'Việc cần xử lý', icon: ListChecks, path: stub('warehouse', 'wh_my_tasks'), permission: null },
        { id: 'wh_my_history', label: 'Lịch sử xử lý', icon: History, path: stub('warehouse', 'wh_my_history'), permission: null },
      ],
    },
    {
      label: 'Kiểm soát',
      items: [
        { id: 'wh_alerts', label: 'Cảnh báo tồn kho', icon: Bell, path: stub('warehouse', 'wh_alerts'), permission: null, minLevel: 20 },
        { id: 'wh_exceptions', label: 'Hàng ngoại lệ', icon: TriangleAlert, path: stub('warehouse', 'wh_exceptions'), permission: null, minLevel: 20 },
        { id: 'wh_slow', label: 'Tồn lâu', icon: Hourglass, path: stub('warehouse', 'wh_slow'), permission: null, minLevel: 20 },
      ],
    },
    {
      label: 'Phê duyệt',
      items: [
        { id: 'wh_approvals', label: 'Chờ duyệt', icon: CheckCircle2, path: stub('warehouse', 'wh_approvals'), permission: null, minLevel: 20 },
        { id: 'wh_variance', label: 'Chênh lệch kiểm kê', icon: Scale, path: stub('warehouse', 'wh_variance'), permission: null, minLevel: 20 },
        { id: 'wh_adjustment', label: 'Điều chỉnh tồn', icon: SlidersHorizontal, path: stub('warehouse', 'wh_adjustment'), permission: null, minLevel: 20 },
      ],
    },
    {
      label: 'Báo cáo',
      items: [
        { id: 'wh_report_nxt', label: 'Nhập – Xuất – Tồn', icon: FileText, path: stub('warehouse', 'wh_report_nxt'), permission: null, minLevel: 20 },
        { id: 'wh_report_warehouse', label: 'Tồn theo kho', icon: BarChart3, path: stub('warehouse', 'wh_report_warehouse'), permission: null, minLevel: 20 },
        { id: 'wh_report_minmax', label: 'Tồn Min / Max', icon: TrendingDown, path: stub('warehouse', 'wh_report_minmax'), permission: null, minLevel: 20 },
        { id: 'wh_in_transit', label: 'Đang vận chuyển', icon: Truck, path: stub('warehouse', 'wh_in_transit'), permission: null, minLevel: 20 },
        { id: 'wh_history', label: 'Lịch sử hàng hóa', icon: History, path: stub('warehouse', 'wh_history'), permission: null, minLevel: 20 },
        { id: 'wh_misa', label: 'Đối soát MISA', icon: RefreshCw, path: stub('warehouse', 'wh_misa'), permission: null, minLevel: 20 },
      ],
    },
  ],
};
