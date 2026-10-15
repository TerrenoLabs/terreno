# Tasks: Durable background jobs

IP: [job-queues.md](../implementationPlans/job-queues.md)  
**Closes:** https://github.com/TerrenoLabs/terreno/issues/1188

**Feature profile:** false (full IP)

## Phase 1 — Tracer (package, enqueue, Mongo worker)

- [x] **Task 1.1**: Scaffold `@terreno/jobs`
  - Delivers: workspace package compiles and lints; root `jobs:compile` / `jobs:test` / `jobs:lint` scripts; empty `JobsApp` registers as `TerrenoPlugin` without starting a worker
  - Files: `jobs/package.json`, `jobs/tsconfig.json`, `jobs/src/index.ts`, `jobs/src/jobsApp.ts`, root `package.json`
  - Blocked by: none
  - Skills: `terreno-backend-api`
  - Docs: none (Phase 5)
  - Acceptance: `bun run jobs:compile` and `bun run jobs:lint` pass; `new TerrenoApp().register(new JobsApp())` boots in a bun test

- [x] **Task 1.2**: `Job` model + `define` / `enqueue` + Mongo claim
  - Delivers: five-type `Job` model; `jobs.define(name, {handler})`; `getJobsService().enqueue({name, payload})` inserts `pending`; `MongoJobRunner` claims with `findOneAndUpdate`; handler runs inside `runWithRequestContext({jobId})`; unknown `name` throws `APIError` 400
  - Files: `jobs/src/models/job.ts`, `jobs/src/modelTypes.ts`, `jobs/src/jobsService.ts`, `jobs/src/runners/mongoRunner.ts`, tests
  - Blocked by: 1.1
  - Skills: `mongoose-schema-safety`, `backend-test-env`, `terreno-backend-api`
  - Docs: stub one sentence in `docs/reference/jobs.md` if the file exists; else wait for 5.1
  - Acceptance: bun test — enqueue then `startWorker` completes the job; missing handler fails loud; every schema field has `description`

- [x] **Task 1.3**: Explicit `startWorker` in-process and lock reclaim
  - Delivers: `JobsApp.register` does **not** poll; `startWorker()` starts the runner; `stopWorker()` aborts; expired `lockedAt` reclaims `running`; two workers claim one job once
  - Files: `jobs/src/jobsApp.ts`, `jobs/src/runners/mongoRunner.ts`, tests
  - Blocked by: 1.2
  - Skills: `terreno-backend-api`
  - Docs: none (5.1)
  - Acceptance: bun test — no worker until `startWorker`; kill-the-process simulation: leave `pending`, new worker runs it; dual-worker claim uniqueness

## Phase 2 — Retries, DLQ, delay, cron

- [x] **Task 2.1**: Attempts, backoff, `dead`
  - Delivers: throw → `attemptCount++`, `attempts[]`, `runAt` backoff with jitter; at `maxAttempts` → `status: "dead"`; success → `completed`; `ctx.signal` abort on cancel
  - Files: `jobs/src/jobsService.ts`, retry helper, tests
  - Blocked by: 1.3
  - Skills: `terreno-backend-api`
  - Docs: none (5.1)
  - Acceptance: bun test — three failures with `maxAttempts: 3` land `dead`; between attempts status is `pending` with future `runAt`; Luxon used for delay math

- [x] **Task 2.2**: Delayed `runAt` + `idempotencyKey`
  - Delivers: `enqueue({runAt})` not claimed before `runAt`; duplicate `(name, idempotencyKey)` returns the existing job and does not insert a second row
  - Files: `jobs/src/jobsService.ts`, Job indexes, tests
  - Blocked by: 1.2
  - Skills: `mongoose-schema-safety`
  - Docs: none (5.1)
  - Acceptance: bun test — frozen clock (Luxon); unique index violation path covered

- [x] **Task 2.3**: `JobSchedule` + recurring cron + IANA timezone
  - Delivers: `define(..., {schedule: {cron, timezone}})`; upsert `JobSchedule`; tick enqueues a child `Job`; skip tick if a child is still `running`/`pending` for that schedule; invalid cron fails at define/start
  - Files: `jobs/src/models/jobSchedule.ts`, scheduler, tests
  - Blocked by: 1.3
  - Skills: `mongoose-schema-safety`, `terreno-backend-api`
  - Docs: none (5.1)
  - Acceptance: bun test — `America/New_York` vs `UTC` next-run; overlap skip; default timezone `UTC`

## Phase 3 — Runners and execute HTTP

- [x] **Task 3.1**: `JobRunner` interface + custom runner
  - Delivers: injected `runner` used on enqueue/start; test fake runner records `enqueue` calls; Mongo remains default
  - Files: `jobs/src/types.ts`, `jobs/src/runners/custom.ts` (or types-only), tests
  - Blocked by: 1.2
  - Skills: `terreno-backend-api`
  - Docs: none (5.1)
  - Acceptance: bun test — custom runner `enqueue` called once per job; Mongo runner tests still pass

- [x] **Task 3.2**: `POST /jobs/execute` auth gate
  - Delivers: route mounted when `mountExecuteRoute` or cloud runner; body `{jobId}`; loads/claims/runs; unsigned 401; terminal completed → 200 no-op; live lock → 409
  - Files: `jobs/src/routes/jobsExecute.ts`, tests
  - Blocked by: 1.3
  - Skills: `terreno-backend-api`, `backend-test-env`
  - Docs: none (5.1)
  - Acceptance: bun + supertest; path can be omitted from SDK codegen (internal tag); rate-limit not skipped

