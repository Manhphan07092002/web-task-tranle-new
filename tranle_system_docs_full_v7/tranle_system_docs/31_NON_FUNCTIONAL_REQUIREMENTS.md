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

## 8. File Storage
Cần chốt:
- local/S3/MinIO
- max size
- MIME
- access control
- retention
- antivirus nếu cần

## 9. Client
- Chrome/Edge desktop.
- Responsive mobile/tablet cho task/approval/ticket.

## 10. Timezone
- DB UTC.
- UI/business calendar dùng timezone cấu hình, mặc định Việt Nam nếu phù hợp.

## 11. Money
- DECIMAL.
- Không FLOAT.
- Multi-currency chỉ làm khi có yêu cầu và exchange-rate policy.

## 12. Deployment / Recovery
- migration versioned;
- rollback deployment;
- backup trước migration rủi ro;
- restore plan.
