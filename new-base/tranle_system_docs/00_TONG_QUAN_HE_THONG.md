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

## 8. Lộ trình phát triển (thứ tự duy nhất)

Thứ tự chuẩn nằm ở `17_ROADMAP_CODE.md` và `38_TEST_PLAN_AND_QUALITY_GATES.md` (ADR-008). Tóm tắt:

0. Phase 0: quyết định nền (ADR), khảo sát schema hiện tại, kế hoạch migration, hạ tầng test
1. Phase 1: Core (Department, Position, Role, Permission, Data Scope, Audit)
2. Phase 2: Task/Epic + Dynamic Filter + Saved View + Dashboard Template
3. Phase 3: Workflow + Approval Engine (lõi dùng chung) + outbox/job worker
4. Phase 4: CRM Sales (Lead, Opportunity, Customer, kênh phân phối)
5. Phase 5: Technical Request + Survey + BOM + Quotation + Contract + Document Template
6. Phase 6: Project Management nâng cấp (kèm chi phí dự án)
7. Phase 7: Service / Warranty / Customer Asset
8. Phase 8: Purchasing + Inventory ledger (lot/serial, landed cost, CO/CQ)
9. Phase 9: Finance Operations
10. Phase 10: MISA Integration
11. Phase 11: Marketing + API key/Webhook + AI hỗ trợ (search, tóm tắt)
12. Phase 12: Admin/Settings hoàn thiện, hardening, go-live

Lý do Workflow đứng trước CRM và Quote: Quote, Contract, Payment Request đều cần Approval Engine; nếu làm sau sẽ phải hard-code duyệt rồi gỡ ra.

## 9. Tích hợp MISA

Tran Le Platform có Integration Hub riêng để kết nối MISA. Nguyên tắc:

- Tran Le quản lý CRM, Project, Workflow, Technical, Service và nghiệp vụ vận hành.
- MISA giữ vai trò hệ thống kế toán/CRM chuyên dụng theo phạm vi công ty đang sử dụng.
- Đồng bộ qua backend connector.
- Có mapping ID, sync log, retry, conflict handling và reconciliation.
- Xem chi tiết tại `19_TICH_HOP_API_MISA.md`.
