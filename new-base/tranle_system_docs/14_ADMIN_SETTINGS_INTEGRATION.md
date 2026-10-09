# ĐẶC TẢ CHI TIẾT ADMIN / SETTINGS / INTEGRATION

## 1. Mục tiêu
Admin vận hành nền tảng, không phải cấp duyệt nghiệp vụ.

## 2. Menu
```text
CÀI ĐẶT
├── Tổ chức
│   ├── Công ty
│   ├── Phòng ban
│   ├── Chức vụ
│   └── Cấp quản lý
├── Người dùng & Quyền
│   ├── User
│   ├── Role
│   ├── Permission
│   └── Data Scope
├── Dữ liệu
│   ├── Custom Field
│   ├── Lookup / Master Data
│   ├── Document Template
│   ├── Saved View
│   └── Filter
├── Dashboard
│   ├── Template
│   └── Widget
├── Quy trình
│   ├── Workflow
│   ├── SLA
│   └── Business Calendar
├── Tích hợp
│   ├── MISA
│   ├── Email
│   ├── API Key
│   └── Webhook
└── Hệ thống
    ├── Audit
    ├── System Log
    ├── Sync Log
    └── Backup
```

## 3. User Management
Admin:
- tạo user;
- khóa/mở;
- link Employee;
- reset quyền;
- xem login status nếu có;
- không xem password.

## 4. Role & Permission
Permission format:
`resource.action.scope`

Ví dụ:
- `lead.read.own`
- `lead.read.department`
- `quote.create`
- `quote.approve.level1`
- `contract.approve.level2`

Backend enforce tất cả permission.

## 5. Data Scope
- own
- assigned
- department
- managedDepartments
- company
- explicit

## 6. Dashboard Template
Admin cấu hình:
- department
- management level
- widget
- filter
- layout
- default.

## 7. Custom Field
Bản nhẹ:
- entity
- key
- label
- type
- required
- options
- order

Không cho đổi type phá dữ liệu nếu đã có record mà chưa có migration strategy.

## 8. Workflow
Admin/Process Admin:
- create draft;
- version;
- publish;
- deactivate;
- view runs;
- retry service step;
- inspect error.

Không sửa version đang chạy trực tiếp.

## 9. SLA / Business Calendar
- work hours
- holidays
- priority
- response/resolve time
- pause rules

## 10. Integration Hub
Provider:
- MISA
- Email
- Google Calendar sau này
- Zalo/Facebook sau này

Mỗi provider có:
- connection;
- encrypted credentials;
- mapping;
- sync jobs;
- error log;
- audit.

## 11. MISA
Chi tiết xem `19_TICH_HOP_API_MISA.md`.

Admin UI cần:
- connection status;
- connect/disconnect;
- mapping;
- sync;
- errors;
- retry;
- reconciliation;
- audit.

## 12. System Dashboard
- users
- active sessions nếu có
- workflow errors
- sync errors
- email errors
- queue backlog
- storage
- backup
- API health

## 13. Security
- secret backend-only;
- encryption at rest cho integration secret;
- audit config changes;
- rate limit;
- permission riêng;
- không log token.

# 14. Dependency / Input / Output / Ownership
## Dependency
Tất cả app nền tảng.
## Input
Organizational policy; Business approval policy; Integration credential; Dashboard/workflow config.
## Output
User/Role/Permission; Data Scope; Workflow definition; Dashboard template; Integration configuration.
## Ownership
System config: Admin. Business rule content: phòng nghiệp vụ xác nhận.
