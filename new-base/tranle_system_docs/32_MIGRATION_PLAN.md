# MIGRATION PLAN TỪ HỆ THỐNG HIỆN TẠI (V8)

> Nguồn hiện trạng: `phan_tich.MD` trong repo `web-task-tranle-new` (cập nhật 07/10/2026). Các dữ kiện bên dưới gắn nhãn **[phan_tich.MD]** lấy nguyên từ tài liệu đó; mọi thứ khác là đề xuất. Mục nào ghi **CẦN KIỂM TRA** phải được xác nhận bằng truy vấn trên DB thật ở Phase 0, vì tài liệu không đủ để kết luận.

## 1. Hiện trạng đã biết **[phan_tich.MD]**

| Hạng mục | Giá trị |
|---|---|
| CSDL | MySQL 8, truy cập qua `mysql2`, adapter ở `backend/db_mysql.ts` |
| Số bảng | 27 bảng (liệt kê ở §4); đã có bảng `_migrations (version, name, appliedAt)` |
| Kiểu khóa | `id VARCHAR` |
| Tên cột | camelCase (`userId`, `createdBy`, `docSentDate`...) |
| Tiền | `DOUBLE` (contracts, projects, products, revenue_reports) |
| Xóa mềm | `isDeleted TINYINT` ở contracts, projects, revenue_reports, reports, documents |
| Phân quyền | 4 role (Admin 16 quyền, Director 7, Manager 9, Employee 4); 16 permission lưu JSON trong `roles.permissions` |
| Phòng ban | 7 phòng seed: Board, Product, Marketing, Sales, IT, HR, Finance; `users.department`, `tasks.department` là chuỗi |
| Tác vụ nền | 5 scheduler chạy trong tiến trình: fridayReminder, dailyTaskReminder, noteReminder, mailScheduler, revenueAutoSubmit |
| Backup | Admin export/import JSON theo bảng. **Export che cột password/token/secret** nên **không** dùng làm backup khôi phục |
| Kiểm thử | 15 suites / 102 test backend (Vitest + Supertest) tại thời điểm cập nhật |

Hai điểm cần lưu ý ngay:
1. **Backup phải dùng `mysqldump` hoặc snapshot volume**, không dùng export JSON của trang Admin (vì dữ liệu nhạy cảm đã bị che, khôi phục từ đó sẽ mất mật khẩu và token).
2. Khóa cũ là `VARCHAR`; ADR-001 chọn `BIGINT` cho bảng mới. Quy tắc chung ở §5.

## 2. Nguyên tắc

Không đập đi làm lại. Mỗi bảng/module được phân loại: **KEEP**, **EXTEND**, **RENAME**, **MIGRATE**, **SPLIT**, **DEPRECATE**, **REMOVE sau đối chiếu**.

Mô hình **expand → backfill → verify → switch → contract**:
1. Expand: thêm bảng/cột mới (nullable), không đụng dữ liệu cũ.
2. Backfill: sinh dữ liệu mới từ dữ liệu cũ bằng script có thể chạy lại (idempotent).
3. Verify: truy vấn đối soát, báo cáo ngoại lệ.
4. Switch: code đọc/ghi bằng cấu trúc mới; cấu trúc cũ chỉ đọc.
5. Contract: bỏ cấu trúc cũ **sau** giai đoạn ổn định, không trong cùng lần phát hành.

Dùng bảng `_migrations` hiện có để ghi version; mỗi migration có `up`, `down` (hoặc đường khôi phục từ backup), truy vấn kiểm tra và đếm bản ghi trước/sau.

## 3. Khảo sát bắt buộc ở Phase 0
- `mysqldump` đầy đủ và **khôi phục thử** lên staging, đối soát số bản ghi từng bảng.
- Lấy `SHOW CREATE TABLE` cho cả 27 bảng; lưu vào repo.
- Đếm bản ghi, tìm dữ liệu mồ côi (task không có user, hợp đồng trỏ project đã xóa...).
- Liệt kê giá trị thực tế của các cột trạng thái/loại: `tasks.status`, `contracts.status`, `contracts.contractType`, `projects.status/phase`, `reports.status`, `revenue_reports.status`.
- Kiểm tra `products`: có tên trùng nhau không (`SELECT name, COUNT(*) ... HAVING COUNT(*)>1`) để biết mỗi dòng là sản phẩm hay một đợt nhập.
- Kiểm tra `contracts.payments`, `products`, `attachments` có phải JSON hợp lệ không; thống kê dòng lỗi.
- Liệt kê giá trị `users.department`, `tasks.department` khác với 7 phòng seed.
- Danh sách route `/api` đang dùng, route frontend, test hiện có.

