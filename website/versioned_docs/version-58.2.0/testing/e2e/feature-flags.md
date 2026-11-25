# @terreno/feature-flags e2e tests

Run the feature-flags smoke after a compile:

```bash
bun run compile && bun run --cwd feature-flags smoke   # or, from the root: bun run smoke feature-flags
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | Flag evaluation, rules and segments, the model's save hooks, the OpenFeature provider, live updates, and every `FeatureFlagsApp` route through supertest against in-memory Mongo (`src/**/*.test.ts`) | `bun run --cwd feature-flags test` |
| Smoke | The compiled package mounted in a real `TerrenoApp`, serving real HTTP from a child process | `bun run --cwd feature-flags smoke` |
| E2E | Flags seen by a user, through example-frontend's Playwright suite against example-backend | `bun run frontend:e2e` |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`feature-flags/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/feature-flags/e2e/smoke.ts)
runs at the `http` layer. It re-runs itself with a `serve` argument to start a child process that
imports the compiled `@terreno/api` and `@terreno/feature-flags`, builds a `TerrenoApp` with a
passport-local user model, `new FeatureFlagsApp()` with its default admin-only flag permissions,
and an inline `/health` plugin, then seeds one admin user and listens on a `freePort()` against
`smokeMongoUri()`. The parent waits for `/health` with `spawnUntilReady`, then checks over real
HTTP:

1. A user who signs up through `POST /auth/signup` is refused by `POST /feature-flags/flags`
   (405, modelRouter's permission-denied status), so the default admin-only permission holds.
2. The seeded admin logs in through `POST /auth/login` and creates an enabled boolean flag at
   100% rollout with `POST /feature-flags/flags` (201).
3. The same user's `GET /feature-flags/flagConfiguration` now resolves that flag to `on`
   (`defaultVariant: "on"`, `disabled: false`).

The flag key and both emails carry the run's timestamp, so repeated runs against the shared CI
Mongo do not collide. It prints one `✅` line per check and exits 1 on the first failure, after
printing the server's output. The health route is inline because `@terreno/api-health` is not a
dependency of this package.

**Measured time:** 9–10 s against a running replica-set Mongo (`TERRENO_TEST_MONGODB_URI`),
excluding the compile. In a slow-I/O sandbox, importing the compiled `@terreno/api` alone took
about 18 s, which pushed some runs past the child's 20 s readiness window (the api smoke fails
the same way there). Budget: 30 s.

## Add an e2e test

- **New flag behavior** (a rule operator, a segment, the variant wire shape): add a unit test in
  `feature-flags/src/tests/`. The smoke stays one happy path; do not add edge cases to it.
- **The smoke's happy path changed** (for example, the `/flagConfiguration` response shape or the
  default permissions): update the checks in `feature-flags/e2e/smoke.ts` and keep it within 30 s.
- **A user-visible flag flow** (a screen gated by a flag): add a Playwright spec in
  `example-frontend/e2e/`, following
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec). example-backend already
  registers `FeatureFlagsApp`.
