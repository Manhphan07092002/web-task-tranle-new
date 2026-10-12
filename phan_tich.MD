# 🔍 Phân Tích Toàn Diện Dự Án Tran Le Tasks

> **Ngày phân tích:** 12/10/2026 (cập nhật lần 6 — đồng bộ Hệ thống phòng ban / RBAC Phase 1 & module Kho vận)
> **Mục đích:** Lưu trữ kiến thức về cấu trúc, kiến trúc, điểm mạnh, vấn đề và hướng cải thiện của dự án — phục vụ tra cứu nhanh, không cần phân tích lại.  
> **Tham khảo thêm:** [CLAUDE.md](CLAUDE.md) — hướng dẫn coding conventions dành cho AI.

---

## 1. Tổng Quan Dự Án

**Tran Le Tasks** là nền tảng quản lý công việc, dự án & cộng tác nội bộ dành cho doanh nghiệp năng lượng tái tạo, được xây dựng theo kiến trúc **Monorepo** (frontend + backend trong cùng 1 repo). Hệ thống phục vụ Công ty Cổ phần Tư vấn xây dựng Điện Trần Lê (Tran Le Electricity - tranlecorp.com).

| Thuộc tính | Giá trị |
|---|---|
| **Kiến trúc** | Monorepo (npm workspaces) |
| **Frontend** | React 19 + Vite 6 + TailwindCSS 4 + TypeScript ~5.8 |
| **Backend** | Express 5 + TypeScript ~5.8 + tsx (runtime, KHÔNG build ra JS) |
| **Database duy nhất** | **MySQL 8** (`mysql2` ^3.11.5) — kết nối qua `DATABASE_URL` |
| **Realtime** | Socket.io 4 |
| **AI** | Google Gemini API (`@google/genai`) |
| **Email** | Nodemailer (SMTP) + IMAPFlow (IMAP) + Poste.io (self-hosted) |
| **Deployment** | Docker (3 services: App + MySQL 8 + Poste.io) + PM2 + Nginx |
| **Domain** | task.tranlecorp.com.vn / tasks.tranlecorp.com.vn |
| **Port Backend** | 3500 |
| **Port Frontend (dev)** | 5173 |

---

## 2. Cấu Trúc Thư Mục

