# Implementation Plan: Framework-level audit log

**Status:** Complete — shipped in #1301  
**Branch:** `cursor/framework-audit-log-grow-0d6c`  
**Owner:** —  
**Created:** 2026-09-10  
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1186 (implementation PRs use `Fixes #1186`)  
**Task list:** [framework-audit-log.md](../tasks/framework-audit-log.md)  
**Program:** [B2B platform](b2b-platform-program.md)  
**Depends on:** — (soft: `organizationId` now; org-admin list filter waits on [org-management-ui](org-management-ui.md))  
**RTK deprecation flag:** None — admin viewer uses generated OpenAPI / `useAdminApi`, not syncdb  

## Goal

Opt-in `AuditApp` in `@terreno/api` persists append-only `AuditEvent` rows for successful mutations: who changed which record, with changed-field before/after diffs. The existing admin Platform **Audit Log** lists them. Default retention is forever. This is the B2B compliance log; it generalizes example `AdminAuditLog` without replacing consent `ConsentResponse` rows.

## Non-Goals

- Waiting on `org-management-ui` to start (no `OrgsApp` in tree today).
- Default-on `modelRouter` product CRUD.
- Consent signing history (`ConsentResponse` + `GET /consents/audit/:userId` stay).
- Login, failed auth, permission denials (except existing `RbacAudit` `denied: true` fanned through `auditSink`).
- Sync mutate / outbox / socket writes (`@terreno/syncdb`). HTTP `modelRouter` only.
- Admin hard-delete of events; SIEM export; legal hold.
- Full-document snapshots.
- Per-org-admin filtered lists (store `organizationId` now; filter when org context ships).

## Decisions

| ID | Question | Choice |
| --- | --- | --- |
| Q1 | Org dependency | Ship now. Optional `organizationId` from the mutated document or `req.organization` when present. |
| Q2 | Default on | Off. `AuditApp` plugin + per-router `audit: true`. **AdminApp writes `AuditEvent` automatically when `AuditApp` is registered.** |
| Q3 | Events | Successful create/update/delete and array mutations on audited routers; AdminApp → same collection; RBAC via existing `auditSink`; consent stays domain-specific. |
| Q4 | Mutability / retention | HTTP list+read only. Create only via framework writers. No PATCH/DELETE. **Default retain forever.** Optional `retentionDays > 0` Mongo TTL. |
| Q5 | Diffs | Changed fields only. Auto-redact `password`, `hash`, `salt`, `token`, `secret`, `refreshToken` (case-insensitive last path segment) plus per-router `redact`. Never log full request bodies. |

**Recorded assumptions (not grilled):** No default-connection singleton (same as `RbacAudit`: `createAuditEventModel(connection)`). Example-backend **replaces** `AdminAuditLog` with `AuditEvent`. `onAdminAudit` remains an extra sink. Writes are best-effort (`logger.error`, mutation still succeeds). Persist is fire-and-forget on the request path. Optional Cloud Tasks enqueue (`GCP_TASKS_AUDIT_QUEUE` + `AUDIT_TASKS_URL`) writes Mongo on a worker via `POST /internal/audit-events`. `AuditEvent` is never audited. `audit: true` without `AuditApp` skips the write and logs an error once per process. Array mutations use `verb: "updated"` and `operation` `arrayPush` / `arrayUpdate` / `arrayRemove`. `organizationId` is stored as string. Admin list uses `Permissions.IsAdmin` until org RBAC lands.

## Architecture

```
AuditApp({retentionDays?})
  → createAuditEventModel(connection)
  → set process recorder
  → modelRouter("/audit-events", AuditEvent, {create/update/delete: [], list/read: IsAdmin})
  → adminContribution() for Platform Audit Log

modelRouter(..., {audit: true | {redact?: string[]}})
  → after successful create/update/delete/array *
  → recordAuditEvent({actorId, modelName, recordId, recordLabel?, organizationId?, verb, operation, before, after, source: "modelRouter"})

AdminApp
  → after successful admin CRUD, if recorder present
  → recordAuditEvent({..., source: "admin"})
  → then onAdminAudit? (unchanged extra sink)

createAccess({auditSink: persistRbacAuditToAuditEvent})
  → source: "rbac"; before/after from permissionDelta when present
```

`AuditApp` implements `TerrenoPlugin` (+ `adminContribution` like FeatureFlags). Importing `@terreno/api` does **not** register `AuditEvent` on `mongoose.connection`.

### Config shape

```typescript
interface AuditAppOptions {
  enqueue?: (write: AuditEventWrite) => Promise<void>;
  processQueuePath?: string;
  processQueueSecret?: string;
  /** Mongo TTL in days. Omit or 0 = forever (no TTL index). */
  retentionDays?: number;
}

interface ModelRouterAuditOptions {
  redact?: string[]; // extra field names; merged with defaults
}

// modelRouter options:
audit?: boolean | ModelRouterAuditOptions;
```

