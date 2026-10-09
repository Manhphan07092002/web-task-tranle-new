# STATE MACHINE TOÀN HỆ THỐNG

## Quy tắc chung
- Không PATCH status tùy ý.
- Transition quan trọng phải qua action/service.
- Backend kiểm tra state hiện tại, permission, required field, business rule.
- Transition phải audit.

## Lead
Hai trục độc lập (ADR-012):
- `status` (vòng đời): `NEW → CONTACTED → CONVERTED`; nhánh `CLOSED` (khi DISQUALIFIED hoặc bị loại).
- `qualification_status`: `UNQUALIFIED → QUALIFIED`; nhánh `DISQUALIFIED` (bắt buộc lý do, đưa `status` sang CLOSED).
- Convert chỉ khi `qualification_status = QUALIFIED` và `status` chưa CONVERTED/CLOSED.

## Opportunity
`DISCOVERY → QUALIFIED → SURVEY → SOLUTION → QUOTATION → NEGOTIATION → WON/LOST`

## Technical Request
`NEW → ASSIGNED → SURVEYING → DESIGNING → REVIEW → COMPLETED`
Nhánh: `REVIEW → RETURNED → DESIGNING`, hoặc `CANCELLED`.

## Quote
`DRAFT → PENDING_APPROVAL → APPROVED → SENT → ACCEPTED/REJECTED/EXPIRED`

## Contract
`DRAFT → REVIEW → PENDING_APPROVAL → APPROVED → SIGNED → ACTIVE → COMPLETED`
Nhánh: `REJECTED`, `TERMINATED`, `CANCELLED`.

## Project
`PLANNING → READY → IN_PROGRESS → ACCEPTANCE → HANDOVER → COMPLETED`
Nhánh: `IN_PROGRESS ⇄ WAITING` (chờ điều kiện bên ngoài), `ON_HOLD`, `CANCELLED`.

## Task
`TODO → IN_PROGRESS → REVIEW → DONE`
Nhánh: `BLOCKED`, `CANCELLED`, `REOPENED`.

## Ticket
`OPEN → ASSIGNED → DIAGNOSING → IN_PROGRESS → RESOLVED → CLOSED`
Nhánh: `WAITING_PART`, `WAITING_VENDOR`, `WAITING_CUSTOMER`, `REOPENED`.

## Purchase Request
`DRAFT → PENDING_APPROVAL → APPROVED → SOURCING → ORDERED → PARTIALLY_RECEIVED → COMPLETED`
Nhánh: `REJECTED`, `CANCELLED`.

## RFQ
`DRAFT → SENT → RESPONDED → CLOSED`

## Purchase Order
`DRAFT → PENDING_APPROVAL → APPROVED → SENT → PARTIAL_RECEIPT → RECEIVED → CLOSED`

## Chứng từ kho (ADR-013)
Bảng `stock_documents` dùng chung với `doc_type` = RECEIPT / ISSUE / TRANSFER / RETURN / ADJUSTMENT. Mỗi loại có state machine riêng bên dưới; `stock_counts` là bảng riêng.

## Stock Receipt (doc_type = RECEIPT)
`DRAFT → CONFIRMED → RECEIVING → DONE`
Ghi chú: phiếu nhập yêu cầu chứng nhận (CO/CQ) không sang DONE khi thiếu hồ sơ bắt buộc (`40` §2).

## Stock Issue (doc_type = ISSUE)
`DRAFT → CONFIRMED → RESERVED → PICKING → DONE`

## Stock Transfer (doc_type = TRANSFER)
`DRAFT → CONFIRMED → IN_TRANSIT → RECEIVED → DONE`

## Stock Count
`DRAFT → COUNTING → REVIEW → APPROVED → ADJUSTED → CLOSED`
Nhánh: `CANCELLED`.

## Payment Request
`DRAFT → PENDING_APPROVAL → APPROVED → PAID`
Nhánh: `REJECTED`, `CANCELLED`.
Chuỗi người duyệt (Trưởng phòng → Kế toán → Giám đốc, tùy ngưỡng) nằm ở `approvals` do `approval_policies` sinh ra, không nằm trong enum trạng thái (ADR-009).