## 4. Đối chiếu từng bảng hiện tại **[bảng: phan_tich.MD]**

| Bảng hiện tại | Hành động | Mục tiêu v8 | Phase | Ghi chú |
|---|---|---|---|---|
| users | SPLIT/EXTEND | `users` (đăng nhập) + `employees` (hồ sơ nhân sự) | 1 | Tạo employee 1-1 từ user; `role`, `department` (chuỗi) chuyển sang quan hệ. Cột nhạy cảm (`cccd`, `dob`, `hometown`, `mailPassword`) cần quyền xem riêng |
| roles | EXTEND | `roles` + `permissions` + `role_permissions` | 1 | Giữ `roles.permissions` (JSON) chỉ đọc đến khi chuyển xong |
| departments | EXTEND | `departments` thêm `code`, `parent_id`, `path`, `manager_id` | 1 | Xem §7 |
| clients | MIGRATE | `customers` | 4 | Chỉ có `name`, `region`, `createdAt` (34 bản ghi VNPT seed); `tax_code` để NULL |
| tasks | EXTEND | `tasks` mở rộng | 2 | Thêm cột nullable; `status` đổi sang enum chuẩn (§6) |
| task_assignees, task_tags, task_subtasks, task_comments | KEEP (+ EXTEND comments) | giữ; `comments` đa thực thể thay dần | 2 | |
| contracts | EXTEND/SPLIT | `contracts` + `contract_payments` + `contract_accounting_handoffs` | 5 | Xem §8 |
| contract_links | KEEP | `contract_links` | 5 | Giữ liên kết hợp đồng đầu ra ↔ đầu vào |
| projects | EXTEND | `projects` nâng cấp | 6 | `department` chuỗi → `department_id` |
| project_milestones | EXTEND | `milestones` | 6 | |
| project_reports | KEEP | giữ | 6 | Báo cáo tiến độ dự án |
| products | SPLIT (CẦN KIỂM TRA) | `products` + `lots` + opening stock | 8 | Xem §9 |
| revenue_reports | EXTEND rồi thay | KPI Revenue (file 27) | 9 | ADR-019: giữ đến sau UAT |
| reports | KEEP/EXTEND | báo cáo tuần, gắn Approval Engine | 3 | |
| meetings, meeting_participants, signals | KEEP | không thay đổi | – | ADR-019 |
| notes | KEEP | không thay đổi | – | ADR-019 |
| notifications | EXTEND | thêm `event_key`, `entity_type/entity_id`, `channel` | 3 | |
| activity_logs | EXTEND | `audit_logs` (thêm before/after, request_id) | 1 | Không xóa lịch sử cũ |
| events | KEEP | lịch (ngày lễ, sự kiện) | – | Có thể nối `business_holidays` |
| scheduled_emails, mail_tracking, mail_quotas | KEEP | module Mail | – | Scheduler chuyển sang job runner (§11) |
| password_reset_requests, password_reset_tokens | KEEP | giữ nguyên bảo mật hiện có | – | |
| system_config | KEEP | giữ; cấu hình mới đi vào `lookups`/bảng riêng | 12 | |
| db_history | KEEP | | – | |
| documents | EXTEND | `documents` + `document_versions` + `document_relations` | 2 | `linkedId` → `document_relations` |
| _migrations | KEEP | dùng ghi version migration v8 | 0 | |

Bảng mới hoàn toàn (không có nguồn migrate) được liệt kê ở `15_DATA_MODEL_DE_XUAT.md`.

## 5. Quy tắc khóa, tên cột, trạng thái, xóa mềm

**Khóa (ADR-001 áp dụng thực tế):**
- Bảng **cũ được mở rộng** (`users`, `tasks`, `projects`, `contracts`...) **giữ khóa `VARCHAR` hiện tại** cho đến khi được tái tạo. Không đổi kiểu khóa chính ở bảng đang chạy.
- Bảng **mới** dùng `BIGINT UNSIGNED` làm khóa chính. Khi bảng mới cần trỏ tới bảng cũ, dùng cột khóa ngoại cùng kiểu với bảng cũ (ví dụ `task_id VARCHAR(64)`) và đặt tên `<entity>_id`; khi bảng cũ được tái tạo sang `BIGINT`, dùng cột `legacy_id` để ánh xạ và chuyển khóa ngoại trong một migration riêng có đối soát.
- Mọi bảng migrate sang khóa mới có `legacy_id` và bảng ánh xạ `id_map(entity, legacy_id, new_id)` trong suốt giai đoạn chuyển đổi.
- Không xóa ID cũ khi integration, báo cáo hoặc URL còn tham chiếu.

