# CLAUDE.md — Tran Le Tasks

Hướng dẫn lâu dài cho Claude Code khi làm việc với repository này. Chỉ chứa thông tin đã được xác minh từ source code. Mục nào chưa xác định được ghi rõ "Chưa xác định".

---

## 1. Project overview

**Tran Le Tasks** — nền tảng quản trị công việc, dự án điện mặt trời & cộng tác nội bộ cho **Công ty Cổ phần Tư vấn xây dựng Điện Trần Lê (Tran Le Electricity / tranlecorp.com)**. Kiến trúc **monorepo** (npm workspaces: `frontend`, `backend`). Bao gồm: quản lý công việc (Kanban/List/Calendar), hợp đồng, dự án điện mặt trời & đấu thầu, doanh thu, kho hàng, báo cáo, webmail IMAP/SMTP, phòng họp WebRTC, AI assistant (Bot Tran Le AI), thông báo realtime.

Domain production: `task.tranlecorp.com.vn` / `tasks.tranlecorp.com.vn` (hoặc `tranlecorp.com`).

## 2. Technology stack

Đã xác minh từ `package.json` các workspace.

**Frontend** (`frontend/`):
- React 19 + React DOM 19
- Vite 6 (build + dev server)
- TypeScript ~5.8 (strict mode bật)
- TailwindCSS 4 (`@tailwindcss/vite`)
- React Router DOM 7
- `@tanstack/react-query` 5 (server state)
- `socket.io-client` 4 (realtime)
- `recharts` 3 (biểu đồ), `motion` 12 (animation), `lucide-react` (icons)
- `@hello-pangea/dnd` (Kanban drag & drop)
- `dompurify` (chống XSS), `flatpickr` (date picker), `react-to-print`
- `exceljs` (export Excel qua `frontend/utils/exportXlsx.ts`)
- `@mediapipe/*` (camera / background blur cho phòng họp)
- Không cài AI SDK ở frontend; request AI đi qua backend API.

**Backend** (`backend/`):
- Node.js + Express 5
- TypeScript ~5.8, chạy runtime bằng `tsx` (KHÔNG build ra JS trước khi chạy dev/start)
- Database: MySQL 8 (`mysql2`) duy nhất (`backend/db_mysql.ts`)
- `helmet` 8 (HTTP security headers và CSP)
- `jsonwebtoken` (JWT auth), `bcryptjs` (hash password)
- `socket.io` 4 (WebSocket server)
- `nodemailer` (SMTP), `imapflow` + `mailparser` (IMAP)
- `multer` (upload), `zod` (validation), `express-rate-limit`, `cors`, `dotenv`
- `@google/genai` 1.48 (Gemini backend)
- Test: `vitest` + `supertest`

**Package manager:** npm (có `package-lock.json`, dùng workspaces).

## 3. Project structure

```
web_tranle_new/
├── package.json              # Root — npm workspaces + scripts concurrently
├── docker-compose.yml        # app + poste.io mailserver
├── Dockerfile                # Multi-stage: build frontend → serve từ backend
├── ecosystem.config.cjs      # PM2 production config
├── .env.production.example    # Mẫu biến môi trường
├── frontend/                 # React 19 + Vite + Tailwind 4
│   ├── App.tsx               # Router + business logic (lớn)
│   ├── types.ts              # 20+ TS interfaces/enums
│   ├── vite.config.ts        # Proxy /api + /socket.io → backend :3500
│   ├── components/           # Component dùng chung (+ layout/menus/, meeting/, admin/)
│   ├── pages/                # 20+ nhóm trang (Dashboard, Tasks, Mail, Contracts..., Warehouse/ 19 trang, DepartmentStubPage)
│   ├── contexts/             # AuthContext, DataContext, LanguageContext, NotificationContext
│   ├── services/             # 19 file service gọi API (api.ts là base wrapper)
│   ├── hooks/                # useRBAC, useDeviceSelection, useVirtualBackground, useMailConnectionCooldown
│   └── utils/                # rbac.ts, dateUtils.ts, exportXlsx.ts
├── backend/                  # Express 5 + TypeScript (tsx runtime)
│   ├── server.ts             # Entry point — Express setup + mount routes
│   ├── db_mysql.ts           # MySQL schema + versioned migrations (v1–v25) + seeds + SQL normalizer
│   ├── socket.ts             # Socket.io init
│   ├── mailer.ts             # Nodemailer transporter
│   ├── middleware/           # auth.ts, rbac.ts (scope/ownership/approval), validate.ts (zod)
│   ├── routes/               # 25 module route (ai, auth, stock, stockReports, warehouses, ...)
│   ├── services/             # rbacService.ts (department/warehouse scope + approval matrix)
│   ├── schedulers/           # 6 cron job (có thêm reservationExpiry.ts)
│   ├── migrations/           # SQL migration 004–006 (indexes, legacy columns, department system)
│   ├── utils/                # cryptoUtils, notify, dbMigrations, dbTransactionGate, dbBootstrap, mail helpers
│   └── tests/                # 29 suite Vitest (auth, RBAC/ownership/scope, AI, mail, upload, stock, rbacService...)
├── uploads/                  # File upload lưu ở đây
└── scripts/
```

