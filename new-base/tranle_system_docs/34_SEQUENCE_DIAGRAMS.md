# SEQUENCE DIAGRAMS – CÁC LUỒNG NGHIỆP VỤ CHÍNH

## 1. Lead → Opportunity

```mermaid
sequenceDiagram
    actor Sales
    participant UI
    participant API
    participant LeadService
    participant CustomerService
    participant OpportunityService
    participant Audit
    participant EventBus

    Sales->>UI: Chọn Convert Lead
    UI->>API: POST /leads/:id/convert
    API->>LeadService: validate + lock lead
    LeadService->>CustomerService: find/create customer
    CustomerService-->>LeadService: customerId
    LeadService->>OpportunityService: create opportunity
    OpportunityService-->>LeadService: opportunityId
    LeadService->>LeadService: mark CONVERTED
    LeadService->>Audit: ghi lịch sử
    LeadService->>EventBus: lead.converted
    API-->>UI: Customer + Opportunity
```

Yêu cầu:
- transaction;
- chống convert hai lần;
- chống Customer trùng;
- audit.

---

## 2. Opportunity → Technical Request

```mermaid
sequenceDiagram
    actor Sales
    participant SalesUI
    participant SalesAPI
    participant TechnicalService
    participant Notification

    Sales->>SalesUI: Tạo yêu cầu kỹ thuật
    SalesUI->>SalesAPI: submit request
    SalesAPI->>TechnicalService: create TechnicalRequest
    TechnicalService->>TechnicalService: status=NEW
    TechnicalService->>Notification: notify Technical Manager
    TechnicalService-->>SalesAPI: requestId
    SalesAPI-->>SalesUI: success
```

---

## 3. Quote Approval

```mermaid
sequenceDiagram
    actor Sales
    participant UI
    participant QuoteAPI
    participant QuoteService
    participant Workflow
    participant Approver
    participant Audit

    Sales->>UI: Gửi duyệt Quote
    UI->>QuoteAPI: POST /quotes/:id/submit
    QuoteAPI->>QuoteService: validate quote
    QuoteService->>Workflow: start quote approval
    Workflow->>Workflow: resolve approval policy
    Workflow-->>Approver: tạo approval task
    Approver->>Workflow: approve/reject
    Workflow->>QuoteService: update decision
    QuoteService->>Audit: record status
```

---

## 4. Contract Signed → Create Project

```mermaid
sequenceDiagram
    actor Sales
    participant ContractAPI
    participant ContractService
    participant EventBus
    participant ProjectService
    participant FinanceService
    participant Notification

    Sales->>ContractAPI: Mark Signed
    ContractAPI->>ContractService: validate
    ContractService->>ContractService: SIGNED + ghi outbox_events(contract.signed) cùng transaction
    Note over ContractService,EventBus: Worker đọc outbox, consumer idempotent theo event_id
    EventBus->>ProjectService: create project(s) theo project_split_mode (idempotent contract_id + site_key)
    ProjectService->>ProjectService: copy customer/contract/owners
    EventBus->>FinanceService: create payment milestones/expected AR (idempotent)
    ProjectService->>Notification: notify PM/Technical
```

---

## 5. Material Request → Kho/Mua hàng

```mermaid
sequenceDiagram
    actor PM
    participant ProjectUI
    participant ProjectAPI
    participant InventoryService
    participant PurchasingService

    PM->>ProjectUI: Gửi Material Request
    ProjectUI->>ProjectAPI: create request
    ProjectAPI->>InventoryService: check availability

    alt Đủ tồn
        InventoryService->>InventoryService: reserve
        InventoryService-->>ProjectAPI: RESERVED
    else Thiếu hàng
        InventoryService-->>ProjectAPI: shortage
        ProjectAPI->>PurchasingService: create Purchase Request
        PurchasingService-->>ProjectAPI: PR id
    end
```

---

## 6. Purchase Order → Receipt

```mermaid
sequenceDiagram
    actor Buyer
    participant Purchasing
    participant Warehouse
    participant StockLedger
    participant Finance

    Buyer->>Purchasing: PO approved/sent
    Purchasing-->>Warehouse: Expected receipt
    Warehouse->>Warehouse: Receive actual qty/serial
    Warehouse->>StockLedger: create stock moves
    StockLedger-->>Warehouse: done
    Warehouse-->>Purchasing: receipt.done
    Purchasing->>Purchasing: PO PARTIAL/RECEIVED
    Warehouse-->>Finance: receipt reference
```