```
web_tranle_new/
├── package.json                  # Root – npm workspaces (frontend, backend)
├── docker-compose.yml            # 3 services: App + MySQL 8 + Poste.io mail
├── Dockerfile                    # Multi-stage build (frontend build → backend serve)
├── ecosystem.config.cjs          # PM2 production config
├── CLAUDE.md                     # Coding conventions cho AI
├── .env                          # Biến môi trường (gitignore)
├── .env.production.example       # Mẫu biến môi trường
├── test_api.js                   # Script test API thủ công
│
├── frontend/                     # React 19 + Vite + TailwindCSS 4
│   ├── App.tsx                   # Router chính + business logic (task permission, modal, notification)
│   ├── main.tsx                  # Entry point (React + Providers)
│   ├── types.ts                  # 20+ TypeScript interfaces/enums
│   ├── index.html                # HTML shell
│   ├── index.css                 # Global styles
│   ├── constants.ts              # App constants
│   ├── vite.config.ts            # Vite config + proxy /api, /socket.io → backend
│   ├── vitest.config.ts          # Config test FE (vitest chưa khai báo dependencies)
│   ├── stream-stub.js            # Polyfill cho stream module
│   ├── components/               # 18+ shared components
│   │   ├── AIAssistant.tsx          # Gemini AI chatbot
│   │   ├── MeetingRoom.tsx          # Video meeting WebRTC
│   │   ├── TaskModal.tsx            # Task create/edit form
│   │   ├── InlineDocumentManager.tsx # Document upload widget
│   │   ├── UserModal.tsx            # User create/edit
│   │   ├── NoteModal.tsx            # Note editor
│   │   ├── LoginView.tsx            # Login page
│   │   ├── UserProfilePopup.tsx     # Profile hover card
│   │   ├── TaskSuggestionModal.tsx  # AI task suggestions
│   │   ├── StatCard.tsx             # Dashboard stat cards
│   │   ├── MeetingModal.tsx         # Create meeting modal
│   │   ├── UI.tsx                   # Shared UI primitives
│   │   ├── TaskListItem.tsx         # Task row component
│   │   ├── InviteModal.tsx          # Meeting invite modal
│   │   ├── Pagination.tsx           # Reusable pagination
│   │   ├── ConfirmDialog.tsx        # Confirm delete dialog
│   │   ├── ErrorBoundary.tsx        # Error boundary
│   │   ├── AdminFeedback.tsx        # Feedback admin
│   │   ├── layout/                  # Sidebar, TopHeader
│   │   │   └── menus/               # departmentMenus.ts, resolveDepartment.ts, menuTypes.ts, commonMenus.ts
│   │   └── meeting/                 # Meeting sub-components (PreJoinLobby, ControlsBar, Sidebars, SettingsModal...)
│   ├── pages/                    # 20+ page modules
│   │   ├── Dashboard/               # KPI, biểu đồ, task hôm nay
│   │   ├── Tasks/                   # Kanban, List View, Calendar View
│   │   ├── Calendar/                # Lịch biểu (tasks + contracts)
│   │   ├── Mail/                    # Webmail IMAP/SMTP
│   │   ├── Notes/                   # Ghi chú cá nhân + reminder
│   │   ├── Team/                    # Danh bạ nhân sự
│   │   ├── Meetings/                # Phòng họp online
│   │   ├── Reports/                 # Báo cáo công việc tuần
│   │   ├── Contracts/               # Quản lý hợp đồng đầu vào/ra
│   │   ├── Revenue/                 # Báo cáo doanh thu
│   │   ├── Products/                # Kho hàng & sản phẩm
│   │   ├── Projects/                # Dự án đấu thầu
│   │   ├── ProjectReports/          # Báo cáo tiến độ dự án
│   │   ├── DocumentAdmin/           # Quản lý tài liệu
│   │   ├── Admin/                   # Quản trị hệ thống, roles, Database JSON Backup/Restore
│   │   ├── Settings/                # Theme, ngôn ngữ, preferences
│   │   ├── Notifications/           # Trung tâm thông báo
│   │   ├── ForgotPassword/          # Quên mật khẩu
│   │   ├── ResetPassword/           # Đặt lại mật khẩu
│   │   ├── Warehouse/               # 19 trang nghiệp vụ kho (Overview, Inventory, StockDocs, Moves,
│   │   │                            #   Locations, MinMax, Serial, Reservations, Count, Reports, SlowStock,
│   │   │                            #   Bundle, Alerts, Approvals, Exceptions, InTransit, Misa, Catalog, MyWork)
│   │   └── DepartmentStubPage.tsx   # Placeholder "Đang phát triển" cho phòng ban chưa có trang thật
│   ├── contexts/                 # 4 React Contexts
│   │   ├── AuthContext.tsx          # JWT auth, login/logout
│   │   ├── DataContext.tsx          # Server state (react-query)
│   │   ├── LanguageContext.tsx      # i18n vi/en
│   │   └── NotificationContext.tsx  # Realtime + local notifications
│   ├── services/                 # 19 API service files
│   │   ├── api.ts                   # Base fetch wrapper + auth interceptor
│   │   ├── taskService.ts / contractService.ts / contractLinkService.ts / projectService.ts
│   │   ├── reportService.ts / revenueService.ts / noteService.ts / userService.ts
│   │   ├── meetingService.ts / productService.ts / documentService.ts / departmentService.ts
│   │   ├── roleService.ts / clientService.ts / aiService.ts
│   │   ├── stockService.ts / reservationService.ts / locationService.ts   # Kho vận
│   ├── hooks/                    # 4 custom hooks
│   │   ├── useRBAC.ts               # Quyền/scope theo user (dùng trong UI)
│   │   ├── useDeviceSelection.ts    # Camera/mic selection
│   │   ├── useVirtualBackground.ts  # MediaPipe background blur
│   │   └── useMailConnectionCooldown.ts # Cooldown kết nối mail
│   └── utils/
│       ├── rbac.ts                  # Frontend RBAC mirror
│       ├── dateUtils.ts             # Date formatting helpers
│       └── exportXlsx.ts            # Export Excel (exceljs)
│
├── backend/                      # Express 5 + TypeScript (tsx runtime)
│   ├── server.ts                 # Entry point – Express app setup (CSP, rate limit, mount route, scheduler)
│   ├── db_mysql.ts               # MySQL 8 adapter + schema DDL (~50 bảng) + seeds + normalizeSql + versioned migrations v1–v25
│   ├── socket.ts                 # Socket.io init + room join
│   ├── mailer.ts                 # Nodemailer SMTP transporter
│   ├── tranle_knowledge.ts       # AI knowledge base cho Gemini
│   ├── middleware/
│   │   ├── auth.ts                  # requireAuth + requireAdmin (JWT)
│   │   ├── rbac.ts                  # requirePermission/scope, applyTaskScopeFilter, ownership, approval
│   │   └── validate.ts              # Zod validation middleware
│   ├── services/
│   │   └── rbacService.ts           # Scope department/warehouse + ma trận duyệt theo management level
│   ├── routes/                   # 25 API route modules
│   │   ├── contracts.ts             # Hợp đồng CRUD + workflow
│   │   ├── stock.ts                 # Kho vận: chứng từ, moves, tồn kho, serial, combo, kiểm kê, MISA (1.300+ dòng)
│   │   ├── stockReports.ts          # Báo cáo kho (mount bên trong stock.ts)
│   │   ├── mail.ts                  # Webmail IMAP/SMTP
│   │   ├── ai.ts                    # Gemini AI assistant
│   │   ├── admin.ts                 # User/system management + MySQL JSON export/import
│   │   ├── products.ts / auth.ts / documents.ts / projects.ts / revenue.ts
│   │   ├── tasks.ts / reports.ts / contractLinks.ts / users.ts / meetings.ts
│   │   ├── roles.ts / departments.ts / events.ts / upload.ts / activity.ts
│   │   ├── notes.ts / notifications.ts / clients.ts / warehouses.ts
│   ├── schedulers/               # 6 cron jobs
│   │   ├── fridayReminder.ts        # Nhắc báo cáo thứ 6
│   │   ├── dailyTaskReminder.ts     # Nhắc task hàng ngày
│   │   ├── noteReminder.ts          # Nhắc ghi chú
│   │   ├── mailScheduler.ts         # Gửi email lên lịch
│   │   ├── revenueAutoSubmit.ts     # Tự tạo báo cáo doanh thu
│   │   └── reservationExpiry.ts     # Hết hạn giữ hàng (Warehouse)
│   ├── migrations/               # SQL migration 004–006 (performance indexes, legacy columns, department system)
│   ├── utils/
│   │   ├── cryptoUtils.ts           # Mã hoá mail password
│   │   ├── notify.ts                # Push notification helper
│   │   ├── dbMigrations.ts          # runVersionedMigration + withMigrationLock
│   │   ├── dbTransactionGate.ts     # Transaction MySQL tuần tự hoá (AsyncLocalStorage)
│   │   ├── dbBootstrap.ts           # Khởi tạo database một lần
│   │   └── mail helpers             # TLS / IMAP connection helpers
│   └── tests/                    # 29 suite Vitest (auth, RBAC/scope/ownership, stock, mail, AI, upload, ...)
│
├── scripts/                      # Utility scripts (patch/fix)
├── mail-server-config/           # Poste.io mail server data
├── uploads/                      # Uploaded files storage
└── tmp/                          # Temporary files
```

