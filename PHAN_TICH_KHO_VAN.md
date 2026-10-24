# Phân Tích Module Kho Vận (Warehouse/Stock) — Tran Le Tasks

> **Ngày:** 24/10/2026
>
> **Phạm vi:** Backend (`backend/routes/stock`, `backend/routes/warehouses`, `backend/schedulers/reservationExpiry.ts`), Database (`backend/db_mysql.ts`), Frontend (`frontend/pages/Warehouse`, services), RBAC/scope, tests.
>
> **Tài liệu tham chiếu:** `new-base/tranle_system_docs/09_KHO_VAN.md` (spec V8.2), `phan_tich.MD` (changelog module kho vận).

---

## 1. Tổng quan

Module Kho vận là phân hệ lớn nhất sau core Tasks: quản lý tồn nhiều kho/vị trí, chứng từ nhập/xuất/điều chuyển/trả, kiểm kê, serial/lô, combo/bộ sản phẩm, giữ hàng (reservation), cảnh báo Min/Max, tồn lâu, hàng ngoại lệ, đối soát MISA và audit log.

- **Backend:** `stockRoutes` là aggregator ghép 10 sub-router; `warehouses.ts` quản lý kho/vị trí mặc định.
- **Frontend:** 28 trang trong `frontend/pages/Warehouse` (bao gồm `StockDocs/*`), services `stockService.ts`, `reservationService.ts`, `locationService.ts`.
- **DB:** 15+ bảng kho (`warehouses`, `stock_locations`, `stock_documents` + lines, `stock_moves`, `stock_balances`, `reservations`, `stock_serials`, `stock_lots`, `product_bundles` + items, `stock_counts` + lines, `product_warehouse_policies`, `misa_mappings`, `misa_sync_logs`, `warehouse_activity_logs`, `user_warehouse_scopes`).
- **RBAC:** Admin bị chặn business data kho; Director thấy tất cả; Manager/Employee theo `user_warehouse_scopes`.
- **Scheduler:** `reservationExpiry.ts` tự giải phóng giữ hàng hết hạn mỗi 5 phút.

---

## 2. Kiến trúc backend

### 2.1 Cấu trúc sub-router

`backend/routes/stock.ts`:

| Sub-router | File | Trách nhiệm |
|---|---|---|
| Reports | `stockReports.ts` | Báo cáo nhập-xuất-tồn, tổng hợp (mount trong stock) |
| Balances | `balances.ts` | Tồn kho, khả dụng, chi tiết serial/lô theo sản phẩm-kho |
| Documents | `documents.ts` | Chứng từ IN/OUT/TRANSFER/RETURN/ADJUSTMENT, xử lý serial/lô, complete/ship/receive |
| Reservations | `reservations.ts` | Giữ hàng, release/consume |
| Locations | `locations.ts` | Vị trí/khu trong kho |
| Serials | `serials.ts` | Serial/lot CRUD, timeline |
| Bundles | `bundles.ts` | Combo/bộ sản phẩm, assemble/disassemble |
| Monitoring | `monitoring.ts` | Moves ledger, reconciliation, anomalies, policies, alerts, slow stock |
| Counts | `counts.ts` | Kiểm kê, variance, recount, approve/cancel |
| MISA | `misa.ts` | Mapping, sync queue, reconcile, log |
| Activity Logs | `activityLogs.ts` | Audit log kho |

`backend/routes/warehouses.ts`: CRUD kho (TP+), tự tạo 7 vị trí mặc định và gán scope cho nhân sự Kho Vận.

### 2.2 Mô hình ledger bất biến (D10)

- `stock_moves` là **nguồn sự thật** (immutable ledger): mọi biến động tạo move với `quantity` (+/-), `moveType`, `referenceType/Id`, `documentLineId`, `serialId`, `lotId`.
- `stock_balances` chỉ là **projection** đọc nhanh (`onHand`, `reserved`), cập nhật `ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand)`.
- Không bao giờ update số tồn trực tiếp; sửa sai bằng reversal/adjustment.
- `postMove`/`postMoves` ghi move + upsert balance + activity log trong cùng transaction.
- `postMoves` gộp batch (>20 moves) để giảm round-trip.

### 2.3 Transaction & concurrency

- `beginStockTransaction` + `dbTransactionGate` tuần tự hóa truy vấn trên connection dùng chung, gắn với request context.
- `assertNotCounting`: chặn ghi sổ khi kho đang kiểm kê.
- Reservation tạo transaction + lock để tránh vượt available stock.
- `nextDocCode`: sinh mã phiếu `PREFIX-YY-NNNN` theo từng loại phiếu+năm, retry khi va chạm.

---

## 3. Database schema kho vận

### 3.1 Bảng chính