---

## 7. Project Acceptance → Receivable

```mermaid
sequenceDiagram
    actor PM
    participant Project
    participant Workflow
    participant Finance
    participant Notification

    PM->>Project: Submit Acceptance
    Project->>Workflow: review/approval
    Workflow-->>Project: ACCEPTED
    Project->>Finance: activate payment milestone
    Finance->>Finance: create/update receivable
    Finance->>Notification: notify Finance + Sales
```

---

## 8. Handover → Customer Asset

```mermaid
sequenceDiagram
    actor PM
    participant Project
    participant Inventory
    participant AssetService
    participant Service

    PM->>Project: Complete Handover
    Project->>Inventory: fetch issued serials
    Inventory-->>Project: serial list
    Project->>AssetService: create customer assets
    AssetService->>AssetService: warranty start/end
    AssetService-->>Service: assets available for Ticket/Maintenance
```

---

## 9. Warranty Ticket → Replacement

```mermaid
sequenceDiagram
    actor Engineer
    participant Service
    participant AssetService
    participant Inventory
    participant Purchasing

    Engineer->>Service: diagnose ticket
    Service->>AssetService: check warranty
    AssetService-->>Service: IN/OUT warranty

    alt Có linh kiện tồn
        Service->>Inventory: replacement request
        Inventory->>Inventory: reserve + issue serial
        Inventory-->>Service: replacement serial
    else Không có hàng
        Service->>Purchasing: create PR
        Purchasing-->>Service: procurement status
    end

    Service->>AssetService: update old/new serial history
```

---

## 10. MISA Sync

```mermaid
sequenceDiagram
    participant Domain
    participant EventBus
    participant IntegrationHub
    participant MisaConnector
    participant MISA
    participant SyncLog

    Domain->>EventBus: entity.approved
    EventBus->>IntegrationHub: enqueue sync
    IntegrationHub->>MisaConnector: map payload
    MisaConnector->>MISA: API request
    MISA-->>MisaConnector: response
    MisaConnector->>SyncLog: success/failure + remoteId
    MisaConnector-->>IntegrationHub: result
```

Retry:
- chỉ retry lỗi phù hợp;
- chống duplicate bằng mapping/idempotency.

## 11. Outbox và xử lý sự kiện (ADR-006)

```mermaid
sequenceDiagram
    participant Service as Domain Service
    participant DB as MySQL
    participant Worker
    participant Handler as Handler / Workflow

    Service->>DB: BEGIN; cập nhật nghiệp vụ; INSERT outbox_events; COMMIT
    loop poll
        Worker->>DB: SELECT ... FOR UPDATE SKIP LOCKED (outbox chưa xử lý)
        Worker->>Handler: dispatch(event_id, payload)
        alt thành công
            Handler-->>Worker: ok
            Worker->>DB: processed_at = now
        else lỗi
            Handler-->>Worker: error
            Worker->>DB: attempts+1, run_at = backoff; quá max_attempts -> FAILED + cảnh báo
        end
    end
```

Quy ước: ràng buộc nhất quán (tạo Project khi SIGNED) là handler đăng ký sẵn trong code; phản ứng tùy biến (gửi thông báo, tạo task mẫu) chạy qua Workflow. Cả hai nhận cùng sự kiện từ outbox.

## 12. Phê duyệt dùng chung (Approval Engine, Phase 3)

```mermaid
sequenceDiagram
    actor Requester
    participant API
    participant Policy as approval_policies
    participant Engine as Approval Engine
    actor Approver

    Requester->>API: submit(Quote | Contract | PaymentRequest | ...)
    API->>Policy: tìm policy khớp (process_key, điều kiện)
    Policy-->>API: chuỗi level1..levelN
    API->>Engine: tạo approvals (PENDING), chứng từ -> PENDING_APPROVAL
    Engine->>Approver: notify cấp hiện tại
    Approver->>Engine: approve/reject + comment
    Engine->>Engine: còn cấp sau? -> chuyển cấp, hết cấp -> APPROVED
```
