# ĐẶC TẢ CHI TIẾT APP KHO VẬN

> **Bản cập nhật:** 2026-10-10  
> **Phiên bản:** V8.2 – Warehouse Role-based UI  
> **Mục tiêu:** Thiết kế lại module Kho vận cho Trần Lê theo 2 cấp sử dụng chính: **Nhân viên Kho vận (NV)** và **Trưởng phòng Kho vận (TP)**, đồng thời giữ nguyên nền tảng dữ liệu, RBAC và nguyên tắc stock-move đã chốt ở V8.1.

---

## 1. Mục tiêu module

Module Kho vận phục vụ vận hành thực tế của Trần Lê trong mô hình đại lý/EPC solar, bao gồm:

- quản lý tồn nhiều kho và nhiều vị trí;
- nhập kho, xuất kho, điều chuyển, kiểm kê;
- giữ hàng/phân bổ cho Sales Order, Project, Warranty;
- theo dõi serial/lot;
- quản lý combo/bộ solar;
- quản lý hàng lỗi, bảo hành, demo, quarantine;
- cảnh báo tồn Min/Max, tồn thấp, tồn lâu;
- truy vết lịch sử stock movement;
- đối soát dữ liệu với MISA.

Hệ thống Tran Le **không thay thế MISA bằng một bản sao màn hình tra cứu tồn kho**. MISA tiếp tục là nguồn kế toán/đối soát theo chính sách tích hợp; Tran Le Platform là lớp vận hành kho chi tiết, workflow nội bộ và truy vết serial/bảo hành.

---

## 2. Nguyên tắc kiến trúc bắt buộc

1. Không sửa tồn bằng cách update trực tiếp một số `remainingQuantity`.
2. Mọi biến động vật lý phải tạo `stock_move` bất biến.
3. `stock_balances` chỉ là projection/cache để đọc nhanh.
4. Số lượng phải phân biệt rõ:
   - `On hand / Thực tồn`: lượng đang có vật lý.
   - `Reserved / Đã giữ`: lượng đã phân bổ nhưng chưa xuất.
   - `Available / Khả dụng`: `on_hand - reserved`.
   - `Incoming / Đang về`: lượng từ PO/receipt chưa hoàn tất.
   - `Projected / Dự kiến`: lượng dự báo nếu nghiệp vụ cần.
5. Giao diện mặc định ưu tiên `Available`, không ưu tiên `On hand`.
6. Hàng `WARRANTY`, `DAMAGED`, `DEMO`, `QUARANTINE` không tính vào tồn khả dụng bán hàng.
7. Serial/Lot phải truy vết được nguồn nhập, lịch sử di chuyển, khách hàng/dự án và bảo hành.
8. Combo solar phải phân biệt `VIRTUAL_BUNDLE` và `STOCKED_KIT`.
9. Đồng bộ MISA phải có mapping, idempotency, log và reconciliation.
10. Backend bắt buộc enforce quyền; frontend chỉ ẩn/disable action.

---

## 3. Mô hình chứng từ kho

Dùng bảng chứng từ chung `stock_documents` với:

- `RECEIPT`
- `ISSUE`
- `TRANSFER`
- `RETURN`
- `ADJUSTMENT`

Dòng chứng từ ở `stock_document_lines`.

Kiểm kê dùng `stock_counts` riêng vì có quy trình:

`Tạo đợt → Snapshot → Đếm → Đối chiếu → Duyệt chênh lệch → Adjustment → Đóng đợt`

Mọi biến động tồn cuối cùng phải sinh `stock_moves`.

---

# PHẦN A – PHÂN QUYỀN GIAO DIỆN THEO CẤP

## 4. Cấp sử dụng chính

### 4.1 Nhân viên Kho vận – NV

Mục tiêu UI:

- biết hôm nay cần xử lý việc gì;
- thao tác nhanh trên phiếu được giao;
- tra cứu tồn, serial, combo;
- không bị nhiễu bởi báo cáo quản trị và cấu hình;
- không tự điều chỉnh tồn hoặc thay đổi chính sách kho.

### 4.2 Trưởng phòng Kho vận – TP

Mục tiêu UI:

- quản trị toàn bộ hoạt động kho thuộc scope;
- theo dõi KPI, cảnh báo và backlog;
- duyệt exception/chênh lệch;
- phân công người xử lý;
- quản lý kho, vị trí, Min/Max và các chính sách vận hành;
- xem báo cáo và đối soát MISA.

