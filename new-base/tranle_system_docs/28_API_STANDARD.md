# API STANDARD TRAN LE PLATFORM

## 1. Base
Quy ước (ADR-004):
- Mọi endpoint mới nằm dưới `/api/v1/<domain>/<resource>`, ví dụ `/api/v1/sales/leads`, `/api/v1/technical/requests`.
- Các ví dụ trong file này viết rút gọn (bỏ `<domain>`) để dễ đọc; khi code phải dùng đủ đường dẫn theo từng file phòng ban.
- Route cũ `/api/...` của hệ thống hiện tại giữ nguyên đến khi module tương ứng được thay thế, sau đó đánh dấu deprecated và xóa theo kế hoạch ở file 32. Không dùng hai kiểu cho cùng một module.
- JSON dùng camelCase (ADR-002); backend ánh xạ với cột snake_case.

## 2. Success Response
Single:
```json
{
  "data": {},
  "meta": {"requestId": "..."}
}
```

List:
```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 128,
    "totalPages": 7
  },
  "meta": {"requestId": "..."}
}
```

## 3. Error Response
```json
{
  "error": {
    "code": "QUOTE_INVALID_TRANSITION",
    "message": "Không thể chuyển trạng thái báo giá",
    "details": {}
  },
  "meta": {"requestId": "..."}
}
```

## 4. HTTP Status
- 200 OK
- 201 Created
- 204 No Content
- 400 Validation/Input
- 401 Unauthenticated
- 403 Forbidden
- 404 Not Found
- 409 Conflict (chuyển trạng thái sai, convert lần hai, sai phiên bản/optimistic lock)
- 422 Vi phạm business rule (ví dụ vượt hạn mức công nợ)
- 429 Rate limit
- 500 Unexpected

Quy ước (ADR-004): `400` chỉ cho lỗi định dạng/schema; lỗi quy tắc nghiệp vụ trả `422` kèm `error.code` ổn định (ví dụ `CREDIT_LIMIT_EXCEEDED`); lỗi trạng thái trả `409`.

## 5. Pagination
`?page=1&pageSize=20`
Có max page size.

## 6. Sorting
`?sort=createdAt:desc,name:asc`
Field sort phải whitelist.

## 7. Filter
Filter phức tạp dùng JSON:
```json
{
  "op": "AND",
  "conditions": [
    {"field": "status", "cmp": "=", "value": "OPEN"},
    {"field": "total", "cmp": ">", "value": 50000000}
  ]
}
```

Backend:
- whitelist field;
- whitelist comparator;
- parameterized query;
- inject permission/data scope.

## 8. Action Endpoint
Transition quan trọng không PATCH status trực tiếp.

Ví dụ:
- `POST /api/v1/sales/leads/:id/convert`
- `POST /api/v1/quotes/:id/submit`
- `POST /api/v1/quotes/:id/approve`
- `POST /api/v1/tickets/:id/close`

## 9. Idempotency
API tạo/hành động nhạy cảm (convert lead, ghi sổ, tạo payment, callback) nhận header `Idempotency-Key`; cùng khóa trong thời hạn cấu hình trả lại kết quả cũ, không thực hiện lần hai. Consumer của outbox idempotent theo `event_id` (ADR-006).

Bắt buộc xem xét cho:
- integration callback;
- MISA sync;
- workflow external action;
- event-driven create.

## 10. Concurrency
Dùng:
- optimistic version/updatedAt;
- transaction;
- row lock tùy nghiệp vụ.

Đặc biệt cho Stock, Lead Convert, Quote approval.

## 11. Audit
Backend lấy user từ auth context.
Không tin `createdBy` từ client.

## 12. Validation
- frontend validate để UX tốt;
- backend validate bắt buộc;
- schema rõ;
- business rule ở service/domain.

## 13. Security
- auth;
- authorization;
- rate limit;
- CSRF nếu cookie;
- CORS;
- không trả secret;
- requestId/error log;
- mask sensitive data.
