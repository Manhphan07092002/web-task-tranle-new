# TEST PLAN & QUALITY GATES – TRAN LE PLATFORM

## 1. Nguyên tắc bắt buộc

Mỗi phần/phase chỉ được xem là HOÀN THÀNH khi:
1. Code xong.
2. Migration chạy được.
3. Unit test đạt.
4. Integration/API test đạt.
5. Permission/Data Scope test đạt.
6. State transition test đạt.
7. UI test/UAT của phần đó đạt.
8. Không còn lỗi Critical/High chưa xử lý.
9. Regression test phần cũ không bị hỏng.
10. Có log/audit/notification đúng theo đặc tả.

**Không được chuyển sang phase tiếp theo chỉ vì giao diện chạy được.**

---

# 2. Các lớp kiểm thử

## 2.1 Unit Test
Kiểm tra:
- business rule;
- calculation;
- mapper;
- validator;
- state transition;
- permission helper;
- KPI formula.

Ví dụ:
- Lead chỉ convert một lần.
- Quote total/VAT/discount tính đúng.
- SLA due time tính đúng.
- Stock available không âm.
- Receivable outstanding đúng.

## 2.2 Integration Test
Kiểm tra:
- service + DB;
- transaction;
- relation;
- event;
- workflow;
- audit;
- notification.

Ví dụ:
- Contract signed → Project được tạo.
- Receipt DONE → stock move + balance đúng.
- Ticket replacement → stock issue + asset history đúng.

## 2.3 API Test
Kiểm tra:
- request schema;
- status code;
- error code;
- pagination;
- filter;
- sort;
- permission;
- data scope.

## 2.4 Permission & Data Scope Test
Bắt buộc cho mọi module:
- Employee
- Department Manager
- Deputy Director
- Director
- Admin

## 2.5 State Machine Test
Kiểm tra:
- transition hợp lệ;
- transition không hợp lệ bị chặn;
- required field trước transition;
- audit;
- actor permission.

## 2.6 UI Test
Kiểm tra:
- route;
- button/action visibility;
- validation;
- loading;
- empty;
- error;
- disabled state;
- drill-down;
- responsive tối thiểu.

## 2.7 Regression Test
Sau mỗi phase:
- chạy lại test core;
- auth;
- permission;
- task;
- dashboard;
- workflow;
- các module trước đó.

## 2.8 Migration Test
- chạy migration trên DB staging clone;
- kiểm tra row count;
- kiểm tra FK;
- rollback/restore path;
- đối soát trước/sau.

## 2.9 Security Test
- auth bypass;
- IDOR/data scope;
- SQL injection;
- XSS;
- CSRF nếu dùng cookie;
- secret leakage;
- rate limit;
- permission escalation.

## 2.10 Performance Test
Áp dụng khi module có dữ liệu lớn:
- list/filter;
- dashboard;
- stock;
- audit;
- sync;
- report.

---

# 3. Quality Gate chung

Một phần chỉ PASS khi:

| Hạng mục | Điều kiện |
|---|---|
| Unit Test | 100% test case bắt buộc pass |
| Integration | 100% critical flow pass |
| Permission | Không có lỗi đọc/sửa dữ liệu ngoài scope |
| State Machine | Không có transition trái rule |
| API | Contract đúng đặc tả |
| UI | Happy path + error state pass |
| Audit | Có đủ record theo đặc tả |
| Notification | Không gửi thiếu/trùng |
| Regression | Không làm hỏng module cũ |
| Critical Bug | 0 |
| High Bug | 0 trước production |
| Medium Bug | Có thể chấp nhận nếu đã được Product Owner duyệt |
| UAT | Người phụ trách nghiệp vụ xác nhận |

---

# 4. Test Gate theo từng Phase

## PHASE 0 – Quyết định nền / Khảo sát / Chuẩn bị migration

### Phạm vi
- các ADR ở `39_QUYET_DINH_NEN.md` chuyển sang ĐÃ DUYỆT (ADR 016, 017, 019 có người quyết);
- khảo sát schema và dữ liệu thật (đếm bản ghi, kiểm tra kiểu tiền, trùng lặp, dữ liệu mồ côi);
- dựng môi trường staging từ bản sao DB, CI chạy được bộ test hiện có;
- chốt bảng đối chiếu migration theo `32_MIGRATION_PLAN.md`.

