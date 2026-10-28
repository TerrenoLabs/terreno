# Implementation Plan: Durable background jobs (`@terreno/jobs`)

**Status:** Complete — 2026-09-10  
**Branch:** `cursor/durable-background-jobs-803d`  
**Owner:** —  
**Created:** 2026-09-10  
**Approved:** 2026-09-10  
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1188 (this feature **closes** that issue; implementation PRs use `Fixes #1188`)  
**Task list:** [job-queues.md](../tasks/job-queues.md)  
**Depends on:** —  
**RTK deprecation flag:** Partial — admin screens use generated SDK / `useAdminApi`  
**Program:** [B2B platform](b2b-platform-program.md)  

## Goal

Terreno apps can enqueue named jobs that survive process restarts: retries with
backoff, delayed and recurring schedules, dead-lettering, and an admin operations
UI. Persistence and the default worker are **Mongo**. Execution is a pluggable
`JobRunner` so the same job definitions run in-process, in a standalone worker,
on **GCP Cloud Tasks**, on **Vercel Queues**, or on a custom runner. Comms,
webhooks, and billing stay on their current paths; this IP ships the queue they
will enqueue onto later.

## Non-Goals

- BullMQ, Redis, or any Redis-backed queue.
- Vercel Workflows (`"use workflow"` / `"use step"`).
- Migrating `@terreno/comms` sends, Expo receipt polling, `WebhooksApp`
  200-then-queue dispatch, or `@terreno/billing` sync onto the queue.
- Replacing or merging `BackgroundTask` / admin **scripts**.
- Changing in-process `cronjob()` behavior (hard-coded `America/Chicago`).
- Live GCP or Vercel integration tests in CI.
- Generic `modelRouter` CRUD as the operator UI.

## Decisions

| Question | Decision |
|----------|----------|
| Package | New workspace package **`@terreno/jobs`**. `JobsApp` implements `TerrenoPlugin`. |
| Persistence | Mongo collections owned by this package. Default runner claims work from Mongo. |
| `BackgroundTask` | Unchanged. Scripts stay in-process bookkeeping. Jobs are a separate `Job` model. |
| v1 consumers | Framework + example only. Public `enqueue` is the seam later IPs call. |
| Workers | **Both:** `jobs.startWorker()` in the API process **or** a dedicated worker process. Explicit opt-in; registering `JobsApp` does not start a poll loop. |
| Schedules | Delayed `runAt` and recurring cron. Timezone is an **IANA** string on each schedule (default **`UTC`**). |
| Cloud dispatch | **GCP Cloud Tasks** and **Vercel Queues** adapters (mocked-SDK tests). Custom `JobRunner` is a first-class type. |
| Vercel product | **Queues** only. Job catalog and admin stay in Terreno. |
| Execute HTTP | `POST {basePath}/execute` for GCP/custom HTTP push (GCP: OIDC). Vercel uses private `handleCallback` consumers → `executeJobById`. Mongo runner does **not** mount execute unless a cloud/custom runner needs it. |
| Admin UI | Custom screen `jobs` (comms pattern): list/filter, detail/attempts, retry, DLQ requeue, cancel. Home widget. example-frontend + admin-spa. |
| Existing `cronjob()` | Leave it. Docs call it process-local. Durable work uses `JobsApp`. |
| Delivery | At-least-once. Handlers must be idempotent. Optional `idempotencyKey` unique with `name`. |
| Payload | JSON-serializable only. Admin redacts by default (`redactPayload`). |
| Recurring overlap | One in-flight instance per schedule `name`; skip the tick if still running. |

## Architecture

```
@terreno/jobs
  JobsApp (TerrenoPlugin)
    define(name, {handler, retry, schedule?})
    enqueue({name, payload, runAt?, idempotencyKey?})
    startWorker()                    // Mongo poll / runner.start
    adminContribution() → screen "jobs"
    optional POST /jobs/execute      // cloud/custom HTTP

JobRunner
  enqueue(job) → dispatch
  start?(signal) → local poll (Mongo)
  stop?()

MongoJobRunner     — claim via findOneAndUpdate; lock TTL
GcpCloudTasksRunner — create HTTP task → POST /jobs/execute (OIDC)
VercelQueuesRunner  — send(topic,{jobId}) → private handleCallback consumer → executeJobById
Custom              — app-supplied JobRunner
```