---

## 5. Sidebar – Nhân viên Kho vận

```text
KHO VẬN
│
├── Tổng quan của tôi
│
├── NGHIỆP VỤ
│   ├── Tồn kho
│   ├── Nhập kho
│   ├── Xuất kho
│   ├── Điều chuyển
│   └── Kiểm kê
│
├── HÀNG HÓA
│   ├── Serial / Lô
│   └── Combo / Bộ sản phẩm
│
├── CỦA TÔI
│   ├── Việc cần xử lý
│   └── Lịch sử xử lý
│
└── DÙNG CHUNG
    ├── Công việc
    ├── Lịch
    ├── Hộp thư
    ├── Cuộc họp
    └── Ghi chú
```

### 5.1 Những mục NV không hiển thị ở sidebar

- Danh mục hàng hóa quản trị.
- Kho & vị trí.
- Giữ hàng/phân bổ ở mức quản trị.
- Cảnh báo tồn toàn công ty.
- Tồn lâu.
- Hàng ngoại lệ toàn hệ thống.
- Chờ duyệt.
- Điều chỉnh tồn.
- Báo cáo quản trị.
- Đối soát MISA.

> NV vẫn có thể thấy reservation liên quan tới phiếu xuất của mình, nhưng không có màn hình quản trị reservation toàn bộ.

---

## 6. Sidebar – Trưởng phòng Kho vận

```text
KHO VẬN
│
├── Tổng quan
│
├── VẬN HÀNH
│   ├── Tồn kho
│   ├── Nhập kho
│   ├── Xuất kho
│   ├── Điều chuyển
│   ├── Giữ hàng / Phân bổ
│   └── Kiểm kê
│
├── HÀNG HÓA
│   ├── Danh mục hàng hóa
│   ├── Serial / Lô
│   ├── Combo / Bộ sản phẩm
│   └── Kho & Vị trí
│
├── KIỂM SOÁT
│   ├── Cảnh báo tồn kho
│   ├── Hàng ngoại lệ
│   └── Tồn lâu
│
├── PHÊ DUYỆT
│   ├── Chờ duyệt
│   ├── Chênh lệch kiểm kê
│   └── Điều chỉnh tồn
│
├── BÁO CÁO
│   ├── Nhập – Xuất – Tồn
│   ├── Tồn theo kho
│   ├── Tồn Min / Max
│   ├── Đang vận chuyển
│   ├── Lịch sử hàng hóa
│   └── Đối soát MISA
│
└── DÙNG CHUNG
    ├── Công việc
    ├── Lịch
    ├── Hộp thư
    ├── Cuộc họp
    └── Ghi chú
```

### 6.1 Quy tắc sidebar

- Sidebar được render theo `managementLevel + permissions + department + warehouseScope`.
- Không tạo 2 app riêng cho NV và TP.
- Dùng chung route/component khi có thể, nhưng action/widget/data scope khác nhau.
- Nhóm `DÙNG CHUNG` luôn đặt cuối sidebar để tránh đè trùng với nghiệp vụ phòng ban.

---

# PHẦN B – DASHBOARD THEO CẤP

## 7. Tổng quan của tôi – NV

### 7.1 Mục tiêu

NV mở hệ thống phải biết ngay **hôm nay cần làm gì**, không cần xem dashboard quản trị.

### 7.2 Header

```text
TỔNG QUAN CỦA TÔI
Xin chào, [Tên nhân viên]
Kho phụ trách: [Kho / scope]
Ngày: [dd/mm/yyyy]
```

### 7.3 KPI cards

