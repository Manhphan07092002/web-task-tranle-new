# THIẾT KẾ HỆ THỐNG TRAN LE – UI/UX, NAVIGATION VÀ COMPONENT

## 1. Mục tiêu thiết kế

Thiết kế giao diện theo mô hình ứng dụng doanh nghiệp dạng platform, tương tự tư duy của Cogover nhưng tối ưu cho nghiệp vụ thực tế của Tran Le.

Nguyên tắc:
- Mỗi phòng ban có App riêng.
- Mỗi App có Dashboard, danh sách Object, báo cáo và quy trình riêng.
- Các App dùng chung layout, component và dữ liệu lõi.
- Dashboard thay đổi theo phòng ban và cấp quản lý.
- Người dùng chỉ nhìn thấy chức năng thuộc phạm vi quyền.
- Giao diện ưu tiên thao tác nhanh, ít nhập lại dữ liệu.
- Mọi record quan trọng đều có Activity/Audit/Document liên quan.

---

## 2. Kiến trúc điều hướng tổng thể

```text
TRAN LE PLATFORM
│
├── Tổng quan
├── Kinh doanh
├── Dự án
├── Kỹ thuật - Bảo hành
├── Kế toán
├── Hành chính - Nhân sự
├── Marketing
├── Kho vận
├── Mua hàng
│
├── Công việc
├── Quy trình
├── Tài liệu
├── Tích hợp
└── Cài đặt
```

### 2.1 Quy tắc hiển thị App

Nhân viên:
- Chỉ thấy App thuộc phòng ban
- Công việc
- Tài liệu
- Tổng quan cá nhân

Trưởng phòng:
- App phòng ban
- Dashboard phòng
- Approval
- Báo cáo phòng

Phó Giám đốc:
- Các App thuộc phòng được phân công quản lý
- Executive Dashboard

Giám đốc:
- Toàn bộ App nghiệp vụ
- Company Dashboard
- Approval cấp cao

Admin:
- Cài đặt
- Tích hợp
- Workflow
- Audit/System Log
- Không mặc định có quyền phê duyệt nghiệp vụ

---

# 3. App Launcher

Màn hình "Tất cả ứng dụng" dùng dạng card.

```text
┌───────────────────────────────────────────────┐
│              TẤT CẢ ỨNG DỤNG                 │
├───────────────────────────────────────────────┤
│ [Kinh doanh]      [Dự án]       [Kỹ thuật]   │
│ [Kế toán]         [HCNS]        [Marketing]  │
│ [Kho vận]         [Mua hàng]                  │
│                                               │
│ [Công việc]       [Quy trình]   [Tài liệu]   │
│ [Tích hợp]        [Cài đặt]                   │
└───────────────────────────────────────────────┘
```

Mỗi App Card có:
- Tên app
- Icon
- Mô tả ngắn
- Badge số việc cần xử lý nếu có
- Điều kiện quyền

---

# 4. Global Layout

```text
┌──────────────────────────────────────────────────────────────┐
│ Logo | App hiện tại | Search | +Tạo | 🔔 | User             │
├───────────────┬──────────────────────────────────────────────┤
│               │                                              │
│ Sidebar App   │              Main Content                    │
│               │                                              │
│ Dashboard     │                                              │
│ Danh sách     │                                              │
│ Báo cáo       │                                              │
│ Cấu hình      │                                              │
│               │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

### Header toàn cục

- Logo Tran Le
- App Switcher
- Global Search
- Nút `+ Tạo`
- Việc chờ duyệt
- Notification
- User Menu

### User menu
- Hồ sơ
- Dashboard của tôi
- Đổi mật khẩu
- Cài đặt cá nhân
- Đăng xuất

---

# 5. Sidebar theo App

Sidebar phải được dựng theo metadata/config thay vì hard-code nhiều lần.

Ví dụ App Kinh doanh:

```text
KINH DOANH

Tổng quan
  Dashboard
  Công việc

Khách hàng
  Khách hàng
  Liên hệ
  Đại lý
  Đối tác

Bán hàng
  Lead
  Cơ hội
  Yêu cầu kỹ thuật
  Báo giá
  Hợp đồng
  Đơn hàng

Sản phẩm
  Sản phẩm
  Bảng giá

Báo cáo
  Doanh số
  Pipeline
  Công nợ