| Bảng | Vai trò |
|---|---|
| `warehouses` | Kho (code unique, region, address, isActive) |
| `user_warehouse_scopes` | Phạm vi kho của user |
| `stock_locations` | Vị trí/khu (parentId, code, type, purpose: SALEABLE/WARRANTY/DAMAGED/DEMO/QUARANTINE/PICKING/RECEIVING/...) |
| `stock_documents` | Chứng từ chung (RECEIPT/ISSUE/TRANSFER/RETURN/ADJUSTMENT), trạng thái, đối tác, VAT, thanh toán, attachments |
| `stock_document_lines` | Dòng chứng từ (productId, quantity, price, location, VAT, tài khoản MISA, projectId) |
| `stock_moves` | Ledger bất biến |
| `stock_balances` | Projection tồn (productId, warehouseId, locationId, onHand, reserved) |
| `product_warehouse_policies` | Min/Max/reorder/leadTime theo kho |
| `reservations` | Giữ hàng (productId, warehouseId, quantity, requestedBy, status, expiresAt, consumedQuantity) |
| `stock_serials` | Serial/Imei (status SALEABLE/WARRANTY/DAMAGED/DEMO/QUARANTINE/SOLD; stockStatus IN_STOCK/RESERVED/OUT) |
| `stock_lots` | Lô (initialQty, remainingQty, lotCode, coilCode) |
| `product_bundles` + `product_bundle_items` | Combo VIRTUAL_BUNDLE / STOCKED_KIT |
| `stock_counts` + `stock_count_lines` | Kiểm kê (blind count, expected/actual, variance) |
| `misa_mappings` + `misa_sync_logs` | Mapping và log đồng bộ MISA |
| `warehouse_activity_logs` | Audit log kho (actionType, old/new data, metadata) |

### 3.2 Migration

- Versioned migrations v13–v25: tạo toàn bộ bảng kho, chuẩn hóa cột, index hiệu suất, gỡ FK legacy, backfill tracking.
- v4/v24/v25 hội tụ ledger cũ: chỉ số hiệu suất, lượng giữ hàng, đánh lại số ledger.
- v18: thêm `products.tracking` (NONE/LOT/SERIAL).
- v33/v38: serial-line tracking, lot, warranty dates, backfill tracking.

---

## 4. Nghiệp vụ chức năng

### 4.1 Kho & vị trí

- CRUD kho (TP+), code unique uppercase.
- Khi tạo kho: tự tạo 7 vị trí mặc định (RECEIVING, SALEABLE, PICKING, WARRANTY, DAMAGED, DEMO, QUARANTINE) và gán scope cho toàn bộ nhân sự phòng Kho Vận.
- Xóa kho chỉ khi không còn chứng từ/tồn/giữ hàng/kiểm kê.

### 4.2 Chứng từ

- Loại: RECEIPT, ISSUE, TRANSFER, RETURN, ADJUSTMENT.
- Trạng thái và workflow xử lý serial/lô: DRAFT → PROCESSING → READY → DONE/CANCELLED (tùy loại).
- Serial scan endpoints: `/serials/scan`, `/scan-out`, `/scan-return`, `/serials/edit`.
- Lot register/allocate.
- Complete receipt/issue/return; ship/receive transfer.
- Cancel/delete document (chỉ khi chưa posted).
- Partner suggestions tổng hợp từ stock_documents, clients, contracts.

### 4.3 Tồn kho & khả dụng

- `/balances`: tồn theo sản phẩm/kho/vị trí (onHand, reserved, available).
- `/available-inventory`: tổng hợp available theo sản phẩm (có filter tracking, onlyAvailable).
- `/inventory/:productId/:warehouseId/details`: serial/lô chi tiết.
- Saleable availability: chỉ tính vị trí SALEABLE đang hoạt động + vị trí mặc định `''`.
- Hàng WARRANTY/DAMAGED/DEMO/QUARANTINE không tính vào khả dụng bán.

### 4.4 Giữ hàng (Reservation)

- Hold stock từ available, chỉ từ vị trí SALEABLE (trừ exception được duyệt).
- Release/Consume; consume khi ISSUE DONE.
- Không tạo stock_move.
- Scheduler tự release khi hết hạn (`expiresAt`), cập nhật `reserved`, xóa liên kết document line.
- Test hồi quy: hold song song không vượt available, reservation issue phase.

### 4.5 Serial / Lô

- CRUD serial, trạng thái vận hành + stockStatus.
- Timeline serial: receipt → issue → warranty → moves.
- Timeline lô: receipt → moves.
- Serial edit/scan để xử lý phiếu.
- Warranty tracking: warrantyStart, warrantyMonths, daysLeft.

### 4.6 Combo / Bộ sản phẩm

