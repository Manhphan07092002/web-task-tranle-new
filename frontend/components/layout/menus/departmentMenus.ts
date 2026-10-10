import {
  LayoutDashboard, FileText, ArrowLeftRight, ClipboardCheck, ShoppingCart,
  MapPin, TriangleAlert, Search, BarChart3, Package, Users, Briefcase,
  DollarSign, TrendingUp, HeartHandshake, ClipboardList, Wrench, Megaphone,
  Calculator, Truck, Factory, Presentation, UserCheck,
} from 'lucide-react';
import type { DeptKey, NavGroup } from './menuTypes';

const stub = (dept: string, id: string): string => `/dept/${dept}?m=${id}`;

// Full menu configs per department. Only WAREHOUSE and BOARD link to real
// pages today; other departments point to a placeholder until built.
const WAREHOUSE_GROUP: NavGroup = {
  label: 'Kho vận',
  scopeBadge: true,
  items: [
    { id: 'warehouse_dashboard', label: 'Tổng quan kho', icon: LayoutDashboard, path: '/warehouse/dashboard', permission: null },
    { id: 'warehouse_stock', label: 'Tồn kho', icon: Package, path: '/warehouse', permission: null },
    {
      id: 'wh_docs', label: 'Phiếu nhập / xuất', icon: FileText, path: '/warehouse/inbound', permission: null,
      children: [
        { id: 'wh_docs_all', label: 'Phiếu nhập / xuất', to: '/warehouse/inbound' },
        { id: 'wh_docs_in', label: 'Phiếu nhập kho mới', to: '/warehouse/inbound/new' },
        { id: 'wh_docs_out', label: 'Phiếu xuất kho thi công', to: '/warehouse/outbound/new' },
      ],
    },
    {
      id: 'wh_transfer', label: 'Điều chuyển', icon: ArrowLeftRight, path: '/warehouse/transfers', permission: null,
      children: [
        { id: 'wh_transfer_all', label: 'Điều chuyển', to: '/warehouse/transfers' },
        { id: 'wh_transfer_internal', label: 'Điều chuyển giữa các kho', to: '/warehouse/transfers/internal' },
        { id: 'wh_transfer_site', label: 'Điều chuyển ra công trường', to: '/warehouse/transfers/site' },
      ],
    },
    {
      id: 'wh_count', label: 'Kiểm kê', icon: ClipboardCheck, path: '/warehouse/count-period', permission: null,
      children: [
        { id: 'wh_count_all', label: 'Kiểm kê', to: '/warehouse/count-period' },
        { id: 'wh_count_period', label: 'Kỳ kiểm kê tháng', to: '/warehouse/count-period' },
        { id: 'wh_count_report', label: 'Biên bản xử lý thừa / thiếu', to: '/warehouse/count-report' },
      ],
    },
    { id: 'wh_pick_list', label: 'Danh sách lấy hàng', icon: ShoppingCart, path: '/warehouse/pick-list', permission: null },
    { id: 'wh_locations', label: 'Vị trí kho', icon: MapPin, path: '/warehouse/locations', permission: null },
    { id: 'wh_alerts', label: 'Cảnh báo tồn', icon: TriangleAlert, path: '/warehouse/alerts', permission: null },
    { id: 'wh_inquiry', label: 'Tra cứu tồn kho', icon: Search, path: '/warehouse/inquiry', permission: null },
    {
      id: 'wh_reports', label: 'Báo cáo phòng', icon: BarChart3, path: '/warehouse/reports',
      permission: ['view_all_reports', 'approve_dept_reports', 'director_feedback', 'manage_warehouse', 'admin_panel'],
      minLevel: 20,
    },
  ],
};

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
    { id: 'board_warehouse', label: 'Kho vận', icon: Package, path: '/warehouse/dashboard', permission: null },
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

export const DEPARTMENT_MENUS: Record<DeptKey, NavGroup> = {
  WAREHOUSE: WAREHOUSE_GROUP,
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
