# example-backend e2e tests

Run the example-backend smoke after a compile:

```bash
bun run compile && bun run --cwd example-backend smoke   # or, from the root: bun run smoke example-backend
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | Routes, models, permissions, seeds, migrations, jobs, websockets, and server wiring, in-process with supertest against the in-memory Mongo from `@terreno/test` (`src/**/*.test.ts`) | `bun run --cwd example-backend test` |
| Smoke | The seed script and `src/index.ts` as real processes: boot, `/health`, and a seeded user's sign-in | `bun run --cwd example-backend smoke` |
| E2E | User flows through example-frontend's Playwright suite and the Maestro flows against this backend | `bun run frontend:e2e`, `bun run maestro:test` |
| Manual regression | Cases in `docs/regression/` | none |

The client smokes (rtk, syncdb, admin-frontend) also boot this backend with
`spawnExampleBackend()`, so a backend that stops booting fails them too. This smoke is the one
that names the backend as the cause.

## The smoke

[`example-backend/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/example-backend/e2e/smoke.ts)
runs at the `http` layer. It gets a fresh database from `smokeMongoUri()` (named
`exampleBackendSmoke<timestamp>`, one per run), then:

1. Starts `src/index.ts` as a child process with `spawnExampleBackend()` on a free port, with
   `SEED_DEFAULTS=false` so the server does not seed users on boot. Better Auth is the
   backend's default provider.
2. Checks that `GET /health` answers 200 with `healthy: true`.
3. Checks that `POST /api/auth/sign-in/email` for `test@example.com` answers 401. The database
   is new and boot seeding is off, so nothing but the next step can create that user.
4. Runs the seed script, `src/scripts/seed-test-data.ts --only users`, as a child process with
   `runBin`, the way `bun run seed` does, against the same `MONGO_URI` and `BETTER_AUTH_URL`.
   Only the `users` step runs, so the smoke skips the organizations, todos, AI, and EHR demo
   data.
5. Checks that `POST /api/auth/sign-in/email` now signs in `test@example.com` with its
   published dev password and returns a session token for that user.
6. Checks that `GET /auth/me` with `Authorization: Bearer <token>` returns `test@example.com`
   in `data.email`. This proves the seed linked the Better Auth account to the app's `User`
   document.

Each check prints one `✅` line. The smoke exits 1 on the first failure: a failed seed prints the
script's stdout and stderr, and a failed check prints the backend's output. A seed script that
exits 0 without writing the user fails check 5.

**Measured time:** 47–62 s against a running replica-set Mongo (`TERRENO_TEST_MONGODB_URI`),
excluding the compile, on an idle machine: 18–54 s for `src/index.ts` to answer `/health` (the
fresh database means every run does example-backend's first-boot startup work), about 20 s for
the seed process (mostly loading the seed script's imports), under 1 s for the checks, and about
5 s to stop the backend. Readiness and the seed each get 120 s. With other builds saturating
the CPU, one run passed in 122 s and others failed on readiness after 120 s. Budget: 30 s. The smoke
goes over it, and the overage is the backend boot and the seed process, not the checks.

## Add an e2e test

- **New route, model, permission, or seed step:** add a unit or integration test next to it in
  `example-backend/src/`. The smoke stays one happy path; do not add edge cases to it.
- **The boot path, health check, seed users, or sign-in changed** (for example a new required
  env var, a different default auth provider, or a renamed seed user): update the checks in
  `example-backend/e2e/smoke.ts`, and `spawnExampleBackend()` in `@terreno/test` when every
  client smoke needs the change.
- **A user-visible flow:** add a Playwright spec in `example-frontend/e2e/`, following
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec).

See [the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for `runBin`,
`smokeMongoUri()`, and `spawnExampleBackend()`.
