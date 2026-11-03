# example-backend e2e tests

Run the example-backend smoke after a compile:

```bash
bun run compile && bun run --cwd example-backend smoke   # or, from the root: bun run smoke example-backend
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | Routes, models, permissions, seeds, migrations, jobs, websockets, and server wiring, in-process with supertest against the in-memory Mongo from `@terreno/test` (`src/**/*.test.ts`) | `bun run --cwd example-backend test` |
| Smoke | `src/index.ts` as a real process: boot, `/health`, and the sign-in of a user the seed script's `users` step creates | `bun run --cwd example-backend smoke` |
| E2E | User flows through example-frontend's Playwright suite and the Maestro flows against this backend | `bun run frontend:e2e`, `bun run maestro:test` |
| Manual regression | Cases in `docs/regression/` | none |

The client smokes (rtk, syncdb, admin-frontend) also boot this backend with
`spawnExampleBackend()`, so a backend that stops booting fails them too. This smoke is the one
that names the backend as the cause.

## The smoke

[`example-backend/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/example-backend/e2e/smoke.ts)
runs at the `http` layer. It uses its own database from `smokeMongoUri()`,
`exampleBackendSmoke`. When `TERRENO_TEST_MONGODB_URI` points at a persistent replica set, as in
CI and the runs below, that database outlives the run the way rtk's and syncdb's do, so later
boots skip example-backend's first-boot work. Without it, `smokeMongoUri()` starts an in-memory
replica set that is empty every run. Then:

1. Starts `src/index.ts` as a child process with `spawnExampleBackend()` on a free port, with
   `SEED_DEFAULTS=false` so the server does not seed users on boot. Better Auth is the
   backend's default provider. While the server boots, the smoke process loads the seed script
   (`src/scripts/seed-test-data.ts`), connects it to the same database, and deletes the users
   and Better Auth accounts an earlier run left behind.
2. Checks that `GET /health` answers 200 with `healthy: true`.
3. Checks that `POST /api/auth/sign-in/email` for `test@example.com` answers 401. The user
   collections are empty and boot seeding is off, so nothing but the next step can create that
   user.
4. Runs the seed script's `users` step in the smoke process with `runSeeds({only: ["users"]})`,
   which is what `bun run seed --only users` runs, against the same `MONGO_URI` and
   `BETTER_AUTH_URL` as the server. The organizations, todos, AI, and EHR demo data are skipped.
5. Checks that `POST /api/auth/sign-in/email` now signs in `test@example.com` with its
   published dev password and returns a session token for that user.
6. Checks that `GET /auth/me` with `Authorization: Bearer <token>` returns `test@example.com`
   in `data.email`. This proves the seed linked the Better Auth account to the app's `User`
   document.

The seed runs in the smoke process rather than as a second `bun` process because the seed
script loads most of the backend's modules: a second process paid that load again, after the
server was up. Loading it in the smoke process overlaps it with the server's boot.

Each check prints one `✅` line. The smoke exits 1 on the first failure, and a failed check
prints the backend's output. A seed step that returns without writing the user fails check 5.

**Measured time:** excluding the compile, against a single-node replica set on the same 4-CPU
container (`TERRENO_TEST_MONGODB_URI`):

- 15–18 s across four runs on their own once the database exists, and 16–20 s inside three
  root `bun run smoke` runs.
- 27 s for the first run on an empty database. On that first boot, example-backend builds its
  indexes, runs its migrations, and syncs its consent forms.
- 60–98 s for the previous smoke on the same replica set. It made a new database every run and
  ran the seed as a second process.

Without `TERRENO_TEST_MONGODB_URI`, the in-memory replica set is empty every run, so two runs
took 24 and 38 s. CI's `smoke` job sets the variable to its Mongo sidecar, which starts empty.
Every smoke that boots example-backend uses its own database (`exampleBackendSmoke`,
`rtkSmoke`, `syncdbSmoke`, `adminFrontendSmoke`, `exampleFrontendSmoke`), so on CI each of them
pays the empty-database first boot (about 27 s here), not the warm times above. The CircleCI
`smoke` job's per-package times are the ones that judge the budget. Budget: 30 s.

## Add an e2e test

- **New route, model, permission, or seed step:** add a unit or integration test next to it in
  `example-backend/src/`. The smoke stays one happy path; do not add edge cases to it.
- **The boot path, health check, seed users, or sign-in changed** (for example a new required
  env var, a different default auth provider, or a renamed seed user): update the checks in
  `example-backend/e2e/smoke.ts`, and `spawnExampleBackend()` in `@terreno/test` when every
  client smoke needs the change.
- **A user-visible flow:** add a Playwright spec in `example-frontend/e2e/`, following
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec).

See [the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for `freePort()`,
`smokeMongoUri()`, and `spawnExampleBackend()`.
