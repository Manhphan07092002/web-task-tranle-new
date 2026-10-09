# ĐẶC TẢ CHI TIẾT BAN GIÁM ĐỐC

## 1. Mục tiêu
Cung cấp màn điều hành và phê duyệt, không yêu cầu BGĐ thao tác sâu vào CRUD nghiệp vụ hằng ngày.

## 2. Phó Giám đốc

### Data scope
Dùng `management_scopes`:
- userId
- departmentId
- validFrom
- validTo

Không hard-code "Phó GĐ A luôn quản lý phòng X".

### Dashboard
- Revenue
- Pipeline
- Project status
- Project delay
- Receivable
- Payable
- Inventory alerts
- Ticket SLA
- Department KPI
- Pending approvals

### Drill-down
Có thể click KPI để xuống danh sách record trong phạm vi quyền.

## 3. Giám đốc
Dashboard:
- Revenue / target
- Pipeline / forecast
- Receivable overdue
- Payable upcoming
- Project critical
- Inventory value
- Warranty/Service critical
- Department performance
- Executive alerts

## 4. Approval Center
BGĐ không vào từng app để tìm việc duyệt.

Một màn:
- Quote
- Contract
- Purchase Request
- Payment Request
- Budget exception
- Other configurable approvals

Mỗi card approval hiển thị:
- loại;
- requester;
- department;
- amount/value;
- reason;
- related customer/project;
- approval history;
- attachment;
- approve/reject/request-change.

## 5. Rule
- Approval threshold cấu hình.
- Delegation khi người duyệt vắng mặt nếu sau này cần.
- BGĐ không được bypass audit.
- Reject phải có comment nếu rule yêu cầu.

# 6. Dependency / Input / Output / Ownership
## Dependency
Dashboard; Approval; All business apps.
## Input
KPI; Alerts; Approval requests.
## Output
Approval decision; Executive direction/reference.
## Ownership
Management Scope: Organization/Admin theo quyết định công ty. Approval policy: Business owner + Admin cấu hình.
