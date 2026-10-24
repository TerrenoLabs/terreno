# @terreno/api-health e2e tests

Run the api-health smoke after a compile:

```bash
bun run compile && bun run --cwd api-health smoke
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | `HealthApp` options and branches (custom path, `enabled: false`, sync, async, failing, and throwing checks) through supertest (`src/healthApp.test.ts`) | `bun run api-health:test` |
| Smoke | The compiled plugin answering health checks from a real server in a child process | `bun run --cwd api-health smoke` |
| E2E | The plugin as example-backend registers it, with a MongoDB check. Client smokes that start example-backend (`spawnExampleBackend`) wait on its `/health`, and example-frontend's Playwright suite runs against that backend | `bun run frontend:e2e` |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`api-health/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/api-health/e2e/smoke.ts)
runs at the `http` layer. It re-runs itself with a `serve` argument to start a child process
that imports the compiled `@terreno/api-health` by package name, registers `HealthApp` on a
plain Express app the way `TerrenoApp.register` does, and listens on a `freePort()`. It
registers the plugin twice: once with defaults, and once at `/health/down` with a `check` that
reports a dependency down. The parent waits for `/health` with `spawnUntilReady`, then checks
over real HTTP:

1. `GET /health` returns 200 with `{healthy: true}`.
2. `GET /health/down` returns 503 with `healthy: false` and the check's `details`.

The 503 is part of the happy path for this plugin: it is the status load balancers and Cloud
Run probes act on. It prints one `✅` line per check and exits 1 on the first failure, after
printing the server's output. A compiled plugin patched to always answer 200 fails check 2. A
default route that stops answering 2xx shows up as a `spawnUntilReady` timeout, not as check 1.

The smoke uses no `TerrenoApp`, so it needs no user model, MongoDB, or secrets. That also keeps
it free of dependencies api-health does not already declare.

**Measured time:** about 8 s on an idle machine and 11–20 s under load, excluding the compile.
Most of it is loading `@terreno/test`; the checks themselves take about 2 s. Budget: 30 s.

## Add an e2e test

- **New option or branch:** add a unit test in `api-health/src/healthApp.test.ts`. The smoke
  stays one happy path; do not add edge cases to it.
- **The wire contract changed** (the status codes or the `{healthy, details}` body): update the
  checks in `api-health/e2e/smoke.ts` and keep it within 30 s.
- **A user-visible flow** (for example, an app screen that reports service health): add a
  Playwright spec in `example-frontend/e2e/`, following
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec), with the plugin wired into
  example-backend.

See [the `@terreno/api-health` reference](../../reference/api-health.md) for the plugin API and
[the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the smoke helpers.
