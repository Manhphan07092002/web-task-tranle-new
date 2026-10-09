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
- **BR-COUNT-001**: kiểm kê sinh adjustment move.

## Finance
- **BR-FIN-001**: Money dùng DECIMAL.
- **BR-FIN-002**: Payment Request PAID không xóa.
- **BR-FIN-003**: Reject phải ghi approver/time/comment theo policy.
- **BR-FIN-004**: phân biệt expected receivable và official receivable MISA.
- **BR-ADV-001**: có thể chặn advance mới khi còn khoản cũ quá hạn.

## Workflow / Security
- **BR-WF-001**: run ghim workflow version.
- **BR-WF-002**: published definition tạo version mới khi sửa.
- **BR-WF-003**: external action retry/idempotent.
- **BR-SEC-001**: frontend permission không thay backend authorization.
- **BR-SEC-002**: Admin không tự động có quyền business approval.
- **BR-AUDIT-001**: audit quan trọng không được user thường sửa/xóa.