**Tên cột (ADR-002):** bảng mới snake_case. Bảng cũ giữ camelCase đến khi tái tạo; **không đổi tên hàng loạt trong một lần**. Lớp truy cập dữ liệu ánh xạ tên khi cần.

**Tiền (ADR-007):** chuyển `DOUBLE` sang `DECIMAL`:

| Bảng | Cột | Kiểu mới đề xuất |
|---|---|---|
| contracts | preTaxValue, postTaxValue, paidAmount | DECIMAL(18,2) |
| contracts | vatRate | DECIMAL(5,2) (tỷ lệ, không phải tiền) |
| projects | budget, biddingPrice, winningPrice | DECIMAL(18,2) |
| products | defaultPrice, importPrice, salePrice | DECIMAL(18,4) |
| revenue_reports | totalPreTax, totalDelivered, totalCumulative | DECIMAL(18,2) |

Quy trình mỗi bảng: thêm cột mới → `UPDATE ... SET col_new = ROUND(col_old, 2 hoặc 4)` → so sánh: số dòng lệch lớn hơn ngưỡng (ví dụ 0.005) và tổng theo từng cột cũ/mới → báo cáo → đổi code sang cột mới → giữ cột cũ chỉ đọc → xóa sau giai đoạn ổn định.

**Trạng thái:** ánh xạ giá trị cũ sang enum UPPER_SNAKE. Ví dụ task: `Todo→TODO`, `In Progress→IN_PROGRESS`, `Review→REVIEW`, `Done→DONE` (README mô tả bốn cột này; **CẦN KIỂM TRA** giá trị thực tế trong DB). Giá trị lạ không ánh xạ được: để nguyên, đưa vào báo cáo ngoại lệ, không đoán.

**Xóa mềm (ADR-003):** `isDeleted=1` → `deleted_at = updatedAt` nếu có, ngược lại thời điểm migrate, kèm `deleted_by` NULL; ghi rõ trong báo cáo vì không biết thời điểm xóa thật.

## 6. Vai trò và quyền

Vai trò hiện tại → mô hình mới:

| Role cũ | Mô hình mới |
|---|---|
| Admin (16 quyền) | System role `ADMIN`; không gắn cấp quản lý; không tự có quyền duyệt nghiệp vụ (BR-SEC-002) |
| Director (7) | Position "Giám đốc" cấp 40 |
| Manager (9) | Position "Trưởng phòng" cấp 20 |
| Employee (4) | Position "Nhân viên" cấp 10 |
| (chưa có) | Cấp 30 Phó Giám đốc: tạo mới, chưa có ai gán |

Ánh xạ 16 permission hiện tại sang mã mới `resource.action[.scope]` (**đề xuất**, cần rà soát cùng ma trận ở file 21):

| Hiện tại | Mới |
|---|---|
| admin_panel | `settings.access` |
| manage_users | `user.manage` |
| view_all_tasks | `task.read.company` |
| manage_dept_tasks | `task.manage.department` |
| view_own_tasks | `task.read.own` |
| view_all_reports | `report.read.company` |
| approve_dept_reports | `report.approve.level1` (phạm vi phòng) |
| director_feedback | `report.feedback.executive` |
| create_report | `report.create` |
| manage_meetings | `meeting.manage` |
| join_meetings | `meeting.join` |
| create_revenue_report | `revenue_report.create` |
| approve_dept_revenue | `revenue_report.approve.level1` |
| approve_all_revenue | `revenue_report.approve.level3` |
| manage_warehouse | `inventory.manage` |
| view_dept_users | `employee.read.department` |

Các bước: tạo roles/permissions → seed → gán `user_roles` từ `users.role` → middleware mới chạy song song với cũ → so sánh quyết định cho cùng một request trên staging (**cả hai middleware phải cho kết quả giống nhau** trước khi bỏ cũ) → chạy toàn bộ test phân quyền và IDOR. Báo cáo user nào bị **mở rộng quyền** so với trước: phải bằng 0 trừ khi có phê duyệt.

## 7. Phòng ban

