# Kế hoạch triển khai Tran Le Platform - Bộ tài liệu v7

## 1. Vai trò của bộ v7

Bộ v7 giữ nguyên phạm vi nghiệp vụ của v6 nhưng bổ sung một lớp quản trị chất lượng rõ ràng tại `38_TEST_PLAN_AND_QUALITY_GATES.md`. Vì vậy v7 không nên được triển khai như một danh sách tính năng mới; đây là kế hoạch biến roadmap thành các phase có điều kiện dừng, test bắt buộc, UAT và kiểm soát phát hành.

### 1.1. Những điểm mới đáng chú ý

- Mỗi phase phải qua unit, integration/API, permission/data scope, state, UI, regression và UAT.
- Có quality gate chung: Critical = 0, High = 0 trước production, audit/notification đúng và migration được đối soát.
- Có test plan riêng cho 12 phase từ Core đến Admin/Hardening.
- Có test matrix theo module và phân loại bug Critical/High/Medium/Low.
- Có pipeline đề xuất: lint → type check → unit → integration → build → migration check → security scan → staging → smoke test → UAT → production approval.
- Có chiến lược test data, môi trường local/CI/staging/production và nguyên tắc dừng.
- `16_DEV_HANDOFF_CHECKLIST.md`, `17_ROADMAP_CODE.md`, `37_UAT_END_TO_END.md` đã được cập nhật để bắt buộc tuân thủ quality gate.

### 1.2. Khoảng cách với code hiện tại

- Backend hiện có các route users, roles, departments, tasks, projects, clients, contracts, products, reports, revenue, documents, notifications và activity; chưa có đầy đủ module trong roadmap.
- Frontend chưa có đầy đủ các màn hình trong `35_SCREEN_SPECIFICATION.md`.
- Test hiện có chưa đạt toàn bộ ma trận v7; cần bổ sung API, scope, state, UI, migration, security và performance test theo từng phase.
- `users.role`/`users.department` còn là chuỗi; chưa có đầy đủ Position, Management Level, Permission Registry và Data Scope.
- Chưa có workflow engine, inventory ledger, finance operations mở rộng và MISA sync service.
- V7 đưa yêu cầu quality gate vào tài liệu nhưng CI/CD chưa tự động chặn merge theo các gate đó.
- Tài liệu đang cần kiểm tra lại UTF-8 vì một số công cụ đọc hiển thị tiếng Việt bị lỗi mã hóa.

## 2. Nguyên tắc thực hiện

1. Chỉ làm một phase khi phase phụ thuộc đã PASS gate.
2. Mỗi feature được giao theo lát dọc: migration, backend, frontend, audit, notification, test và tài liệu.
3. Không đánh dấu DONE vì API/UI chạy được nếu permission, state, migration, regression hoặc UAT chưa đạt.
4. Test scope phải được chạy ở backend query/service; ẩn nút frontend không phải là authorization.
5. Action nghiệp vụ quan trọng dùng endpoint riêng và state machine dùng chung.
6. Mọi migration phải có backup, forward script, validation query, rollback/restore path và row count trước/sau.
7. Seed test phải deterministic và không dùng dữ liệu production thật.
8. Không seed runtime để khôi phục record người dùng đã xóa.

## 3. Giai đoạn 0 - Thiết lập baseline và CI quality gate

**Mục tiêu:** có nền tảng đo lường trước khi sửa hoặc mở rộng chức năng.

### Công việc

- Chụp schema/index/row count production và clone sang staging.
- Lập matrix `document → entity → table → API → screen → test → owner`.
- Đánh dấu code hiện tại theo `KEEP`, `EXTEND`, `MIGRATE`, `DEPRECATE`, `PLANNED`.
- Chuẩn hóa UTF-8 cho tài liệu và kiểm tra line ending.
- Chốt Node/TypeScript/test runner và lệnh CI chính thức.
- Tạo pipeline lint, type check, unit test, integration test, build và migration check.
- Tạo test database cô lập, seed deterministic và cleanup sau test.
- Định nghĩa bug severity, evidence bắt buộc và người phê duyệt UAT.

