# 40. BỔ SUNG NGHIỆP VỤ CÒN THIẾU (V8)

> Các mục dưới đây có trong đặc tả phòng ban cũ (`Dac_ta_phong_ban_Tran_Le_Electricity.md`) hoặc bị nhắc trong v7 nhưng chưa có đặc tả. Mọi con số, ngưỡng, chính sách là **CẦN XÁC NHẬN** với phòng nghiệp vụ; tài liệu chỉ định nghĩa cấu trúc dữ liệu và quy tắc, không điền giá trị.
> Bảng chi tiết trường nằm ở `22_DATA_DICTIONARY.md` Phần 2.

---

## 1. Kênh phân phối (đại lý, nhà phân phối)

### 1.1 Phạm vi
Phục vụ mô hình bán thứ hai ở `05 §1`: đại lý/nhà phân phối/cửa hàng → đơn hàng → giao hàng → công nợ.

### 1.2 Đối tượng
- `customers.customer_class`: `END_CUSTOMER` | `DEALER` | `DISTRIBUTOR` | `PARTNER`.
- `dealer_profiles` (một-một với customer có class DEALER/DISTRIBUTOR): `tier`, `region`, `credit_limit`, `payment_terms_days`, `status`, `agreement_contract_id`, `valid_from/valid_to`.
- `price_lists` + `price_list_items`: bảng giá theo cấp đại lý, có hiệu lực theo ngày, theo sản phẩm, có mốc số lượng.
- `discount_policies`: chính sách chiết khấu theo cấp đại lý, nhóm sản phẩm, doanh số kỳ. Điều kiện lưu dạng JSON, giá trị do kinh doanh cấu hình.
- `vendor_targets`: chỉ tiêu doanh số theo hãng/nhà cung cấp theo kỳ (phục vụ KPI "doanh số theo hãng").

### 1.3 Quy tắc
- **BR-DIST-001**: khi duyệt Sales Order của đại lý, hệ thống kiểm tra `credit_limit - công nợ chưa thu - đơn đã duyệt chưa giao` ≥ giá trị đơn. Không đạt → đơn sang trạng thái chờ duyệt ngoại lệ (policy `credit_exception`), không tự động từ chối.
- **BR-DIST-002**: giá đơn lấy từ `price_lists` có hiệu lực tại ngày tạo đơn; sửa giá tay phải có lý do và audit.
- **BR-DIST-003**: chiết khấu vượt `discount_policies` phải đi qua approval.
- **BR-DIST-004**: đại lý quá hạn công nợ theo cấu hình có thể bị chặn tạo đơn mới; chặn hay cảnh báo là cấu hình.

### 1.4 Màn hình và báo cáo
- Màn Dealer 360: thông tin, hợp đồng đại lý, bảng giá áp dụng, công nợ, đơn hàng, chỉ tiêu.
- Báo cáo: doanh số theo đại lý/cấp/vùng, công nợ theo đại lý, doanh số theo hãng so với `vendor_targets`.

### 1.5 CẦN XÁC NHẬN
Số cấp đại lý, điều kiện lên/xuống cấp, công thức chiết khấu, ai duyệt ngoại lệ hạn mức.

---

## 2. Giá vốn nhập khẩu (Landed Cost) và chứng nhận theo lô

### 2.1 Landed Cost
Giá vốn hàng nhập khẩu gồm giá mua cộng chi phí liên quan (thuế nhập khẩu, vận chuyển, bảo hiểm, phí khác).

- `landed_costs`: chi phí gắn với một `stock_documents` loại `RECEIPT` (hoặc một lô nhập): `cost_type`, `amount`, `currency`, `allocation_method`, `invoice_ref`, `status`.
- `landed_cost_allocations`: kết quả phân bổ xuống từng dòng nhập: `receipt_line_id`, `allocated_amount`.
- `allocation_method`: `BY_VALUE` | `BY_QTY` | `BY_WEIGHT` (cấu hình, kế toán chọn).

