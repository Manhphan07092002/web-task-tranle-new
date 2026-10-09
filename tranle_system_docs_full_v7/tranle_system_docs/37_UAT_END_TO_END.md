# UAT END-TO-END – KỊCH BẢN NGHIỆM THU TOÀN HỆ THỐNG

## 1. Nguyên tắc UAT

Mỗi UAT phải có:
- Preconditions
- Actors
- Data
- Steps
- Expected Result
- Audit/Notification cần kiểm tra
- Permission cần kiểm tra

---

# UAT-001: Lead → Contract → Project

## Actor
- Sales Employee
- Sales Manager
- Technical Manager
- Engineer
- Project Manager

## Preconditions
- User/role/department đã cấu hình.
- Customer chưa tồn tại.
- Product master có dữ liệu.

## Steps
1. Sales tạo Lead.
2. Sales qualify.
3. Convert Lead thành Customer + Opportunity.
4. Sales tạo Technical Request.
5. Technical Manager assign Engineer.
6. Engineer tạo Survey.
7. Engineer tạo Solution/BOM.
8. Technical Manager review/complete.
9. Sales tạo Quote.
10. Sales submit approval.
11. Sales Manager approve.
12. Sales gửi khách và đánh ACCEPTED.
13. Sales tạo Contract.
14. Contract đi qua approval.
15. Mark SIGNED.
16. Hệ thống tự tạo Project.

## Expected
- Không duplicate Customer.
- Technical Request link Opportunity.
- Quote có version.
- Approval có history.
- Contract signed tạo Project đúng dữ liệu.
- Notification đúng người.
- Audit đầy đủ.

---

# UAT-002: Project Material → Purchase → Receipt → Issue

## Actors
- PM
- Warehouse
- Buyer
- Purchasing Manager

## Steps
1. PM tạo Material Request từ BOM.
2. Hệ thống check stock.
3. Một số dòng đủ hàng → reserve.
4. Một số dòng thiếu → tạo PR.
5. Buyer tạo RFQ.
6. Nhập 2 Supplier Quotes.
7. Chọn NCC.
8. Tạo PO.
9. Manager approve PO.
10. Warehouse nhận partial 60/100.
11. PO thành PARTIAL_RECEIPT.
12. Nhận tiếp 40.
13. PO thành RECEIVED.
14. Warehouse issue hàng cho Project.

## Expected
- Stock không âm do race condition.
- Receipt tạo stock moves.
- Partial receipt chính xác.
- Issue link Project.
- Serial không duplicate.
- PO status cập nhật từ Receipt.

---

# UAT-003: Acceptance → Receivable → Payment

## Actors
- PM
- Technical
- Finance
- Sales
- Executive nếu cần

## Steps
1. PM submit Acceptance.
2. Internal review.
3. Customer accepted.
4. Payment milestone được activate.
5. Finance thấy Receivable.
6. MISA sync/pull invoice nếu áp dụng.
7. Payment từ MISA được sync.
8. Receivable cập nhật paid/outstanding.

## Expected
- Không sinh trùng Receivable.
- Expected và Official amount phân biệt rõ.
- Payment idempotent.
- Sales thấy trạng thái công nợ.

---

# UAT-004: Warranty Ticket + Replacement

## Actors
- Sales/CSKH
- Technical Manager
- Engineer
- Warehouse
- Purchasing nếu thiếu hàng

## Steps
1. Tạo Ticket cho Customer Asset.
2. Hệ thống kiểm tra warranty.
3. Manager assign Engineer.
4. Engineer diagnose.
5. Engineer request replacement.
6. Warehouse kiểm tra serial thay thế.
7. Nếu có hàng → issue.
8. Nếu thiếu → tạo PR.
9. Engineer thay thiết bị.
10. Cập nhật old/new serial.
11. Resolve/Close Ticket.

## Expected
- Asset warranty xác định đúng.
- Replacement stock move tồn tại.
- Old/new serial lưu lịch sử.
- Ticket close có resolution.
- SLA được tính đúng.

---

