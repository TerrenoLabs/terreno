# @terreno/admin-spa e2e tests

Run the admin-spa smoke after a compile and the web export:

```bash
bun run compile && bun run --cwd admin-spa build:web && bun run --cwd admin-spa smoke
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | `AdminSpaServeApp` routing, index rewriting, the base-path global, app-config merging, the dev proxy, and the SPA's store and components (`src/**/*.test.ts(x)`, `store/`, `components/`) | `bun run --cwd admin-spa test:ci` |
| Smoke | The compiled serve plugin serving the built SPA from a real server in a child process | `bun run --cwd admin-spa smoke` |
| E2E | `test:e2e`: Chromium against the built SPA on `e2e/serveTestApp.ts`, a backend-free server with mocked Better Auth and `/admin/config`. It covers the login redirect, an admin signing in to AdminHome, and a wrong password showing an error (`e2e/login.spec.ts`) | `bun run --cwd admin-spa test:e2e` |
| E2E (integration) | `test:integration`: Chromium against example-backend serving the SPA at `/console` with Better Auth and the admin API. It covers sign-in and admin CRUD (`e2e/integration/*.spec.ts`). It needs a running backend with `ADMIN_SPA_ENABLED=true` and a seeded admin; see `playwright.integration.config.ts` | `bun run --cwd admin-spa test:integration` |
| Manual regression | Cases in `docs/regression/` | none |

CircleCI runs `test:e2e` in `admin-spa-ci` and `test:integration` in `admin-spa-integration`.
The smoke runs only in the `smoke` job.

## The smoke

[`admin-spa/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/admin-spa/e2e/smoke.ts)
runs at the `http` layer. It re-runs itself with a `serve` argument to start a child process
that imports the compiled `@terreno/admin-spa` by package name, registers `AdminSpaServeApp` on
a plain Express app at `/console` with a custom `brandName`, and listens on a `freePort()`. The
plugin serves the export from its default location (`admin-spa/dist`), the path a published
package uses. The parent waits for `/console/app-config.json` with `spawnUntilReady`, then
checks over real HTTP:

1. `GET /console/` returns the HTML index with `window.__ADMIN_SPA_BASE__="/console"` injected.
2. The entry bundle the index names under `/console/_expo/` returns JavaScript.
3. `GET /console/app-config.json` returns the custom `brandName` merged over the default
   providers.
4. A deep route, `GET /console/User/123`, falls back to the same index.

It prints one `✅` line per check and exits 1 on the first failure, after printing the
server's output. Without `admin-spa/dist/index.html` it exits 1 at once and asks for
`build:web`; otherwise the plugin would serve an empty index.

The smoke needs no browser, MongoDB, or secrets. The browser flows belong to `test:e2e` and
`test:integration`.

**Measured time:** 4–4.5 s in two root `bun run smoke` runs after the build (the
[guide's](../e2e.md#package-pages) figure), excluding the compile and the web export. Single runs
took 6–8 s wall clock. Most of it is loading `@terreno/test` and starting the child;
the checks take well under a second. Budget: 30 s.

## Add an e2e test

- **New serve-plugin option or branch:** add a unit test in `admin-spa/src/serve.test.ts`. The
  smoke stays one happy path; do not add edge cases to it.
- **The serving contract changed** (the base-path global, the app-config route, or the SPA
  fallback): update the checks in `admin-spa/e2e/smoke.ts` and keep it within 30 s.
- **A screen or flow that needs no real backend:** add a Playwright spec to `admin-spa/e2e/`
  and extend the mocks in `e2e/serveTestApp.ts`. Follow
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec) for `testID`s and waits.
- **A flow that needs the real admin API or Better Auth** (CRUD, permissions): add a spec to
  `admin-spa/e2e/integration/`.

See [the `@terreno/admin-spa` reference](../../reference/admin-spa.md) for the plugin API and
[the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the smoke helpers.
