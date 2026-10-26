# Phân tích Module Kho vận (Warehouse/Stock) — Tran Le Tasks

> **Phiên bản:** v3 — **26/10/2026** (v2 cùng ngày; v3 ghi nhận kết quả đợt fix).
>
> **Thay thế:** bản `24/10/2026`. Bản cũ tập trung vào độ phủ tính năng. Bản này đọc lại toàn bộ mã nguồn hiện tại, đối chiếu spec và **ưu tiên các lỗi có thể làm sai tồn kho / sai phạm vi dữ liệu**. Các kết luận "đã đạt" ở bản cũ chỉ được giữ khi còn đúng với mã nguồn hôm nay.
>
> **Mã nguồn phân tích:** nhánh `refactor/warehouse-optimization`. Phần khảo sát đọc tại HEAD `c7c8373` (24/10/2026 18:53); phần **kết quả fix** đọc tại HEAD `2dcc831` (26/10/2026) sau 3 release commit `01f5c2c`, `c1929c2`+`1d56fe4`, `216979a`+`9e3eb49`+`78251fd`, `2dcc831`.
>
> **Phạm vi:** backend `backend/routes/stock/*`, `backend/routes/warehouses.ts`, `backend/routes/stockReports.ts`, `backend/services/stockAlerts.ts`, `backend/services/rbacService.ts`, `backend/utils/stockTransaction.ts`, `backend/utils/stockReserved.ts`; frontend `frontend/pages/Warehouse/*`, `frontend/services/stockService.ts`, menu/layout; test backend; schema trong `backend/db_mysql.ts`.
>
> **Tài liệu tham chiếu:** `new-base/tranle_system_docs/09_KHO_VAN.md`, `23_STATE_MACHINE.md`, `25_BUSINESS_RULES.md`.
>
> **Phương pháp:** đọc mã tĩnh, đối chiếu từng endpoint với spec, đọc test hiện có để xem hành vi nào đang được "khóa". Mọi kết luận đều kèm `file:dòng` để có thể kiểm chứng lại. Khác bản v2: đợt fix đã **chạy** `npm run typecheck` + `npx vitest run` (48 file / **520 case** xanh) sau từng bước.

---

## 0. Tóm tắt điều hành

Module Kho vận là phân hệ lớn thứ hai sau Tasks: **5.639 dòng** trong `backend/routes/stock/*` (18 file), **41 file / 13.269 dòng** frontend, **48 file test / 520 case / 8.176 dòng**. Tính năng rất rộng: nhập, xuất, điều chuyển, trả hàng, kiểm kê, serial/lô, combo, giữ hàng, cảnh báo Min/Max, tồn lâu, bất thường, MISA, audit log.

Nếu xét theo tiêu chí **"có thể dùng làm sổ tồn kho chính thức"**, bản v2 kết luận module **chưa đạt** vì ba nhóm lỗi: RBAC hở ở lớp quản trị kho, luồng chứng từ bị "serial hóa" cưỡng bức, và nhiều luồng ghi thẳng `stock_balances`/`stock_moves` bỏ qua ledger chuẩn.

### 0.1 Trạng thái sau đợt fix 26/10

Đợt fix chia 3 release (Phase A+B → release 1, Phase D → release 2, Phase C → release 3 có cửa sổ bảo trì). **Đã xong và đã có test:**

| Nhóm | Nội dung đã đóng | Bằng chứng |
|---|---|---|
| **Toàn vẹn ledger** (A1–A5) | `stock_balances.reserved` chỉ còn **một** nơi ghi: `adjustReserved` (`backend/utils/stockReserved.ts`) với 4 chuỗi SQL đóng băng; consume reservation và approve kiểm kê đi qua `postMove`; hủy chứng từ nằm trong transaction | `backend/tests/stockReservedLedger.test.ts`; `stockReservationsIssuePhase6.test.ts`; `stock.test.ts` |
| **Concurrency** (A6) | Bỏ hoàn toàn nhánh khóa **toàn bảng `warehouses`**; cả **37 call-site** `beginStockTransaction` đều truyền đúng kho (fallback khóa toàn bảng còn trong helper nhưng không còn nơi gọi), gồm scheduler `reservationExpiry` (trước đây khóa mọi kho mỗi 5 phút) | `backend/tests/warehouseRegression.test.ts` (assert SQL lock theo `id IN (?)`) |
| **Guard & lỗi** (A7–A9) | Hold/release reservation bị **409** khi kho đang kiểm kê; bỏ `.catch(() => …)` ở các guard (fail-closed); lỗi DB trả 500 thay vì 400 và không lộ message MySQL | `backend/tests/stockCountingGuard.test.ts` |
| **Chuẩn hóa** (A10) | `locationId` khi ghi balance dùng `\|\| ''` khớp PK/DDL (`NOT NULL DEFAULT ''`), hết rủi ro lỗi 1048 ở STRICT mode | `warehouseRegression.test.ts:118` |
| **RBAC** (B1–B5) | `GET /api/warehouses` scope-filter (giữ Admin); `/next-code` check scope nhưng **không** bắt buộc `warehouseId` (tương thích FE); thống nhất `requireWarehouseManager`; guard xóa kho 9 bảng + dọn balance; chỉ người đếm/quản lý mới sửa số đếm | `warehouseCrud.test.ts`; `stock.test.ts`; `stockCountOwnership.test.ts` |
| **Phân trang** (B6) | `misa-logs` phân trang thật + `X-Total-Count` (bỏ `LIMIT 200` cứng) | `stockPerformance.test.ts` |
| **Bảo trì** (D) | `documents.ts` **3.069 → 22 dòng**: 1 context dùng chung + 5 sub-router theo workflow + schema riêng; thứ tự đăng ký route giữ nguyên tuyệt đối | `backend/tests/stockRouteSurface.test.ts` (81 route, so khớp **có thứ tự**) |
| **Schema** (C) | v44 index hot-path, v45/v46/v47 DECIMAL; `ensureColumnType` idempotent; DDL fresh đồng bộ; driver `decimalNumbers` | `backend/tests/dbBootstrap.test.ts` (10 case) |

**Chưa đóng (vẫn là P0/P1):** state machine đầy đủ theo spec (§3), ép `serialRequired = 1` (§3.1), sửa chứng từ xóa/tạo lại dòng (§5.4), transfer/return location-lô (§3.3–3.4), MISA sync thật (§3.8), UI cho LOT/QUANTITY (§6). Danh sách đầy đủ ở §9.

### 0.2 Ba kết luận lớn (giữ nguyên từ v2)

1. **Phân quyền theo kho chưa được thực thi đầy đủ.** *(Đã siết ở lớp đọc/ghi kho và danh mục — xem 4.2; vẫn còn lớp permission `warehouse.manage` chưa có.)*
2. **Luồng chứng từ bị "serial hóa" cưỡng bức.** *(Chưa fix — P0-3/P0-4.)*
3. **Nhiều luồng ghi thẳng `stock_balances`/`stock_moves`, bỏ qua ledger chuẩn.** *(Đã đóng 2/3 nguồn: count approve và reservation consume; còn serial đổi location/status và scan-out `RESERVED`.)*

Ngoài ra: hủy chứng từ **đã** nằm trong transaction (v2 nêu là lỗi); MISA vẫn chỉ là **hàng đợi nội bộ**; kiểm kê vẫn không có `REVIEW → APPROVED → ADJUSTED` như spec.

### Bảng lỗi P0 — trạng thái sau đợt fix

| # | Lỗi | Bằng chứng (v2) | Trạng thái |
|---|---|---|---|
| **P0-1** | Danh mục kho trả toàn bộ kho cho mọi user | `warehouses.ts:12-18` | **Đã fix** (B1): scope-filter, Admin/Director+ giữ danh mục đầy đủ |
| **P0-2** | Manager bất kỳ sửa/xóa mọi kho, không kiểm tra scope | `warehouses.ts:22-25`, `88-108`, `111-146` | **Một phần** (B4): guard xóa kho 9 bảng; PUT/DELETE vẫn chưa `requireWarehouse` |
| **P0-3** | Mọi dòng hàng bị ép `serialRequired = 1`; `progress` hardcode SERIAL | `documents.ts:598`, `354`, `2703-2708` (nay `documentContext.ts`/`documentsSerialScan.ts`) | **Còn** |
| **P0-4** | `canComplete` ưu tiên serial trước LOT; `/lots/register` không gỡ được chặn | `documents.ts:842-844`, `873-888`, `3010-3037` | **Còn** |
| **P0-5** | Duyệt kiểm kê ghi thẳng balance + move, bỏ qua `postMove` | `counts.ts:278-298` | **Đã fix** (A4): `postMove` + `skipCountingCheck`, có audit log từng move |
| **P0-6** | Sửa chứng từ đã xử lý xóa/tạo lại dòng, mất liên kết serial/lô/reservation | `documents.ts:314-319`, `335-342` | **Còn** |
| **P0-7** | Hủy chứng từ không transaction; nhả reservation/serial/lô trước khi đổi trạng thái | `documents.ts:210-228` | **Đã fix** (A5): transaction + ROLLBACK, test failure injection |
| **P0-8** | Serial đổi vị trí/trạng thái trực tiếp, không tạo move | `serials.ts:131-180`; `documents.ts:2519-2522` | **Còn** (scan-out vẫn chỉ đổi `stockStatus`; `reserved` đã có nơi ghi duy nhất nên fix sau sẽ an toàn hơn) |

> **Khuyến nghị:** vẫn chưa nên tuyên bố module "hoàn thiện" hoặc dùng làm sổ tồn chính thức khi P0-3, P0-4, P0-6, P0-8 còn mở. Riêng P0-5/P0-7 đóng nghĩa là **ledger không còn bị ghi tắt ở hai luồng nghiệp vụ chính**; P0-3/P0-4 là **chặn tính năng** (LOT/QUANTITY), không làm sai số liệu đã ghi.

---

## 1. Phạm vi, phương pháp và giới hạn

### 1.1 Những gì đã đọc

**Backend**

- `backend/routes/stock.ts` (aggregator), `stock/context.ts`, `documents.ts` (toàn bộ 3.050 dòng lúc khảo sát; nay tách thành `documentContext.ts` + 5 sub-router + `documentSchemas.ts`), `warehouses.ts`, `balances.ts`, `reservations.ts`, `counts.ts`, `locations.ts`, `bundles.ts`, `serials.ts`, `monitoring.ts`, `misa.ts`, `activityLogs.ts`, `stockReports.ts`, `utils/stockTransaction.ts`, `utils/stockReserved.ts`, `services/stockAlerts.ts`, `services/rbacService.ts`.
- Các scheduler liên quan giữ hàng hết hạn và cảnh báo tồn.

**Frontend**

- `stockService.ts`, `StockDocsPage.tsx`, `DocCreateModal.tsx`, `DocDetailModal.tsx`, `SerialDocMode.tsx`, `CountPage.tsx`, `MisaPage.tsx`, `ReportsPage.tsx`, `Sidebar.tsx`, `departmentMenus.ts`, `utils/tracking.ts`, `AvailableInventoryReference`.

**Test**

- Danh sách toàn bộ 48 file test backend (thời điểm khảo sát v2: 45 file); đọc kỹ `stock.test.ts`, `warranty.test.ts`, `stockPerformance.test.ts`, `warehouseFrontend.test.ts` và các suite stock chính.

**Tài liệu**

- `09_KHO_VAN.md` (§3, §20, §21, §22, §33), `23_STATE_MACHINE.md`, `25_BUSINESS_RULES.md`.

### 1.2 Quy mô hiện tại (sau Phase D)

| Thành phần | Số liệu |
|---|---|
| Backend route kho (`backend/routes/stock/*.ts`) | 18 file, **5.639 dòng** |
| `documents.ts` | **22 dòng** (chỉ ghép 5 sub-router); code thật ở `documentContext.ts` 1.342 + 5 sub-router 1.758 + `documentSchemas.ts` 90 |
| Aggregator & module phụ | `stock.ts` 34, `warehouses.ts` 177, `stockReports.ts` 121, `utils/stockTransaction.ts` 21, `utils/stockReserved.ts` 47 |
| Frontend `pages/Warehouse` | **41 file**, **13.269 dòng** |
| Backend test | **48 file**, **520 case**, **8.176 dòng** |
| Suite trực tiếp liên quan kho | 17 suite |

### 1.3 Giới hạn

- Phần **khảo sát v2** không chạy test toàn bộ (phụ thuộc MySQL/env); kết luận về hành vi dựa trên mã và test hiện có. Phần **fix 26/10** đã chạy `npx tsc --noEmit` + `npx vitest run` sau từng bước (48 file / 520 case xanh), nhưng **không có integration test với MySQL thật** — `db` vẫn là mock, nên chưa chứng minh được hành vi DDL/thời gian ALTER.
- Không kiểm thử xâm nhập thực tế; các lỗi RBAC được suy ra từ việc đọc guard và query.
- Không đánh giá hiệu năng thực đo; chỉ nêu các điểm có rủi ro hiệu năng rõ ràng (khóa toàn bộ kho, thiếu index, query không pagination).
- Báo cáo v2 chỉ phân tích, không sửa mã. Đợt fix 26/10 sửa mã theo kế hoạch đã duyệt; mọi thay đổi đều có commit riêng và test đi kèm (xem 0.1).

