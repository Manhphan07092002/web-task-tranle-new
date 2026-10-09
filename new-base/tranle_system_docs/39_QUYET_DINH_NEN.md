# 39. QUYẾT ĐỊNH NỀN (ADR) – BẢN V8

> Mục đích: gom mọi quyết định kỹ thuật/nghiệp vụ nền đang để "mở" hoặc mâu thuẫn trong v7, chốt phương án đề xuất và nêu hậu quả. Dev chỉ được code các phần phụ thuộc quyết định khi ADR tương ứng ở trạng thái **ĐÃ DUYỆT**.

## 0. Cách đọc

| Trạng thái | Ý nghĩa |
|---|---|
| **ĐỀ XUẤT** | Phương án mặc định do nhóm phân tích đưa ra. Dùng được ngay để thiết kế; cần Tech Lead/PO duyệt trước khi code |
| **MỞ** | Cần quyết định kinh doanh/tổ chức mà tài liệu không thể tự chốt. Có phương án tạm để không chặn thiết kế |
| **ĐÃ DUYỆT** | Dành cho người duyệt đánh dấu sau khi xác nhận (chưa có ADR nào ở trạng thái này) |

Nguyên tắc chung: không tự bịa số liệu nghiệp vụ (ngưỡng duyệt, công thức KPI, hạn mức, field MISA). Những thứ đó vẫn do phòng nghiệp vụ xác nhận.

## 1. Bảng tổng hợp

| ADR | Nội dung | Trạng thái | Chặn code phase |
|---|---|---|---|
| 001 | Chiến lược khóa chính (ID) | ĐỀ XUẤT | Phase 1 |
| 002 | Quy ước đặt tên cột, enum, JSON | ĐỀ XUẤT | Phase 1 |
| 003 | Xóa mềm | ĐỀ XUẤT | Phase 1 |
| 004 | Phiên bản API và mã lỗi | ĐỀ XUẤT | Phase 1 |
| 005 | Lưu trữ file | ĐỀ XUẤT | Phase 2 |
| 006 | Tác vụ nền, outbox, scheduler | ĐỀ XUẤT | Phase 3 |
| 007 | Độ chính xác tiền và số lượng | ĐỀ XUẤT | Phase 1 |
| 008 | Thứ tự phase chuẩn | ĐỀ XUẤT | Phase 0 |
| 009 | Trạng thái duyệt và số cấp duyệt | ĐỀ XUẤT | Phase 3 |
| 010 | Nguồn sự thật của cấp quản lý | ĐỀ XUẤT | Phase 1 |
| 011 | Phạm vi DEPARTMENT có gồm phòng con | ĐỀ XUẤT | Phase 1 |
| 012 | Lead: một bảng, hai trục trạng thái | ĐỀ XUẤT | Phase 4 |
| 013 | Chứng từ kho thống nhất | ĐỀ XUẤT | Phase 8 |
| 014 | Hợp đồng bán và hợp đồng mua | ĐỀ XUẤT | Phase 5 |
| 015 | Quá hạn là giá trị dẫn xuất | ĐỀ XUẤT | Phase 9 |
| 016 | Chỗ đứng của bộ phận IT/Product | **MỞ** | Phase 1 |
| 017 | Ai rà soát pháp lý hợp đồng | **MỞ** | Phase 5 |
| 018 | Khách hàng và Nhà cung cấp cùng một pháp nhân | ĐỀ XUẤT | Phase 4 |
| 019 | Giữ hay thay thế các module đang chạy ngoài phạm vi v7 | **MỞ** | Phase 0 |

---

## ADR-001 – Chiến lược khóa chính

- **Bối cảnh:** v7 để mở "BIGINT hoặc UUID". Hệ thống hiện tại dùng `VARCHAR` (ví dụ `dept-board`).
- **Đề xuất:** `id BIGINT UNSIGNED AUTO_INCREMENT` làm khóa nội bộ; mỗi bảng nghiệp vụ có thêm `code` (mã hiển thị, UNIQUE) sinh theo quy tắc riêng; bảng đã migrate có cột `legacy_id VARCHAR(64) NULL UNIQUE` để lưu ID cũ.
- **Hậu quả:** API chỉ lộ `id` số + `code`; kiểm tra quyền phải ở backend (không dựa vào việc ID khó đoán). Không dùng `code` làm khóa ngoại.
- **Áp dụng thực tế:** bảng **cũ** đang chạy (`users`, `tasks`, `projects`, `contracts`...) **giữ khóa `VARCHAR`** cho đến khi được tái tạo; bảng mới dùng `BIGINT`, và khi trỏ tới bảng cũ thì dùng cột khóa ngoại cùng kiểu với bảng cũ. Việc đổi khóa của bảng cũ là migration riêng có bảng ánh xạ `id_map` (file 32 §5). Không đổi kiểu khóa chính của bảng đang chạy trong cùng lần phát hành với thay đổi nghiệp vụ.
- **Phương án thay thế:** UUID v7 nếu sau này cần sinh ID ở client/offline hoặc gộp dữ liệu nhiều hệ thống.

