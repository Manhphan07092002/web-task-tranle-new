# ĐẶC TẢ CHI TIẾT APP PHÒNG KẾ TOÁN / FINANCE OPERATIONS

## 1. Phạm vi
Web không thay thế toàn bộ MISA.

Tran Le Platform quản lý:
- luồng yêu cầu;
- payment milestone;
- expected receivable/payable;
- đề nghị thanh toán;
- tạm ứng/hoàn ứng;
- approval;
- đối soát MISA.

MISA là nguồn kế toán chính thức theo phạm vi công ty sử dụng.

## 2. Menu
```text
KẾ TOÁN
├── Dashboard
├── Phải thu
├── Phải trả
├── Đề nghị thanh toán
├── Tạm ứng
├── Hoàn ứng
├── Thu / Chi nội bộ
├── Ngân sách
├── Đối soát MISA
└── Báo cáo
```

## 3. Receivable
Nguồn:
- Contract payment milestone;
- Invoice/MISA sync.

Field:
- customer
- contract
- milestone
- expectedAmount
- officialAmount
- dueDate
- paidAmount
- outstanding
- status
- misaReference

Status:
`UPCOMING → DUE → PARTIAL → PAID → OVERDUE`.

Cảnh báo:
- sắp đến hạn;
- quá hạn;
- số liệu lệch MISA.

## 4. Payable
Nguồn:
- PO;
- Supplier Invoice;
- MISA.

Hiển thị:
- supplier
- PO
- invoice
- amount
- dueDate
- paid
- outstanding

## 5. Payment Request
Người dùng phòng ban tạo:
- beneficiary
- purpose
- amount
- project/cost center
- attachments
- requestedDate

Process:
```text
DRAFT
→ PENDING_MANAGER
→ PENDING_FINANCE
→ PENDING_EXECUTIVE (nếu ngưỡng)
→ APPROVED
→ PAID
```

Rule:
- reject phải reason;
- paid cần chứng từ/reference;
- ngưỡng cấu hình.

## 6. Advance
Request:
- employee
- purpose
- project
- amount
- expectedSettlementDate

Status:
`REQUESTED → APPROVED → DISBURSED → SETTLEMENT_PENDING → SETTLED`.

Cảnh báo:
- quá hạn hoàn ứng;
- nhân viên còn tạm ứng cũ theo rule.

## 7. Settlement
- advance reference;
- expense items;
- receipts;
- actual amount;
- refund/additional amount.

## 8. Budget
Bản đầu:
- fiscal period;
- department/project;
- budget amount;
- committed;
- actual;
- remaining.

Approval có thể check remaining budget trước khi duyệt PR/payment.

## 9. MISA
Finance có trang:
- connection status;
- sync status;
- receivable reconciliation;
- payment reconciliation;
- errors;
- manual retry theo quyền.

## 10. Dashboard
Employee:
- payment requests
- advance
- settlement
- receivable to verify

Manager:
- AR aging
- AP aging
- Payment pending
- Advance outstanding
- Budget usage
- Cash-flow forecast
- MISA sync errors

BGĐ:
- Total receivable/payable
- Overdue
- Major cash obligations
- High-value approval

## 11. Rule
- Money dùng DECIMAL, không DOUBLE.
- Currency rõ ràng.
- Không xóa chứng từ approved/paid.
- Sửa sai bằng cancellation/reversal theo thiết kế.
- Mọi thay đổi số tiền phải audit.

# 12. Dependency / Input / Output / Ownership
## Dependency
Contract; Purchasing; Inventory; Workflow; MISA Integration.
## Input
Payment milestones; PO/Receipt/Supplier invoice; Payment Request; MISA invoice/payment.
## Output
Receivable/Payable status; Payment status; Budget availability; Reconciliation status.
## Ownership
Finance Ops: Kế toán. Official accounting records: MISA theo phạm vi đã chốt.
