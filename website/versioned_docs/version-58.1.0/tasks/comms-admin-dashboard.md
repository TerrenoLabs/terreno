# Tasks: Comms admin dashboard (errors, retries, log digging)

IP: [comms-admin-dashboard](../implementationPlans/comms-admin-dashboard.md)

## Phase 1 — Backend routes

- [x] **Task 1.1**: Upgrade explorer to `commsDashboard.ts` list + detail
  - Description: rich filters (channel/provider/status/errorClass/errorCode/userId/to/templateId/dates/`q`), pagination, `GET /comms/messages/:id` with attempts + metadata + retained payload
  - Files: `comms/src/routes/commsDashboard.ts` + supertest
  - Depends on: comms-abstraction Phase 2 (incl. hooks/error-taxonomy additions)
  - Acceptance: every filter covered by a supertest case; non-admin 403
- [x] **Task 1.2**: `retryMessage` facade + retry route
  - Description: retryability validation (status, errorClass, payload retention, channel configured, not verification), linked rows via `retriedFromId`/`retriedById`, hooks fire with `isRetry: true`, acting admin recorded
  - Files: `comms/src/commsService.ts`, `comms/src/routes/commsDashboard.ts` + tests
  - Depends on: 1.1
  - Acceptance: each non-retryable reason returns 400 with its stable `code`; successful retry creates a linked row
- [x] **Task 1.3**: `retryMany` + `/comms/stats`
  - Description: bulk retry with cap + skipped reasons; aggregation by channel × provider × status with day buckets and failure rate
  - Files: `comms/src/routes/commsDashboard.ts` + tests
  - Depends on: 1.2
  - Acceptance: stats counts match list totals for the same filter/range; cap enforced

## Phase 2 — Admin screens

- [x] **Task 2.1**: `CommsDashboardScreen`
  - Description: stats cards, filter bar (URL-persisted), DataTable with status badges + inline retry
  - Files: `admin-frontend/src/comms/CommsDashboardScreen.tsx`, `CommsStatusBadge.tsx`, `useCommsDashboardApi.tsx` + tests
  - Depends on: 1.1, 1.3
  - Acceptance: loading/error/empty states; filters round-trip through the URL
- [x] **Task 2.2**: `CommsMessageDetail`
  - Description: attempt timeline, provider console links, JSON viewer for payload/metadata, confirmed retry button with disabled-reason tooltips
  - Files: `admin-frontend/src/comms/CommsMessageDetail.tsx` + tests
  - Depends on: 1.2, 2.1
  - Acceptance: non-retryable rows show the specific reason; retry navigates to the new row
- [x] **Task 2.3**: Example app + admin-spa wiring
  - Description: expo-router screens under `app/admin/comms/`, admin-spa nav entry, `bun run sdk`
  - Files: `example-frontend/app/admin/comms/*`, `example-frontend/store/openApiSdk.ts`, admin-spa nav
  - Depends on: 2.1, 2.2
  - Acceptance: frontend verification in the running example app with screenshots on the PR

## Phase 3 — Bulk retry UI + docs

- [x] **Task 3.1**: "Retry all failed" flow
  - Description: filtered bulk retry with count confirmation modal; skipped-reason summary toast
  - Files: `admin-frontend/src/comms/CommsDashboardScreen.tsx` + tests
  - Depends on: 1.3, 2.1
  - Acceptance: confirmation shows the exact count; result summarizes retried/skipped
- [x] **Task 3.2**: Docs + rules
  - Description: dashboard section in comms reference, admin reference update, rulesync
  - Files: `docs/reference/comms.md`, `docs/reference/admin.md`, `.rulesync/**`
  - Depends on: 2.x
  - Acceptance: `bun run rules:check` passes