1. Chốt ADR-016 (IT, Product), ADR-011 (phòng con).
2. Seed 9 phòng chuẩn (file 36) cùng `code`.
3. Ánh xạ phòng cũ (**CẦN KIỂM TRA** bằng khảo sát §3, bảng dưới là đề xuất cho 7 phòng seed):

| Phòng cũ | Phòng mới | Trạng thái |
|---|---|---|
| Board | Ban Giám Đốc | rõ |
| Sales | Phòng Kinh Doanh | rõ |
| Marketing | Phòng Marketing | rõ |
| HR | Phòng Hành chính - Nhân sự | rõ |
| Finance | Phòng Kế Toán | rõ |
| Product | Phòng Kinh Doanh (tạm) | **chờ ADR-016** |
| IT | Phòng HCNS (tạm) | **chờ ADR-016** |

4. Phòng **Kho vận** và **Mua hàng**, **Dự án**, **Kỹ thuật - Bảo hành** chưa có phòng cũ tương ứng: tạo mới, nhân sự gán sau bởi HCNS.
5. Thêm `department_id` cho `users`/`employees`, `tasks`, `projects`, `reports`, `revenue_reports`; backfill theo ánh xạ; giá trị chuỗi không khớp đưa vào báo cáo ngoại lệ (không tự đoán).
6. Chuyển code sang `department_id`; chuỗi cũ chỉ đọc đến hết giai đoạn ổn định.

## 8. Hợp đồng (module lớn nhất, 52 KB route)

Hiện trạng **[phan_tich.MD]**: một bảng `contracts` chứa cả hợp đồng đầu vào và đầu ra, kèm `contractType`, `supplierName`, `products` (JSON), `attachments` (JSON), `payments`, chuỗi bàn giao hồ sơ kế toán (`docSentDate`, `docReceivedDate`, `docAccountantDate`, `docReceiver`, `docAccountantUserId`, `docAccountantStatus`), `approvalFeedback`, `projectId`, `isDeleted`; bảng `contract_links` liên kết hai chiều.

| Việc | Cách làm |
|---|---|
| Hướng hợp đồng | Thêm `direction` (OUTBOUND/INBOUND) từ `contractType`. **CẦN KIỂM TRA** các giá trị `contractType` thực tế; giá trị không phân loại được để NULL và vào báo cáo, không đoán |
| Đối tác | `clientName` → `customer_id` (so khớp tên với `clients`/`customers`); `supplierName` → `supplier_id`. Không khớp: đánh dấu `needs_review`, không tự tạo hàng loạt |
| `payments` (JSON/TEXT) | Phân tích thành `contract_payments`; dòng JSON lỗi vào báo cáo; không bịa mốc thanh toán thiếu |
| Bàn giao hồ sơ kế toán | Chuyển các cột `doc*` sang `contract_accounting_handoffs` (giữ cột cũ chỉ đọc) |
| `products`, `attachments` (JSON) | Giữ nguyên JSON cũ; tài liệu mới đi qua `document_relations` |
| `contract_links` | Giữ nguyên, thêm kiểm tra nhất quán với `direction` |
| `approvalFeedback` | Giữ làm lịch sử; duyệt mới đi qua Approval Engine (Phase 3) |
| Trạng thái, phiên bản | Ánh xạ trạng thái cũ sang vòng đời mới; hợp đồng đã có dữ liệu giữ nguyên, không tạo phiên bản giả |
| `projectId` | Giữ; các hợp đồng đã có dự án đặt `project_split_mode = MANUAL` (không tự tạo lại Project) |

Các hợp đồng đang chạy không được thay đổi kết quả hiển thị (giá trị, công nợ) sau migrate; đối soát tổng theo trạng thái.

## 9. Sản phẩm và kho

Hiện trạng: bảng `products` chứa `importQuantity`, `remainingQuantity`, `importPrice`, `salePrice`, `importCode`, `invoiceDate`, tức vừa là danh mục vừa mang thông tin nhập.

**CẦN KIỂM TRA:** nếu mỗi dòng là một đợt nhập (tên sản phẩm trùng nhau), phải tách master:
1. Tạo `products` master từ nhóm (tên, đơn vị, xuất xứ, danh mục).
2. Mỗi dòng cũ thành một `lot` (hoặc phiếu nhập tồn đầu) giữ `importCode`, `invoiceDate`.
3. Tồn đầu kỳ: tạo `stock_documents` loại `ADJUSTMENT` (nhãn "tồn đầu kỳ") ghi `remainingQuantity` vào kho/vị trí mặc định, `unit_cost = importPrice`.
4. Đối chiếu: tổng `remainingQuantity` cũ = tổng `stock_balances` mới theo sản phẩm.
5. Từ ngày chuyển đổi, mọi nhập/xuất đi qua sổ cái; cấm cập nhật số lượng trực tiếp.
6. Số lượng thập phân hay âm trong dữ liệu cũ: đưa vào báo cáo, không tự làm tròn.

