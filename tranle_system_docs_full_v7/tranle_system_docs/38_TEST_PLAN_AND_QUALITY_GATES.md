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
- Không được sang CRM nếu filter/data scope/dashboard template chưa pass.
- Regression Phase 1 phải xanh.

---

## PHASE 3 – CRM / Sales

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

### Stop Gate
- Lead → Customer → Opportunity chạy end-to-end.
- Không duplicate khi convert.
- Manager dashboard số liệu đúng.
- Regression Phase 1–2 pass.

---

## PHASE 4 – Technical Request / Survey / BOM / Quote / Contract

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

### Stop Gate
- Opportunity → Technical Request → Survey/BOM → Quote → Contract Signed pass.
- Quote/Contract approval policy pass.
- Contract signed event chưa được phép tạo duplicate Project.

---

## PHASE 5 – Workflow / Approval Engine

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

### Stop Gate
- Không sang Project automation nếu workflow versioning/approval/retry chưa pass.
- Không còn approval hard-code mới ở module khác.

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

## PHASE 11 – Marketing

### Test
- Campaign;
- Content Plan;
- Marketing Lead;
- source attribution;
- handoff Sales;
- conversion report.

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
