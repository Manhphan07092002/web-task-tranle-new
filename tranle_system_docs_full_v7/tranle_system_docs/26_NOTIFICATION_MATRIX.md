# NOTIFICATION MATRIX

## Kênh
- In-app
- Realtime
- Email
- Kênh khác sau này nếu tích hợp

## Sales
| Event | Người nhận | Khi nào |
|---|---|---|
| Lead assigned | Sales owner | ngay |
| Lead follow-up overdue | Owner | theo lịch |
| Technical Request completed | Sales requester | ngay |
| Quote submitted | Approver | ngay |
| Quote approved/rejected | Sales owner | ngay |
| Quote expiring | Owner | trước N ngày |
| Contract pending | Approver | ngay |
| Contract signed | Sales/Project/Technical/Finance | ngay |
| Receivable overdue | Sales + Finance | hàng ngày |

## Project
| Event | Người nhận |
|---|---|
| Project created | PM, Sales, Technical |
| Milestone due soon | Owner/PM |
| Task overdue | Assignee + Manager |
| Material shortage | PM + Purchasing |
| Acceptance due | PM + Technical + Sales |
| Critical issue | PM + Manager + Executive theo severity |

## Technical / Service
| Event | Người nhận |
|---|---|
| Technical Request new | Technical manager |
| Request assigned | Engineer |
| Survey upcoming | Engineer |
| Ticket new | Technical manager/queue |
| Ticket assigned | Engineer |
| SLA near breach | Assignee + Manager |
| SLA breached | Assignee + Manager + optional Executive |
| Maintenance due | Assignee/team |
| Replacement available | Ticket owner |

## Purchasing / Inventory
| Event | Người nhận |
|---|---|
| PR submitted | Approver |
| PR approved | Purchasing |
| RFQ deadline | Buyer |
| PO approved | Buyer |
| PO late | Buyer + Manager |
| Goods received | Purchasing + requester |
| Low stock | Warehouse manager + optional Purchasing |
| Stock variance | Warehouse manager |

## Finance
| Event | Người nhận |
|---|---|
| Payment Request submitted | Manager/Finance |
| Payment Request approved | Requester/Finance |
| Payment completed | Requester |
| Advance overdue | Employee + Manager + Finance |
| Receivable due | Finance + Sales |
| Receivable overdue | Finance + Sales + Manager |
| MISA sync failed | Finance Admin + System Admin |

## Quy tắc
- Notification phải link về record.
- Retry event không tạo notification trùng.
- Có `read_at`.
