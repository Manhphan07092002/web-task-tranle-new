# MASTER DATA & CONFIGURATION CATALOG

## 1. Mục tiêu

Những danh mục dưới đây không nên hard-code rải rác trong frontend/backend. Cần xác định loại nào:
- system enum cố định;
- configurable lookup;
- master data;
- approval policy;
- workflow config.

---

# 2. Organization

## Departments
Seed chính thức:
1. Ban Giám Đốc
2. Phòng Kế Toán
3. Phòng Hành chính - Nhân sự
4. Phòng Kinh Doanh
5. Phòng Dự Án
6. Phòng Kỹ Thuật - Bảo Hành
7. Phòng Marketing
8. Kho vận
9. Mua hàng

Lưu ý (ADR-016, **MỞ**): chưa có chỗ cho bộ phận IT và Product. Phương án tạm: nhân sự IT gắn Phòng HCNS, Product gắn Phòng Kinh doanh, chờ BGĐ quyết.

## Position
Configurable.

## Management Level
System enum:
- EMPLOYEE
- DEPARTMENT_MANAGER
- DEPUTY_DIRECTOR
- DIRECTOR

---

# 3. Sales Master Data

## Lead Source
Configurable lookup:
- Website
- Facebook
- Zalo
- Referral
- Partner
- Event
- Direct
- Other

Không cho nhập free text mặc định.

## Lead Status (vòng đời)
- NEW
- CONTACTED
- CONVERTED
- CLOSED

## Lead Qualification (kết quả đánh giá)
- UNQUALIFIED
- QUALIFIED
- DISQUALIFIED

## Lead Stage Owner
- MARKETING
- SALES

## Opportunity Stage
System/config hybrid:
- DISCOVERY
- QUALIFIED
- SURVEY
- SOLUTION
- QUOTATION
- NEGOTIATION
- WON
- LOST

## Lost Reason
Configurable:
- Giá
- Đối thủ
- Không đủ ngân sách
- Không phù hợp kỹ thuật
- Hoãn dự án
- Không liên hệ được
- Khác

## Sales Channel
- DISTRIBUTION
- PROJECT

---

# 4. Product Master

## Product Category
Configurable tree.

Ví dụ nhóm lớn:
- Solar Panel
- Inverter
- Battery/BESS
- Electrical
- Networking
- Security
- Accessories
- Service

Danh mục thật phải lấy từ dữ liệu công ty.

## UOM
- Piece
- Set
- Meter
- Box
- Lot
- Service
- Other

Cần chuẩn hóa mã.

## Tracking Type
System enum:
- NONE
- LOT
- SERIAL

---

# 5. Technical

## Technical Request Type
Configurable:
- Survey
- Design
- Technical Consultation
- BOM
- Troubleshooting
- Other

## Priority
System/config:
- LOW
- NORMAL
- HIGH
- CRITICAL

## Drawing Type
Configurable:
- Layout
- Single Line Diagram
- Wiring
- As-built
- Other

---

# 6. Service

## Ticket Type
- WARRANTY
- INCIDENT
- SUPPORT
- MAINTENANCE
- REPAIR

## Ticket Category
Configurable theo sản phẩm/nghiệp vụ.

## Root Cause
Configurable:
- Product defect
- Installation
- Environment
- Configuration
- User operation
- Unknown
- Other

## Resolution Type
Configurable:
- Adjust
- Repair
- Replace
- Firmware/Software
- Guide customer
- Vendor support
- Other

---

# 7. Project

## Project Type
Configurable:
- Solar
- Electrical
- IT/Networking
- Security
- Other

## Risk Level
- LOW
- MEDIUM
- HIGH
- CRITICAL

## Milestone Template
Configurable theo Project Type.

---

# 8. Purchasing

## Supplier Category
Configurable.

## PR Type
- Project
- Warranty
- Internal
- Stock replenishment

## Supplier Evaluation Criteria
Configurable weighted criteria:
- Price
- Delivery
- Quality
- Warranty
- Payment Term

---

# 9. Inventory

## Warehouse
Master data.

## Location Type
System enum:
- INTERNAL
- SUPPLIER
- CUSTOMER
- TRANSIT
- LOSS
- ADJUSTMENT

## Stock Document Type (ADR-013)
- RECEIPT
- ISSUE
- TRANSFER
- RETURN
- ADJUSTMENT

(Tên cũ `INTERNAL_TRANSFER` đổi thành `TRANSFER`.)

---

# 10. Finance

## Payment Request Type
Configurable:
- Supplier
- Internal expense
- Project expense
- Refund
- Other

## Advance Type
Configurable.

## Receivable Aging Bucket
Configurable report defaults:
- 0–30
- 31–60
- 61–90
- >90

---

# 11. SLA Config

SLA không hard-code.

Fields:
- name
- applicable ticket type
- priority
- responseMinutes
- resolveMinutes
- businessCalendar
- pauseRules
- active

---

# 12. Approval Policy

Configurable theo:
- process
- department
- amount
- discount
- risk
- role
- management level

Ví dụ:
```text
Quote discount > X%
→ Sales Manager

Quote discount > Y%
→ Deputy Director

Contract value > Z
→ Director
```

Các X/Y/Z phải do công ty chốt.

---

# 13. Business Calendar

Config:
- work days
- start/end time
- lunch break nếu ảnh hưởng SLA
- holidays
- timezone

---

# 14. System Enum vs Configurable Lookup

## Nên là system enum
- management level
- tracking type
- hard workflow state nội bộ
- integration status

## Nên configurable
- lead source
- lost reason
- ticket category
- root cause
- product category
- project type
- supplier category
- approval threshold
- SLA

## Bổ sung V8: danh mục mới

### Customer Class (system enum)
END_CUSTOMER, DEALER, DISTRIBUTOR, PARTNER

### Contract Direction (system enum)
OUTBOUND (hợp đồng bán), INBOUND (hợp đồng mua)

### Project Split Mode (system enum)
SINGLE, PER_SITE, MANUAL

### Project Cost Type (system enum)
MATERIAL, SUBCONTRACT, LABOR, EQUIPMENT, OTHER

### Landed Cost Type / Allocation Method
Type (configurable): CUSTOMS, FREIGHT, INSURANCE, OTHER. Allocation (system enum): BY_VALUE, BY_QTY, BY_WEIGHT.

### Lot Certificate Type (system enum)
CO, CQ, MANUFACTURER_WARRANTY, OTHER

### Compliance Item Type (system enum)
PARTNER_CERT, LICENSE, CALIBRATION, PERSONNEL_CERT, OTHER

### Document Template Type (system enum)
QUOTE, CONTRACT, ACCEPTANCE, HANDOVER, SURVEY_REPORT, OTHER

### Approval Level (system enum)
level1 = Trưởng phòng, level2 = Phó Giám đốc, level3 = Giám đốc (ADR-009).

### Cần phòng nghiệp vụ cung cấp (không điền trong tài liệu)
Danh mục cấp đại lý, ngưỡng duyệt, mốc nhắc compliance, danh mục chi phí, danh mục hãng/nhãn hiệu.