### 1.4 Vì sao phải làm lại bản 24/10

Bản 24/10 mô tả module theo hướng "đã có nhiều tính năng" và dùng chính test hiện có làm bằng chứng hoàn thiện. Nhưng test hiện tại đang **khóa hành vi cũ**, không khóa spec. Ví dụ:

- `stock.test.ts:777-793` chủ động kỳ vọng kiểm kê đi `COUNTING → DONE` và ghi thẳng `INSERT INTO stock_moves`, trong khi spec yêu cầu `COUNTING → REVIEW → APPROVED → ADJUSTED → CLOSED`.
- `warranty.test.ts:86-92` chỉ kiểm tra timeline có một move rỗng, không kiểm tra lỗi timeline bị lẫn move của cả chứng từ.

Vì vậy, "test xanh" không đồng nghĩa "đúng nghiệp vụ". Bản này đối chiếu trực tiếp với spec và mã.

---

## 2. Kiến trúc và mô hình dữ liệu

### 2.1 Bản đồ route

| Sub-router | File | Trách nhiệm |
|---|---|---|
| Documents (ghép) | `stock/documents.ts` (22 dòng) | Chỉ `createDocumentContext` + `router.use` 5 sub-router theo đúng thứ tự cũ |
| ├ Core | `stock/documentsCore.ts` (482) | List/summary/detail, cancel, delete, PUT, `next-code`, progress |
| ├ Create | `stock/documentsCreate.ts` (57) | `POST /receipts`, `/issues`, `/transfers`, `/returns` (một bảng cấu hình lặp) |
| ├ Posting | `stock/documentsPosting.ts` (378) | processing-complete, complete từng loại, ship/receive transfer, relocations |
| ├ Serial scan | `stock/documentsSerialScan.ts` (655) | `/serials/edit`, `/serials/scan`, `/serials/scan-return`, `/serials/scan-out`, `/serials/scan-smart`, enable-serial, confirm-qty/no-serial |
| └ Lots | `stock/documentsLots.ts` (186) | `/lots/allocate`, `/lots/register` |
| Helper dùng chung | `stock/documentContext.ts` (1.342) | `createDocument`, `validateLines`, `preflightPosting`, `postDocumentMoves`, serial/lot, reservation link |
| Schema | `stock/documentSchemas.ts` (90) | Zod line/document + `DOC_CODE_PREFIX` + `DEFAULT_VAT_RATE` |
| Counts | `stock/counts.ts` | Kiểm kê, snapshot, variance, approve/cancel |
| Reservations | `stock/reservations.ts` | Giữ hàng, release/consume |
| Serials | `stock/serials.ts` | Serial/lô CRUD, timeline, tra cứu |
| Locations | `stock/locations.ts` | Vị trí/khu trong kho |
| Balances | `stock/balances.ts` | Tồn kho, khả dụng, chi tiết theo sản phẩm-kho |
| Bundles | `stock/bundles.ts` | Combo/bộ sản phẩm, assemble/disassemble |
| Monitoring | `stock/monitoring.ts` | Moves ledger, reconciliation, anomalies, policies, slow stock |
| MISA | `stock/misa.ts` | Mapping, sync queue, reconcile, log |
| Activity Logs | `stock/activityLogs.ts` | Audit log kho |
| Reports | `stockReports.ts` | Nhập–xuất–tồn, tổng hợp |
| Warehouses | `warehouses.ts` | CRUD kho + 7 vị trí mặc định + gán scope |

**Hotspot bảo trì: đã xử lý (Phase D).** `documents.ts` từ **3.069 dòng / 29 endpoint** rút còn **22 dòng**; helper `createDocument`/`preflightPosting`/`postDocumentMoves` chỉ tồn tại **một bản** trong `documentContext.ts` (không nhân bản sang sub-router), tránh đúng rủi ro lớn nhất của việc tách file. Thứ tự đăng ký route giữ nguyên byte-for-byte — được khóa bằng `backend/tests/stockRouteSurface.test.ts` (so khớp **có thứ tự** 81 cặp `METHOD path`, gồm cả hai bẫy `/documents/processing-summary` trước `/documents/:id` và `/serials/edit` trước `serials.ts`).

### 2.2 Ledger và transaction

Thiết kế **đúng về ý tưởng**, và sau đợt fix 26/10 thì **bất biến đã được thực thi đúng ở mọi điểm ghi**:

- `stock_moves` là ledger bất biến, mỗi biến động có `quantity` ±, `moveType`, `referenceType/Id`, `documentLineId`, `serialId`, `lotId`.
- `stock_balances` là projection (`onHand`, `reserved`), cập nhật bằng `ON DUPLICATE KEY UPDATE`.
- `postMove` ghi move + upsert balance + activity log trong cùng transaction (`context.ts`).
- `postMoves` gộp batch khi nhiều dòng.
- `beginStockTransaction` + `dbTransactionGate` tuần tự hóa trên connection dùng chung, có khóa theo warehouse.
- `assertNotCounting` chặn ghi sổ khi kho đang kiểm kê.
- **`reserved` không phải sự kiện ledger**: nó không bao giờ tạo `stock_move`. Vì vậy `reserved` có **một nơi ghi duy nhất**: `adjustReserved` trong `backend/utils/stockReserved.ts`, với 4 chuỗi SQL đóng băng trong `RESERVED_SQL` (`DECREMENT`, `DECREMENT_CLAMPED`, `ONHAND_AND_RESERVED`, `HOLD_UPSERT`). Test `stockReservedLedger.test.ts` so khớp **nguyên văn** từng chuỗi và thứ tự tham số, nên refactor không thể lặng lẽ đổi SQL đang được các test nghiệp vụ assert.
- Consume reservation (`settleReservation`) và approve kiểm kê đều đi qua `postMove`, kèm `skipCountingCheck: true` vì guard `assertNotCounting` đã chạy trước đó trong cùng request (gọi lại sẽ ném 409 trùng).

**Vấn đề khóa theo warehouse: đã đóng (A6).** Trước đây nhiều chỗ gọi `beginStockTransaction(db)` không truyền danh sách kho, nghĩa là khóa **toàn bộ bảng `warehouses`**:

- `createDocument` (nay `documentContext.ts`)
- `PUT /documents/:id` (nay `documentsCore.ts`)
- `POST/PUT/DELETE /serials` (`serials.ts`)
- `POST/DELETE /documents/:id` và scheduler `reservationExpiry` (mỗi 5 phút, **cho từng** reservation)

Nay mọi call-site đều truyền kho cụ thể (`[warehouseId]`, `[...docWarehouseIds(doc)]`, `[source, dest]` cho transfer, `[candidate.warehouseId]` cho scheduler — query candidate đã được đổi sang `SELECT id, warehouseId …`). Test `warehouseRegression.test.ts` assert SQL lock có dạng `SELECT id FROM warehouses WHERE id IN (?) ORDER BY id FOR UPDATE` và **không** tồn tại `SELECT id FROM warehouses ORDER BY id FOR UPDATE`.

### 2.3 Mô hình dữ liệu

**24 bảng kho** (đếm theo hằng `DDL` trong `backend/db_mysql.ts`):

- `warehouses`, `stock_locations`, `user_warehouse_scopes`
- `stock_documents`, `stock_document_lines`, `stock_document_line_lots`, `stock_document_line_reservations`, `stock_transfer_line_lots`
- `stock_moves`, `stock_balances`
- `reservations`
- `stock_serials`, `stock_lots`, `stock_lot_movements`
- `product_bundles`, `product_bundle_items`
- `stock_counts`, `stock_count_lines`
- `product_warehouse_policies`
- `misa_mappings`, `misa_sync_logs`
- `warehouse_activity_logs`
- `stock_alert_state` (trạng thái cảnh báo để scheduler không gửi lặp)

**Điểm mạnh:** có đủ bảng để mô hình hóa ledger + serial + lô + reservation + kiểm kê + audit.

**Điểm yếu schema (cập nhật sau Phase C):**

- `stock_moves`/`stock_balances` **không có FK/CHECK**; có thể insert quantity sai, location không tồn tại, product không tồn tại nếu code cho phép. *(Còn — cố ý chưa làm vì ảnh hưởng dữ liệu cũ.)*
- `stock_documents.status`, `stock_counts.status` là `VARCHAR` tự do, không constraint → dễ sinh trạng thái ngoài state machine. *(Còn.)*
- `stock_serials.serialNumber` unique toàn cầu (đúng cho serial), nhưng `stock_lots` unique theo `(productId, warehouseId, lotCode)` → cùng mã lô ở hai kho khác nhau là hai bản ghi, cần lưu ý khi đối chiếu. *(Giữ nguyên có chủ đích: đổi UNIQUE của serial cần dedupe dữ liệu thật.)*
- Không có bảng `stock_document_status_history`; audit log là nơi duy nhất lưu vết trạng thái. *(Còn.)*
- **Đã cứng hóa kiểu số (v45–v47):** toàn bộ số lượng/tiền của kho chuyển `DOUBLE → DECIMAL(18,3)` (số lượng), `DECIMAL(7,4)` (`vatRate`), `DECIMAL(18,2)` (`products.*Price`). DOUBLE cộng dồn sai số nhị phân làm lệch ledger/kiểm kê. Driver bật `decimalNumbers` để cột DECIMAL vẫn về `number` như trước.
- **Đã thêm index hot-path (v44):** `reservations(status, expiresAt)` cho scheduler, `products(name)` + `products(importCode)` (trước đó `products` **không có index nào**), `stock_balances(warehouseId, productId)` cho đối soát/guard xóa kho, `stock_serials(productId, serialNumber)` cho lookup khi ghi sổ.

### 2.4 Scheduler

- `reservationExpiry` tự release giữ hàng hết hạn mỗi 5 phút. Vòng quét được bảo vệ bằng `GET_LOCK` (khóa liên tiến trình) nên hai instance không release trùng.
- **Đã fix (A6): scheduler không còn khóa toàn bộ kho.** Trước đây `releaseExpiredInContext` mở transaction bằng `beginStockTransaction(db)` cho **từng** reservation (`reservationExpiry.ts`), nghĩa là khóa toàn bảng `warehouses`; nay candidate query đọc thêm `warehouseId` và transaction chỉ khóa `[candidate.warehouseId]`.
- Cảnh báo tồn kho dựa trên `available` của các location `SALEABLE` (`stockAlerts.ts:44-67`) — phần này **đúng**.
- Reservation hết hạn vẫn có thể được link bởi `syncDocumentReservationLinks` vì hàm **không kiểm tra `expiresAt`** (`documentContext.ts`) → **(Còn, P1)**.

---

## 3. Luồng nghiệp vụ end-to-end

### 3.1 Nhập kho (RECEIPT)

**Luồng hiện tại**

1. Tạo chứng từ `DRAFT`, sinh mã `PREFIX-YY-NNNN`, ghi dòng hàng.
2. Quét serial/lô để chuyển dòng sang `PARTIAL`/`COMPLETED`.
3. Khi tất cả dòng xong, chứng từ tự chuyển `READY` (`documents.ts:2294-2309`).
4. Complete: ghi `stock_moves` loại `RECEIPT`, upsert balance, tạo `stock_serials`, tạo `stock_lots`.
5. Có thể `resetProcessing` để làm lại.

**Lỗi nghiêm trọng**

- **Mọi dòng bị ép serial.** `createDocument` insert `serialRequired = 1` cho tất cả sản phẩm (`documents.ts:598`), không phân biệt `products.tracking`. `validateLines` còn bắt buộc số lượng nguyên cho mọi dòng vì lý do "mỗi đơn vị cần quét một Serial riêng" (`documents.ts:727-733`).
- **LOT không thể hoàn tất.** `requiresSerial` trả true nếu `serialRequired = 1` **hoặc** tracking SERIAL (`documents.ts:842-844`). Vì mọi dòng mới đều có cờ 1, nhánh LOT trong `canComplete` (`883-888`) **không bao giờ được chạy**. `/lots/register` có thể đánh dấu dòng `COMPLETED` (`3010-3037`), nhưng khi complete, `canComplete` vẫn đòi `serials.length === quantity` và chặn.
- **Một mã lô không đại diện được số lượng > 1.** `registerReceiptSerials` yêu cầu `serials.length === line.quantity` (`documents.ts:1184-1190`), trái với chính comment "1 mã cho cả dòng SL>1 → lưu dạng lô". Nghiệp vụ nhập lô (1 mã lô cho 100 mét dây) không thể đi qua endpoint này.
- **Reset có thể xóa lô đã dùng.** `resetDocProcessing` xóa `stock_lots WHERE receiptDocumentId = ?` và lot movements (`documents.ts:943-955`); nếu serial đã OUT thì trả 409, nhưng nếu lô đã được phân bổ cho phiếu xuất mà chưa có serial thì có thể bị xóa, làm mất truy vết.
- **`progress` hardcode SERIAL.** `documents.ts:2703-2708` đặt `serialRequired = true`, `tracking = 'SERIAL'`, `lots = []`; frontend `SerialDocMode` vì thế luôn render `SerialBox` (`SerialDocMode.tsx:375`), còn `QuantityBox`/`LotBox`/`EnableSerialBox` (khai báo tại `387`, `629`, `795`) **không bao giờ được dùng**.

