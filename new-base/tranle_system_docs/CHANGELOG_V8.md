# CHANGELOG V7 → V8

> Phạm vi: sửa mâu thuẫn giữa các file, bổ sung khoảng trống đã phát hiện khi rà soát bộ v7, viết lại kế hoạch migration dựa trên hiện trạng trong `phan_tich.MD`. **Không có nội dung nào trong v8 được xác nhận bởi phòng nghiệp vụ**; mọi giá trị nghiệp vụ vẫn ghi CẦN XÁC NHẬN.

## 1. Mâu thuẫn đã sửa

| # | Vấn đề ở v7 | Cách sửa | File đã sửa |
|---|---|---|---|
| 1 | Ba thứ tự phase khác nhau; Quote approval đứng trước Workflow engine | Một thứ tự duy nhất Phase 0–12; Workflow/Approval lên Phase 3; thêm Phase 0 (ADR-008) | 00, 17, 38, README |
| 2 | Lead có `status` và `qualification_status` cùng chứa QUALIFIED/DISQUALIFIED | Hai trục độc lập; convert chỉ khi QUALIFIED (ADR-012) | 05, 12, 22, 23, 25, 36, 38 |
| 3 | Payment Request hard-code bước duyệt vào enum trạng thái | Một trạng thái `PENDING_APPROVAL`, chuỗi duyệt ở `approvals` (ADR-009) | 10, 22, 23, 25, 37 |
| 4 | Receivable `UPCOMING→DUE→PARTIAL→PAID→OVERDUE` | Quá hạn là giá trị dẫn xuất (ADR-015) | 10, 22, 23, 25 |
| 5 | Project có WAITING ở 07 nhưng không có ở 23 | Thêm WAITING vào state machine | 07, 23 |
| 6 | Số cấp duyệt (2 vs 3) và tên quyền (`level1` vs `level_1`) lệch | L1/L2/L3 cố định, tên quyền dùng dấu chấm | 05, 18, 21 |
| 7 | API: có nơi `/api/v1`, có nơi `/api`; chưa chốt 400/422 | `/api/v1/<domain>/<resource>`; 400 schema, 409 trạng thái, 422 business rule (ADR-004) | 05, 06, 19, 28 |
| 8 | `managementLevel` ở cả Position và Employee | Chỉ ở Position (ADR-010) | 11, 21, 22 |
| 9 | Kho: bốn state machine nhưng một bảng `stock_transfers` | `stock_documents` + `doc_type` (ADR-013) | 09, 15, 22, 23, 33, 36 |
| 10 | Data dictionary chỉ có ~31 trong 73 bảng | 127 bảng được định nghĩa; 15 sinh lại làm chỉ mục từ 22 | 15, 22 |
| 11 | Thực thể được dùng nhưng không có trong data model (milestone, issue, risk, material request, acceptance, handover, site diary, campaign, leave, onboarding, asset assignment, activity, approval_policies, SLA, calendar...) | Thêm định nghĩa đầy đủ ở Phần 2 | 22 |
| 12 | Marketing Lead và Sales Lead là hai object | Một bảng `leads` có `stage_owner` (ADR-012) | 12, 15, 22 |
| 13 | State machine thiếu nhiều thực thể | Thêm bảng bổ sung (Sales Order, Survey, BOM, Handover, Leave...) | 23 |

## 2. Khoảng trống nghiệp vụ đã bổ sung (xem `40_BO_SUNG_NGHIEP_VU.md`)
- Kênh phân phối: dealer profile, bảng giá theo cấp, chính sách chiết khấu, hạn mức công nợ, chỉ tiêu theo hãng.
- Giá vốn nhập khẩu (landed cost) và chứng nhận CO/CQ theo lô.
- Compliance items: chứng nhận đối tác, giấy phép, hiệu chuẩn thiết bị đo.
- Document Template và xuất PDF (đưa vào Phase 5 thay vì "sau này").
- Chi phí và biên lợi nhuận dự án.
- Hợp đồng mua (INBOUND), `contract_links`, phụ lục, bàn giao hồ sơ kế toán.
- Rà soát pháp lý hợp đồng (vai trò `legal_reviewer`, chờ ADR-017).
- Liên kết Customer/Supplier cùng pháp nhân (`partner_links`).