## ADR-002 – Quy ước đặt tên

- **Bối cảnh:** hệ thống hiện tại có cột camelCase (`userId`, `createdBy`, `docSentDate`...) và trạng thái dạng chữ hoa thường lẫn lộn (`Todo`, `In Progress`). Bộ tài liệu v7 dùng snake_case và `UPPER_SNAKE`.
- **Đề xuất:**
  - Bảng và cột **mới**: `snake_case`, số nhiều cho bảng (`quotes`).
  - Enum/trạng thái: `UPPER_SNAKE_CASE` (ví dụ `IN_PROGRESS`).
  - JSON của API: `camelCase`; backend có lớp ánh xạ snake_case ↔ camelCase.
  - Bảng cũ giữ nguyên tên cột cho đến khi được viết lại ở phase tương ứng (mô hình expand/contract ở file 32). Không đổi tên hàng loạt trong một lần.
- **Ánh xạ trạng thái cũ:** `Todo→TODO`, `In Progress→IN_PROGRESS`, `Review→REVIEW`, `Done→DONE` (danh sách đầy đủ ở file 32 §5).

## ADR-003 – Xóa mềm

- **Đề xuất:** dùng `deleted_at DATETIME NULL` + `deleted_by` cho dữ liệu danh mục và nghiệp vụ chưa phê duyệt. **Không** xóa mềm sổ cái và chứng từ đã duyệt/đã ghi sổ: stock_moves DONE, payments, approvals, audit_logs, document_versions. Các thực thể này chỉ hủy hoặc đảo bút toán.
- **Cột cũ `isDeleted TINYINT`:** giữ song song đến hết giai đoạn migrate, sau đó chuyển thành `deleted_at` (xem file 32 §5).

## ADR-004 – Phiên bản API và mã lỗi

- **Đề xuất:** mọi endpoint mới nằm dưới `/api/v1`. Route cũ `/api/...` giữ nguyên đến khi module tương ứng được thay thế, rồi đánh dấu deprecated; không dùng hai kiểu cho cùng một module.
- **Mã lỗi:**
  - `400` sai định dạng/thiếu trường (lỗi schema);
  - `401` chưa đăng nhập; `403` không đủ quyền hoặc ngoài data scope;
  - `404` không tồn tại (hoặc không được phép thấy);
  - `409` xung đột trạng thái hoặc phiên bản (chuyển trạng thái sai, convert lần hai, optimistic lock);
  - `422` vi phạm business rule (ví dụ đơn vượt hạn mức công nợ);
  - `429` rate limit.
- Chi tiết ở file 28.

## ADR-005 – Lưu trữ file

- **Đề xuất:** giai đoạn đầu dùng volume cục bộ phía sau một interface `StorageProvider` (get, put, delete, signedUrl). Bắt buộc: kiểm tra MIME theo nội dung, giới hạn kích thước theo loại, tên file lưu bằng UUID (không dùng tên gốc), kiểm tra quyền ở **mỗi lần tải**. Có thể thay bằng S3/MinIO sau mà không đổi nghiệp vụ.
- **Cần chốt thêm:** dung lượng tối đa, thời gian lưu, có quét virus không.

## ADR-006 – Tác vụ nền, outbox, scheduler

- **Bối cảnh:** SLA timer, retry workflow, đồng bộ MISA, nhắc việc, tạo bảo trì định kỳ đều cần tác vụ nền. Tài liệu v7 chỉ nhắc "queue" ở mức khái niệm. Hệ thống hiện có 5 scheduler chạy trong tiến trình ứng dụng.
- **Đề xuất (không thêm hạ tầng mới ở giai đoạn đầu):**
  - Bảng `outbox_events`: ghi sự kiện **trong cùng transaction** với nghiệp vụ (ví dụ `contract.signed`).
  - Bảng `jobs`: hàng đợi tác vụ có `run_at`, `attempts`, `max_attempts`, `locked_by`, `locked_until`, `status`.
  - Một tiến trình worker lấy việc bằng `SELECT ... FOR UPDATE SKIP LOCKED` (MySQL 8 hỗ trợ) để nhiều instance không xử lý trùng; scheduler dùng `GET_LOCK` để chỉ một instance chạy cron.
  - Mọi consumer phải idempotent theo khóa `event_id`.
