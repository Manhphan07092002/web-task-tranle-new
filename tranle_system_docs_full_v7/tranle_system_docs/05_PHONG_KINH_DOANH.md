# ĐẶC TẢ CHI TIẾT APP PHÒNG KINH DOANH

> Mục đích: tài liệu bàn giao cho BA/Backend/Frontend/QA. Mỗi chức năng dưới đây mô tả rõ người dùng làm gì, hệ thống phải xử lý gì, dữ liệu nào cần lưu và kết quả mong đợi.

## 1. Mục tiêu nghiệp vụ

App Kinh doanh quản lý toàn bộ vòng đời bán hàng từ lúc phát hiện khách hàng tiềm năng đến khi ký hợp đồng, theo dõi triển khai, nghiệm thu, thanh toán và chăm sóc sau bán.

Chuỗi chuẩn:

```text
Lead
→ Qualification
→ Opportunity
→ Technical Request / Survey
→ Technical Solution
→ Quote
→ Negotiation
→ Contract
→ Project
→ Delivery / Acceptance
→ Receivable / Payment
→ After-sales
```

Phải hỗ trợ hai mô hình bán hàng:
1. Kênh phân phối: đại lý/nhà phân phối/cửa hàng/đối tác → đơn hàng → giao hàng → công nợ.
2. Kênh dự án: lead dự án → khảo sát → giải pháp → báo giá → hợp đồng → triển khai → nghiệm thu → thanh toán.

---

## 2. Vai trò sử dụng

### 2.1 Nhân viên Kinh doanh
Được:
- tạo/sửa Lead do mình sở hữu;
- tạo Opportunity;
- tạo yêu cầu kỹ thuật;
- tạo báo giá nháp;
- gửi báo giá xin duyệt;
- tạo hợp đồng nháp;
- xem Project/Technical Request liên quan khách mình phụ trách;
- theo dõi công nợ khách hàng liên quan;
- ghi nhận cuộc gọi, gặp gỡ, email, lịch chăm sóc.

Không được:
- tự duyệt báo giá vượt hạn mức;
- tự duyệt hợp đồng theo quy tắc cần cấp trên;
- xem toàn bộ dữ liệu phòng nếu không được cấp quyền.

### 2.2 Trưởng phòng Kinh doanh
Ngoài quyền nhân viên:
- xem toàn bộ dữ liệu phòng;
- phân công/chuyển owner;
- giao KPI;
- duyệt giá/chiết khấu theo thẩm quyền;
- duyệt báo giá/hợp đồng mức 1;
- xem pipeline, forecast, công nợ, hiệu suất Sales.

### 2.3 Phó Giám đốc/Giám đốc
- xem dữ liệu tổng hợp theo data scope;
- duyệt giao dịch vượt ngưỡng;
- theo dõi khách hàng lớn/hợp đồng lớn;
- xem forecast và cảnh báo rủi ro.

---

## 3. Menu đề xuất

```text
KINH DOANH
├── Tổng quan
│   ├── Dashboard
│   ├── Công việc của tôi
│   └── Việc cần duyệt
├── Khách hàng
│   ├── Khách hàng
│   ├── Liên hệ
│   ├── Đại lý / Nhà phân phối
│   └── Đối tác
├── Bán hàng
│   ├── Lead
│   ├── Opportunity
│   ├── Yêu cầu kỹ thuật
│   ├── Báo giá
│   ├── Hợp đồng
│   └── Đơn hàng
├── Sản phẩm & Giá
│   ├── Sản phẩm
│   ├── Bảng giá
│   └── Chính sách chiết khấu
└── Báo cáo
    ├── Pipeline
    ├── Doanh số
    ├── Conversion
    ├── Forecast
    └── Công nợ
```

---

## 4. Chức năng 01 – Quản lý Lead

### 4.1 Người dùng cần làm gì
- tạo Lead mới;
- nhập thông tin khách;
- chọn nguồn Lead;
- gán người phụ trách;
- ghi nhu cầu ban đầu;
- lên lịch follow-up;
- đánh dấu đủ/không đủ điều kiện;
- chuyển Lead thành Customer/Contact/Opportunity.

### 4.2 Dữ liệu tối thiểu
- code
- name
- customerName
- contactName
- phone
- email
- source
- channel
- interestedProducts
- expectedValue
- province/region
- ownerId
- status
- qualificationStatus
- nextActionAt
- note
- createdBy/createdAt/updatedBy/updatedAt

### 4.3 Trạng thái
```text
NEW
→ CONTACTED
→ QUALIFIED
→ CONVERTED

hoặc

NEW/CONTACTED
→ DISQUALIFIED
```

