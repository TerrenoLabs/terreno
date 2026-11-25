# @terreno/admin-backend e2e tests

Run the admin-backend smoke after a compile:

```bash
bun run compile && bun run --cwd admin-backend smoke   # or, from the root: bun run smoke admin-backend
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | `/admin/config` metadata, admin CRUD, row scope, text search, list filters, bulk actions, migrations, scripts, sync meta, document storage, and the HTTP goldens through supertest against in-memory Mongo (`src/**/*.test.ts`) | `bun run --cwd admin-backend test` |
| Smoke | The compiled `AdminApp` mounted in a real `TerrenoApp`, serving real HTTP from a child process | `bun run --cwd admin-backend smoke` |
| E2E | The admin panel in Chromium (home, tables, forms, search, bulk actions, custom screens) through example-frontend's `admin-*.spec.ts` Playwright suite against example-backend | `bun run frontend:e2e` |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`admin-backend/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/admin-backend/e2e/smoke.ts)
runs at the `http` layer. It re-runs itself with a `serve` argument to start a child process
that imports the compiled `@terreno/api` and `@terreno/admin-backend` by package name. The
child builds a `TerrenoApp` with a passport-local user model, one `Widget` model registered
through `modelRouter("/widgets", Widget, {admin: {...}})`, `new AdminApp({})`, and an inline
`/health` plugin. It seeds one admin user and one widget, then listens on a `freePort()` against
`smokeMongoUri()`. The parent waits for `/health` with `spawnUntilReady`, then checks over real
HTTP:

1. The seeded admin logs in through `POST /auth/login`.
2. `GET /admin/config` returns the Widget model, found by its `displayName`.
3. `GET` on that model's `routePath` (`/admin/widgets`) lists the seeded widget.
4. A user who signs up through `POST /auth/signup` gets 403 from `GET /admin/config`.
5. The same user gets 405 from `GET /admin/widgets`, modelRouter's permission-denied status.

It prints one `✅` line per check and exits 1 on the first failure, after printing the
server's output. The model uses the `modelRouter` `admin:` option rather than the legacy
`AdminApp.models` list, so the smoke also proves that `AdminApp` discovers models registered on
the app. The admin is seeded straight into MongoDB because signup never grants admin. Each run
uses new emails and a new widget name, so reruns against a shared `TERRENO_TEST_MONGODB_URI`
never collide.

Signup logs a `publicAppUrl is required to send verification mail` error in the server
output. The smoke app does not configure email, and signup still returns 200.

**Measured time:** 8–24 s against an external replica set (passing runs took 7.6, 20.7 and
23.6 s), excluding the compile. Most of it is loading the compiled packages in the child, which
alone takes about 6 s. In a container shared with parallel builds and test suites, three other
runs missed the 30 s readiness timeout before the child answered `/health`. The in-memory
replica set added about two minutes on that loaded container and then timed out. Budget: 30 s.

If the in-memory replica set times out waiting for a primary, point the smoke at a running
replica set the way CI does:

```bash
TERRENO_TEST_MONGODB_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0" bun run --cwd admin-backend smoke
```

## Add an e2e test

- **New config field, route, filter, or permission rule:** add a test in
  `admin-backend/src/`. The smoke stays one happy path; do not add edge cases to it.
- **The admin read path changed** (for example, the `/admin/config` response shape, the model
  `routePath` scheme, or how `AdminApp` discovers `modelRouter` models): update the checks in
  `admin-backend/e2e/smoke.ts` and keep it within 30 s.
- **A user-visible admin flow:** add a Playwright spec next to the `admin-*.spec.ts` files in
  `example-frontend/e2e/`, following [Write a Playwright spec](../e2e.md#write-a-playwright-spec),
  against example-backend, which already registers `AdminApp`.

See [the admin-backend reference](../../reference/admin-backend.md) for the plugin API,
[Add a model to the admin](../../how-to/admin-add-model.md) for the `admin:` option, and
[the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the smoke helpers.