**Đối chiếu spec:** spec yêu cầu phân biệt SERIAL / LOT / QUANTITY và cho phép nhập theo lô. Hiện tại **không đạt** cho LOT và QUANTITY.

### 3.2 Xuất kho (ISSUE)

**Luồng hiện tại**

1. Tạo phiếu `DRAFT`, có thể link reservation.
2. Quét serial OUT: serial chuyển `RESERVED`, gắn `issueDocumentId`, `issueLineId`.
3. Complete: `canComplete` kiểm tra đủ serial + đủ available, ghi move `ISSUE`, serial chuyển `OUT`, cập nhật balance.

**Lỗi**

- **Scan-out không cập nhật `stock_balances.reserved`.** *(Còn — P0-8.)* `documentsSerialScan.ts` chỉ đổi `stock_serials.stockStatus = 'RESERVED'`. Vì vậy:
  - Báo cáo tồn/khả dụng theo số lượng **không thấy** lượng đã quét giữ.
  - Serial có thể nằm `RESERVED` vô thời hạn nếu phiếu bị bỏ dở; scheduler chỉ release `reservations`, không release serial treo.
  - Ghi chú cho người fix sau: `reserved` giờ chỉ được ghi qua `adjustReserved` (`backend/utils/stockReserved.ts`) — không được thêm `UPDATE stock_balances SET reserved …` mới.
- **`confirm-qty` từ chối mọi sai lệch.** `documents.ts:2803-2807` bắt `actualQty === expected`, nên endpoint "xác nhận số lượng" không dùng được cho kiểm đếm thực tế. Frontend vẫn gọi (`SerialDocMode.tsx:808`).
- **`confirm-no-serial` luôn 400.** `documents.ts:2834-2840` trả lỗi cố định; frontend vẫn gọi (`SerialDocMode.tsx:427`). Đây là endpoint chết.
- **`consumeIssueLots` tính sai số lượng ở nhánh một dòng.** Nhánh single-line dùng `line.quantity` thay vì `effectiveLineQuantity` (`documents.ts:1300`), nên nếu có `actualQty` điều chỉnh thì lượng lô bị tiêu thụ sai.
- **Reservation hết hạn vẫn được link.** `syncDocumentReservationLinks` khóa reservation nhưng không kiểm tra `expiresAt` (`documents.ts:1024-1084`).

**Đối chiếu spec:** spec yêu cầu reserve từ available + SALEABLE, release khi cancel/expiry, consume khi ISSUE DONE, reservation **không** tạo stock_move. Luồng hiện tại gần đúng nhưng thiếu đồng bộ serial/reserved.

### 3.3 Điều chuyển (TRANSFER)

**Luồng hiện tại**

1. Tạo phiếu `DRAFT` với `sourceWarehouseId`, `destWarehouseId`.
2. Ship: ghi move OUT, chuyển `IN_TRANSIT`.
3. Receive: ghi move IN, chuyển `COMPLETED`.

**Lỗi**

- **Nhận serial dồn một location.** `receiveTransferSerials` di chuyển **tất cả** serial `RESERVED` của chứng từ về **một** `locationId` (`documents.ts:1458-1471`), bỏ qua location đích của từng dòng.
- **`postTransferMoves` dùng một `destinationLocation` cho mọi dòng IN**, trong khi OUT dùng `line.locationId` (`documents.ts:1728`). Nếu mỗi dòng có đích khác nhau, tồn bị dồn sai vị trí.
- **MISA queue không thấy TRANSFER của manager có scope.** Filter `JSON_EXTRACT(payload, '$.document.warehouseId')` (`misa.ts:141`) không khớp phiếu transfer vì `warehouseId` null; phiếu transfer biến mất khỏi queue của manager được phân kho.
- **State machine thiếu bước `RECEIVED`.** Spec yêu cầu `DRAFT → CONFIRMED → IN_TRANSIT → RECEIVED → DONE`; code dùng `READY → COMPLETED`.

**Đối chiếu spec:** **không đạt** về state machine và phân bổ đích theo dòng.

### 3.4 Trả hàng (RETURN)

**Luồng hiện tại**

1. Tạo phiếu RETURN, tham chiếu phiếu xuất gốc.
2. Quét serial trả, đăng ký lô trả.
3. Complete: serial về kho, lô được tạo/cộng lại.

**Lỗi**

- **Mỗi phiếu trả chỉ xử lý một phiếu xuất gốc.** `registerReturnSerials` yêu cầu `issueDocumentId === doc.referenceId` (`documents.ts:1800`). Trả hàng từ nhiều phiếu xuất trong cùng một chuyến bị từ chối.
- **Mất danh tính lô nguồn.** `registerReturnLots` lấy `parseSerials(line.serialLot)[0]` làm mã lô và gộp toàn bộ số lượng trả vào một lô (`documents.ts:1817-1860`). Không thể biết hàng trả thuộc lô nào của phiếu xuất gốc.
- **Return không có state `RECEIVED`/`INSPECTED`**; hàng trả về thẳng kho bán được, không qua kiểm định.

**Đối chiếu spec:** **không đạt** về truy vết lô nguồn và trả nhiều nguồn.

### 3.5 Kiểm kê (COUNT)

**Luồng hiện tại**

1. Tạo đợt `COUNTING`, snapshot tồn theo sản phẩm + location.
2. Nhập `actualQty` từng dòng.
3. Approve: kiểm tra đủ dòng, `onHand === expectedQty`, `actualQty >= reserved`; ghi move `ADJUSTMENT` + cập nhật balance; đổi `DONE`.
4. Cancel: đổi `CANCELLED`.

**Lỗi nghiêm trọng**

- **State machine chỉ có `COUNTING → DONE` / `CANCELLED`** (`counts.ts:266`, `298`, `327`). Spec yêu cầu `DRAFT → COUNTING → REVIEW → APPROVED → ADJUSTED → CLOSED`. Không có bước review, không có người duyệt thứ hai, không có chứng từ điều chỉnh riêng.
- **Duyệt ghi thẳng ledger, bỏ qua `postMove`.** *(Đã fix ở A4.)* `counts.ts` nay gọi `postMove(..., { moveType: 'ADJUSTMENT', referenceType: 'COUNT', referenceId: count.id, documentLineId: line.id }, { skipCountingCheck: true })` — có activity log chuẩn cho **từng** dòng điều chỉnh, và mọi kiểm tra/chuẩn hóa của ledger đều chạy. Test `stock.test.ts` bổ sung assert `warehouse_activity_logs` có mặt sau approve.
  - **Vẫn còn:** `postMove` không cập nhật `stock_lots.remainingQty`/`stock_serials.stockStatus`. Điều chỉnh kiểm kê đổi đúng `stock_balances.onHand` nhưng lô/serial vẫn ở trạng thái cũ → cần bước đồng bộ hoặc job reconciliation (xem 5.3).
- **Không có `REVIEW`/`APPROVED`/`ADJUSTED`:** cùng một manager vừa đếm vừa duyệt, không có kiểm soát chéo.
- **Lộ chênh lệch với kiểm kê mù.** `GET /counts` trả `varianceLines` cho mọi đợt (`counts.ts:23-46`), kể cả khi đang kiểm kê mù; `GET /counts/variances` còn lọc sẵn các đợt có chênh lệch (`counts.ts:51-69`). Chi tiết dòng đã ẩn `expectedQty` với staff, nhưng staff vẫn biết **đợt nào có lệch và bao nhiêu dòng lệch** — đủ để suy đoán khi đợt nhỏ.
- **Có thể thêm dòng ngoài snapshot.** `POST /counts/:id/lines` cho phép thêm cặp product/location bất kỳ, lấy tồn hiện tại làm `expectedQty` → phá tính "snapshot tại thời điểm mở đợt". *(Còn. B5 chỉ chặn sửa số đếm của người khác — xem dòng dưới.)*
- **Số đếm không có chủ.** *(Đã siết ở B5.)* Trước đây bất kỳ nhân viên nào có scope cũng sửa được `actualQty` mà người khác vừa đếm. Nay khi dòng đã có `actualQty` và `countedBy` khác user, chỉ người đã đếm hoặc quản lý kho mới sửa được; còn lại **403**. Test: `stockCountOwnership.test.ts`.
- **Snapshot chứa dòng tồn 0** (`counts.ts:124-127`) và approve bắt buộc đếm **mọi** dòng (`270-273`) → đợt kiểm kê lớn rất khó đóng.
- **Cancel nuốt lỗi thành 500.** `counts.ts:316-337` catch trống, không log nguyên nhân.
- **Không kiểm tra thay đổi reservation sau khi đếm** ngoài điều kiện `actualQty >= reserved` tại thời điểm duyệt; nếu reservation thay đổi giữa lúc đếm và duyệt, chỉ có `onHand` được so lại.

**Đối chiếu spec:** **không đạt** gần như toàn bộ yêu cầu về quy trình kiểm kê.

### 3.6 Giữ hàng (RESERVATION)

**Luồng hiện tại**

1. Tạo reservation `HELD`, tăng `reserved`.
2. Release: giảm `reserved`, đổi `RELEASED`.
3. Consume: ghi move `ISSUE`, giảm `onHand` + `reserved`, đổi `CONSUMED`.

**Lỗi**

- **Consume ghi move thủ công, không qua `postMove`.** *(Đã fix ở A3.)* `settleReservation` nhánh `CONSUMED` nay gọi `postMove(..., { moveType: 'ISSUE', referenceType: 'RESERVATION', referenceId: r.id }, { skipCountingCheck: true })` và chỉ giảm `reserved` bằng `adjustReserved`. **Vẫn còn:** serial vẫn `IN_STOCK` trong khi `onHand` đã giảm — đồng bộ serial/lô khi consume là việc của P0-8.
- **Hold/release khi kho đang kiểm kê.** *(Hành vi MỚI có chủ đích ở A7.)* Trước đây nhân viên vẫn hold được hàng của kho đang `COUNTING`, làm `reserved` thay đổi giữa lúc kiểm kê. Nay cả `POST /reservations` và `POST /reservations/:id/release` trả **409** (`assertNotCounting`), đối xứng với nhánh consume. Đã thông báo cho phòng Kho vận; cần ghi vào changelog phát hành.
- **Tạo reservation kiểm tra available bằng query không khóa** (`reservations.ts:72`), chỉ dựa vào khóa warehouse. Nếu hai request cùng kho, khóa warehouse có thể đủ, nhưng không khóa row balance; nên dùng `FOR UPDATE` để chắc chắn.
- **Không hỗ trợ reservation theo serial/lô.** Spec yêu cầu reserve theo từng serial/lô; code chỉ giữ theo product/location.
- **Chỉ manager được tạo/release/consume** (`reservations.ts:59`, `109`), trong khi spec cho phép nhân viên xem reservation được giao. Ít nhất cần cho phép employee scoped xem và thao tác trên reservation của mình.
- **Reservation hết hạn vẫn link được** (xem 3.2).

### 3.7 Serial và Lô

**Luồng hiện tại**

- CRUD serial, tra cứu timeline, cập nhật trạng thái bảo hành.
- Lô: đăng ký nhập, phân bổ xuất, trả lô.

**Lỗi**

- **Manager có scope sửa `locationId` trực tiếp, không tạo move** (`serials.ts:131-180`). Tồn theo vị trí thay đổi mà ledger không có bút toán; báo cáo theo location sai. Code có chặn employee (`145-148`) nhưng không chặn manager.
- **Đổi `status` (DAMAGED/WARRANTY/...) không điều chỉnh balance/location.** Serial hỏng nằm ở location `SALEABLE` vẫn được tính là available.
- **Backfill serial có thể tạo `IN_STOCK` cho hàng đã xuất.** `POST /serials` (`serials.ts:74-113`) chỉ kiểm tra phiếu nhập đã `DONE`, không kiểm tra serial đã từng xuất hay chưa; nếu serial chưa được đăng ký lúc xuất, backfill sẽ tạo serial "IN_STOCK" trong khi `onHand` đã giảm.
- **Timeline bị lẫn move của cả chứng từ.** Query `serials.ts:248-255` dùng `OR (m.referenceType IN (...) AND (m.referenceId = receiptDocumentId OR issueDocumentId))`, trả về **mọi** move của chứng từ, không chỉ move của serial được hỏi. Timeline serial A có thể hiển thị move của serial B cùng phiếu. Route có kiểm tra scope theo `s.warehouseId` (`serials.ts:231`), nhưng nội dung timeline vẫn sai.

