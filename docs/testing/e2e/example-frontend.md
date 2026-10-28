# example-frontend e2e tests

Build the smoke's web export once after a compile, then run the smoke, with Playwright's
Chromium installed:

```bash
bun run compile && bun run --cwd example-frontend export:smoke && bun run --cwd example-frontend smoke
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | Screens, hooks, and store helpers in-process (`**/*.test.ts(x)`) | `bun run --cwd example-frontend test` |
| Smoke | A web export of the app, served statically, signing a user in and creating a todo in Chromium against example-backend | `bun run --cwd example-frontend smoke` |
| E2E | The main Playwright suite (`example-frontend/e2e/*.spec.ts`): auth, todos, profile, realtime, AI chat, admin, and syncdb, run in CI shards | `bun run frontend:e2e` |
| E2E (native flow) | Maestro flows in `.maestro/flows/` against the web build | `bun run maestro:test` |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`example-frontend/e2e/smoke.spec.ts`](https://github.com/TerrenoLabs/terreno/blob/master/example-frontend/e2e/smoke.spec.ts)
runs at the `browser` layer. It proves the app as it ships: a production web export, not the
Metro dev server the main suite uses locally. The one file has two roles.

Run with Bun, it is the driver. It has two modes.

`bun e2e/smoke.spec.ts export` (the `export:smoke` script) is the build step. Like demo's
`export` and admin-spa's `build:web`, it runs outside the smoke's time budget; a cold export
takes about 3 minutes.

1. It runs `expo export --platform web` into `example-frontend/dist-smoke/` (git-ignored) with
   `EXPO_PUBLIC_API_URL=http://smoke-api.invalid`, a placeholder (`SMOKE_PLACEHOLDER_API_URL` in
   `e2e/helpers/webExport.ts`). The export bakes the API URL in, so the smoke swaps the
   placeholder for its real API URL as it serves the bundle. The `.invalid` host never
   resolves, so a bundle served without the swap fails instead of reaching a stale backend.
2. Metro's transform cache key ignores `EXPO_PUBLIC_*` values, so a cache shared with another
   export (the main suite's, for example, built against port 4000) could ship the wrong API URL.
   The export therefore keeps its own Metro cache in `example-frontend/.expo/smoke-metro-cache`
   (`TMPDIR` points there). Only this export writes that cache, so it stays warm and right.
3. It checks that the bundle contains the placeholder.

`bun e2e/smoke.spec.ts` (the `smoke` script) is the smoke:

1. It exits 1 at once, naming `export:smoke`, when `dist-smoke/` has no bundle or its bundle
   lacks the placeholder (an export from before the placeholder, or from another build).
2. It picks a free API port with `freePort()`, then serves `dist-smoke/` on another free port
   with a static server that falls back to `index.html`, as `serve -s` does in CI. The server
   replaces the placeholder with `http://localhost:<API port>` in every JS and HTML file it
   sends.
3. `spawnExampleBackend()` starts example-backend on the API port against `smokeMongoUri()`, with
   `AUTH_PROVIDER=better-auth`, `BETTER_AUTH_URL` on `localhost`, and the web origin in
   `CORS_ORIGINS`. The page and the API share the `localhost` site, so Better Auth's session
   cookie works as it does in the main suite on ports 8082 and 4000.
4. It runs the root-locked Playwright CLI on Node against this same file with `--config=e2e`.
   That names a directory with no config file, so `playwright.config.ts` and its Metro and
   backend web servers stay out, and the default Chromium project runs only the smoke. It passes
   the web URL in `EXAMPLE_FRONTEND_SMOKE_BASE_URL`, and the URLs the e2e helpers read in
   `BACKEND_URL` and `FRONTEND_URL`. A failed run keeps its Playwright trace in a temp dir and
   prints the path; open it with `bunx playwright show-trace`.

Loaded by Playwright, the file defines one test:

1. `beforeEach` signs `e2e-smoke@terreno.dev` up through Better Auth (or in, on a rerun) and
   accepts any pending consent forms, so a fresh database needs no seed.
2. The test signs in with `loginAs()` and waits for `todos-screen`.
3. It fills `todos-title-input` with a unique title, presses `todos-create-button`, and waits
   for a `todo-item-*` row with that title. It checks that the input clears.
4. It polls the API (`listTodosAs()`) until the todo is listed. The row alone is syncdb's
   optimistic local write; the API listing it proves the outbox reached the backend.
5. It checks that `todo-item-{_id}` is visible for the server's `_id`. syncdb mints the id on
   the client and writes it through, so the row on screen is the stored record.

The spec imports `test` from `@playwright/test`, not `./fixtures/test`: it is one happy path
through a production build, and its own assertions fail on a broken flow.

The driver prints one `✅` line per step and exits 1 on the first failure, after printing
example-backend's output and Playwright's report.

The smoke needs Chromium (`bunx playwright install chromium`) but no secrets: the backend uses
fixed dev values from `spawnExampleBackend()`.

`playwright.config.ts` ignores `e2e/smoke.spec.ts` in its local and CI projects, so
`bun run frontend:e2e` and the e2e shards never run it. Loaded without the driver's env, the
test fails at once and asks for `bun run smoke`. `scripts/ci/e2eAffected/shards.ts` still lists
the spec, in its own `smoke` shard with `blocksPullRequest: false`, because the shard check
requires every `*.spec.ts` file to have one. CircleCI's `smoke` job runs `export:smoke` before
it runs every smoke.

**Measured time:** 21.9–25.6 s in three runs on an idle 4-CPU container, and 31.4 s in one
where example-backend's first boot on an empty database took 20 s. Mongo plus that first boot
take 12–20 s, Chromium 7.5–10 s, and teardown 1–2.5 s. The export itself took 167 s cold. Before
the export moved to `export:smoke`, every run rebuilt it cold and took 196–207 s. Budget: 30 s,
excluding the compile and the web export.

## Add an e2e test

- **A screen, hook, or store helper changed:** add a unit test next to it. The smoke stays one
  happy path; do not add edge cases to it.
- **Sign-in, the todos screen, or their `testID`s changed:** update
  `example-frontend/e2e/smoke.spec.ts`, rerun `export:smoke`, and keep the smoke within budget.
- **A user flow:** add a spec to the main suite and list it in a shard. Follow
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec).
- **A native-only flow:** add a Maestro flow. Follow
  [Write a Maestro flow](../e2e.md#write-a-maestro-flow).

See [the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the smoke helpers.
