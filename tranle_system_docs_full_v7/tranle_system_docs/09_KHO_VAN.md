# ĐẶC TẢ CHI TIẾT APP KHO VẬN

## 1. Mục tiêu
Quản lý tồn kho có lịch sử đầy đủ, nhiều kho/vị trí, lô/serial, nhập-xuất-điều chuyển-kiểm kê và liên kết Project/Service/Purchasing.

## 2. Nguyên tắc bắt buộc
Không sửa tồn bằng cách update trực tiếp một số `remainingQuantity`.

Mọi biến động phải tạo `stock_move`.

## 3. Menu
```text
KHO VẬN
├── Dashboard
├── Tồn kho
├── Kho
├── Vị trí
├── Lô & Serial
├── Nhập kho
├── Xuất kho
├── Điều chuyển
├── Trả hàng
├── Kiểm kê
└── Báo cáo
```

## 4. Warehouse / Location
Warehouse:
- code
- name
- region
- address
- manager

Location:
- warehouseId
- parentId
- code
- name
- type: internal/supplier/customer/transit/loss

## 5. Product tracking
Product có:
- trackingType: NONE / LOT / SERIAL
- hasExpiry
- costingMethod
- uom
- minStock/maxStock

## 6. Receipt
Nguồn:
- Purchase Order;
- customer return;
- warranty return;
- adjustment.

Status:
`DRAFT → CONFIRMED → RECEIVING → DONE`.

Khi DONE:
- tạo stock_move;
- update projection balance;
- ghi lot/serial;
- event `stock.receipt.done`.

## 7. Issue
Nguồn:
- Project material request;
- Sales Order;
- Warranty replacement;
- internal use.

Status:
`DRAFT → CONFIRMED → RESERVED → PICKING → DONE`.

Rule:
- reserve phải kiểm tra available.
- Serial không được xuất hai lần.
- DONE tạo immutable stock move.

## 8. Transfer
`warehouse/location A → transit(optional) → warehouse/location B`.

Phải hỗ trợ:
- source confirm;
- in transit;
- destination receive;
- partial quantity.

## 9. Stock Count
Quy trình:
1. tạo count;
2. freeze/snapshot expected quantity;
3. người kiểm kê nhập actual;
4. review variance;
5. approve adjustment;
6. sinh stock move tới/từ loss/adjustment location.

Không update tồn trực tiếp.

## 10. Return
- Return to Supplier
- Customer Return
- Project Return
- Warranty Return

Mỗi return phải có reference.

## 11. Serial
Serial page hiển thị:
- product
- current location
- status
- purchase source
- project/customer asset nếu đã bàn giao
- warranty history
- movement history

## 12. Dashboard
Employee:
- Receipt today
- Issue today
- Pending transfer
- Count assigned

Manager:
- Inventory value
- Inventory by warehouse
- Low stock
- Slow moving
- Variance
- In-transit
- Pending receipt/issue

## 13. Rule kỹ thuật
- Transaction + row lock khi reserve/issue.
- Idempotency khi callback/sync.
- Không xóa stock_move DONE.
- Sửa sai bằng reversal/adjustment.

# 14. Dependency / Input / Output / Ownership
## Dependency
Product master; Purchasing; Project; Service; Sales Order.
## Input
PO/return; Project issue request; Warranty replacement request; Transfer/count request.
## Output
Stock availability; Receipt/Issue/Transfer status; Serial movement; Inventory value basis.
## Ownership
Warehouse/Location/Stock Move: Kho vận. Product master là shared master.