```typescript
import {JobsApp, MongoJobRunner, getJobsService} from "@terreno/jobs";

const jobs = new JobsApp({
  runner: new MongoJobRunner(),
  timezone: "UTC",
});

jobs.define("send-welcome-email", {
  handler: async (payload, ctx) => {
    ctx.log.info("sending");
    // work
  },
  retry: {maxAttempts: 5, backoffMs: 1000},
});

new TerrenoApp({userModel: User}).register(jobs);

// Explicit — API process or a worker entrypoint
await jobs.startWorker();

await getJobsService().enqueue({
  name: "send-welcome-email",
  payload: {userId: "..."},
});
```

Standalone worker (example-backend): same `JobsApp` definitions, `build()` without
`listen`, then `startWorker()`. Do not start two poll loops against the same
queue unless lock TTL and claim are in place (they are).

### Claim (Mongo)

`findOneAndUpdate` where `status` is `pending` or `scheduled`, `runAt <= now`,
and `lockedAt` is missing or older than `lockTtlMs` (default 15 minutes). Set
`status: "running"`, `lockedAt`, `lockedBy` (hostname + pid). On success, wrap
`runWithRequestContext({jobId})`. On handler success → `completed`. On throw →
increment `attemptCount`, set `lastError`, either `pending` with `runAt` backoff
or `dead` when `attemptCount >= maxAttempts`.

### Retry

Exponential backoff from `retry.backoffMs` (default 1000) with jitter, cap
`retry.maxBackoffMs` (default 15 minutes). `maxAttempts` default 5. Dead-letter
status is **`dead`**. Admin **Retry** enqueues a new `Job` (`retriedFromId`);
**Requeue DLQ** resets the same row to `pending` with `runAt: now` and clears
the lock.

### Recurring

`define(name, {schedule: {cron, timezone?}})` upserts a `JobSchedule` row.
The worker ticks due schedules and `enqueue`s a child `Job` with
`scheduleId`. Timezone defaults to `JobsApp` `timezone` then `UTC`. Invalid cron
fails `define` / startup, not silently.

### `JobRunner`

```typescript
interface JobRunner {
  readonly id: string;
  enqueue(job: JobDocument): Promise<void>;
  start?(options: {jobs: JobsApp; signal: AbortSignal}): Promise<void>;
  stop?(): Promise<void>;
}
```

Mongo `enqueue` only persists (already saved) then no-ops dispatch — the poller
picks it up. Cloud runners persist then create a platform task whose HTTP body
is `{jobId}` (not the payload). Execute loads the Mongo row, claims if needed,
runs the handler.

GCP and Vercel SDKs are **optional peers** on subpath exports
(`@terreno/jobs/runners/gcpCloudTasks`, `@terreno/jobs/runners/vercelQueues`).
Core `@terreno/jobs` has zero cloud SDKs. Tests inject fakes.

### Execute HTTP

Mounted only when `JobsApp` `mountExecuteRoute: true` or the runner requests it
(GCP default true; Vercel uses private `handleCallback` consumers; Mongo default false).

| Status | When |
|--------|------|
| 200 | Handler finished (success or recorded failure/dead) |
| 401 | Missing/invalid OIDC or platform signature |
| 404 | Unknown `jobId` |
| 409 | Job already `completed` / `cancelled` (idempotent no-op 200 preferred for provider retries — **200** if terminal success; **409** only if still `running` under a live lock) |

Do not skip rate limiting on this path. Do not add it to generated SDK consumer
hooks (admin uses dedicated jobs routes). OpenAPI: document execute as
internal/operator; omit from public SDK codegen if tagged internal.

### Logging

`createScopedLogger({prefix: "[Job]", labels: {jobName, jobId}})`. Never log
full payloads or secrets. Correlation: `runWithRequestContext({jobId})`.

## Models

Five-type pattern, field `description`s, `createdUpdatedPlugin`. **No**
`isDeletedPlugin` on live queue rows (use `cancelled`). Not `modelRouter`
models.

