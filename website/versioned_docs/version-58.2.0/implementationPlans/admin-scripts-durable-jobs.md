# Implementation Plan: Admin scripts via durable jobs

**Status:** Complete
**Roadmap:** Area=`admin`, Target=`Released`, Impact=`Improvement`  
**Branch:** `cursor/scripts-via-durable-jobs-803d`
**Task list:** [admin-scripts-durable-jobs.md](../tasks/admin-scripts-durable-jobs.md)
**Depends on:** [job-queues.md](job-queues.md)

## Goal

Admin HTTP script runs (`POST /admin/scripts/:name/run`) enqueue `@terreno/jobs` job
`admin/script` when `JobsApp` is registered, while the Scripts UI keeps polling
`BackgroundTask` by `taskId`.

## Non-Goals

- Deleting `BackgroundTask` or merging Scripts and Jobs screens
- Routing `runScriptCli` through the queue
- Executing `POST /admin/background-tasks` kinds
- Moving comms/webhooks/billing onto jobs
- Requiring scripts to be idempotent (use `maxAttempts: 1`)

## Decisions

| Question | Decision |
|----------|----------|
| Job name | `admin/script` |
| Payload | `{scriptName, taskId, wetRun, args, createdByName?}` |
| Retry | `maxAttempts: 1` |
| UI | Unchanged poll/cancel on `BackgroundTask` |
| Fallback | No `JobsApp` → existing in-process runner |
| Worker | Same script catalog via `defineAdminScriptJob` |
| Cloud Tasks | Inherited from `JobsApp` runner; execute process must load scripts |
| GCP topology | Infra Manager queue pushes OIDC callbacks to a private Cloud Run tasks service |
| Execution pool | Cloud Tasks rate limits + Cloud Run service instances; not Cloud Run worker pools (no HTTP ingress) |
| PR isolation | Shared queue, per-PR tasks-service tag callback, and per-PR Mongo database |

## Acceptance

- With `JobsApp` + worker, run creates a `Job` and completes the `BackgroundTask`
- Without `JobsApp`, existing admin-backend script tests still pass
- Cancel marks `BackgroundTask` cancelled and cancels the job when present
- Example worker defines `admin/script`
- Deployed example backend selects `GcpCloudTasksRunner` and rejects unverified callbacks
- Concurrent PR previews target only their matching tasks-service tag and database
