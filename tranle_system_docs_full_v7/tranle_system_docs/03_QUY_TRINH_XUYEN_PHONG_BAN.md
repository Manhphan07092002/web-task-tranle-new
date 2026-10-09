# QUY TRÌNH XUYÊN PHÒNG BAN

## 1. Lead → Contract → Project → Service

```text
Lead
↓
Opportunity
↓
Technical Request
↓
Survey
↓
Technical Solution + BOM
↓
Quotation
↓
Approval
↓
Contract
↓
Project
↓
Material Request
↓
Purchase / Warehouse
↓
Implementation
↓
Acceptance
↓
Handover
↓
Receivable / Payment
↓
Warranty / Maintenance
```

## 2. Sales ↔ Technical

Sales tạo Technical Request.

Technical:
1. Nhận yêu cầu
2. Phân công
3. Khảo sát
4. Tính toán
5. Thiết kế
6. BOM
7. Upload hồ sơ
8. Trưởng kỹ thuật review
9. Trả kết quả cho Sales

Sales:
1. Nhận kết quả
2. Lập báo giá
3. Xin duyệt nếu cần
4. Gửi khách
5. Đàm phán
6. Won/Lost

## 3. Contract → Project

Khi Contract chuyển `SIGNED`:
- Tạo Project
- Gắn Customer
- Gắn Contract
- Gán Sales Owner
- Gán Technical Owner
- Gán Project Manager
- Sinh milestone/template task mặc định

## 4. Project → Purchasing / Inventory

Khi có nhu cầu vật tư:
- Project tạo Material Request
- Kho kiểm tra tồn
- Đủ tồn → reserve / issue
- Thiếu → Purchase Request
- Mua hàng → RFQ → PO
- Hàng về → Receipt
- Kho cập nhật tồn
- Project nhận vật tư

## 5. Acceptance → Finance

Khi nghiệm thu đạt:
- Hoàn tất milestone
- Sinh điều kiện thanh toán tương ứng
- Kế toán nhận thông báo
- Theo dõi công nợ
- Ghi nhận thanh toán

## 6. Handover → Customer Asset

Sau bàn giao:
- Tạo Installed Asset
- Gắn serial
- Gắn ngày lắp
- Gắn warranty start/end
- Gắn Project/Contract
- Cho phép mở Ticket từ Asset

## 7. Ticket / Warranty

```text
Open
↓
Assigned
↓
Diagnosing
↓
Waiting Part / Waiting Vendor
↓
Resolved
↓
Closed
```

Có SLA, lịch sử xử lý, vật tư thay thế, NCC/hãng liên quan.
