# TranLe Tasks — Workflow theo từng loại công việc

## A. Feature frontend

/tranle-plan
→ inspect page/component/hook/service
→ identify API/query/cache
→ implement
→ frontend build
→ /tranle-review
→ /tranle-verify

Checklist:
- loading
- empty
- error
- permission
- responsive
- i18n if applicable
- React Query cache
- realtime if applicable

## B. Backend API

/tranle-plan
→ route
→ auth
→ validation
→ service/db
→ tests
→ frontend consumer
→ /tranle-review
→ /tranle-verify

Checklist:
- authentication
- RBAC
- validation
- ownership
- status codes
- response shape
- error handling
- tests

## C. Bug

/tranle-debug
→ reproduce
→ root cause
→ regression test
→ fix
→ test
→ /tranle-review
→ /tranle-verify

## D. Database migration

/tranle-db
→ inspect MySQL schema/migrations (`backend/db_mysql.ts`)
→ migration plan
→ data preservation
→ implement
→ migration tests
→ API tests
→ review
→ verify

## E. RBAC

/tranle-rbac
→ identify permission
→ identify resource scope
→ server enforcement
→ frontend UX
→ allowed/denied tests
→ security review

## F. Realtime

/tranle-realtime
→ event producer
→ event payload
→ client listener
→ cleanup
→ cache/state update
→ integration verification

## G. Mail

/tranle-mail
→ route
→ mailer/IMAP
→ authorization
→ attachment/content security
→ provider failure tests
→ review

## H. AI

/tranle-ai
→ provider boundary
→ server-side credential
→ input validation
→ untrusted output
→ provider error handling
→ mocked tests
→ security review

## I. Refactor

/tranle-context
→ define current behavior
→ isolate one responsibility
→ refactor
→ tests
→ diff review
→ verify

Never combine a large refactor with unrelated feature work.

## J. Security audit

/tranle-security
→ evidence
→ severity
→ remediation
→ fix only after review
→ verify

## K. Release

/tranle-release
→ status
→ diff
→ secret scan
→ tests/build
→ DB/config review
→ final risk report
→ commit only when approved
