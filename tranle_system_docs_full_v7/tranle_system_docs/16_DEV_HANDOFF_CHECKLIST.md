# DEV HANDOFF CHECKLIST

## 1. Trước khi code

- Chốt DB production
- Chốt naming convention
- Chốt ID strategy
- Chốt timezone
- Chốt money type
- Chốt status enum
- Chốt soft delete
- Chốt audit strategy
- Chốt file storage
- Chốt permission/data scope

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

## Tài liệu bắt buộc phải kiểm tra trước khi code
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