### 3.8 MISA

**Luồng hiện tại**

1. Mapping sản phẩm/kho sang mã MISA.
2. Prepare queue: tạo `misa_sync_logs` PENDING với payload JSON.
3. Xem queue/log.
4. "Reconcile": trả dữ liệu tồn nội bộ + mapping.
5. "Log reconcile": client gửi số liệu, server ghi log.

**Lỗi**

- **Queue-only, chưa đồng bộ thật.** `misa.ts:125-126` tự ghi rõ "Chưa gọi API MISA"; response prepare trả "Đã tạo hàng đợi nội bộ; chưa gửi dữ liệu sang MISA" (`misa.ts:191`). Không có worker gửi/nhận, retry, trạng thái lỗi, mapping phản hồi từ MISA. Đây là **P1** — khoảng cách tích hợp, chưa trực tiếp làm sai tồn kho.
- **`/misa-reconcile` không lấy dữ liệu từ MISA.** `misa.ts:195-248` chỉ query `products`, `stock_balances`, `misa_mappings` nội bộ. Không có kết nối MISA, không có file/API đối chiếu. Đây là "xem tồn nội bộ kèm mã MISA", không phải đối soát.
- **`/misa-reconcile/log` tin client.** `misa.ts:250-276` nhận `itemsCount`, `matchedCount`, `mismatchedCount`, `unmappedCount`, `notes` từ body và ghi log, không kiểm tra với dữ liệu thật. Bất kỳ manager nào cũng có thể ghi một log "MATCHED" giả.
- **Idempotency key cố định `v1`.** `misa.ts:183` dùng key `v1`; prepare lại sau khi chứng từ thay đổi sẽ bị `INSERT IGNORE` bỏ qua, payload cũ không được cập nhật.
- **Payload thiếu serial/lô.** `misa.ts:176-182` chỉ có header + dòng hàng cơ bản; không đủ để MISA đối chiếu serial/lô.
- **Queue chỉ hiện PUSH.** `misa.ts:136` lọc `direction='PUSH'`; log RECONCILE không nằm trong queue.
- **`misa-logs` không phân trang.** `LIMIT 200` cố định (`misa.ts:120`).
- **Mapping create/delete dùng raw `START TRANSACTION`** (`misa.ts:50`, `80`), bỏ qua transaction gate.
- **Frontend không có màn đối soát.** `MisaPage.tsx:26` chỉ có mapping/log và nút "Chuẩn bị queue sync".

**Đối chiếu spec:** **không đạt** yêu cầu "đối soát với MISA" và "audit log đối soát".

---

## 4. RBAC và bảo mật

### 4.1 Mô hình hiện tại

- Admin (level 99) bị chặn business data kho ở hầu hết route (`listScope` trả 403, `context.ts:314-319`).
- Director thấy tất cả.
- Manager/Employee bị giới hạn bởi `user_warehouse_scopes` qua `scopeOf`/`requireWarehouse`.
- Các route ghi chứng từ dùng `canReadDocument`/`canWriteDocument`.

Đây là mô hình **đúng hướng**, nhưng không được áp dụng nhất quán.

### 4.2 Bảng phát hiện

| Mức | Phát hiện | Bằng chứng | Trạng thái 26/10 |
|---|---|---|---|
| **P0** | `GET /api/warehouses` trả **tất cả** kho cho mọi user đã đăng nhập | `warehouses.ts:12-18` (v2) | **Đã fix (B1):** scope-filter; Admin + Director+ vẫn nhận danh mục đầy đủ (Admin cần cho UI gán scope — xem 4.3.1) |
| **P0** | `PUT /warehouses/:id` không kiểm tra scope | `warehouses.ts:88-108` (v2) | **Còn** — mới bổ sung guard xóa (B4), chưa thêm `requireWarehouse` cho PUT |
| **P0** | `DELETE /warehouses/:id` không kiểm tra scope | `warehouses.ts:111-146` (v2) | **Một phần (B4):** thêm 5 guard dữ liệu con + dọn `stock_balances`; chưa kiểm tra scope người thao tác |
| **P0** | `requireWarehouseManager` chỉ xét level ≥ 20 và ≠ 99, không xét quyền kho | `context.ts:321-324`, `warehouses.ts:22-25` | **Đã thống nhất (B3):** mọi route dùng chung helper, xóa ~7 bản sao inline; vẫn **chưa** có permission `warehouse.manage` |
| **P1** | Tạo kho tự gán scope cho nhân sự `tle-dept-kho`/`Kho vận`, hardcode | `warehouses.ts:68-75` | **Còn** |
| **P1** | `misa-logs`/`misa-mappings` global cho mọi manager | `misa.ts:17-27`, `110-121` (v2) | **Một phần (B6):** `misa-logs` phân trang + `X-Total-Count`; **chưa** lọc theo scope kho |
| **P1** | Reports yêu cầu level ≥ 20, không yêu cầu permission kho | `stockReports.ts:7-22` | **Còn** |
| **P1** | `GET /next-code` không kiểm tra scope | `documents.ts:639-651` (v2) | **Đã fix (B2):** scope rỗng → 403; `warehouseId` tùy chọn, ngoài scope → 403; Admin → 403 |
| **P2** | Admin thấy menu kho nhưng backend 403 | `Sidebar.tsx:90-93`, `departmentMenus.ts:152-218` | **Còn** |
| **P2** | Activity log search không tìm theo số serial/mã lô | `activityLogs.ts:39-43` | **Còn** |

### 4.3 Chi tiết các lỗi RBAC P0

#### 4.3.1 Catalog kho lộ toàn bộ — ĐÃ FIX (B1)

`warehouses.ts` (v2) ghi rõ: *"Danh mục kho: đọc cho mọi user"*. Hệ quả:

- Spec §33 yêu cầu nhân viên **chỉ thấy warehouse/location thuộc scope**.
- API trả cả `code`, `name`, `region`, `address` — nhiều hơn mức cần cho dropdown.
- Frontend `StockDocsPage` gọi `getWarehouses()` để đổ dropdown, nên nhân viên kho A thấy và có thể chọn kho B (dù thao tác sau đó bị chặn).

**Cách đã sửa:** route dùng trực tiếp `getWarehouseScope` (`services/rbacService.ts`) mà không đổi chữ ký router:

- `ADMIN` → **đầy đủ** mọi kho. Đây là **quyết định nghiệp vụ chốt ngày 26/10**: `frontend/pages/Admin/UserManagement.tsx:444` dùng chính endpoint này để gán scope cho user, chặn Admin sẽ làm hỏng UI đó. Quyết định được khóa bằng test (Admin nhận 2/2 kho) để không ai "sửa lại" sau này.
- `>= DIRECTOR` → mọi kho (query không `WHERE`, giữ nguyên).
- Còn lại → `WHERE id IN (…)` theo `user_warehouse_scopes`; scope rỗng → `[]`.

**Hệ quả cần biết:** nhân viên chưa được gán scope sẽ thấy dropdown kho **rỗng**. Đây là hành vi đúng (không lộ kho ngoài scope) nhưng khác trước — cần nhắc Admin gán scope khi tạo user kho.

**Test:** `backend/tests/warehouseCrud.test.ts` — Employee scope `['w1']` → chỉ `w1`; scope rỗng → `[]`; Admin → 2 kho; Director → 2 kho.

#### 4.3.2 Manager bất kỳ quản lý mọi kho — MỘT PHẦN

`requireWarehouseManager` (`context.ts:321-324`, `warehouses.ts:22-25`) chỉ kiểm tra:

```ts
level >= MANAGEMENT_LEVELS.MANAGER && level !== MANAGEMENT_LEVELS.ADMIN
```

Không kiểm tra:

- User có permission `warehouse.manage` không.
- User có scope trên kho đang sửa/xóa không.
- User có phải TP kho không.

Hệ quả: một manager phòng kinh doanh (level 20) có thể:

- Tạo kho mới, sửa/xóa **bất kỳ kho nào** — vì `PUT/DELETE /warehouses/:id` không gọi `requireWarehouse`.
- Quản lý location, bundle, reservation, count, MISA mapping trong kho **thuộc scope của mình** mà không cần permission kho; chỉ cần level ≥ 20. Các route này có `requireWarehouse` nên không vượt được scope, nhưng vẫn thiếu lớp permission theo vai trò.
- Với kho không thuộc scope, manager vẫn sửa/xóa được qua warehouse CRUD dù không thể tạo location trong kho đó.

**Cách sửa (trạng thái 26/10):**

- ~~Thêm permission `warehouse.manage` (hoặc `stock.admin`) vào RBAC.~~ **Chưa làm** — cần chốt danh sách permission với business trước.
- ~~Với `PUT/DELETE /warehouses/:id`, gọi `requireWarehouse(user, id)` trước khi thao tác.~~ **Chưa làm.** Riêng DELETE đã được tăng cường guard dữ liệu (B4): chặn xóa khi kho còn `stock_balances` có tồn/giữ, serial, lot, policy, mapping MISA, lot line, chứng từ; đồng thời dọn `stock_balances` trong transaction.
- ~~Với `POST /warehouses`, yêu cầu permission `warehouse.create`, không chỉ level.~~ **Chưa làm.**
- **Đã làm (B3):** thống nhất rule level bằng `requireWarehouseManager(user)` — xóa các bản sao inline `normalizeManagementLevel(...) < MANAGER || === ADMIN` trong `stock/*`, gồm `PUT /policies` (test mới: MANAGER 200 / EMPLOYEE 403 / ADMIN 403).
- Test: employee kho A không thấy kho B **đã có**; manager kho A sửa kho B **chưa có test** (vì code chưa chặn).

#### 4.3.3 Admin menu mismatch

`Sidebar.canSeeItem` (`Sidebar.tsx:90-93`):

```ts
if (permission && permission.some(p => hasPerm(p))) return true;
if (minLevel !== undefined && level !== 99 && level >= minLevel) return true;
if (!permission && minLevel === undefined) return true;
```

Các item kho không có `minLevel` (wh_stock, wh_receipt, wh_issue, wh_return, wh_transfer, wh_processing, wh_count, wh_serial, wh_bundle, wh_overview, my_tasks, my_history) **hiện với Admin**, nhưng backend chặn Admin ở `listScope`/`canWriteDocument`. Kết quả: Admin thấy menu, bấm vào nhận 403/empty.

**Cách sửa:** thêm `minLevel: 20` cho toàn bộ item kho (trừ item dành cho employee), hoặc thêm điều kiện `level !== 99` cho mọi item thuộc module kho.

**Quyết định chính sách cần chốt:** việc Admin bị chặn dữ liệu kho là **chủ đích kỹ thuật** (spec §33: Admin không tự có quyền business data nếu policy hiện tại chặn). Business cần xác nhận có cần tài khoản hỗ trợ/kiểm toán đặc biệt hay không. Nếu cần, tạo permission riêng (ví dụ `warehouse.support.read`, `warehouse.audit.read`) kèm audit bắt buộc — **không mở lại Admin mặc định**. Nếu không cần, chỉ cần sửa menu để Admin không thấy item kho.

### 4.4 Điểm tốt cần giữ

- `listScope` chặn Admin đúng ở nhiều route đọc.
- `requireWarehouse` được dùng ở hầu hết route ghi chứng từ, count, reservation, location.
- `canReadDocument`/`canWriteDocument` xử lý transfer (source/dest) và return.
- `scopeOf` lấy từ `user_warehouse_scopes`, không tin client.
- `stockAlerts` và `available-inventory` chỉ tính available từ location `SALEABLE` — đúng.
- *(Mới 26/10)* `GET /warehouses` và `GET /next-code` có scope; guard xóa kho phủ 9 loại dữ liệu con; số đếm kiểm kê có chủ; mọi route dùng chung `requireWarehouseManager`.

### 4.5 Kết luận RBAC

Mô hình phân quyền **đúng về ý tưởng**. Sau đợt fix 26/10, hai lỗ hổng đọc dữ liệu ngoài scope nghiêm trọng nhất đã đóng: catalog kho (`GET /api/warehouses`) và `GET /next-code`. Ba việc còn lại trước khi mở rộng nhiều kho/chi nhánh:

1. Thêm permission `warehouse.manage`/`warehouse.create` thay vì chỉ xét level.
2. `PUT/DELETE /warehouses/:id` gọi `requireWarehouse(user, id)`.
3. Scope hóa `misa-mappings`/`misa-logs` và báo cáo tài chính kho.

---

## 5. Toàn vẹn dữ liệu và concurrency

### 5.1 Khóa toàn bộ kho — ĐÃ FIX (A6)