---

## 3. Kiến Trúc Hệ Thống

### 3.1 Luồng Request

```
Browser
  │
  ├─ Dev mode: Vite Dev Server (:5173) ──proxy──▶ Express (:3500)
  │
  └─ Production: Nginx → Express (:3500)
                            ├── serves /api/* routes
                            ├── uploads truy cập qua /api/upload (auth + ownership checks, KHÔNG static public)
                            ├── serves frontend/dist/* (SPA)
                            └── Socket.io WebSocket
```

### 3.2 MySQL Database Architecture (`backend/db_mysql.ts`)

```
backend/server.ts ──▶ initDbMysql() ──▶ MySQL 8 (via DATABASE_URL)
                          │
  ┌───────────────────────┴───────────────────────┐
  │ db_mysql.ts (~1.850 dòng)                     │
  │                                               │
  │ 1. normalizeSql()                             │
  │    - START TRANSACTION                        │
  │    - INSERT IGNORE INTO                       │
  │    - ON DUPLICATE KEY UPDATE                  │
  │    - `to`, `from`, `key`, `value` (backticks) │
  │    - information_schema.tables                │
  │                                               │
  │ 2. wrapRow() (Proxy)                          │
  │    - BigInt/Decimal → Number                  │
  │    - Case-insensitive property access         │
  │                                               │
  │ 3. MysqlDb Class (Drop-in db interface)       │
  │    - get(sql, params)                         │
  │    - all(sql, params)                         │
  │    - run(sql, params) → { changes }           │
  │    - exec(sql) (Multi-statement DDL)          │
  │    - Auto-reconnect on connection lost        │
  │                                               │
  │ 4. DDL & Schema Setup (50 bảng)               │
  │    + versioned migrations v1–v25              │
  │                                               │
  │ 5. seedInitialData() (Chạy khi DB mới)        │
  └───────────────────────────────────────────────┘
```

---

## 4. Database Schema Chi Tiết (MySQL 8)

### 4.1 Danh sách bảng (51 bảng cố định)

> 50 bảng từ DDL trong `db_mysql.ts` + bảng `_migrations` (theo dõi versioned migrations). Ngoài ra `positions`/`user_positions` được tạo bởi migration 006 rồi bị **drop nếu rỗng** bởi versioned migration v14 — không phải bảng cố định.

