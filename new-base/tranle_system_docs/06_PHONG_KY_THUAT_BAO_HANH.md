# ĐẶC TẢ CHI TIẾT APP PHÒNG KỸ THUẬT - BẢO HÀNH

## 1. Mục tiêu

Quản lý xuyên suốt nghiệp vụ:
- hỗ trợ Sales trước bán hàng;
- khảo sát;
- tính toán/thiết kế;
- BOM/bản vẽ;
- hỗ trợ triển khai;
- nghiệm thu/bàn giao;
- vận hành;
- bảo trì;
- sự cố;
- bảo hành;
- thiết bị khách hàng.

---

## 2. Menu

```text
KỸ THUẬT - BẢO HÀNH
├── Tổng quan
│   ├── Dashboard
│   ├── Công việc
│   └── SLA
├── Khảo sát & Thiết kế
│   ├── Yêu cầu kỹ thuật
│   ├── Lịch khảo sát
│   ├── Biên bản khảo sát
│   ├── Giải pháp kỹ thuật
│   ├── BOM
│   └── Bản vẽ
├── Dịch vụ
│   ├── Ticket
│   ├── Sự cố
│   ├── Bảo hành
│   ├── Bảo trì
│   └── Sửa chữa
├── Thiết bị khách hàng
│   ├── Asset
│   ├── Serial
│   └── Lịch sử dịch vụ
└── Báo cáo
    ├── SLA
    ├── Sự cố
    ├── Bảo hành
    └── Hiệu suất kỹ thuật
```

---

## 3. Vai trò

### Kỹ thuật viên
- nhận Technical Request;
- cập nhật khảo sát;
- tạo BOM/drawing;
- cập nhật task dự án;
- xử lý Ticket;
- ghi linh kiện thay thế;
- hoàn tất maintenance checklist.

### Trưởng phòng
- xem toàn phòng;
- phân công;
- review thiết kế/BOM;
- điều phối workload;
- theo dõi SLA;
- duyệt kết quả kỹ thuật theo rule.

### BGĐ
- xem dashboard/cảnh báo;
- xem sự cố lớn;
- xem tình trạng bảo hành/dự án quan trọng.

---

## 4. Technical Request

### Input
- source: Sales/Project/Service/Internal
- relatedId
- customerId
- siteAddress
- requestType
- requirement
- priority
- requestedDate
- dueDate
- attachments

### Process
```text
NEW
→ ASSIGNED
→ SURVEYING
→ DESIGNING
→ REVIEW
→ COMPLETED
```

Nhánh:
- `RETURNED`: thiếu thông tin/cần làm lại;
- `CANCELLED`.

### System action
- NEW → notify manager.
- ASSIGNED → notify engineer.
- dueDate gần đến → reminder.
- COMPLETED → notify requester.

---

## 5. Survey

### Kỹ thuật cần nhập
- ngày/giờ;
- người khảo sát;
- người phía khách hàng;
- địa chỉ/toạ độ nếu được nhập thủ công;
- mô tả hiện trạng;
- tải điện/năng lực hệ thống;
- hạ tầng hiện hữu;
- hình ảnh;
- rủi ro;
- constraint;
- đề xuất ban đầu.

### Đầu ra
- Survey Report;
- ảnh;
- checklist;
- status;
- chữ ký/xác nhận nếu quy trình yêu cầu.

### Rule
Không được đánh dấu khảo sát `COMPLETED` nếu thiếu các field bắt buộc theo request type.

---

## 6. Technical Solution / Design

Thông tin:
- designVersion;
- relatedTechnicalRequest;
- solutionSummary;
- calculation;
- selectedEquipment;
- capacity;
- assumptions;
- constraints;
- estimatedMaterial;
- note.

Status:
```text
DRAFT → REVIEW → APPROVED
```

Khi review reject phải có comment.

---

## 7. BOM

Header:
- bomCode
- project/opportunity
- version
- status
- createdBy
- reviewedBy

Line:
- product
- description
- quantity
- uom
- wastePercent
- alternativeProduct
- note

Rule:
- Approved BOM không sửa trực tiếp; tạo version.
- Project Material Request có thể lấy dữ liệu từ Approved BOM.

---

## 8. Drawing / Technical Document

- loại bản vẽ;
- revision;
- file;
- trạng thái;
- người thiết kế;
- người review;
- ngày duyệt;
- project/technical request liên quan.

Không overwrite revision cũ.

---

## 9. Ticket Service

### Nguồn Ticket
- Sales tạo;
- Customer service nhập;
- Kỹ thuật tạo;
- Project tạo;
- sau này có thể từ Omni Channel.

### Field
- ticketCode
- customerId
- contactId
- contractId
- projectId
- assetId
- type
- category
- priority
- description
- assigneeId
- status
- slaDueAt
- rootCause
- resolution
- closedAt

### Type
- warranty
- incident
- support
- maintenance
- repair