### Test bắt buộc
- khôi phục backup lên staging thành công và đối soát số liệu;
- bộ regression hiện có chạy xanh trên staging;
- diễn tập migration phần nền (UAT-018 bản rút gọn).

### Stop Gate
- Không bắt đầu Phase 1 khi còn ADR chặn Phase 1 ở trạng thái ĐỀ XUẤT/MỞ.
- Không bắt đầu migrate khi chưa có backup khôi phục thành công.

---

## PHASE 1 – Core / Organization / Permission

### Phạm vi
- Department
- Position
- Employee
- Role
- Permission
- Data Scope
- Audit

### Test bắt buộc

#### Organization
- tạo Department;
- không trùng code;
- assign manager;
- Employee thuộc đúng Department;
- direct manager self-reference hợp lệ.

#### Permission
- Employee chỉ đọc own/assigned;
- Manager đọc department;
- Manager không đọc department khác;
- PGĐ chỉ đọc managed departments;
- Director đọc company;
- Admin không tự business approval.

#### Audit
- tạo/sửa/xóa mềm;
- thay role;
- thay department;
- thay data scope;
- audit không được user thường sửa/xóa.

### Stop Gate
Chỉ được chuyển Phase 2 khi:
- 100% permission matrix test pass;
- không có IDOR;
- audit chạy đúng;
- migration role/department đối soát đủ.

---

## PHASE 2 – Task / Epic / Related Entity / Filter / Dashboard Base

### Test bắt buộc

#### Task
- create/edit/assign;
- due date;
- overdue;
- parent/subtask;
- related entity;
- comment;
- attachment;
- completion.

#### Related Entity
- Task → Opportunity;
- Task → Contract;
- Task → Project;
- Task → Ticket.

#### Filter
- AND;
- OR;
- nested;
- invalid field bị reject;
- invalid comparator bị reject;
- filter luôn bị inject data scope.

#### Saved View
- personal view;
- shared view;
- permission;
- column config.

#### Dashboard
- đúng template theo Department + Management Level;
- Employee/Manager/PGĐ/GĐ/Admin thấy đúng dashboard;
- widget drill-down đúng filter.

### Stop Gate
- Không được sang Workflow/Approval nếu filter/data scope/dashboard template chưa pass.
- Regression Phase 1 phải xanh.

---

## PHASE 3 – Workflow / Approval Engine (lõi dùng chung)

### Test Workflow Definition
- draft;
- publish;
- version;
- deactivate.

### Test Workflow Run
- trigger;
- condition;
- approval;
- assign;
- notification;
- update status;
- retry.

### Version Test
- run v1 tiếp tục v1 khi v2 publish;
- run mới dùng v2.

### Approval Test
- đúng approver;
- wrong approver bị chặn;
- reject comment;
- timeout/failed;
- approver inactive/delegation policy.

### External Action
- timeout;
- 429;
- 500;
- retry;
- idempotency.

### Outbox / Job (ADR-006)
- sự kiện ghi cùng transaction với nghiệp vụ;
- worker lấy việc bằng SKIP LOCKED, hai instance không xử lý trùng;
- retry/backoff, quá max_attempts chuyển FAILED và cảnh báo;
- consumer idempotent theo event_id;
- scheduler chỉ một instance chạy (GET_LOCK).

### Approval chuẩn hóa (ADR-009)
- trạng thái chờ chỉ là PENDING_APPROVAL, chuỗi duyệt sinh từ approval_policies;
- cấp level1/level2/level3 đúng thứ tự, từ chối ở bất kỳ cấp nào dừng chuỗi;
- Admin không tự bypass approval nghiệp vụ.

### Stop Gate
- Không sang CRM/Quote/Contract nếu workflow versioning/approval/retry chưa pass.
- Mọi module sau Phase 3 chỉ dùng Approval Engine; không tạo approval hard-code mới (ADR-009).
- Outbox/job worker (ADR-006) đã chạy và có test.

---

## PHASE 4 – CRM / Sales (gồm kênh phân phối)

### Test Lead
- create;
- duplicate check;
- assign;
- qualify;
- disqualify;
- convert;
- convert đồng thời;
- convert lần hai bị chặn.

