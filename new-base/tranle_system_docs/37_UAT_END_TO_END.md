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
3. Hệ thống chuyển sang `PENDING_APPROVAL` và sinh chuỗi duyệt từ `approval_policies`.
4. Manager approve (level1), Finance review.
5. Nếu vượt threshold → thêm cấp Executive.
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

# UAT-013: Đại lý → Đơn → Hạn mức → Giao → Công nợ

## Actors
- Sales phân phối, Trưởng phòng Kinh doanh, Kế toán, Thủ kho

## Steps
1. Tạo đại lý có `dealer_profile` (cấp, hạn mức, bảng giá).
2. Tạo Sales Order trong hạn mức, giá lấy từ bảng giá hiệu lực.
3. Tạo đơn thứ hai vượt hạn mức.
4. Duyệt ngoại lệ (policy `credit_exception`).
5. Giữ hàng, xuất kho, giao.
6. Kiểm tra công nợ phải thu và tuổi nợ.

## Expected
- Đơn vượt hạn mức không tự từ chối mà vào duyệt ngoại lệ (BR-DIST-001).
- Sửa giá tay có lý do và audit; chiết khấu vượt policy qua approval.
- Công nợ đúng; "quá hạn" tính từ ngày đến hạn, không phải trạng thái lưu.

---

# UAT-014: Tạm ứng và quyết toán

## Actors
- Employee, Manager, Finance

## Steps
1. Tạo đề nghị tạm ứng, submit, duyệt, chi.
2. Employee tạo quyết toán kèm chứng từ.
3. Chi tiêu ít hơn tạm ứng: hoàn quỹ. Nhiều hơn: chi bổ sung.
4. Thử tạo tạm ứng mới khi còn khoản cũ quá hạn.

## Expected
- Trạng thái đi đúng `23_STATE_MACHINE.md`.
- BR-ADV-001 áp dụng theo cấu hình.
- Số dư tạm ứng theo nhân viên đúng.

---

# UAT-015: Kiểm kê kho

## Steps
1. Tạo phiếu kiểm kê một vị trí, đếm, nhập số.
2. Có chênh lệch: duyệt.
3. Hệ thống sinh stock move điều chỉnh.

## Expected
- Không sửa `qty_on_hand` trực tiếp; chênh lệch ghi bằng stock move.
- `stock_balances` khớp tổng `stock_moves`.
- Vòng đời `DRAFT → COUNTING → REVIEW → APPROVED → ADJUSTED → CLOSED`.

---

# UAT-016: Attribution Marketing → Hợp đồng

## Steps
1. Marketing tạo Campaign, nhận Lead, qualify, chuyển giao Sales.
2. Sales convert, tạo Opportunity, báo giá, ký hợp đồng.
3. Xem báo cáo attributed revenue.

## Expected
- Lead giữ `campaign_id` và `lead_source` suốt chuỗi; chỉ một bản ghi Lead (ADR-012).
- Doanh thu gán về đúng campaign; convert chỉ khi QUALIFIED.

---

# UAT-017: Phụ lục và chấm dứt hợp đồng

## Steps
1. Hợp đồng ACTIVE có Project đang chạy, tạo phụ lục đổi giá trị.
2. Phụ lục duyệt theo policy; lịch thanh toán và công nợ cập nhật.
3. Một hợp đồng khác bị chấm dứt giữa chừng.

## Expected
- Phụ lục không ghi đè dữ liệu cũ; có audit và phiên bản.
- Hợp đồng mua đối ứng (nếu có `contract_links`) hiện cảnh báo.
- Project/receivable chưa phát sinh bị xử lý đúng quy tắc đã chốt.

---

# UAT-018: Diễn tập migration

## Steps
1. Sao lưu DB, khôi phục lên môi trường staging.
2. Chạy migration theo `32_MIGRATION_PLAN.md` (expand → backfill → verify).
3. Đối soát số bản ghi, tổng tiền (DOUBLE → DECIMAL), quan hệ khóa ngoại, phân quyền.
4. Chạy lại bộ regression của hệ thống cũ.
5. Thử rollback.

## Expected
- Tổng tiền theo từng bảng khớp trong ngưỡng làm tròn đã duyệt; không mất bản ghi.
- Quyền cũ ánh xạ đúng quyền mới; không user nào mở rộng quyền ngoài ý muốn.
- Rollback khôi phục được trạng thái trước migrate.

---

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
