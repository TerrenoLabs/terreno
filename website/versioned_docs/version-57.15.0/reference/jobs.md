# @terreno/jobs

Durable background jobs plugin for `@terreno/api`. Persists work in MongoDB, runs handlers
with retries and schedules, and supports pluggable dispatch (`MongoJobRunner`, GCP Cloud
Tasks, Vercel Queues, custom).

Operator guide: [Durable background jobs](../how-to/background-jobs.md).

## Install

```bash
bun add @terreno/jobs
```

Peers: `mongoose ^8.0.0 || ^9.0.0`; optional `@google-cloud/tasks`, `@vercel/queue`.

## Package exports

| Import | Contents |
| --- | --- |
| `@terreno/jobs` | `JobsApp`, `getJobsService`, `tryGetJobsService`, `unregisterJobsService`, `Job`, `JobSchedule`, types, `MongoJobRunner` |
| `@terreno/jobs/runners/gcpCloudTasks` | `GcpCloudTasksRunner`, client seams |
| `@terreno/jobs/runners/vercelQueues` | `VercelQueuesRunner`, `createVercelQueuesConsumer`, limits/helpers |

## JobsApp

`JobsApp` implements `TerrenoPlugin` and `JobsRunnerHost`.

### Options (`JobsAppOptions`)

| Option | Default | Description |
| --- | --- | --- |
| `basePath` | `"/jobs"` | Admin routes and execute route prefix |
| `runner` | `MongoJobRunner` | Dispatch + optional poll loop |
| `timezone` | `"UTC"` | Default IANA zone for schedules without `schedule.timezone` |
| `lockTtlMs` | `900_000` (15 min) | Stale `lockedAt` reclaim threshold |
| `pollIntervalMs` | `1_000` | Mongo runner idle sleep between polls |
| `accessControl` | — | Terreno RBAC; jobs admin needs `admin:access` **and** `admin:jobs` |
| `redactPayload` | — | Admin payload projection hook (see below) |
| `mountExecuteRoute` | `false` | Force `POST {basePath}/execute` |
| `executeAuth` | — | Required when execute route is mounted |

Execute route mounts when `mountExecuteRoute: true` **or** `runner.requiresExecuteRoute === true`.

### Methods

| Method | Description |
| --- | --- |
| `define(name, definition)` | Register handler, retry, and optional schedule |
| `register(app, openApi?)` | Mount admin + execute routes; register `JobsService` |
| `startWorker()` | Start runner `start()` (fire-and-forget); reconciles schedules first |
| `stopWorker()` | Abort signal + `runner.stop()` |
| `executeQueuedJob(jobId, signal?)` | Run by id (queue consumer / tests) |
| `adminContribution()` | Admin screen + home widget metadata |

## JobDefinition

```typescript
interface JobDefinition {
  handler: (payload: unknown, ctx: JobHandlerContext) => Promise<void>;
  retry?: {
    backoffMs?: number;      // default 1_000
    maxAttempts?: number;    // default 5
    maxBackoffMs?: number;   // default 900_000
  };
  schedule?: {
    cron: string;
    timezone?: string;       // IANA; falls back to JobsApp timezone
  };
}
```

`JobHandlerContext`: `{jobId, log: ScopedLogger, signal: AbortSignal}`.

## Enqueue (`EnqueueJobParams`)

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | Registered handler name |
| `payload` | yes | JSON-serializable mixed |
| `runAt` | no | Earliest claim time (default now, UTC) |
| `idempotencyKey` | no | Dedupes per `name` |
| `scheduleId` | no | Set by scheduler for cron children |

`getJobsService().enqueue(...)` after `JobsApp.register()`. `tryGetJobsService()` returns
`undefined` when `JobsApp` is not mounted. `unregisterJobsService()` clears the process
singleton (tests).

### Admin scripts (`admin/script`)

`@terreno/admin-backend` `defineAdminScriptJob` registers handler name `admin/script` with
`retry.maxAttempts: 1`. Payload: `{scriptName, taskId, wetRun, args, createdByName?}`.
The Scripts UI still polls `BackgroundTask` by `taskId`. Without `JobsApp`, script HTTP
runs stay in-process.

## JobRunner

```typescript
interface JobRunner {
  readonly id: string;
  readonly requiresExecuteRoute?: boolean;
  enqueue(job: JobDocument): Promise<void>;
  start?(options: JobRunnerStartOptions): Promise<void>;
  stop?(): Promise<void>;
}
```

Built-in ids: `mongo`, `gcp-cloud-tasks`, `vercel-queues`.

## Job model (`Job`)

