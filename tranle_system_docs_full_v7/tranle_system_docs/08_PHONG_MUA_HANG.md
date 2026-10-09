# ĐẶC TẢ CHI TIẾT APP PHÒNG MUA HÀNG

## 1. Mục tiêu
Quản lý từ nhu cầu mua → lấy báo giá → so sánh → phê duyệt → PO/hợp đồng mua → theo dõi giao → Kho nhận → Kế toán thanh toán.

## 2. Menu
```text
MUA HÀNG
├── Dashboard
├── Đề nghị mua hàng
├── RFQ
├── Báo giá NCC
├── So sánh giá
├── Nhà cung cấp
├── Purchase Order
├── Hợp đồng mua
├── Theo dõi giao hàng
└── Báo cáo
```

## 3. Purchase Request (PR)

Nguồn:
- Project;
- Technical;
- Service/Warranty;
- Phòng ban nội bộ;
- Low stock rule sau này.

Field:
- code
- requester
- department
- projectId
- reason
- requiredDate
- priority
- items[]
- estimatedAmount
- status

Status:
```text
DRAFT
→ PENDING_APPROVAL
→ APPROVED
→ SOURCING
→ ORDERED
→ PARTIALLY_RECEIVED
→ COMPLETED
```
Nhánh REJECTED/CANCELLED.

Rule:
- PR dự án phải có Project.
- Trước khi mua, Inventory có thể xác nhận tồn.
- Approval threshold cấu hình.

## 4. RFQ
Mua hàng:
- chọn PR/item;
- chọn nhiều Supplier;
- gửi RFQ;
- ghi deadline nhận giá;
- lưu file/email.

Status:
`DRAFT → SENT → RESPONDED → CLOSED`.

## 5. Supplier Quotation
Lưu:
- supplier
- quoteNo
- quoteDate
- validUntil
- items
- price
- VAT
- deliveryTime
- paymentTerm
- warranty
- attachment

## 6. Price Comparison
UI dạng bảng so sánh:
- giá;
- tổng;
- thời gian giao;
- bảo hành;
- thanh toán;
- lịch sử NCC;
- đánh giá.

Người dùng chọn Recommended Supplier và lý do.

## 7. Supplier
Customer riêng không dùng chung; Supplier là master chung cho Purchasing/Finance/Inventory.

Field:
- supplierCode
- name
- taxCode
- contact
- bank
- paymentTerms
- productGroups
- rating
- status

## 8. Purchase Order
Tạo từ approved comparison/PR.

Status:
```text
DRAFT
→ PENDING_APPROVAL
→ APPROVED
→ SENT
→ PARTIAL_RECEIPT
→ RECEIVED
→ CLOSED
```

Rule:
- Không tự chuyển RECEIVED; phải nhận dữ liệu Receipt từ Inventory.
- PO thay đổi giá/qty sau approval cần re-approval hoặc amendment.
- PO phải liên kết PR.

## 9. Theo dõi giao hàng
- expectedDeliveryDate
- actualDeliveryDate
- shipment status
- tracking
- note
- delayed reason

Cảnh báo PO giao trễ.

## 10. Supplier Evaluation
Chỉ số:
- price competitiveness
- on-time delivery
- quality
- warranty response
- payment terms

## 11. Dashboard
Employee:
- PR assigned
- RFQ deadline
- Quotes received
- PO pending
- Delivery delayed

Manager:
- Purchase value
- PR aging
- Supplier performance
- Price variance
- PO delay
- Spend by supplier/category

## 12. Tích hợp
- Project: nhận demand.
- Inventory: receipt.
- Finance: AP/payment.
- MISA: PO/Invoice nếu API thực tế hỗ trợ.

# 13. Dependency / Input / Output / Ownership
## Dependency
Project/Departments; Inventory; Supplier master; Finance; Workflow.
## Input
Purchase Request; Material shortage; Approved budget/policy.
## Output
PO; Delivery plan; Supplier data; Receipt reference; AP source.
## Ownership
Supplier master, RFQ, Comparison, PO: Mua hàng.
