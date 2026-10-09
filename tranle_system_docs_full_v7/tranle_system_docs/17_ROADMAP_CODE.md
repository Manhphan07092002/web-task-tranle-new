# ROADMAP CODE

## Phase 1 - Core
- Department
- Position
- Management Level
- Role
- Permission
- Data Scope
- Audit

## Phase 2 - Work Platform
- Task refactor
- Epic
- Related Entity
- Dynamic Filter
- Saved View
- Dashboard Template

## Phase 3 - Sales
- Customer
- Contact
- Lead
- Opportunity
- Technical Request

## Phase 4 - Technical + Quote
- Survey
- BOM
- Drawing
- Quote
- Quote approval
- Contract

## Phase 5 - Workflow
- Workflow definition
- Workflow run
- Approval Center
- Notification actions

## Phase 6 - Project
- Project upgrade
- Milestone
- Auto create from contract
- Material request
- Acceptance

## Phase 7 - Service
- Ticket
- Warranty
- Customer Asset
- Maintenance
- SLA

## Phase 8 - Purchasing + Inventory
- PR
- RFQ
- PO
- Warehouse
- Location
- Serial/Lot
- Stock ledger

## Phase 9 - Finance
- AR
- AP
- Payment request
- Advance/Settlement
- MISA integration

## Phase 10 - Marketing + Integration + AI
- Campaign
- Attribution
- API/Webhook
- AI Search
- AI Summary
- AI-assisted workflow

## Phase 9A - MISA Integration
- MISA Connector
- Authentication
- Customer mapping
- Product mapping
- Order sync
- Invoice/Receivable/Payment sync
- Sync log
- Retry
- Reconciliation
- Conflict handling

# QUALITY GATE CHO ROADMAP

Mỗi Phase trong roadmap bắt buộc theo chu trình:

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

Chi tiết test của từng Phase xem:
`38_TEST_PLAN_AND_QUALITY_GATES.md`

Quy tắc:
- Critical Bug = 0.
- High Bug = 0 trước khi qua gate.
- Regression phần trước phải PASS.
- Migration/đối soát dữ liệu phải PASS nếu Phase có thay đổi DB.
- Không đánh dấu Phase DONE chỉ vì UI/API đã hoạt động.