`audit: true` equals `{redact: []}`.

### Writer contract

```typescript
interface AuditEventWrite {
  actorId?: string;
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
  modelName: string;
  operation: "create" | "update" | "delete" | "arrayPush" | "arrayUpdate" | "arrayRemove";
  organizationId?: string;
  recordId?: string;
  recordLabel?: string;
  source: "admin" | "modelRouter" | "rbac";
  verb: "created" | "deleted" | "updated";
}
```

Diff helper: shallow (plus one-level nested objects) comparison of previous JSON vs next JSON after redaction. Unchanged keys omitted. Create: `before` omitted, `after` is redacted new fields. Delete: `after` omitted, `before` is redacted last state.

`organizationId` resolution order: `req.organization?.id` / `_id`, else string of `doc.organizationId` when present.

## Models

`AuditEvent` (collection `auditevents`):

| Field | Type | Notes |
| --- | --- | --- |
| `actorId` | ObjectId, ref User, indexed | Optional (system / missing user) |
| `modelName` | string, required, indexed | |
| `recordId` | string, indexed | |
| `recordLabel` | string | Short label (admin list fields / `title` / `name` / `email`) |
| `organizationId` | string, indexed | Optional |
| `verb` | `created` \| `updated` \| `deleted`, indexed | Widget-compatible |
| `operation` | string, required | Fine-grained verb |
| `source` | `admin` \| `modelRouter` \| `rbac`, indexed | |
| `before` / `after` | Mixed | Changed fields only, redacted |
| `created` / `updated` | dates | `createdUpdatedPlugin`; no `isDeletedPlugin` (append-only) |

Indexes: `{created: -1}`, `{modelName: 1, recordId: 1, created: -1}`. Optional TTL on `created` when `retentionDays > 0`. Every field has `description`. Five-type pattern co-located with the schema. `strict: "throw"`.

HTTP: `create`/`update`/`delete` empty permission arrays. No public POST/PATCH/DELETE even for admins. Denied list/create (including non-admin GET list) returns **405**, matching `permissionMiddleware`; instance-level denials after a loaded document remain **403**.

## APIs

| Method | Path | Who | Behavior |
| --- | --- | --- | --- |
| GET | `/audit-events` | IsAdmin | Paginated list, default sort `-created`, `queryFields`: `modelName`, `recordId`, `actorId`, `verb`, `source`, `organizationId` |
| GET | `/audit-events/:id` | IsAdmin | Read one |
| POST/PATCH/DELETE | `/audit-events` | — | Disabled |

Admin mounts the same model via `adminContribution` (or example registers it once — do **not** double-mount). Route path includes `audit-log` **or** model name `AuditEvent` so `AdminShell.isAuditLogModel` lifts it into Platform.

RBAC helper `persistRbacAuditToAuditEvent(model)` returns an `RbacAuditSink`. Built-in `RbacAudit` collection unchanged.

## Notifications

None.

## UI

Reuse Platform Audit Log + `RecentActivityWidget`. Update `isAuditLogModel` to match `AuditEvent` (keep `AdminAuditLog` and `audit-log` path for leftover apps). List columns: `created`, `verb`, `modelName`, `recordLabel`, `actorId`. Detail form is read-only; show `before`/`after` as JSON (existing object field rendering is enough). No new custom screen.

example-backend: register `AuditApp`, enable `audit: true` on `Todo`, drop `AdminAuditLog` model and `onAdminAudit` persistence (optional `onAdminAudit` may remain no-op or be removed). Point home `recentActivity` at `AuditEvent`. RBAC `auditSink` uses the helper. Scripts that count/wipe `AdminAuditLog` switch to `AuditEvent` (wipe only in test/dev scripts — production HTTP still cannot delete).

## Docs in this slice

| Page | Change |
| --- | --- |
| `docs/how-to/audit-log.md` | **New.** Enable `AuditApp`, per-router `audit`, AdminApp auto-write, redaction, TTL, append-only, org field. |
| `docs/reference/api.md` | `AuditApp`, `audit` option, `persistRbacAuditToAuditEvent`, no default-connection model. |
| `docs/explanation/admin-interface.md` | Platform Audit Log is `AuditEvent` when `AuditApp` is registered. |
| `docs/reference/admin-backend.md` | `onAdminAudit` is extra; framework write when `AuditApp` present. |
| `docs/explanation/roadmap-seed-issues.md` | IP + task URLs; soft org depend. |
| `docs/implementationPlans/b2b-platform-program.md` | Row for this IP. |
| `.rulesync/rules/api/00-api.mdc` | AuditApp + `audit` option. |
| `CHANGELOG.md` | Added opt-in framework audit log. |