### Đầu ra

- CI chạy được trên pull request.
- Test report và coverage report.
- Staging clone có backup/restore procedure.
- Quality gate checklist dùng chung cho mọi PR.

### Gate 0

- Pipeline chạy xanh trên code hiện tại hoặc có baseline exception được ghi rõ.
- Có test data không chứa dữ liệu production nhạy cảm.
- Có restore thử nghiệm thành công.

## 4. Phase 1 - Core / Organization / Permission

**Phạm vi:** Department, Position, Employee, Role, Permission, Data Scope, Audit.

### Database

- Tạo/chuẩn hóa `departments`, `positions`, `management_levels`, `permissions`.
- Thêm `departmentId`, `positionId`, `managementLevelId` theo migration hai bước.
- Tạo `role_permissions`, `user_roles` hoặc chốt role đơn nếu chưa cần nhiều role.
- Tạo management scope và audit schema.
- Backfill từ chuỗi role/department/jobTitle hiện tại.

### Backend

- Validation role, permission, department, position và manager.
- Helper scope cho own/assigned/department/managed departments/company.
- Chặn Admin cuối cùng, user hiện tại, role đang dùng và department còn dữ liệu.
- Transaction khi đổi role/department hoặc chuyển ownership.
- Revoke token khi quyền thay đổi.
- Audit create/update/delete/soft delete/role change/scope change.

### Frontend

- Tách cột Chức vụ, Vai trò, Cấp quản lý và Phòng ban.
- CRUD master data từ API, không hardcode.
- Hiển thị action theo permission nhưng vẫn bắt backend kiểm tra.

### Test bắt buộc

- Employee chỉ đọc own/assigned.
- Manager đọc đúng department, không đọc department khác.
- Deputy Director chỉ đọc managed departments.
- Director đọc company theo policy.
- Admin quản trị nhưng không tự bypass business approval.
- IDOR, đổi role, đổi department, audit tamper và migration backfill.

### Gate 1

100% permission matrix pass, không có IDOR, audit đúng, migration đối soát đủ và không còn Critical/High.

## 5. Phase 2 - Task / Epic / Related Entity / Filter / Dashboard Base

### Công việc

- Mở rộng task với epic, parent/subtask, related entity, comments, attachments, watchers và activity.
- Chuẩn hóa Task state machine, overdue và completion rule.
- Tạo dynamic filter AND/OR/nested với field/comparator whitelist.
- Tạo saved view personal/shared và quyền chia sẻ.
- Tạo dashboard template theo Department + Management Level.
- Drill-down widget phải giữ nguyên data scope.

### Test

- Task create/edit/assign/due date/overdue/completion.
- Liên kết Task với Opportunity, Contract, Project, Ticket.
- Reject filter field/comparator không hợp lệ.
- Scope luôn được inject vào filter.
- Saved view không lộ dữ liệu private.
- Regression Phase 1.

### Gate 2

Không sang CRM nếu filter, data scope, dashboard template và task UAT đều pass.

## 6. Phase 3 - CRM / Sales

### Chia nhỏ

1. Customer/contact và duplicate business key.
2. Lead source, qualification, assignment, follow-up.
3. Lead convert với transaction và idempotency.
4. Opportunity stage, forecast và lost reason.
5. Sales activity/timeline.
6. Dashboard Sales và notification.

### Test

- Duplicate MST/customer.
- Convert đồng thời chỉ tạo một kết quả.
- Convert lần hai bị chặn.
- Opportunity LOST bắt buộc lý do.
- Manager dashboard đúng số liệu và scope.

### Gate 3

Luồng Lead → Customer → Opportunity chạy end-to-end, không duplicate và regression Phase 1–2 pass.

