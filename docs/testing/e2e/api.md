# @terreno/api e2e tests

Run the api smoke after a compile:

```bash
bun run compile && bun run --cwd api smoke
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | `modelRouter`, permissions, auth, sync, and plugins through supertest against in-memory Mongo (`src/**/*.test.ts`) | `bun run api:test` (`bun run --cwd api test:coverage` adds the 95% gate) |
| Smoke | The compiled package serving real HTTP from a child process | `bun run --cwd api smoke` |
| E2E | api behavior seen by a user, through example-frontend's Playwright suite against example-backend | `bun run frontend:e2e` |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`api/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/api/e2e/smoke.ts) runs
at the `http` layer. It re-runs itself with a `serve` argument to start a child process that
imports the compiled `@terreno/api`, builds a `TerrenoApp` with a passport-local user model,
one owner-scoped `modelRouter` model (`/widgets`), and an inline `/health` plugin, and listens
on a `freePort()` against `smokeMongoUri()`. The parent waits for `/health` with
`spawnUntilReady`, then checks over real HTTP:

1. `GET /health` returns `{healthy: true}`.
2. `POST /auth/signup` returns a token.
3. `POST /widgets` with that token returns 201 and a widget owned by the new user.
4. `GET /widgets` lists the widget.

It prints one `✅` line per check and exits 1 on the first failure, after printing the
server's output. The health route is inline because `@terreno/api-health` depends on
`@terreno/api`.

**Measured time:** 13 s on an idle machine and 16–26 s under load, excluding the compile.
Budget: 30 s.

## Add an e2e test

- **New route or option behavior:** add a unit test in `api/src/`. The smoke stays one happy
  path; do not add edge cases to it.
- **The smoke's happy path changed** (for example, signup or the list response shape): update
  the checks in `api/e2e/smoke.ts` and keep it within 30 s.
- **A user-visible flow:** add a Playwright spec in `example-frontend/e2e/`, following
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec), with the route wired into
  example-backend.