## Advance
`DRAFT → PENDING_APPROVAL → APPROVED → DISBURSED → SETTLEMENT_PENDING → SETTLED`
Nhánh: `REJECTED`, `CANCELLED`.

## Acceptance
`DRAFT → INTERNAL_REVIEW → CUSTOMER_REVIEW → ACCEPTED/REJECTED`

## Workflow
Definition: `DRAFT → PUBLISHED → ACTIVE → INACTIVE`
Run: `RUNNING → WAITING → COMPLETED/FAILED/CANCELLED`

## Transition Matrix mẫu
| Entity | From | Action | To | Actor |
|---|---|---|---|---|
| Quote | DRAFT | submit | PENDING_APPROVAL | Sales |
| Quote | PENDING_APPROVAL | approve | APPROVED | Approver |
| Ticket | OPEN | assign | ASSIGNED | Manager |
| Ticket | RESOLVED | close | CLOSED | Allowed role |
| PO | APPROVED | send | SENT | Purchasing |
| Receipt | RECEIVING | complete | DONE | Warehouse |

## Bổ sung V8: state machine còn thiếu

Cột **Nguồn**: *spec* = đã có trạng thái ở file phòng ban; *đề xuất* = tên trạng thái do V8 đặt, cần phòng liên quan xác nhận.

| Thực thể | Vòng đời | Nguồn |
|---|---|---|
| Sales Order | `DRAFT → [PENDING_APPROVAL] → APPROVED → WAITING_STOCK → READY → DELIVERED → COMPLETED`; nhánh `CANCELLED` | spec (05 §10), PENDING_APPROVAL là đề xuất |
| Survey | `PLANNED → IN_PROGRESS → COMPLETED`; nhánh `CANCELLED`. Không COMPLETED khi thiếu field bắt buộc | đề xuất (06 §5) |
| Solution/Design | `DRAFT → REVIEW → APPROVED`; nhánh `RETURNED` | spec (06) |
| BOM | `DRAFT → REVIEW → APPROVED → SUPERSEDED`; BOM APPROVED không sửa, tạo version mới | đề xuất (06) |
| Material Request | `DRAFT → SUBMITTED → AVAILABLE/TO_PURCHASE → RESERVED → ISSUED`; nhánh `CANCELLED` | đề xuất (07 §8) |
| Handover | `DRAFT → IN_PROGRESS → COMPLETED`; hoàn tất tạo `customer_assets` | đề xuất (07) |
| Maintenance Plan | `ACTIVE ⇄ PAUSED → ENDED`; mỗi kỳ sinh Task/Ticket loại bảo trì | đề xuất (06) |
| Campaign | `DRAFT → PLANNED → ACTIVE → PAUSED → COMPLETED` | spec (12 §3) |
| Leave Request | `DRAFT → PENDING_APPROVAL → APPROVED/REJECTED`; nhánh `CANCELLED` | đề xuất (11), chuỗi duyệt ở approval policy |
| Onboarding/Offboarding | `PLANNED → IN_PROGRESS → COMPLETED`; nhánh `CANCELLED` | đề xuất (11) |
| Receivable/Payable | `UPCOMING → DUE → PARTIAL → PAID` (quá hạn là giá trị dẫn xuất, ADR-015) | V8 |
| Contract (INBOUND) | cùng vòng đời Contract; bước duyệt theo policy của `direction` (ADR-014) | V8 |
| Settlement (quyết toán tạm ứng) | `DRAFT → PENDING_APPROVAL → APPROVED → POSTED`; nhánh `REJECTED` | đề xuất (10) |
| Document Template | `DRAFT → ACTIVE → RETIRED`; mỗi lần sửa tạo version | V8 (`40` §4) |
| Compliance Item | `status` chỉ lưu `RENEWING/ARCHIVED`; `VALID/EXPIRING/EXPIRED` dẫn xuất từ `expires_at` | V8 (`40` §3) |

**Quy tắc xuyên suốt:** trạng thái chờ duyệt luôn là `PENDING_APPROVAL`; quá hạn/quá SLA luôn là giá trị tính ra, không lưu thành trạng thái.