### Status
```text
OPEN
→ ASSIGNED
→ DIAGNOSING
→ IN_PROGRESS
→ WAITING_PART / WAITING_VENDOR / WAITING_CUSTOMER
→ RESOLVED
→ CLOSED
```

Reopen:
`RESOLVED/CLOSED → REOPENED` theo quyền.

### Rule
- Close phải có resolution.
- Warranty ticket phải kiểm tra Asset/warranty.
- Ticket quá SLA phải cảnh báo.
- Waiting status cần reason.

---

## 10. Warranty

### Khi mở yêu cầu
Hệ thống kiểm tra:
- Asset;
- serial;
- ngày lắp;
- warrantyStart;
- warrantyEnd;
- contract warranty;
- lịch sử sửa trước đó.

Kết quả:
- `IN_WARRANTY`
- `OUT_OF_WARRANTY`
- `REQUIRES_REVIEW`

### Xử lý thay thế
- tạo yêu cầu xuất kho;
- chọn replacement serial;
- ghi old/new serial;
- ghi nguyên nhân;
- nếu gửi hãng: lưu vendor/RMA/reference.

---

## 11. Maintenance

### Maintenance Plan
- asset/customer/project;
- frequency;
- nextDueDate;
- checklistTemplate;
- assignee/team.

### Khi đến hạn
- tự tạo maintenance task/ticket;
- notify kỹ thuật;
- sau hoàn tất cập nhật `lastMaintenanceAt`, `nextDueDate`.

### Checklist
Ví dụ:
- kiểm tra tình trạng;
- vệ sinh;
- điện áp/dòng;
- lỗi cảnh báo;
- ảnh trước/sau;
- đề xuất sửa chữa.

---

## 12. Customer Asset

Đây là object cực kỳ quan trọng.

Field:
- assetCode
- customerId
- contractId
- projectId
- productId
- serialNo
- model
- installedAt
- location
- warrantyStart
- warrantyEnd
- status
- manufacturer
- supplier
- note

Tab:
- Overview
- Tickets
- Maintenance
- Warranty
- Replacement
- Documents
- History

---

## 12A. Thiết bị đo kiểm và hiệu chuẩn

- Thiết bị đo kiểm (đồng hồ, máy đo, thiết bị phân tích) được quản lý như `compliance_items` loại `CALIBRATION` (xem `40_BO_SUNG_NGHIEP_VU.md` §3).
- Thiết bị quá hạn hiệu chuẩn không được gán vào checklist bảo trì hoặc nghiệm thu (cảnh báo hoặc chặn theo cấu hình, BR-COMP-002).
- Mỗi lần gán thiết bị vào kết quả đo phải lưu `compliance_item_id` để truy vết sau này.

## 13. SLA

SLA dùng cấu hình nền tảng:
- priority;
- response time;
- resolve time;
- business calendar;
- pause condition khi WAITING_CUSTOMER/VENDOR nếu cấu hình.

Ví dụ:
- Critical: response 30m, resolve 4h
- High: response 1h, resolve 8h
- Normal: response 4h, resolve 24h

Không hard-code số này.

---

## 14. Dashboard

### Kỹ thuật viên
- Request được giao
- Survey hôm nay
- Task project
- Ticket đang xử lý
- Ticket gần SLA
- Maintenance đến hạn

### Trưởng phòng
- Workload
- Technical Request aging
- Ticket open
- Ticket overdue SLA
- MTTR
- Failure by product
- Failure by manufacturer
- Warranty cost nếu có dữ liệu
- Maintenance compliance
- Project technical delay

---

## 15. Notification

- Technical Request mới
- Request được giao
- Survey sắp đến lịch
- Request quá hạn
- Design/BOM bị trả lại
- Ticket mới
- Ticket gần/quá SLA
- Warranty hết hạn gần
- Maintenance đến hạn
- Part replacement ready

---

## 16. API gợi ý

- `/api/v1/technical/requests`
- `/api/v1/technical/surveys`
- `/api/v1/technical/solutions`
- `/api/v1/technical/boms`
- `/api/v1/technical/drawings`
- `/api/v1/service/tickets`
- `/api/v1/service/assets`
- `/api/v1/service/maintenance`

---

## 17. Definition of Done

- Có workflow/status chặt chẽ.
- Có audit.
- Có document version.
- Ticket có SLA.
- Asset có serial/warranty.
- Replacement nối Inventory.
- Request nối Sales/Project.
- Dashboard theo role.
- Test quyền và transition.

# 18. Dependency / Input / Output / Ownership
## Dependency
Sales; Project; Product; Inventory; Purchasing; Workflow; Document.
## Input
- Sales: Technical Request
- Project: technical task/material need
- Inventory: stock/serial
- Purchasing: vendor/part status
## Output
- Sales: Survey/Solution/BOM
- Project: approved technical documents
- Inventory: replacement/material request
## Ownership
Technical Request sau assign, Survey, BOM, Ticket, Customer Asset: Technical/Service.
