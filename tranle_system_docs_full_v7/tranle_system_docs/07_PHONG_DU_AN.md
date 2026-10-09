# ĐẶC TẢ CHI TIẾT APP PHÒNG DỰ ÁN

## 1. Mục tiêu
Quản lý dự án từ sau khi hợp đồng được ký đến nghiệm thu, bàn giao và đóng dự án.

## 2. Menu
```text
DỰ ÁN
├── Dashboard
├── Projects
├── Giai đoạn / Epic
├── Milestone
├── Tasks
├── Vật tư dự án
├── Nhật ký công trình
├── Issue / Risk
├── Nghiệm thu
├── Bàn giao
└── Báo cáo
```

## 3. Khởi tạo Project

Trigger đề xuất:
`contract.signed`

Hệ thống phải:
1. tạo Project;
2. copy Customer/Contract;
3. gán Sales Owner;
4. yêu cầu chọn Project Manager;
5. gán Technical Owner nếu có;
6. sinh milestone/task template theo loại dự án;
7. tạo thư mục tài liệu mặc định;
8. gửi notification các bên.

## 4. Project fields
- projectCode
- projectName
- customerId
- contractId
- projectManagerId
- salesOwnerId
- technicalOwnerId
- departmentId
- startDate
- plannedEndDate
- actualEndDate
- status
- progress
- contractValue
- siteAddress
- projectType
- riskLevel
- note

## 5. Status
```text
PLANNING
→ READY
→ IN_PROGRESS
→ WAITING
→ ACCEPTANCE
→ HANDOVER
→ COMPLETED
```
Nhánh:
- ON_HOLD
- CANCELLED

## 6. Milestone
Mỗi milestone:
- name
- plannedStart/End
- actualStart/End
- owner
- completion rule
- status
- weight

Milestone mẫu:
- Khảo sát
- Thiết kế
- Chuẩn bị vật tư
- Thi công
- Cấu hình
- Test
- Nghiệm thu
- Bàn giao

## 7. Task/Epic/Subtask
- Project → Epic/Giai đoạn → Task → Subtask.
- Task có assignee, due date, priority, checklist, attachment, progress.
- Task quá hạn tính tự động.
- Task critical có cảnh báo.

## 8. Material Request

Người dự án tạo:
- project
- BOM/version
- product
- qty needed
- required date
- site/location
- priority

System:
1. gửi Kho kiểm tra tồn;
2. đủ hàng → reserve;
3. thiếu → sinh Purchase Request cho Mua hàng;
4. theo dõi trạng thái từng dòng;
5. khi xuất kho gắn stock move với Project.

Status line:
`REQUESTED → AVAILABLE/TO_PURCHASE → RESERVED → ISSUED`.

## 9. Nhật ký công trình
Mỗi ngày/ca:
- date
- project
- weather/note nếu cần
- team
- work performed
- progress
- issue
- photo
- material used
- safety note

## 10. Issue / Risk
Issue:
- category
- severity
- owner
- dueDate
- status
- impact
- correctiveAction

Risk:
- probability
- impact
- mitigation
- owner

## 11. Quality / Safety
Không cần app riêng; nằm trong Project:
- checklist chất lượng;
- checklist an toàn;
- defect;
- nonconformity;
- corrective action;
- evidence ảnh/file.

## 12. Nghiệm thu

### Input
- project/milestone;
- checklist;
- biên bản;
- customer representative;
- date;
- result;
- outstanding items.

### Status
`DRAFT → INTERNAL_REVIEW → CUSTOMER_REVIEW → ACCEPTED / REJECTED`.

Khi ACCEPTED:
- đóng milestone;
- phát event `acceptance.approved`;
- Finance kiểm tra payment milestone liên quan.

## 13. Bàn giao
- checklist bàn giao;
- tài liệu;
- hướng dẫn vận hành;
- danh sách asset/serial;
- biên bản;
- ngày bàn giao.

Khi hoàn tất:
- tạo Customer Asset;
- kích hoạt warranty;
- cho phép Project chuyển HANDOVER/COMPLETED.

## 14. Dashboard
Employee:
- My projects
- Milestones
- Tasks
- Material pending
- Acceptance upcoming

Manager:
- Project by status
- Delay
- Progress
- Workload PM
- Material shortage
- Issues/Risks
- Acceptance due

BGĐ:
- Project value
- Projects delayed
- Critical risks
- Acceptance/payment impacts

## 15. Rule
- Không Completed nếu còn milestone bắt buộc chưa xong.
- Không bàn giao nếu thiếu asset/serial theo loại dự án cần quản lý.
- Thay đổi plannedEnd sau khi project chạy phải audit.
- Material issue phải liên kết Stock Move.

# 16. Dependency / Input / Output / Ownership
## Dependency
Contract/Sales; Technical; Task; Purchasing; Inventory; Finance; Document.
## Input
Signed Contract; Approved BOM/Design; Stock availability; Procurement status.
## Output
Purchase/Material demand; Issue/Return request; Acceptance/payment trigger; Handover/Asset context.
## Ownership
Project, Milestone, Site Diary, Acceptance coordination: Phòng Dự án.
