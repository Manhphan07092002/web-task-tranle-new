# MẪU ĐẶC TẢ CHỨC NĂNG CHUẨN CHO DEV

Mọi chức năng mới phải được mô tả theo form này trước khi code.

## 1. Tên chức năng
Ví dụ: Tạo yêu cầu khảo sát.

## 2. Mục tiêu
Người dùng giải quyết vấn đề gì?

## 3. Actor
- Nhân viên Kinh doanh
- Trưởng Kinh doanh
- Kỹ thuật
...

## 4. Preconditions
Ví dụ:
- User đăng nhập.
- Có permission `technical_request.create`.
- Opportunity tồn tại và user có quyền đọc.

## 5. Input
Liệt kê từng field:
| Field | Type | Required | Rule |
|---|---|---|---|

## 6. Main Flow
1. User mở form.
2. Hệ thống preload dữ liệu.
3. User nhập.
4. Frontend validate.
5. Backend validate.
6. Backend kiểm tra permission.
7. Transaction lưu.
8. Audit.
9. Emit event.
10. Notification.
11. Trả response.

## 7. Alternate Flow
- thiếu dữ liệu;
- record bị xóa;
- không đủ quyền;
- trùng dữ liệu;
- conflict;
- external API lỗi.

## 8. State Transition
Ghi rõ state nào được chuyển sang state nào, bởi role nào.

## 9. Permission
- Create
- Read Own
- Read Department
- Update
- Delete/Cancel
- Approve

## 10. Audit
Field/action nào phải ghi lịch sử?

## 11. Notification
Ai nhận? Khi nào? Link về đâu?

## 12. API
Method, path, request, response, error.

## 13. UI
- route;
- list columns;
- filter;
- detail tabs;
- actions;
- empty/loading/error.

## 14. Acceptance Criteria
Viết theo Given/When/Then.

## 15. Test Cases
- happy path;
- permission;
- invalid transition;
- duplicate;
- transaction rollback;
- concurrency;
- audit;
- notification.

## 16. Definition of Done
- Migration
- API
- UI
- Permission
- Audit
- Test
- Documentation
- Monitoring/log
