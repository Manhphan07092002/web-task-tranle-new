# Cập nhật nhân sự Trần Lê — 07/10/2026

Đối chiếu repository `Manhphan07092002/web-task-tranle-new`, commit `d7d845ee8c3616b7e92a726837aff6ad0490d6df`.
Database hiện tại là MySQL 8. Bộ này chứa 36 hồ sơ, 9 đơn vị và 35 phân công, gồm hai phân công của Lê Nguyễn Hoàng Kim. Có hai người chưa xác nhận phòng chuyên môn. Ngày sinh và số điện thoại lấy từ nguồn; email theo quy ước công ty, chưa xác minh hộp thư.

## Cách dùng

Chép thư mục này vào `backend/scripts/tranle-personnel` của dự án hiện tại. Cài dependencies của dự án bằng `npm ci` tại thư mục gốc nếu chưa có. Dùng biến `DATABASE_URL` của server hoặc file `.env` trong thư mục làm việc. Script không có URL, mật khẩu hoặc database mặc định.

Sao lưu database hiện tại trước khi áp dụng; không chạy ứng dụng đồng thời với import để tránh thay đổi nhân sự/phòng ban trong quá trình đối soát.

Chạy kiểm tra dữ liệu (không ghi database):

```bash
cd backend
node scripts/tranle-personnel/import.mjs
```

Nếu kiểm tra không báo xung đột, nhập dữ liệu:

```bash
node scripts/tranle-personnel/import.mjs --apply
```

Nếu email và tên khớp hai tài khoản khác nhau, hoặc có tên trùng, script dừng để xử lý xung đột; không tự đoán tài khoản cần giữ.

## Các thay đổi

- Thêm cột `users.employeeCode`, `jobTitle`, `branchLabel`, `assignmentStatus`. ID kỹ thuật trong `users.id` giữ nguyên cho hồ sơ cũ. Mã TL là mã hiển thị, không dùng để thay khóa tài khoản cũ.
- Thêm bảng `user_assignments`: chức vụ, phòng, phân công chính, trạng thái xác nhận và ghi chú. Phân công đề xuất không tự tạo quyền hệ thống.
- Khớp nhân sự theo mã, email hoặc họ tên chính xác; nếu các khóa khớp nhiều tài khoản thì dừng. Cập nhật tên, email, SĐT, ngày sinh, giới tính, mã, chức vụ, chi nhánh, phòng chính và role hệ thống cho đúng 36 hồ sơ nhân sự; tài khoản ngoài danh sách không bị sửa.
- Ánh xạ role theo sơ đồ đơn vị: trưởng Ban Giám đốc (`head_employee_id` của `BGD`) dùng `Director`; trưởng các đơn vị khác được khai báo trong `head_employee_id` dùng `Manager`; nhân sự còn lại dùng `Employee`. Trạng thái chức danh kiêm nhiệm không tự làm tăng role. Script dừng nếu khớp nhầm tài khoản `Admin` để tránh hạ quyền quản trị.
- Tài khoản mới dùng role theo ánh xạ trên, không có mật khẩu và bị khóa. Với tài khoản đã có, mật khẩu và trạng thái khóa được giữ nguyên. Quản trị viên xác minh quyền, đặt mật khẩu riêng và mở khóa khi phù hợp. Không gửi thư hoặc tạo hộp thư trong quá trình nhập.
- Email/phòng/role thay đổi tăng tokenVersion; email thay đổi xóa reset token chưa dùng. Người đang đăng nhập cần đăng nhập lại khi thông tin xác thực hoặc quyền thay đổi.
- Tạo hoặc tái sử dụng 9 phòng theo tên chuẩn và cập nhật đầu mối đã biết. Phan Thị Thu Thảo được ghi là Kế toán trưởng; không tự đổi thành Trưởng phòng. Không xóa phòng cũ, tài khoản mẫu, task, hợp đồng hoặc dự án. Vì giữ phòng cũ, tổng danh mục phòng trên UI có thể lớn hơn 9 cho đến khi ánh xạ dữ liệu lịch sử.
- Hai nhân sự chưa xếp phòng giữ phòng cũ nếu có, nếu mới thì để chuỗi rỗng. HCNS và Mua hàng giữ trạng thái đề xuất theo tài liệu. Email Hồ Thị Ánh Nguyệt có đủ; giới tính vẫn null.
- DDL restart-safe; dữ liệu nhập trong transaction và có migration lock. Lỗi phần DDL có thể để lại cột/bảng mới vì MySQL tự commit DDL; có thể chạy lại sau khi xử lý lỗi. Không ghi phiên bản vào `_migrations` của ứng dụng để tránh tranh số migration với repo.

## Hiển thị trong ứng dụng

API hiện có đã trả các trường tên, email, SĐT, ngày sinh và giới tính theo quyền. Các cột mới và `user_assignments` chưa được API/UI hiện tại sử dụng: cần bổ sung query và kiểu User để hiển thị mã/chức vụ/chi nhánh, cùng API phân công để xem đủ kiêm nhiệm. `userCount` hiện tại vẫn đếm theo phòng chính; không thể hiện số phân công phụ. Không đồng nhất chức vụ với role/quyền đăng nhập.

Sau khi nhập, kiểm tra 36 mã TL, 35 dòng `tle-PC...` trong `user_assignments`, email không trùng, hai phân công `TL.PGD-TPKD.002`, SĐT giữ số 0 và không mất liên kết `task_assignees.userId`/`projects.managerId`.

## Kiểm thử đã thực hiện

`node --check import.mjs` và `node --test plan.test.mjs`: kiểm tra số lượng, ánh xạ role theo trưởng đơn vị, không hạ role Admin, kiêm nhiệm, giữ ID cũ khi email đổi, xung đột email/tên, chạy lặp lại và xung đột ID phòng. Cần chạy dry-run và backup database trước khi dùng `--apply`.