**Quy tắc**
- **BR-STOCK-006**: chi phí phát sinh sau khi nhập kho không sửa `unit_cost` của stock_move đã DONE; tạo **bút toán điều chỉnh giá vốn** (stock_move loại `COST_ADJUSTMENT` hoặc dòng điều chỉnh riêng) để giữ tính bất biến.
- **BR-STOCK-007**: tồn đã xuất trước thời điểm phân bổ không tính lại giá vốn quá khứ; chênh lệch ghi vào kỳ phát sinh (hoặc theo chính sách kế toán).
- Cần chốt **phương pháp tính giá vốn** (bình quân gia quyền hay FIFO) và cách xử lý chênh lệch, **do kế toán trưởng xác nhận**.

### 2.2 Chứng nhận theo lô (CO, CQ, bảo hành chính hãng)
- `lot_certificates`: `lot_id`, `cert_type` (`CO` | `CQ` | `MANUFACTURER_WARRANTY` | `OTHER`), `document_id`, `issued_at`, `expires_at`, `status`.
- Sản phẩm có cờ `requires_certificates`; nhập kho lô thiếu chứng nhận bắt buộc không được hoàn tất (hoặc đưa vào hàng chờ, theo cấu hình).
- Customer Asset có thể truy ngược về lô và chứng nhận khi xử lý bảo hành.

---

## 3. Theo dõi hạn: chứng nhận đối tác, giấy phép, hiệu chuẩn (Compliance Items)

### 3.1 Mục tiêu
Một cơ chế chung cho mọi thứ có ngày hết hạn và cần nhắc: chứng nhận nhà phân phối, giấy phép kinh doanh, hiệu chuẩn thiết bị đo kiểm (Fluke, HIOKI, PVA...), chứng chỉ kỹ thuật viên.

### 3.2 Đối tượng
`compliance_items`: `item_type` (`PARTNER_CERT` | `LICENSE` | `CALIBRATION` | `PERSONNEL_CERT` | `OTHER`), `name`, `owner_department_id`, `responsible_employee_id`, `issuer`, `reference_no`, `issued_at`, `expires_at`, `remind_days_before` (JSON, ví dụ nhiều mốc), `status` (`VALID` | `EXPIRING` | `EXPIRED` | `RENEWING`), `document_id`, `related_type/related_id` (thiết bị, đối tác...).

### 3.3 Quy tắc
- **BR-COMP-001**: tới mốc nhắc, gửi notification cho người phụ trách + trưởng phòng; quá hạn chuyển `EXPIRED` và thông báo thêm Marketing/Kinh doanh nếu `item_type = PARTNER_CERT` (tránh dùng sai logo/chứng nhận hết hạn).
- **BR-COMP-002**: thiết bị đo kiểm `EXPIRED` không được gán vào checklist bảo trì/nghiệm thu (cảnh báo hoặc chặn theo cấu hình).
- Trạng thái `EXPIRING`/`EXPIRED` **dẫn xuất từ `expires_at`**, job nền chỉ để gửi thông báo.

### 3.4 CẦN XÁC NHẬN
Phòng nào sở hữu từng loại (chứng nhận đối tác, giấy phép, hiệu chuẩn). Liên quan ADR-017.

---

## 4. Template tài liệu và xuất PDF

### 4.1 Vấn đề
Báo giá, hợp đồng, biên bản khảo sát/nghiệm thu/bàn giao là sản phẩm đầu ra cốt lõi của EPC. v7 để "xuất PDF/Word sau này". V8 đưa xuất PDF vào **Phase 5**.

### 4.2 Đối tượng
- `document_templates`: `code`, `doc_type` (`QUOTE` | `CONTRACT` | `ACCEPTANCE` | `HANDOVER` | `SURVEY_REPORT` | `OTHER`), `format` (`PDF` bắt buộc; `DOCX` tùy chọn sau), `body` hoặc `file_id`, `variables_schema` JSON, `version_no`, `status`, `owner_department_id`.
- `generated_documents`: `template_id`, `template_version`, `subject_type/subject_id`, `document_version_id`, `generated_by`, `generated_at`, `data_snapshot` (JSON dữ liệu đã dùng để render).

