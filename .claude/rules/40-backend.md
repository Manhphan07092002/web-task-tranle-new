# Backend rules

Current stack:
Express 5, TypeScript, Zod, JWT, bcryptjs, express-rate-limit, Socket.IO, MySQL 8 (mysql2), Nodemailer, IMAPFlow and Google GenAI.

Rules:

- Validate untrusted input at the API boundary.
- Authentication and authorization must be enforced server-side.
- Do not trust user IDs, role IDs, department IDs or ownership claims supplied by the browser.
- Reuse `middleware/auth.ts` and `middleware/validate.ts` patterns.
- Preserve HTTP status and response-shape conventions.
- Keep route handlers focused.
- Avoid adding dependencies when existing dependencies already solve the problem.
- Do not swallow database, mail or AI errors silently.
- Do not expose stack traces, secrets or internal database details in API responses.
- Protect expensive/abusable endpoints with the existing rate-limit strategy where appropriate.
