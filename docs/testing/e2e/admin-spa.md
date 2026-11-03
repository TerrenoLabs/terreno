# @terreno/admin-spa e2e tests

Run the admin-spa smoke after a compile and the web export:

```bash
bun run compile && bun run --cwd admin-spa build:web && bun run --cwd admin-spa smoke
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | `AdminSpaServeApp` routing, the server render and its 503 without a server build, the basePath/baseUrl check, the access gate, cache headers, `loadSsrPayload`, the route loaders, app-config merging, the dev proxy, and the SPA's store and components (`src/**/*.test.ts(x)`, `store/`, `components/`, `server/`) | `bun run --cwd admin-spa test:ci` |
| Smoke | The serve plugin server-rendering the built export over real HTTP | `bun run --cwd admin-spa smoke` |
| E2E | `test:e2e`: Chromium against the built export on `e2e/serveTestApp.ts`, a backend-free server with mocked Better Auth and `/admin/config` | `bun run --cwd admin-spa test:e2e` |
| E2E (integration) | `test:integration`: Chromium against example-backend serving the SPA at `/console` with Better Auth and the admin API. It needs a running backend with `ADMIN_SPA_ENABLED=true` and a seeded admin; see `playwright.integration.config.ts` | `bun run --cwd admin-spa test:integration` |
| Image smoke | The built `example-backend/Dockerfile` image server-rendering `/console/login` and the root loader | `scripts/admin-spa-image-smoke.sh <base-url>` |
| Manual regression | Cases in `docs/regression/` | none |

### Specs

| Spec | Layer | Covers |
| --- | --- | --- |
| `e2e/ssr.spec.ts` | `browser` | The login page holds the brand and form with JavaScript off; an anonymous protected route gets a server 302; login hydrates without a warning, by direct visit or client navigation |
| `e2e/login.spec.ts` | `browser` | The anonymous redirect to `/login` with `returnTo` (unsafe values ignored), an admin signing in to AdminHome, a wrong password showing an error |
| `e2e/shell.ssr.spec.ts` | `browser` | The admin shell is in the first HTML with no spinner; hydration does not request the admin config again; no loader data or shell payload stays in the page |
| `e2e/integration/adminSpa.ssr.list.integration.spec.ts` | `browser` | `/console/User` shows seeded rows with JavaScript off and hydrates without `GET /admin/users` |
| `e2e/integration/adminSpa.ssr.detail.integration.spec.ts` | `browser` | `/console/User/<id>` (also fully percent-encoded) shows the form's values with JavaScript off and hydrates without a read |
| `e2e/integration/adminSpa.ssr.windowed.integration.spec.ts` | `browser` | `/console/Todo` shows seeded rows; syncdb starts and keeps them; a change made right after the render shows without a refresh |
| `e2e/integration/adminSpa.ssr.rpc.integration.spec.ts` | `browser` | `/console/configuration` and the home widgets show their data with JavaScript off |
| `e2e/integration/adminSpa.ssr.jobs.integration.spec.ts` | `browser` | `/console/jobs` shows dashboard data, not a spinner, with JavaScript off |
| `e2e/integration/adminSpa.ssr.comms.integration.spec.ts` | `browser` | `/console/comms` shows seeded message rows with JavaScript off |
| `e2e/integration/adminSpa.ssr.orgs.integration.spec.ts` | `browser` | `/console/orgs` and an organization's members page show their data with JavaScript off |

The other `e2e/integration/` specs cover sign-in and admin CRUD.

CircleCI runs `build:web`, `smoke` and `test:e2e` in `admin-spa-ci`, `test:integration` in
`admin-spa-integration`, and the image smoke in `admin-spa-image-smoke`.

## The smoke

[`admin-spa/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/admin-spa/e2e/smoke.ts)
runs at the `http` layer. It boots `AdminSpaServeApp` at `/console` with a custom `brandName`
over the built `dist/` (`client/` + `server/`), then checks over real HTTP, among others:

1. `GET /console/login` answers 200 HTML that holds the brand name and the login form, with
   `Cache-Control: no-store, private`.
2. `GET /_expo/loaders/login` (the site root) answers 200 with `Cache-Control: no-store, private`.
3. `GET /console/app-config.json` answers 200 with the custom `brandName`.

It runs every check, prints one `✅` or `❌` line each, and exits 1 if any failed. It needs `build:web` first.
It needs no browser, MongoDB, or secrets. The browser flows belong to `test:e2e` and
`test:integration`.

**Budget:** 30 s, excluding the compile and the web export.

## The image smoke

Job `admin-spa-image-smoke` builds `example-backend/Dockerfile`, runs the image with
`ADMIN_SPA_ENABLED=true` against a mongo replica set, and runs
`scripts/admin-spa-image-smoke.sh`. It passes only when `/console/login` is 200 HTML with the
brand and `admin-spa-login-email`, and `/_expo/loaders/login` is 200 JSON with
`Cache-Control: no-store, private`. It also runs the image with
`ADMIN_SPA_DIST_DIR=/nonexistent` and expects the script to fail. See
[Run tests locally](../../how-to/run-tests-locally.md) for the local commands.

## Add an e2e test

- **New serve-plugin option, gate rule or loader branch:** add a unit test in
  `admin-spa/src/serve.test.ts`, `src/gate.test.ts`, or next to the loader in `server/`. The
  smoke stays one happy path; do not add edge cases to it.
- **The serving contract changed** (the SSR login page, the root loader path, cache headers,
  the app-config route): update the checks in `admin-spa/e2e/smoke.ts` and keep it within 30 s.
- **A screen or flow that needs no real backend:** add a Playwright spec to `admin-spa/e2e/`
  and extend the mocks in `e2e/serveTestApp.ts`. Follow
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec) for `testID`s and waits.
- **A server-rendered screen, or a flow that needs the real admin API or Better Auth:** add a
  spec to `admin-spa/e2e/integration/`, one file per screen family
  (`adminSpa.ssr.<area>.integration.spec.ts`).

See [the `@terreno/admin-spa` reference](../../reference/admin-spa.md) for the plugin API and
[the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the smoke helpers.