| Field | Default | Description |
| --- | --- | --- |
| `name` | — | Handler name (indexed) |
| `status` | — | See statuses below |
| `payload` | — | Handler input |
| `payloadRedacted` | `false` | Admin omission flag |
| `runAt` | — | Earliest claim (indexed) |
| `attemptCount` | `0` | Executions so far |
| `attempts` | `[]` | `{at, error?, errorClass?}` |
| `maxAttempts` | `5` | From definition at enqueue |
| `backoffMs` | `1_000` | Retry base |
| `maxBackoffMs` | `900_000` | Retry cap |
| `lastError` | — | Latest failure message; `$unset` when the job completes |
| `lockedAt` / `lockedBy` | — | Claim lease |
| `idempotencyKey` | — | Partial unique with `name` |
| `scheduleId` | — | Parent schedule ref |
| `retriedFromId` / `retriedById` | — | Admin retry linkage |
| `created` / `updated` | plugins | Timestamps |

Indexes: `(name, idempotencyKey)` partial unique; `(status, runAt)`; `(scheduleId, status)`.

### Statuses

| Status | Meaning |
| --- | --- |
| `pending` | Waiting for `runAt`; claimable |
| `running` | Claimed; handler executing |
| `scheduled` | Reserved in schema / in-flight filter |
| `completed` | Success |
| `dead` | Exhausted `maxAttempts` |
| `failed` | No handler registered at run time |
| `cancelled` | Admin cancel |

### Retry backoff

`computeRetryDelayMs`: `backoffMs * 2^(attemptCount-1)`, capped at `maxBackoffMs`, × equal jitter in `[0.5, 1.0)`.

### Claim / lock

`createClaimLock` sets `lockedAt`, `lockedBy` (worker id). Claims match `status ∈ {pending,running,scheduled}`, `runAt <= now`, and expired or missing lock. `executeJobById` returns `noop` for terminal rows, `409` conflict for live lock or not-due.

## JobSchedule model

| Field | Default | Description |
| --- | --- | --- |
| `name` | — | Unique; matches `define` name |
| `handlerName` | — | Same as `name` |
| `cron` | — | Standard cron expression |
| `timezone` | `UTC` | IANA zone |
| `enabled` | `true` | Pause via admin API |
| `nextRunAt` | — | Next tick (UTC instant) |

## HTTP routes

