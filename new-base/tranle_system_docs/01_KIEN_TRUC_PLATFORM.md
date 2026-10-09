# KIẾN TRÚC PLATFORM TRAN LE

## 1. Mục tiêu kiến trúc

Tổ chức hệ thống theo tư duy platform, không xây các app tách biệt hoàn toàn.

```text
                TRAN LE PLATFORM
                       │
       ┌───────────────┼────────────────┐
       │               │                │
   Organization      Security        Metadata
       │               │                │
       └──────────┬────┴────┬───────────┘
                  │         │
              Workflow    Event
                  │
 ┌─────────┬──────┼───────┬──────────┬─────────┐
 Sales   Project Technical Service Inventory  Finance
                  │
              Integration
                  │
                 MISA
```

## 2. Phân lớp

### Core
- Auth
- User
- Employee
- Department
- Position
- Role
- Permission
- Data Scope
- Audit
- Notification

### Platform
- Task
- Workflow
- Approval
- Dashboard
- Saved View
- Dynamic Filter
- Document
- Integration

### Business Apps
- Sales
- Project
- Technical
- Service
- Purchasing
- Inventory
- Finance
- HR
- Marketing

## 3. Quy tắc dữ liệu dùng chung

Không tạo:
- `sales_customers`
- `finance_customers`
- `service_customers`

Chỉ tạo:
- `customers`

Các app chỉ tham chiếu đến object dùng chung.

## 4. Related Entity

Task, Document, Comment, Activity có thể gắn với nhiều loại nghiệp vụ.

Ví dụ:
- Task → Opportunity
- Task → Contract
- Task → Project
- Task → Ticket
- Document → Customer
- Document → Project
- Document → Contract

Khuyến nghị bảng quan hệ riêng thay vì hard-code quá nhiều foreign key.

## 5. Event đề xuất

- `lead.created`
- `lead.assigned`
- `opportunity.won`
- `technical_request.created`
- `quote.approved`
- `contract.signed`
- `project.created`
- `purchase_request.approved`
- `stock.receipt.done`
- `stock.issue.done`
- `ticket.created`
- `ticket.closed`
- `payment.received`

## 6. Nguyên tắc kỹ thuật

- API kiểm tra quyền tại backend.
- Filter dùng whitelist field/operator.
- Không cho AI sinh SQL chạy trực tiếp.
- Audit log bất biến.
- Workflow instance ghim version.
- External action dùng retry + idempotency.
- Tiền và kho ưu tiên ledger/history thay vì update số dư trực tiếp.