## 7. Phase 4 - Technical Request / Survey / BOM / Quote / Contract

### Chia nhỏ

- Technical request từ Opportunity.
- Assign, survey, design, review, return, complete.
- BOM/BOM line/version và approved version immutable.
- Quote line, discount, VAT, total, revision và expiry.
- Quote submit/approve/reject bằng action endpoint.
- Contract từ Quote, payment milestone, signed, amendment, terminate.

### Test

- Required fields theo request type.
- Tính total/VAT/discount bằng DECIMAL.
- Quote đang duyệt không bị sửa trực tiếp.
- Approved BOM immutable.
- Contract signed không tạo duplicate Project.

### Gate 4

Opportunity → Technical Request → Survey/BOM → Quote → Contract Signed pass với approval policy và audit.

## 8. Phase 5 - Workflow / Approval Engine

### Chia nhỏ

- Workflow definition draft/publish/deactivate.
- Version bất biến sau khi có run.
- Workflow run, condition, step và retry.
- Approval assignment theo user/role/manager.
- Reject comment, delegation, escalation, timeout.
- Notification event/template/channel.

### Test

- Run cũ tiếp tục dùng version cũ khi version mới publish.
- Wrong approver bị chặn.
- Approver inactive có policy thay thế.
- External action timeout/429/500 có retry và idempotency.

### Gate 5

Không còn approval hardcode rải rác ở module và toàn bộ workflow critical pass.

## 9. Phase 6 - Project

### Chia nhỏ

- Contract Signed event tạo Project idempotent.
- Project member, milestone, progress, issue/risk, quality/safety.
- Material request và reserve.
- Acceptance internal/customer/reject/accepted.
- Handover tạo Customer Asset, serial và warranty.

### Test/Gate

- Event retry không tạo duplicate.
- Project không COMPLETE khi còn milestone bắt buộc.
- Material đủ/thiếu/split/reserve đúng.
- Acceptance tạo finance event.
- Handover tạo asset và warranty đúng.

## 10. Phase 7 - Service / Warranty / Maintenance

### Chia nhỏ

- Ticket create/assign/diagnose/waiting/resolve/close/reopen.
- SLA response/resolve/pause theo business calendar.
- Warranty in/out of warranty.
- Replacement với serial cũ/mới và stock issue.
- Maintenance plan, scheduled task, checklist và next due.

### Gate 7

Asset → Ticket → Replacement/Maintenance pass, SLA calculation đúng và serial history không sai.

## 11. Phase 8 - Purchasing / Inventory

### Chia nhỏ

- PR, approval, RFQ, supplier quote, comparison, PO.
- Warehouse/location, receipt, issue, transfer, return, count.
- Lot/serial/reservation.
- Stock ledger immutable và balance projection.
- Reversal thay cho sửa Stock Move DONE.

### Test

- Hai user reserve cùng tồn.
- Double submit.
- Duplicate serial.
- Partial receipt/transfer.
- Stock count đang chạy.
- Tồn sau migration bằng tồn trước migration.

### Gate 8

PR → PO → Receipt → Issue pass và concurrency không làm sai tồn.

## 12. Phase 9 - Finance Operations

### Chia nhỏ

- Receivable từ payment milestone.
- Payable từ PO/receipt/invoice.
- Payment request với ngưỡng phê duyệt.
- Advance, disburse, settlement và overdue.
- Budget committed/actual/remaining/threshold.
- Precision tiền bằng DECIMAL và không cho sửa chứng từ Approved/Paid trái rule.

### Gate 9

AR/AP, aging, payment flow và budget đúng; số liệu được đối soát với contract/project.

## 13. Phase 10 - MISA Integration

### Trước khi code

- Kế toán xác nhận source of truth và field mapping.
- Đăng ký endpoint thực tế, auth flow, rate limit và sandbox.
- Chốt object nào một chiều/hai chiều.

### Chia nhỏ

