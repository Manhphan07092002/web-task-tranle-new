# CORE: TASK, WORKFLOW, DOCUMENT

## 1. Task

Task phải có:
- title
- description
- type
- priority
- status
- departmentId
- assigneeId
- reporterId
- startDate
- dueDate
- completedAt
- progress
- relatedType
- relatedId
- parentTaskId

Type:
- task
- bug
- incident
- request
- approval

View:
- List
- Kanban
- Calendar
- Timeline

## 2. Epic / Subtask

```text
Project
└── Epic
    └── Task
        └── Subtask
```

## 3. Audit

Mỗi thay đổi quan trọng ghi:
- entityType
- entityId
- action
- field
- oldValue
- newValue
- userId
- createdAt

## 4. Saved View / Dynamic Filter

Saved view gồm:
- entity
- filter JSON
- columns JSON
- sort JSON
- owner
- shared

Backend:
- whitelist field
- whitelist operator
- parameterized SQL
- tự thêm permission/data scope

## 5. Workflow

Workflow gồm:
- definition
- version
- trigger
- conditions
- steps
- status

Run gồm:
- workflowVersion
- subject
- startedBy
- state
- currentStep
- error

Action ban đầu:
- Approval
- Notify
- Assign
- Create Task
- Update Status
- Send Email
- Webhook

## 6. Approval Center

Menu:
- Chờ tôi duyệt
- Tôi đã duyệt
- Tôi từ chối
- Yêu cầu của tôi

Dùng chung cho:
- Báo giá
- Hợp đồng
- Purchase Request
- Payment Request
- Advance
- Leave Request
- Other internal requests

## 7. Document

Object:
- document
- document_version
- attachment
- permission
- related_entity

Nhóm:
- Khảo sát
- Thiết kế
- Báo giá
- Hợp đồng
- Thi công
- Nghiệm thu
- Hoàn công
- Bảo hành

Không overwrite version cũ.