`beginStockTransaction(db)` không truyền warehouse ID từng có ở: tạo/sửa chứng từ, tạo/sửa/xóa serial, và **scheduler release reservation hết hạn** (mỗi 5 phút). Vì `beginStockTransaction(db, [])` khóa **toàn bộ** bảng `warehouses` (`stockTransaction.ts`), hệ thống nhiều kho nhưng mọi thao tác ghi đều xếp hàng toàn cục.

Nay 10 call-site đều truyền đúng kho:

- Receipt/Issue/Return: `[warehouseId]`
- Transfer: `[sourceWarehouseId, destWarehouseId]` (lọc bỏ `null`)
- Document cancel/delete/put: `[...docWarehouseIds(doc)]`
- Serial tạo/sửa/xóa: `[warehouseId]` / `[existing.warehouseId]`
- Warehouse tạo/sửa: `[id]`
- Scheduler: `[candidate.warehouseId]` (candidate query đã select thêm `warehouseId`)

`createDocument` **cố ý** giữ lock rộng (cả 3 kho của phiếu) vì `nextDocCode` cần khóa rộng để chống trùng mã — thu hẹp thêm sẽ mở lại race sinh mã. Test chốt: `warehouseRegression.test.ts` assert `SELECT id FROM warehouses WHERE id IN (?) ORDER BY id FOR UPDATE` và **phủ định** tồn tại câu lock không có `WHERE`.

### 5.2 Các chỗ ghi thẳng balance/move

| Vị trí | Hành vi | Trạng thái |
|---|---|---|
| `counts.ts` (approve) | Trước: insert move + upsert balance trực tiếp | **Đã fix (A4)** — đi qua `postMove`, có activity log từng dòng |
| `reservations.ts` (consume) | Trước: insert move + `onHand/reserved` trực tiếp | **Đã fix (A3)** — `postMove` + `adjustReserved` |
| `reserved` (mọi nơi) | Trước: 5 chỗ tự viết SQL | **Đã gom (A1–A3)** — chỉ `adjustReserved` trong `utils/stockReserved.ts` |
| `serials.ts` (PUT) | Đổi location/status serial trực tiếp, không move | **Còn (P0-8)** — giờ chỉ TP+ được đổi, nhưng vẫn không sinh move |
| `documentsSerialScan.ts` (scan-out) | Đặt serial `RESERVED` | **Còn (P0-8)** — không tăng `reserved` |
| `bundles.ts` | Raw `START TRANSACTION` | **Còn** |
| `misa.ts` (mapping create/delete) | Raw `START TRANSACTION` | **Còn** |

**Nguyên tắc đang được thực thi:** mọi thay đổi `onHand` phải đi qua `postMove`/`postMoves`; riêng `reserved` đi qua `adjustReserved` (vì reservation không tạo `stock_move` theo spec §21). Mọi thay đổi serial/lô phải có bút toán tương ứng hoặc được ghi nhận là "điều chỉnh không tồn" có audit — phần này **chưa** hoàn tất.

### 5.3 Serial/reservation drift

Ba nguồn drift chính:

1. **Scan-out RESERVED không vào `reserved`.** `available` theo số lượng cao hơn thực tế; hai phiếu có thể cùng thấy hàng available.
2. **Reservation consume không sync serial.** Serial vẫn `IN_STOCK` dù `onHand` đã giảm; tra cứu serial báo còn trong kho.
3. **Count approve không sync serial/lô.** Serial/lô vẫn ở trạng thái cũ sau khi balance đã điều chỉnh.

Hệ quả: cùng một sản phẩm có thể có ba "sự thật" khác nhau: `stock_balances.onHand`, `stock_serials.stockStatus`, `stock_lots.remainingQty`. Không có job reconciliation nào phát hiện và sửa. *(Trạng thái 26/10: vẫn còn — A3/A4 chỉ đưa hai luồng ghi về `postMove`, chưa thêm bước đồng bộ serial/lô.)*

### 5.10 Đã xác minh là KHÔNG phải lỗi (đóng nghi vấn từ v2)

| Nghi vấn | Kết luận | Bằng chứng |
|---|---|---|
| Hai instance scheduler release trùng reservation | **An toàn** | `releaseExpiredReservations` dùng `GET_LOCK` liên tiến trình (`reservationExpiry.ts`), nhả lock trong `finally` |
| Combo/bundle bán vượt tồn | **An toàn** | `bundles.ts` tính khả dụng bằng `onHand - reserved` (không dùng `onHand` trần) |
| `postMove` ghi `stock_balances.locationId = null` | **Đã sửa (A10)** | `context.ts` chuẩn hóa `args.locationId \|\| ''` khớp `stock_balances.locationId NOT NULL DEFAULT ''` |
| List khoá cứng `LIMIT` và không trả tổng số bản ghi | **Đã sửa một phần (B6)** | `misa-logs` có `X-Total-Count` + `LIMIT ? OFFSET ?`; các list khác dùng `paginationOf` sẵn có |

### 5.4 Sửa chứng từ đã xử lý

`PUT /documents/:id`:

- Kiểm tra chữ ký dòng (product/location/quantity) nếu `processingStarted` (`documents.ts:314-319`).
- Nếu chữ ký không đổi (chỉ sửa ghi chú/header), vẫn **xóa toàn bộ `stock_document_lines`** và tạo lại (`335-342`), vì frontend luôn gửi `lines` khi edit (`DocCreateModal.tsx:440`).
- Xóa `stock_document_line_lots` (`336-340`) nhưng không restore allocation.
- `dropDocReservationLinks` xóa link reservation, sau đó re-link theo product/location (`documents.ts:341`).
- Không cập nhật `stock_serials.issueLineId`/`receiptLineId`; serial cũ trỏ tới line ID đã bị xóa.
- Không restore `stock_lots.receiptLineId` cho các lô đã tạo (chỉ re-link theo product/location, first match).

**Kịch bản lỗi:** phiếu nhập đã quét serial, đã complete; người dùng sửa ghi chú → line ID đổi → serial mất liên kết dòng; lô nhập mất `receiptLineId`; báo cáo truy vết sai.

**Cách sửa:** chỉ cho sửa header/notes khi `processingStarted`; nếu cần sửa dòng, bắt buộc `resetProcessing` và chặn nếu đã phát sinh move/serial OUT; hoặc dùng `PATCH` riêng cho header, không gửi `lines`.

### 5.5 Hủy chứng từ không atomic — ĐÃ FIX (A5)

`POST /documents/:id/cancel` (v2) thực hiện 4 việc rời nhau: `dropDocReservationLinks` → `releaseReservedSerials` → `dropDocLots` → `UPDATE stock_documents SET status = 'CANCELLED'`, không transaction, không rollback.

Nay toàn bộ nằm trong `beginStockTransaction(db, docWarehouseIds(doc))` theo đúng pattern của `DELETE /documents/:id`: đọc doc → mở transaction → dọn link/serial/lô → đổi trạng thái → `COMMIT`; nhánh `finally` rollback nếu lỗi giữa đường. Test mới bơm lỗi ở `UPDATE stock_serials`: response 500, danh sách SQL **kết thúc bằng `ROLLBACK`** và **không chứa** `UPDATE stock_documents SET status`; assertion cũ "cancel không chạm `reserved`" vẫn giữ.

**Cùng đợt (A9):** các `.catch(() => …)` ở guard bị bỏ để lỗi lan (fail-closed) — `processingStarted`, `releaseReservedSerials`, `dropDocReservationLinks`, `saleableLocationSet`, DELETE link trong scheduler. Giữ nguyên **có chủ đích** hai fallback **cấu hình** (không phải guard tồn kho): `resolveAccountingDefaults` (thiếu mapping MISA → null) và `nextDocCode` (trùng mã → UNIQUE + retry đỡ).

### 5.6 Kiểm kê và vị trí

- **Kiểm kê** đã phân tích ở 3.5: không có REVIEW/APPROVED, ghi thẳng balance, không sync lot/serial, lộ variance, thêm dòng ngoài snapshot.
- **Vị trí** (`locations.ts:65-89`): cho đổi `purpose`/`isActive` dù đang có tồn. Nếu đổi `SALEABLE` → `DAMAGED`, hàng đang bán được bỗng thành không bán được mà không có move/điều chỉnh. Nếu đổi `isActive = 0`, tồn vẫn còn nhưng có thể bị loại khỏi báo cáo.
- **`parentId`** không được validate cùng warehouse/không cycle (`locations.ts:43-61`), có thể tạo cây vị trí sai.
- **Xóa kho bị chặn vĩnh viễn nếu đã có bất kỳ `stock_moves` nào** (`warehouses.ts:124-129`); không có soft-delete, chỉ có `isActive`. Đây có thể là chủ ý bảo toàn lịch sử, nhưng cần quy trình "ngừng dùng kho" rõ ràng thay vì để nút xóa luôn thất bại.

**Cách sửa:** chặn đổi `purpose`/`isActive` nếu `SUM(onHand) > 0`; hoặc yêu cầu tạo adjustment/move trước. Validate `parentId` cùng warehouse và không tạo cycle. Với kho có lịch sử, dùng `isActive = 0` + thông báo thay vì xóa cứng.

### 5.7 Điều chuyển và trả hàng

- **Transfer** dồn serial/IN về một location (3.3).
- **Return** mất lô nguồn (3.4).
- **`postTransferMoves`** dùng một `destinationLocation` cho mọi dòng IN (`documents.ts:1728`).
- **`receiveTransferSerials`** dùng một `locationId` cho mọi serial (`1458-1471`).

### 5.8 Báo cáo

- `availableValue = closing * importPrice` (`stockReports.ts:67`) — **không phải** giá trị khả dụng (`onHand - reserved`), mà là giá trị tồn cuối. Trùng `closingValue`; gây hiểu nhầm.
- Date filter dùng `createdAt < to` (`stockReports.ts:51-53`) — nửa mở. Frontend `StockDocsPage` truyền đúng next-day start, nhưng `ReportsPage` truyền `to = new Date()` (`ReportsPage.tsx:32-34`), nên báo cáo chỉ tính đến thời điểm hiện tại, không có chọn khoảng ngày tùy ý.
- `/reports` và `/reports/summary` yêu cầu level ≥ 20, không yêu cầu permission kho; dữ liệu có scope nhưng manager phòng khác được gán scope vẫn xem được.
- `available-inventory` tính available chỉ từ `SALEABLE` (`balances.ts:47-88`) — đúng.
- `/balances` filter `purpose` dùng `l.purpose = ?` (`balances.ts:36`); location có `purpose = ''` không khớp `SALEABLE` dù các nơi khác coi là saleable.
- `/anomalies` so từng serial đã xuất với **tổng `onHand` của cả sản phẩm** (`monitoring.ts:122-133`). Nếu sản phẩm còn bất kỳ tồn nào, mọi serial đã bán đều bị gắn cờ "Serial đã xuất nhưng tồn số lượng vẫn còn" — false positive hàng loạt.
- `/slow` cộng `available` ở **mọi location**, gồm `WARRANTY`/`DAMAGED`/`QUARANTINE` (`monitoring.ts:260-278`), nên "tồn lâu" có thể báo cả hàng không bán được.

### 5.9 Bảng tổng hợp lỗi toàn vẹn

| # | Lỗi | Mức | Bằng chứng (v2) | Trạng thái 26/10 |
|---|---|---|---|---|
| 1 | Khóa toàn bộ kho khi ghi chứng từ/serial | P1 | `documents.ts:547`, `325`; `serials.ts:106`, `153`, `196` | **Đã fix (A6)** — xem 5.1 |
| 2 | Count approve ghi thẳng ledger | P0 | `counts.ts:286-296` | **Đã fix (A4)** |
| 3 | Reservation consume ghi thẳng move | P1 | `reservations.ts:139-147` | **Đã fix (A3)** |
| 4 | Serial đổi location/status không move | P0 | `serials.ts:131-180` | Còn |
| 5 | Scan-out không cập nhật reserved | P0 | `documents.ts:2519-2522` | Còn |
| 6 | Sửa chứng từ xóa/tạo lại dòng | P0 | `documents.ts:314-342` | Còn |
| 7 | Cancel không transaction | P0 | `documents.ts:210-228` | **Đã fix (A5)** |
| 8 | Transfer dồn location | P1 | `documents.ts:1458-1471`, `1728` | Còn |
| 9 | Return mất lô nguồn | P1 | `documents.ts:1817-1860` | Còn |
| 10 | Location đổi purpose/isActive khi có tồn | P1 | `locations.ts:65-89` | Còn |
| 11 | Report availableValue sai | P1 | `stockReports.ts:67` | Còn |
| 12 | Reservation hết hạn vẫn link | P1 | `documentContext.ts` (`syncDocumentReservationLinks`) | Còn |
| 13 | Schema thiếu FK/CHECK/status constraint | P2 | `db_mysql.ts` | Còn (cố ý); **đã** bổ sung DECIMAL + index (v44–v47) |
| 14 | Scheduler release reservation hết hạn khóa toàn bộ kho | P1 | `reservationExpiry.ts`; `stockTransaction.ts` | **Đã fix (A6)** |
| 15 | Lỗi DB nội bộ trả 400 và lộ message MySQL | P1 | `documentsCore.ts`/`documentsPosting.ts` (v2: `documents.ts:1142,1885,1925,1979,2020,2065`) | **Đã fix (A8)** — 500 + message trung tính; riêng `assertNotCounting` giữ 409 |
| 16 | Guard tồn kho nuốt lỗi bằng `.catch` | P1 | nhiều nơi trong `documents*.ts`, `context.ts` | **Đã fix (A9)** — fail-closed |
| 17 | `postMove` ghi balance với `locationId = null` trong khi DDL `NOT NULL DEFAULT ''` | P2 | `context.ts` | **Đã fix (A10)** |