## 10. Task, dự án, khách hàng
- **Task:** thêm cột nullable (`department_id`, `epic_id`, `custom_json`...), backfill phần xác định được; chưa xác định để NULL + báo cáo dọn dẹp. `task_assignees`, `task_tags`, `task_subtasks`, `task_comments` giữ nguyên.
- **Project:** `department` chuỗi → `department_id`; `managerId` giữ; `isDeleted` → `deleted_at`; trường đấu thầu (`biddingCode`, `biddingDate`, `procurementMethod`, `investor`, `biddingPrice`, `winningPrice`) giữ nguyên.
- **Customer:** map từ `clients` (chỉ `name`, `region`), chống trùng theo tên chuẩn hóa, giữ `legacy_id`; `tax_code`, liên hệ để trống đến khi Kinh doanh bổ sung.

## 11. Module chạy song song (ADR-019) và scheduler

| Module | Quyết định tạm | Ghi chú |
|---|---|---|
| Mail (IMAP/SMTP, scheduled_emails, quota) | KEEP | Không nằm trong v8; chuyển scheduler sang job runner |
| Meetings (WebRTC, signals) | KEEP | |
| Notes | KEEP | |
| AI assistant (Gemini) | KEEP | Phase 11 bổ sung nguyên tắc AI không sinh SQL, tôn trọng data scope |
| Báo cáo tuần (`reports`) | KEEP/EXTEND | Duyệt đi qua Approval Engine khi Phase 3 xong |
| Báo cáo doanh thu (`revenue_reports`) | EXTEND rồi thay | Thay bằng KPI Revenue (file 27) sau UAT; chốt ADR-019 |
| Admin DB backup/restore JSON | KEEP | Bổ sung backup thật (`mysqldump`) theo file 31; ghi rõ bản JSON che dữ liệu nhạy cảm |

**5 scheduler** (fridayReminder, dailyTaskReminder, noteReminder, mailScheduler, revenueAutoSubmit): chuyển sang job runner của ADR-006, mỗi job idempotent và chỉ một instance chạy. Test: chạy hai instance, mỗi lịch chỉ phát sinh một lần.

## 12. API và frontend
- Endpoint mới ở `/api/v1/...`; route cũ `/api/...` giữ cho đến khi frontend tương ứng được chuyển và có test (ADR-004).
- Không sửa hợp đồng response của route cũ trong lúc chuyển đổi.
- Frontend chuyển từng service (`taskService`, `contractService`...) sang route mới theo từng module; mỗi bước có regression.

## 13. Rollback
Mỗi migration có: bản sao lưu `mysqldump`; script `up`; `down` hoặc đường khôi phục; truy vấn kiểm tra; đếm bản ghi trước/sau; báo cáo ngoại lệ lưu cùng biên bản. Migration đổi kiểu hoặc xóa cột chỉ thực hiện sau giai đoạn chạy song song và có chữ ký người phụ trách dữ liệu.

## 14. Cutover
1. Staging từ bản sao production; chạy migration; đối soát.
2. Chạy bộ test hiện có + UAT-018.
3. Cửa sổ freeze nếu cần (đặc biệt với hợp đồng và kho).
4. Backup thật (`mysqldump`) và kiểm tra khôi phục được.
5. Migration production, smoke test, đối soát tổng tiền/số lượng.
6. Giám sát; giữ cột/bảng cũ chỉ đọc đến hết giai đoạn ổn định.

## 15. Không được làm
- Drop cột có dữ liệu ngay.
- Đổi kiểu dữ liệu khi chưa có backup khôi phục được.
- Dùng export JSON của trang Admin làm backup khôi phục.
- Tạo dữ liệu giả để lấp trường bắt buộc; thứ chưa biết để NULL và đưa vào báo cáo.
- Xóa ID cũ khi integration/báo cáo còn tham chiếu.
- Mở rộng quyền người dùng ngoài ý muốn khi đổi mô hình phân quyền.
- Đổi tên hàng loạt cột/khóa trong một lần phát hành.
