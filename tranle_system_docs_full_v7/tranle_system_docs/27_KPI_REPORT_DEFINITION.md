# KPI & REPORT DEFINITION

## 1. Nguyên tắc
Mỗi KPI phải có:
- tên;
- công thức;
- nguồn dữ liệu;
- khoảng thời gian;
- filter;
- owner;
- drill-down.

Không để dev tự đoán công thức.

## 2. Sales
### Lead Conversion Rate
Đề xuất: `Converted Leads / Total Qualified Leads × 100`.
Cần Trưởng Kinh doanh xác nhận trước production.

### Pipeline Value
Tổng `opportunity.value` của Opportunity chưa WON/LOST.

### Weighted Forecast
`Σ opportunity.value × probability%`

### Win Rate
`Won / (Won + Lost) × 100`

### Revenue
Phải tách rõ:
- Contracted Revenue
- Invoiced Revenue
- Collected Revenue

Không dùng một từ "Doanh thu" cho ba khái niệm khác nhau.

### Quote Win Rate
`Accepted Quotes / Sent Quotes × 100`

## 3. Project
### Project On-time Rate
`Projects completed on/before plannedEnd / Completed Projects × 100`

### Project Delay Days
`max(0, actual/expected finish - plannedEnd)`

### Milestone Completion
`completed milestone weight / total weight × 100`

### Task Overdue Rate
`Open overdue tasks / Open tasks × 100`

## 4. Technical / Service
### SLA Compliance
`Tickets completed within SLA / Closed Tickets × 100`

### MTTR
`Average(resolvedAt - startedAt)` cho nhóm ticket được định nghĩa.

### First-time Resolution
`Closed without reopen / Closed Tickets × 100`

### Maintenance Compliance
`Maintenance completed on time / Scheduled Maintenance × 100`

### Failure Rate by Product
Nếu có Installed Asset:
`Ticket count / Installed asset count`

## 5. Purchasing
### On-time Delivery
`PO lines received by promised date / received PO lines × 100`

### PR Aging
`Today - relevant PR start date` theo trạng thái.

### Purchase Price Variance
Phải chốt baseline:
- estimate;
- previous purchase;
- standard cost;
- budget price.

## 6. Inventory
### Inventory Value
`Σ qty_on_hand × costing value`

### Low Stock
`available_qty < min_stock`

### Stock Variance
`actual_count - expected_count`

## 7. Finance
### AR Outstanding
`Σ outstanding receivable`

### Overdue AR
`Σ outstanding where dueDate < today`

### Aging
- 0–30
- 31–60
- 61–90
- >90 ngày

### Collection Rate
`Collected / Amount Due`

### Budget Utilization
`(Committed + Actual) / Budget × 100`

## 8. Dashboard Drill-down
KPI phải click xuống danh sách nguồn với cùng filter nếu dữ liệu cho phép.
