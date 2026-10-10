# KẾ HOẠCH TRIỂN KHAI LẠI KHO VẬN (theo `09_KHO_VAN.md` V8.2)

> Ngày lập: 2026-10-10  
> Spec gốc: `new-base/tranle_system_docs/09_KHO_VAN.md` (V8.2 – Warehouse Role-based UI)  
> Nguyên tắc xuyên suốt spec: **NV = xử lý việc được giao nhanh gọn** / **TP = quản trị vận hành, cảnh báo, phê duyệt, báo cáo**. Chung dữ liệu + component, khác sidebar/dashboard/action/scope/quyền.

---

## 0. Điểm xuất phát (repo hiện tại sau commit `0cde9f5`)

### Còn giữ được (tái dùng trực tiếp)
| Hạng mục | Vị trí | Ghi chú |
|---|---|---|
| Phòng ban + code (`KHO`, `KD`...) | `departments`, migration 006 | Spec §19 yêu cầu đúng thứ này |
| `users.managementLevel / primaryDepartmentId`, login payload | `routes/auth.ts`, `routes/users.ts` | Khớp mapping §33 (10/20/30/40/99) |
| Kiến trúc sidebar Common + Department config | `components/layout/menus/` | Hỗ trợ sẵn menu NV/TP khác nhau, badge, lọc permission/level |
| Block dùng chung (Công việc, Giao tiếp, Hệ thống) | `commonMenus.ts` | Đúng yêu cầu "không duplicate Lịch/Hộp thư" |
| Menu Ban Giám đốc (aggregate) | `departmentMenus.ts` | Đúng §14, giữ nguyên |
| Trang chờ `/dept/:key` | `DepartmentStubPage.tsx` | Dùng cho module chưa xây |

### Đã xóa sạch (không dùng lại)
Toàn bộ module kho cũ: routes, RBAC service riêng, migrations 007–012, versioned 7/8/11–14, pages/Warehouse, `useRBAC`, `warehouseService`, menu WAREHOUSE.
**Lý do phải xóa (spec §2):** code cũ `UPDATE inventory SET quantity` trực tiếp khi duyệt — vi phạm rule #1 (mọi biến động phải sinh `stock_move` bất biến).

### Nợ cần dọn trên DB dev (KHÔNG ảnh hưởng fresh install)
Bảng + dữ liệu kho cũ vẫn nằm trong DB dev, `_migrations` còn rows 7,8,11,12,13,14.
Chạy 1 lần trên dev trước khi build lại (giữ `departments`, `users`, tài khoản test):

```sql
DROP TABLE IF EXISTS inventory, warehouse_transactions, warehouse_locations,
  stock_count_periods, stock_count_items, inventory_lots,
  product_combos, product_combo_items;
DELETE FROM _migrations WHERE version IN (7,8,11,12,13,14);
```

### Quy ước đánh số migration mới (tránh đụng rows cũ còn sót)
- File SQL: `013_*.sql` trở đi. Versioned trong `db_mysql.ts`: **15** trở đi.

---

## 1. Kiến trúc dữ liệu mới (bám spec §2–§3, §24–§25, §36)

```
stock_products        SKU master: code, name, brand, model, category, unit,
                      tracking (NONE/LOT/SERIAL), warrantyMonths, min/max/reorder,
                      requiresCertificates. (KHÔNG dùng lại bảng products cũ
                      vì bảng đó gắn với contracts/import.)
warehouses            code, name, region, address, managerId, active
warehouse_locations   warehouseId, parentId, code (HX-A-02-03), name,
                      type (INTERNAL/SUPPLIER/CUSTOMER/TRANSIT/LOSS/ADJUSTMENT),
                      purpose (SALEABLE/WARRANTY/DAMAGED/DEMO/QUARANTINE/PICKING/RECEIVING/OTHER)
stock_documents       code (PNK-/PXK-/DCK-...), type (RECEIPT/ISSUE/TRANSFER/RETURN/ADJUSTMENT),
                      status (workflow riêng từng loại), sourceType/sourceId (PO/SO/Project),
                      warehouseId, requesterId, assigneeId
stock_document_lines  docId, productId, qtyRequested, qtyDone, unit, locationId
stock_moves           BẤT BIẾN: productId, warehouseId, locationId, lotId/serialId,
                      qty (+/-), moveType, docId/lineId, createdBy, createdAt.
                      KHÔNG có API update/delete.
stock_balances        projection đọc nhanh: productId, warehouseId,
                      onHand, reserved. Rebuild được từ moves.
                      Available = onHand - reserved (UI ưu tiên số này).
reservations          sourceType/sourceId, productId, warehouseId, qty,
                      status, expiresAt. Chỉ reserve từ available + SALEABLE.
                      Release khi hủy/hết hạn, consume khi ISSUE DONE.
                      Reservation KHÔNG sinh stock_move.
serials               serialNo UNIQUE, productId, lotId, status, warehouse/location
                      hiện tại, receipt nguồn, customer/project, warrantyStart/End
lots                  lotCode, productId, expiryDate, qty (theo dõi tay ở Phase B,
                      FIFO tự động là Phase C+)
stock_counts          đợt kiểm kê: code, warehouseId, status
                      (planned/in_progress/reconciling/done),
                      blindCount flag, createdBy
stock_count_lines     countId, productId, systemQty (snapshot), countedQty (null
                      cho tới khi NV đếm nếu blind), status, resolution
bundles               VIRTUAL_BUNDLE (config thành phần, không tồn riêng,
                      buildable = MIN(FLOOR(available/qty))) /
                      STOCKED_KIT (assemble/disassemble sinh document+move)
misa_mappings         Phase D: entityType, localId, misaId, lastSync
misa_sync_logs        Phase D: idempotencyKey, payload, result
```

