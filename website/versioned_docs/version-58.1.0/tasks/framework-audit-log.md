# Tasks: Framework-level audit log

IP: [framework-audit-log.md](../implementationPlans/framework-audit-log.md)  
**Closes:** https://github.com/TerrenoLabs/terreno/issues/1186

**Feature profile:** false (full IP)

## Phase 1 — Tracer (model, plugin, CRUD diffs)

- [x] **Task 1.1**: `AuditEvent` model + `AuditApp` list/read router
  - Delivers: `createAuditEventModel(connection)` (no default-connection singleton); `new AuditApp()` registers GET list/read at `/audit-events` with `Permissions.IsAdmin`; create/update/delete permission arrays empty; default no TTL; field `description`s; append-only (no `isDeletedPlugin`)
  - Files: `api/src/audit/auditEventModel.ts`, `api/src/audit/auditApp.ts`, `api/src/audit/auditApp.test.ts`, `api/src/index.ts`
  - Blocked by: none
  - Skills: `terreno-backend-api`, `mongoose-schema-safety`, `backend-test-env`
  - Docs: stub `AuditApp` in `docs/reference/api.md` so the tracer is documented when it lands
  - Acceptance: bun + supertest — import `@terreno/api` does not register `AuditEvent` on `mongoose.connection`; with plugin, admin GET list 200 empty; POST/PATCH/DELETE not available; non-admin list 405 (modelRouter `permissionMiddleware` for failed list perms)

- [x] **Task 1.2**: `modelRouter` `audit` + recorder + redacted diffs
  - Delivers: `audit: true | {redact?: string[]}` after successful create/update/delete writes one `AuditEvent` (`source: "modelRouter"`, `verb` created/updated/deleted); changed-fields only; default redact `password`/`hash`/`salt`/`token`/`secret`/`refreshToken`; extra `redact` merged; best-effort (`logger.error`, CRUD still 2xx); never audit `AuditEvent`; without `AuditApp`, skip write and log error once per process
  - Files: `api/src/audit/record.ts`, `api/src/audit/diff.ts`, `api/src/api.ts`, `api/src/audit/auditRouter.test.ts` (or extend 1.1 tests)
  - Blocked by: 1.1
  - Skills: `terreno-backend-api`
  - Docs: one-line `audit` option on the api.md stub
  - Acceptance: bun tests — PATCH `title` yields one event with `before.title`/`after.title`; secret fields absent; `redact: ["ssn"]` strips `ssn`; create has `after` only; delete has `before` only; thrown recorder still returns 200/201; plugin omitted: CRUD 201 and zero events

## Phase 2 — Array ops + org field

- [x] **Task 2.1**: Array mutations
  - Delivers: modelRouter array push/update/remove with `audit: true` write `verb: "updated"` and `operation` `arrayPush` / `arrayUpdate` / `arrayRemove`; `recordId` set
  - Files: `api/src/api.ts`, `api/src/audit/*.test.ts`
  - Blocked by: 1.2
  - Skills: `terreno-backend-api`
  - Docs: operation table in `docs/how-to/audit-log.md` (create page if 5.1 not started)
  - Acceptance: bun + supertest for each array verb; one event each; product array tests still pass

- [x] **Task 2.2**: Optional `organizationId`
  - Delivers: copy `req.organization` id when set, else string `doc.organizationId`; omit when neither exists; list `queryFields` includes `organizationId`
  - Files: `api/src/audit/record.ts`, tests
  - Blocked by: 1.2
  - Skills: `terreno-backend-api`
  - Docs: org field note on the how-to (org-admin filter is future)
  - Acceptance: two tests — document field vs `req.organization`; neither → field absent

## Phase 3 — Admin, example, RBAC

