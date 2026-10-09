# DEV HANDOFF CHECKLIST

## 1. Trước khi code

Tất cả mục dưới đây đã có phương án trong `39_QUYET_DINH_NEN.md`. Dev chỉ bắt đầu phần phụ thuộc khi ADR tương ứng được đánh dấu ĐÃ DUYỆT.

- DB production: MySQL 8 (đã thống nhất)
- Naming convention: ADR-002
- ID strategy: ADR-001
- Timezone: UTC trong DB, múi giờ Việt Nam khi hiển thị và tính lịch làm việc (file 31)
- Money/quantity type: ADR-007
- Status enum và số cấp duyệt: ADR-009, `23_STATE_MACHINE.md`
- Soft delete: ADR-003
- Audit strategy: file 21, 22 (`audit_logs`), file 25
- File storage: ADR-005
- Permission/data scope: file 21, ADR-010, ADR-011
- Tác vụ nền/outbox: ADR-006
- Thứ tự phase: ADR-008, file 17
- Các ADR còn **MỞ** (016, 017, 019) phải có người quyết trước Phase 0 kết thúc

## 2. Mỗi module phải có

- Mục tiêu
- Actor
- Permission
- Data model
- State machine
- API
- UI list
- UI detail
- UI create/edit
- Filter
- Audit
- Notification
- Workflow
- Dashboard
- Test
- Migration
- Seed nếu cần

## 3. Checklist backend

- Validation
- Authorization
- Data scope
- Transaction
- Audit
- Idempotency nếu cần
- Pagination
- Filter whitelist
- Error handling
- Unit test
- Integration test

## 4. Checklist frontend

- Route permission
- Sidebar visibility
- List
- Search
- Filter
- Saved view
- Detail
- Create/edit
- Activity timeline
- Attachment
- Loading/error/empty state
- Responsive
- Role-based action visibility

## 5. Definition of Done

Một chức năng chỉ được coi là xong khi:
- API đúng quyền
- UI đúng role
- Có audit
- Có test
- Có migration
- Có tài liệu
- Có xử lý lỗi
- Không làm hỏng dữ liệu module khác
- Không thêm hard-code phê duyệt, hard-code ngưỡng tiền/chiết khấu hoặc enum trái ADR

## Tài liệu bắt buộc phải kiểm tra trước khi code
- `39_QUYET_DINH_NEN.md` (ADR)
- `40_BO_SUNG_NGHIEP_VU.md`
- `21_MA_TRAN_QUYEN_VA_DATA_SCOPE.md`
- `22_DATA_DICTIONARY.md`
- `23_STATE_MACHINE.md`
- `24_RACI_QUY_TRINH.md`
- `25_BUSINESS_RULES.md`
- `26_NOTIFICATION_MATRIX.md`
- `27_KPI_REPORT_DEFINITION.md`
- `28_API_STANDARD.md`
- `29_EDGE_CASES.md`
- `30_MISA_FIELD_MAPPING.md`
- `31_NON_FUNCTIONAL_REQUIREMENTS.md`
- `32_MIGRATION_PLAN.md`

## Tài liệu thiết kế/UAT bổ sung
- `33_ERD_VA_RELATIONSHIP.md`
- `34_SEQUENCE_DIAGRAMS.md`
- `35_SCREEN_SPECIFICATION.md`
- `36_MASTER_DATA_CONFIG.md`
- `37_UAT_END_TO_END.md`

## Điều kiện dừng bắt buộc
Mỗi feature/module phải đọc và tuân thủ `38_TEST_PLAN_AND_QUALITY_GATES.md`.

Không được đánh dấu DONE nếu:
- Unit/Integration/Permission/State test chưa pass;
- Regression fail;
- còn Critical/High bug;
- UAT chưa đạt với flow nghiệp vụ trọng yếu.