## 3. Hạ tầng và quy ước nền (xem `39_QUYET_DINH_NEN.md`)
- 19 ADR: ID, đặt tên, xóa mềm, API, file, tác vụ nền (outbox + job worker), độ chính xác tiền/số lượng, thứ tự phase, trạng thái duyệt, cấp quản lý, phạm vi phòng con, Lead, chứng từ kho, hợp đồng bán/mua, quá hạn, IT/Product, pháp lý, partner, module đang chạy.
- NFR bổ sung mục outbox/job (31).
- Sequence mới: outbox, Approval Engine (34).

## 4. Migration (viết lại `32_MIGRATION_PLAN.md`)
- Dựa trên hiện trạng đã đọc trong `phan_tich.MD`: 27 bảng, khóa VARCHAR, cột camelCase, tiền DOUBLE, 16 permission/4 role, 7 phòng seed, 5 scheduler.
- Bảng đối chiếu từng bảng hiện tại → đích → phase.
- Quy tắc khóa (bảng cũ giữ VARCHAR), tên cột, chuyển DOUBLE → DECIMAL, ánh xạ trạng thái, xóa mềm.
- Ánh xạ 4 role và 16 permission sang mô hình mới (đề xuất).
- Hợp đồng đầu vào/đầu ra, bàn giao hồ sơ kế toán, sản phẩm/kho, module chạy song song, scheduler.
- **Phát hiện quan trọng:** export JSON của trang Admin che cột password/token/secret nên **không** dùng làm backup khôi phục; phải dùng `mysqldump` hoặc snapshot.

## 5. Kiểm thử
- File 38: thêm Phase 0; đổi thứ tự Phase 3/4/5; bổ sung bài test cho outbox/job, approval chuẩn hóa, Lead hai trục, kênh phân phối, document template, hợp đồng bán/mua, tách Project, chi phí dự án, landed cost/CO-CQ, API key/webhook, AI, compliance.
- File 37: thêm UAT-013 đến UAT-018 (đại lý, tạm ứng/quyết toán, kiểm kê, attribution, phụ lục/chấm dứt hợp đồng, diễn tập migration).

## 6. Việc còn lại cần người quyết (không thể tự chốt)

| Hạng mục | Ai quyết |
|---|---|
| ADR-016: IT và Product thuộc phòng nào | Ban Giám đốc |
| ADR-017: ai rà soát pháp lý hợp đồng | Ban Giám đốc |
| ADR-019: số phận Mail, Meetings, Notes, Báo cáo tuần, Báo cáo doanh thu, backup JSON | Chủ sản phẩm / Tech Lead |
| ADR-001 đến 015, 018: duyệt các phương án đề xuất | Tech Lead / Chủ sản phẩm |
| ADR-011: trưởng phòng cha có thấy dữ liệu phòng con không | Ban Giám đốc |
| Ngưỡng duyệt báo giá/hợp đồng/chi tiêu, chiết khấu, hạn mức đại lý | Phòng Kinh doanh, Kế toán, BGĐ |
| Phương pháp giá vốn, cách phân bổ landed cost, kỳ khóa sổ | Kế toán trưởng |
| Công thức KPI mặc định (Lead conversion, margin, chi phí chung) | Trưởng phòng liên quan |
| Danh mục cấp đại lý, hãng, mốc nhắc compliance | Kinh doanh, Marketing, phòng sở hữu |
| Bảng field MISA (file 30) và endpoint | Cần tài liệu API MISA của gói đang dùng |
| Giá trị thực tế của các cột trạng thái/loại trong DB hiện tại | Khảo sát Phase 0 |

## 7. Giới hạn của bản v8
- Chưa đọc mã nguồn; nhận định về hệ thống hiện tại dựa vào `phan_tich.MD` và README.
- Các thiết kế trường dữ liệu mới là đề xuất; chưa có DDL và chưa có estimate thời gian/nhân lực.
- Chưa có công nghệ cụ thể cho xuất PDF (chốt ở Phase 5).
- Các trạng thái đánh dấu "đề xuất" ở file 23 cần phòng liên quan xác nhận.