Chi tiết đầy đủ (danh sách 25 route module, 51+ bảng): xem [phan_tich.MD](phan_tich.MD).

## 4. Development commands

Chạy từ **thư mục root** trừ khi ghi chú khác.

```bash
npm install            # Cài tất cả (root + frontend + backend qua workspaces)
npm run dev            # Dev: backend :3500 + frontend :5173 song song (concurrently)
npm run build          # Build frontend (tsc -b && vite build)
npm run start:prod     # Production: NODE_ENV=production PORT=3500, chạy backend serve cả SPA

cd backend && npm test         # vitest run (chỉ backend/tests/**/*.test.ts)
cd backend && npm run test:watch

docker-compose up -d --build   # Docker (app + mysql + mailserver)
```

**Typecheck:**
- Frontend: `cd frontend && npx tsc -b` (hoặc chạy `npm run build`)
- Backend: `cd backend && npx tsc --noEmit` — LƯU Ý: `backend/tsconfig.json` chỉ `include: ["server.ts"]`, không cover toàn bộ. Backend chạy trực tiếp bằng `tsx`, không compile.

**Lint/Format:** Chưa xác định — không tìm thấy cấu hình ESLint/Prettier trong repo.

## 5. Frontend architecture

- **Entry:** `main.tsx` → `App.tsx`. `App.tsx` chứa router + phần lớn business logic (permission, modal, notification, task handling) và truyền nhiều props xuống pages.
- **Routing:** React Router DOM 7. 20+ nhóm trang trong `pages/`. 9 phòng ban (WAREHOUSE, SALES, ACCOUNTING, HR, PROJECT, TECHNICAL_WARRANTY, MARKETING, PROCUREMENT, BOARD) có menu riêng (`components/layout/menus/departmentMenus.ts` + `resolveDepartment.ts`, quyền qua `minLevel`); hiện chỉ **Warehouse** có trang thật (`pages/Warehouse/*` — 19 trang nghiệp vụ kho), 8 phòng ban còn lại về `DepartmentStubPage` (đang phát triển).
- **Server state:** `@tanstack/react-query` qua `DataContext` — fetch tasks/notes/users/reports/roles/departments/contracts/revenue/clients/projects. Mutations gọi `invalidateQueries` khi thành công.
- **Contexts:** `AuthContext` (JWT login/logout), `DataContext` (react-query), `LanguageContext` (i18n vi/en), `NotificationContext` (Socket.io + local).
- **API layer:** mọi service trong `services/` gọi qua `services/api.ts` (base fetch wrapper + gắn `Authorization: Bearer <token>`).
- **Realtime:** `socket.io-client`, dev proxy `/socket.io` → backend.
- **Code splitting:** `React.lazy()` cho component nặng (Meeting).

## 6. Backend architecture