### 4.4 Rule
- Lead đã CONVERTED không được convert lần hai.
- Phone/email/MST nên được kiểm tra trùng trước khi tạo Customer.
- Chuyển Lead phải chạy transaction.
- Khi owner thay đổi phải ghi audit + notification.

### 4.5 UI
List:
- Code
- Lead
- Công ty
- Nguồn
- Owner
- Giá trị dự kiến
- Status
- Next action

Detail:
- Thông tin
- Hoạt động
- Công việc
- Email
- Tài liệu
- Lịch sử

### 4.6 API gợi ý
- `GET /api/sales/leads`
- `POST /api/sales/leads`
- `GET /api/sales/leads/:id`
- `PATCH /api/sales/leads/:id`
- `POST /api/sales/leads/:id/assign`
- `POST /api/sales/leads/:id/qualify`
- `POST /api/sales/leads/:id/convert`

### 4.7 Acceptance Criteria
- Employee chỉ thấy Lead theo data scope.
- Manager thấy toàn phòng.
- Convert không tạo Customer trùng.
- Convert thành công phải tạo mapping giữa Lead và Customer/Opportunity.
- Audit ghi đủ owner/status thay đổi.

---

## 5. Chức năng 02 – Customer & Contact

### Yêu cầu
- Customer là object dùng chung toàn hệ thống.
- Sales, Finance, Project, Service chỉ tham chiếu cùng Customer.
- Hỗ trợ Customer doanh nghiệp/cá nhân.
- Một Customer có nhiều Contact.
- Có tab toàn cảnh Customer 360.

### Customer 360 phải hiển thị
- thông tin chung;
- Contacts;
- Leads/Opportunities;
- Quotes;
- Contracts;
- Projects;
- Orders;
- Receivable;
- Tickets/Warranty;
- Documents;
- Activity timeline.

### Chống trùng
Ưu tiên:
1. MST;
2. mã khách;
3. phone/email/domain + xác nhận thủ công.

---

## 6. Chức năng 03 – Opportunity

### Người dùng làm gì
- tạo từ Lead hoặc tạo trực tiếp;
- nhập giá trị dự kiến;
- chọn pipeline/stage;
- đặt xác suất;
- tạo Technical Request;
- tạo Quote;
- ghi đối thủ, lý do thắng/thua;
- chuyển WON/LOST.

### Stage đề xuất
```text
DISCOVERY
→ QUALIFIED
→ SURVEY
→ SOLUTION
→ QUOTATION
→ NEGOTIATION
→ WON / LOST
```

### Rule
- WON phải có Customer.
- Có thể yêu cầu Quote approved/Contract draft trước WON tùy cấu hình.
- LOST bắt buộc lý do.
- WON phát event `opportunity.won`.

### Forecast
`Expected Revenue = Opportunity Value × Probability`.

---

## 7. Chức năng 04 – Yêu cầu kỹ thuật từ Sales

### Mục đích
Tạo đầu mối chính thức giữa Sales và Kỹ thuật, không giao việc qua chat rồi mất dấu.

### Sales nhập
- Opportunity
- Customer
- loại yêu cầu;
- địa điểm khảo sát;
- mô tả nhu cầu;
- sản phẩm/hệ thống quan tâm;
- công suất dự kiến nếu có;
- ngày mong muốn khảo sát;
- file/ảnh hiện trạng;
- mức ưu tiên.

### Hệ thống xử lý
- tạo Technical Request;
- gửi notification Trưởng Kỹ thuật;
- trạng thái `NEW`;
- link về Opportunity;
- khi Kỹ thuật hoàn thành, Sales nhận notification và thấy hồ sơ đầu ra.

### Status
```text
NEW
→ ASSIGNED
→ SURVEYING
→ DESIGNING
→ REVIEW
→ COMPLETED
→ RETURNED / CANCELLED
```

---

## 8. Chức năng 05 – Báo giá

### Yêu cầu
- hỗ trợ nhiều version;
- line item;
- bảng giá;
- discount;
- VAT;
- điều khoản;
- template xuất PDF/Word sau này;
- workflow phê duyệt.

### Dữ liệu
Header:
- quoteCode
- opportunityId
- customerId
- contactId
- ownerId
- versionNo
- validFrom/validTo
- currency
- subtotal
- discountAmount
- taxAmount
- total
- status

Line:
- productId
- description
- qty
- uom
- unitPrice
- discountPercent
- taxRate
- lineTotal

