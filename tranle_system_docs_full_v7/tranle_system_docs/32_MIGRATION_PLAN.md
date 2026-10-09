# MIGRATION PLAN TỪ HỆ THỐNG HIỆN TẠI

## 1. Nguyên tắc
Không đập đi làm lại.

Mỗi phần phân loại:
- KEEP
- EXTEND
- RENAME
- MIGRATE
- DEPRECATE
- REMOVE sau đối chiếu

## 2. Khảo sát trước migration
- chụp schema DB;
- liệt kê table/column/index;
- record count;
- xác định dữ liệu production;
- API đang dùng;
- frontend route;
- test hiện tại;
- backup DB.

## 3. Mapping mẫu
| Hiện tại | Mới | Hành động |
|---|---|---|
| users | users + employees | EXTEND/SPLIT logic |
| role string | roles/permissions | MIGRATE |
| department string | departments + department_id | MIGRATE |
| clients | customers | RENAME/MIGRATE nếu phù hợp |
| products.remainingQuantity | opening stock + stock ledger | MIGRATE |
| tasks | tasks mở rộng | EXTEND |
| projects | projects nâng cấp | EXTEND |
| contracts | contracts + payment milestones | EXTEND |

Tên bảng thật phải kiểm tra repo/database.

## 4. Department Migration
1. Tạo departments.
2. Seed 9 phòng chuẩn.
3. Map string cũ → id.
4. Thêm department_id.
5. Backfill.
6. Validate.
7. Chuyển code dùng id.
8. Deprecate string cũ sau ổn định.

## 5. Role/Permission Migration
1. Tạo roles/permissions.
2. Map role cũ.
3. Seed permission.
4. Gán user role.
5. Middleware mới.
6. Regression test.
7. Bỏ logic cũ sau khi ổn.

## 6. Inventory Migration
Nếu đang dùng remainingQuantity:
1. Snapshot quantity.
2. Tạo Warehouse/Location mặc định.
3. Tạo opening stock movement/balance.
4. Đối chiếu tồn cũ = mới.
5. Chuyển mọi nhập/xuất sang ledger.
6. Cấm update quantity trực tiếp.

## 7. Customer Migration
Nếu `clients` tồn tại:
- map field;
- business key;
- chống duplicate;
- giữ old_id mapping;
- update FK.

## 8. Contract Migration
- giữ record cũ;
- bổ sung status/version;
- tạo payment milestones từ dữ liệu đã biết;
- không bịa dữ liệu thiếu.

## 9. Task/Project Migration
- thêm field nullable trước;
- backfill dữ liệu xác định được;
- unknown để NULL + cleanup report.

## 10. Rollback
Mỗi migration có:
- backup;
- forward script;
- rollback/restore path;
- validation query;
- row count trước/sau.

## 11. Cutover
- staging;
- UAT;
- freeze window nếu cần;
- backup;
- production migration;
- smoke test;
- reconciliation;
- monitoring.

## 12. Không được làm
- drop column có dữ liệu ngay;
- đổi type không backup;
- tạo dữ liệu giả để lấp required field;
- xóa ID cũ khi integration/report còn tham chiếu.
