# API STANDARD TRAN LE PLATFORM

## 1. Base
Khuyến nghị:
`/api/v1`

Nếu repo hiện có convention khác, cần kế hoạch migrate; không trộn nhiều style lâu dài.

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
- 409 Conflict
- 422 Business rule nếu team chọn convention này
- 429 Rate limit
- 500 Unexpected

Phải chốt 400 hay 422 cho business validation và dùng nhất quán.

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
