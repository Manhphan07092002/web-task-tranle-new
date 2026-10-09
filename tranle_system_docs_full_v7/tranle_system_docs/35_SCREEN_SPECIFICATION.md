# SCREEN SPECIFICATION – CÁC MÀN HÌNH CHÍNH

## 1. Quy tắc chung

Mỗi screen phải định nghĩa:
- Route
- Actor/Permission
- Header
- Filters
- Columns/Fields
- Actions
- Tabs
- Empty/Loading/Error
- Audit
- Responsive behavior

---

# 2. My Dashboard

Route:
`/dashboard`

Hiển thị:
- Việc hôm nay
- Việc quá hạn
- Lịch
- Approval của tôi
- Notification
- Widget theo phòng/cấp

Actions:
- Open task
- Open approval
- Quick create

---

# 3. Lead List

Route:
`/sales/leads`

Permission:
- `lead.read.*`

Columns:
- Code
- Lead Name
- Company
- Source
- Owner
- Status
- Qualification
- Expected Value
- Next Action
- Updated At

Filters:
- Owner
- Status
- Source
- Created Date
- Next Action
- Expected Value

Actions:
- Create
- Assign
- Import
- Export
- Convert
- Bulk assign nếu có quyền

---

# 4. Lead Detail

Route:
`/sales/leads/:id`

Header:
- Code
- Name
- Company
- Owner
- Status

Actions:
- Edit
- Assign
- Qualify
- Disqualify
- Convert

Tabs:
- Overview
- Activities
- Tasks
- Documents
- Emails
- Audit

---

# 5. Opportunity Detail

Route:
`/sales/opportunities/:id`

Header:
- Code
- Customer
- Stage
- Value
- Probability
- Owner
- Expected Close

Actions:
- Edit
- Change Stage
- Create Technical Request
- Create Quote
- Mark Won
- Mark Lost
- Assign

Tabs:
- Overview
- Activities
- Technical
- Quotes
- Tasks
- Documents
- Audit

---

# 6. Technical Request Detail

Route:
`/technical/requests/:id`

Header:
- Code
- Customer
- Source
- Priority
- Status
- Assignee
- Due Date

Actions:
- Assign
- Start Survey
- Start Design
- Submit Review
- Return
- Complete
- Cancel

Tabs:
- Requirement
- Survey
- Solution
- BOM
- Drawings
- Tasks
- Documents
- Activity
- Audit

---

# 7. Quote Detail

Route:
`/sales/quotes/:id`

Header:
- Quote Code
- Customer
- Opportunity
- Version
- Total
- Status

Actions:
- Edit Draft
- Add Line
- Submit Approval
- Recall
- Approve/Reject theo permission
- Send
- Create Revision
- Export PDF/Word khi tính năng sẵn sàng

Tabs:
- Summary
- Line Items
- Terms
- Approval
- Documents
- Activity
- Audit

---

# 8. Contract Detail

Route:
`/sales/contracts/:id`

Header:
- Contract Code
- Customer
- Value
- Owner
- Status
- Signed Date

Actions:
- Edit Draft
- Submit Review
- Approve/Reject
- Mark Signed
- Create Amendment
- Terminate theo quyền

Tabs:
- Overview
- Payment Milestones
- Project
- Documents
- Approvals
- Receivables
- Audit

---

# 9. Project Detail

Route:
`/projects/:id`

Header:
- Project Code
- Name
- Customer
- PM
- Progress
- Status
- Planned End

Actions:
- Edit
- Start
- Hold
- Add Milestone
- Add Task
- Material Request
- Submit Acceptance
- Handover
- Complete

Tabs:
- Overview
- Timeline
- Milestones
- Tasks
- Technical
- Materials
- Issues/Risks
- Quality/Safety
- Acceptance
- Documents
- Activity
- Audit

---

# 10. Purchase Request Detail

Route:
`/purchasing/requests/:id`

Header:
- PR Code
- Requester
- Department
- Project
- Estimated Value
- Status

Actions:
- Edit Draft
- Submit
- Approve/Reject
- Create RFQ
- Cancel

Tabs:
- Items
- Approval
- RFQ
- PO
- Documents
- Audit

---

# 11. Purchase Order Detail

Route:
`/purchasing/orders/:id`

Header:
- PO Code
- Supplier
- Total
- Delivery Date
- Status

Actions:
- Submit
- Approve
- Send
- Cancel/Amend
- Open Receipts

Tabs:
- Items
- Delivery
- Receipts
- Supplier Invoice
- Payment
- Documents
- Audit

---

# 12. Warehouse Receipt

Route:
`/inventory/receipts/:id`

Header:
- Receipt Code
- PO/Reference
- Warehouse
- Status

Actions:
- Confirm
- Start Receiving
- Scan/Add Serial
- Complete

Tabs:
- Items
- Lot/Serial
- Stock Moves
- Documents
- Audit

Validation:
- serial uniqueness;
- actual qty;
- location.

---

# 13. Ticket Detail

Route:
`/technical/tickets/:id`

Header:
- Ticket Code
- Customer
- Asset
- Priority
- SLA
- Assignee
- Status

Actions:
- Assign
- Diagnose
- Start Work
- Wait Customer/Vendor/Part
- Request Replacement
- Resolve
- Close
- Reopen

Tabs:
- Issue
- Asset
- Warranty
- Timeline
- Parts
- Tasks
- Documents
- Audit

---

# 14. Customer 360

Route:
`/customers/:id`

Header:
- Customer Code
- Name
- Tax Code
- Owner
- Status

Tabs:
- Overview
- Contacts
- Leads
- Opportunities
- Quotes
- Contracts
- Projects
- Orders
- Receivables
- Assets
- Tickets
- Documents
- Activity

---

# 15. Approval Center

Route:
`/process/approvals`

Tabs:
- Chờ tôi duyệt
- Đã duyệt
- Yêu cầu của tôi

Card/List fields:
- Type
- Record Code
- Requester
- Department
- Amount/Value
- Reason
- Submitted At
- SLA/age

Actions:
- Approve
- Reject
- Request Change
- Open related record

---

# 16. MISA Integration

Route:
`/integrations/misa`

Tabs:
- Overview
- Connection
- Mapping
- Sync Jobs
- Errors
- Reconciliation
- Audit

Actions:
- Connect
- Disconnect
- Sync Now
- Retry
- Resolve Conflict

Permission:
- `integration.misa.*`

---

# 17. Admin User Detail

Route:
`/settings/users/:id`

Tabs:
- Account
- Employee Link
- Roles
- Permissions
- Data Scope
- Audit

Actions:
- Activate/Disable
- Assign Role
- Reset Session/Token nếu có
- Link Employee

Không hiển thị password hash/secret.