- [x] **Task 3.1**: AdminApp auto-write
  - Delivers: when recorder is present, successful admin POST/PATCH/DELETE persist `AuditEvent` with `source: "admin"` even if `onAdminAudit` is omitted; still invoke `onAdminAudit` when set; skip `AuditEvent` model; mutation succeeds if the framework write throws
  - Files: `admin-backend/src/adminApp.ts`, `admin-backend/src/adminApp.models.test.ts`
  - Blocked by: 1.2
  - Skills: `building-admin-interfaces`, `terreno-backend-api`
  - Docs: `docs/reference/admin-backend.md` — `onAdminAudit` is extra
  - Acceptance: existing `onAdminAudit` tests still pass; new tests — plugin present, no `onAdminAudit`, POST creates an `AuditEvent`; both configured → both run; throw in recorder → still 201

- [x] **Task 3.2**: example-backend + RBAC helper + Platform shell
  - Delivers: `persistRbacAuditToAuditEvent` exported from `@terreno/api`; example registers `AuditApp`, `audit: true` on Todo, removes `AdminAuditLog` model/`onAdminAudit` persistence, points admin config + scripts + `access.ts` sink at `AuditEvent`; `isAuditLogModel` matches `AuditEvent` (keep old name/path); Recent Activity uses it
  - Files: `api/src/audit/rbacSink.ts`, `example-backend/src/server.ts`, `example-backend/src/access.ts`, `example-backend/src/models/adminAuditLog.ts` (delete), `example-backend/src/modelInterfaces.ts`, `example-backend/src/adminScripts.ts`, `admin-frontend/src/AdminShell.tsx`, `admin-frontend/src/AdminHome.tsx`, matching tests
  - Blocked by: 3.1
  - Skills: `building-admin-interfaces`, `verify-ui-changes`, `generate-sdk` if OpenAPI admin SDK must list `/audit-events`
  - Docs: example README admin paragraph
  - Acceptance: bun tests for shell matcher + RBAC sink mapping; example compile; UI: admin login → mutate a Todo or admin model → Platform Audit Log / Recent Activity shows the row (`verify-ui-changes`, artifacts under `/opt/cursor/artifacts/`)

## Phase 4 — Retention

- [x] **Task 4.1**: Optional TTL
  - Delivers: `AuditApp({retentionDays: n})` for `n > 0` creates TTL index on `created` (`expireAfterSeconds = n * 86400`); omit or `0` → no TTL index
  - Files: `api/src/audit/auditEventModel.ts`, `api/src/audit/auditApp.ts`, tests
  - Blocked by: 1.1
  - Skills: `mongoose-schema-safety`
  - Docs: TTL + index-drop note on the how-to
  - Acceptance: index spec assertions; default plugin has no TTL index

## Phase 5 — Docs and roadmap

- [x] **Task 5.1**: Diátaxis + changelog + rules
  - Delivers: operator how-to, api reference (full, not stub), admin-interface Platform row, admin-backend `onAdminAudit` note, rulesync api rule, `CHANGELOG.md` Added, `bun run rules` / `skills:sync` if rulesync changed
  - Files: `docs/how-to/audit-log.md`, `docs/reference/api.md`, `docs/explanation/admin-interface.md`, `docs/reference/admin-backend.md`, `.rulesync/rules/api/00-api.mdc`, `CHANGELOG.md`
  - Blocked by: 1.2 (content can land with 2.x–4.x; must match shipped options)
  - Skills: `update-docs`
  - Acceptance: a stranger can enable `AuditApp` + `audit: true` from the how-to; append-only and forever-default are explicit; `bun run website:build` if the docs site is in the slice

- [x] **Task 5.2**: Roadmap seed + B2B table
  - Delivers: `docs/explanation/roadmap-seed-issues.md` `framework-audit-log` points at IP/task GitHub URLs, `IP=framework-audit-log`, depends line is soft-org; `b2b-platform-program.md` lists this IP as Draft/Approved matching the IP header
  - Files: `docs/explanation/roadmap-seed-issues.md`, `docs/implementationPlans/b2b-platform-program.md`
  - Blocked by: 5.1
  - Skills: `update-docs`
  - Acceptance: seed `Implementation plan` / `Tasks` links are not `*(not yet written)*`