```text
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Cần nhập     │ │ Cần xuất     │ │ Điều chuyển  │ │ Kiểm kê      │
│      05      │ │      08      │ │      03      │ │      02      │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

KPI chỉ tính:

- phiếu được giao cho user;
- warehouse thuộc scope user;
- trạng thái đang cần thao tác.

### 7.4 Việc cần xử lý hôm nay

| Mã | Loại | Nội dung | SL | Trạng thái | Hạn xử lý |
|---|---|---|---:|---|---|
| PXK-2601024 | Xuất | Inverter SAJ | 10 bộ | Cần soạn | 10/10 |
| PNK-2601011 | Nhập | AIKO 670Wp | 180 tấm | Chờ nhận | 10/10 |
| DCK-2600018 | Điều chuyển | Hòa Xuân → Bảo hành | 2 bộ | Chờ gửi | 10/10 |

### 7.5 Cảnh báo cá nhân

- Phiếu xuất quá hạn.
- Điều chuyển chưa xác nhận nhận.
- Serial chưa quét đủ.
- Kiểm kê chưa hoàn tất.

### 7.6 Action nhanh

- `Quét hàng`
- `Nhận hàng`
- `Soạn hàng`
- `Xác nhận nhận điều chuyển`
- `Tiếp tục kiểm kê`

---

## 8. Tổng quan – TP

### 8.1 Mục tiêu

TP cần nhìn toàn bộ hoạt động kho trong 10–20 giây và nhận ra khu vực có vấn đề.

### 8.2 Bộ lọc

```text
[Tất cả kho ▼] [Khoảng thời gian ▼] [Nhóm hàng ▼]
```

### 8.3 KPI cards

- SKU đang tồn.
- Sắp hết hàng.
- Hết hàng.
- Chờ xuất.
- Đang vận chuyển.
- Chênh lệch kiểm kê chưa xử lý.

Optional nếu có quyền tài chính:

- Giá trị tồn kho.

### 8.4 Tình hình các kho

| Kho | SKU | Chờ nhập | Chờ xuất | Cảnh báo | Trạng thái |
|---|---:|---:|---:|---:|---|
| Hòa Xuân | 220 | 3 | 8 | 2 | Bình thường |
| Hà Nội | 135 | 4 | 5 | 6 | Cần chú ý |
| Bảo hành DN | 48 | 1 | 2 | 8 ngoại lệ | Cần xử lý |

### 8.5 Cảnh báo quản trị

- SKU hết hàng.
- SKU dưới reorder point.
- Incoming trễ ETA.
- Điều chuyển quá ETA.
- Reservation sắp hết hạn.
- Tồn lâu quá ngưỡng.
- Hàng quarantine chưa xử lý.

### 8.6 Hiệu suất xử lý

| Nhân viên | Phiếu xử lý | Đúng hạn | Quá hạn |
|---|---:|---:|---:|
| NV A | 18 | 96% | 1 |
| NV B | 16 | 91% | 2 |

> Chỉ dùng số liệu nghiệp vụ có thể kiểm chứng; không biến dashboard thành công cụ chấm điểm nhân sự nếu chưa có policy chính thức.

---

# PHẦN C – MÀN HÌNH NGHIỆP VỤ

## 9. Tồn kho – trang trung tâm

Dùng một trang chung:

```text
TỒN KHO
[Tổng hợp] [Theo kho / vị trí] [Serial / Lô] [Combo / Bộ sản phẩm]
```

Không tách thành 4 trang tra cứu độc lập như giao diện cũ.

### 9.1 Bộ lọc chính

```text
[🔎 Tìm mã hàng, tên hàng, model, serial...]
[Kho ▼] [Nhóm hàng ▼] [Thương hiệu ▼] [Trạng thái ▼]
[Bộ lọc nâng cao]
```

Bộ lọc nâng cao:

- Warehouse / location.
- Category.
- Brand.
- Tracking type.
- Còn hàng / sắp hết / hết / tồn lâu.
- Saleable / Warranty / Damaged / Demo / Quarantine.
- Có reservation.
- Có incoming.

---

## 10. Tồn kho – NV

### 10.1 Bảng mặc định

| Mã hàng | Sản phẩm | Vị trí | Khả dụng | Đã giữ | Thực tồn | Trạng thái |
|---|---|---|---:|---:|---:|---|
| SAJ-H2-30K | SAJ H2 30kW | B-02-03 | 18 | 2 | 20 | Bình thường |
| AIKO-A670 | AIKO 670Wp | A-01 | 148 | 50 | 198 | Thấp |

### 10.2 NV được phép

- Tra cứu tồn trong warehouse scope.
- Xem available/reserved/on-hand.
- Xem vị trí.
- Xem serial/lot.
- Xem lịch sử movement cơ bản.
- Mở phiếu liên quan nếu user có quyền.

### 10.3 NV không được phép

- Sửa Min/Max.
- Điều chỉnh tồn.
- Thay đổi mapping MISA.
- Xem giá vốn nếu không có permission riêng.
- Xem dữ liệu warehouse ngoài scope.

---

## 11. Tồn kho – TP

### 11.1 Bảng mặc định

| SKU | Sản phẩm | Kho | Khả dụng | Đã giữ | Thực tồn | Đang về | Min | Trạng thái |
|---|---|---|---:|---:|---:|---:|---:|---|
| SAJ-H2-30K | SAJ H2 30kW | Hòa Xuân | 18 | 2 | 20 | 10 | 5 | OK |
| AIKO-A670 | AIKO 670Wp | Hà Nội | 148 | 50 | 198 | 300 | 200 | Thấp |

### 11.2 TP được phép thêm

- Xem toàn bộ warehouse thuộc scope phòng.
- Xem Min/Max/reorder point.
- Xem reservation nguồn nào đang giữ hàng.
- Xem incoming theo PO.
- Tạo điều chuyển.
- Điều chỉnh policy tồn nếu có permission.
- Xuất Excel.
- Saved View.
- Column Selector.

---

## 12. Product Drawer

Click một dòng mở drawer bên phải.

### 12.1 Nội dung chung

- SKU.
- Tên sản phẩm.
- Model / Brand.
- Available / Reserved / On hand / Incoming.
- Kho / vị trí.
- Serial/Lot gần nhất.
- Movement timeline.

### 12.2 Drawer NV

Action:

- `Xem serial / lô`
- `Xem lịch sử`
- `Mở phiếu liên quan`

### 12.3 Drawer TP

Thêm:

- Reservation theo Sales Order / Project.
- Incoming theo PO.
- Min / Max / reorder point.
- Cảnh báo.

Action:

- `Tạo điều chuyển`
- `Xem reservation`
- `Điều chỉnh chính sách tồn`
- `Xem reconciliation`

---

## 13. Nhập kho – NV

### 13.1 Tabs

```text
[Chờ nhận] [Đang nhận] [Hoàn tất]
```

### 13.2 Danh sách

| Phiếu | Nguồn | NCC | Kho | ETA | Trạng thái |
|---|---|---|---|---|---|
| PNK-00125 | PO-00231 | SAJ | Hòa Xuân | 10/10 | Chờ nhận |

### 13.3 Chi tiết NV

```text
PNK-00125
Nhà cung cấp: SAJ
Kho: Hòa Xuân