- **Entry:** `server.ts` — tạo Express app, `trust proxy = 1`, Helmet/CSP, CORS allowlist, JSON limit 5 MB, URL-encoded limit 64 KB/100 parameters; rate limit global 5000/15 phút, login 10/15 phút, upload 30/15 phút; mount API, init Socket.IO + schedulers, serve SPA từ `frontend/dist`. File upload đi qua API có xác thực, không mount thư mục upload thành static public.
- **Route pattern:** mỗi file export một factory `xxxRoutes(db)` trả về `express.Router()`. Mount trong `server.ts` với middleware `requireAuth` (và `requireAdmin` cho `/api/admin`). `stockReports.ts` được mount bên trong `stock.ts` (`router.use(stockReportRoutes(db))`), không phải route độc lập.
- **RBAC backend:** `middleware/rbac.ts` (requireRole/permission, `applyTaskScopeFilter`, `canViewResource`/ownership, approval theo cấp) + `services/rbacService.ts` (tính phạm vi department/warehouse, ma trận duyệt theo management level). Header `X-Department-Id`/`X-Management-Level` đồng bộ từ frontend qua middleware auth.
- **DB injection:** đối tượng `db` được tạo trong `server.ts` thông qua `initDbMysql()` (`db_mysql.ts`) và truyền vào mọi route factory.
- **Auth-free routes:** chỉ `/api/auth/*` (login, register, forgot/reset password) và `/health` không cần token.

## 7. Database architecture

- **Database:** MySQL 8 (`mysql2`), kết nối qua `DATABASE_URL=mysql://user:pass@host:port/dbname`; mặc định mới là `Tranle_task_new`. Với deployment hiện hữu, cập nhật cả `MYSQL_DATABASE` và path trong `DATABASE_URL`; không xóa volume/database cũ. Volume MySQL đã khởi tạo có thể cần tạo schema mới và cấp quyền cho user ứng dụng trước khi start. Adapter `backend/db_mysql.ts` khớp interface `db` (`get`/`all`/`run`/`exec`/`close`). Dùng một connection sống lâu; `DatabaseTransactionGate` tuần tự hóa truy vấn và dùng `AsyncLocalStorage` để transaction của một request không bị truy vấn request khác xen vào. Khi thêm transaction, bảo đảm mọi query nằm trong cùng request context và luôn xử lý rollback.
- **Khác biệt dialect với MySQL** được gom trong `normalizeSql()` của `db_mysql.ts` (KHÔNG sửa route): `BEGIN TRANSACTION`→`START TRANSACTION`, `INSERT OR IGNORE`→`INSERT IGNORE`, `ON CONFLICT...DO UPDATE`→`ON DUPLICATE KEY UPDATE`, `"to"/"from"/"key"/"value"`→backtick, `sqlite_master`→`information_schema`.
- **DDL MySQL** kiểu: `TEXT PK/UNIQUE`→`VARCHAR`, `REAL`→`DOUBLE`, boolean-`INTEGER`→`TINYINT`, date/JSON giữ dạng chuỗi. Charset `utf8mb4_unicode_ci`.
- **51 bảng cố định** (50 DDL trong `db_mysql.ts` + `_migrations`). Nhóm Kho vận: `warehouses`, `user_warehouse_scopes`, `stock_locations`, `stock_documents`, `stock_document_lines`, `stock_moves`, `stock_balances`, `product_warehouse_policies`, `reservations`, `stock_serials`, `product_bundles`, `product_bundle_items`, `stock_counts`, `stock_count_lines`, `misa_mappings`, `misa_sync_logs`, `uploaded_files`. `positions`/`user_positions` (tạo bởi migration 006) bị drop nếu rỗng bởi versioned migration v14. Danh sách chi tiết trong [phan_tich.MD](phan_tich.MD) mục 4.
- **Cơ chế migration 2 tầng:** (1) file SQL trong `backend/migrations/` (004_indexes, 005_drop_legacy_columns, 006_department_system) chạy ép buộc khi khởi động; (2) versioned migrations chạy qua `runVersionedMigration()` trong `db_mysql.ts` (v1–v25 — bảo mật, RBAC columns, warehouses, stock schema, MISA, hội tụ ledger/reservations...) ghi dấu trong bảng `_migrations`, chạy dưới `withMigrationLock` vì MySQL DDL không transactional.
- **Partial unique index của `products`** KHÔNG tồn tại trên MySQL — dựa vào kiểm tra trùng ở tầng app trong `products.ts`.

## 8. Authentication