| Bảng | Cột chính | Mô tả |
|---|---|---|
| `users` | id (VARCHAR), name (TEXT), email (VARCHAR), password (TEXT), role, department, managementLevel (INT), primaryDepartmentId, position, avatar, phone, dob, hometown, bio, cccd, gender, mailPassword, failedLogins, lockedUntil, isLocked (TINYINT), preferences (TEXT) | Nhân sự |
| `tasks` | id (VARCHAR), title, description, startDate, dueDate, estimatedEndAt, priority, status, createdBy, department, recurrence, contractId, projectId | Công việc |
| `task_assignees` | taskId, userId (PK composite) | Phân công |
| `task_tags` | taskId, tag (PK composite) | Nhãn |
| `task_subtasks` | id, taskId, title, isCompleted (TINYINT), sortOrder | Subtask |
| `task_comments` | id, taskId, userId, content, createdAt | Bình luận |
| `contracts` | id, contractNumber, clientName, contractName, preTaxValue (DOUBLE), postTaxValue (DOUBLE), vatRate (DOUBLE), paidAmount (DOUBLE), status, contractType, supplierName, products (TEXT JSON), attachments (TEXT JSON), documentChecklist, signedDate, startDate, endDate, warrantyMonths, payments, docSentDate, docReceivedDate, docAccountantDate, docReceiver, docAccountantUserId, docAccountantStatus, approvalFeedback, projectId, isDeleted (TINYINT), ... | Hợp đồng |
| `contract_links` | id, outputContractId, inputContractId, linkType, description, createdBy, createdAt | Liên kết HĐ |
| `projects` | id, projectCode, name, clientName, department, managerId, status, budget (DOUBLE), biddingCode, biddingDate, procurementMethod, investor, biddingPrice (DOUBLE), winningPrice (DOUBLE), priority, phase, isDeleted (TINYINT) | Dự án |
| `project_milestones` | id, projectId, title, dueDate, completedAt, status, sortOrder | Mốc dự án |
| `project_reports` | id, projectId, title, content, progress, authorId, status | BC dự án |
| `products` | id, name, unit, origin, defaultPrice (DOUBLE), category, importQuantity, remainingQuantity, importPrice (DOUBLE), salePrice (DOUBLE), importCode, invoiceDate | Kho hàng |
| `revenue_reports` | id, title, reportType, periodStart, periodEnd, totalPreTax (DOUBLE), totalDelivered (DOUBLE), totalCumulative (DOUBLE), authorId, department, status, managerFeedback, directorFeedback, generationMode, isDeleted (TINYINT) | Doanh thu |
| `reports` | id, title, content, authorId, department, status, directorFeedback, managerFeedback, isDeleted (TINYINT) | BC tuần |
| `meetings` | id, title, description, hostId, startTime, endTime, meetingLink, status, participants | Họp |
| `meeting_participants` | meetingId, userId (PK composite) | Người tham gia |
| `signals` | id, meetingId, from, to, type, data, timestamp (BIGINT) | WebRTC |
| `notes` | id, title, content, color, createdAt, reminderAt, userId | Ghi chú |
| `notifications` | id, userId, type, title, message, relatedId, isRead (TINYINT), createdAt | Thông báo |
| `roles` | id, name (VARCHAR UNIQUE), description, color, permissions (TEXT JSON), managementLevel (INT), isSystem (TINYINT) | Vai trò |
| `departments` | id, name (VARCHAR UNIQUE), description, color, managerId, code (VARCHAR UNIQUE), parentId, level (1=BGD, 2=Phòng ban, 3=Phòng ban con), isActive (TINYINT) | Phòng ban (hệ thống phân cấp) |
| `clients` | id, name (VARCHAR UNIQUE), region, createdAt | Khách hàng |
| `events` | id, title, date, endDate, type, color, description, isRecurringYearly (TINYINT) | Sự kiện lịch |
| `activity_logs` | id, userId, action, entityId, entityType, metadata, createdAt | Nhật ký |
| `scheduled_emails` | id, userId, to, cc, bcc, subject, body, attachments, scheduledAt, status | Email lên lịch |
| `mail_tracking` | id, userId, messageId, subject, to, opens, lastOpen | Theo dõi mail |
| `mail_quotas` | email (VARCHAR PK), quota | Quota mail |
| `password_reset_requests` | id, userId, email, status, emailStatus, emailSentAt | Yêu cầu reset |
| `password_reset_tokens` | id, userId, email, token, tokenHash, expiresAt, usedAt | `token` và `tokenHash` đều chứa hash; không lưu token reset thô |
| `system_config` | key (VARCHAR PK), value | Cấu hình hệ thống |
| `db_history` | id, action, filename, performedBy, note, createdAt | Lịch sử DB |
| `documents` | id, name, url, size, type, category, linkedId, createdBy, isDeleted (TINYINT) | Tài liệu |
| `_migrations` | version (INT PK), name, appliedAt | Migration tracking |

#### 4.1.1 Phân quyền & Kho vận (thêm từ RBAC Phase 1 và module Warehouse)

| Bảng | Cột chính | Mô tả |
|---|---|---|
| `management_scopes` | id, userId, departmentId, scopeType (FULL...), createdAt | Phạm vi quản lý phòng ban của user |
| `user_warehouse_scopes` | id, userId, warehouseId, scopeType, createdAt | Phạm vi quản lý kho của user |
| `warehouses` | id, code (UNIQUE), name, region, address, isActive (TINYINT) | Kho |
| `stock_locations` | id, warehouseId, parentId, code, name, type, purpose | Vị trí / khu vực trong kho |
| `stock_documents` | id, docNo, type (IN/OUT/TRANSFER/COUNT...), warehouseId, docDate, status, createdBy, ... | Chứng từ nhập/xuất/điều chuyển/kiểm kê |
| `stock_document_lines` | id, documentId, productId, quantity, price, ... | Dòng chứng từ |
| `stock_moves` | id, productId, documentLineId, fromLocationId, toLocationId, quantityChange, ... | **Ledger bất biến** — nguồn sự thật của tồn kho |
| `stock_balances` | productId, warehouseId, locationId, quantity, ... | Projection tồn kho (đọc nhanh) |
| `product_warehouse_policies` | productId, warehouseId, minQuantity, maxQuantity | Chính sách min/max theo kho |
| `reservations` | id, productId, warehouseId, quantity, requestedBy, status, expiresAt | Giữ hàng |
| `stock_serials` | id, productId, serialNumber, status, locationId, ... | Serial/Imei |
| `product_bundles` + `product_bundle_items` | id, code, name, includes (productId, quantity) | Combo/Bộ sản phẩm |
| `stock_counts` + `stock_count_lines` | id, warehouseId, countedBy, status + productId, countedQty, ... | Kiểm kê kho |
| `misa_mappings` + `misa_sync_logs` | id, code, mapping, ... | Đối soát/sync MISA |
| `uploaded_files` | id, filename, mime, size, sha256, ownerId, linkedId, ... | Metadata file upload |

### 4.2 Seed Data Mặc Định