State machine chứng từ (spec §18 + §13–§17):
- Transfer: `DRAFT → CONFIRMED → IN_TRANSIT → RECEIVED → DONE`
- Receipt tabs: Chờ nhận → Đang nhận → Hoàn tất (+ TP thêm Tất cả/Chờ xử lý)
- Issue tabs: Chờ soạn → Đang soạn → Chờ bàn giao → Hoàn tất (+ TP: Chờ xác nhận/giữ hàng/picking/quá hạn)
- Count tabs: Đang đếm → Chờ đối chiếu → Có chênh lệch → Đã hoàn thành

---

## 2. RBAC (spec §33–§34, dùng lại infra hiện có)

- Department (code `KHO`) → chọn menu WAREHOUSE. Permission → lọc item. Level → badge + data scope.
- Quyền mới (seed vào `roles`, check ở backend, frontend chỉ ẩn/disable):
  `stock.view, stock.count, stock.receive, stock.issue, stock.transfer,
   stock.approve, stock.adjust, stock.manage, stock.reports, misa.reconcile`
- NV (10): resource được giao + warehouse scope; không approve/adjust/quản trị master.
- TP (20): toàn phòng/scope; phân công, duyệt exception/variance, quản trị kho/vị trí/Min-Max/báo cáo.
- Menu NV/TP khác nhau: dùng sẵn `minLevel`, **bổ sung `maxLevel?` vào `NavItem`**
  (VD mục "Việc cần xử lý" chỉ NV: `maxLevel: 10`; "Báo cáo phòng" chỉ TP: `minLevel: 20`).