- `VIRTUAL_BUNDLE`: không có balance riêng; buildable qty = MIN(FLOOR(component available / qtyPerBundle)).
- `STOCKED_KIT`: assemble/disassemble tạo stock document/move.
- Endpoint assemble/disassemble.

### 4.7 Kiểm kê

- Mở đợt kiểm kê (blind count tùy chọn).
- Submit count lines, request recount, approve variance, cancel.
- Khi đang COUNTING: chặn ghi sổ (assertNotCounting).
- Adjustment chỉ từ kiểm kê được duyệt/sai lệch xác nhận.

### 4.8 Cảnh báo & kiểm soát

- Alerts: hết hàng, dưới reorder point, dưới min.
- Slow stock: không di chuyển trong N ngày.
- Min/Max policies theo sản phẩm-kho.
- Reconciliation: so sánh balance projection vs ledger.
- Anomalies: SERIAL, balance mismatch, etc.
- Exceptions page: hàng ngoại lệ.

### 4.9 MISA

- Mapping entity (product inventory account, partner payable, project) → mã MISA.
- Sync queue prepare (idempotency).
- Reconcile: so sánh Tran Le vs MISA on-hand.
- Log sync.

### 4.10 Audit log

- `warehouse_activity_logs`: mọi move, reservation expired, adjustment, v.v. ghi old/new data, metadata, user, thời gian.

---

## 5. Frontend

### 5.1 Trang (28 files trong `pages/Warehouse`)

| Nhóm | Trang |
|---|---|
| Tổng quan | `OverviewPage` |
| Vận hành | `InventoryPage`, `StockDocsPage` (RECEIPT/ISSUE/RETURN/TRANSFER), `ProcessingQueuePage`, `CountPage`, `CountVariancePage`, `ReservationsPage`, `MovesPage`, `InTransitPage` |
| Hàng hóa | `SerialPage`, `SerialDocMode`, `BundlePage`, `CatalogPage`, `LocationsPage` |
| Của tôi | `MyWorkPage` |
| Kiểm soát | `AlertsPage`, `ExceptionsPage`, `SlowStockPage`, `AuditLogPage`, `StockControlPage` |
| Phê duyệt | `ApprovalsPage`, `StockAdjustmentPage` |
| Báo cáo | `ReportsPage`, `WarehouseStockReportPage`, `MinMaxPage`, `MisaPage`, `AvailableInventoryReference` |

### 5.2 Services

- `stockService.ts`: ~928 dòng, đầy đủ API client cho documents, balances, serials, lots, bundles, counts, policies, alerts, slow, reconciliation, anomalies, MISA, activity logs, processing.
- `reservationService.ts`, `locationService.ts`.

### 5.3 Menu/RBAC frontend

- `departmentMenus.ts`: WAREHOUSE menu chia nhóm; TP-only items gắn `minLevel: 20`.
- NV (level 10) thấy tồn kho, nhập/xuất/trả/điều chuyển, xử lý phiếu, kiểm kê, serial/lô, combo, việc của tôi.
- TP (level ≥20) thêm lịch sử, reservation quản trị, danh mục, kho/vị trí, audit/control/alerts/exceptions/slow, approvals/variance/adjustment, báo cáo, MISA.

---

## 6. RBAC & Security

- Mount: `/api/stock` và `/api/warehouses` đều `requireAuth`; RBAC enforce trong handler.
- Admin (level 99) bị chặn business stock data (D12): `listScope` throw 403 "Admin cannot view business stock data"; `requireWarehouse` false cho admin.
- Director (level 40) thấy tất cả kho.
- Manager/Employee theo `user_warehouse_scopes`.
- Warehouse CRUD: level ≥20 và ≠ admin.
- Can read/write document: TRANSFER liên quan 2 kho; đọc cho phép 1 đầu, ghi yêu cầu cả 2 đầu.
- Transaction gate + validation Zod.
- Upload/content checks ở middleware global.

**Lưu ý:** Quyết định D4 (Admin không truy cập dữ liệu kinh doanh) đang được áp dụng cho kho; Admin không thể xem/duyệt kho. Cần chốt với business nếu Admin cần hỗ trợ vận hành.

---

## 7. Scheduler & Automation

- `reservationExpiry.ts`: mỗi 5 phút release reservation HELD hết hạn, cập nhật `reserved`, xóa liên kết document line, ghi activity log `RESERVATION_EXPIRED`.
- Idempotent: chỉ chạm HELD quá `expiresAt`; lock `FOR UPDATE`.
- Các scheduler khác (daily task reminder, note reminder, mail, revenue auto submit, friday reminder) không thuộc kho.

---

## 8. Tests & Quality

