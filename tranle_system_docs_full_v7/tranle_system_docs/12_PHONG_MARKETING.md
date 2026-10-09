# ĐẶC TẢ CHI TIẾT APP MARKETING

## 1. Mục tiêu
Quản lý chiến dịch, kế hoạch nội dung, ngân sách marketing và quan trọng nhất là nối Lead Marketing → Sales → Opportunity → Contract để đo hiệu quả thật.

## 2. Menu
```text
MARKETING
├── Dashboard
├── Campaign
├── Content Plan
├── Content Task
├── Channel
├── Marketing Budget
├── Lead Source
├── Marketing Lead
└── Báo cáo
```

## 3. Campaign
Field:
- code
- name
- objective
- channel
- start/end
- budget
- owner
- targetAudience
- status

Status:
`DRAFT → PLANNED → ACTIVE → PAUSED → COMPLETED`.

## 4. Content Plan
- campaign
- topic
- contentType
- channel
- owner
- plannedPublishAt
- status
- asset/document link

## 5. Lead Source
Chuẩn hóa:
- Website
- Facebook
- Zalo
- Event
- Referral
- Partner
- Other

Không cho người dùng nhập text tùy ý nếu có thể tránh.

## 6. Lead Handoff
Marketing Lead đạt điều kiện:
1. qualify;
2. assign Sales;
3. tạo/convert thành Sales Lead;
4. giữ campaign/source attribution;
5. theo dõi tiếp đến Opportunity/Contract.

## 7. Attribution
Bản đầu:
- first-touch;
- campaign/source gắn với Lead.

Sau này mới cân nhắc multi-touch.

## 8. Dashboard
Employee:
- tasks
- content calendar
- campaign assigned
- lead generated

Manager:
- spend
- leads
- CPL
- conversion to opportunity
- conversion to contract
- attributed revenue

# 9. Dependency / Input / Output / Ownership
## Dependency
Sales Lead; Customer; Task; Campaign budget; Integration channels.
## Input
Campaign plan; Content; Channel data.
## Output
Qualified Lead; Source/Campaign attribution; Marketing KPI.
## Ownership
Campaign/Content/Lead Source: Marketing. Lead sau handoff: Sales.
