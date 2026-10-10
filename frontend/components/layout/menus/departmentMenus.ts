import {
  LayoutDashboard, FileText, Users, Briefcase,
  DollarSign, TrendingUp, HeartHandshake, ClipboardList, Wrench, Megaphone,
  Calculator, Truck, Factory, Presentation, UserCheck, Package, TriangleAlert, BarChart3,
  ShoppingCart, ClipboardCheck, ArrowLeftRight, Search, History, CheckSquare, SlidersHorizontal,
  ArrowDownToLine, ArrowUpFromLine, BookmarkPlus, ScanLine,
} from 'lucide-react';
import type { DeptKey, NavGroup } from './menuTypes';

const stub = (dept: string, id: string): string => `/dept/${dept}?m=${id}`;

// Kho vận (spec 09_KHO_VAN §5 NV / §6 TP). Unbuilt modules point to the
// placeholder until their slice lands; labels/structure already match spec.
const WAREHOUSE_GROUPS: NavGroup[] = [
  {
    label: 'Kho vận',
    scopeBadge: true,
    items: [
      { id: 'wh_overview', label: 'Tổng quan kho', icon: LayoutDashboard, path: '/warehouse/overview', permission: null },
    ],
  },
  {
    label: 'Nghiệp vụ',
    items: [
      { id: 'wh_stock', label: 'Tồn kho', icon: Package, path: '/warehouse/stock', permission: ['stock.view'] },
      { id: 'wh_receipt', label: 'Nhập kho', icon: ArrowDownToLine, path: '/warehouse/receipts', permission: ['stock.receive'] },
      { id: 'wh_issue', label: 'Xuất kho', icon: ArrowUpFromLine, path: '/warehouse/issues', permission: ['stock.issue'] },
      { id: 'wh_transfer', label: 'Điều chuyển', icon: ArrowLeftRight, path: '/warehouse/transfers', permission: ['stock.transfer'] },
      { id: 'wh_reserve', label: 'Giữ hàng / Phân bổ', icon: BookmarkPlus, path: '/warehouse/reservations', permission: ['stock.manage'], minLevel: 20 },
      { id: 'wh_count', label: 'Kiểm kê', icon: ClipboardCheck, path: '/warehouse/counts', permission: ['stock.count'] },
    ],
  },
  {
    label: 'Hàng hóa',
    items: [
      { id: 'wh_products', label: 'Danh mục hàng hóa', icon: FileText, path: '/warehouse/products', permission: ['stock.manage'], minLevel: 20 },
      { id: 'wh_serials', label: 'Serial / Lô', icon: Search, path: '/warehouse/serials', permission: ['stock.view'] },
      { id: 'wh_scan', label: 'Quét mã', icon: ScanLine, path: '/warehouse/scan', permission: ['stock.view'] },
      { id: 'wh_combos', label: 'Combo / Bộ sản phẩm', icon: Package, path: '/warehouse/bundles', permission: ['stock.view'] },
      { id: 'wh_locations', label: 'Kho & Vị trí', icon: Factory, path: '/warehouse/locations', permission: ['stock.manage'], minLevel: 20 },
    ],
  },
  {
    label: 'Của tôi',
    items: [
      { id: 'wh_my_tasks', label: 'Việc cần xử lý', icon: ClipboardList, path: '/warehouse/my-tasks', permission: null, maxLevel: 10 },
      { id: 'wh_my_history', label: 'Lịch sử xử lý', icon: History, path: '/warehouse/my-history', permission: null, maxLevel: 10 },
    ],
  },
  {
    label: 'Kiểm soát',
    items: [
      { id: 'wh_alerts', label: 'Cảnh báo tồn kho', icon: TriangleAlert, path: '/warehouse/alerts', permission: ['stock.manage', 'stock.reports'], minLevel: 20 },
      { id: 'wh_exceptions', label: 'Hàng ngoại lệ', icon: ClipboardCheck, path: '/warehouse/alerts?tab=exceptions', permission: ['stock.manage'], minLevel: 20 },
      { id: 'wh_slow', label: 'Tồn lâu', icon: History, path: '/warehouse/alerts?tab=slow', permission: ['stock.manage', 'stock.reports'], minLevel: 20 },
    ],
  },
  {
    label: 'Phê duyệt',
    items: [
      { id: 'wh_approvals', label: 'Chờ duyệt', icon: CheckSquare, path: '/warehouse/approvals', permission: ['stock.approve'], minLevel: 20 },
      { id: 'wh_variances', label: 'Chênh lệch kiểm kê', icon: FileText, path: '/warehouse/variances', permission: ['stock.approve'], minLevel: 20 },
      { id: 'wh_adjust', label: 'Điều chỉnh tồn', icon: SlidersHorizontal, path: '/warehouse/adjustments', permission: ['stock.adjust'], minLevel: 20 },
    ],
  },
  {
    label: 'Báo cáo',
    items: [
      { id: 'wh_rep_inout', label: 'Nhập – Xuất – Tồn', icon: BarChart3, path: '/warehouse/reports?tab=overview', permission: ['stock.reports'], minLevel: 20 },
      { id: 'wh_rep_wh', label: 'Tồn theo kho', icon: BarChart3, path: '/warehouse/reports?tab=by-warehouse', permission: ['stock.reports'], minLevel: 20 },
      { id: 'wh_rep_minmax', label: 'Tồn Min / Max', icon: BarChart3, path: '/warehouse/alerts?tab=policies', permission: ['stock.reports'], minLevel: 20 },
      { id: 'wh_rep_transit', label: 'Đang vận chuyển', icon: Truck, path: '/warehouse/reports?tab=transit', permission: ['stock.reports'], minLevel: 20 },
      { id: 'wh_rep_history', label: 'Lịch sử hàng hóa', icon: History, path: '/warehouse/reports?tab=history', permission: ['stock.reports'], minLevel: 20 },
      { id: 'wh_rep_misa', label: 'Đối soát MISA', icon: FileText, path: stub('warehouse', 'wh_rep_misa'), permission: ['misa.reconcile'], minLevel: 20 },
    ],
  },
];

// Ban Giám đốc sees aggregate views only — never the inner submenus of each department.
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

function stubGroup(key: Lowercase<DeptKey>, label: string, items: { id: string; label: string; icon: typeof LayoutDashboard }[]): NavGroup {  return {
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
  WAREHOUSE: WAREHOUSE_GROUPS,
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
};