SAJ H2-30K      10 Bộ
Đã nhận          8
Còn              2

[Quét serial / QR]
[Vị trí nhập ▼]
[Hoàn tất nhận hàng]
```

### 13.4 NV không được

- sửa giá vốn;
- sửa landed cost;
- thay PO/reference;
- hoàn tất khi thiếu dữ liệu bắt buộc nếu rule không cho phép;
- tự bỏ qua serial hoặc CO/CQ nếu product yêu cầu.

---

## 14. Nhập kho – TP

### 14.1 Tabs

```text
[Tất cả] [Chờ nhận] [Đang nhận] [Chờ xử lý] [Hoàn tất]
```

### 14.2 Action

- `+ Tạo phiếu nhập`
- `Phân công`
- `Xử lý exception`
- `Đổi warehouse/location` theo quyền.

### 14.3 Chi tiết TP

Tabs:

- Thông tin.
- Hàng hóa.
- Serial/Lot.
- CO/CQ.
- Chi phí nhập.
- Stock Moves.
- Audit.

---

## 15. Xuất kho – NV

### 15.1 Tabs

```text
[Chờ soạn] [Đang soạn] [Chờ bàn giao] [Hoàn tất]
```

### 15.2 Workflow hiển thị

```text
1. Xác nhận hàng      ✓
2. Soạn hàng          ●
3. Quét serial
4. Bàn giao
5. Hoàn tất
```

### 15.3 Action NV

- Quét hàng.
- Pick hàng.
- Gán serial.
- Xác nhận bàn giao.
- Báo thiếu hàng.

### 15.4 NV không được

- thay đổi số lượng yêu cầu đã được duyệt;
- đổi nguồn Sales Order/Project;
- override thiếu tồn;
- tự xuất từ quarantine/damaged.

---

## 16. Xuất kho – TP

Tabs:

```text
[Tất cả] [Chờ xác nhận] [Chờ giữ hàng] [Đang picking]
[Chờ bàn giao] [Quá hạn] [Hoàn tất]
```

Action:

- Phân công nhân viên.
- Đổi kho xuất nếu policy cho phép.
- Duyệt exception.
- Hủy/trả lại yêu cầu.
- Release reservation.

---

## 17. Điều chuyển – NV

### 17.1 Góc nhìn tác nghiệp

```text
[Cần gửi] [Đang vận chuyển] [Cần nhận] [Hoàn tất]
```

### 17.2 NV nguồn

- Chuẩn bị hàng.
- Scan serial.
- Xác nhận gửi.

### 17.3 NV đích

- Scan hàng nhận.
- Xác nhận số lượng.
- Báo thiếu/hư.
- Gán vị trí nhận.

---

## 18. Điều chuyển – TP

### 18.1 Tabs

```text
[Chờ duyệt] [Chờ gửi] [Đang vận chuyển] [Chờ nhận]
[Quá hạn] [Hoàn tất]
```

### 18.2 KPI mini

- Đang vận chuyển.
- Quá ETA.
- Chờ nhận.
- Có chênh lệch.

### 18.3 Action

- `+ Tạo yêu cầu điều chuyển`
- Duyệt.
- Phân công.
- Xử lý mất/hư/chênh lệch.

Status chuẩn:

`DRAFT → CONFIRMED → IN_TRANSIT → RECEIVED → DONE`

---

## 19. Kiểm kê – NV

### 19.1 Nguyên tắc blind count

Khi NV kiểm kê, mặc định **không hiển thị expected quantity** nếu policy bật blind count.

```text
ĐỢT KK-260010
Kho Hòa Xuân
Khu B – Inverter

