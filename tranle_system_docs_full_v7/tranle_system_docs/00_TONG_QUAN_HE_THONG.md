# TỔNG QUAN HỆ THỐNG QUẢN TRỊ TRAN LE

## 1. Mục tiêu

Xây dựng hệ thống quản trị nội bộ cho Tran Le theo tư duy platform tương tự Cogover:

**App nghiệp vụ → Object dữ liệu → Process/Workflow → Dashboard → Permission/Data Scope → Integration**

Hệ thống không chỉ là web giao việc mà trở thành nền tảng quản trị xuyên phòng ban, dùng chung dữ liệu và quy trình.

## 2. Phạm vi phòng ban

1. Ban Giám đốc
2. Phòng Kế toán
3. Phòng Hành chính - Nhân sự
4. Phòng Kinh doanh
5. Phòng Dự án
6. Phòng Kỹ thuật - Bảo hành
7. Phòng Marketing
8. Kho vận
9. Mua hàng

## 3. Các app chính

### App nghiệp vụ
- Kinh doanh
- Dự án
- Kỹ thuật - Bảo hành
- Kế toán
- Hành chính - Nhân sự
- Marketing
- Kho vận
- Mua hàng

### App nền tảng
- Tổng quan
- Công việc
- Quy trình
- Tài liệu
- Tích hợp
- Cài đặt

## 4. Chuỗi nghiệp vụ xương sống

```text
Marketing / Sales
      ↓
Lead
      ↓
Opportunity
      ↓
Yêu cầu kỹ thuật
      ↓
Khảo sát
      ↓
Giải pháp + BOM
      ↓
Báo giá
      ↓
Hợp đồng
      ↓
Dự án
      ↓
Yêu cầu vật tư
  ┌────┴────┐
  ↓         ↓
Kho       Mua hàng
  └────┬────┘
       ↓
Thi công
       ↓
Nghiệm thu
       ↓
Bàn giao
       ↓
Thanh toán
       ↓
Công nợ
       ↓
Bảo hành / Bảo trì / O&M
```

## 5. Nguyên tắc thiết kế

- Không tạo dữ liệu trùng giữa các app.
- Customer, Contact, Product, Employee, Project, Task, Document là dữ liệu dùng chung.
- Mỗi thay đổi quan trọng phải có lịch sử.
- Quy trình phê duyệt không hard-code rải rác trong từng module.
- Backend luôn kiểm soát quyền và data scope.
- Dashboard tách theo phòng ban và cấp quản lý.
- Admin là vai trò hệ thống, không đồng nghĩa quyền duyệt nghiệp vụ.
- Kế toán nghiệp vụ nội bộ nằm trên web, kế toán chuẩn vẫn tích hợp MISA.
- AI chỉ hỗ trợ tìm kiếm, tóm tắt, đề xuất; hành động quan trọng vẫn phải qua rule/permission/approval.

## 6. Cấp quản lý và quyền dữ liệu

### L1 - Nhân viên
- Xem dữ liệu cá nhân, dữ liệu được giao, dữ liệu có liên quan.

### L2 - Trưởng phòng
- Xem dữ liệu toàn phòng.
- Phân công, theo dõi, duyệt theo thẩm quyền.

### L3 - Phó Giám đốc
- Xem các phòng/lĩnh vực được phân công phụ trách.

### L4 - Giám đốc
- Xem toàn công ty.
- Duyệt các nghiệp vụ cấp cao.

### SYS - Admin
- Quản trị user, role, permission, workflow, cấu hình, integration, log.
- Không mặc định có quyền duyệt nghiệp vụ.

## 7. Module lõi

- Organization
- User / Employee
- Department / Position
- Role / Permission / Data Scope
- Task / Epic / Subtask
- Comment / Attachment
- Audit Log
- Saved View / Dynamic Filter
- Dashboard Template / Widget
- Workflow / Approval
- Document / Version
- Integration / API / Webhook

## 8. Lộ trình phát triển đề xuất

1. Chuẩn hóa Core, Department, Position, Role, Permission, Data Scope
2. Refactor Task + Epic + Related Entity + Audit
3. Dynamic Filter + Saved View
4. Dashboard Template theo phòng/cấp
5. CRM Sales
6. Technical Request + Survey
7. Quotation + Contract
8. Workflow + Approval Center
9. Project Management nâng cấp
10. Service / Warranty / Customer Asset
11. Purchasing
12. Inventory ledger + serial/lot
13. Finance Operations
14. MISA Integration
15. AI Search / Summary / Automation

## 9. Tích hợp MISA

Tran Le Platform có Integration Hub riêng để kết nối MISA. Nguyên tắc:

- Tran Le quản lý CRM, Project, Workflow, Technical, Service và nghiệp vụ vận hành.
- MISA giữ vai trò hệ thống kế toán/CRM chuyên dụng theo phạm vi công ty đang sử dụng.
- Đồng bộ qua backend connector.
- Có mapping ID, sync log, retry, conflict handling và reconciliation.
- Xem chi tiết tại `19_TICH_HOP_API_MISA.md`.