- Backend có nhiều suite kho: `stock*.test.ts`, `warehouseCrud.test.ts`, `warehouseRegression.test.ts`, `stockReports*.test.ts`, `stockSerial*.test.ts`, `stockReservationsIssuePhase6.test.ts`, `stockLot*.test.ts`, `stockMisaDocuments.test.ts`, `stockPerformance.test.ts`, `stockPartnerSuggestions.test.ts`, `warranty.test.ts`.
- `phan_tich.MD` ghi nhận 29 suites / 312 tests PASS (12/10/2026); `stockReports.test.ts` dùng `node:sqlite`.
- Frontend: chưa có test Vitest cho pages kho (vitest config chưa khai báo dependencies theo doc).

---

## 9. Điểm mạnh

1. **Ledger bất biến đúng nguyên tắc**: `stock_moves` nguồn sự thật, `stock_balances` projection; không update tồn trực tiếp.
2. **Transaction integrity**: transaction gate, assertNotCounting, reservation lock.
3. **RBAC/scope chặt**: admin blocked, director all, kho scope theo user; document read/write phân biệt 1/2 đầu kho.
4. **Nghiệp vụ phong phú**: serial/lô timeline, bundle virtual/stocked, blind count, reconciliation, anomalies, MISA.
5. **Performance**: batch postMoves, pagination, index tối ưu, warehouse scope pushed vào subqueries.
6. **Auditability**: activity logs với old/new data.
7. **Scheduler automation**: expiry reservation.
8. **Test coverage backend đáng kể** cho stock.

---

## 10. Rủi ro, vấn đề & gaps

1. **File hotspot**: `documents.ts` ~148KB, khó bảo trì; context 17KB; cần tiếp tục tách theo workflow.
2. **Incoming/PO tracking chưa rõ**: spec yêu cầu "Đang về" (incoming) theo PO; backend hiện chỉ có RECEIPT, chưa thấy module purchase order/incoming aggregation. Cần xác nhận tích hợp Purchasing.
3. **MISA sync chưa gọi API thực**: hiện chỉ prepare queue + mapping + reconcile; sync thực tế phụ thuộc integration ngoài. Cần contract/endpoint MISA.
4. **Frontend test thiếu**: không có E2E/unit cho 28 trang kho; rủi ro regression UI.
5. **Admin không xem được kho**: D4 có thể gây khó khăn hỗ trợ; cần chốt policy.
6. **Scheduler concurrency**: expiry chạy `setInterval` trong process; multi-instance có thể race; nên dùng distributed lock/job queue.
7. **Stock reports test dùng node:sqlite**: có thể che khác biệt SQL dialect so với MySQL production.
8. **Pagination không đồng nhất**: một số endpoint trả array không có total; FE khó phân trang chính xác.
9. **Product master còn thiếu trường spec** (brand/model/costing method) trong products cơ bản; tracking đã backfill nhưng governance master data cần rõ ownership.
10. **Exception/warranty flow** có location purpose và serial status, nhưng cần kiểm tra đầy đủ state machine Return → Quarantine/Warranty → Saleable/Damaged/Return supplier ở UI/backend.
11. **Bundle virtual buildable** tính từ available; cần đảm bảo không oversell khi component reserved đồng thời.
12. **Performance potential**: transaction gate tuần tự hóa toàn bộ request có thể bottleneck cao tải; cần benchmark.

---

## 11. Đề xuất cải tiến

1. **Refactor documents.ts** thành các module nhỏ: receipt, issue, transfer, return, processing, serial/lot handlers; giữ context chung.
2. **Chuẩn hóa API list** trả `{ rows, total }` + header `X-Total-Count` cho tất cả endpoint lớn.
3. **Bổ sung Incoming tracking** từ Purchasing/PO và hiển thị trong inventory/report.
4. **Hoàn thiện MISA integration** theo contract, idempotency, retry, reconciliation tự động có approval.
5. **Thêm E2E tests** (Playwright) cho luồng receipt → issue → transfer → count → reservation.
6. **Distributed lock** cho scheduler expiry (hoặc job queue).
7. **Benchmark transaction gate** và cân nhắc connection pool/queue tuning.
8. **Chốt policy Admin vs Warehouse** (D4) và document rõ.
9. **State machine document** chuẩn hóa status và transition validation tập trung.
10. **Master data governance**: thêm brand/model/costing method và permission quản lý.

---

## 12. Kết luận

Module Kho vận đã được triển khai **rất đầy đủ và đúng kiến trúc ledger** so với spec V8.2: chứng từ, tồn, serial/lô, combo, kiểm kê, reservation, cảnh báo, MISA, audit. Điểm mạnh lớn nhất là tính toàn vẹn dữ liệu (immutable ledger + transaction). Các rủi ro chính nằm ở **độ phức tạp file hotspot, thiếu test UI, tích hợp MISA/PO chưa hoàn thiện và chính sách Admin**. Ưu tiên refactor + test + hoàn thiện tích hợp để đưa vào production ổn định.