```

---

# 6. Dashboard Design

Dashboard được xây từ Widget.

## 6.1 Widget types

- Metric Card
- Donut Chart
- Bar Chart
- Line Chart
- Pipeline / Funnel
- Data Table
- Activity List
- Approval List
- Alert List
- Calendar
- Progress
- Ranking

## 6.2 Dashboard Grid

Sử dụng grid 12 cột.

```text
┌────────────┬────────────┬────────────┬────────────┐
│ KPI 1      │ KPI 2      │ KPI 3      │ KPI 4      │
├────────────┴────────────┼────────────┴────────────┤
│ Biểu đồ Pipeline        │ Doanh số theo nhân viên │
├─────────────────────────┼─────────────────────────┤
│ Việc cần xử lý          │ Cảnh báo                 │
└─────────────────────────┴─────────────────────────┘
```

Widget phải hỗ trợ:
- Refresh
- Drill-down
- Filter
- Date range
- Export nếu cần
- Permission

---

# 7. Dashboard theo cấp

## 7.1 Nhân viên

Tập trung vào hành động:

- Việc hôm nay
- Việc quá hạn
- Việc sắp đến hạn
- Lịch
- Thông báo
- Dữ liệu được giao

## 7.2 Trưởng phòng

Tập trung vào quản lý:

- KPI phòng
- Workload nhân viên
- Việc quá hạn
- Approval
- Hiệu suất
- Cảnh báo

## 7.3 Phó Giám đốc

Tập trung vào các phòng được giao:

- Revenue
- Pipeline
- Project
- Receivable
- Inventory
- SLA
- Cảnh báo

## 7.4 Giám đốc

Tập trung vào quyết định:

- Doanh thu
- Lợi nhuận/biên lợi nhuận nếu dữ liệu cho phép
- Pipeline
- Công nợ
- Dự án trễ
- Tồn kho
- Các yêu cầu chờ duyệt cấp cao
- Cảnh báo trọng yếu

## 7.5 Admin

Tập trung hệ thống:

- User
- API
- Workflow errors
- Sync errors
- Email errors
- Storage
- Backup
- Audit

---

# 8. Standard List Page

Mọi danh sách Object dùng cùng một component.

```text
┌───────────────────────────────────────────────────────────┐
│ Lead (128)                         [+ Tạo Lead]           │
├───────────────────────────────────────────────────────────┤
│ 🔍 Tìm kiếm | View ▼ | Bộ lọc | Cột | Export | Refresh   │
├───────────────────────────────────────────────────────────┤
│ ☐ | Mã | Tên | Khách hàng | Owner | Trạng thái | ...    │
│-----------------------------------------------------------│
│ ☐ | L01 | ABC | Công ty A | Mạnh | Qualified | ...       │
│ ☐ | L02 | XYZ | Công ty B | An   | New       | ...       │
└───────────────────────────────────────────────────────────┘
```

Chức năng:
- Search
- Filter AND/OR
- Saved View
- Shared View
- Sort
- Column chooser
- Bulk action
- Pagination
- Export
- Refresh
- AI Search sau này

---

# 9. Filter Builder

```text
Bộ lọc

[Trạng thái] [=] [Đang mở]

AND

[Giá trị] [>] [100,000,000]

AND
(
  [Nguồn] [=] [Website]
  OR
  [Nguồn] [=] [Giới thiệu]
)

[Lưu View]
```

Backend luôn:
- whitelist field
- whitelist operator
- parameterized query
- inject data scope

---

# 10. Record Detail Page

Dùng cấu trúc nhất quán cho Lead, Opportunity, Contract, Project, Ticket...

```text
┌──────────────────────────────────────────────────────────────┐
│ OP-2026-001 | Nhà máy ABC           [Edit] [Action ▼]       │
├──────────────────────────────────────────────────────────────┤
│ Trạng thái: Đàm phán   Owner: Nguyễn A   Value: 1.2 tỷ      │
├──────────────────────────────────────────────────────────────┤
│ [Thông tin] [Công việc] [Tài liệu] [Email] [Lịch sử]        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                     Nội dung tab                             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Tab chuẩn:
- Overview
- Related
- Tasks
- Documents
- Comments
- Activity
- Audit

---

# 11. Form Create / Edit

Nguyên tắc:
- Chia section
- Không đưa 30 field vào một khối
- Field bắt buộc rõ ràng
- Lookup có search
- Auto-fill dữ liệu liên quan
- Validation realtime
- Draft nếu nghiệp vụ cần

Ví dụ Quote:

```text
THÔNG TIN CHUNG
Khách hàng
Cơ hội
Sales Owner
Ngày hiệu lực

SẢN PHẨM
------------------------------------------------
Sản phẩm | SL | Đơn giá | CK | VAT | Thành tiền
------------------------------------------------

ĐIỀU KHOẢN
Thanh toán
Giao hàng
Bảo hành

TỔNG
Trước VAT
VAT
Sau VAT

[Lưu nháp] [Gửi duyệt]
```

---

# 12. Activity Timeline

Mọi record quan trọng có timeline.

```text
10:02 Nguyễn A tạo cơ hội

10:30 Nguyễn B cập nhật
Stage:
Qualified → Survey

11:45 Hệ thống
Technical Request #TR-102 được tạo

14:12 Trưởng phòng
Phê duyệt báo giá

15:03 Nguyễn A
Gửi báo giá cho khách
```

Activity và Audit là hai lớp:
- Activity: dễ đọc cho người dùng
- Audit: chi tiết kỹ thuật, không được xóa

---

# 13. Approval UX

Màn Approval Center:

```text
PHÊ DUYỆT

[Chờ tôi duyệt] [Đã duyệt] [Yêu cầu của tôi]

┌────────────────────────────────────────────┐
│ Báo giá #Q-102                            │
│ Công ty ABC                               │
│ 1,250,000,000 VND                         │
│ Chiết khấu: 18%                           │
│ Người gửi: Nguyễn A                       │
│                                           │
│ [Từ chối]       [Yêu cầu sửa] [Phê duyệt] │
└────────────────────────────────────────────┘
```

Approval detail phải có:
- dữ liệu chính
- lý do xin duyệt
- lịch sử duyệt
- comment
- file liên quan

---

# 14. Workflow Designer – phiên bản đầu

Không cần BPMN đầy đủ ngay.

```text
Trigger
  ↓
Condition
  ↓
Assign
  ↓
Approval
  ↓
Notify
  ↓
Update Status
```

UI có thể là block flow:

```text
[ Khi Báo giá được gửi duyệt ]
              ↓
[ Nếu discount > 10% ]
              ↓
[ Trưởng phòng Kinh doanh duyệt ]
              ↓
[ Nếu value > 1 tỷ ]
              ↓
[ Ban Giám đốc duyệt ]
              ↓
[ Gửi thông báo cho Sales ]
```

---

# 15. App Kinh doanh – Wireframe

```text
┌─────────────────────────────────────────────────────────────┐
│ KINH DOANH                                                  │
├───────────────┬─────────────────────────────────────────────┤
│ Dashboard     │ Revenue | Pipeline | Quote | Receivable     │
│ Customers     │                                             │
│ Leads         │ Funnel                                      │
│ Opportunities │                                             │
│ Quotes        │ Sales Performance                           │
│ Contracts     │                                             │
│ Orders        │ Approval / Customer Follow-up               │
└───────────────┴─────────────────────────────────────────────┘
```

---

# 16. App Kỹ thuật – Wireframe

```text
┌─────────────────────────────────────────────────────────────┐
│ KỸ THUẬT - BẢO HÀNH                                        │
├───────────────┬─────────────────────────────────────────────┤
│ Dashboard     │ Technical Request | Ticket | SLA            │
│ Requests      │                                             │
│ Surveys       │ Workload kỹ thuật                           │
│ BOM           │                                             │
│ Drawings      │ Project / Ticket Overdue                    │
│ Tickets       │                                             │
│ Maintenance   │ Failure by Product                          │
│ Assets        │                                             │
└───────────────┴─────────────────────────────────────────────┘
```

---

# 17. App Dự án – Wireframe

```text
┌─────────────────────────────────────────────────────────────┐
│ DỰ ÁN                                                       │
├───────────────┬─────────────────────────────────────────────┤
│ Dashboard     │ Project KPI                                 │
│ Projects      │                                             │
│ Milestones    │ Timeline / Progress                         │
│ Tasks         │                                             │
│ Materials     │ Issue / Risk                                │
│ Acceptance    │                                             │
│ Handover      │ Upcoming Acceptance                         │
└───────────────┴─────────────────────────────────────────────┘
```

---

# 18. App Kho – Wireframe

```text
┌─────────────────────────────────────────────────────────────┐
│ KHO VẬN                                                     │
├───────────────┬─────────────────────────────────────────────┤
│ Dashboard     │ Inventory Value | Low Stock                 │
│ Stock         │                                             │
│ Receipt       │ Inventory by Warehouse                      │
│ Issue         │                                             │
│ Transfer      │ Recent Movements                            │
│ Stock Count   │                                             │
│ Serial/Lot    │ Slow-moving Stock                           │
└───────────────┴─────────────────────────────────────────────┘
```