### Trạng thái
```text
DRAFT
→ PENDING_APPROVAL
→ APPROVED
→ SENT
→ ACCEPTED / REJECTED / EXPIRED
```

### Quy trình duyệt
- Sales bấm "Gửi duyệt".
- Engine kiểm tra discount/value.
- Trong hạn mức → có thể auto-approve hoặc Manager.
- Vượt mức 1 → Trưởng phòng.
- Vượt mức 2 → Phó GĐ/GĐ.
- Ngưỡng phải cấu hình trong Settings.

### Rule
- Quote đã APPROVED/SENT không sửa trực tiếp; phải tạo revision/version mới.
- Mọi thay đổi giá/discount phải audit.

---

## 9. Chức năng 06 – Hợp đồng

### Người dùng cần
- tạo từ Quote Accepted;
- nhập thông tin pháp lý;
- lưu điều khoản;
- lịch thanh toán;
- bảo hành;
- file hợp đồng/phụ lục;
- workflow duyệt;
- trạng thái ký.

### Payment Milestone
Ví dụ:
- 30% khi ký
- 40% khi giao hàng
- 25% khi nghiệm thu
- 5% sau bảo hành/điều kiện khác

### Status
```text
DRAFT
→ REVIEW
→ PENDING_APPROVAL
→ APPROVED
→ SIGNED
→ ACTIVE
→ COMPLETED / TERMINATED
```

### Event
`contract.signed`:
- có thể tạo Project tự động;
- tạo payment milestones;
- thông báo Dự án/Kỹ thuật/Kế toán.

---

## 10. Chức năng 07 – Sales Order / Kênh phân phối

### Chức năng
- tạo đơn từ Customer/Distributor;
- sản phẩm, số lượng, giá;
- kiểm tra tồn;
- giữ hàng;
- trạng thái giao;
- công nợ;
- đồng bộ MISA nếu bật connector.

### Status
```text
DRAFT
→ APPROVED
→ WAITING_STOCK
→ READY
→ DELIVERED
→ COMPLETED / CANCELLED
```

---

## 11. Chức năng 08 – Sales Activity

Loại:
- Call
- Meeting
- Email
- Visit
- Note
- Follow-up

Mỗi activity có:
- Customer/Lead/Opportunity;
- owner;
- datetime;
- result;
- next action;
- attachment.

Hệ thống phải cảnh báo Opportunity không có activity quá N ngày (N cấu hình).

---

## 12. Dashboard

### Nhân viên
- Doanh số cá nhân / target
- Lead mới
- Lead chưa xử lý
- Opportunity theo stage
- Quote chờ khách
- Follow-up hôm nay
- Công nợ khách phụ trách
- Technical Request đang chờ

### Trưởng phòng
- Revenue / Target
- Pipeline
- Forecast
- Conversion
- Sales ranking
- Lead aging
- Quote approval
- Customer concentration
- Receivable aging

### BGĐ
- Pipeline toàn công ty
- Won/Lost
- Top deal
- Forecast
- Công nợ
- Hợp đồng lớn chờ duyệt

---

## 13. Notification bắt buộc

- Lead được giao
- Lead quá hạn follow-up
- Technical Request hoàn thành
- Quote bị reject/approve
- Quote sắp hết hiệu lực
- Contract chờ duyệt
- Contract signed
- Payment milestone sắp đến hạn
- Receivable quá hạn

---

## 14. Báo cáo bắt buộc

- Lead theo nguồn
- Conversion funnel
- Pipeline theo Sales
- Pipeline theo stage
- Doanh số theo nhân viên/kênh
- Quote win rate
- Lost reason
- Forecast
- Receivable aging
- Customer revenue

---

## 15. Definition of Done cho App Kinh doanh

Dev chỉ coi module hoàn thành khi:
- có permission/data scope;
- CRUD + validation;
- state transition hợp lệ;
- audit;
- notification;
- filter/saved view;
- dashboard;
- workflow approval;
- test quyền Employee/Manager/Executive;
- test duplicate/transaction khi convert;
- liên kết đúng Customer/Technical/Project/Finance.

# 16. Dependency / Input / Output / Ownership
## Dependency
People/Organization; Product; Technical; Workflow; Project; Finance; Document.
## Input
- Kỹ thuật: Survey, Solution, BOM
- Finance: Receivable/Payment status
- Inventory: Stock availability
- Project: progress/acceptance
## Output
- Technical: Technical Request
- Project: Contract/Customer context
- Finance: Contract + Payment Milestones
- Service: Customer/Contract/Asset context
## Ownership
Lead/Opportunity/Quote/Contract: Sales. Customer là shared master.
