# ERD VÀ RELATIONSHIP – TRAN LE PLATFORM

## 1. Mục tiêu

Tài liệu này mô tả quan hệ dữ liệu giữa các module để Backend/DB Dev không phải tự suy đoán quan hệ, cardinality và ownership.

Nguyên tắc:
- Object lõi dùng chung giữa các app.
- Không nhân bản Customer/Product/Employee theo từng phòng.
- Quan hệ nghiệp vụ quan trọng phải có FK hoặc relation rõ ràng.
- Các quan hệ đa hình chỉ dùng khi thật sự cần.
- Các record tài chính/kho/trạng thái quan trọng phải có lịch sử/audit.

---

# 2. ERD tổng thể mức cao

```text
Employee ──< Task >── Project
   │                    │
   │                    ├──< Milestone
   │                    ├──< Issue
   │                    ├──< Material Request
   │                    └──< Acceptance
   │
Department
   │
   └──< Employee

Customer ──< Contact
   │
   ├──< Lead
   │
   ├──< Opportunity ──< Quote ──< QuoteLine
   │        │              │
   │        │              └────► Contract
   │        │
   │        └──< TechnicalRequest ──< Survey
   │                               ├──< BOM ──< BOMLine
   │                               └──< Drawing
   │
   ├──< Contract ──< ContractPayment
   │        │
   │        └────► Project
   │
   ├──< CustomerAsset ──< Ticket
   │        │               │
   │        │               └──< TicketEvent
   │        └──< MaintenancePlan
   │
   └──< Receivable

Supplier ──< PurchaseOrder ──< Receipt
    │             │
    │             └──< PurchaseOrderLine
    └──< SupplierQuote

PurchaseRequest ──< PurchaseRequestLine
       │
       └──► RFQ ──< SupplierQuote

Warehouse ──< Location
Location ──< StockMove >── Location
Product  ──< StockMove
Product  ──< Serial
Product  ──< Lot

Workflow ──< WorkflowVersion ──< WorkflowRun ──< Approval
```

---

# 3. Organization

## 3.1 Department – Employee

```text
Department 1 ── N Employee
```

- `employees.department_id -> departments.id`
- Một nhân viên tại một thời điểm có một phòng chính.
- Nếu cần lịch sử điều chuyển phòng sau này, thêm bảng `employee_department_history`.

## 3.2 Position – Employee

```text
Position 1 ── N Employee
```

- `employees.position_id -> positions.id`

## 3.3 Employee – Direct Manager

```text
Employee 1 ── N Employee
```

Self-reference:
- `employees.direct_manager_id -> employees.id`

Không dùng tên trưởng phòng hard-code trong workflow.

---

# 4. CRM

## 4.1 Customer – Contact

```text
Customer 1 ── N Contact
```

- Một Customer có nhiều Contact.
- Một Contact thuộc một Customer chính.
- Nếu sau này Contact có thể thuộc nhiều công ty, cần thiết kế join table riêng.

## 4.2 Lead – Customer/Opportunity

Lead trước convert có thể chưa có Customer.

Sau convert:

```text
Lead 1 ── 0..1 Customer
Lead 1 ── 0..1 Opportunity
```

Fields:
- `converted_customer_id`
- `converted_opportunity_id`

## 4.3 Customer – Opportunity

```text
Customer 1 ── N Opportunity
```

## 4.4 Opportunity – Quote

```text
Opportunity 1 ── N Quote
```

Vì Quote có version/revision và nhiều lần gửi.

## 4.5 Quote – QuoteLine

```text
Quote 1 ── N QuoteLine
```

## 4.6 Quote – Contract

```text
Quote 1 ── 0..N Contract
```

Khuyến nghị thực tế:
- bình thường 1 Accepted Quote → 1 Contract;
- nhưng dữ liệu không nên khóa quá cứng nếu doanh nghiệp có phụ lục/hợp đồng tách.

---

# 5. Technical

## 5.1 Opportunity – TechnicalRequest

```text
Opportunity 1 ── N TechnicalRequest
```

Cho phép nhiều lần khảo sát/chỉnh giải pháp.

## 5.2 TechnicalRequest – Survey

```text
TechnicalRequest 1 ── N Survey
```

Có thể khảo sát lại.

## 5.3 TechnicalRequest – BOM

```text
TechnicalRequest 1 ── N BOM
```

Do BOM có version.

## 5.4 BOM – BOMLine

```text
BOM 1 ── N BOMLine
```

## 5.5 TechnicalRequest – Drawing

```text
TechnicalRequest 1 ── N Drawing
```

Drawing có revision.

---

# 6. Contract / Project

## 6.1 Contract – ContractPayment

```text
Contract 1 ── N ContractPayment
```

## 6.2 Contract – Project

```text
Contract 1 ── 0..N Project
```