---

## 6. Frontend và UX

### 6.1 Quy mô

`frontend/pages/Warehouse` có **41 file / 13.269 dòng**, chia thành:

- `StockDocs` (page + create/detail modal + serial mode)
- `CountPage`, `MisaPage`, `ReportsPage`, `BalancesPage`, `SerialsPage`, `BundlesPage`, `ReservationsPage`, `LocationsPage`, `MonitoringPage`, `ActivityLogsPage`
- `AvailableInventoryReference`
- Các component scanner/label/print

### 6.2 Phát hiện

| Mức | Phát hiện | Bằng chứng | Tác động |
|---|---|---|---|
| **P0** | `SerialDocMode` luôn render `SerialBox`; `QuantityBox`/`LotBox`/`EnableSerialBox` không dùng | `SerialDocMode.tsx:375`, khai báo `387`, `629`, `795` | LOT/QUANTITY không có UI |
| **P0** | Gọi `confirmLineWithoutSerial` (endpoint luôn 400) | `SerialDocMode.tsx:427` | Người dùng bấm nhận lỗi không rõ lý do |
| **P1** | Edit luôn gửi `lines` | `DocCreateModal.tsx:440` | Kích hoạt xóa/tạo lại dòng ở backend |
| **P1** | Cho nhập số lượng thập phân nhưng backend bắt số nguyên | `DocCreateModal.tsx:848` | Lỗi submit khó hiểu |
| **P1** | Admin thấy menu kho nhưng backend 403 | `Sidebar.tsx:90-93`, `departmentMenus.ts:152-218` | UX rối |
| **P1** | Reports không có date picker; `to = new Date()` | `ReportsPage.tsx:32-34` | Không xem được kỳ tùy ý |
| **P1** | MISA không có màn đối soát | `MisaPage.tsx:26` | "Đối soát" chỉ là mapping/log |
| **P2** | Phân trang dùng `limit + 1` thay vì `X-Total-Count` | `StockDocsPage.tsx:110-130` | Không biết tổng số trang; API list thiếu header |
| **P2** | CountPage chỉ có COUNTING/DONE/CANCELLED | `CountPage.tsx:142-143`, `216-217` | Không có REVIEW/APPROVED/ADJUSTED |
| **P2** | Test frontend chỉ test menu metadata | `frontend/tests/warehouseFrontend.test.ts` | Không bảo vệ luồng trang |

### 6.3 Chi tiết

#### 6.3.1 SerialDocMode và các nhánh chết

`SerialDocMode` nhận `line.tracking` từ API `progress`, nhưng API hardcode `'SERIAL'` (`documents.ts:2705`). Vì vậy:

- `SerialBox` luôn được render (`375`).
- `QuantityBox` (`629`), `LotBox` (`795`), `EnableSerialBox` (`387`) là code chết.
- Người dùng không có cách nhập số lượng thực tế hoặc chọn lô.

Đây là lỗi **kép**: backend không trả đúng tracking, frontend không có fallback. Cần sửa backend trước, sau đó bật lại các nhánh UI theo `tracking`.

#### 6.3.2 Edit modal

`DocCreateModal` khi edit luôn gửi `lines: clean` (`440`). Backend coi đây là thay đổi dòng, xóa và tạo lại. UI chỉ hiện nút "Sửa" cho `DRAFT` (`DocDetailModal.tsx:584`), nên rủi ro chủ yếu ở API/tích hợp; nhưng nếu trạng thái `DRAFT` đã có serial quét một phần, việc sửa cũng làm mất tiến độ.

**Cách sửa:** tách `PATCH /documents/:id/header` chỉ sửa notes/header; modal edit chỉ gửi `lines` khi thực sự thay đổi và chưa `processingStarted`; cảnh báo rõ nếu đã quét.

#### 6.3.3 Số lượng thập phân

UI cho `step="any"` và `min=0.000001` (`DocCreateModal.tsx:848`), nhưng backend `validateLines` bắt `Number.isInteger` (`documents.ts:732`). Với sản phẩm bán theo mét/kg, người dùng nhập 1.5 → backend 400. Cần thống nhất: hoặc hỗ trợ số thập phân + đơn vị, hoặc chặn ở UI và ghi rõ lý do.

#### 6.3.4 Menu Admin

Như 4.3.3. Ngoài ra, các item không có `minLevel` hiện cho cả employee level 10, kể cả `wh_serial`, `wh_bundle`, `wh_processing` — có thể đúng nếu employee được xem, nhưng cần rà lại theo spec §33.

### 6.4 Điểm tốt

- `StockDocsPage` dùng date preset nửa mở đúng (`110-130`).
- Scanner/QR/label/print đã được đầu tư nhiều (các commit gần đây).
- `AvailableInventoryReference` tách riêng, dễ tái sử dụng.
- Responsive/mobile đã được cải thiện.

---

## 7. Test coverage

### 7.1 Số liệu

- Backend: **48 file**, **520 case**, **8.176 dòng** (v2: 45 file / 441 case / 7.627 dòng).
- Frontend: **1 file** `warehouseFrontend.test.ts`, **153 dòng**, **11 case**; chủ yếu test RBAC helper và menu metadata, **không test page flow**. *(Chưa đổi — xem 9.3.)*
- 17 suite backend trực tiếp liên quan kho:
  - `stock.test.ts`
  - `stockSerialProcessing.test.ts`
  - `stockReservationsIssuePhase6.test.ts`
  - `stockMisaDocuments.test.ts`
  - `stockPerformance.test.ts`
  - `warehouseCrud.test.ts`
  - `warehouseRegression.test.ts`
  - `stockLotAllocation.test.ts`
  - `stockLotPhase2.test.ts`
  - `stockSerialBatchPhase6.test.ts`
  - `stockAlertsNotify.test.ts`
  - `stockPartnerSuggestions.test.ts`
  - `stockReports.test.ts`
  - `stockReportsSummary.test.ts`
  - `stockReservedLedger.test.ts` *(mới — A1)*
  - `stockCountingGuard.test.ts` *(mới — A7)*
  - `stockCountOwnership.test.ts` *(mới — B5)*
- Test kiến trúc: `stockRouteSurface.test.ts` (81 route, so khớp có thứ tự — chốt Phase D).

### 7.2 Những gì được bảo vệ

- Tạo/sửa/xóa kho cơ bản (`warehouseCrud.test.ts`).
- Serial processing, batch serial, lot allocation.
- Reservation + issue phase 6.
- MISA documents/queue.
- Reports + summary.
- Alerts notify.
- Scope trong query reconciliation/anomaly (`stockPerformance.test.ts`).
- *(Mới 26/10)* Scope catalog kho + `/next-code`; cancel atomicity; guard kiểm kê cho hold/release; chủ quyền số đếm; bề mặt route; idempotency migration; một nguồn SQL cho `reserved`.
- **Frontend:** chỉ bảo vệ `utils/rbac` và menu metadata; không bảo vệ quét serial, tạo/duyệt phiếu, chuyển kho, kiểm kê, xử lý ngoại lệ.

Backend có độ phủ **rộng và thực chất hơn frontend** ở CRUD kho, reservation, serial processing, lot allocation và báo cáo. Tuy nhiên, phần lớn test vẫn kiểm tra **hành vi hiện tại**, không kiểm tra spec (xem 7.3).

### 7.3 Test đang khóa hành vi sai

- **`stock.test.ts` (approve kiểm kê)** vẫn kỳ vọng approve từ `COUNTING` thành công và thoát `DONE`, không đi qua `REVIEW`/`APPROVED`. Đây chính là hành vi trái spec; test sẽ phải sửa nếu làm đúng quy trình. *(Sau A4 test đã được bổ sung assert `warehouse_activity_logs`, nhưng **state machine vẫn là hành vi cũ** — cố ý: đổi state machine là thay đổi nghiệp vụ cần business duyệt.)*
- **`warranty.test.ts:86-92`** chỉ kiểm tra timeline có receipt/issue/warranty và một mảng moves rỗng; không kiểm tra contamination khi chứng từ có nhiều serial.
- **`stockPerformance.test.ts`** kiểm tra scope được push xuống subquery, nhưng không kiểm tra logic anomaly đúng/sai.
- Không thấy test nào phủ kịch bản sản phẩm `tracking = LOT` hoặc `QUANTITY` đi hết luồng tạo → xử lý → complete, nên không phát hiện các luồng này bị chặn.

### 7.4 Lỗ hổng test

Đã bổ sung trong đợt fix:

- ✅ Catalog kho theo scope (`warehouseCrud.test.ts`).
- ✅ Employee scope rỗng / Admin / Director trên catalog kho.
- ✅ `/next-code` scope, kể cả tương thích ngược khi không gửi `warehouseId`.
- ✅ Cancel atomicity + fail-closed guard (failure injection).
- ✅ Hold/release bị chặn 409 khi kho đang kiểm kê.
- ✅ Chỉ người đếm/quản lý được sửa số đếm.
- ✅ Bề mặt route (81 route, có thứ tự) sau khi tách `documents.ts`.
- ✅ `ensureColumnType` có/không phát `ALTER` (idempotency) và tổng số migration.
- ✅ `reserved` chỉ có một nguồn SQL (so khớp nguyên văn).

Vẫn thiếu:

- Manager không có permission kho; manager kho A sửa/xóa kho B (code chưa chặn).
- Serial đổi location/status có tạo move hay không.
- LOT/QUANTITY end-to-end (tạo → xử lý → complete).
- `progress` trả đúng `tracking`.
- `confirm-qty` với variance.
- Sửa chứng từ đã xử lý không phá line.
- MISA reconcile thật.
- Count `REVIEW → APPROVED → ADJUSTED`.
- Transfer đích theo từng dòng.
- Return giữ lô nguồn.
- Reservation consume sync serial/lô.
- Report `availableValue` = available * price.
- Integration test với MySQL thật (DDL/ALTER/thời gian khóa) — hiện toàn bộ `db` là mock.
- Frontend: quét serial, tạo/duyệt phiếu, chuyển kho, kiểm kê, xử lý ngoại lệ (11 case hiện tại không chạm các page này).

### 7.5 Khuyến nghị

1. **Viết test theo spec trước**, chấp nhận đỏ; sửa code để xanh.
2. Tách test "behavior hiện tại" và "spec" nếu cần migrate dần.
3. Thêm integration test với MySQL thật cho các luồng P0 (không mock `db`).
4. Thêm property test cho ledger: sau mọi luồng, `SUM(stock_moves.quantity)` = `stock_balances.onHand` theo product/warehouse/location.
5. Thêm test RBAC: employee kho A không đọc/sửa kho B; manager không permission nhận 403.
6. Thêm test serial/lot consistency: sau ISSUE, serial `OUT`, lot `remainingQty` giảm đúng.

---

## 8. Ma trận tuân thủ spec