SAJ H2-30K
Hệ thống        ***
Thực tế         [     ]

[Quét sản phẩm]
[Hoàn tất đếm]
```

### 19.2 NV được phép

- nhập actual count;
- scan serial;
- ghi chú;
- gửi kết quả kiểm kê.

NV không được tự tạo adjustment.

---

## 20. Kiểm kê – TP

Tabs:

```text
[Đang đếm] [Chờ đối chiếu] [Có chênh lệch] [Đã hoàn thành]
```

Bảng variance:

| Mặt hàng | Expected | Actual | Chênh lệch | Giá trị ảnh hưởng |
|---|---:|---:|---:|---:|
| SAJ 30kW | 20 | 19 | -1 | Theo quyền |

Action:

- `Yêu cầu kiểm lại`
- `Duyệt chênh lệch`
- `Tạo điều chỉnh tồn`

Không update stock trực tiếp.

---

## 21. Reservation / Giữ hàng

Reservation là nghiệp vụ cốt lõi giữa Kho – Kinh doanh – Dự án – Kỹ thuật.

Nguồn:

- Sales Order.
- Project Material Request.
- Warranty Replacement.
- Internal Request.

Rule:

- chỉ reserve từ `available` và location `SALEABLE`, trừ exception được duyệt;
- release khi hủy/hết hạn;
- consume khi ISSUE DONE;
- reservation không tạo stock_move.

### 21.1 NV

NV không cần menu quản trị reservation riêng.

NV chỉ thấy reservation gắn với:

- phiếu xuất được giao;
- việc cần pick;
- serial cần soạn.

### 21.2 TP

Trang `Giữ hàng / Phân bổ`:

| Reference | Nguồn | Sản phẩm | SL | Kho | Người giữ | Hết hạn |
|---|---|---|---:|---|---|---|
| SO-00123 | Sales | SAJ 30kW | 2 | Hòa Xuân | NV A | 12/10 |
| PJ-00081 | Project | AIKO 670 | 30 | Hòa Xuân | NV B | - |

Action:

- Giải phóng.
- Đổi kho.
- Gia hạn.
- Xem nguồn yêu cầu.

---

## 22. Serial / Lô

### 22.1 Search chung

```text
🔎 Nhập serial / lot / model / SKU...
```

### 22.2 Serial detail

- product/model/brand;
- serial number;
- lot;
- current warehouse/location;
- operational status;
- purchase source/receipt;
- supplier;
- customer/project/customer asset;
- issue date;
- warranty start/end;
- ticket/warranty history;
- movement timeline.

Timeline mẫu:

`Nhập kho → Vị trí → Giữ hàng → Xuất → Dự án/Khách hàng → Bảo hành/Đổi serial`

### 22.3 NV

Action:

- Xem.
- Quét xác nhận.
- Mở phiếu liên quan.

### 22.4 TP

Thêm action:

- Điều chuyển.
- Đổi trạng thái theo workflow.
- Xem bảo hành.
- Xem audit.

---

## 23. Combo / Bộ sản phẩm solar

Hỗ trợ 2 chế độ.

### 23.1 `VIRTUAL_BUNDLE`

Không có stock balance vật lý riêng.

```text
Buildable Qty = MIN(FLOOR(component_available / qty_per_bundle))
```

Ví dụ:

| Thành phần | SL/bộ | Available | Có thể tạo |
|---|---:|---:|---:|
| SAJ R6 6kW | 1 | 27 | 27 |
| AIKO 670Wp | 10 | 198 | 19 |
| Tủ AC | 1 | 35 | 35 |
| Tủ DC | 1 | 22 | 22 |

Kết quả: **Có thể cấu hình 19 bộ**.

### 23.2 `STOCKED_KIT`

Dùng khi doanh nghiệp đóng gói/lắp thành SKU vật lý. Assemble/disassemble phải tạo stock document/move.

### 23.3 NV

Hiển thị:

- combo;
- buildable qty;
- thành phần;
- thành phần giới hạn.

### 23.4 TP

Thêm:

- cấu hình thành phần;
- warehouse filter;
- cảnh báo component thiếu;
- điều chỉnh bundle config nếu có quyền.

---

# PHẦN D – QUẢN TRỊ DÀNH CHO TP

## 24. Kho & Vị trí

### 24.1 Warehouse

- code;
- name;
- region;
- address;
- manager;
- active.

### 24.2 Location

- warehouseId;
- parentId;
- code;
- name;
- type;
- purpose.

Type:

`INTERNAL / SUPPLIER / CUSTOMER / TRANSIT / LOSS / ADJUSTMENT`

Purpose:

`SALEABLE / WARRANTY / DAMAGED / DEMO / QUARANTINE / PICKING / RECEIVING / OTHER`

Ví dụ:

```text
Kho Hòa Xuân
├── RECEIVING
├── SALEABLE
│   ├── PANEL-A01
│   ├── INVERTER-B02
│   └── BATTERY-C01
├── PICKING
├── WARRANTY
├── DAMAGED
├── DEMO
└── QUARANTINE
```

Quy ước đề xuất:

`HX-A-02-03 = Kho Hòa Xuân / Khu A / Kệ 02 / Tầng 03`

---

## 25. Product tracking cho ngành solar

Product có:

- tracking: `NONE / LOT / SERIAL`;
- hasExpiry;
- costingMethod;
- baseUom;
- minStock/maxStock;
- reorderPoint;
- brand;
- model;
- origin;
- requiresCertificates;
- warrantyMonths.

Khuyến nghị:

- inverter, battery, charger/EVSE, thiết bị điện tử quan trọng → ưu tiên `SERIAL`;
- tấm pin → `LOT` hoặc `SERIAL` tùy dữ liệu thực tế;
- cáp/phụ kiện tiêu hao → `NONE` hoặc `LOT`.

Không hard-code tracking theo category; cấu hình ở Product.

---

## 26. Cảnh báo tồn kho – TP

Policy theo Product/Warehouse:

- min_stock;
- max_stock;
- reorder_point;
- preferred_reorder_qty;
- lead_time_days.

Cảnh báo:

- hết hàng;
- sắp hết;
- thiếu cho nhu cầu xác nhận;
- tồn lâu;
- incoming trễ;
- reservation sắp hết hạn.

Trang cảnh báo phải drill-down được về danh sách sản phẩm tương ứng.

---

## 27. Hàng ngoại lệ – TP

Các nhóm:

- Chờ kiểm tra.
- Bảo hành.
- Hàng lỗi.
- Demo/trưng bày.
- Quarantine.

Hàng trả về không tự trở lại `SALEABLE`.

Flow:

`Return → QUARANTINE/WARRANTY → Kiểm tra → SALEABLE / DAMAGED / Return Supplier`

NV chỉ xử lý bước được giao; TP quản lý toàn bộ queue ngoại lệ.

---

## 28. Phê duyệt – TP

### 28.1 Chờ duyệt

Tập trung các nghiệp vụ cần quyết định:

- điều chuyển exception;
- xuất ngoài reservation;
- hàng thiếu/chênh;
- return exception;
- stock count variance.

### 28.2 Chênh lệch kiểm kê

Hiển thị:

- expected;
- actual;
- variance;
- người đếm;
- người kiểm lại;
- lý do;
- tài liệu đính kèm.

### 28.3 Điều chỉnh tồn

Adjustment chỉ được tạo từ:

- kiểm kê được duyệt;
- sai lệch chứng từ được xác nhận;
- hư/mất có phê duyệt;
- nghiệp vụ correction hợp lệ.

Không cho nhập một con số tồn mới trực tiếp.

---

# PHẦN E – BÁO CÁO

## 29. Báo cáo NV

NV không cần menu báo cáo quản trị riêng.

Trong `Lịch sử xử lý`, NV xem:

- phiếu đã xử lý;
- thao tác đã thực hiện;
- thời gian;
- kết quả;
- lỗi/exception đã báo.

---

## 30. Báo cáo TP

### 30.1 Nhập – Xuất – Tồn

Theo:

- ngày;
- warehouse;
- category;
- product;
- brand.

### 30.2 Tồn theo kho

- On hand.
- Reserved.
- Available.
- Incoming.

### 30.3 Tồn Min/Max

- dưới Min;
- vượt Max;
- dưới reorder point.

### 30.4 Đang vận chuyển

- source;
- destination;
- ETA;
- quá ETA;
- chênh lệch khi nhận.

### 30.5 Lịch sử hàng hóa

- stock moves;
- serial timeline;
- lot timeline;
- user/action/reference.

### 30.6 Đối soát MISA

| SKU | Kho Tran Le | Kho MISA | Tran Le On-hand | MISA On-hand | Chênh lệch | Sync cuối |
|---|---|---|---:|---:|---:|---|

Không tự sửa stock chỉ để khớp MISA.

---

# PHẦN F – THIẾT KẾ UI/UX

## 31. Nguyên tắc giao diện

- Desktop-first.
- Table-first.
- Nền trắng/xám nhạt.
- Primary xanh dương theo Design System hiện tại.
- Border nhẹ.
- Radius 8–10px.
- Icon outline.
- Sticky table header.
- Server-side pagination/filter/search.
- Chi tiết nhanh dùng right drawer.
- Filter nâng cao dùng drawer/popover.
- Không dùng quá nhiều màu.
- Trạng thái luôn có text label.
- `Available` nổi bật hơn `On hand`.
- Không copy 1:1 giao diện MISA.

---

## 32. Quy tắc khác nhau giữa NV và TP

| Hạng mục | NV | TP |
|---|---|---|
| Dashboard | Việc của tôi | KPI toàn phòng/kho |
| Tồn kho | Tra cứu scope | Quản trị + policy |
| Nhập/Xuất | Xử lý phiếu được giao | Quản lý/phân công/exception |
| Điều chuyển | Gửi/nhận | Tạo/duyệt/theo dõi |
| Reservation | Chỉ phiếu liên quan | Quản trị toàn bộ |
| Kiểm kê | Đếm | Đối chiếu/duyệt |
| Serial/Lot | Tra cứu/scan | Quản trị/truy vết |
| Combo | Xem buildable qty | Quản lý bundle |
| Kho/Vị trí | Không | Có |
| Min/Max | Không sửa | Quản lý |
| Adjustment | Không | Theo quyền/phê duyệt |
| Báo cáo | Lịch sử của tôi | Báo cáo quản trị |
| MISA reconciliation | Không | Có |

---

# PHẦN G – RBAC / DATA SCOPE

## 33. Permission / Data scope

Áp dụng RBAC hiện có:

### Nhân viên Kho – managementLevel 10

- xem/thao tác resource được giao;
- chỉ thấy warehouse/location thuộc scope;
- không approve exception;
- không adjustment stock;
- không quản lý master data.

### Trưởng phòng Kho vận – managementLevel 20

- xem toàn bộ data của phòng/scope;
- quản lý/phân công nghiệp vụ;
- duyệt exception theo policy;
- quản lý dashboard/báo cáo;
- quản lý kho/vị trí nếu permission cho phép.

### Phó Giám đốc – managementLevel 30

- xem các phòng/kho được giao qua management scope.

### Giám đốc – managementLevel 40

- company scope theo RBAC.

### Admin – managementLevel 99

- cấu hình hệ thống;
- không tự có quyền business data nếu policy hiện tại chặn.

---

## 34. Frontend architecture

Không tạo 2 codebase riêng.

Dùng chung:

```text
InventoryPage
ReceiptPage
IssuePage
TransferPage
StockCountPage
SerialPage
BundlePage
```

Render theo:

```text
managementLevel
permissions
accessibleDepartments
warehouseScope
assignedUserId
```

Ví dụ:

```text
NV:
canViewOwnScope = true
canApproveException = false
canAdjustStock = false
canManageWarehouse = false

