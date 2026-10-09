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
Hai chỉ số tách rõ (cần Trưởng Kinh doanh chọn chỉ số mặc định trước production):
- **Lead-to-Customer Rate** (mặc định đề xuất, theo cohort ngày tạo Lead): `Leads CONVERTED / Tổng Leads tạo trong kỳ × 100`.
- **Qualified Conversion Rate**: `Leads CONVERTED / Leads QUALIFIED × 100`.

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

Chỉ số này bỏ sót dự án đang chạy mà đã trễ, nên luôn hiển thị kèm **Active Late Rate** = `Projects chưa COMPLETED có plannedEnd < hôm nay / Projects đang chạy × 100`.

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
`Ticket count trong kỳ / Số Installed Asset đang hoạt động trong kỳ` (chuẩn hóa theo kỳ; ghi rõ cách tính khi asset được lắp giữa kỳ)

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

## 7A. Chi phí và biên lợi nhuận dự án (V8)
### Project Gross Margin
`(Giá trị hợp đồng trước VAT − Chi phí thực tế `ACTUAL`) / Giá trị hợp đồng trước VAT × 100`

### Forecast Margin
Dùng `COMMITTED + ACTUAL` thay vì chỉ `ACTUAL`.

### Cost Variance
`Chi phí thực tế + cam kết − Ngân sách dự án`.

Nguồn dữ liệu và quyền xem (`project.read.margin`): `40_BO_SUNG_NGHIEP_VU.md` §5. Chi phí chung có phân bổ vào dự án không và có tính giờ công không: **cần xác nhận**.

## 7B. Kênh phân phối (V8)
- Doanh số theo đại lý/cấp/vùng; công nợ theo đại lý; doanh số theo hãng so với `vendor_targets`. Công thức chi tiết cần Phòng Kinh doanh xác nhận.

## 8. Dashboard Drill-down
KPI phải click xuống danh sách nguồn với cùng filter nếu dữ liệu cho phép.
