# Tran Le Tasks — Nền tảng Quản trị & Cộng tác nội bộ Tran Le Electricity

Hệ thống **Tran Le Tasks** là giải pháp quản trị công việc, dự án năng lượng tái tạo, hợp đồng, kho vận và cộng tác nội bộ cho **Công ty Cổ phần Tư vấn xây dựng Điện Trần Lê (Tran Le Electricity — tranlecorp.com.vn)**. Hệ thống là một **monorepo** (npm workspaces: `frontend`, `backend`) bao gồm quản lý tiến độ công việc, dự án điện mặt trời & đấu thầu, kho hàng, hợp đồng, đặt phòng họp, lịch biểu, email nội bộ (IMAP/SMTP) và trợ lý ảo AI.

> Tài liệu này mô tả trạng thái **thực tế** của mã nguồn. Thông tin chi tiết về kiến trúc, bảng dữ liệu, route, RBAC và các phase triển khai nằm trong [`CLAUDE.md`](CLAUDE.md) và [`phan_tich.MD`](phan_tich.MD).

## ✨ Tính năng chính

- **Quản lý công việc (Task Management):** Kanban Board, List View, Calendar View; giao việc, gắn thẻ, subtask, bình luận, cập nhật tiến độ (Todo / In Progress / Review / Done), task lặp lại.
- **Lịch & Phòng họp (Calendar & Meetings):** Đặt lịch họp, quản lý phòng họp thời gian thực qua Socket.IO, phòng họp video WebRTC (kèm làm mờ nền bằng MediaPipe).
- **Danh bạ Đội ngũ (Team Directory):** Hồ sơ nhân sự (email, điện thoại, ngày sinh, quê quán, CCCD, giới tính) với Click-to-Call / Click-to-Email.
- **Hệ thống Mail (IMAP/SMTP):** Đọc/soạn/gửi email nội–ngoại bộ, chữ ký tự động, lưu nháp, đính kèm, gửi theo lịch, theo dõi lượt mở, quota hộp thư.
- **Hợp đồng & Doanh thu:** Quản lý hợp đồng đầu vào/đầu ra, workflow duyệt theo cấp, thanh toán, liên kết hợp đồng, báo cáo doanh thu.
- **Dự án điện mặt trời & Đấu thầu:** Danh sách/tiến độ dự án, mốc (milestone), báo cáo tiến độ, hồ sơ đấu thầu.
- **Kho vận / Stock (đang xây dựng):** Nhập – xuất – điều chuyển – kiểm kê, tồn kho bất biến theo `stock_moves`, serial/lô, combo/bộ sản phẩm, giữ hàng (reservation), cảnh báo tồn, đối soát MISA.
- **Báo cáo & Phân tích:** Dashboard KPI, biểu đồ hiệu suất cá nhân/phòng ban, xuất Excel.
- **Quản trị viên (Admin Panel):** Quản lý người dùng, vai trò & phân quyền, phòng ban, sao lưu/khôi phục dữ liệu dạng JSON, cấu hình hệ thống.
- **Trợ lý AI (Gemini Assistant):** Tư vấn, tạo mẫu task, gợi ý công việc ngay trong hệ thống.
- **Real-time Collaboration:** Đồng bộ dữ liệu thời gian thực (Socket.IO) cho thông báo và phòng họp.
- **Hệ thống theo phòng ban:** Menu và trang làm việc riêng theo từng phòng ban, phân quyền theo cấp bậc (`managementLevel`) và phạm vi dữ liệu.

## 💻 Tech Stack

Đã xác minh từ `package.json` của từng workspace.

**Frontend** (`frontend/`)

- React **19** + React DOM 19, React Router **7**
- Vite **6** + TypeScript ~5.8 (strict)
- TailwindCSS **4** (`@tailwindcss/vite`)
- `@tanstack/react-query` (server state), `socket.io-client` (realtime)
- `@hello-pangea/dnd` (Kanban), `recharts` (biểu đồ), `exceljs` (export Excel), `dompurify` (chống XSS), `flatpickr`, `react-to-print`, `motion`, `lucide-react`
- `@mediapipe/*` (camera / làm mờ nền cho phòng họp)

**Backend** (`backend/`)

- Node.js + Express **5** + TypeScript ~5.8, chạy runtime bằng **`tsx`** (không build ra JS)
- CSDL **MySQL 8** (`mysql2`) duy nhất, kết nối qua `DATABASE_URL`
- `helmet` + CSP, `jsonwebtoken`, `bcryptjs`, `socket.io`
- `nodemailer` (SMTP), `imapflow` + `mailparser` (IMAP)
- `multer` + `file-type` (upload), `zod` (validation), `express-rate-limit`, `cors`, `dotenv`
- `@google/genai` (Gemini ở backend — **không** đặt API key trong biến `VITE_*`)
- Test: `vitest` + `supertest`

**Package manager:** npm (npm workspaces, có `package-lock.json`).

## 🚀 Hướng dẫn cài đặt (Run Locally)

**Yêu cầu hệ thống:**

