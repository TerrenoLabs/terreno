# @terreno/jobs e2e tests

Run the jobs smoke after a compile:

```bash
bun run compile && bun run --cwd jobs smoke   # or, from the root: bun run smoke jobs
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | The `Job` and `JobSchedule` models, enqueue with delay and idempotency keys, claim leases, retries and backoff, cron schedules, worker start and stop, the GCP Cloud Tasks and Vercel Queues runners through injected client seams, and every admin and execute route through supertest against in-memory Mongo (`src/tests/*.test.ts`) | `bun run --cwd jobs test` |
| Smoke | A job enqueued by one process and completed by the compiled `MongoJobRunner` in a separate worker process | `bun run --cwd jobs smoke` |
| E2E | None yet. example-backend registers `JobsApp` and runs a worker in the API process or through `bun run jobs:worker`; its unit tests cover that wiring | none |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`jobs/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/jobs/e2e/smoke.ts)
runs at the `http` layer: it waits on the worker's health URL, then checks job state in Mongo,
because a worker has no API to call. It re-runs itself with a `worker` argument to start a child
process shaped like a dedicated jobs entrypoint: it imports the compiled `@terreno/jobs`,
connects to `smokeMongoUri()`, defines a handler that records the job id and its own pid in a
`jobsSmokeRuns` collection, and calls `startWorker()` with the default `MongoJobRunner` polling
every 100 ms. Once the poll loop is running it answers `/health` with 200 (503 while the worker is inactive) on a `freePort()`, and SIGTERM
stops the worker before the process exits. The parent waits for `/health` with
`spawnUntilReady`, then acts as the enqueuing process:

1. It registers its own `JobsApp` with the same job name (on a bare Express app, which mounts
   the admin routes and makes `getJobsService()` available), never starts a worker, and
   enqueues one job with a run id in the payload. The job is stored as `pending`. Its handler
   throws, as a backstop: the parent never polls, so it never claims the job.
2. Within 15 s the job's status becomes `completed`.
3. The handler ran exactly once, in the worker's pid, with the enqueued run id. This check is
   the proof that the job crossed processes.

Each check prints one `✅` line. The smoke exits 1 on the first failure, after printing the
worker's output. Rows are looked up by job id, so runs one after another against the shared CI
Mongo do not collide. Two runs at once against the same Mongo could claim each other's jobs and
fail the pid check; `bun run smoke` runs smokes one at a time.

**Measured time:** 8–13 s against a running replica-set Mongo (`TERRENO_TEST_MONGODB_URI`),
excluding the compile. Most of it is the worker importing the compiled `@terreno/api` (about
4 s here) and the pollers settling. Without `TERRENO_TEST_MONGODB_URI`, starting the in-memory
replica set took several minutes in a slow-I/O sandbox, and under heavy load the worker can miss
its 20 s readiness window, the same as the other server smokes. Budget: 30 s.

## Add an e2e test

- **New jobs behavior** (a runner, a retry rule, a schedule option, an admin route): add a unit
  test in `jobs/src/tests/`. The smoke stays one happy path; do not add edge cases to it.
- **The smoke's happy path changed** (for example, `startWorker()` or the default runner's
  claim flow): update the checks in `jobs/e2e/smoke.ts` and keep it within 30 s.
- **A user-visible jobs flow** (the admin Jobs dashboard: list, retry, requeue, cancel): add a
  Playwright spec in `example-frontend/e2e/`, following
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec). example-backend already
  registers `JobsApp` and contributes the admin Jobs screen.