### Test Customer
- duplicate MST;
- Contact;
- Customer 360;
- data scope.

### Test Opportunity
- stage transition;
- LOST required reason;
- WON rule;
- forecast.

### Test Sales Activity
- follow-up;
- overdue follow-up;
- activity timeline.

### Lead hai trục (ADR-012)
- convert chỉ khi qualification_status = QUALIFIED;
- DISQUALIFIED đưa status sang CLOSED kèm lý do;
- chỉ một bảng Lead; handoff Marketing → Sales giữ campaign/source;
- convert lần hai trả 409.

### Kênh phân phối
- dealer profile, bảng giá hiệu lực theo ngày, chính sách chiết khấu;
- Sales Order kiểm tra hạn mức công nợ (BR-DIST-001): vượt hạn mức vào duyệt ngoại lệ;
- sửa giá tay có lý do và audit;
- Customer/Supplier cùng mã số thuế: cảnh báo, liên kết partner_links (ADR-018).

### Stop Gate
- Lead → Customer → Opportunity chạy end-to-end.
- Không duplicate khi convert.
- Manager dashboard số liệu đúng.
- Regression Phase 1–3 pass.

---

## PHASE 5 – Technical Request / Survey / BOM / Quote / Contract / Document Template

### Technical Request
- tạo từ Opportunity;
- assign;
- survey;
- design;
- review;
- return;
- complete.

### Survey
- required field theo request type;
- attachment;
- multiple survey.

### BOM
- line;
- version;
- approved version immutable.

### Quote
- line calculation;
- discount;
- VAT;
- total;
- version;
- submit approval;
- approve/reject;
- expired;
- revision.

### Contract
- create from Quote;
- payment milestone;
- approval;
- signed;
- amendment;
- terminated.

### Document Template (xem 40 §4)
- sinh PDF báo giá/hợp đồng từ template, lưu snapshot dữ liệu;
- biến thiếu hoặc sai kiểu trả lỗi rõ, không sinh file hỏng;
- sinh lại tạo version mới, bản nháp có watermark;
- quyền sinh/tải theo quyền xem record gốc.

### Hợp đồng bán/mua và pháp lý
- contracts.direction OUTBOUND/INBOUND, đúng một trong customer_id/supplier_id;
- contract_links, contract_amendments, contract_accounting_handoffs;
- bước rà soát pháp lý bật/tắt theo cấu hình (ADR-017).

### Stop Gate
- Opportunity → Technical Request → Survey/BOM → Quote → Contract Signed pass.
- Quote/Contract approval policy pass và chạy trên Approval Engine của Phase 3 (không hard-code).
- Contract signed event chưa được phép tạo duplicate Project.

---

## PHASE 6 – Project

### Test
- auto-create từ Contract Signed;
- không tạo duplicate khi event retry;
- milestone;
- task;
- progress;
- issue/risk;
- material request;
- acceptance;
- handover;
- project complete rule.

### Material Request
- đủ tồn;
- thiếu tồn;
- split dòng;
- reserve;
- tạo PR.

### Acceptance
- internal review;
- customer review;
- reject;
- accepted → finance event.

### Handover
- tạo Customer Asset;
- serial;
- warranty.

### Tách Project khi ký và chi phí dự án
- project_split_mode SINGLE/PER_SITE/MANUAL tạo đúng số Project;
- phát lại contract.signed không tạo trùng (idempotent contract_id + site_key);
- project_cost_entries ghi đúng nguồn (xuất kho, PO, payment request);
- Project Gross Margin/Forecast Margin đúng công thức; chỉ role có project.read.margin xem được.

### Stop Gate
- Contract Signed → Project → Material → Acceptance → Handover chạy đủ.
- Project không COMPLETE sai điều kiện.

---

## PHASE 7 – Service / Warranty / Maintenance

### Ticket
- create;
- assign;
- diagnose;
- waiting;
- resolve;
- close;
- reopen.

### SLA
- priority;
- response;
- resolve;
- business calendar;
- pause rules.

### Warranty
- in warranty;
- out of warranty;
- requires review.

### Replacement
- request;
- stock issue;
- serial old/new;
- purchase flow khi thiếu.

### Maintenance
- plan;
- scheduled task;
- completion;
- next due.

