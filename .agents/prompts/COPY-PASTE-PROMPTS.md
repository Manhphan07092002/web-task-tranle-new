# TranLe Tasks — Antigravity Prompt Library

These prompts are designed to paste directly into Antigravity Agent.

## 1. New feature

/tranle-plan

Tôi muốn thêm chức năng:
[ MÔ TẢ ]

Yêu cầu:
- Đọc code hiện tại trước.
- Xác định frontend, backend, database, API, RBAC và realtime có liên quan.
- Tìm implementation tương tự đang có.
- Không code trong bước này.
- Đưa ra plan với file cụ thể và test cần chạy.

Sau khi tôi duyệt plan, dùng /tranle-feature.

## 2. Implement after plan

/tranle-feature

Thực hiện plan vừa duyệt.

Không refactor ngoài scope.
Không thay đổi API hiện tại nếu không cần.
Ưu tiên tái sử dụng code hiện có.
Sau khi code xong phải chạy verification và báo cáo chính xác.

## 3. Bug

/tranle-debug

Bug:
[ MÔ TẢ BUG ]

Lỗi:
[ LOG/SCREENSHOT/ERROR ]

Hãy reproduce và trace root cause.
Không sửa theo phỏng đoán.
Tạo regression test nếu phù hợp.
Sau đó sửa tối thiểu và verify.

## 4. API

/tranle-api

Tôi muốn:
[ API CHANGE ]

Hãy kiểm tra route, middleware auth/validation, frontend consumer, RBAC, database và tests trước.
Giữ response contract nếu không có yêu cầu breaking change.

## 5. RBAC

/tranle-rbac

Tính năng:
[ MÔ TẢ ]

Hãy xác định:
- ai được phép;
- permission/role nào;
- ownership;
- department scope;
- admin override;
- API enforcement;
- frontend UX.

Tạo test cho allowed và denied cases.

## 6. Database

/tranle-db

Tôi muốn thay đổi database:
[ MÔ TẢ ]

Kiểm tra schema MySQL và migration versioned hiện tại (`backend/db_mysql.ts`).
Không reset database.
Đề xuất migration/backfill trước khi sửa.
Kiểm tra data preservation, index, FK, uniqueness và nullability.

## 7. Realtime

/tranle-realtime

Tôi muốn realtime:
[ MÔ TẢ ]

Trace server emission → event payload → client listener → cleanup → React Query/state.
Kiểm tra duplicate listener và stale state.
Verify end-to-end flow.

## 8. Mail

/tranle-mail

Tôi muốn thay đổi mail:
[ MÔ TẢ ]

Kiểm tra mail route, mailer, IMAP/parser và frontend.
Không đưa credential ra frontend.
Kiểm tra HTML, attachment, authorization và provider failure.

## 9. AI

/tranle-ai

Tôi muốn thay đổi AI:
[ MÔ TẢ ]

Xác định provider boundary.
Không để API key trong frontend.
Treat AI output as untrusted.
Mock provider trong test nếu có thể.
Kiểm tra timeout, error và rate-limit.

## 10. Security audit

/tranle-security

Audit thay đổi hiện tại.
Tập trung:
auth, RBAC, IDOR, upload, XSS, injection, secrets, mail, AI, admin actions, rate limits.

Chỉ báo cáo vấn đề có bằng chứng.
Không in secret value.

## 11. Code review

/tranle-review

Review diff hiện tại như senior engineer.
Ưu tiên:
1. correctness
2. security
3. data integrity
4. API compatibility
5. realtime/cache
6. tests
7. maintainability

Báo cáo theo severity.

## 12. Verify

/tranle-verify

Kiểm tra thay đổi hiện tại.
Chạy đúng các test/build cần thiết.
Báo cáo:
PASS / FAIL / NOT RUN
và ghi chính xác command đã chạy.

## 13. Release

/tranle-release

Kiểm tra trước commit:
- git status
- diff
- secrets
- tests
- build
- DB/config
- unrelated files
- remaining risks

Không push.
Không rewrite history.

## 14. Stop overreach

STOP.

Không sửa thêm.
Đọc lại yêu cầu và các file liên quan.
Chỉ ra thay đổi nào đang nằm ngoài scope.
Đưa ra plan ngắn trước khi tiếp tục.

## 15. Architecture analysis

/tranle-context

Hãy phân tích architecture hiện tại của phần:
[ MODULE ]

Chỉ dùng bằng chứng từ repository.
Nêu file cụ thể, dependency flow, data flow, auth/RBAC và test coverage.
Không sửa code.

## 16. Full production feature

/tranle-context

Sau đó:

/tranle-plan

Sau khi duyệt:

/tranle-feature

Tiếp theo:

/tranle-review

Sau đó:

/tranle-security

Cuối cùng:

/tranle-verify

Không bỏ qua bước nào.