## Testing

Tracer: `TerrenoApp` + `AuditApp` + test model with `audit: true` → authenticated PATCH changes `title` → `GET /audit-events` as admin returns one row with `verb: "updated"`, `before.title` / `after.title`, no `password` if present.

Cases:

- Plugin omitted: `audit: true` does not throw on CRUD; no collection on default connection; error logged once.
- Create/update/delete each write one event; actorId matches `req.user`.
- Unchanged fields absent from `before`/`after`.
- Default redact list strips secrets even if not in `redact`.
- Per-router `redact: ["ssn"]` strips `ssn`.
- Array push writes `operation: "arrayPush"`, `verb: "updated"`.
- Admin POST writes `source: "admin"` without `onAdminAudit`.
- `onAdminAudit` still fires when both configured; mutation 201 if either sink throws.
- AuditEvent HTTP POST is 404/not registered; PATCH/DELETE disabled.
- `organizationId` copied from document; from `req.organization` when set.
- `retentionDays` omitted: no TTL index. `retentionDays: 1`: TTL index present (assert index spec; do not sleep a day).
- Example RBAC role change fans into `AuditEvent` with `source: "rbac"`.
- Existing `onAdminAudit` tests stay green (best-effort extra sink).
- Admin frontend: `isAuditLogModel` true for `AuditEvent`; Recent Activity still skips when no audit model.

Skills: `terreno-backend-api`, `mongoose-schema-safety`, `backend-test-env` (if tests touch env), `building-admin-interfaces`, `verify-ui-changes` (example `/admin` audit log after Todo/admin mutation), `update-docs`, `generate-sdk` if example OpenAPI admin SDK lists the new route.

## Risks

| Risk | Mitigation |
| --- | --- |
| Write volume / PII | Opt-in per router; redaction; append-only HTTP. |
| Missing plugin | No-op + once-per-process error; docs. |
| Example `AdminAuditLog` break | Replace in the same slice; shell still matches old name. |
| TTL index change later | How-to: drop old TTL index when changing `retentionDays`. |
| Sync bypass | Documented non-goal; follow-up IP. |
| Org filter incomplete | Field stored; list filter is `org-management-ui`. |

## Phases

1. Tracer: model + `AuditApp` + `audit: true` create/update/delete + list/read API + redaction.
2. Array mutations + `organizationId`.
3. AdminApp auto-write + example migration + shell matcher + RBAC helper.
4. Optional TTL.
5. Docs, changelog, rulesync, seed, B2B table.

## Feature Flags & Migrations

No feature flag. New collection. example-backend drops `AdminAuditLog` (example-only; no published schema). Apps that copied `AdminAuditLog` keep it until they register `AuditApp`.

## Activity Log & User Updates

This IP **is** the activity log. No `UserUpdate` spam.

## Not Included / Future Work

- Org-admin scoped list (`org-management-ui`).
- Sync-path audit.
- Auth / login events.
- SIEM export, legal hold, immutable object storage.
- Custom diff UI beyond JSON fields.

## Files to Create / Modify

| File | Role |
| --- | --- |
| `api/src/audit/*` | Model, recorder, diff/redact, `AuditApp`, tests |
| `api/src/api.ts` | `audit` option + post hooks |
| `api/src/index.ts` | Exports |
| `admin-backend/src/adminApp.ts` | Auto-write when recorder present |
| `admin-frontend/src/AdminShell.tsx`, `AdminHome.tsx` | `isAuditLogModel` |
| `example-backend/src/server.ts`, `access.ts`, models, scripts | `AuditApp`; drop `AdminAuditLog` |
| Docs listed above | Same slice |

## Task List

[docs/tasks/framework-audit-log.md](../tasks/framework-audit-log.md)

## Acceptance Criteria

- [ ] `AuditApp` omitted: no `AuditEvent` on the default connection; product CRUD unchanged.
- [ ] `audit: true` + `AuditApp`: create/update/delete persist one event with actor, model, record, changed-field diff, redacted secrets.
- [ ] HTTP `/audit-events` is list+read for admin only; create/update/delete disabled.
- [ ] Admin mutations write `AuditEvent` when the plugin is registered, without requiring `onAdminAudit`.
- [ ] `onAdminAudit` still runs as an extra best-effort sink.
- [ ] example-backend Platform Audit Log and Recent Activity read `AuditEvent`; `AdminAuditLog` removed.
- [ ] RBAC `auditSink` helper writes `source: "rbac"` without dropping `RbacAudit`.
- [ ] Default: no TTL. `retentionDays > 0` adds TTL on `created`.
- [ ] How-to + api reference + admin explanation match the shipped design.
- [ ] Merging the implementation PR closes https://github.com/TerrenoLabs/terreno/issues/1186 (`Fixes #1186`).