- Backend **bắt buộc** enforce mọi action (rule #10).

---

## 3. Các slice triển khai (mỗi slice = migration + API + UI + test + menu + acceptance)

### Phase A – Core vận hành (MVP, đúng §38)

| Slice | Nội dung | Acceptance (§42) |
|---|---|---|
| **A0. Khung + dọn dẹp** | Chạy SQL dọn DB dev (§0). Dựng menu WAREHOUSE NV/TP theo §5–§6 (mục chưa có trỏ stub). Thêm `maxLevel` vào menu config. Seed quyền stock.* vào roles. | Login NV chỉ thấy sidebar NV; TP thấy sidebar quản trị |
| **A1. Master: Product + Kho/Vị trí** | `stock_products`, `warehouses`, `warehouse_locations` CRUD (ghi = TP theo quyền). Tracking/cấu hình Min-Max ở Product (§25: inverter/battery → SERIAL, pin → LOT/SERIAL, cáp → NONE/LOT — cấu hình, không hard-code). | TP quản trị master; NV không thấy menu này |
| **A2. Receipt + stock core** | `stock_documents/lines/moves/balances`. NV: tabs Chờ/Đang/Hoàn tất, quét + chọn vị trí + hoàn tất nhận. TP: tạo phiếu, phân công, xem Stock Moves/Audit. Mọi nhập sinh move, balances tự cập nhật. | NV hoàn tất được phiếu được giao; không có nút adjust/approve với NV |
| **A3. Issue** | Workflow 5 bước (§15.2) + báo thiếu. Không cho đổi SL đã duyệt, không xuất từ quarantine/damaged. | Xuất trừ `available`, giữ `reserved` đúng |
| **A4. Transfer** | State machine §18 + KPI mini (in-transit, quá ETA, chờ nhận) + NV 2 đầu gửi/nhận. | Điều chuyển nội bộ/công trường tách bạch |
| **A5. Reservation cơ bản** | Giữ/giải phóng theo yêu cầu tay (source INTERNAL) + hiển thị đã giữ trên tồn. Chưa cần module SO/Project (tích hợp sau). | Xuất không vượt `available`; release khi hủy |
| **A6. Tồn kho trung tâm** | **1 trang nhiều tab** (§9, cấm tách 4 trang): Tổng hợp / Theo kho-vị trí / Serial-Lô / Combo. Bộ lọc + server pagination. Product Drawer (NV: xem/serial/lịch sử; TP thêm: reservation/incoming/Min-Max/reconciliation). UI ưu tiên Available. | Tra cứu đúng scope; NV không sửa Min/Max, không xem giá vốn |
| **A7. Dashboard NV/TP** | NV (§7): chào + kho scope, 4 KPI (cần nhập/xuất/điều chuyển/kiểm kê), việc hôm nay, cảnh báo cá nhân, action nhanh. TP (§8): lọc kho/thời gian/nhóm hàng, 6 KPI (+giá trị tồn nếu có quyền), tình hình các kho, cảnh báo quản trị, hiệu suất xử lý (kèm lưu ý §8.6: số liệu kiểm chứng được, chưa phải công cụ chấm điểm). | NV chỉ thấy việc của mình; TP thấy toàn phòng |

### Phase B – Truy vết và kiểm soát (§39)
- **B1. Serial/Lot**: search chung, serial detail + movement timeline (§22), TP đổi trạng thái/audit.
- **B2. Stock Count**: blind count (§19), đối chiếu, bảng variance, duyệt chênh lệch, **tạo adjustment từ variance đã duyệt** (cấm nhập số tồn trực tiếp, §28.3).
- **B3. Kiểm soát TP**: cảnh báo tồn (Min/Max/reorder/lead-time, drill-down), hàng ngoại lệ + flow Return → QUARANTINE/WARRANTY → kiểm tra → SALEABLE/DAMAGED, tồn lâu.
- **B4. Kho & vị trí đầy đủ** (§24: type/purpose, quy ước mã `HX-A-02-03`).

### Phase C – Solar optimization (§40)
- **C1. Bundle**: VIRTUAL buildable theo `available` (sửa đúng công thức §23.1), STOCKED_KIT assemble/disassemble sinh document+move, cảnh báo thiếu component.
- **C2. QR/barcode**: in + quét serial/lot (cần HTTPS/camera trên thiết bị kho).
- **C3. Shortage + đề xuất điều chuyển** theo SO/Project (khi Sales/Project có API nhu cầu).

### Phase D – Integration (§41 + §35)
- **D1. MISA mapping** (product/warehouse/document, không tự map khi ambiguous).
- **D2. Sync** có idempotency key + log (frontend không gọi MISA trực tiếp).
- **D3. Reconciliation screen** (§30.6): SKU | Kho TL | Kho MISA | chênh lệch | sync cuối. **Cấm tự sửa stock để khớp MISA.**

---

## 4. Quy ước kỹ thuật bắt buộc (spec §31, §36)

- Table-first, nền trắng/xám, primary xanh dương (quyết: theo spec hay giữ emerald hiện tại — **cần chốt trước A0**), radius 8–10, sticky header, server-side pagination/filter, drawer chi tiết, trạng thái luôn có text.
- Transaction + lock khi reserve/issue; idempotency cho complete/sync; không xóa move DONE (sửa sai bằng reversal); unique serial; index (product, warehouse/location, serial, lot, reference, status, created_at); audit các action nhạy cảm (§36).
- Mỗi slice xong phải đủ: migration chạy fresh + upgrade, API test, build frontend, menu đúng NV/TP, acceptance §42 tương ứng.

## 5. Rủi ro / việc chờ

1. **Màu primary** (xanh dương spec vs emerald hiện tại) — chốt trước khi vẽ UI.
2. **DÙNG CHUNG đặt cuối sidebar Kho** (§6.1) vs block chung toàn cục hiện tại — đề xuất giữ block chung toàn cục (đúng nguyên tắc cũ "không duplicate Lịch/Hộp thư"), cần bạn xác nhận.
3. **MISA**: chưa có endpoint/field → Phase D blocked tới khi có thông tin tích hợp.
4. **QR/camera**: cần thiết bị + HTTPS ở kho.
5. Policy hiệu suất NV (§8.6): chỉ hiển thị sau khi có policy chính thức.

---

## 6. Thứ tự làm đề xuất

```
A0 (khung+menu+quyền) → A1 (master) → A2 (receipt+core) → A3 (issue)
→ A4 (transfer) → A5 (reservation) → A6 (tồn trung tâm) → A7 (dashboard)
→ B1 → B2 → B3 → B4 → C1 → C2 → C3 → D1 → D2 → D3
```

Mỗi slice tôi sẽ thực hiện theo quy trình: migration → API + test → UI theo quyền → menu → verify (test + build) → báo acceptance. Bắt đầu từ **A0** ngay khi bạn chốt 2 điểm (màu primary, vị trí block DÙNG CHUNG) + cho chạy SQL dọn DB dev.