- [x] **Task 3.3**: GCP Cloud Tasks adapter (mocked)
  - Delivers: `@terreno/jobs/runners/gcpCloudTasks` optional peer `@google-cloud/tasks`; `enqueue` creates HTTP task to `{publicUrl}/jobs/execute` with OIDC audience; no live GCP
  - Files: `jobs/src/runners/gcpCloudTasks.ts`, tests with fake client, `jobs/package.json` exports/peers
  - Blocked by: 3.1, 3.2
  - Skills: `terreno-backend-api`
  - Docs: env names listed in 5.1
  - Acceptance: bun test — fake client receives queue/url/oidc; missing config fails startup loud

- [x] **Task 3.4**: Vercel Queues adapter (mocked)
  - Delivers: `@terreno/jobs/runners/vercelQueues` optional peer; `send(topic,{jobId})` with retention/delay coupling; private `handleCallback` consumer → `executeJobById`; no Workflows API; no live Vercel
  - Files: `jobs/src/runners/vercelQueues.ts`, tests
  - Blocked by: 3.1, 3.2
  - Skills: `terreno-backend-api`
  - Docs: 5.1
  - Acceptance: bun test — fake queue publish/send options, consumer retry directives, >7d dispatch compensation; platform auth delegated to vendor `handleCallback`

## Phase 4 — Admin API and UI

- [x] **Task 4.1**: Admin HTTP + `admin:jobs`
  - Delivers: list/detail/retry/requeue/cancel + schedule pause/resume; `terrenoStatements.admin` includes `jobs`; 403 without permission; retry creates linked row; requeue from `dead`
  - Files: `jobs/src/routes/jobsAdmin.ts`, `api/src/rbac/statements.ts`, RBAC tests in jobs package, example-backend OpenAPI if needed
  - Blocked by: 2.1, 2.3
  - Skills: `terreno-backend-api`
  - Docs: none (5.1)
  - Acceptance: bun + supertest for 200/403/401; retry vs requeue semantics per IP

- [x] **Task 4.2**: Admin frontend Jobs screens
  - Delivers: `JOBS_ADMIN_WIDGETS`, `JobsDashboardScreen`, `JobsJobDetail`, home widget `jobs`; built-in registry (no host remap)
  - Files: `admin-frontend/src/jobs/*`, widget registry, tests + isolated specs
  - Blocked by: 4.1
  - Skills: `building-admin-interfaces`, `terreno-ui`, `terreno-data-fetching`
  - Docs: `docs/how-to/admin-import-prebuilt.md` in 5.1
  - Acceptance: bun tests for render/filter/actions; no `fetch`/`axios`; no syncdb

- [x] **Task 4.3**: example-backend + example-frontend + admin-spa + UI verify
  - Delivers: example registers `JobsApp` + Mongo runner; demo job; optional `jobs:worker` script; routes `/admin/jobs`; admin-spa `/jobs`; SDK regen if OpenAPI changed; `JOBS_START_WORKER` gates API-process worker (default true)
  - Files: `example-backend/src/server.ts`, worker entry, `example-frontend/app/admin/**`, `admin-spa/app/**`, `store/openApiSdk.ts` (generated)
  - Blocked by: 4.2, 1.3
  - Skills: `building-admin-interfaces`, `verify-ui-changes`, `generate-sdk`
  - Docs: none (5.1)
  - Acceptance: `verify-ui-changes` — `/opt/cursor/artifacts/jobs_admin_dlq_workflow.mp4` (script→dead attempts→requeue execution→retry linked row); `/opt/cursor/artifacts/jobs_admin_cancel_scheduled_job.mp4` (scheduled cancel confirmation, refresh persistence, no attempts); worker script documented

## Phase 5 — Docs, CI, publish

- [x] **Task 5.1**: Diátaxis + agent docs + changelog + seed
  - Delivers: how-to, reference, api.md cron contrast, env table, import-prebuilt, seed IP/task URLs, jobs rule, backend-api skill mention, unreleased changelog, `bun run rules` / `skills:sync`
  - Files: `docs/how-to/background-jobs.md`, `docs/reference/jobs.md`, `docs/how-to/README.md`, `docs/reference/api.md`, `docs/reference/environment-variables.md`, `docs/how-to/admin-import-prebuilt.md`, `docs/explanation/roadmap-seed-issues.md`, `.rulesync/rules/jobs/00-jobs.md`, `plugins/terreno-planning/skills/terreno-backend-api/SKILL.md`, `changelog/unreleased/job-queues.md`
  - Blocked by: 3.4, 4.3
  - Skills: `update-docs`, `update-agent-docs`
  - Docs: (this task)
  - Acceptance: stranger can define, enqueue, run a worker, and choose Mongo vs GCP vs Vercel from the how-to; `bun run website:build`; `cronjob()` still documented as process-local

- [x] **Task 5.2**: CI + publish wiring
  - Delivers: `jobs-ci.yml`; `publish-on-tag` for `@terreno/jobs`; `cd.yml` path filter includes `jobs/**`
  - Files: `.github/workflows/*`
  - Blocked by: 1.1
  - Skills: none
  - Docs: none
  - Acceptance: workflow validates required secrets if any; package listed in publish job graph

- [x] **Task 5.3**: Positioning row (when Complete)
  - Delivers: `docs/explanation/positioning.md` Celery/ActiveJob cell updated only when IP header is **Complete**
  - Files: `docs/explanation/positioning.md`
  - Blocked by: 5.1 and all prior acceptance criteria
  - Skills: `update-docs`
  - Docs: positioning
  - Acceptance: row no longer says Not shipped