- [Node.js](https://nodejs.org/) phiên bản 18 trở lên (Docker image dùng Node 22)
- npm
- **MySQL 8** đang chạy (hệ thống không còn dùng SQLite/PostgreSQL)

### Bước 1: Cài đặt dependencies

Từ thư mục gốc (root), chạy một lệnh để cài cho cả frontend và backend (npm workspaces):

```bash
npm install
```

### Bước 2: Cấu hình biến môi trường

Tạo file `.env` từ mẫu `.env.production.example` (root) và thiết lập tối thiểu:

- `DATABASE_URL=mysql://<user>:<password>@localhost:3306/Tranle_task_new`
- `JWT_SECRET` — chuỗi ngẫu nhiên ≥ 32 ký tự. Ở chế độ dev nếu bỏ trống, backend sẽ tự sinh tạm và cảnh báo.
- `ADMIN_DEFAULT_PASSWORD` — mật khẩu tài khoản admin bootstrap. Ở dev mặc định là `TranLe@dmin2026!`; production bắt buộc ≥ 16 ký tự và không được để placeholder.
- Cấu hình SMTP (`SMTP_*`) nếu dùng tính năng gửi mail.

Ở production, backend **fail-fast** nếu thiếu/để placeholder các biến bắt buộc (`JWT_SECRET`, `MAIL_ENCRYPTION_KEY`, `APP_BASE_URL`, `ALLOWED_ORIGIN`, `ADMIN_DEFAULT_PASSWORD`) hoặc nếu `APP_BASE_URL`/`ALLOWED_ORIGIN` không phải HTTPS.

> Không đặt API key của nhà cung cấp AI vào biến `VITE_*` — biến này lộ ra trình duyệt. Mọi request AI đi qua backend.

### Bước 3: Khởi chạy hệ thống

Từ thư mục gốc, lệnh này chạy song song Backend (cổng **3500**) và Frontend (cổng **5173**):

```bash
npm run dev
```

Khi DB mới, backend tự tạo schema và seed dữ liệu cấu hình cơ bản (công ty, vai trò, phòng ban, tài khoản admin). Dữ liệu demo (sản phẩm, dự án, khách hàng, hợp đồng, task...) chỉ seed ngoài production hoặc khi đặt `SEED_DEMO_DATA=true`.

### Bước 4: Đăng nhập

Mở trình duyệt truy cập `http://localhost:5173`.

- **Email:** `admin@tranlecorp.com.vn`
- **Mật khẩu:** giá trị `ADMIN_DEFAULT_PASSWORD` (dev mặc định `TranLe@dmin2026!`)

Sau lần đăng nhập đầu tiên nên đổi mật khẩu và cấu hình tài khoản thật.

## 🛠 Scripts (chạy từ thư mục gốc)

```bash
npm install            # Cài tất cả (root + frontend + backend)
npm run dev            # Dev: backend :3500 + frontend :5173 (concurrently)
npm run build          # Build frontend (tsc -b && vite build)
npm run start:prod     # Production: NODE_ENV=production PORT=3500, backend serve cả SPA

cd backend && npm test         # vitest run (backend/tests/**/*.test.ts)
cd backend && npm run test:watch

docker-compose up -d --build   # Docker (app + MySQL 8 + Poste.io mailserver)
```

## 📁 Cấu trúc thư mục

```text
web-task-tranle-new/
├── package.json              # Root — npm workspaces + scripts concurrently
├── docker-compose.yml        # app + MySQL 8 + mailserver (Poste.io)
├── Dockerfile                # Multi-stage: build frontend → serve từ backend
├── ecosystem.config.cjs      # PM2 production config
├── .env.production.example   # Mẫu biến môi trường
├── frontend/                 # React 19 + Vite + Tailwind 4
│   ├── App.tsx               # Router + business logic (task, modal, notification)
│   ├── types.ts              # Kiểu dữ liệu dùng chung
│   ├── components/           # Component dùng chung (TaskModal, AIAssistant, MeetingRoom, layout/menus/...)
│   ├── pages/                # 20+ nhóm trang (Dashboard, Tasks, Mail, Contracts, ..., Warehouse/)
│   ├── contexts/             # Auth, Data (react-query), Language, Notification
│   ├── services/             # 19 file service gọi API (api.ts là base wrapper)
│   ├── hooks/                # useRBAC, useDeviceSelection, useVirtualBackground, ...
│   └── utils/                # rbac.ts, dateUtils.ts, exportXlsx.ts
├── backend/                  # Express 5 + TypeScript (tsx runtime)
│   ├── server.ts             # Entry point — Express setup + mount route
│   ├── db_mysql.ts           # MySQL adapter + schema + seeds + SQL normalizer
│   ├── socket.ts             # Socket.IO init
│   ├── mailer.ts             # Nodemailer transporter
│   ├── middleware/           # auth.ts, rbac.ts, validate.ts, errorHandler.ts
│   ├── routes/               # 25 module route
│   ├── services/             # rbacService.ts
│   ├── schedulers/           # 6 cron job
│   ├── migrations/           # Migration SQL (department system, indexes...)
│   ├── utils/                # crypto, transaction gate, mail/TLS, migrations...
│   └── tests/                # Vitest: auth, RBAC/ownership, AI, mail, upload, stock, ...
├── uploads/                  # File upload runtime (gitignore)
└── scripts/                  # Script tiện ích
```

## 📚 Tài liệu liên quan

- [`CLAUDE.md`](CLAUDE.md) — hướng dẫn kiến trúc & quy ước code cho AI/dev.
- [`phan_tich.MD`](phan_tich.MD) — phân tích tổng thể (bảng dữ liệu, route, RBAC, changelog).
- [`DOC_INDEX.md`](DOC_INDEX.md) — mục lục tài liệu triển khai theo phòng ban.
- [`TRANLE_DESIGN_SYSTEM.md`](TRANLE_DESIGN_SYSTEM.md) — hệ thống thiết kế UI/UX.

## 🤝 Hỗ trợ

Nếu gặp khó khăn khi cài đặt/vận hành, kiểm tra log terminal hoặc liên hệ đội ngũ phát triển.
