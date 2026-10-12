# HƯỚNG DẪN SỬ DỤNG `.claude/` — TRANLE TASKS

## 1. Cài đặt

Giải nén thư mục `.claude` vào đúng project root:

```text
E:\web_tranle_new\.claude\
```

Sau đó mở terminal tại project:

```powershell
cd E:\web_tranle_new
claude
```

Claude Code sẽ sử dụng các rule/skill/agent/command trong `.claude/` của project.

> Bộ này là cấu hình riêng cho TranLe Tasks. Không chứa API key, password hoặc credential.

---

## 2. Quy trình chuẩn khi giao việc cho Claude

Bộ `.claude` được thiết kế theo workflow:

```text
CONTEXT → PLAN → IMPLEMENT → TEST → REVIEW → VERIFY
```

### Việc nhỏ

Có thể nói trực tiếp:

```text
Sửa lỗi nút lưu ở trang Tasks. Hãy kiểm tra nguyên nhân, sửa tối thiểu và chạy test liên quan.
```

### Việc vừa/lớn

Nên chạy:

```text
/tranle-context
```

để Claude đọc lại kiến trúc hiện tại, sau đó:

```text
/tranle-plan
```

Khi kế hoạch hợp lý:

```text
/tranle-implement
```

Cuối cùng:

```text
/tranle-review
/tranle-verify
```

---

## 3. Các command chính

| Command | Dùng khi nào |
|---|---|
| `/tranle-context` | Đọc nhanh kiến trúc, stack, route và quy ước của project |
| `/tranle-plan` | Phân tích yêu cầu và lập kế hoạch trước khi code |
| `/tranle-implement` | Thực hiện một kế hoạch đã được xác định |
| `/tranle-debug` | Điều tra và sửa bug theo nguyên nhân gốc |
| `/tranle-review` | Review thay đổi như một senior engineer |
| `/tranle-verify` | Chạy test/build/check và xác nhận kết quả |
| `/tranle-security` | Audit security, secret, auth, RBAC, upload, API |
| `/tranle-rbac` | Làm role/permission/ownership/department access |
| `/tranle-release` | Chuẩn bị kiểm tra trước khi commit/release |

---

## 4. Ví dụ: thêm một tính năng mới

Ví dụ muốn thêm chức năng **lọc công việc theo phòng ban**.

### Bước 1 — Context

```text
/tranle-context
```

Nếu Claude đã hiểu project, tiếp tục.

### Bước 2 — Plan

```text
/tranle-plan

Tôi muốn thêm bộ lọc task theo department ở màn hình quản lý công việc.
Phân tích frontend, backend API, database và RBAC trước.
Không sửa code trong bước này.
```

Claude phải xác định các file/API liên quan trước khi triển khai.

### Bước 3 — Implement

```text
/tranle-implement

Thực hiện đúng kế hoạch vừa thống nhất.
Không refactor các module không liên quan.
Sau khi sửa hãy chạy test liên quan.
```

### Bước 4 — Review

```text
/tranle-review

Review toàn bộ thay đổi vừa thực hiện.
Tập trung vào API contract, RBAC, SQL/query, validation và regression.
```

### Bước 5 — Verify

```text
/tranle-verify
```

Claude phải báo rõ:
- command đã chạy
- pass/fail
- lỗi nào còn lại
- file nào đã thay đổi

---

## 5. Ví dụ: sửa bug

Không nên chỉ nói:

```text
Sửa bug này đi.
```

Nên cung cấp triệu chứng:

```text
/tranle-debug

Khi tạo task mới, frontend báo thành công nhưng task không xuất hiện trong danh sách.
Hãy reproduce nếu có thể, trace frontend → API → database, xác định root cause rồi sửa tối thiểu.
Không reset database.
```

Workflow debug:

```text
reproduce
   ↓
trace
   ↓
root cause
   ↓
minimal fix
   ↓
regression test
   ↓
verify
```

---

## 6. Làm việc với RBAC

Khi thay đổi quyền truy cập, dùng:

```text
/tranle-rbac
```

Ví dụ:

```text
/tranle-rbac

Thêm quyền cho manager được xem task của department mình
nhưng không được xem task của department khác.
Kiểm tra cả backend authorization và frontend visibility.
```

Claude phải kiểm tra ít nhất:

```text
user → role → permission → ownership/department → endpoint → UI
```

Không được chỉ ẩn button ở frontend rồi coi đó là bảo mật.

---

## 7. Làm việc với database

Dùng skill `tranle-db` khi có thay đổi schema/query/migration.

Ví dụ:

```text
Thêm trường priority cho tasks.
Hãy kiểm tra schema MySQL hiện tại trong `backend/db_mysql.ts` trước.
Đề xuất migration/backward compatibility trước khi sửa.
```

### Quy tắc quan trọng

- Không tự xóa database.
- Không tự đổi schema chỉ vì test hiện tại lỗi.
- Không hardcode dữ liệu production vào migration.
- Kiểm tra migration versioned (`runVersionedMigration`) và dữ liệu cũ nếu thay đổi schema.

---

## 8. API backend

Khi thêm/sửa endpoint, yêu cầu Claude kiểm tra:

```text
route
→ middleware/auth
→ validation
→ controller/handler
→ database/service
→ response contract
→ frontend caller
→ tests
```

Ví dụ:

```text
/tranle-plan

Thêm GET /api/tasks/statistics.
Hãy tìm pattern API hiện có và đề xuất implementation phù hợp,
không tạo một kiến trúc service mới nếu project chưa dùng pattern đó.
```

---

## 9. Frontend

Khi sửa React UI, yêu cầu Claude kiểm tra:

```text
component
→ route
→ React Query/state
→ API client
→ loading/error/empty state
→ permission visibility
→ responsive UI
```

Không nên tạo state management mới nếu chức năng hiện tại đã có pattern tương ứng.

---

## 10. AI / Gemini / API key

Khi làm chức năng AI dùng:

```text
/tranle-security
```

hoặc skill `tranle-ai`.

Quy tắc:

- API key chỉ ở backend/environment.
- Không đưa secret vào React/Vite client.
- Không commit `.env`.
- Không in API key vào log.
- Không copy secret vào documentation hoặc `.claude/`.

---

## 11. Mail / IMAP / SMTP

Dùng skill `tranle-mail` khi sửa email.

Ví dụ:

```text
Sửa chức năng gửi mail khi tạo meeting.
Kiểm tra SMTP config, template, attachment và error handling.
Không log password/token.
```

---

## 12. Realtime / Socket.IO

Dùng `tranle-realtime` khi làm notification/live update.

Claude cần kiểm tra:

```text
server socket
→ authentication/room
→ event name
→ payload
→ client listener
→ cleanup/unsubscribe
→ duplicate event
```

Đặc biệt tránh việc component mount nhiều lần làm đăng ký listener trùng.

---

## 13. Security audit

Chạy:

```text
/tranle-security
```

cho các thay đổi liên quan:

- JWT/authentication
- RBAC
- upload
- file access
- SQL/query
- XSS/HTML rendering
- email
- AI credentials
- environment variables
- CORS/rate limit

Nếu phát hiện lỗ hổng, Claude phải ưu tiên root cause và impact thay vì chỉ sửa triệu chứng.

---

## 14. Review trước commit

Dùng:

```text
/tranle-review
```

Sau đó:

```text
/tranle-verify
```

Chỉ commit khi biết rõ:

```text
✓ code đúng
✓ test đã chạy
✓ build đã kiểm tra nếu cần
✓ không có secret
✓ không có file tạm
✓ không có thay đổi ngoài phạm vi
```

---

## 15. Khi Claude làm quá nhiều

Nếu Claude bắt đầu refactor lan sang nhiều module, hãy nói:

```text
Dừng. Chỉ sửa phần cần thiết cho yêu cầu hiện tại.
Không refactor ngoài scope.
Trước khi sửa thêm hãy giải thích file nào thực sự cần thay đổi và vì sao.
```

Nếu chưa rõ architecture:

```text
/tranle-context
```

Nếu chưa rõ giải pháp:

```text
/tranle-plan
```

---

## 16. Prompt mẫu dùng hằng ngày

### Feature
```text
/tranle-plan

[TÊN TÍNH NĂNG]

Mục tiêu:
[MÔ TẢ]

Yêu cầu:
- ...
- ...

Hãy kiểm tra code hiện tại trước, xác định file/API/database liên quan,
đánh giá ảnh hưởng và lập implementation plan. Chưa code.
```

### Implement
```text
/tranle-implement

Thực hiện plan đã thống nhất cho [TÍNH NĂNG].
Giữ nguyên architecture hiện tại.
Không refactor ngoài scope.
Sau khi code xong chạy test/build phù hợp và báo kết quả thật.
```

### Bug
```text
/tranle-debug

Bug: [MÔ TẢ]
Expected: [KẾT QUẢ ĐÚNG]
Actual: [KẾT QUẢ HIỆN TẠI]

Hãy reproduce → trace → root cause → fix → regression test → verify.
```

### Review
```text
/tranle-review

Review các thay đổi hiện tại như senior engineer.
Tập trung security, RBAC, API contract, data integrity, performance,
regression và code quality.
```

### Verify
```text
/tranle-verify

Kiểm tra thay đổi hiện tại. Chạy các test/build/check phù hợp.
Không được nói “pass” nếu chưa thực sự chạy command.
```

---

## 17. Quy tắc vàng cho TranLe Tasks

```text
1. Đọc code trước khi đoán.
2. Plan trước khi sửa task lớn.
3. Sửa nhỏ nhất có thể.
4. Không phá API contract ngoài chủ đích.
5. Backend mới là nơi enforce security.
6. Không đưa secret vào frontend/git/.claude.
7. Không reset database để chữa lỗi.
8. Test phải chạy thật.
9. Review trước release.
10. Nếu không chắc → nói rõ điều chưa chắc và kiểm tra tiếp.
```

## 18. ECC và bộ TranLe này

Bộ này lấy tư tưởng workflow của ECC nhưng được thu gọn và chuyên biệt cho TranLe Tasks. ECC hiện mô tả workflow cốt lõi là `plan → test → implement → review → verify → remember → improve` và có hệ thống agents, skills, commands, rules, hooks và memory.

Nếu cài ECC chính thức cho Claude Code, chỉ chọn **một** phương thức cài đặt ECC; tài liệu chính thức cảnh báo không chồng nhiều phương thức cài đặt vì có thể tạo duplicate skills/commands/hooks/config.

Bộ `.claude/` của TranLe có thể được dùng độc lập như project-local rules/workflows.