TP:
canViewDepartmentScope = true
canApproveException = true
canManageWarehouse = true
canViewManagementReports = true
```

Backend vẫn bắt buộc kiểm tra quyền ở API.

---

# PHẦN H – TÍCH HỢP MISA

## 35. Nguyên tắc tích hợp

1. Không giả định endpoint/field MISA.
2. Product/Warehouse/Document có integration mapping.
3. Frontend không gọi MISA trực tiếp.
4. Sync phải có idempotency key.
5. Có integration log.
6. Có reconciliation screen.
7. Không tự tạo mapping nếu ambiguous.
8. Không tự tạo adjustment chỉ để khớp dữ liệu MISA.

---

# PHẦN I – RULE KỸ THUẬT

## 36. Rule kỹ thuật

- Transaction + lock/optimistic concurrency khi reserve/issue.
- Idempotency cho callback/sync.
- Không xóa `stock_move` DONE.
- Sửa sai bằng reversal/adjustment.
- Unique serial theo policy.
- Server-side query cho bảng lớn.
- Index tối thiểu cho product, warehouse/location, serial, lot, reference, status, created_at.
- Audit action nhạy cảm:
  - reserve/release;
  - adjustment;
  - complete receipt;
  - complete issue;
  - transfer receive;
  - stock count approval.

---

## 37. Dependency / Ownership

### Dependency

- Product master.
- Purchasing.
- Sales Order.
- Project.
- Technical/Warranty.
- MISA Integration.

### Ownership

- Warehouse/Location/Stock Move/Stock Count → Kho vận.
- Product master → shared master có governance.
- Reservation request → Sales/Project/Service tạo nguồn; Kho xử lý.
- Costing/official accounting reconciliation → Kế toán + MISA.
- Serial warranty linkage → Kho vận + Kỹ thuật/Bảo hành.

---

# PHẦN J – PHẠM VI TRIỂN KHAI

## 38. Phase A – Core vận hành

- Sidebar NV/TP.
- Dashboard NV/TP.
- Tồn kho.
- Receipt.
- Issue.
- Transfer.
- Product Drawer.
- Reservation cơ bản.

## 39. Phase B – Truy vết và kiểm soát

- Serial/Lot.
- Stock Count.
- Warranty/Quarantine/Damaged.
- Min/Max.
- Slow-moving.
- Kho & vị trí.

## 40. Phase C – Solar optimization

- Combo/bundle buildable qty.
- QR/barcode.
- Shortage theo SO/Project.
- Đề xuất điều chuyển.

## 41. Phase D – Integration

- MISA mapping.
- Sync.
- Reconciliation.
- Automation có approval.

---

# 42. Acceptance Criteria UI chính

## 42.1 NV

- Login NV chỉ thấy sidebar NV.
- Dashboard chỉ hiện việc thuộc user/scope.
- Không thấy nút adjustment/approve/config.
- Có thể hoàn tất các bước receipt/issue/transfer/count được giao.
- Không xem được warehouse ngoài scope.

## 42.2 TP

- Login TP thấy sidebar quản trị đầy đủ.
- Dashboard tổng hợp toàn phòng/scope.
- Có thể phân công, duyệt exception và xử lý variance theo quyền.
- Có thể truy cập báo cáo và reconciliation.
- Có thể drill-down từ KPI sang Saved View tương ứng.

---

# 43. Kết luận thiết kế

Module Kho vận của Trần Lê phải được thiết kế theo nguyên tắc:

> **Nhân viên = xử lý việc được giao nhanh, gọn, ít nhiễu.**  
> **Trưởng phòng = quản trị toàn bộ vận hành, cảnh báo, phê duyệt và báo cáo.**

Hai cấp dùng chung dữ liệu và component nền, nhưng khác:

- sidebar;
- dashboard;
- action;
- widget;
- data scope;
- quyền phê duyệt/quản trị.

Cách này giúp giao diện Kho vận rõ vai trò hơn, không lặp menu, không để NV và TP nhìn cùng một màn hình, đồng thời vẫn giữ được kiến trúc RBAC và khả năng tích hợp MISA của hệ thống hiện tại.