### 4.3 Quy tắc
- Render từ **snapshot dữ liệu tại thời điểm sinh**; sinh lại ra bản mới, bản cũ không bị ghi đè (đúng nguyên tắc document version).
- Biến thiếu hoặc sai kiểu → trả lỗi rõ cho người dùng, không sinh file hỏng.
- Quote/Contract đã APPROVED/SENT/SIGNED chỉ sinh từ phiên bản chính thức; bản nháp có watermark "NHÁP".
- Quyền sinh/tải theo quyền xem của record gốc.

### 4.4 Công nghệ
Không chốt trong tài liệu (HTML→PDF, thư viện PDF...). Chọn khi vào Phase 5 và ghi thành ADR mới.

---

## 5. Chi phí và biên lợi nhuận dự án

### 5.1 Mục tiêu
Cho Giám đốc/PM biết dự án lãi hay lỗ (file 18 nhắc "lợi nhuận/biên lợi nhuận").

### 5.2 Đối tượng
`project_cost_entries`: `project_id`, `cost_type` (`MATERIAL` | `SUBCONTRACT` | `LABOR` | `EQUIPMENT` | `OTHER`), `source_type/source_id`, `amount`, `currency`, `incurred_at`, `status` (`COMMITTED` | `ACTUAL`), `created_by`.

### 5.3 Nguồn dữ liệu
- `MATERIAL` thực tế: stock_moves xuất cho dự án × `unit_cost` (kể cả landed cost đã phân bổ).
- `MATERIAL/SUBCONTRACT` cam kết: dòng PO gắn dự án chưa nhận.
- `SUBCONTRACT`/`OTHER`: từ Payment Request/Payable gắn dự án.
- `LABOR`: **tùy chọn**, chỉ khi công ty quyết định theo dõi giờ công; chưa có timesheet trong v8.

### 5.4 Chỉ số
- **Project Gross Margin** = `(Giá trị hợp đồng trước VAT − Chi phí thực tế) / Giá trị hợp đồng trước VAT`.
- **Forecast Margin** = dùng `COMMITTED + ACTUAL` thay vì chỉ `ACTUAL`.
- **Cost Variance** so với ngân sách dự án (Budget).
- Định nghĩa đầy đủ ở `27_KPI_REPORT_DEFINITION.md`. Quyền xem margin giới hạn cho BGĐ và Trưởng phòng Dự án/Kế toán (permission riêng `project.read.margin`).

### 5.5 CẦN XÁC NHẬN
Chi phí chung có phân bổ vào dự án không; có theo dõi nhân công không; quy tắc ghi nhận khi hợp đồng có phụ lục.

---

## 6. Hợp đồng mua và bàn giao hồ sơ cho kế toán

- Hợp đồng mua dùng bảng `contracts` với `direction = INBOUND` (ADR-014); vòng đời giống hợp đồng bán, bước duyệt lấy từ policy theo `direction`.
- `contract_links`: liên kết hợp đồng bán với hợp đồng mua đối ứng (back-to-back). Khi một bên bị hủy/điều chỉnh, hiện cảnh báo cho bên kia.
- `contract_accounting_handoffs`: theo dõi việc chuyển hồ sơ gốc sang kế toán (ngày gửi, ngày nhận, người nhận, kế toán phụ trách, trạng thái, phản hồi). Thay cho các cột rời trong bảng hợp đồng hiện tại.

---

## 7. Rà soát pháp lý hợp đồng

- Workflow hợp đồng có bước tùy chọn "Rà soát pháp lý" giao cho vai trò `legal_reviewer` (ADR-017).
- Kết quả: `APPROVED` | `CHANGES_REQUESTED`, kèm comment và tài liệu đính kèm; lưu trong `approvals`.
- Khi chưa có người phụ trách, bước này **tắt** và ghi rõ trong cấu hình workflow; không tự gán cho Admin (Admin không duyệt nghiệp vụ).

---

## 8. Đối tác vừa là khách vừa là nhà cung cấp

Theo ADR-018: giữ `customers` và `suppliers`, liên kết bằng `partner_links`; cảnh báo trùng mã số thuế giữa hai bảng. Công nợ phải thu và phải trả vẫn tách; báo cáo đối trừ công nợ (nếu có) là yêu cầu riêng, chưa nằm trong v8.
