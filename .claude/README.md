# TranLe Tasks — Project-local Claude Code harness

This `.claude/` configuration is written specifically for the public repository:
`Manhphan07092002/web-task-tranle-new`, branch `main`, project root `web_tranle_new`.

It follows the ECC operating model:
**research → plan → implement → test → review → verify → improve**.

It is intentionally project-specific instead of copying the whole ECC catalog.

## Repository facts used to design this harness

- Root workspace: npm workspaces for `frontend` and `backend`.
- Frontend: React 19 + Vite 6 + TypeScript + Tailwind 4, React Router 7, TanStack React Query, Socket.IO client, Recharts, DOMPurify.
- Backend: Node/TypeScript + Express 5 + Zod + JWT + bcryptjs + rate limiting + Socket.IO.
- Data: MySQL 8 only (`mysql2` via `DATABASE_URL`; DDL + versioned migrations v1–v25 in `backend/db_mysql.ts`).
- Mail: Nodemailer + IMAPFlow + mailparser.
- AI: Google GenAI/Gemini integration.
- Backend tests: Vitest with auth, tasks, meetings, reports, activity and crypto utility coverage.
- Backend structure includes middleware, routes, schedulers and utils.
- Domain routes include auth, users, roles, admin, tasks, projects, contracts, clients, departments, documents, mail, meetings, notes, notifications, reports, revenue, upload and AI.
- Root development command runs frontend and backend together; backend tests run through `npm run test` in `backend`; frontend has `build`.

## Non-negotiable project behavior

1. Do not guess architecture from filenames alone; inspect the current implementation.
2. Preserve existing API contracts unless the task explicitly changes them.
3. Treat auth, RBAC, uploads, mail, AI credentials and database changes as security-sensitive.
4. Never expose or hardcode secrets.
5. Do not move AI/provider secrets into browser code.
6. Do not reset or delete the database to make a test pass.
7. Never claim a test/build passed unless it was actually run.
8. Keep unrelated refactors out of feature work.

## Hướng dẫn sử dụng

Xem `HUONG-DAN-SU-DUNG.md` để có workflow đầy đủ và prompt mẫu. Xem `QUICK-REF.md` để tra nhanh các command.
