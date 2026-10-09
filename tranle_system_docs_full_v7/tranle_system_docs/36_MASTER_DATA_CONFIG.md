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

## Lead Qualification
- UNQUALIFIED
- QUALIFIED
- DISQUALIFIED

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

## Transfer Type
- RECEIPT
- ISSUE
- INTERNAL_TRANSFER
- RETURN
- ADJUSTMENT

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