Không nên ép cứng 1:1 vì một hợp đồng có thể có nhiều site/dự án.

## 6.3 Project – Milestone

```text
Project 1 ── N Milestone
```

## 6.4 Project – Task

```text
Project 1 ── N Task
```

## 6.5 Epic – Task

```text
Epic 1 ── N Task
```

## 6.6 Task – Subtask

```text
Task 1 ── N Task
```

Self-reference bằng `parent_task_id`.

## 6.7 Project – MaterialRequest

```text
Project 1 ── N MaterialRequest
```

## 6.8 Project – Acceptance

```text
Project 1 ── N Acceptance
```

Có thể nghiệm thu theo giai đoạn.

---

# 7. Purchasing

## 7.1 PurchaseRequest – Line

```text
PurchaseRequest 1 ── N PurchaseRequestLine
```

## 7.2 PurchaseRequest – RFQ

```text
PurchaseRequest 1 ── N RFQ
```

Có thể tách nhiều RFQ.

## 7.3 RFQ – SupplierQuote

```text
RFQ 1 ── N SupplierQuote
```

## 7.4 Supplier – SupplierQuote

```text
Supplier 1 ── N SupplierQuote
```

## 7.5 PurchaseRequest – PurchaseOrder

```text
PurchaseRequest 1 ── N PurchaseOrder
```

Hỗ trợ một PR chia nhiều NCC.

## 7.6 PurchaseOrder – Receipt

```text
PurchaseOrder 1 ── N Receipt
```

Hỗ trợ partial receipt.

---

# 8. Inventory

## 8.1 Warehouse – Location

```text
Warehouse 1 ── N Location
```

Location có self-reference để tạo cây.

## 8.2 Product – Lot

```text
Product 1 ── N Lot
```

## 8.3 Product – Serial

```text
Product 1 ── N Serial
```

## 8.4 Transfer – StockMove

```text
Transfer 1 ── N StockMove
```

## 8.5 Location – StockMove

Mỗi StockMove có:
- `from_location_id`
- `to_location_id`

## 8.6 Product – StockMove

```text
Product 1 ── N StockMove
```

## 8.7 Serial – CustomerAsset

Khi thiết bị serial được bàn giao:

```text
Serial 1 ── 0..1 CustomerAsset
```

Tùy loại sản phẩm có thể không cần serial.

---

# 9. Service / Warranty

## 9.1 Customer – CustomerAsset

```text
Customer 1 ── N CustomerAsset
```

## 9.2 Project – CustomerAsset

```text
Project 1 ── N CustomerAsset
```

## 9.3 CustomerAsset – Ticket

```text
CustomerAsset 1 ── N Ticket
```

Ticket không bắt buộc asset nếu lỗi chưa xác định.

## 9.4 Ticket – TicketEvent

```text
Ticket 1 ── N TicketEvent
```

TicketEvent lưu timeline nghiệp vụ.

## 9.5 CustomerAsset – MaintenancePlan

```text
CustomerAsset 1 ── N MaintenancePlan
```

---

# 10. Finance

## 10.1 ContractPayment – Receivable

```text
ContractPayment 1 ── 0..N Receivable
```

Nếu một milestone phát sinh nhiều chứng từ.

## 10.2 Customer – Receivable

```text
Customer 1 ── N Receivable
```

## 10.3 Supplier – Payable

```text
Supplier 1 ── N Payable
```

## 10.4 PaymentRequest – Payment

```text
PaymentRequest 1 ── 0..N Payment
```

---

# 11. Workflow

## 11.1 Workflow – Version

```text
Workflow 1 ── N WorkflowVersion
```

## 11.2 WorkflowVersion – Run

```text
WorkflowVersion 1 ── N WorkflowRun
```

Run phải ghim đúng version.

## 11.3 WorkflowRun – Approval

```text
WorkflowRun 1 ── N Approval
```

---

# 12. Generic Relations

Các object dùng chung như:
- Task
- Document
- Comment
- Activity

có thể cần liên kết đa loại.

Khuyến nghị dùng join table:

```text
entity_relations
- id
- source_type
- source_id
- target_type
- target_id
- relation_type
```

Không dùng relation đa hình cho dữ liệu cần FK chặt như Contract → Customer.

---

# 13. Ownership dữ liệu

| Object | Owner |
|---|---|
| Customer | Shared Master |
| Contact | Sales/Shared |
| Lead | Sales |
| Opportunity | Sales |
| Quote | Sales |
| Contract | Sales |
| TechnicalRequest | Technical |
| Survey | Technical |
| BOM | Technical |
| Project | Project |
| PurchaseOrder | Purchasing |
| StockMove | Warehouse |
| Ticket | Technical/Service |
| CustomerAsset | Technical/Service |
| Receivable/Payable | Finance |
| Employee/Department | HR |
| Workflow | Admin/Platform |