- **4 Users (chỉ seed ở non-production):** Admin (`admin@tranlecorp.com.vn`, level 99), Nguyễn Văn Đạt (Manager, `vandat@tranlecorp.com.vn`, level 20), Phan Xuân Mạnh (Employee, `xuanmanh@tranlecorp.com.vn`, level 10), Nguyễn Văn Duy (Director, `vanduy@tranlecorp.com.vn`, level 40). **Production chỉ tạo Admin** (`INITIAL_USERS.slice(0, 1)`).
- **5 Roles (+ managementLevel):** Admin (16 perms, 99), Director (7, 40), Deputy Director (6, 30), Manager (9, 20), Employee (4, 10).
- **Departments:** 14 phòng ban legacy trong DDL seed (Ban Lãnh Đạo, Khối EPC & Thi Công, O&M/SAJ Center, Kinh doanh, Thiết kế, Kế toán, HCNS, + aliases Product/Board/Marketing/Sales/IT/HR/Finance) và **9 phòng ban chuẩn có `code`/`parentId`/`level`** từ migration 006: **BGD** (Ban Giám Đốc, level 1), **KT** (Kế Toán), **HCNS** (Hành Chính - Nhân Sự), **KD** (Kinh Doanh), **DA** (Dự Án), **KTBH** (Kỹ Thuật - Bảo Hành), **MKT** (Marketing), **KHO** (Kho Vận), **MH** (Mua Hàng).
- **15 Products:** catalog tấm pin (AIKO, Jinko, Canadian Solar, JA Solar, LONGi), biến tần (SAJ, Huawei), pin lưu trữ (SAJ, Dyness), phụ kiện (cáp DC, MC4, thanh ray).
- **Projects mẫu:** Cocotex 4,5 MWp, Nam Lý 3 MWp, ... (kèm milestones).
- **34 Clients:** VNPT các tỉnh/thành.
- **6 Events:** Các ngày lễ Việt Nam.
- **1 Task mẫu:** "Design System Review" · **1 Note mẫu:** "Brainstorming Ideas"
- **Mật khẩu mặc định:** `TranLe@dmin2026!` (env `ADMIN_DEFAULT_PASSWORD`; production bắt buộc đặt qua env, ≥ 16 ký tự).

---

## 5. Hệ Thống Phân Quyền RBAC

### 5.1 Ma trận quyền (16 permissions, 5 role)

| Permission | Admin | Director | Phó GĐ | Manager | Employee | Mô tả |
|---|:---:|:---:|:---:|:---:|:---:|---|
| `admin_panel` | ✅ | | | | | Truy cập trang Admin |
| `manage_users` | ✅ | | | | | CRUD users |
| `view_all_tasks` | ✅ | ✅ | | | | Xem mọi task toàn công ty |
| `manage_dept_tasks` | ✅ | | ✅ | ✅ | | Quản lý task phòng ban |
| `view_own_tasks` | ✅ | | | | ✅ | Xem task của mình |
| `view_all_reports` | ✅ | ✅ | ✅ | | | Xem mọi báo cáo |
| `approve_dept_reports` | ✅ | | | ✅ | | Duyệt BC phòng ban |
| `director_feedback` | ✅ | ✅ | ✅ | | | Phản hồi cấp Giám đốc |
| `create_report` | ✅ | | | ✅ | ✅ | Tạo báo cáo tuần |
| `manage_meetings` | ✅ | ✅ | | ✅ | | Tạo/quản lý cuộc họp |
| `join_meetings` | ✅ | ✅ | ✅ | ✅ | ✅ | Tham gia cuộc họp |
| `create_revenue_report` | ✅ | | | ✅ | ✅ | Tạo BC doanh thu |
| `approve_dept_revenue` | ✅ | | ✅ | ✅ | | Duyệt doanh thu phòng ban |
| `approve_all_revenue` | ✅ | ✅ | | | | Duyệt mọi doanh thu |
| `manage_warehouse` | ✅ | ✅ | | ✅ | | Quản lý kho hàng |
| `view_dept_users` | ✅ | | | ✅ | | Xem thành viên phòng ban |

> **Management Level:** Admin = 99, Director = 40, Deputy Director = 30, Manager = 20, Employee = 10. Level quyết định phạm vi dữ liệu (`rbacService.ts`) và cấp duyệt báo cáo/doanh thu.
> **Phạm vi dữ liệu (scope):** ngoài permission, `services/rbacService.ts` + `middleware/rbac.ts` giới hạn dữ liệu theo **phòng ban** (`users.department` / `management_scopes`) và **kho** (`user_warehouse_scopes`). Frontend mirror ở `utils/rbac.ts` + `hooks/useRBAC.ts`; menu theo từng phòng ban ở `components/layout/menus/departmentMenus.ts` (giới hạn bằng `minLevel`).
> **Lệch thiết kế (D4):** quyết định kiến trúc yêu cầu Admin KHÔNG truy cập dữ liệu kinh doanh, nhưng code thực tế vẫn cấp Admin `admin_panel` + `view_all_tasks` (backend `applyTaskScopeFilter` và App.tsx cho Admin xem tất cả, Admin xoá được task) — cần chốt hướng xử lý trước production.

---

## 6. API Endpoints

