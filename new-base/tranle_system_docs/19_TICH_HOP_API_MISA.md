# TÍCH HỢP API MISA CRM / MISA VÀO TRAN LE PLATFORM

## 1. Mục tiêu

Tích hợp Tran Le Platform với MISA theo nguyên tắc:

- Tran Le Platform quản lý **quy trình vận hành nội bộ**.
- MISA tiếp tục là hệ thống nghiệp vụ kế toán/CRM đang sử dụng.
- Chỉ đồng bộ dữ liệu cần thiết, không nhân bản toàn bộ dữ liệu MISA.
- Mọi lần đồng bộ phải có log, trạng thái, retry và cơ chế chống tạo trùng.
- Không gọi API MISA trực tiếp từ frontend.
- Credential/token MISA chỉ được lưu và sử dụng tại backend.

---

# 2. Kiến trúc tích hợp

```text
TRAN LE PLATFORM
      │
      │ Internal Service / Event
      ▼
INTEGRATION HUB
      │
      ├── MISA Connector
      │     ├── Authentication
      │     ├── Customer Mapping
      │     ├── Product Mapping
      │     ├── Order Mapping
      │     ├── Invoice Mapping
      │     ├── Receivable Mapping
      │     └── Payment Mapping
      │
      ├── Sync Queue
      ├── Retry
      ├── Mapping
      ├── Sync Log
      └── Error Handling
      │
      ▼
MISA API
```

Frontend không giữ access token MISA.

---

# 3. Vai trò của từng hệ thống

## Tran Le Platform là nguồn chính cho

- Lead
- Opportunity
- Technical Request
- Survey
- Quote
- Contract
- Project
- Task
- Purchase Request
- Ticket
- Warranty
- Customer Asset
- Workflow / Approval

## MISA là nguồn chính cho các dữ liệu kế toán chính thức nếu công ty đang dùng MISA cho kế toán

Ví dụ:

- Hóa đơn
- Chứng từ kế toán
- Công nợ kế toán chính thức
- Thu / chi theo chuẩn kế toán
- Số liệu sổ sách cần đối chiếu

## Có thể đồng bộ hai chiều tùy object

Không mặc định object nào cũng hai chiều.

---

# 4. Nguyên tắc Master Data

Mỗi object phải xác định rõ hệ thống nào là `Source of Truth`.

Ví dụ đề xuất:

| Object | Master |
|---|---|
| Lead | Tran Le |
| Opportunity | Tran Le |
| Quote | Tran Le |
| Contract | Tran Le |
| Project | Tran Le |
| Task | Tran Le |
| Ticket | Tran Le |
| Customer | Tran Le hoặc MISA tùy quy trình thực tế |
| Product | Cần chốt |
| Sales Order | Tran Le hoặc MISA tùy quy trình |
| Invoice | MISA |
| Accounting Receivable | MISA |
| Payment | MISA |
| Employee | Tran Le |

Không triển khai đồng bộ trước khi chốt bảng này với Kế toán và Kinh doanh.

---

# 5. Connection Configuration

Bảng đề xuất:

```text
integrations
------------
id
provider                 -- misa_crm / misa_accounting
name
status                   -- connected / disconnected / error
base_url
client_id
encrypted_secret
encrypted_access_token
encrypted_refresh_token
token_expires_at
last_sync_at
created_by
created_at
updated_at
```

Lưu ý:
- Secret/token phải mã hóa ở backend.
- Không log access token.
- Không trả token về frontend.
- Có nút revoke/disconnect.

---

# 6. MISA Connector

Backend nên có lớp riêng:

```text
MisaClient
├── authenticate()
├── refreshToken()
├── request()
├── getCustomer()
├── createCustomer()
├── updateCustomer()
├── getProducts()
├── createOrder()
├── getInvoices()
├── getReceivables()
└── getPayments()
```

Không rải HTTP call MISA trong controller của Sales/Finance.

---

# 7. Mapping ID giữa hai hệ thống

Không dùng tên hoặc mã hiển thị làm khóa duy nhất.

Bảng:

```text
integration_mappings
--------------------
id
integration_id
entity_type
local_id
remote_id
remote_code
sync_direction
last_synced_at
sync_hash
status
```

Ví dụ:

```text
entity_type = customer
local_id = 102
remote_id = MISA_xxxxx
```

Nhờ đó:
- update đúng bản ghi
- không tạo trùng
- theo dõi lỗi
- đổi code không mất liên kết

---

# 8. Đồng bộ Customer

## Tran Le → MISA

Trigger đề xuất:

```text
Customer Approved
↓
Validate MST / Phone / Email
↓
Check Mapping
↓
Nếu chưa có remote_id:
    Search MISA
↓
Nếu tìm thấy:
    Link
Nếu không:
    Create
↓
Save Mapping
```

Các field cần mapping tối thiểu:

```text
Tran Le                MISA
--------------------------------
customer.code           code
customer.name           name
tax_code                taxCode
phone                   phone
email                   email
address                 address
customer_type           type
```

Tên field thực tế phải đối chiếu theo tài liệu API MISA đang sử dụng.

---

# 9. Đồng bộ Product

Các field đề xuất:

```text
local product
- id
- sku
- name
- unit
- category
- sale_price
- vat_rate
```

Mapping sang MISA theo API thực tế.

Quy tắc:
- SKU nên là khóa nghiệp vụ ổn định.
- Không tự tạo product mới bên MISA nếu thiếu mapping mà chưa có quyền.
- Product có serial/lot vẫn được quản lý chi tiết tại Inventory của Tran Le nếu MISA không quản lý cùng mức chi tiết.

---

# 10. Đồng bộ Sales Order

Luồng đề xuất:

```text
Opportunity Won
↓
Quote Approved
↓
Contract Signed
↓
Sales Order Created
↓
Workflow Approval
↓
Push to MISA
↓
Save remote_id
```

Không push từ bản nháp.

Các trạng thái:

```text
draft
approved
sync_pending
synced
sync_failed
cancelled
```

---

# 11. Đồng bộ Invoice

Khuyến nghị:
- Invoice chính thức nên lấy từ MISA nếu MISA là hệ thống phát hành/ghi nhận hóa đơn.
- Tran Le chỉ lưu mirror/reference phục vụ vận hành.

Flow:

```text
MISA Invoice Created
↓
Sync Job / Webhook
↓
Find Contract / Order
↓
Store MISA reference
↓
Update receivable view
```

---

# 12. Đồng bộ Công nợ

Không nên để hai hệ thống cùng tự tính công nợ độc lập mà không có rule.

Đề xuất:

```text
Tran Le:
Contract payment milestone
Expected receivable

MISA:
Official accounting receivable
Actual payment
```

Dashboard Tran Le có thể hiển thị:

```text
Kế hoạch phải thu
Thực tế phải thu
Đã thu
Quá hạn
Chênh lệch
```

Nguồn phải được ghi rõ.

---

# 13. Đồng bộ Payment

Flow:

```text
MISA Payment
↓
Sync
↓
Match Customer
↓
Match Invoice / Contract Payment
↓
Update paid_amount
↓
Recalculate outstanding
↓
Notify Sales / Finance if fully paid
```

Phải hỗ trợ:
- thanh toán một phần
- nhiều payment cho một invoice
- một payment đối trừ nhiều chứng từ nếu API MISA cho phép

---

# 14. Sync Jobs

```text
sync_jobs
---------
id
integration_id
entity_type
direction
mode
started_at
finished_at
status
processed
success_count
failed_count
triggered_by
```

Mode:
- manual
- scheduled
- event
- retry

---

# 15. Sync Items

```text
sync_items
----------
id
job_id
entity_type
local_id
remote_id
action
status
request_payload
response_summary
error_code
error_message
attempt_count
next_retry_at
created_at
updated_at
```

Không lưu secret/token trong payload log.

---

# 16. Retry và Idempotency

Các lỗi mạng/429/5xx:
- exponential backoff
- retry có giới hạn
- idempotency key nếu API hỗ trợ
- không retry vô hạn

Ví dụ:

```text
attempt 1: ngay
attempt 2: +1 phút
attempt 3: +5 phút
attempt 4: +15 phút
attempt 5: +1 giờ
```

Lỗi dữ liệu 4xx:
- không retry tự động liên tục
- đưa vào danh sách cần xử lý

---

# 17. Conflict Handling

Nếu hai hệ thống cùng sửa Customer:

Các chế độ:
- Tran Le wins
- MISA wins
- Latest update wins
- Manual review

Khuyến nghị dữ liệu nhạy cảm:
- dùng manual review khi conflict.

Bảng có thể có:

```text
sync_conflicts
--------------
id
entity_type
local_id
remote_id
field
local_value
remote_value
detected_at
status
resolved_by
resolved_at
resolution
```

---

# 18. MISA Integration Dashboard

Menu:

```text
TÍCH HỢP
└── MISA
    ├── Tổng quan
    ├── Cấu hình kết nối
    ├── Mapping
    ├── Đồng bộ
    ├── Lịch sử
    ├── Lỗi
    └── Nhật ký API
```

Dashboard:

```text
Connection: Connected

Last Sync: 10:30

Customers
Synced: 1,240
Failed: 3

Products
Synced: 850
Failed: 0

Orders
Pending: 12
Failed: 2

Invoices
Last fetched: 10:25
```

---

# 19. Permission

Các quyền đề xuất:

```text
integration.misa.view
integration.misa.configure
integration.misa.sync
integration.misa.retry
integration.misa.resolve_conflict
integration.misa.view_logs
```