- **Cơ chế:** JWT (`jsonwebtoken`), hết hạn `7d`. Token chứa `sub` và `tokenVersion`; middleware đọc trạng thái user/quyền hiện tại từ DB.
- **Login:** `POST /api/auth/login` → bcrypt compare (có dummy hash để giảm timing enumeration) → JWT. Email không tồn tại, password sai hoặc account bị khóa trả cùng lỗi `401 Invalid credentials`.
- **Client:** lưu token + user trong `localStorage` (`tranle_token`, `tranle_user`), gắn header `Authorization: Bearer <token>` mọi request.
- **Middleware:** `requireAuth` (verify token → `req.user`) trong `backend/middleware/auth.ts`.
- **Bảo vệ tài khoản:** không tự khóa theo số lần đăng nhập sai để tránh lockout DoS; giới hạn theo IP. Khóa thủ công của Admin (`isLocked`) vẫn được tôn trọng. Các cột legacy `failedLogins`/`lockedUntil` còn trong schema.
- **Reset password:** phản hồi yêu cầu chung để tránh dò email; reset token lưu dạng hash, có rate limit, thời hạn và transaction cập nhật một lần.

## 9. Authorization / RBAC

- **Model:** `roles` (permissions lưu JSON + cột `managementLevel`), `users.role` là tên role, `users.managementLevel` (99 Admin / 40 Director / 30 Deputy Director / 20 Manager / 10 Employee). Middleware `requireAdmin` kiểm tra `req.user.role === 'Admin'`.
- **5 role seed:** Admin (16 perms), Director (7), Deputy Director (6), Manager (9), Employee (4). `managementLevel` 99 (Admin), 40 (Director), 30 (Deputy Director), 20 (Manager), 10 (Employee). Ma trận quyền đầy đủ: [phan_tich.MD](phan_tich.MD) mục 5.
- **Hệ thống phòng ban:** `departments` có thêm `code` (BGD, KT, HCNS, KD, DA, KTBH, MKT, KHO, MH), `parentId`, `level` (1=Ban Giám Đốc, 2=phòng ban chính), `isActive` (migration 006). Frontend quản lý menu theo từng phòng ban.
- **Phạm vi dữ liệu:** `rbacService.ts` + `middleware/rbac.ts` phối hợp `management_scopes` (quyền quản lý phòng ban) và `user_warehouse_scopes` (quyền kho) để giới hạn dữ liệu theo department/warehouse; hỗ trợ quy trình duyệt theo cấp (Manager → Director/Deputy).
- **Lưu ý lệch thiết kế (D4):** quyết định kiến trúc yêu cầu Admin (99) KHÔNG truy cập dữ liệu kinh doanh, nhưng implementation vẫn cấp Admin `admin_panel` + `view_all_tasks` (task backend `applyTaskScopeFilter` và App.tsx cho Admin `1=1`/xem tất cả), và Admin được phép xoá task. Cần chốt lại trước khi chuyển production.
- **Permission list** nằm trong JWT payload (`permissions[]`), frontend đọc để ẩn/hiện UI (`utils/rbac.ts` + `hooks/useRBAC.ts`).
- **Logic task (frontend App.tsx):** Admin/Director xem tất cả, Manager xem phòng ban, Employee xem task được giao/tự tạo. Sửa: chỉ `createdBy` hoặc assignee. Xoá: chỉ `createdBy` hoặc Admin.
- Các luồng ownership cho task, note, contract, document/upload và resource liên quan đã được gia cố, có regression tests trong `backend/tests/ownership.test.ts`. Phạm vi kiểm tra không mặc nhiên bao phủ mọi endpoint: trước khi thêm/sửa route phải xác minh quyền ở backend theo resource, department và action; không dựa riêng vào frontend.


## 10. Coding conventions

- **Ngôn ngữ:** TypeScript cả FE và BE. FE strict mode bật; `noUnusedLocals`/`noUnusedParameters` tắt.
- **ES Modules:** cả FE và BE dùng `"type": "module"`. Backend import kèm đuôi `.js` (do Node16 module resolution + tsx), ví dụ `import { taskRoutes } from './routes/tasks.js'` dù file là `.ts`. GIỮ NGUYÊN convention `.js` này khi thêm import backend.
- **Route factory:** mỗi route file export `export function xxxRoutes(db: any) { const router = Router(); ...; return router; }`.
- **`db` typed là `any`** trong route hiện tại — nhiều chỗ dùng `any`. Không cần đổi toàn bộ, nhưng code mới nên type chặt hơn nếu khả thi.
- **ID:** dùng `randomUUID()` từ `crypto` cho khoá chính khi tạo mới ở backend.
- **Query:** dùng parameterized query (`db.run('... VALUES (?, ?)', [a, b])`) — GIỮ pattern này, KHÔNG nối chuỗi SQL.

## 11. API conventions

