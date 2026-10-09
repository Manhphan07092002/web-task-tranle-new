# BUSINESS RULES TOÀN HỆ THỐNG

## Sales
- **BR-SALES-001**: Lead chỉ convert một lần.
- **BR-SALES-002**: Opportunity LOST bắt buộc lost reason.
- **BR-SALES-003**: Opportunity WON phải có Customer.
- **BR-SALES-004**: đổi owner phải audit + notification.
- **BR-SALES-005**: không tạo Customer trùng MST nếu đã tồn tại, trừ exception được duyệt.

## Quote / Contract
- **BR-QUOTE-001**: Quote APPROVED/SENT không sửa trực tiếp; tạo revision.
- **BR-QUOTE-002**: discount/value vượt policy phải approval.
- **BR-QUOTE-003**: thay đổi giá/discount/tax phải audit.
- **BR-CONTRACT-001**: Contract SIGNED không sửa trực tiếp giá trị/hạng mục.
- **BR-CONTRACT-002**: Contract SIGNED phát event tạo Project theo cấu hình.
- **BR-CONTRACT-003**: payment milestone phải khớp tổng contract theo policy.

## Project
- **BR-PROJECT-001**: COMPLETED cần milestone bắt buộc hoàn thành.
- **BR-PROJECT-002**: đổi planned end sau IN_PROGRESS phải audit.
- **BR-PROJECT-003**: Material Request nguồn dự án phải có projectId.
- **BR-PROJECT-004**: Acceptance APPROVED có thể kích hoạt payment milestone.

## Technical / Service
- **BR-TECH-001**: Technical Request COMPLETED phải đủ đầu ra bắt buộc.
- **BR-BOM-001**: BOM APPROVED không sửa trực tiếp.
- **BR-TICKET-001**: Ticket CLOSED bắt buộc resolution.
- **BR-TICKET-002**: Waiting status phải có reason.
- **BR-WARRANTY-001**: warranty eligibility theo Asset/Contract/period.
- **BR-WARRANTY-002**: replacement serial phải liên kết stock movement.

## Purchasing
- **BR-PR-001**: PR dự án phải có projectId.
- **BR-PR-002**: PR vượt ngưỡng phải approval.
- **BR-PO-001**: PO chỉ RECEIVED từ Inventory receipt.
- **BR-PO-002**: thay đổi giá/qty sau APPROVED phải re-approval/amendment.

## Inventory
- **BR-STOCK-001**: Stock Move DONE bất biến.
- **BR-STOCK-002**: sửa sai bằng reversal/adjustment.
- **BR-STOCK-003**: serial không ở hai location cùng lúc.
- **BR-STOCK-004**: serial đã xuất không được xuất lần hai nếu chưa return.
- **BR-STOCK-005**: reserve/issue cần transaction + concurrency control.
- **BR-STOCK-006**: chi phí nhập khẩu phát sinh sau khi nhập không sửa `unit_cost` đã DONE; tạo điều chỉnh giá vốn (`move_type = COST_ADJUSTMENT`).
- **BR-STOCK-007**: tồn đã xuất trước thời điểm phân bổ không tính lại giá vốn quá khứ; chênh lệch ghi vào kỳ phát sinh hoặc theo chính sách kế toán (cần kế toán trưởng xác nhận).
- **BR-STOCK-008**: sản phẩm `requires_certificates` không hoàn tất phiếu nhập khi thiếu CO/CQ bắt buộc (hoặc vào hàng chờ theo cấu hình).
- **BR-COUNT-001**: kiểm kê sinh adjustment move.

## Finance
- **BR-FIN-001**: Money dùng DECIMAL (chứng từ DECIMAL(18,2); đơn giá/giá vốn DECIMAL(18,4)); làm tròn nửa lên ở mức dòng rồi cộng (ADR-007).
- **BR-FIN-002**: Payment Request PAID không xóa.
- **BR-FIN-003**: Reject phải ghi approver/time/comment theo policy.
- **BR-FIN-004**: phân biệt expected receivable và official receivable MISA.
- **BR-ADV-001**: có thể chặn advance mới khi còn khoản cũ quá hạn.
- **BR-FIN-005**: "quá hạn" của công nợ là giá trị dẫn xuất từ `due_date` và `outstanding_amount`, không lưu thành trạng thái (ADR-015).
- **BR-PAY-001**: chứng từ cần duyệt chỉ có trạng thái chờ `PENDING_APPROVAL`; chuỗi duyệt ở `approvals` theo `approval_policies` (ADR-009).

## Workflow / Security
- **BR-WF-001**: run ghim workflow version.
- **BR-WF-002**: published definition tạo version mới khi sửa.
- **BR-WF-003**: external action retry/idempotent.
- **BR-WF-004**: sự kiện nghiệp vụ ghi vào `outbox_events` trong cùng transaction với dữ liệu; consumer idempotent theo `event_id` (ADR-006).
- **BR-SEC-001**: frontend permission không thay backend authorization.
- **BR-SEC-002**: Admin không tự động có quyền business approval.
- **BR-AUDIT-001**: audit quan trọng không được user thường sửa/xóa.

## Bổ sung V8: Lead, phân phối, tuân thủ, chi phí dự án
- **BR-SALES-006**: convert Lead chỉ khi `qualification_status = QUALIFIED`; DISQUALIFIED đưa `status` sang CLOSED kèm lý do (ADR-012).
- **BR-SALES-007**: Marketing và Sales dùng chung một bảng Lead; chuyển giao bằng `stage_owner` và `handoff_at`, giữ nguyên campaign/source.
- **BR-DIST-001**: duyệt Sales Order của đại lý kiểm tra hạn mức công nợ; vượt thì đi duyệt ngoại lệ, không tự từ chối.
- **BR-DIST-002**: giá đơn lấy từ bảng giá có hiệu lực tại ngày tạo đơn; sửa giá tay phải có lý do và audit.
- **BR-DIST-003**: chiết khấu vượt chính sách phải qua approval.
- **BR-DIST-004**: chặn hay cảnh báo đại lý quá hạn công nợ là cấu hình.
- **BR-COMP-001**: compliance item tới mốc nhắc gửi thông báo cho người phụ trách và trưởng phòng; quá hạn thông báo thêm bộ phận liên quan.
- **BR-COMP-002**: thiết bị đo kiểm quá hạn hiệu chuẩn không được gán vào checklist bảo trì/nghiệm thu (cảnh báo hoặc chặn theo cấu hình).
- **BR-CONTRACT-004**: hợp đồng có đúng một trong `customer_id`/`supplier_id` theo `direction` (ADR-014).
- **BR-CONTRACT-005**: tạo Project khi ký phải idempotent theo `(contract_id, site_key)` và tuân `project_split_mode`.
- **BR-PROJ-005**: biên lợi nhuận dự án chỉ hiển thị cho vai trò có `project.read.margin`.
- **BR-DOC-001**: tài liệu sinh từ template lưu snapshot dữ liệu; sinh lại tạo version mới, không ghi đè.
- **BR-ORG-001**: `positions.management_level` là nguồn duy nhất của cấp quản lý; `departments.manager_id` phải là nhân viên level >= 20 của phòng đó (ADR-010).
- **BR-SCOPE-001**: scope `DEPARTMENT` gồm cả phòng con theo `parent_id` trừ khi phòng bật cờ loại trừ (ADR-011).
