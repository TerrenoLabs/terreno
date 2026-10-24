# example-frontend e2e tests

Run the example-frontend smoke after a compile, with Playwright's Chromium installed:

```bash
bun run compile && bun run --cwd example-frontend smoke
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

Run with Bun (`bun e2e/smoke.spec.ts`), it is the driver:

1. It picks a free port for the API and starts a static server for the export on another. The
   server falls back to `index.html`, as `serve -s` does in CI.
2. `spawnExampleBackend()` starts example-backend on the API port against `smokeMongoUri()`,
   with `AUTH_PROVIDER=better-auth`, `BETTER_AUTH_URL` on `localhost`, and the web origin in
   `CORS_ORIGINS`. The page and the API share the `localhost` site, so Better Auth's session
   cookie works as it does in the main suite on ports 8082 and 4000. The backend starts before
   the export so it holds its port while the export bakes that port in.
3. It runs `expo export --platform web` into a temp dir with `EXPO_PUBLIC_API_URL` set to the
   API URL, because the export bakes the API URL in. This is the slow step. Metro's transform
   cache key ignores `EXPO_PUBLIC_*` values, so a shared warm cache would ship an earlier run's
   API port and the sign-in would fail. The export therefore gets its own Metro cache (`TMPDIR`
   points into the temp dir), and the driver checks that the bundle contains the API URL before
   it opens a browser. Every run is a cold export, as it is in CI.
4. It runs the root-locked Playwright CLI on Node against this same file with `--config=e2e`.
   That names a directory with no config file, so `playwright.config.ts` and its Metro and
   backend web servers stay out, and the default Chromium project runs only the smoke. It passes
   the web URL in `EXAMPLE_FRONTEND_SMOKE_BASE_URL`, and the URLs the e2e helpers read in
   `BACKEND_URL` and `FRONTEND_URL`. The export goes to a temp dir that the driver deletes. A
   failed run keeps its Playwright trace there and prints the path; open it with
   `bunx playwright show-trace`.

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

The driver prints one `✅` line per step, including the export's time, and exits 1 on the first
failure, after printing example-backend's output and Playwright's report.

The smoke needs Chromium (`bunx playwright install chromium`) but no secrets: the backend uses
fixed dev values from `spawnExampleBackend()`.

`playwright.config.ts` ignores `e2e/smoke.spec.ts` in its local and CI projects, so
`bun run frontend:e2e` and the e2e shards never run it. Loaded without the driver's env, the
test fails at once and asks for `bun run smoke`. `scripts/ci/e2eAffected/shards.ts` still lists
the spec, in its own `smoke` shard with `blocksPullRequest: false`, because the shard check
requires every `*.spec.ts` file to have one. CircleCI's `smoke` job runs it.

**Measured time:** timed by the CircleCI `smoke` job, which prints each package's time on every
run. Its row in the [package table](../e2e.md#package-pages) points there. The driver prints the
total and the time without the export. Budget: 30 s, excluding the compile and the web export.

## Add an e2e test

- **A screen, hook, or store helper changed:** add a unit test next to it. The smoke stays one
  happy path; do not add edge cases to it.
- **Sign-in, the todos screen, or their `testID`s changed:** update
  `example-frontend/e2e/smoke.spec.ts` and keep it within budget.
- **A user flow:** add a spec to the main suite and list it in a shard. Follow
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec).
- **A native-only flow:** add a Maestro flow. Follow
  [Write a Maestro flow](../e2e.md#write-a-maestro-flow).

See [the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the smoke helpers.
