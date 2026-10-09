# ROADMAP CODE (THỨ TỰ DUY NHẤT – ADR-008)

> File này là nguồn sự thật về thứ tự phase. `00_TONG_QUAN_HE_THONG.md` và `38_TEST_PLAN_AND_QUALITY_GATES.md` phải khớp với đây. Không có mốc thời gian vì phụ thuộc quy mô đội và công nghệ; ước lượng thực hiện sau Phase 0.

## Nguyên tắc sắp thứ tự
1. **Nền trước, nghiệp vụ sau:** Core, Work Platform và Workflow/Approval phải xong trước các module có chứng từ cần duyệt (Quote, Contract, Payment Request, đơn đại lý, nghỉ phép).
2. **Dữ liệu tiền và hàng ở cuối chuỗi nghiệp vụ**, khi quyền, workflow và migration đã ổn.
3. **Mỗi phase là một lát cắt dùng được** có test, migration và UAT riêng.

## Phase 0 – Quyết định nền, khảo sát, chuẩn bị migration
- ADR ở `39_QUYET_DINH_NEN.md` được duyệt (016, 017, 019 có người quyết)
- Khảo sát schema và dữ liệu thật, staging từ bản sao DB, CI chạy được bộ test hiện có
- Bảng đối chiếu migration (`32_MIGRATION_PLAN.md`) chốt

## Phase 1 – Core
- Department (kèm path/phòng con), Position, Management Level
- Role, Permission, Data Scope
- Employee/User tách, Audit
- Ánh xạ quyền, vai trò, phòng ban từ hệ thống cũ

## Phase 2 – Work Platform
- Task refactor, Epic, Related Entity (entity_relations)
- Dynamic Filter (whitelist), Saved View
- Dashboard Template
- Document/attachment (document_relations)

## Phase 3 – Workflow / Approval Engine (lõi dùng chung)
- Workflow definition, version, run
- Approval Center, approval_policies, cấp level1–3
- Notification actions
- Outbox và job worker (ADR-006), scheduler một instance
- SLA và business calendar dùng chung

## Phase 4 – CRM / Sales
- Customer, Contact, Lead (hai trục), Opportunity, Sales Activity
- Kênh phân phối: dealer profile, bảng giá, chính sách chiết khấu, Sales Order, hạn mức công nợ
- partner_links Customer/Supplier

## Phase 5 – Technical + Quote + Contract
- Technical Request, Survey, BOM, Drawing
- Quote và Quote approval (dùng Approval Engine Phase 3)
- Contract (OUTBOUND/INBOUND), phụ lục, bàn giao hồ sơ kế toán, rà soát pháp lý (tùy chọn)
- Document Template và xuất PDF

## Phase 6 – Project
- Project upgrade, Milestone, Issue, Risk, Site Diary
- Tự tạo Project khi ký (project_split_mode), Material Request, Acceptance, Handover
- Chi phí dự án và biên lợi nhuận

## Phase 7 – Service
- Ticket, Warranty, Customer Asset, Maintenance
- SLA áp dụng cho Ticket
- Thiết bị đo kiểm và hiệu chuẩn (compliance_items)

## Phase 8 – Purchasing + Inventory
- PR, RFQ, Supplier Quote, PO, Supplier Evaluation
- Warehouse, Location, Product master, Lot/Serial
- stock_documents, stock_moves (sổ cái), stock_balances, kiểm kê
- Landed cost, chứng nhận CO/CQ theo lô

## Phase 9 – Finance Operations
- AR, AP, Payment, Payment Allocation
- Payment Request (qua Approval Engine), Advance/Settlement
- Budget và kiểm soát cam kết

## Phase 10 – MISA Integration
- Connector, Authentication
- Mapping khách hàng, sản phẩm
- Đồng bộ đơn, hóa đơn, công nợ, thanh toán
- Sync log, Retry, Reconciliation, Conflict handling
- Chỉ bắt đầu sau khi có tài liệu API MISA của gói đang dùng (`30_MISA_FIELD_MAPPING.md`)

## Phase 11 – Marketing, API Key/Webhook, AI hỗ trợ
- Campaign, Content Plan, Attribution, handoff Lead
- API key, webhook có ký và retry
- AI Search, AI Summary, AI-assisted workflow (đề xuất + bước duyệt)

## Phase 12 – Admin/Settings hoàn thiện và Hardening
- Cấu hình hoàn chỉnh (Lookup, Custom Field, Template, Integration)
- Compliance items và nhắc hạn đầy đủ
- Hiệu năng, bảo mật, backup/restore, go-live

---

## So với v7
| v7 | v8 | Lý do |
|---|---|---|
| Phase 3 Sales, 4 Technical+Quote, 5 Workflow | Workflow lên Phase 3; Sales 4; Technical+Quote+Contract 5 | Quote/Contract cần Approval Engine, tránh hard-code rồi gỡ |
| MISA là Phase 9A trong Finance (file 17) và Phase 10 (file 38) | Phase 10 duy nhất | Hai file từng khác nhau |
| Marketing + Integration + AI là Phase 10 (17), Marketing riêng Phase 11 (38) | Phase 11 gồm cả ba | Thống nhất |
| Chưa có Phase 0 | Có Phase 0 | Chốt ADR, khảo sát, staging, migration |

# QUALITY GATE CHO ROADMAP

Mỗi Phase bắt buộc theo chu trình:

```text
Phân tích
→ Code
→ Unit Test
→ Integration/API Test
→ Permission/Data Scope Test
→ State/Business Rule Test
→ UI Test
→ Regression
→ UAT
→ PASS GATE
→ mới chuyển Phase tiếp theo
```

Chi tiết test của từng Phase xem `38_TEST_PLAN_AND_QUALITY_GATES.md`.

Quy tắc:
- Critical Bug = 0.
- High Bug = 0 trước khi qua gate.
- Regression phần trước phải PASS.
- Migration/đối soát dữ liệu phải PASS nếu Phase có thay đổi DB.
- Không đánh dấu Phase DONE chỉ vì UI/API đã hoạt động.

## Lưu ý về tải công việc của gate
Gate đầy đủ (UAT riêng, regression toàn bộ) áp dụng cho các phase chạm tiền, hàng, quyền và dữ liệu khách (Phase 1, 3, 5, 8, 9, 10). Với phase ít rủi ro hơn, gate rút gọn (unit, API, permission, regression liên quan) được phép nếu Tech Lead ghi rõ lý do trong biên bản phase. Đây là đề xuất để gate không thành điểm nghẽn; cần Tech Lead/PO duyệt.
