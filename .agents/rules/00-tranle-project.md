---
name: tranle-project
description: Core TranLe Tasks project rules. Apply to all TranLe Tasks development.
activation: always_on
---

# TranLe Tasks project context

Repository root:
`web_tranle_new`

Main areas:
- `frontend/`: React/Vite browser application.
- `backend/`: Express/TypeScript API, database, mail, AI, realtime and schedulers.
- `backend/routes/`: domain APIs.
- `backend/middleware/`: auth and validation.
- `backend/tests/`: Vitest.
- `frontend/services/`: API/service clients.
- `frontend/contexts/`: cross-cutting client state.

Known stack:
- React 19, Vite 6, TypeScript, Tailwind CSS 4
- React Router 7
- TanStack React Query
- Socket.IO
- Express 5, Zod, JWT, bcryptjs
- MySQL 8 only (mysql2 via DATABASE_URL; no SQLite/PostgreSQL path)
- Nodemailer, IMAPFlow, mailparser
- Google GenAI/Gemini
- Vitest

Core behavior:
1. Research the current implementation before changing it.
2. Reuse existing patterns.
3. Keep scope narrow.
4. Preserve API contracts unless explicitly changing them.
5. Test before declaring completion.
