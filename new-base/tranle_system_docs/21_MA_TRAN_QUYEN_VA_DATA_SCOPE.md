# MA TRẬN QUYỀN VÀ DATA SCOPE TOÀN HỆ THỐNG

## 1. Mục tiêu
Đây là nguồn chuẩn cho Backend, Frontend và QA khi triển khai phân quyền.

Tách rõ:
- Department
- Position
- Management Level
- Role
- Permission
- Data Scope
- Approval Authority

Admin là vai trò hệ thống, không phải cấp quản lý nghiệp vụ.

## 2. Management Level
| Code | Cấp |
|---|---|
| 10 | EMPLOYEE |
| 20 | DEPARTMENT_MANAGER |
| 30 | DEPUTY_DIRECTOR |
| 40 | DIRECTOR |

Nguồn sự thật của cấp: `positions.management_level` (ADR-010). `employees` không lưu cột này.

System role: `ADMIN`, `SUPER_ADMIN`.

## 3. Data Scope
| Scope | Ý nghĩa |
|---|---|
| OWN | bản ghi do user sở hữu |
| ASSIGNED | bản ghi được giao |
| PARTICIPATED | user tham gia |
| RELATED | user liên quan qua Customer/Project/Task |
| DEPARTMENT | toàn phòng |
| MANAGED_DEPARTMENTS | các phòng PGĐ phụ trách |
| COMPANY | toàn công ty |
| EXPLICIT | cấp riêng |

Backend tự suy ra scope từ user/session + database; frontend không tự truyền phòng ban để quyết định quyền.

### 3A. Phạm vi DEPARTMENT và phòng con (ADR-011)
- `DEPARTMENT` gồm phòng của user **và mọi phòng con** theo `departments.parent_id` (dùng path vật chất hóa hoặc closure table để truy vấn).
- Từng phòng có cờ cấu hình để loại trừ phòng con nếu cần.
- Test bắt buộc: Trưởng phòng cha thấy phòng con, không thấy phòng anh em; chuyển phòng con sang phòng khác thì quyền cập nhật ngay.

## 4. Permission Convention
`<resource>.<action>[.<scope>]`

Ví dụ:
- `lead.read.own`
- `lead.read.department`
- `lead.create`
- `lead.assign`
- `quote.approve.level1`
- `quote.approve.level2`
- `contract.read.company`
- `ticket.close`
- `workflow.manage`
- `integration.misa.configure`

## 5. Quyền mặc định
### Nhân viên
- đọc OWN/ASSIGNED/RELATED;
- tạo nghiệp vụ theo chức năng;
- cập nhật record được giao;
- không duyệt cấp phòng mặc định.

### Trưởng phòng
- đọc DEPARTMENT;
- phân công/chuyển owner;
- dashboard phòng;
- duyệt cấp 1 theo thẩm quyền.

### Phó Giám đốc
- đọc MANAGED_DEPARTMENTS;
- dashboard liên phòng;
- duyệt cấp 2.

### Giám đốc
- đọc COMPANY;
- duyệt cấp cao;
- dashboard công ty.

### Admin
- quản trị user/role/workflow/integration/log;
- không tự động duyệt Quote/Contract/Payment.

## 6. Ma trận nghiệp vụ
| Resource | Nhân viên | Trưởng phòng | PGĐ | GĐ | Admin |
|---|---|---|---|---|---|
| Lead | CRUD own | CRUD dept + assign | Read scope | Read company | Config |
| Customer | Read related/create | Read dept | Read scope | Read company | Config |
| Opportunity | CRUD own | CRUD dept + assign | Read scope | Read company | Config |
| Technical Request | Create/read related | Manage dept | Read scope | Read | Config |
| Quote | Draft own | Approve L1 | Approve L2 | Approve L3 | No business approval |
| Contract | Draft/read related | Review/L1 | L2 | L3 | Config |
| Project | Assigned | Manage dept | Read scope | Read company | Config |
| Task | Own/assigned | Dept | Scope | Company | Config |
| Ticket | Assigned | Dept + assign | Scope | Company | Config |
| Purchase Request | Create own | Manager approval | Threshold | High | Config |
| Purchase Order | Purchasing | Manager | Threshold | High | Config |
| Stock Receipt/Issue | Warehouse | Warehouse manager | Read | Read | Config |
| Payment Request | Create own | Manager approval | Threshold | High | Config |
| Advance | Create own | Manager approval | Threshold | High | Config |
| Workflow | User task | View dept runs | View scope | View | Manage |
| Integration | None | Read if granted | Read | Read | Manage |

## 7. Approval Authority
Không hard-code ngưỡng tiền/chiết khấu.

Cấp duyệt (ADR-009): `level1` = Trưởng phòng (cấp 20), `level2` = Phó Giám đốc (cấp 30), `level3` = Giám đốc (cấp 40). Chứng từ cần duyệt chỉ có trạng thái chờ `PENDING_APPROVAL`; chuỗi duyệt sinh ra từ policy và lưu ở `approvals`.

Bảng đề xuất:
```text
approval_policies
- id
- process_key
- department_id nullable
- level
- condition_json
- approver_role
- approver_scope
- active
- valid_from
- valid_to
```

## 8. Test bắt buộc
1. Employee đọc own, không đọc người khác.
2. Manager đọc phòng, không đọc phòng khác.
3. PGĐ chỉ đọc managed departments.
4. Director đọc company.
5. Admin không bypass business approval.
6. Permission revoke phải có hiệu lực theo chính sách session.
7. Trưởng phòng cha thấy phòng con, không thấy phòng khác (ADR-011).
8. Đổi `positions.management_level` thì quyền thay đổi theo, không có nguồn thứ hai.