### 6.1 Public (không cần token)
```
POST   /api/auth/login              # Đăng nhập, trả JWT
POST   /api/auth/forgot-password    # Yêu cầu reset password
POST   /api/auth/reset-password     # Reset bằng token
GET    /health                      # Health check
```

### 6.2 Protected (cần Bearer token)
```
POST   /api/auth/register           # Đăng ký (admin tạo)
POST   /api/auth/change-password    # Đổi mật khẩu

GET/POST/PUT/DELETE  /api/tasks
GET/POST/PUT/DELETE  /api/notes?userId=...
GET/POST/PUT/DELETE  /api/users
GET/POST/PUT/DELETE  /api/reports
GET/POST/PUT/DELETE  /api/contracts
GET/POST/PUT/DELETE  /api/revenue-reports
GET/POST/PUT/DELETE  /api/projects
GET/POST/PUT/DELETE  /api/products
GET/POST/PUT/DELETE  /api/documents
GET/POST/PUT/DELETE  /api/meetings
GET/POST             /api/contract-links
GET                  /api/roles
GET                  /api/departments
GET                  /api/clients
GET                  /api/notifications
GET                  /api/activity
GET/POST/PUT/DELETE  /api/events
POST                 /api/upload
POST                 /api/ai/chat, /api/ai/suggest-tasks, ...

# Kho vận (Warehouse/Stock)
GET/POST/PUT/DELETE  /api/warehouses
GET/POST/PUT/DELETE  /api/stock/*          # documents (IN/OUT/TRANSFER/COUNT), moves, balances, locations,
                                           # serials, bundles, counts, reservations, policies, slow-stock,
                                           # in-transit, alerts, approvals, misa...
GET/POST             /api/stock-reports    # Báo cáo kho (mount bên trong /api/stock)
GET/POST/PUT/DELETE  /api/mail/*           # Webmail IMAP/SMTP: mailboxes, messages, send/draft, tracking, cooldown
```

### 6.3 Admin Only (cần role Admin)
```
GET/POST/PUT/DELETE  /api/admin/users
GET                  /api/admin/database/tables
GET                  /api/admin/database/table/:table
DELETE               /api/admin/database/table/:table/row/:id
GET                  /api/admin/database/export  # Export toàn bộ DB ra file JSON
POST                 /api/admin/database/import  # Import DB từ file JSON
GET/PUT              /api/admin/system-config
```

---

## 7. Tech Stack Dependencies

### 7.1 Frontend (`frontend/package.json`)

| Library | Version | Vai trò |
|---|---|---|
| `react` + `react-dom` | ^19.2.0 | UI Framework |
| `react-router-dom` | ^7.14.0 | Client-side routing |
| `vite` | ^6.2.0 | Build tool & dev server |
| `tailwindcss` + `@tailwindcss/vite` | ^4.2.2 | Utility-first CSS |
| `@tanstack/react-query` | ^5.64.1 | Server state management |
| `socket.io-client` | ^4.8.4 | WebSocket client |
| `recharts` | ^3.4.1 | Charts & biểu đồ |
| `motion` | ^12.38.0 | Animations |
| `lucide-react` | ^0.553.0 | Icon library |
| `@hello-pangea/dnd` | ^18.0.1 | Drag & Drop (Kanban) |
| `exceljs` | ^4.4.0 | Export Excel (thay các gói SheetJS có advisory) |
| `dompurify` | ^3.4.16 | Sanitize HTML khi soạn/hiển thị email |
| `flatpickr` + `react-flatpickr` | ^4.6.13 | Date picker |
| `react-to-print` | ^3.3.0 | Print reports |
| `@mediapipe/*` | — | Camera/segmentation (meetings) |
| `typescript` | ~5.8.2 | TypeScript compiler |

### 7.2 Backend (`backend/package.json`)

| Library | Version | Vai trò |
|---|---|---|
| `express` | ^5.2.1 | HTTP framework |
| `helmet` | ^8.3.0 | Security headers / CSP |
| **`mysql2`** | **^3.11.5** | **MySQL 8 driver duy nhất** |
| `jsonwebtoken` | ^9.0.3 | JWT authentication |
| `bcryptjs` | ^2.4.3 | Password hashing |
| `socket.io` | ^4.8.4 | WebSocket server |
| `nodemailer` | ^10.0.15 | SMTP email sending |
| `imapflow` | ^2.2.6 | IMAP email reading |
| `mailparser` | ^3.9.36 | Email parsing |
| `multer` | ^2.4.0 | File upload |
| `file-type` | ^21.3.4 | Kiểm tra chữ ký nội dung file upload |
| `zod` | ^4.3.6 | Input validation |
| `express-rate-limit` | ^8.7.1 | Rate limiting |
| `@google/genai` | ^1.48.0 | Gemini AI (backend) |
| `tsx` | ^4.21.0 | TypeScript execution (KHÔNG build) |
| `vitest` | ^4.1.5 | Testing framework |
| `supertest` | ^7.2.2 | HTTP testing |

---

## 8. Cấu Hình Quan Trọng

### 8.1 Docker Compose (3 services)

