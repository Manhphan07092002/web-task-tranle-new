# NON-FUNCTIONAL REQUIREMENTS

## 1. Performance
Mục tiêu ban đầu:
- List API p95 < 800 ms.
- Detail API p95 < 500 ms.
- Dashboard lần đầu < 3 giây trong điều kiện thông thường.
- List/search phải phân trang.

Benchmark lại trên hạ tầng thật.

## 2. Availability
- Health check.
- Container restart policy.
- Monitoring API/database/queue/integration.

## 3. Backup
- DB backup hàng ngày.
- Retention tối thiểu 30 ngày hoặc theo chính sách.
- Test restore định kỳ.
- Backup file/document.

## 4. Security
- Password hashing.
- RBAC + Data Scope.
- Input validation.
- Parameterized query/ORM.
- Rate limit.
- CSRF nếu cookie auth.
- XSS protection.
- Secret encryption.
- Token expiration/revocation.
- Audit config change.
- Không log password/API secret/access token.

## 5. Audit
Quote, Contract, Project, PO, Stock, Payment, Approval phải có audit trail.

## 6. Logging
Mỗi request có `requestId`.

Log:
- timestamp
- requestId
- route
- status
- duration
- userId nếu phù hợp
- error code

## 7. Observability
Theo dõi:
- API 5xx
- DB connectivity
- workflow failed
- sync failed
- queue backlog
- email failure

## 8. File Storage (ADR-005)
Đề xuất: volume cục bộ sau interface `StorageProvider` (có thể thay bằng S3/MinIO). Bắt buộc:
- kiểm tra MIME theo nội dung, không tin phần mở rộng;
- giới hạn kích thước theo loại tệp;
- tên lưu bằng UUID, không dùng tên gốc;
- kiểm tra quyền ở mỗi lần tải;
- thời gian lưu và quét virus: cần chốt (ADR-005).

## 9. Client
- Chrome/Edge desktop.
- Responsive mobile/tablet cho task/approval/ticket.

## 10. Timezone
- DB UTC.
- UI/business calendar dùng timezone cấu hình, mặc định Việt Nam nếu phù hợp.

## 11. Money (ADR-007)
- DECIMAL: chứng từ (18,2); đơn giá/giá vốn/tỷ giá (18,4); số lượng (18,3).
- Không FLOAT/DOUBLE.
- Làm tròn nửa lên ở mức dòng rồi cộng.
- Multi-currency chỉ làm khi có yêu cầu và exchange-rate policy.

## 11A. Tác vụ nền, outbox, scheduler (ADR-006)
- Sự kiện nghiệp vụ ghi vào `outbox_events` trong cùng transaction với dữ liệu.
- `jobs` là hàng đợi có `run_at`, `attempts`, `locked_until`; worker lấy việc bằng `SELECT ... FOR UPDATE SKIP LOCKED` (MySQL 8) để nhiều instance không xử lý trùng.
- Scheduler (SLA timer, nhắc việc, tạo bảo trì định kỳ, sync MISA) chạy bằng một instance giữ khóa `GET_LOCK`; các scheduler hiện có phải được chuyển vào cơ chế này để không chạy trùng khi có nhiều instance.
- Mọi consumer idempotent theo `event_id`; job lỗi quá `max_attempts` chuyển FAILED và cảnh báo (`26_NOTIFICATION_MATRIX.md`).
- Giám sát: độ trễ outbox (processed_at - created_at), số job FAILED, tuổi job PENDING cũ nhất.
- Nâng lên Redis/BullMQ khi khối lượng đòi hỏi; thiết kế outbox giữ nguyên.

## 12. Deployment / Recovery
- migration versioned;
- rollback deployment;
- backup trước migration rủi ro;
- restore plan.