Nhân viên thường không có quyền cấu hình connector.

---

# 20. Workflow Integration

Workflow engine có action:

```text
MISA_SYNC
```

Ví dụ:

```text
Contract Signed
↓
Create Project
↓
Create Sales Order
↓
Approval
↓
MISA_SYNC(sales_order)
```

Hoặc:

```text
Purchase Order Approved
↓
MISA_SYNC(purchase_order)
```

Chỉ thêm action nào MISA API thực tế hỗ trợ.

---

# 21. Event Integration

Event:

```text
customer.approved
sales_order.approved
purchase_order.approved
invoice.synced
payment.synced
misa.sync.failed
```

Các module khác subscribe:

```text
payment.synced
→ Finance update
→ Sales notification
→ Contract milestone update
```

---

# 22. Scheduled Sync

Ví dụ:

```text
Customer delta sync       mỗi 30 phút
Invoice pull              mỗi 15 phút
Payment pull              mỗi 15 phút
Full reconciliation       mỗi đêm
```

Tần suất thực tế phải điều chỉnh theo:
- giới hạn API
- volume
- nhu cầu công ty

---

# 23. Reconciliation

Cần trang đối soát:

```text
TRAN LE        MISA
-------------------------
Customer       Customer
Order          Order
Receivable     Receivable
Payment        Payment
```

Trạng thái:
- Matched
- Missing local
- Missing remote
- Amount mismatch
- Status mismatch

---

# 24. MISA UI trong Finance

Trong Contract:

```text
MISA
Status: Synced
Remote Code: ...
Last sync: ...
[View Sync History]
```

Trong Customer:

```text
MISA Mapping
✓ Linked

MISA code: KH00123
Last sync: 10:24
```

Trong Finance:

```text
Receivable
Expected (Tran Le): 500,000,000
Official (MISA):    500,000,000
Paid:               300,000,000
Outstanding:        200,000,000
```

---

# 25. Security

Bắt buộc:

- TLS
- Secret encryption
- Token rotation
- Không log credential
- Backend-only connector
- Permission riêng
- Audit mọi thay đổi config
- Rate limit internal integration API
- Mask thông tin nhạy cảm trong log
- Có nút disconnect/revoke

---

# 26. Audit

Audit các hành động:

```text
Admin A cập nhật MISA connection
Finance Manager chạy sync manual
System retry order #SO-102
Admin B resolve conflict Customer #123
```

---

# 27. API nội bộ đề xuất

```text
GET    /api/v1/integrations/misa/status
POST   /api/v1/integrations/misa/connect
POST   /api/v1/integrations/misa/disconnect

GET    /api/v1/integrations/misa/mappings
POST   /api/v1/integrations/misa/mappings

POST   /api/v1/integrations/misa/sync
POST   /api/v1/integrations/misa/retry/:syncItemId

GET    /api/v1/integrations/misa/jobs
GET    /api/v1/integrations/misa/jobs/:id
GET    /api/v1/integrations/misa/errors

GET    /api/v1/integrations/misa/reconciliation
POST   /api/v1/integrations/misa/conflicts/:id/resolve
```

Endpoint thực tế gọi sang MISA phải được bọc trong MisaClient.

---

# 28. Cấu trúc source code đề xuất

```text
server/modules/integration/
├── integration.model
├── integration.service
├── integration.controller
├── integration.routes
│
├── providers/
│   └── misa/
│       ├── misa.client
│       ├── misa.auth
│       ├── misa.mapper
│       ├── misa.service
│       ├── misa.types
│       └── misa.errors
│
├── sync/
│   ├── sync.service
│   ├── sync.queue
│   ├── sync.retry
│   └── reconciliation.service
```

Frontend:

```text
client/modules/integration/
└── misa/
    ├── MisaDashboard
    ├── MisaConnection
    ├── MisaMappings
    ├── MisaSyncJobs
    ├── MisaErrors
    └── MisaReconciliation
```

---

# 29. Lộ trình triển khai MISA

## Phase 1
- Connector
- Authentication
- Connection status
- Logs

## Phase 2
- Customer mapping/sync
- Product mapping/sync

## Phase 3
- Order sync

## Phase 4
- Invoice pull
- Receivable pull

## Phase 5
- Payment pull
- Contract payment reconciliation

## Phase 6
- Conflict handling
- Dashboard
- Scheduled sync
- Workflow integration

---

# 30. Definition of Done

MISA Integration được coi là hoàn thiện khi:

- Credential không xuất hiện ở frontend/log
- Có mapping local ↔ remote
- Không tạo duplicate khi retry
- Có sync log
- Có retry
- Có conflict handling
- Có permission
- Có audit
- Có reconciliation
- Có test mock API
- Có tài liệu mapping field
- Có quy trình disconnect/reconnect
- Có đối chiếu số liệu với Kế toán trước production