- **Phương án thay thế:** Redis + BullMQ (hoặc tương đương) nếu khối lượng tăng; thiết kế `outbox_events` vẫn dùng được.
- **Quy ước:** ràng buộc nhất quán dữ liệu (ví dụ tạo Project khi contract SIGNED) chạy bằng handler đăng ký sẵn trong code; phản ứng có thể tùy biến (gửi thông báo, tạo task mẫu, đồng bộ) chạy qua Workflow. Handler và workflow đều nhận sự kiện từ outbox.

## ADR-007 – Độ chính xác tiền và số lượng

- **Đề xuất:**
  - Số tiền chứng từ: `DECIMAL(18,2)`.
  - Đơn giá, giá vốn, tỷ giá: `DECIMAL(18,4)` (tránh sai số tích lũy khi nhân với số lượng).
  - Số lượng: `DECIMAL(18,3)`.
  - Tiền tệ mặc định VND; cột `currency` bắt buộc ở chứng từ có tiền.
  - Quy tắc làm tròn: nửa lên (half up), làm tròn ở mức dòng rồi cộng; ghi vào BR.
- **Migration:** hệ thống hiện lưu tiền bằng `DOUBLE`. Chuyển đổi và đối soát tổng theo từng bảng, xem file 32 §5.

## ADR-008 – Thứ tự phase chuẩn

- **Bối cảnh:** v7 có ba thứ tự khác nhau (00, 17, 38) và Quote approval nằm trước Workflow engine.
- **Đề xuất:** thứ tự duy nhất ở file 17 (Phase 0 đến 12). Điểm đổi chính: **Workflow/Approval lõi lên Phase 3**, trước CRM và Quote/Contract. Các file 00, 17, 38 và README đã được đồng bộ.

## ADR-009 – Trạng thái duyệt và số cấp duyệt

- **Đề xuất:**
  - Mọi chứng từ cần duyệt chỉ có **một** trạng thái chờ: `PENDING_APPROVAL`. Chuỗi người duyệt nằm ở `approvals` do `approval_policies` sinh ra, không nằm trong enum trạng thái.
  - Ba cấp: `level1` = Trưởng phòng, `level2` = Phó Giám đốc phụ trách, `level3` = Giám đốc. Policy quyết định chứng từ cần đi đến cấp nào và theo thứ tự nào (ví dụ Payment Request có thể đi Trưởng phòng → Kế toán → Giám đốc).
  - Tên quyền: `resource.action.scope` hoặc `resource.approve.levelN`, dùng dấu chấm ở mọi tài liệu.
- Ngưỡng tiền/chiết khấu vẫn do công ty chốt.

## ADR-010 – Nguồn sự thật của cấp quản lý

- **Đề xuất:** `positions.management_level` là nguồn duy nhất. `employees` không lưu cột này (suy ra qua `position_id`). Trưởng phòng chính thức của phòng được ghi ở `departments.manager_id` và phải là nhân viên có level ≥ 20 thuộc phòng đó (kiểm tra khi lưu).
- **Hậu quả:** đổi chức vụ tự đổi cấp; không có hai nơi lệch nhau.

## ADR-011 – Phạm vi DEPARTMENT

- **Bối cảnh:** `departments.parent_id` cho phép cây phòng, nhưng v7 không nói quyền xem của trưởng phòng có xuống phòng con không. Đặc tả phòng ban cũ có nhóm con (ví dụ KD-DA, KD-DD, KTBH-TK).
- **Đề xuất:** `DEPARTMENT` = phòng của user **và mọi phòng con** (đi theo `parent_id`). Dùng path vật chất hóa (`path` hoặc closure table) để truy vấn nhanh. Có cờ cấu hình ở từng phòng nếu cần loại trừ.
- Cần BGĐ xác nhận chính sách này vì nó ảnh hưởng quyền xem dữ liệu.

## ADR-012 – Lead: một bảng, hai trục

- **Đề xuất:**
  - Chỉ một bảng `leads`. Marketing và Sales dùng chung; `stage_owner` (`MARKETING` | `SALES`) cho biết ai đang giữ, `handoff_at` ghi thời điểm chuyển. Giữ `campaign_id`, `lead_source` để đo attribution.
  - `status` (vòng đời): `NEW → CONTACTED → CONVERTED`, hoặc `CLOSED`.
  - `qualification_status` (kết quả đánh giá): `UNQUALIFIED` (mặc định) → `QUALIFIED` | `DISQUALIFIED`.
  - Convert chỉ khi `qualification_status = QUALIFIED`. Đánh dấu `DISQUALIFIED` đưa `status` sang `CLOSED` kèm lý do.