```yaml
services:
  app:         # TranLe Tasks (Express + frontend/dist)
    ports: 3500, 5173→3500
    depends_on: mysql (healthy)
    env: DATABASE_URL=mysql://tranle:***@mysql:3306/Tranle_task_new

  mysql:       # MySQL 8.0
    ports: 3306
    charset: utf8mb4_unicode_ci
    volumes: ./data/mysql:/var/lib/mysql
    healthcheck: mysqladmin ping (10s interval, 30s start_period)

  mailserver:  # Poste.io (mail.tranlecorp.com.vn)
    ports: 25, 80→8080, 143, 465, 587, 993, 995
```

### 8.2 Environment Variables

Tên database mặc định đã chuyển sang `Tranle_task_new`. Khi chạy môi trường hiện có, đặt cả `MYSQL_DATABASE=Tranle_task_new` và database path trong `DATABASE_URL` thành `/Tranle_task_new`. Không xóa volume `data/mysql`: nếu volume MySQL đã được khởi tạo, cần tạo database mới và cấp quyền cho `MYSQL_USER` trước khi khởi động app; database `tranletask` cũ được giữ nguyên.

```bash
# Backend
NODE_ENV=production
PORT=3500
DATABASE_URL=mysql://tranle:password@localhost:3306/Tranle_task_new  # Bắt buộc MySQL
JWT_SECRET=<random 32+ chars>
MAIL_ENCRYPTION_KEY=<32 bytes>
SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / SMTP_FROM
ADMIN_DEFAULT_PASSWORD=

# Frontend (build-time; không đặt API key/secret ở biến VITE_*)
VITE_API_URL=http://127.0.0.1:3500
VITE_PORT=5173
```

---

## 9. Lệnh Phát Triển Nhanh

```bash
# Cài đặt
npm install                    # Install tất cả (root + frontend + backend)

# Dev (cần MySQL running + DATABASE_URL trong .env)
npm run dev

# Build frontend
npm run build

# Start production
npm run start:prod             # hoặc pm2 start ecosystem.config.cjs

# Docker (app + mysql + mailserver)
docker-compose up -d --build

# Test
cd backend && npm test
```

---

## 10. Changelog Dọn Dẹp SQLite & PostgreSQL (31/08/2026)

| Đã thực hiện | Chi tiết |
|---|---|
| 🗑️ **Xoá database.sqlite** | Xoá file SQLite vật lý khỏi `backend/` |
| 🗑️ **Xoá SQLite/PG dependencies** | Gỡ bỏ `sqlite`, `sqlite3`, `@types/sqlite3`, `pg`, `@types/pg` khỏi `backend/package.json` |
| 🗑️ **Xoá SQLite build tools trong Dockerfile** | Gỡ bỏ `python3`, `make`, `g++` và `ENV DB_PATH` khỏi `Dockerfile` |
| 🗑️ **Xoá scripts thừa** | Gỡ bỏ `scripts/cleanup-pending.ts` |
| 🔄 **server.ts** | Xoá toàn bộ import `db.ts`, `db_pg.ts`, chỉ giữ duy nhất `initDbMysql()` |
| 🔄 **Database Backup / Restore** | Cập nhật `/api/admin/database/export` và `/import` sang định dạng JSON table-by-table |
| 🔄 **Frontend Admin UI** | `DatabaseManagement.tsx` và `SystemConfig.tsx` cập nhật sang MySQL 8 & JSON backup |
| 🔄 **Cấu hình .env** | Loại bỏ hoàn toàn các option SQLite / PostgreSQL cũ |
| 🔒 **Bảo mật JWT_SECRET** | Fail-fast trong production (dừng nếu thiếu), tự sinh 32-byte ngẫu nhiên trong dev, xoá chuỗi secret fallback cứng |
| 🔒 **Bảo mật Docker & Compose** | Xoá toàn bộ mật khẩu DB và secret hardcode khỏi `Dockerfile` và `docker-compose.yml`, chuyển sang đọc từ `.env` |
| 🔒 **Bảo mật Healthcheck** | Sử dụng biến môi trường `$MYSQL_ROOT_PASSWORD` trong CMD-SHELL thay vì in rõ root password |
| ⚡ **Tối ưu Bundle Frontend** | Gỡ bỏ `@google/genai` thừa ở frontend (giảm ~57% kích thước file index chính từ 3.38MB xuống 1.45MB, thời gian build nhanh gấp 2 lần: 31.5s ➔ 14.3s) |
| ⚡ **Code-splitting Chunks** | Cấu hình `manualChunks` tách `vendor-react`, `vendor-query`, `vendor-charts`, `vendor-ui`, `vendor-excel` |

---

> **Lưu ý:** Dự án hiện tại đã thuần **100% MySQL 8**. Mọi thao tác truy vấn và cấu hình database chỉ cần tập trung vào `backend/db_mysql.ts` và `DATABASE_URL`.

---

## 11. Changelog Remediation Bảo Mật (06/10/2026)

Các mục dưới đây đã được triển khai trong commit `8515ee3` trên `main`:

| Hạng mục | Cập nhật đã triển khai |
|---|---|
| Transaction MySQL | Tuần tự hóa truy vấn trên connection dùng chung; transaction gắn với request context, ngăn request khác xen truy vấn trong transaction; có test commit/rollback/failure. |
| Authentication | Phản hồi đăng nhập sai/không tồn tại/tài khoản bị khóa thống nhất; dùng bcrypt equalizer cho email không tồn tại; bỏ tự khóa tài khoản do số lần đăng nhập sai. Giới hạn đăng nhập theo IP và khóa thủ công của Admin vẫn còn. |
| Reset password | Phản hồi forgot-password không tiết lộ email tồn tại; reset token được hash, có giới hạn tốc độ và cập nhật password/token trong transaction. |
| XSS email | HTML trong compose được sanitize trước khi đưa vào DOM/state; nội dung email đọc cũng dùng DOMPurify. |
| Database export | Che các cột password, token, secret/API key và giá trị cấu hình bí mật trong API xem bảng và export JSON. |
| Request limits | JSON tối đa 5 MB; URL-encoded tối đa 64 KB, tối đa 100 parameters. Upload multipart có giới hạn kích thước/số file và kiểm tra nội dung file. |
| Dependency advisories | Cập nhật các dependency runtime; thay `xlsx`/`xlsx-js-style` bằng ExcelJS; áp overrides cho `uuid` và `shell-quote`. |
| Security controls khác | Production kiểm tra secret/origin bắt buộc; Helmet/CSP và CORS allowlist; authorization/ownership, validation, socket/mail/upload được gia cố và có test hồi quy. |

**Xác minh tại thời điểm cập nhật:** `npm run test --workspace=backend` — 15 suites / 102 tests PASS; `npm run build --workspace=frontend` PASS; `npm audit --workspaces` — 0 vulnerabilities; `git diff --check` PASS. Build có cảnh báo kích thước một số JS chunks, không ảnh hưởng kết quả build.

Đây là kết quả kiểm tra trên code tại commit nêu trên, không thay thế việc rà soát lại khi thêm endpoint, dependency hoặc thay đổi cấu hình/deployment.

---

## 12. Changelog Hệ thống Phòng ban & RBAC Phase 1 (12/10/2026)

| Hạng mục | Nội dung |
|---|---|
| Phân cấp phòng ban | Migration `006_department_system.sql` thêm `code`, `parentId`, `level` (1=BGD, 2=Phòng ban), `isActive` vào `departments`; seed **9 phòng ban chuẩn** có code: BGD, KT, HCNS, KD, DA, KTBH, MKT, KHO, MH (giữ 14 phòng ban legacy của DDL seed). |
| Chuẩn hoá level | `users.managementLevel` + `roles.managementLevel` (Admin 99 / Director 40 / Deputy Director 30 / Manager 20 / Employee 10) — versioned migrations v9–v12, đồng bộ backend lẫn frontend. |
| Role mới | Thêm role **Deputy Director** (6 perms, level 30) → tổng **5 role hệ thống**. |
| Scope dữ liệu | `management_scopes` (phòng ban) + `services/rbacService.ts` (tính scope + ma trận duyệt theo level) + `middleware/rbac.ts` (`applyTaskScopeFilter`, ownership, approval) — giới hạn task/report/revenue/contract theo department. |
| Menu theo phòng ban | `components/layout/menus/departmentMenus.ts` + `resolveDepartment.ts` (9 phòng ban có menu riêng, giới hạn bằng `minLevel`); chỉ **Warehouse** có trang thật, 8 phòng ban khác dùng placeholder `DepartmentStubPage`. |

## 13. Changelog Module Kho vận (Warehouse/Stock) (12/10/2026)

| Hạng mục | Nội dung |
|---|---|
| Schema | Versioned migrations v13–v25: `warehouses`, `user_warehouse_scopes`, `stock_locations`, `stock_documents`(+lines), `stock_moves`, `stock_balances`, `product_warehouse_policies`, `reservations`, `stock_serials`, `product_bundles`(+items), `stock_counts`(+lines), `misa_mappings`/`misa_sync_logs`. |
| Ledger bất biến | `stock_moves` là nguồn sự thật của tồn kho (D10); `stock_balances` chỉ là projection đọc nhanh. v4/v24/v25 hội tụ: chỉ số hiệu suất, lượng giữ hàng, ledger cũ bị đánh lại số. |
| Backend | `routes/stock.ts` (**1.300+ dòng**: chứng từ IN/OUT/TRANSFER/COUNT, tồn kho, min/max, serial/lô, combo, kiểm kê, giữ hàng, MISA, cảnh báo, duyệt...) + `routes/stockReports.ts` (mount bên trong `stock.ts`) + `routes/warehouses.ts`. |
| Frontend | **19 trang** `pages/Warehouse/` (Overview, Inventory, StockDocs, Moves, Locations, MinMax, Serial, Reservations, Count, Reports, SlowStock, Bundle, Alerts, Approvals, Exceptions, InTransit, Misa, Catalog, MyWork) + `services/stockService.ts`, `reservationService.ts`, `locationService.ts`. |
| Scheduler | Thêm `reservationExpiry.ts` (tự hết hiệu lực giữ hàng hết hạn) → tổng 6 cron job. |
| Tests | Thêm `stock.test.ts`, `stockReports.test.ts`, `warehouseRegression.test.ts`, `tasksScope.test.ts`... |

---

> **Xác minh gần nhất (12/10/2026):** `npm run test --workspace=backend` — **29 suites / 312 tests PASS** (~70s, mock DB; riêng `stockReports.test.ts` dùng `node:sqlite`). Số liệu 15 suites / 102 tests ở mục 11 là tại commit `8515ee3` (06/10/2026), trước các phase warehouse/RBAC.
