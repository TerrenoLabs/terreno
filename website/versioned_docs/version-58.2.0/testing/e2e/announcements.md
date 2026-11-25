# @terreno/announcements e2e tests

Run the announcements smoke after a compile:

```bash
bun run compile && bun run --cwd announcements smoke
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | Pending and feed selection, audience and platform rules, acknowledgements, impressions, clicks, release import, the admin overview, and help routes through supertest (`src/tests/*.test.ts`) | `bun run --cwd announcements test` |
| Smoke | The compiled plugin publishing an announcement and serving it to a signed-in user from a real server in a child process | `bun run --cwd announcements smoke` |
| E2E | None yet. example-frontend has no Playwright spec for announcements | none |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`announcements/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/announcements/e2e/smoke.ts)
runs at the `http` layer. It re-runs itself with a `serve` argument to start a child process
that imports the compiled `@terreno/api` and `@terreno/announcements` by package name. The
child builds a `TerrenoApp` with a passport-local user model, an inline `/health` plugin, and
`AnnouncementsApp` with an `uploadToken`, and listens on a `freePort()` against
`smokeMongoUri()`. The parent waits for `/health` with `spawnUntilReady`, then checks over
real HTTP:

1. `POST /announcements/import-release` with the upload token and `publish: true` returns one
   published announcement.
2. `POST /auth/signup` returns a token for a new, non-admin user.
3. `GET /announcements/feed` with that token lists the announcement with its title.

It prints one `✅` line per check and exits 1 on the first failure, after printing the
server's output. The announcement is created through release import, the route release
pipelines call, because signup never grants admin. Creating it through the admin CRUD routes
would mean seeding an admin straight into MongoDB. Each run imports under a new release
version, so reruns against a shared `TERRENO_TEST_MONGODB_URI` never collide.

**Measured time:** 4.5–8 s in three root `bun run smoke` runs (the [guide's](../e2e.md#package-pages) figure), excluding the compile. Earlier single runs took
21–24 s on a quiet 4-CPU container against an external replica set, and 40–100 s when parallel builds starved the CPU, excluding the compile. Most of it is loading
the compiled packages in the child; under load, password hashing on signup alone took 17 s.
Budget: 30 s.

If the in-memory replica set times out waiting for a primary, point the smoke at a running
replica set the way CI does:

```bash
TERRENO_TEST_MONGODB_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0" bun run --cwd announcements smoke
```

## Add an e2e test

- **New route, option, or visibility rule:** add a test in `announcements/src/tests/`. The
  smoke stays one happy path; do not add edge cases to it.
- **The publish-to-feed path changed** (for example, the import body or the feed response
  shape): update the checks in `announcements/e2e/smoke.ts` and keep it within 30 s.
- **A user-visible flow** (for example, the announcement modal or the changelog feed): add a
  Playwright spec in `example-frontend/e2e/`, following
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec), against example-backend, which
  already registers the plugin.

See [the announcements reference](../../reference/announcements.md) for the plugin API and
[the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the smoke helpers.
