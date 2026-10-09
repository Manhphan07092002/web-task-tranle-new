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

## Bổ sung V8: sự kiện mới

| Sự kiện | Người nhận | Kênh mặc định |
|---|---|---|
| Lead chuyển giao Marketing → Sales (`lead.handoff`) | Sales owner, Trưởng phòng Kinh doanh | In-app |
| Compliance item sắp hết hạn / quá hạn | Người phụ trách, Trưởng phòng sở hữu; thêm Marketing/Kinh doanh nếu là chứng nhận đối tác | In-app, email |
| Đơn đại lý vượt hạn mức công nợ | Kế toán, Trưởng phòng Kinh doanh | In-app |
| Chi phí dự án vượt ngân sách | PM, Trưởng phòng Dự án, Kế toán | In-app |
| Phiếu nhập thiếu chứng nhận bắt buộc (CO/CQ) | Thủ kho, Mua hàng | In-app |
| Job outbox thất bại quá số lần retry | Admin, người phụ trách module | In-app, email |