# UAT-005: Payment Request Approval

## Actors
- Employee
- Department Manager
- Finance
- Deputy Director/Director theo ngưỡng

## Steps
1. Employee tạo Payment Request.
2. Submit.
3. Manager approve.
4. Finance review.
5. Nếu vượt threshold → Executive approval.
6. Finance mark PAID.

## Expected
- Không cho Employee tự approve.
- Ngưỡng approval đúng config.
- Sửa amount sau approval buộc re-approval.
- PAID không được xóa.

---

# UAT-006: Data Scope

## Steps
1. Sales A tạo Lead.
2. Sales B thử mở Lead A.
3. Sales Manager mở Lead A.
4. Manager phòng khác thử mở.
5. PGĐ phụ trách Sales mở.
6. PGĐ không phụ trách Sales thử mở.
7. Director mở.
8. Admin thử approve Quote.

## Expected
- Sales B bị từ chối nếu không related.
- Manager Sales đọc được.
- Manager phòng khác không được.
- PGĐ đúng scope đọc được.
- PGĐ ngoài scope không được.
- Director đọc được.
- Admin không được business approval nếu không có role.

---

# UAT-007: Quote Revision

## Steps
1. Sales tạo Quote v1.
2. Manager approve.
3. Sales gửi khách.
4. Khách yêu cầu sửa.
5. Sales tạo revision v2.
6. v1 giữ nguyên.
7. v2 submit/approve/send.

## Expected
- v1 không bị overwrite.
- Audit/Document vẫn truy được.
- Opportunity hiển thị cả hai version.

---

# UAT-008: Inventory Concurrency

## Steps
1. Tồn Product A = 10.
2. User 1 reserve 8.
3. User 2 cùng lúc reserve 5.

## Expected
- Tổng reserved không vượt 10.
- Một giao dịch thành công toàn phần/partial theo policy.
- Giao dịch kia nhận lỗi/thiếu tồn.
- Không âm kho.

---

# UAT-009: Workflow Version

## Steps
1. Workflow Quote v1 publish.
2. Quote A khởi chạy v1.
3. Admin publish v2.
4. Quote A tiếp tục.
5. Quote B khởi chạy sau v2.

## Expected
- Quote A dùng v1.
- Quote B dùng v2.
- Không sửa definition của run đang chạy.

---

# UAT-010: MISA Failure + Retry

## Preconditions
- MISA connector configured.

## Steps
1. Trigger sync Customer/Order.
2. Giả lập API timeout/5xx.
3. Hệ thống ghi sync failed/retry.
4. Retry thành công.
5. Trigger cùng event lại.

## Expected
- Không tạo remote duplicate.
- Mapping remoteId được lưu.
- Log không chứa secret.
- Có audit/manual retry.
- Finance/Admin thấy lỗi.

---

# UAT-011: Offboarding

## Steps
1. HR tạo offboarding.
2. Hệ thống tạo checklist.
3. Chuyển task cần bàn giao.
4. Thu hồi asset.
5. Disable user đúng ngày hiệu lực.

## Expected
- User không login sau disable.
- Audit quyền được thu hồi.
- Dữ liệu cũ không mất.
- Owner record cần chuyển có cảnh báo.

---

# UAT-012: Dashboard Role

## Steps
1. Login Sales Employee.
2. Login Sales Manager.
3. Login Deputy Director.
4. Login Director.
5. Login Admin.

## Expected
- Employee: dashboard cá nhân + Sales.
- Manager: dashboard phòng.
- PGĐ: dashboard managed departments.
- GĐ: company dashboard.
- Admin: system dashboard, không mặc định business dashboard/approval.

# 13. UAT Exit Criteria

UAT chỉ PASS khi:
- 100% Critical UAT scenario pass;
- không còn Critical/High defect;
- dữ liệu cuối luồng đúng;
- notification/audit đúng;
- quyền đúng;
- các phòng nghiệp vụ liên quan xác nhận.

Nếu một flow fail:
`Fix → Regression → chạy lại UAT liên quan`.