### Thiết bị đo kiểm
- thiết bị quá hạn hiệu chuẩn không gán được vào checklist (BR-COMP-002);
- lưu compliance_item_id trên kết quả đo.

### Stop Gate
- Asset → Ticket → Replacement/Maintenance chạy đầy đủ.
- SLA calculation pass.
- Serial history không sai.

---

## PHASE 8 – Purchasing / Inventory

### Purchasing
- PR;
- approval;
- RFQ;
- Supplier Quote;
- comparison;
- PO;
- partial receipt;
- close.

### Inventory
- warehouse/location;
- receipt;
- issue;
- transfer;
- return;
- count;
- lot;
- serial;
- reservation.

### Concurrency
- hai user reserve cùng tồn;
- double submit;
- duplicate serial;
- partial receipt;
- partial transfer.

### Ledger
- Stock Move DONE immutable;
- reversal;
- balance projection;
- stock không âm ngoài policy.

### Chứng từ kho thống nhất, Landed cost, CO/CQ (ADR-013, 40 §2)
- stock_documents theo doc_type, mỗi loại đúng state machine;
- phân bổ landed cost đúng phương pháp, tổng phân bổ = tổng chi phí;
- chi phí phát sinh sau không sửa unit_cost đã DONE, sinh điều chỉnh giá vốn;
- sản phẩm requires_certificates không DONE khi thiếu CO/CQ;
- stock_balances luôn khớp tổng stock_moves.

### Stop Gate
- PR → PO → Receipt → Issue chạy đủ.
- Không sai tồn sau concurrency test.
- Tồn cũ sau migration = tồn mới.

---

## PHASE 9 – Finance Operations

### Receivable
- create from payment milestone;
- due;
- partial;
- paid;
- overdue;
- aging.

### Payable
- PO/receipt/invoice relation.

### Payment Request
- submit;
- manager approval;
- finance approval;
- executive threshold;
- paid.

### Advance/Settlement
- request;
- disburse;
- settle;
- overdue.

### Budget
- committed;
- actual;
- remaining;
- threshold warning/block.

### Chuẩn hóa trạng thái (ADR-009, ADR-015)
- Payment Request chỉ DRAFT → PENDING_APPROVAL → APPROVED → PAID, chuỗi duyệt ở approvals;
- quá hạn là giá trị dẫn xuất, khoản trả một phần vẫn quá hạn được biểu diễn đúng;
- tuổi nợ tính đúng theo due_date và outstanding.

### Stop Gate
- Số liệu AR/AP đúng.
- Money precision đúng.
- Approved/Paid document không bị xóa/sửa trái rule.

---

## PHASE 10 – MISA Integration

### Contract Test
- auth;
- token expiry;
- pagination;
- error schema;
- rate limit.

### Mapping Test
- Customer;
- Product;
- Order;
- Invoice;
- Receivable;
- Payment.

### Sync Test
- local → remote;
- remote → local;
- retry;
- duplicate event;
- conflict;
- disconnect/reconnect.

### Reconciliation
- matched;
- missing local;
- missing remote;
- amount mismatch;
- status mismatch.

### Security
- token không xuất frontend;
- token không xuất log;
- encrypted credential;
- permission.

### Stop Gate
- Mapping được Kế toán xác nhận.
- Sandbox/UAT pass.
- Retry không tạo duplicate.
- Reconciliation đúng.

---

## PHASE 11 – Marketing / API Key & Webhook / AI hỗ trợ

### Test
- Campaign;
- Content Plan;
- Lead view của Marketing (cùng bảng Lead, stage_owner = MARKETING);
- source attribution;
- handoff Sales;
- conversion report.

### API key và webhook
- key lưu hash, phạm vi quyền (scopes), hạn dùng, thu hồi có hiệu lực ngay;
- rate limit, không lộ key trong log;
- webhook ký HMAC, retry/backoff, ghi delivery.

### AI hỗ trợ
- AI chỉ trả đề xuất, đi qua bước người duyệt, ghi đầu vào/đầu ra/người duyệt;
- tìm kiếm AI sinh cây bộ lọc JSON, backend kiểm tra whitelist; AI không bao giờ sinh SQL;
- dữ liệu ngoài data scope của user không được đưa vào prompt.

