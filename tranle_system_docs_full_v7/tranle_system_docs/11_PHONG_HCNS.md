# ĐẶC TẢ CHI TIẾT APP HÀNH CHÍNH - NHÂN SỰ

## 1. Mục tiêu
Quản lý cơ cấu tổ chức, hồ sơ nhân viên, onboarding/offboarding, đơn từ và tài sản cấp phát; đồng thời cung cấp dữ liệu nền cho Permission/Workflow.

## 2. Menu
```text
HCNS
├── Dashboard
├── Nhân viên
├── Phòng ban
├── Chức vụ
├── Cơ cấu tổ chức
├── Onboarding
├── Offboarding
├── Nghỉ phép
├── Công tác
├── Làm thêm
├── Tài sản cấp phát
└── Báo cáo
```

## 3. Employee
Field:
- employeeCode
- userId
- fullName
- departmentId
- positionId
- directManagerId
- managementLevel
- workLocation
- joinDate
- status
- email/phone
- emergency info nếu chính sách cho phép

Không trộn Employee với User:
- Employee = hồ sơ tổ chức
- User = tài khoản đăng nhập

## 4. Department / Position
Department:
- code
- name
- parentDepartment
- managerId
- active

Position:
- code
- name
- managementLevel
- active

## 5. Organization Chart
Hiển thị cây:
Company → Department → Manager → Employee.

Workflow engine lấy manager từ dữ liệu này, không hard-code user ID.

## 6. Onboarding
Checklist:
- tạo employee;
- tạo user;
- gán phòng/chức vụ;
- role;
- email;
- thiết bị;
- tài liệu/chính sách;
- bàn giao quản lý trực tiếp.

Status:
`PLANNED → IN_PROGRESS → COMPLETED`.

## 7. Offboarding
- ngày nghỉ;
- checklist bàn giao;
- transfer task;
- thu hồi asset;
- revoke role/token;
- disable account tại thời điểm hiệu lực;
- audit.

## 8. Leave Request
Field:
- employee
- type
- start/end
- duration
- reason
- attachment

Process:
`DRAFT → MANAGER_APPROVAL → HR_CONFIRM → APPROVED/REJECTED`.

Bản đầu chưa cần payroll nếu chưa có yêu cầu.

## 9. Asset Assignment
- asset code
- category
- serial
- employee
- assignedAt
- returnedAt
- condition

## 10. Dashboard
Employee HCNS:
- onboarding/offboarding task
- requests
- profile incomplete

Manager:
- headcount
- movement
- department distribution
- leave
- onboarding progress
- offboarding risk

# 11. Dependency / Input / Output / Ownership
## Dependency
Auth/User; Role/Permission; Workflow; Asset assignment.
## Input
Hiring/position decisions; Department structure; Internal requests.
## Output
Employee; Department; Position; Manager relation; User provisioning request.
## Ownership
Employee/Department/Position: HCNS. User/Permission: Admin phối hợp HCNS.