**Job** — `name` (string, indexed), `payload` (Mixed), `status` (`pending` \|
`scheduled` \| `running` \| `completed` \| `failed` \| `cancelled` \| `dead`),
`runAt` (date, indexed), `attemptCount` (number), `maxAttempts` (number),
`lockedAt` / `lockedBy`, `lastError`, `attempts[]` (`{at, error, errorClass}`),
`scheduleId` (optional ref), `idempotencyKey` (optional), `retriedFromId` /
`retriedById`, `payloadRedacted` (boolean). Unique sparse index
`(name, idempotencyKey)`. Compound index `(status, runAt)`.

**JobSchedule** — `name` (unique), `cron`, `timezone`, `nextRunAt`, `enabled`,
`handlerName` (= `name`).

## APIs

Default `basePath` `/jobs`. Admin routes require `admin:access` plus
`admin:jobs` when `accessControl` is configured; legacy `user.admin` when not.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/jobs` | Paginated list: `name`, `status`, `scheduleId`, date range, `q` |
| GET | `/jobs/:id` | Detail: attempts, redacted payload, lock |
| POST | `/jobs/:id/retry` | New job from payload; original `retriedById` |
| POST | `/jobs/:id/requeue` | DLQ/`failed`/`cancelled` → `pending` now |
| POST | `/jobs/:id/cancel` | `pending`/`scheduled`/`running` → `cancelled` (handler `ctx.signal`) |
| GET | `/jobs/schedules` | Defined schedules + next run |
| POST | `/jobs/schedules/:name/pause` | `enabled: false` |
| POST | `/jobs/schedules/:name/resume` | `enabled: true` |
| POST | `/jobs/execute` | Cloud/custom HTTP execute (not admin session) |

Enqueue from app code only (`getJobsService().enqueue`). No public
`POST /jobs` create for arbitrary names from the browser.

## Notifications

None. Failures are `Job` rows + `logger`. Downstream comms can `enqueue` later.

## UI

`JobsApp.adminContribution()`: custom screen `name: "jobs"`, display **Jobs**,
icon `clock`. Built-in widget in `@terreno/admin-frontend` (`JOBS_ADMIN_WIDGETS`)
so hosts do not re-map (comms pattern).

| Piece | Role |
|-------|------|
| `JobsDashboardScreen` | Filters + table + pause/resume schedules |
| `JobsJobDetail` | Attempts, error, retry / requeue / cancel |
| Home widget `jobs` | Counts of `dead` + `running`; link to screen |

example-frontend: `/admin/jobs`, `/admin/jobs/[id]`.  
admin-spa: `/jobs`, `/jobs/[id]`.  
`verify-ui-changes` on the example admin.

RBAC: add `jobs` to `terrenoStatements.admin` (alongside `runScripts`).

## Phases

1. **Tracer:** package, `define`/`enqueue`, Mongo claim, `startWorker`, one example job.
2. **Reliability:** retries, DLQ, lock TTL, cancel signal, delayed `runAt`, cron schedules.
3. **Runners:** `JobRunner`, custom fake, GCP Cloud Tasks, Vercel Queues, execute HTTP.
4. **Admin:** routes + UI + example + spa.
5. **Docs + publish:** Diátaxis, changelog, CI, `publish-on-tag`, seed/positioning.

## Feature Flags & Migrations

New collections only. No user-data migration. Opt-in: apps that never register
`JobsApp` are unchanged.

## Activity Log & User Updates

Each attempt is on `Job.attempts`. No end-user notifications.

## Not Included / Future Work

- Comms automatic scheduled retries (`comms-abstraction` / admin dashboard).
- Webhook 200-then-queue (`inbound-webhooks`).
- Billing Stripe handler offload (`billing-stripe`).
- Vercel Workflows runner.
- Redis/BullMQ runner.
- Per-queue concurrency caps / rate limits beyond claim locks.
- Streaming logs over sockets (poll admin GET).

## Docs in this slice

| Page | Change |
|------|--------|
| `docs/how-to/background-jobs.md` | **New.** Define, enqueue, worker vs API, Mongo vs GCP vs Vercel, execute auth, idempotency. |
| `docs/reference/jobs.md` | **New.** Options, models, routes, runners, env. |
| `docs/how-to/README.md` | Link the how-to. |
| `docs/reference/api.md` | Contrast `cronjob()` / `wrapScript` as process-local. |
| `docs/reference/environment-variables.md` | Jobs / Cloud Tasks / Vercel / execute audience. |
| `docs/how-to/admin-import-prebuilt.md` | `JobsApp` screen `jobs`. |
| `docs/explanation/roadmap-seed-issues.md` | IP + task URLs; `IP=job-queues`. |
| `docs/explanation/positioning.md` | Celery/ActiveJob row → shipped via `@terreno/jobs` when Complete. |
| `changelog/unreleased/job-queues.md` | Added. |
| `.rulesync/rules/jobs/00-jobs.md` | Package rule; `bun run rules` / `skills:sync`. |
| `.rulesync/skills/terreno-backend-api/SKILL.md` | Jobs vs scripts vs cron. |

## Testing

Bun + `@terreno/test` Mongo. Do not mock `@terreno/api` or models. Cloud adapters:
inject fake Task/Queue clients. Execute route: signed vs unsigned. Claim: two
workers cannot run the same job. Restart: `running` with expired lock is
reclaimed. Recurring: timezone `America/New_York` vs `UTC` tick. Admin: 403
without `admin:jobs`. UI: `verify-ui-changes`.

## Files to Create / Modify

- `jobs/` — new package (models, service, runners, routes, tests)
- Root `package.json` workspace + `jobs:*` scripts
- `api/src/rbac/statements.ts` — `admin: ["access", "runScripts", "viewBackgroundTasks", "jobs"]`
- `admin-frontend` — jobs screens + widgets + tests
- `admin-spa` — routes
- `example-backend` — `JobsApp` + worker entry + demo job
- `example-frontend` — admin routes + SDK regen if jobs admin paths are OpenAPI
- `.github/workflows/jobs-ci.yml`, `publish-on-tag.yml`, `cd.yml` path filters
- Docs/rules/changelog as in the table

## Task List

See [docs/tasks/job-queues.md](../tasks/job-queues.md).

## Acceptance Criteria

- [x] `enqueue` then kill the Node process; a new `startWorker()` runs the job.
      Verified by bun test that simulates crash by leaving `pending` and starting
      a second worker.
- [x] Handler throw retries until `maxAttempts` then `status: "dead"`. Admin
      requeue returns it to `pending` and the worker runs it. Verified by bun tests
      + admin UI verification.
- [x] Delayed `runAt` in the future is not claimed early; cron in a named IANA
      timezone fires `nextRunAt` correctly. Verified by bun tests with frozen clocks
      (Luxon).
- [x] Two overlapping `startWorker()` loops claim a job once. Verified by bun test.
- [x] Custom `JobRunner` receives `enqueue`; GCP and Vercel adapters create a
      mocked platform task and `POST /jobs/execute` with valid auth runs the
      handler, invalid auth 401. Verified by bun tests (no live cloud).
- [x] Admin Jobs screen lists jobs, opens detail, retries, requeues DLQ, cancels.
      Verified by `verify-ui-changes` artifacts.
- [x] Apps without `JobsApp` behave as today (`cronjob`, scripts). Verified by
      existing api/admin-backend tests remaining green.
- [x] How-to + jobs reference match the shipped API. Verified in Roast;
      `bun run website:build` on the docs task.

## Named assumptions

1. Handlers are registered in every process that executes jobs (API and worker).
2. JSON payloads only; no Buffer/stream jobs in v1.
3. Unique `(name, idempotencyKey)` makes duplicate enqueue a no-op returning the
   existing row.
4. `failed` is a transient row state between attempts if we surface it; terminal
   exhaustion is `dead`. Pick may use `pending` between retries only — then omit
   `failed` as terminal. Prefer **pending-with-future-`runAt`** between attempts
   and **`dead`** at exhaustion so the admin filter is simple.
5. Positioning Celery row updates when the IP is **Complete**, not while Draft.
