# DASHBOARD VÀ PHÂN QUYỀN

## 1. Nguyên tắc

Dashboard = Phòng ban + Cấp quản lý.

Không hard-code hàng chục component dashboard riêng nếu có thể cấu hình bằng template/widget.

## 2. Management Level

| Code | Cấp |
|---|---|
| 10 | Employee |
| 20 | Department Manager |
| 30 | Deputy Director |
| 40 | Director |

Admin là `system_role`, không phải management level.

## 3. Data Scope

### Employee
- Own
- Assigned
- Participated
- Related

### Department Manager
- Department
- Own

### Deputy Director
- Assigned Departments

### Director
- Company-wide

### Admin
- System configuration
- Không tự động có quyền duyệt nghiệp vụ

## 4. Dashboard Template

```text
DashboardTemplate
- id
- name
- departmentId
- managementLevel
- isDefault
```

```text
DashboardWidget
- dashboardTemplateId
- widgetType
- entity
- filterJson
- aggregation
- groupBy
- positionJson
- configJson
```

## 5. My Dashboard

Mọi user đều có:
- Việc hôm nay
- Việc quá hạn
- Lịch hôm nay
- Việc chờ duyệt
- Thông báo
- Deadline gần nhất

## 6. Dashboard theo phòng

### Kinh doanh
Employee:
- Doanh số cá nhân
- Lead của tôi
- Opportunity
- Báo giá chờ khách
- Công nợ liên quan

Manager:
- Doanh số phòng
- Pipeline
- Hiệu suất Sales
- Báo giá chờ duyệt
- Công nợ

### Kỹ thuật - Bảo hành
Employee:
- Technical Request
- Task dự án
- Ticket
- Bảo trì

Manager:
- Dự án trễ
- Ticket quá SLA
- Workload
- Sự cố theo loại
- Hiệu suất xử lý

### Dự án
Employee:
- Project được giao
- Milestone
- Task
- Nghiệm thu

Manager:
- Tổng project
- Project trễ
- Theo PM
- Task quá hạn

### Kho
Employee:
- Nhập
- Xuất
- Điều chuyển
- Kiểm kê

Manager:
- Giá trị tồn
- Tồn thấp
- Tồn lâu
- Sai lệch kiểm kê

### Mua hàng
Employee:
- PR
- RFQ
- PO
- Đơn trễ

Manager:
- Giá trị mua
- Supplier performance
- PR tồn
- PO trễ

### Kế toán
Employee:
- Đề nghị thanh toán
- Tạm ứng
- Hoàn ứng
- Khoản thu cần xác nhận

Manager:
- AR
- AP
- Thanh toán chờ duyệt
- Tạm ứng chưa hoàn
- Dòng tiền dự kiến

### Marketing
Employee:
- Task nội dung
- Campaign
- Lead
- Calendar

Manager:
- Campaign
- CPL
- Conversion
- Revenue Attribution

### HCNS
Employee:
- Onboarding
- Hồ sơ
- Yêu cầu nhân sự

Manager:
- Tổng nhân sự
- Biến động
- Onboarding
- Offboarding

## 7. Executive Dashboard

### Phó Giám đốc
- Chỉ xem phạm vi phòng được giao
- KPI liên phòng
- Cảnh báo
- Công nợ
- Dự án
- Pipeline
- Ticket SLA

### Giám đốc
- Doanh thu
- Pipeline
- Công nợ
- Tồn kho
- Dự án
- Bảo hành
- Cảnh báo điều hành
- Việc chờ duyệt cấp cao

### Admin
- User
- Online
- API error
- Workflow error
- Email failure
- Storage
- Backup
- System log