### Stop Gate
- Campaign → Lead → Sales → Opportunity attribution truy được.
- KPI CPL/conversion khớp dữ liệu test.

---

## PHASE 12 – Admin / Settings / Final Hardening

### Test
- User;
- Role;
- Permission;
- Dashboard config;
- Workflow config;
- SLA config;
- Integration config;
- Audit;
- system log;
- backup.

### Security Regression
- toàn bộ permission;
- session;
- token;
- secret;
- rate limit.

### Performance
- dashboard;
- list;
- filter;
- stock;
- audit;
- reports.

### Compliance và nhắc hạn
- compliance_items nhắc đúng mốc, trạng thái EXPIRING/EXPIRED dẫn xuất từ expires_at;
- thông báo đúng người (BR-COMP-001).

### Final Stop Gate
Chỉ được coi hệ thống hoàn thành khi:
- UAT end-to-end pass;
- migration rehearsal pass;
- backup/restore test pass;
- security regression pass;
- performance mục tiêu đạt;
- không còn Critical/High bug;
- Product Owner/đại diện phòng ban ký xác nhận.

---

# 5. Test Matrix theo Module

| Module | Unit | Integration | Permission | State | UI | UAT | Regression |
|---|---:|---:|---:|---:|---:|---:|---:|
| Core/Auth | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |
| Task | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Dashboard | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |
| Sales | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Technical | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Quote/Contract | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Workflow | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Project | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Service | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Purchasing | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Inventory | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Finance | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| MISA | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |
| Marketing | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Admin | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |

---

# 6. Bug Severity

## Critical
- mất dữ liệu;
- sai tiền nghiêm trọng;
- sai tồn kho;
- bypass permission;
- duplicate payment/order nghiêm trọng;
- hệ thống không sử dụng được.

=> Không được release.

## High
- workflow chính không chạy;
- approval sai;
- data scope sai;
- state sai;
- integration chính lỗi.

=> Không được release production.

## Medium
- lỗi phụ;
- workaround tồn tại;
- không ảnh hưởng dữ liệu trọng yếu.

=> Có thể release nếu Product Owner chấp nhận bằng văn bản.

## Low
- UI minor;
- wording;
- cosmetic.

---

# 7. Definition of Done cho từng Feature

Một feature chỉ DONE khi:
- [ ] Code review xong
- [ ] Unit test pass
- [ ] API/integration test pass
- [ ] Permission test pass
- [ ] State test pass nếu có
- [ ] Audit test pass
- [ ] Notification test pass nếu có
- [ ] UI happy/error/loading/empty pass
- [ ] Regression pass
- [ ] Documentation cập nhật
- [ ] Không Critical/High bug
- [ ] BA/PO nghiệm thu nếu là nghiệp vụ quan trọng

---

# 8. CI/CD Gate đề xuất

Pipeline:

```text
Lint
↓
Type Check
↓
Unit Test
↓
Integration Test
↓
Build
↓
Migration Check
↓
Security Scan
↓
Deploy Staging
↓
API/UI Smoke Test
↓
UAT
↓
Production Approval
```

Không merge vào nhánh release nếu gate bắt buộc fail.

---

# 9. Test Data Strategy

Cần seed dữ liệu test:
- 9 phòng ban;
- Employee/Manager/PGĐ/GĐ/Admin;
- Customer;
- Supplier;
- Product;
- Warehouse;
- Project;
- Contract;
- Ticket;
- Quote;
- MISA mapping giả lập.

Không dùng dữ liệu production thật cho test tự động nếu có thông tin nhạy cảm.

---

# 10. Môi trường

## Local
- Unit/Integration nhanh.

## Test/CI
- isolated DB;
- deterministic seed.

## Staging/UAT
- gần production;
- chạy migration rehearsal;
- integration sandbox.

## Production
- chỉ deploy artifact đã qua gate.

---

# 11. Nguyên tắc dừng

**Không dừng ở trạng thái "đã code xong".**

Chỉ dừng một phần khi:
- tất cả test bắt buộc của phần đó PASS;
- bug Critical/High = 0;
- regression không hỏng phần trước;
- dữ liệu đối soát đúng;
- người phụ trách nghiệp vụ xác nhận nếu cần.

Nếu không đạt, phần đó quay lại:
`Fix → Test lại → Regression → UAT`.
