# @terreno/admin-frontend e2e tests

Run the admin-frontend smoke after a compile and the admin-spa web export, with Playwright's
Chromium installed:

```bash
bun run compile && bun run --cwd admin-spa build:web && bun run --cwd admin-frontend smoke
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | Screens, widgets, hooks, and request helpers with `@testing-library/react-native` (`src/**/*.test.ts(x)`), plus the `*.isolated.tsx` files that each need a fresh module registry | `bun run --cwd admin-frontend test` |
| Smoke | The compiled screens, bundled into the admin-spa web export, rendering AdminHome for a signed-in admin in Chromium against example-backend | `bun run --cwd admin-frontend smoke` |
| E2E | Admin flows in example-frontend's Playwright suite against example-backend: the home, tables, search and filters, bulk actions, forms, Todo CRUD, custom screens, and the comms dashboard (`example-frontend/e2e/admin-*.spec.ts`) | `bun run frontend:e2e` |
| E2E (admin-spa) | The same screens inside the standalone SPA: `test:e2e` (mocked backend) and `test:integration` (real backend). See [the admin-spa page](admin-spa.md) | `bun run --cwd admin-spa test:e2e` |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`admin-frontend/e2e/smoke.spec.ts`](https://github.com/TerrenoLabs/terreno/blob/master/admin-frontend/e2e/smoke.spec.ts)
runs at the `browser` layer. admin-frontend ships screens, not a server or a binary, so the
smoke drives them where a consumer gets them: the admin-spa web export, which bundles the
compiled package. The one file has two roles.

Run with Bun (`bun e2e/smoke.spec.ts`), it is the driver:

1. It exits 1 at once when `admin-spa/dist/index.html` is missing and asks for `build:web`.
   It does not check that the export is newer than `admin-frontend/dist`, so rebuild the
   export after each compile, as the command above does.
2. `spawnExampleBackend()` starts example-backend against `smokeMongoUri()` with
   `ADMIN_SPA_ENABLED=true` and `AUTH_PROVIDER=better-auth`, so one origin serves the export
   at `/console`, Better Auth, and the admin API. The smoke never imports `@terreno/api`.
3. It seeds the admin in its own process, the way example-backend's
   `src/scripts/seed-admin-spa-admin.ts` does. It signs `admin-frontend-smoke@example.com` up
   through Better Auth, calls `/admin/config` once so the session middleware creates the app's
   `User`, then sets `admin: true` and the `superadmin` role on that `users` document with
   `mongoose`. A rerun against a persistent `TERRENO_TEST_MONGODB_URI` signs in instead.
   Running the seed script as a second process cost about 4.5 s, mostly loading the backend's
   models a second time; seeding in the driver takes under 0.5 s.
4. It runs the root-locked Playwright CLI on Node against this same file, passing the backend
   URL in `ADMIN_FRONTEND_SMOKE_BASE_URL`. There is no Playwright config: admin-frontend has
   no other Playwright suite, so the default Chromium project runs only this spec. If the package
   gains a `playwright.config.ts`, give the smoke its own config and pass it with
   `--config`. Traces and screenshots go to a temp dir that the driver deletes.

Loaded by Playwright, the file defines one test. The admin opens `/console/login`, fills
`admin-spa-login-email` and `admin-spa-login-password`, and presses `admin-spa-login-submit`.
The test then waits for AdminHome's `admin-home-widget-modelsGrid`, which renders only after
`/admin/config` answers 200 for an admin, and checks that
`admin-home-models-grid-Todo-clickable` is visible.

The driver prints one `✅` line per step and exits 1 on the first failure, after printing
example-backend's output and Playwright's report.

The smoke needs Chromium (`bunx playwright install chromium`) but no secrets: the backend
uses fixed dev values from `spawnExampleBackend()`.

**Measured time:** 23–24.5 s in three runs on an idle 4-CPU container with the in-memory
replica set: Mongo and example-backend's first boot on an empty database 16–18 s, the seed
0.4 s, Chromium 5–6 s, and teardown 1 s. Before the seed moved in-process and
`spawnExampleBackend()` stopped waiting 5 s on SIGTERM, the same runs took 27–29.5 s. Under
load the boot stretches: one run that shared four CPUs with several other suites waited 75 s
for `/health`, so the driver waits up to 120 s. Budget: 30 s, excluding the compile and the web
export.

## Add an e2e test

- **A screen, widget, or hook changed:** add a unit test next to it in `admin-frontend/src/`.
  The smoke stays one happy path; do not add edge cases to it.
- **AdminHome, the models grid, or the admin sign-in contract changed:** update the `testID`s
  in `admin-frontend/e2e/smoke.spec.ts` and keep it within 30 s.
- **A user flow through the admin screens** (tables, forms, CRUD): add a spec to
  `example-frontend/e2e/admin-*.spec.ts` and list it in an admin shard. Follow
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec).
- **A flow specific to the standalone SPA:** add it to admin-spa's suites.

See [the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the smoke helpers.