Base: `{basePath}` (default `/jobs`). All admin routes require auth + jobs admin permission.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/jobs` | Paginated list (`page`, `limit`, `name`, `status`, `scheduleId`, `start`, `end`, `q`) |
| GET | `/jobs/stats` | Counts by status |
| GET | `/jobs/:id` | Detail |
| POST | `/jobs/:id/retry` | New linked row from `dead` / `failed` |
| POST | `/jobs/:id/requeue` | Reset same row from `dead` / `failed` / `cancelled` |
| POST | `/jobs/:id/cancel` | Cancel `pending` / `running` / `scheduled` |
| GET | `/jobs/schedules` | All schedules |
| POST | `/jobs/schedules/:name/pause` | `enabled: false` |
| POST | `/jobs/schedules/:name/resume` | `enabled: true` |
| POST | `/jobs/execute` | Internal dispatch (`{jobId}`); `executeAuth` required |

List defaults: `limit` 50, max 200. Execute uses 30-minute handler timeout.

### RBAC

When `accessControl` is configured, every jobs admin route checks **both**
`admin:access` and `admin:jobs` (`accessControl.can({permissions: {admin: ["access", "jobs"]}})`).
Default `terrenoStatements.admin` includes both actions. When `accessControl` is omitted,
routes fall back to legacy `user.admin === true`.

### Admin payload redaction

`JobsAdminRedactPayload`:

```typescript
type JobsAdminRedactPayload = (input: {
  name: string;
  payload: unknown;
  payloadRedacted: boolean;
}) => unknown | undefined;
```

**Default (omit hook):** `payload` is not included in admin list/detail JSON.

**Opt-in projection** — return only fields operators need; raw identity passthrough is
discouraged:

```typescript
new JobsApp({
  redactPayload: ({name, payload}) => {
    if (name === "billing/capture") {
      return {invoiceId: (payload as {invoiceId?: string}).invoiceId};
    }
    return undefined; // hide unknown job types
  },
});
```

Return `undefined` to hide payload for a row. `payloadRedacted: true` on the document
always hides payload regardless of the hook.

## Admin frontend widgets

`@terreno/admin-frontend` public exports for jobs:

| Export | Role |
| --- | --- |
| `JOBS_ADMIN_WIDGETS`, `JobsDashboardScreenWidget` | Screen widget map (`jobs` → dashboard) |
| `JOBS_HOME_WIDGETS`, `JobsHomeWidget` | Home widget (`dead` / `running` counts) |
| `JobsDashboardScreen`, `JobsJobDetail` | Full screens (Expo admin routes) |
| `JobsStatusBadge` | Status chip |
| `canCancelJob`, `canRequeueJob`, `canRetryJob`, `formatJobTimestamp`, `jobRowId`, `unwrapJobRow` | Row helpers |
| `JobRow`, `JobAttemptRow`, `JobScheduleRow`, `JobsStats` | Row/types for tables |
| `JobsDashboardFilters`, `parseJobsDashboardSearchParams`, `serializeJobsDashboardSearchParams` | URL filter helpers |

Widgets are registered in the built-in registry — enable via `JobsApp.adminContribution()` only.
The admin shell lists Jobs under **Platform** (not Screens). Hosts still contribute
`name: "jobs"`; do not add a second sidebar link.
Custom screens should pass the app's generated RTK `api` into `AdminProvider`; jobs screens wire
admin HTTP internally (not via a public `useJobsDashboardApi` export).

## GCP Cloud Tasks (`@terreno/jobs/runners/gcpCloudTasks`)

### `GcpCloudTasksRunnerConfig`

| Field | Required | Description |
| --- | --- | --- |
| `project` | yes | GCP project id |
| `location` | yes | Queue region |
| `queue` | yes | Queue name |
| `publicUrl` | yes | Absolute `http(s)` API origin (no trailing slash) |
| `serviceAccountEmail` | yes | OIDC invoker SA |
| `oidcAudience` | no | Defaults to execute URL |
| `basePath` | no | Default `/jobs` |
| `dispatchDeadlineSeconds` | no | Cloud Tasks HTTP wait before retry. Range 15–1800. Default **1800**. The runner sends protobuf `{seconds}` (what `@google-cloud/tasks` expects); REST encodes `"1800s"` so a 30-minute Cloud Run handler is not retried at the 10-minute HTTP default |
| `client` | no | Injected Cloud Tasks client. Required in `bun build --compile` images (REST + `google-auth-library` in the example app). Optional peer `createRequire` fallback for Node. |

Enqueue: `createTask` POST to `{publicUrl}{basePath}/execute`, body `{jobId}` base64,
`dispatchDeadline` `{seconds: 1800}` by default (REST JSON `"1800s"`), `scheduleTime` when
`runAt` is future.
`requiresExecuteRoute: true`.
`start()` ticks due Mongo schedules into `enqueue`; it does not claim job rows.

**Operator responsibility:** implement `executeAuth` to verify the OIDC token (issuer,
audience, SA email). `@terreno/jobs` does not ship a GCP verifier.

## Vercel Queues (`@terreno/jobs/runners/vercelQueues`)

### `VercelQueuesRunnerConfig`

| Field | Default | Description |
| --- | --- | --- |
| `topic` | required | Queue topic name |
| `region` | — | Optional send region |
| `retentionSeconds` | `86400` | Min 60, max 604800 |
| `send` | — | Test seam |

Constants: `VERCEL_QUEUE_MAX_DELAY_SECONDS` = 604800 (7d); visibility retry clamp 30–3600s.

Enqueue: `send(topic, {jobId}, {delaySeconds?, retentionSeconds?, idempotencyKey})`.
`runAt` beyond 7 days throws `VercelQueueRunAtBeyondLimitError`.

`createVercelQueuesConsumer({host, handleCallback?, signal?, visibilityTimeoutSeconds?})` wraps
`@vercel/queue` `handleCallback` → `executeJobById`. `requiresExecuteRoute: false`.

`vercel.json`: `"experimentalTriggers": [{"type": "queue/v2beta", "topic": "<topic>"}]`.

## Environment variables

`@terreno/jobs` uses **explicit constructor options**, not env readers.

| Variable | Read by | Notes |
| --- | --- | --- |
| `JOBS_START_WORKER` | example-backend only | `true`/`false`; unset → `true`. Disable in API when running `jobs:worker`. |
| `JOB_TRACE_LOGS` | app convention | Gates verbose worker logs via `createFeatureFlaggedLogger` (not read by jobs package) |

Legacy `GCP_TASKS_NOTIFICATIONS_QUEUE` / `GCP_TASK_PROCESSOR_QUEUE` appear in example-backend **test** fixtures only — not used by `@terreno/jobs`. Configure Cloud Tasks via `GcpCloudTasksRunner` constructor args.

## Process-local alternatives

| API | Package | Durable | Use |
| --- | --- | --- | --- |
| `cronjob()` | `@terreno/api` | No | In-process recurring timer |
| `wrapScript()` | `@terreno/api` | No | One-shot CLI / script wrapper |
| `JobsApp` | `@terreno/jobs` | Yes | Retries, DLQ, schedules, admin, cloud dispatch |

## Commands (monorepo)

```bash
bun run jobs:compile
bun run jobs:lint
bun run jobs:test
bun run jobs:worker   # example-backend standalone worker
```

## Related

- [Durable background jobs how-to](../how-to/background-jobs.md)
- [API reference — wrapScript / cronjob](api.md#wrapscript)
- [Environment variables](environment-variables.md#background-jobs)