- Base path `/api/<resource>`. REST: `GET /` (list), `POST /` (create), `PUT /:id` (update), `DELETE /:id` (delete).
- Response JSON. Tạo mới thường trả `{ id }`, update/delete trả `{ success: true }`.
- Lỗi trả `res.status(<code>).json({ error: '<message>' })`. Validation lỗi: `400` với `{ error: 'Validation failed', details: [...] }` (xem `middleware/validate.ts`).
- Frontend gọi qua `services/api.ts`, tự gắn Bearer token.

## 12. Error handling conventions

- Route hiện dùng `try/catch` trả `res.status(500).json({ error: '...' })`. Message lỗi ngắn, tiếng Việt hoặc tiếng Anh tuỳ file.
- **Chưa có** structured logging — chỉ `console.log/error`. Chưa có React Error Boundary.
- Khi thêm code: giữ try/catch quanh thao tác DB/IO, trả status code phù hợp (400 client, 401/403 auth, 404 not found, 500 server).

## 13. Validation conventions

- Backend: `zod` qua `middleware/validate.ts` — `validate(schema)` parse `req.body`, trả 400 kèm `details`. Một số route cũ có thể chưa gắn validation; kiểm tra từng route trước khi thay đổi. `routes/tasks.ts` hiện validate create/update bằng schema. Endpoint mới nên định nghĩa schema + gắn `validate`.
- Frontend: validation form hiển thị trong UI (chưa có thư viện form chuẩn hoá — xác minh theo từng page).

## 14. UI/UX conventions

- TailwindCSS 4 utility-first. Icons: `lucide-react`. Animation: `motion`.
- Theme: Dark/Light/System. Đa ngôn ngữ vi/en qua `LanguageContext` — text người dùng nên đi qua i18n, không hardcode.
- Notifications: dùng hệ thống notification/toast + Socket.io realtime, KHÔNG dùng `alert()`.
- Kanban: `@hello-pangea/dnd`. Charts: `recharts`. Date: `flatpickr`.
- Sanitize HTML người dùng bằng `dompurify` trước khi render.
- Component mới: kiểm tra `components/` trước để tái sử dụng, tránh trùng lặp. Giữ responsive (mobile + desktop). Có loading/empty/error state.

## 15. Rules khi sửa code

- Chỉ sửa file cần thiết cho task; không refactor/mở rộng scope ngoài yêu cầu.
- KHÔNG đổi framework, database, ORM, cơ chế auth khi chưa được yêu cầu.
- KHÔNG cài package mới nếu chưa cần; nếu cần, DỪNG và hỏi trước.
- KHÔNG xoá code/component khi chưa chắc chắn không còn dùng.
- Tái sử dụng code hiện có, tuân thủ kiến trúc hiện tại (route factory, service layer, context).
- Giữ parameterized query; không nối chuỗi SQL.
- Backend import giữ đuôi `.js`.
- Sau khi sửa: chạy typecheck/build/test phù hợp (mục 4) trước khi báo hoàn thành.

## 16. Những file/thư mục KHÔNG được tự ý sửa
 
- Thư mục `data/`, `uploads/` — dữ liệu runtime, đã gitignore. Không commit, không sửa tay.
- `package-lock.json` — chỉ thay đổi qua npm, không sửa tay.
- `node_modules/` — không đụng.
- `phan_tich.MD` — tài liệu phân tích tham khảo; cập nhật chỉ khi được yêu cầu.
- File chứa secret thực (`.env`, `backend/.env`, `frontend/.env`) — đã gitignore, không đọc/echo giá trị secret, không commit.

## 17. Testing conventions

- Framework: `vitest` (backend). Config `backend/vitest.config.ts` — chỉ chạy `tests/**/*.test.ts`, environment `node`, pool `forks`.
- HTTP test: `supertest`.
- Backend có regression tests cho auth, RBAC/ownership/scope, reset password, AI, mail, upload, Socket.IO, stock/kho, rbacService, input validation và infrastructure. Tại lần xác minh 12/10/2026: **29 suites / 312 tests PASS** (`npm run test --workspace=backend`, ~70s; mock DB, riêng `stockReports.test.ts` dùng `node:sqlite`). Thêm test tương ứng cho từng thay đổi bảo mật.
- Frontend: có `vitest.config.ts` + `tests/warehouseFrontend.test.ts`, nhưng `vitest` chưa khai báo trong `frontend/package.json` — hiện chưa chạy được test FE qua npm (Chưa xác định là runner chính thức).
- Có file `test_api.js` ở root để test thủ công API.