| Yêu cầu spec | Trạng thái | Ghi chú |
|---|---|---|
| NV chỉ thấy warehouse/location thuộc scope (§33) | **Đạt ở danh mục** | `GET /warehouses` + `/next-code` đã scope (B1/B2); location list vốn đã scope. Còn: `PUT/DELETE /warehouses/:id` chưa chặn theo scope |
| TP quản lý kho/vị trí nếu permission cho phép | **Một phần** | Rule level đã thống nhất qua `requireWarehouseManager` (B3); vẫn chưa có permission `warehouse.manage` |
| Admin không tự có quyền business data | **Đạt ở backend, cần chốt policy** | `listScope` 403; ngoại lệ **có chủ đích**: `GET /api/warehouses` cho Admin (UI gán scope cần); menu vẫn hiện một số item |
| Chứng từ RECEIPT/ISSUE/TRANSFER/RETURN/ADJUSTMENT | **Một phần** | Có type, nhưng ADJUSTMENT chủ yếu qua count; state machine thiếu |
| Receipt `DRAFT → CONFIRMED → RECEIVING → DONE` | **Không đạt** | Code `DRAFT → PROCESSING → READY → COMPLETED` |
| Issue `DRAFT → CONFIRMED → RESERVED → PICKING → DONE` | **Không đạt** | Code `DRAFT → PROCESSING → READY → COMPLETED` |
| Transfer `DRAFT → CONFIRMED → IN_TRANSIT → RECEIVED → DONE` | **Không đạt** | Thiếu `CONFIRMED`, `RECEIVED` |
| Count `DRAFT → COUNTING → REVIEW → APPROVED → ADJUSTED → CLOSED` | **Không đạt** | Chỉ `COUNTING → DONE/CANCELLED` |
| Mọi biến động tồn sinh `stock_moves` | **Một phần** | Count + reservation consume đã qua `postMove`; serial location/status vẫn ghi tắt |
| Không update stock trực tiếp (§20) | **Một phần** | `onHand` chỉ còn `postMove/postMoves` (đã đạt); `reserved` chỉ còn `adjustReserved` (đã đạt); serial/lot vẫn có đường ghi tắt |
| Count có "Yêu cầu kiểm lại / Duyệt chênh lệch / Tạo điều chỉnh tồn" | **Không đạt** | Không có state/action tương ứng |
| Reservation chỉ từ available + SALEABLE | **Một phần** | Có check available; đã thêm guard kiểm kê (A7); vẫn không khóa row balance; serial/lô chưa hỗ trợ |
| Reservation release khi cancel/expiry | **Một phần** | Scheduler dùng `GET_LOCK` + khóa đúng kho; cancel document đã atomic; link quá hạn vẫn chưa chặn |
| Reservation consume khi ISSUE DONE | **Không đạt** | Vẫn là endpoint `settle` thủ công; consume đã qua `postMove` nhưng chưa sync serial/lô |
| Reservation không tạo stock_move | **Đạt** | Hold/release chỉ ghi `reserved` qua `adjustReserved`, không sinh move; consume cố ý sinh move `ISSUE` |
| Serial detail đầy đủ (§22) | **Một phần** | Có nhiều field, nhưng timeline lẫn move chứng từ; thiếu lot history đầy đủ |
| MISA đối soát thật | **Không đạt** | Queue PENDING chưa gửi MISA; reconcile chỉ dữ liệu nội bộ + log client |
| Audit log đầy đủ | **Một phần** | Có activity log, thêm log từng move khi approve kiểm kê (A4); thiếu một số chuyển trạng thái và tìm kiếm serial/lô |

---

## 9. Lộ trình ưu tiên

### 9.1 P0 — trước khi vận hành thật

| ID | Việc cần làm | File chính | Trạng thái 26/10 |
|---|---|---|---|
| P0-1 | Scope hóa catalog kho | `warehouses.ts` | **Xong (B1)** — Admin/Director+ giữ danh mục đầy đủ |
| P0-2 | Permission + `requireWarehouse` cho PUT/DELETE kho | `warehouses.ts`, `rbacService.ts` | **Một phần (B4)** — mới tăng guard dữ liệu; chưa scope/permission |
| P0-3 | Bỏ ép `serialRequired = 1`; lấy tracking từ product | `documentContext.ts`, `documentsSerialScan.ts` | Còn |
| P0-4 | Sửa `canComplete` ưu tiên LOT đúng; cho 1 mã lô cover SL > 1 | `documentContext.ts` | Còn |
| P0-5 | Count approve gọi `postMove` | `counts.ts` | **Xong phần ledger (A4)**; state `REVIEW/APPROVED/ADJUSTED` + sync lot/serial còn |
| P0-6 | Chặn sửa lines khi đã xử lý; tách PATCH header | `documentsCore.ts`; `DocCreateModal.tsx` | Còn |
| P0-7 | Bọc cancel trong transaction | `documentsCore.ts` | **Xong (A5)** |
| P0-8 | Serial location/status phải tạo move hoặc chặn; scan-out cập nhật reserved | `serials.ts`; `documentsSerialScan.ts` | Còn |

### 9.2 P1 — ổn định và đúng nghiệp vụ (2–4 tuần)

1. ~~**Transaction scope:** truyền warehouse IDs vào mọi `beginStockTransaction`; bỏ khóa toàn cục.~~ **Xong (A6)** — gồm scheduler `reservationExpiry` (trước đây khóa mọi kho mỗi 5 phút).
2. ~~**Reservation consume** gọi `postMove`~~ **Xong (A3)** cho ledger; **còn** sync serial/lô và khóa row balance `FOR UPDATE`.
3. **Transfer** nhận serial/IN theo `line.locationId`; thêm state `RECEIVED`.
4. **Return** giữ `sourceLotId`, cho nhiều phiếu xuất trong một phiếu trả.
5. **Count** không lộ variance khi blind; không cho thêm dòng ngoài snapshot; snapshot chỉ dòng có tồn.
6. **Location** chặn đổi purpose/isActive khi có tồn; validate parent.
7. **Reports** sửa `availableValue`; chuẩn hóa date range; thêm date picker.
8. **MISA worker:** bổ sung worker gửi/nhận API MISA, retry có backoff, trạng thái lỗi/dead-letter, mapping phản hồi từ MISA; idempotency key theo version/hash; payload có serial/lô; queue có RECONCILE; phân trang log.
9. **MISA reconcile/log:** chỉ cho ghi log khi có dữ liệu đối chiếu thật; bỏ tin số liệu client; nếu chưa tích hợp được thì đổi tên thành "xem tồn nội bộ" và ẩn khỏi UI "đối soát".
10. **RBAC** thêm permission kho; reports yêu cầu permission; MISA mapping/log theo scope.
11. **Frontend** bật lại Quantity/Lot UI; bỏ gọi endpoint chết; thống nhất số thập phân; sửa menu Admin.
12. **Activity log** tìm theo serial/lô; thêm filter thời gian.
13. **Anomaly** sửa false positive serial; slow stock chỉ tính SALEABLE.

### 9.3 P2 — hoàn thiện (trạng thái sau đợt fix)

| # | Việc | Trạng thái |
|---|---|---|
| 1 | FK/CHECK/status constraint; migration an toàn | **Một phần** — v44 thêm index, v45–v47 đổi DECIMAL; chưa có FK/CHECK. C6 chỉ thêm validate trạng thái serial ở tầng app |
| 2 | Bỏ raw `START TRANSACTION` ở bundles/MISA | Còn |
| 3 | Chuẩn hóa pagination + `X-Total-Count` | **Xong cho list có `LIMIT`** — `misa-logs` (B6), `balances`, `misa-sync/queue`. Reconcile/anomalies không `LIMIT` nên `rows.length` là tổng thật, giữ nguyên |
| 4 | Viết lại test theo spec; test RBAC/ledger | **Một phần** — thêm `stockRouteSurface` (81 route), `stockCountingGuard`, `stockCountOwnership`, `stockReservedLedger`, `dbBootstrap` (DECIMAL fail-open/idempotent). Test theo spec state machine vẫn còn thiếu |
| 5 | Tài liệu hóa state machine thực tế và mapping với spec | **Xong trong tài liệu này** (§3.4, §8) |
| 6 | Job reconciliation định kỳ: balance vs serial vs lot | Còn — mới có endpoint `/reconcile` gọi tay |
| 7 | UX cảnh báo khi sửa/hủy chứng từ đã xử lý | Còn |
| 8 | Rà MySQL-specific (`REGEXP`, `CAST(SUBSTRING)`) | Còn |
| 9 | Tách `documents.ts` theo loại chứng từ | **Xong (D)** — 3.050 dòng → `documents.ts` 22 dòng + 5 sub-router (1.758 dòng) + `documentContext.ts` 1.342 dòng + `documentSchemas.ts` 90 dòng |
| 10 | Mở rộng frontend test cho luồng quan trọng | Còn — `frontend/vitest.config.ts` vẫn `environment: 'node'`, chưa có jsdom/Testing Library |

### 9.4 Thứ tự triển khai (thực tế đã chạy)

| Release | Nội dung | Trạng thái |
|---|---|---|
| 1 | A1–A10 (toàn vẹn dữ liệu) + B1–B6 (RBAC) | Code xong — 520 test backend xanh, `tsc` sạch |
| 2 | D0–D6 (tách `documents.ts`) | Code xong — bề mặt 81 route không đổi (`stockRouteSurface.test.ts`) |
| 3 | C1–C6 (index + DECIMAL) | Code xong — **chưa được deploy** khi chưa qua cổng C0/C5 (§9.6) |

Việc còn lại theo thứ tự:

1. Deploy release 1, chạy query đối chứng ledger trên staging rồi production.
2. Deploy release 2.
3. Rehearsal C0 trên bản copy production, sau đó deploy release 3 trong cửa sổ bảo trì.
4. P0 còn lại (P0-3/P0-4 tracking/LOT, P0-5 state machine kiểm kê, P0-6 sửa line, P0-8 serial move) — đây là thay đổi nghiệp vụ, phải viết test theo spec trước.

### 9.5 Quyết định đã chốt trong đợt fix này

| Quyết định | Chốt | Lý do / hệ quả |
|---|---|---|
| Admin có đọc `GET /api/warehouses`? | **Có, đầy đủ** | `frontend/pages/Admin/UserManagement.tsx` cần danh mục kho để gán scope. Admin vẫn bị `listScope` (403) và `requireWarehouse` chặn ở mọi endpoint dữ liệu tồn — spec §33 vẫn giữ |
| Hold/release reservation khi kho đang kiểm kê | **Chặn 409** (A7) | available đổi giữa lúc đếm làm số kiểm kê sai. Đây là **thay đổi hành vi có chủ đích**, cần thông báo phòng Kho Vận trước khi deploy |
| Có viết lại chuỗi SQL ghi `stock_balances`/`stock_moves`? | **Không** | Test assert nguyên văn SQL + thứ tự param là hợp đồng. A1 chỉ tập trung quyền ghi `reserved`, không đổi ngôn ngữ |
| Phase C gộp hay tách release? | **Tách, làm cuối, có downtime** | 1 connection MySQL + `DatabaseTransactionGate` khiến `ALTER TABLE` chặn mọi request. Migration forward-only, rollback = restore dump |
| MISA gọi API thật trong đợt này? | **Không** | Cần Kế toán chốt payload/mapping. Queue hiện ghi rõ "chưa gửi dữ liệu sang MISA" |
| PUT/DELETE kho có permission riêng? | **Chưa** — mới có guard dữ liệu (B4) + `requireWarehouseManager` | Cần business chốt bộ permission kho trước khi thêm; xem bảng quyết định còn mở bên dưới |

Quyết định còn mở: (a) có role kiểm toán read-only (`warehouse.audit.read`) không; (b) MISA sync thật hay chỉ giữ queue nội bộ và đổi nhãn UI; (c) Admin có cần quyền đọc dữ liệu kho có audit hay không.

### 9.6 Phase C — cổng triển khai bắt buộc (C0/C5)

Code Phase C đã xong nhưng **không được deploy chỉ vì test xanh**. Các bước sau là điều kiện vận hành, không chạy được trong repo:

| Bước | Nội dung | Tiêu chí đạt |
|---|---|---|
| C0.1 | `mysqldump --single-transaction --routines --triggers <db> > backup_pre_v44.sql`, kèm dump riêng 6 bảng nóng (`stock_balances`, `stock_moves`, `stock_document_lines`, `stock_documents`, `reservations`, `stock_count_lines`) | Có file backup, giữ ≥ 14 ngày |
| C0.2 | Snapshot `COUNT(*)`, `SUM(onHand)`, `SUM(reserved)`, `SUM(stock_moves.quantity)`, `SUM(stock_documents.totalAmount)` | Lưu lại để đối chiếu sau migrate |
| C0.3 | Rehearsal trên bản copy production, đo thời gian `ALTER` | Biết trước thời gian downtime; cửa sổ bảo trì đủ dài |
| C5.1 | So SUM sau migrate với snapshot C0.2 | Chênh lệch < 0.001 × số dòng |
| C5.2 | `GET /api/stock/reconcile` | `rows: []` |
| C5.3 | 4 query đối chứng ledger (§Kiểm chứng) | Tất cả rỗng hoặc `0` |

Migration đã viết:

| Version | Nội dung |
|---|---|
| v44 `stock_hot_path_indexes` | `reservations(status,expiresAt)`, `products(name)`, `products(importCode)`, `stock_balances(warehouseId,productId)`, `stock_serials(productId,serialNumber)` |
| v45 `stock_quantity_decimal` | 26 cột số lượng/tiền kho → `DECIMAL(18,3)` |
| v46 `stock_vat_rate_decimal` | `vatRate` → `DECIMAL(7,4)` (0–100, cần 4 số lẻ) |
| v47 `product_price_decimal` | `products.defaultPrice/importPrice/salePrice` → `DECIMAL(18,2)`; tách riêng vì `products` dùng chung với Bán hàng/Hợp đồng |

Kèm theo: `ensureColumnType` idempotent theo từng cột (fail-open khi không đọc được `information_schema`), hằng `DDL` đã đồng bộ cùng kiểu để DB fresh và DB đã migrate hội tụ, và `decimalNumbers: true` ở `mysql2` để DECIMAL vẫn về `number` như toàn bộ route/FE đang khai báo.