1. `integrations` và credential encryption.
2. `integration_mappings`, sync jobs/items/logs.
3. MisaClient auth/refresh/pagination/error wrapper.
4. Customer mapping.
5. Product mapping.
6. Sales order mapping.
7. Invoice/receivable/payment sync.
8. Retry/backoff/idempotency/conflict.
9. Reconciliation và manual retry dashboard.

### Gate 10

Sandbox/UAT pass, token không ra frontend/log, retry không duplicate, mapping được Kế toán xác nhận và reconciliation đúng.

## 14. Phase 11 - Marketing

### Chia nhỏ

- Campaign.
- Content plan.
- Marketing lead.
- Source attribution.
- Handoff sang Sales.
- Conversion/CPL dashboard.

### Gate 11

Campaign → Lead → Sales → Opportunity truy được attribution và KPI khớp dữ liệu test.

## 15. Phase 12 - Admin / Settings / Final Hardening

### Chia nhỏ

- User/Role/Permission/Scope configuration.
- Dashboard template, workflow, SLA, business calendar và integration config.
- Audit viewer/system log.
- Backup/restore.
- Rate limit, XSS, SQL injection, IDOR, secret leakage, session/token review.
- Performance list/filter/dashboard/stock/audit/report.

### Final Gate

- UAT-001 đến UAT-012 pass.
- Migration rehearsal pass.
- Backup/restore pass.
- Security regression pass.
- Performance target đạt.
- Critical/High bug bằng 0.
- Product Owner và đại diện phòng ban ký xác nhận.

## 16. CI/CD và test data

### Pipeline bắt buộc

```text
Lint
→ Type Check
→ Unit Test
→ Integration/API Test
→ Build
→ Migration Check
→ Security Scan
→ Deploy Staging
→ Smoke Test
→ UAT
→ Production Approval
```

### Test data

- 9 phòng ban chuẩn.
- Employee, Manager, Deputy Director, Director, Admin.
- Customer, Supplier, Product, Warehouse, Project, Contract, Ticket, Quote.
- MISA mapping giả lập.
- Không dùng dữ liệu production thật cho test tự động.

## 17. Cách chia ticket cho một feature

Mỗi feature phải được tách thành các ticket nhỏ:

1. BA chốt actor, precondition, input, output, rule và transition.
2. DBA thiết kế bảng/index/migration/rollback.
3. Backend viết schema, domain service, API và action endpoint.
4. Backend thêm auth, data scope, transaction, idempotency và audit.
5. Frontend làm route, list, detail, form, filter và action visibility.
6. Notification làm event/template/channel/escalation.
7. QA viết unit, integration, permission, state, edge-case và UAT.
8. DevOps chuẩn bị seed, backup, metrics và deploy.
9. Reviewer đối chiếu ERD, state machine, RACI, API và screen spec.
10. Cập nhật mapping matrix, changelog và trạng thái phase.

## 18. Definition of Done và chất lượng

Feature chỉ DONE khi:

- Code review xong.
- Migration chạy được và có restore path.
- Unit/integration/API pass.
- Permission/data scope pass.
- State/business rule pass nếu có.
- Audit/notification pass nếu có.
- UI happy/error/loading/empty/responsive pass.
- Regression pass.
- UAT pass với nghiệp vụ quan trọng.
- Không còn Critical/High bug.
- Tài liệu và mapping matrix đã cập nhật.

## 19. Thứ tự ưu tiên thực hiện

1. Giai đoạn 0: baseline, CI và test data.
2. Phase 1: Core/RBAC/Data Scope/Audit.
3. Phase 2: Task/Filter/Dashboard base.
4. Phase 3–4: Sales, Technical, Quote, Contract.
5. Phase 5–6: Workflow và Project.
6. Phase 7–8: Service, Purchasing, Inventory.
7. Phase 9–10: Finance và MISA.
8. Phase 11–12: Marketing, Admin, hardening và production cutover.