- **Hậu quả:** không còn hai trường cùng mang giá trị QUALIFIED/DISQUALIFIED.

## ADR-013 – Chứng từ kho thống nhất

- **Đề xuất:** một bảng `stock_documents` có `doc_type` (`RECEIPT`, `ISSUE`, `TRANSFER`, `RETURN`, `ADJUSTMENT`) và bảng dòng `stock_document_lines`. Mỗi `doc_type` có state machine riêng (file 23). `stock_counts` là bảng riêng vì có quy trình đếm/duyệt chênh lệch. `stock_moves` tham chiếu `document_id`.
- **Hậu quả:** receipt/issue/transfer dùng chung khung, khác nhau ở trạng thái và quy tắc.

## ADR-014 – Hợp đồng bán và hợp đồng mua

- **Bối cảnh:** hệ thống hiện lưu hợp đồng đầu vào và đầu ra trong cùng bảng và có `contract_links` liên kết hai chiều. v7 chỉ mô hình hóa hợp đồng bán; "Hợp đồng mua" mới có tên ở menu Mua hàng.
- **Đề xuất:** `contracts.direction` (`OUTBOUND` = bán, `INBOUND` = mua). Đúng một trong hai cột `customer_id` hoặc `supplier_id` có giá trị. Giữ `contract_links` (back-to-back). Hai hướng dùng chung vòng đời, bước duyệt cấu hình theo `direction`.
- Các trường bàn giao hồ sơ cho kế toán chuyển sang bảng `contract_accounting_handoffs` (file 22).

## ADR-015 – Quá hạn là giá trị dẫn xuất

- **Đề xuất:** chỉ lưu trạng thái thanh toán (`UPCOMING`, `DUE`, `PARTIAL`, `PAID`). "Quá hạn" tính bằng `due_date < hôm nay AND outstanding > 0`. Báo cáo tuổi nợ dùng chính điều kiện này.
- Cùng nguyên tắc áp dụng cho "task quá hạn" và "ticket quá SLA".

## ADR-016 – Chỗ đứng của IT và Product – **MỞ**

- **Bối cảnh:** 9 phòng chuẩn (file 36) không có IT. Hệ thống hiện có phòng IT và Product.
- **Lựa chọn:** (A) thêm phòng thứ 10 "Công nghệ thông tin"; (B) gắn nhân sự IT vào Phòng HCNS; (C) coi IT là vai trò Admin, không có phòng riêng.
- **Phương án tạm:** (B) để giữ đúng 9 phòng đã duyệt. Product (quản lý danh mục sản phẩm) gắn tạm vào Phòng Kinh doanh, **cần xác nhận**.
- **Cần:** Ban Giám đốc quyết định.

## ADR-017 – Ai rà soát pháp lý hợp đồng – **MỞ**

- **Bối cảnh:** đặc tả phòng ban cũ có chức năng pháp lý trong Tài chính Tổng hợp; bộ 9 phòng không có đơn vị pháp chế.
- **Phương án tạm:** một vai trò hệ thống `legal_reviewer` có thể gán cho người của Phòng HCNS hoặc Kế toán; workflow hợp đồng có bước "Rà soát pháp lý" bật/tắt theo cấu hình. Không bắt buộc cho đến khi BGĐ chỉ định người phụ trách.

## ADR-018 – Khách hàng và Nhà cung cấp cùng pháp nhân

- **Đề xuất:** giữ hai bảng `customers` và `suppliers`; thêm `partner_links (customer_id, supplier_id, link_type)` và kiểm tra trùng mã số thuế giữa hai bảng khi tạo mới (cảnh báo, không chặn). Không nhân bản thông tin chung; hiển thị liên kết trên cả hai màn.

## ADR-019 – Module đang chạy ngoài phạm vi v7 – **MỞ**

- **Bối cảnh:** hệ thống hiện có Mail IMAP/SMTP, Meetings (WebRTC), Notes, Báo cáo tuần, Báo cáo doanh thu duyệt hai cấp, Trợ lý AI, sao lưu/khôi phục JSON. Bộ v7 chưa nói số phận từng module.
- **Phương án tạm (chờ xác nhận), chi tiết ở file 32 §11:** Mail, Meetings, Notes, Trợ lý AI = **KEEP**; Báo cáo tuần = KEEP, gắn vào Task/Approval khi Phase 3 xong; Báo cáo doanh thu = **EXTEND** rồi thay bằng KPI Revenue ba loại ở file 27 sau UAT; sao lưu JSON = KEEP, bổ sung backup theo NFR.