## 18. Git conventions

- Branch chính: `main`. Commit message: quan sát lịch sử — dùng tiếng Việt hoặc tiếng Anh, mô tả ngắn thay đổi (VD "Chuyển cổng backend...", "Migrate sang MySQL 8..."). Ưu tiên format `<type>: <mô tả>` (feat/fix/chore) cho commit mới.
- Chỉ commit khi được yêu cầu rõ ràng. Không push khi chưa được yêu cầu.
- KHÔNG commit: secret (`.env`), `node_modules`, `dist`, `data/`, `uploads/`, file log/debug/tmp.
- Stage file cụ thể theo tên, không `git add .` mù.

## 19. Nguyên tắc bảo mật

- Production fail-fast nếu thiếu/để placeholder các cấu hình bắt buộc; secret và DB credentials phải cấp qua environment/secret manager. Không đưa API key vào biến `VITE_*`.
- Khi tạo endpoint, luôn kiểm tra authorization tại backend và quyền trên resource cụ thể (IDOR); giữ parameterized query.
- HTML email/user-controlled content phải sanitize bằng DOMPurify trước khi gán vào DOM; không tạo sink `innerHTML` mới nếu có thể render text.
- Upload dùng giới hạn dung lượng/số file, allowlist extension + kiểm tra magic bytes, xác thực user và quyền truy cập entity; không phục vụ file từ thư mục upload như static public.
- Export database phải che password, token, secret, API key và giá trị cấu hình nhạy cảm.
- Thêm dependency thì chạy `npm audit --workspaces`, kiểm tra tính tương thích và cập nhật lockfile bằng npm.
- Sau thay đổi bảo mật chạy backend tests, frontend build và audit. Kết quả commit `8515ee3` (06/10/2026): 102 tests PASS, frontend build PASS, audit 0 vulnerabilities; lần chạy lại gần nhất 12/10/2026: 29 suites / 312 tests PASS. Đây là snapshot, cần kiểm tra lại khi dependency hoặc code thay đổi.
- Nếu phát hiện secret trong repo: che bằng `****`, báo vị trí file, đề xuất chuyển sang env var; KHÔNG in secret đầy đủ, KHÔNG commit.

## 20. Những quyết định kiến trúc quan trọng

- **Monorepo npm workspaces** — FE + BE cùng repo, cài chung từ root.
- **Backend chạy bằng `tsx`** (không build ra JS) cho cả dev và production start — deploy = chạy TS trực tiếp.
- **Database: MySQL 8 (`mysql2`) duy nhất** — kết nối qua `DATABASE_URL`. Khi sửa schema, cập nhật trực tiếp tại `db_mysql.ts`.
- **Backend serve luôn frontend** — production, Express serve `frontend/dist` (SPA fallback). Uploads truy cập qua `/api/upload` với auth/ownership checks, không expose thư mục uploads bằng static middleware. Không có web server riêng cho FE ở production (Nginx đứng trước reverse-proxy).
- **Port:** backend 3500, frontend dev 5173 (proxy `/api` + `/socket.io` → 3500).
- **react-query** là nguồn server state duy nhất phía FE — mutation phải `invalidateQueries` để đồng bộ.
- **Realtime qua Socket.io** cho notification/meeting.
- **Hệ thống phòng ban (RBAC Phase 1):** department có `code`/`parentId`/`level`; menu và phạm vi dữ liệu theo từng phòng ban; chuẩn hoá `managementLevel` (v11/v12) ở backend lẫn frontend.
- **Kho vận (Warehouse/Stock):** module mới nhất — chứng từ nhập/xuất/điều chuyển/kiểm kê, `stock_moves` bất biến làm ledger, tồn kho là projection, serial/lô, combo, giữ hàng, min/max, đối soát MISA. Schema qua versioned migrations v13–v25.

---

> Tài liệu này được rà soát theo source code ngày 2026-10-12 (đồng bộ RBAC Phase 1 — hệ thống phòng ban và module Kho vận). Cập nhật khi kiến trúc/tech stack thay đổi. Chi tiết bảng DB, route, migration và remediation: xem [phan_tich.MD](phan_tich.MD).
