# EDGE CASES & FAILURE SCENARIOS

## 1. Sales
### Lead convert đồng thời
Hai user convert cùng lúc:
- transaction/lock/unique guard;
- một request thành công;
- request còn lại trả conflict.

### Customer duplicate
MST trùng, tên khác:
- cảnh báo;
- chọn Customer có sẵn;
- override chỉ theo quyền/policy.

### Quote đang duyệt nhưng Sales muốn sửa
Không sửa version PENDING_APPROVAL.
Phải recall/cancel approval hoặc tạo revision.

### Quote hết hiệu lực
Policy phải chốt:
- không cho accept;
- hoặc manager override + audit.

## 2. Contract / Project
### Contract terminate khi Project đang chạy
Không xóa Project.
Tạo alert/workflow chuyển ON_HOLD/CLOSE.

### Amendment
Không overwrite Contract signed.
Tạo amendment/version.

### Project còn milestone bắt buộc
Không cho COMPLETED.

## 3. Inventory
### Hai user reserve cùng stock
Transaction + concurrency control.

### Partial receipt
PO 100, nhận 60:
- PO PARTIAL_RECEIPT;
- remaining 40 open.

### Partial transfer
Nguồn gửi 10, đích nhận 9:
- discrepancy record;
- review trước DONE.

### Serial duplicate
Unique constraint phù hợp.

### Serial đã xuất
Không xuất lần hai nếu current location không hợp lệ.

### Stock count đang chạy
Chốt policy:
- freeze location;
- hoặc snapshot + reconcile movement phát sinh.

## 4. Service
### Ticket closed rồi lỗi tái diễn
Reopen, lưu reopen count/history.

### SLA WAITING_CUSTOMER
Tùy SLA policy có pause clock.

### Asset hết bảo hành
Ticket vẫn tạo; classification OUT_OF_WARRANTY; có thể phát sinh Quote/Payment.

## 5. Finance / MISA
### Payment Request đã duyệt nhưng sửa tiền
Phải re-approval.

### Payment sync trùng
Dùng remoteId/idempotency/mapping.

### MISA unavailable
- queue;
- retry;
- sync_failed;
- không rollback nghiệp vụ nội bộ nếu thiết kế eventual consistency.

### Amount mismatch
Đưa reconciliation mismatch; không ghi đè im lặng.

## 6. Workflow
### Approver nghỉ việc
Resolve theo role/scope hoặc delegation/fallback.

### Workflow version mới
Run cũ giữ version cũ.

### HTTP timeout
Retry giới hạn + idempotency.

### Notification fail
Không làm fail transaction nghiệp vụ nếu notification không critical.

## 7. Documents
### File trùng tên
Không overwrite version cũ.

### User mất quyền
Download endpoint kiểm tra permission mỗi lần.

## 8. General
- soft-deleted relation;
- timezone/day boundary;
- currency khác nhau;
- duplicate webhook;
- double-click submit;
- network retry;
- stale frontend state.