---

# 19. App Kế toán – Wireframe

```text
┌─────────────────────────────────────────────────────────────┐
│ KẾ TOÁN                                                     │
├───────────────┬─────────────────────────────────────────────┤
│ Dashboard     │ AR | AP | Payment | Advance                 │
│ Receivable    │                                             │
│ Payable       │ Aging Receivable                            │
│ Payment Req   │                                             │
│ Advance       │ Cash Flow Forecast                          │
│ Settlement    │                                             │
│ MISA Sync     │ Pending Approvals                           │
└───────────────┴─────────────────────────────────────────────┘
```

---

# 20. Responsive

Desktop là ưu tiên chính.

Tablet:
- Sidebar collapse
- Widget 2 cột

Mobile:
- My Tasks
- Approval
- Ticket
- Quick Create
- Notification
- Record detail tối giản

Không cần nhồi toàn bộ dashboard desktop vào mobile.

---

# 21. Design Tokens đề xuất

## Spacing
- 4
- 8
- 12
- 16
- 24
- 32

## Border radius
- Small: 6
- Medium: 10
- Large: 14

## Typography
- Page title: 24–28
- Section title: 18–20
- Body: 14–16
- Caption: 12–13

## Trạng thái
Không phụ thuộc chỉ vào màu; luôn có label/icon.

Ví dụ:
- Draft
- Pending
- Approved
- Rejected
- In Progress
- Done
- Cancelled

---

# 22. Frontend Component đề xuất

```text
components/
├── AppShell
├── AppSwitcher
├── Sidebar
├── PageHeader
├── EntityList
├── FilterBuilder
├── SavedViewSelector
├── ColumnSelector
├── EntityForm
├── LookupField
├── StatusBadge
├── ActivityTimeline
├── AuditTimeline
├── ApprovalPanel
├── DocumentPanel
├── TaskPanel
├── DashboardGrid
├── DashboardWidget
├── MetricCard
├── ChartWidget
├── DataTableWidget
└── EmptyState
```

---

# 23. Route Structure đề xuất

```text
/dashboard

/sales
/sales/leads
/sales/opportunities
/sales/quotes
/sales/contracts

/projects
/projects/:id

/technical/requests
/technical/surveys
/technical/tickets
/technical/assets

/purchasing/requests
/purchasing/rfqs
/purchasing/orders

/inventory/stock
/inventory/receipts
/inventory/issues
/inventory/transfers

/finance/receivables
/finance/payables
/finance/payment-requests

/hr/employees

/marketing/campaigns

/work/tasks
/process/workflows
/process/approvals
/documents
/integrations
/settings
```

---

# 24. Permission trên UI

Frontend chỉ dùng permission để:
- ẩn menu
- ẩn action
- disable field

Backend mới là nguồn quyết định cuối cùng.

Ví dụ:
- `quote.create`
- `quote.read.own`
- `quote.read.department`
- `quote.approve.level1`
- `quote.approve.level2`

---

# 25. Trạng thái UI chuẩn

Mọi page phải có:
- Loading
- Empty
- Error
- Permission denied
- No result
- Offline/Retry nếu cần

---

# 26. Definition of Done cho thiết kế

Một màn được coi là đủ thiết kế khi có:
- Actor
- Mục tiêu
- Quyền
- Route
- List fields
- Filter
- Form fields
- Action
- State
- Related data
- Dashboard widget
- Audit
- Error/empty/loading
- Mobile behavior tối thiểu

---

# 27. Ưu tiên triển khai UI

1. AppShell + Sidebar + App Switcher
2. EntityList dùng chung
3. FilterBuilder + SavedView
4. Record Detail + Tabs
5. Activity/Audit
6. Dashboard Grid + Widget
7. Approval Center
8. Sales screens
9. Technical screens
10. Project screens
11. Purchasing/Inventory
12. Finance
13. Admin/Settings
14. Workflow Designer
15. Integration screens

---

# 28. Mục tiêu cuối cùng

UI phải tạo cảm giác đây là một hệ thống duy nhất:

```text
Lead
→ Opportunity
→ Technical Request
→ Quote
→ Contract
→ Project
→ Purchase / Stock
→ Acceptance
→ Payment
→ Warranty
```

Người dùng không cần nhập lại Customer, Product, Project hoặc tài liệu khi chuyển qua phòng ban khác.

Mỗi phòng nhìn cùng dữ liệu dưới góc nhìn nghiệp vụ của mình; Dashboard và quyền thay đổi theo vai trò.