### 9.7 Cố ý KHÔNG làm trong đợt này

| Việc | Lý do |
|---|---|
| PO / Incoming / supplier master | Cần quyết định nghiệp vụ lớn; menu `po_*` hiện là stub không `path` |
| Product master `brand`/`model`/`costingMethod`/`requiresCertificates` | Thiếu 7/11 trường spec §25; cần business chốt trước khi sập filter Brand và BR-STOCK-008 |
| Exception state machine (§27) | `ExceptionsPage.tsx` đang read-only; là feature mới, không phải fix |
| MISA gọi API thật | Kéo theo Kế toán; đổi phạm vi tích hợp |
| Connection pool thay single-connection | Single connection là **có chủ đích**; route còn dùng `START TRANSACTION` trần, pool sẽ phá atomicity của 40+ transaction |
| Đổi `stock_serials.serialNumber` UNIQUE toàn cục → `(productId, serialNumber)` | Breaking, cần dedupe dữ liệu thật; chỉ thêm index |
| Đổi sentinel `locationId=''` trong PK `stock_balances` | Đụng PK + mọi query; chỉ chuẩn hóa phía app (A10) |
| Set `sql_mode` STRICT tường minh | Ảnh hưởng toàn bộ module ngoài kho đang dựa vào lax mode |
| Đổi cột ngày VARCHAR → DATE | v30 đã từ chối có chủ đích vì dữ liệu lẫn `09/10/2026` và ISO |
| Xóa code chết `backend/migrations/` | Việc dọn dẹp độc lập (`run-migrations.js` hardcode file 006, SQL không hợp lệ MySQL) |
| Test UI 28 trang kho | Cần bật jsdom + Testing Library, là đợt riêng |
| Thêm CI | `.github/workflows` chưa tồn tại; nên làm nhưng ngoài phạm vi fix |

---

## 10. Kết luận

Sau đợt fix, ba câu "chưa thể tin" ở v2 đã thay đổi một phần — trạng thái mới:

1. **`stock_balances` đáng tin hơn, nhưng chưa phải sự thật duy nhất.** Count approve và reservation consume giờ đi qua `postMove`; `reserved` chỉ còn một nơi ghi; cancel chứng từ đã atomic; lock đã đúng kho. **Còn:** serial/lô chưa sync khi consume reservation, serial đổi location/status trực tiếp vẫn không sinh move, count chưa có `REVIEW/APPROVED/ADJUSTED`.
2. **"Đã đối soát MISA" vẫn chưa đúng.** Chưa đổi: prepare chỉ tạo queue `PENDING`, chưa gửi/nhận API MISA, reconcile chỉ trả dữ liệu nội bộ. Chỉ có log queue được phân trang thật.
3. **Phân quyền kho đã siết ở catalog và kiểm kê.** Employee chỉ thấy kho trong scope; xóa kho bị chặn khi còn serial/lô/policy/mapping/balance; line kiểm kê có chủ sở hữu. **Còn:** PUT/DELETE kho chưa có permission riêng; transfer/return/report chưa scope đầy đủ; anomaly/slow-stock chưa hoàn thiện.

Bốn bất biến đã có đường đi rõ ràng trong code:

- Mọi biến động tồn → `postMove`/`postMoves` → `stock_moves` → `stock_balances`; `reserved` chỉ qua `adjustReserved`.
- Mọi transaction truyền đúng `warehouseIds` để `FOR UPDATE` chỉ khóa kho liên quan (scheduler không còn khóa toàn bảng mỗi 5 phút).
- Mọi truy cập catalog / next-code / kho ghi dữ liệu → kiểm tra scope.
- Mọi lỗi hạ tầng trả 500 thay vì 400, guard không còn `.catch(() => …)` nuốt lỗi.

Module đã đủ nền để dùng làm sổ tồn chính thức **sau khi deploy release 1 + 2 và đóng nốt P0-3/P0-4/P0-5/P0-8**. Phase C chỉ nên chạy sau khi C0/C5 đạt, vì nó là thay đổi kiểu dữ liệu không thể rollback bằng code.

---

## 11. Chức năng đã vượt spec V8.2

Tài liệu v2 chỉ mô tả phần thiếu so với spec. Thực tế code đã có một số năng lực **vượt spec**, cần ghi nhận để không bị "làm lại":

| Năng lực | Bằng chứng | Ghi chú |
|---|---|---|
| In nhãn nhiệt barcode/QR cho serial/lô | `frontend/pages/Warehouse/StockDocs/StockLabelPrintModal.tsx` (508 dòng) | Spec không yêu cầu in nhãn |
| Smart parser mã vạch GS1 AI + mã hãng (SUNGROW/Huawei/Growatt/Deye) | `frontend/utils/barcodeParser.ts` (253 dòng), dùng ở `ScannerModal.tsx`; test riêng `frontend/tests/barcodeParser.test.ts` | Tự bóc AI 01/21 và serial theo tiền tố hãng |
| Quét thông minh phía server | `backend/routes/stock/documentsSerialScan.ts:320` (`/serials/scan-smart`) | FE chọn phiếu/dòng tự động từ một lần quét |
| Quét kiểm kê liên tục trên mobile | `frontend/pages/Warehouse/CountPage.tsx` | Camera + nhập liên tiếp, không cần mở từng dòng |
| Template in chứng từ theo TT 99/2025/TT-BTC | `frontend/pages/Warehouse/StockDocs/StockDocPrintTemplate.tsx:166` | Có mẫu số/ký hiệu chứng từ |
| Mobile card view + camera FAB | `ProcessingQueuePage.tsx`, `SerialDocMode.tsx`, `CountPage.tsx`, `DocDetailModal.tsx` | **Mâu thuẫn spec §31 "Desktop-first"** — cần chốt lại spec |

Hệ quả cho kế hoạch: các mục này **không** nằm trong "còn thiếu"; nếu viết lại UI theo spec cũ sẽ là thoái lui chức năng.

---

## Phụ lục A — Danh mục bằng chứng nhanh

### A.1 Đã fix trong đợt này (bằng chứng mới)

| Chủ đề | File:dòng | Test bảo vệ |
|---|---|---|
| `reserved` chỉ còn một nơi ghi | `backend/utils/stockReserved.ts`; dùng ở `reservations.ts:139-158`, `reservationExpiry.ts:58` | `stockReservedLedger.test.ts` |
| Consume reservation đi ledger + activity log | `backend/routes/stock/reservations.ts:139-158` | `stockReservationsIssuePhase6.test.ts` |
| Approve kiểm kê đi `postMove` | `backend/routes/stock/counts.ts:290-300` | `stock.test.ts:787-806` |
| Cancel chứng từ atomic | `backend/routes/stock/documentsCore.ts:208-235` | `stockReservationsIssuePhase6.test.ts` |
| Lock theo đúng kho | `backend/utils/stockTransaction.ts:12-18`; `reservationExpiry.ts:26-40`; `documentsCore.ts:222,251,330`; `documentContext.ts:58,140` | `warehouseRegression.test.ts` |
| Chặn hold/release khi đang kiểm kê | `backend/routes/stock/reservations.ts:67,130,151` | `stockCountingGuard.test.ts` |
| Fail-closed guard + lỗi hạ tầng trả 500 | `backend/routes/stock/documentContext.ts:360+`; các handler posting | `stock.test.ts`, `warehouseRegression.test.ts` |
| `locationId` chuẩn hóa khi ghi balance | `backend/routes/stock/context.ts:170-176`, `:225` | `warehouseRegression.test.ts:118` |
| Catalog kho theo scope, giữ Admin | `backend/routes/warehouses.ts:16-36` | `warehouseCrud.test.ts` |
| `next-code` theo scope | `backend/routes/stock/documentsCore.ts:459+` | `stock.test.ts` |
| Xóa kho chặn khi còn dữ liệu liên quan | `backend/routes/warehouses.ts:120-150` | `warehouseCrud.test.ts` |
| Line kiểm kê có chủ sở hữu | `backend/routes/stock/counts.ts:188-200` | `stockCountOwnership.test.ts` |
| Log MISA phân trang thật | `backend/routes/stock/misa.ts:116-128` | `stock.test.ts` |
| Validate `stockStatus` serial | `backend/routes/stock/serials.ts:15-20`, `:63` | `stock.test.ts` |
| Tách `documents.ts` | `backend/routes/stock/documents.ts` (22 dòng) + 5 sub-router + `documentContext.ts` (1.342 dòng) + `documentSchemas.ts` | `stockRouteSurface.test.ts` (81 route) |
| Index + DECIMAL | `backend/db_mysql.ts:1590-1649` (v44–v47), `:771` `ensureColumnType`, `:711` `decimalNumbers` | `dbBootstrap.test.ts` |

### A.2 Còn tồn tại (chưa fix)

| Chủ đề | File:dòng |
|---|---|
| Ép `serialRequired` khi lưu phiếu | `backend/routes/stock/documentsCore.ts:359` |
| Progress hardcode `SERIAL` | `backend/routes/stock/documentsSerialScan.ts:480-482` |
| `requiresSerial` ưu tiên cờ legacy | `backend/routes/stock/documentContext.ts:290-291` |
| `canComplete` serial/LOT | `backend/routes/stock/documentContext.ts:315-340` |
| `registerReceiptSerials` đòi đủ serial | `backend/routes/stock/documentContext.ts:563` |
| LOT register nhưng vẫn bị chặn | `backend/routes/stock/documentsLots.ts:97`; `documentContext.ts:1220` |
| `confirm-qty` từ chối variance | `backend/routes/stock/documentsSerialScan.ts:566` |
| `confirm-no-serial` luôn 400 | `backend/routes/stock/documentsSerialScan.ts:611` |
| Sửa chứng từ xóa/tạo lại line | `backend/routes/stock/documentsCore.ts:267-350` |
| Scan-out không cập nhật `reserved` | `backend/routes/stock/documentsSerialScan.ts:227` |
| Transfer nhận serial theo location đích | `backend/routes/stock/documentsPosting.ts:253`; `documentContext.ts:852,1086` |
| Return mất lô nguồn | `backend/routes/stock/documentsPosting.ts:167`; `documentContext.ts:1211` |
| Count state machine thiếu bước | `backend/routes/stock/counts.ts:135`, `:274`, `:331` |
| Count lộ variance khi blind | `backend/routes/stock/counts.ts:23-46`, `:51-69` |
| Reservation consume chưa sync serial/lô | `backend/routes/stock/reservations.ts:139-158` |
| Serial đổi location/status trực tiếp | `backend/routes/stock/serials.ts:131-180` |
| Serial timeline lẫn move chứng từ | `backend/routes/stock/serials.ts:250-257` |
| Location đổi purpose/isActive khi có tồn | `backend/routes/stock/locations.ts:64-89` |
| MISA queue-only | `backend/routes/stock/misa.ts:189`, `:194` |
| MISA reconcile nội bộ | `backend/routes/stock/misa.ts:198` |
| MISA log tin số liệu client | `backend/routes/stock/misa.ts:253` |
| Report `availableValue` | `backend/routes/stockReports.ts:67` |
| Report date range nửa mở + không có picker | `backend/routes/stockReports.ts:11-29`; `frontend/pages/Warehouse/ReportsPage.tsx` |

### A.3 Frontend và test

| Chủ đề | File:dòng |
|---|---|
| Admin menu mismatch (gate `level !== 99`) | `frontend/components/layout/Sidebar.tsx:90-95`; `.../menus/departmentMenus.ts:149-155` |
| `SerialDocMode` luôn render `SerialBox` | `frontend/pages/Warehouse/SerialDocMode.tsx:375` |
| Edit luôn gửi `lines` (không tách PATCH header) | `frontend/pages/Warehouse/StockDocs/DocCreateModal.tsx:440` |
| Số lượng thập phân trong form | `frontend/pages/Warehouse/StockDocs/DocCreateModal.tsx:848` |
| Reports không có date picker | `frontend/pages/Warehouse/ReportsPage.tsx` |
| MISA không có tab reconcile | `frontend/pages/Warehouse/MisaPage.tsx:26` (chỉ `mapping` và `logs`) |
| Frontend test: 5 file / 425 dòng, không jsdom | `frontend/tests/`; `frontend/vitest.config.ts` |
| Test count từng khóa hành vi cũ | `backend/tests/stock.test.ts:787-806` (nay đã assert thêm activity log) |
| Test timeline còn yếu | `backend/tests/warranty.test.ts:86-92` |

---

*Hết báo cáo v3 — 26/10/2026, HEAD `2dcc831`. Đợt fix A/B/D/C đã vào code; còn lại là deploy theo thứ tự release, cổng vận hành Phase C (§9.6) và nhóm P0 nghiệp vụ (tracking/LOT, state machine kiểm kê, sửa line, serial move).*
