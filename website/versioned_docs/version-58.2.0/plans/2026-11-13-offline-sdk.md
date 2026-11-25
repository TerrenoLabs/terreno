# Generate the client SDK without a running backend, and fail CI when it is stale

Today the two generated frontend files (`store/apiSdk.ts`, `store/syncDbSdk.ts`) can only be
rebuilt against a live backend, which in turn needs a MongoDB replica set and four secrets.
Nothing checks that the committed files still match the backend, and the example app passes a
hand-typed list of synced collections that has already drifted. This plan makes SDK generation
a single offline command, takes the synced-collection list from the backend alone, and adds a
CI gate that fails a pull request whose committed SDK is stale. App developers and coding
agents feel it first: "change the model, regenerate, read the type errors" stops needing a
running stack.

Source: audit `docs/audits/2026-11-12/REPORT.md` finding 1.6 (detail:
`code-refactoring.md` finding 10). Companion plan:
`docs/plans/2026-11-13-resource-generator.md` builds on this one.

## The idea

A backend exports one function, `buildApp`, from a module that registers every route and makes
no database call. A new `terreno-openapi` bin (shipped by `@terreno/api`) imports that module,
builds the Express app without connecting or listening, and writes the OpenAPI document. A new
`terreno sdk` command chains that spec into both existing code generators, and `terreno sdk
--check` compares the result with the committed files and exits non-zero on any difference.

What is observably different:

- `terreno sdk` works with no backend process, no MongoDB and no secrets.
- The synced-collection list comes from the `x-terreno-sync` extension the backend already
  writes on each synced list operation. No script passes `--collections`.
- A backend with no synced collection yet produces a valid, empty `syncDbSdk.ts` instead of an
  error, so a fresh scaffold can import `SYNC_COLLECTIONS` from the generated file.
- CI fails when `example-frontend/store/*.ts` does not match `example-backend`.

Rejected: starting an in-memory MongoDB and the real server inside the command. It keeps the
slow, flaky part (a `mongod` download and boot) and would not run in a sandbox with no binary.
Live mode stays available through `--schema <url>` for apps that have not split out `buildApp`.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | `terreno-openapi` writes a spec from an app module with no database and no listener | none | `api` | unit + child-process test |
| T2 | `BetterAuthApp` registers without a MongoDB connection during an OpenAPI build | T1 | `api` | unit + child-process test |
| T3 | The example backend exports a database-free `buildApp` whose spec equals the served one | T2 | `example-backend` | parity test, `openapi` script |
| T4 | The codegen writes an empty SDK when nothing is synced and honours `excludeCollections` | none | `syncdb` | unit tests |
| T5 | `terreno-syncdb-codegen --check` reports stale files without writing | T4 | `syncdb` | unit tests |
| T6 | `terreno openapi` and `terreno sdk [--check]` run the whole chain from a project | T3, T5 | `cli` | unit + integration test, cli smoke |
| T7 | The example frontend regenerates offline and drops the hand-typed collection list | T6 | `example-frontend` | clean second run, existing e2e |
| T8 | CI and prepush fail when the committed example SDK is stale | T7 | root scripts, workflows | check script, prepush plan test |
| T9 | A scaffolded app generates its SDK offline and checks drift in its own CI | T8, one-command-dev T13–T14 | `create-terreno-app`, CI script | unit tests, package smoke, bootstrap check |

Chain: T1 → T2 → T3 → T6 → T7 → T8 is longer than three, each link for a reason: T2 changes
code T1 adds a switch for; T3 cannot build offline until T2; T6's offline test runs against
T3's `buildApp`; T7's scripts call T6's command; T8 gates on the tree T7 regenerates. T4 → T5
runs beside it. T9 follows T8 only because both write the root `check:sdk-drift` script.
Tracer: an app module on disk → `terreno-openapi` in a child process with no `MONGO_URI` → an
OpenAPI JSON file that carries `x-terreno-sync` (T1).
E2E: 4 process-layer checks (E1 `api/e2e/smoke.ts`, E2 `cli/e2e/smoke.ts`, E3
`create-terreno-app/e2e/smoke.ts`, E4 `scripts/ci/check-bootstrap-app.sh`).
Regression: None — no hard-to-automate change.
User guide: None — no user-visible change in the example app (developer tooling only).
Design: None — no canvas.
Out of scope: typed `syncDb.mutate({collection})`, OpenAPI route-metadata registry, `terreno
dev`; see Expansions.
Open risks: registering plugins may need MongoDB: `BetterAuthApp` does today (T2 fixes it), and
others may (T1 reports it, T3 is where it would surface); the spec depends on environment
variables and on a backend `.env` file, so the gate must build from a fixed environment (T6); adding `projects` to the example's synced list changes what the
example app subscribes to (T7, Q2).
Elephant: every adopter backend, including Flourish, must move its route registration into a
database-free `buildApp` module before it gets the offline path or the drift gate; until then
only the example app and new scaffolds benefit, and adopters stay on `--schema <url>`.

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `api/e2e/smoke.ts` | process | The `terreno-openapi` bin, run as a child process with no `MONGO_URI`, exits 0 and writes a spec whose synced list operation carries `x-terreno-sync` | T1 |
| E2 | `cli/e2e/smoke.ts` | process | The compiled `terreno sdk --schema <fixture>` writes both SDK files into a temp frontend, and `terreno sdk --check` exits 1 after one of them is edited | T6 |
| E3 | `create-terreno-app/e2e/smoke.ts` | process | A freshly scaffolded app has `backend/src/buildApp.ts`, `sdk` and `sdk:check` scripts with no `--collections` flag, and a generated `frontend/store/syncDbSdk.ts` (empty with `--minimal`) that `frontend/store/syncdb.ts` imports | T9 |
| E4 | `scripts/ci/check-bootstrap-app.sh` | process | In an app generated and installed from this checkout, `bun run sdk` succeeds with no backend and no MongoDB, and `bun run sdk:check` then exits 0 | T9 |

E4 is the repository's existing generated-app check (weekly, on tags, and on pull requests that
touch its inputs); it installs packed packages, so it sits outside the per-package smoke.

The example apps' own behaviour is covered by suites that already exist and must stay green:
`example-backend/src/openapi.test.ts` (extended in T3), `bun run --cwd example-backend smoke`,
and `bun run frontend:e2e` (T7).

## Regression cases

None — no hard-to-automate change.

## User guide

None — no user-visible change. The plan changes developer commands and CI. The example app's
screens, labels and flows are unchanged; `projects` becoming a synced collection (T7) adds no
screen.

## Design

None — no canvas.

## Tasks

- [ ] **T1** — Write the OpenAPI spec from an app module with no database and no listener
  - Depends on: none
  - Files: api/src/openApiDocument.ts, api/src/openApiBuildMode.ts, api/src/openApiCli.ts, api/src/terrenoApp.ts, api/src/index.ts, api/package.json, api/src/openApiDocument.test.ts, api/src/openApiCli.test.ts, api/src/tests/fixtures/openApiApp.ts, api/src/tests/fixtures/openApiAppQueries.ts, api/e2e/smoke.ts, docs/reference/api.md, docs/testing/e2e/api.md, changelog/unreleased/offline-openapi-spec.md
  - Criteria:
    - `buildOpenApiDocument` returns the same document the app serves at `GET /openapi.json` (verified by a unit test that deep-compares both).
    - `terreno-openapi` exits 0 with no `MONGO_URI`, opens no MongoDB connection and no port, and writes the document (verified by a child-process test and E1).
    - A `buildApp` that queries MongoDB makes the bin exit 1 with a message that names the cause (verified by a child-process test).
  - Seam: exported function `buildOpenApiDocument` and the `terreno-openapi` bin (child process)
  - Interface:
    - `buildOpenApiDocument({app}: {app: TerrenoApp | express.Application}): Promise<Record<string, unknown>>`, exported from `@terreno/api`. For a `TerrenoApp` it applies the same automatic registrations `start()` applies (`OrgsApp` when `organizations` is set, `RealtimeApp` when `realtime` is set; today inline at `api/src/terrenoApp.ts:621-680`, extracted into one private step both paths call), then `build()`. It never runs `completeStart` (no migrations, no `listen`). For an Express app it reads the document from the already-built app.
    - Bin `terreno-openapi --app <module> [--export <name>] --out <file|->`, registered in `api/package.json` `bin` next to `terreno-migrate`. `<module>` resolves from the current directory. The export defaults to `buildApp`: a function taking no arguments and returning (or resolving to) a `TerrenoApp` or `express.Application`. Before importing the module the bin (a) calls `enableOpenApiBuildMode()`. The switch lives in `api/src/openApiBuildMode.ts`, which exports `enableOpenApiBuildMode(): void`, `resetOpenApiBuildModeForTests(): void` and `isOpenApiBuild(): boolean`; only `isOpenApiBuild` is exported from the `@terreno/api` package root, so app code can read the mode but cannot turn it on, and no environment variable turns it on. The bin and the tests import the module file directly; (b) turns mongoose command buffering off, so any query that is executed (awaited, `.exec()`, `.then()`, `save()`, `create()`) rejects at once instead of waiting; an unexecuted query object is harmless and not detected; (c) sets throwaway values for `TOKEN_SECRET`, `TOKEN_ISSUER`, `REFRESH_TOKEN_SECRET`, `SESSION_SECRET`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` in its own process when they are unset, so app code never needs a default secret.
    - Output: JSON, two-space indent, trailing newline. `--out -` writes to stdout.
    - Errors (exit 1, message on stderr): missing `--app` or `--out` → usage text; export missing → `No export "buildApp" in <module>`; an executed query during build, whether its rejection is awaited or surfaces as an unhandled rejection → a line containing `queried MongoDB while building` and `Move database work out of buildApp`; any other error thrown by `buildApp` → `buildApp failed without a database: <message>`.
  - Cases:
    - Fixture `openApiApp.ts`: `buildApp` returns `new TerrenoApp({userModel, skipListen: true}).register(modelRouter("/widgets", Widget, {permissions: all IsAuthenticated, sync: {scope: {type: "owner", field: "ownerId"}}}))` where `Widget` uses `isDeletedPlugin` and `syncPlugin`. `buildOpenApiDocument` → `openapi === "3.0.0"`; the `/widgets/` (or `/widgets`) path has `get`, `post`; its `get["x-terreno-sync"].collection === "widgets"`.
    - Same fixture, `TerrenoApp` started with `skipListen: true` in the test's in-memory Mongo, `GET /openapi.json` body deep-equals `buildOpenApiDocument` of a second `buildApp()` result.
    - `TerrenoApp` with `realtime: true` → documents from `buildOpenApiDocument` and from `GET /openapi.json` after `start()` are deep-equal (proves the shared auto-registration step).
    - Child process, env without `MONGO_URI`: `terreno-openapi --app <fixture> --out <tmp>/openapi.json` → exit 0 within 10 s; file parses; contains `x-terreno-sync`. Run twice → the two files are byte-identical.
    - `--out -` → stdout parses as JSON with `openapi === "3.0.0"`; no file written.
    - No `--app` → exit 1, stderr starts with `Usage: terreno-openapi`.
    - `--export nope` → exit 1, stderr contains `No export "nope"`.
    - Fixture `openApiAppQueries.ts`, export `buildApp`: an async function that does `await Widget.countDocuments()` → exit 1, stderr contains `queried MongoDB while building`. Export `buildAppDetached` (`--export buildAppDetached`): does `void Widget.create({ownerId: new mongoose.Types.ObjectId()})` then returns the app → exit 1, same message.
    - Export `buildAppThrows`: throws `new Error("boom")` → exit 1, stderr contains `buildApp failed without a database: boom`.
    - With `TOKEN_SECRET` unset in the child's env, the first fixture still exits 0. In a normal process (no bin), `isOpenApiBuild()` is `false` even when `TERRENO_OPENAPI_BUILD=1` is in the environment.
    - A `buildApp` that returns `new TerrenoApp(...).build()` (an Express app) → exit 0, same paths as the first case.
  - Blast radius: `TerrenoApp.start()` is every app's boot path → the existing `api/src/terrenoApp*.test.ts` suites and `example-backend/src/openapi.test.ts` stay green (backend layer); the `realtime: true` parity case above pins the extracted step.
  - Test skills: terreno-backend-tests
  - Docs: `docs/reference/api.md` gains "OpenAPI without a server" (the function, the bin, the `buildApp` contract, `isOpenApiBuild()`, the throwaway secrets); `docs/testing/e2e/api.md` lists the new smoke check.
  - Supporting skills: terreno-backend-api, update-docs

- [ ] **T2** — Let `BetterAuthApp` register without a MongoDB connection during an OpenAPI build
  - Depends on: T1
  - Files: api/src/betterAuthApp.ts, api/src/betterAuthSetup.ts, api/src/betterAuthOffline.test.ts, api/src/tests/fixtures/openApiAppBetterAuth.ts, docs/reference/api.md
  - Criteria:
    - With OpenAPI build mode on and no connection, a `TerrenoApp` that registers `BetterAuthApp` builds, and its document equals the one the same app serves when connected (unit test).
    - With build mode off and no connection, registration still fails at boot with today's error (unit test), so production keeps failing fast.
    - `terreno-openapi` exits 0 on a fixture app that registers `BetterAuthApp` (child-process test).
  - Seam: `buildOpenApiDocument` over an app with `BetterAuthApp`, and the `terreno-openapi` bin
  - Interface: `getMongoClientFromMongoose()` (`api/src/betterAuthSetup.ts:1348`) today throws `Mongoose is not connected. Ensure MongoDB connection is established first.` when `mongoose.connection.client` is unset, and `createBetterAuth` calls `mongoClient.db()` at once (`:256`). New behaviour, only when `isOpenApiBuild()` is true and there is no client: it returns a stub client view: `db()` returns an object on which any property access that Better Auth's adapter would call as a collection operation throws an error whose message contains `queried MongoDB while building`. No `MongoClient` is constructed, so nothing can connect, hang on server selection, or write to a developer's local database. Better Auth can be created and its routes mounted; if creation itself needs the database, this task stops and reports (that would move Q1's answer). Outside build mode nothing changes. No new public export.
  - Cases:
    - In build mode with no client, `getMongoClientFromMongoose().db().collection("user").findOne({})` throws (or rejects) within 1 s with a message containing `queried MongoDB while building`, and no socket is opened.
    - Build mode on (`enableOpenApiBuildMode()` from `api/src/openApiBuildMode.ts`, `resetOpenApiBuildModeForTests()` in `afterEach`), no connection: `buildOpenApiDocument({app: new TerrenoApp({userModel, skipListen: true}).register(new BetterAuthApp({config: {enabled: true, secret: "x".repeat(32), baseURL: "http://localhost:4000"}, userModel}))})` resolves; the document has `/auth/me` `get`.
    - Same app, connected (test's in-memory Mongo), build mode off, started with `skipListen: true` → `GET /openapi.json` body deep-equals the document from the first case.
    - Build mode off, `mongoose.connection.client` unset (a fresh `mongoose.Mongoose` instance or a stubbed connection): `new BetterAuthApp(...).ensureAuth()` throws an error whose `title` is `Mongoose is not connected. Ensure MongoDB connection is established first.`
    - Child process: `terreno-openapi --app <openApiAppBetterAuth fixture> --out -` with no `MONGO_URI` → exit 0 within 10 s, stdout parses, and the process exits by itself.
  - Blast radius: `ensureAuth()` runs at every boot of every Better Auth app (`api/src/terrenoApp.ts:446`, `api/src/betterAuthApp.ts:114`) → the existing Better Auth suites in `api/src` stay green; the "build mode off" case pins that production behaviour is unchanged (backend layer). Sessions and sign-in are untouched: in build mode no request is served.
  - Test skills: terreno-backend-tests
  - Docs: one paragraph in the "OpenAPI without a server" section of `docs/reference/api.md` (after T1, same page): plugins that need a database at registration must defer it or check `isOpenApiBuild()`.
  - Supporting skills: terreno-backend-api, update-docs

- [ ] **T3** — Export a database-free `buildApp` from the example backend
  - Depends on: T2
  - Files: example-backend/src/buildApp.ts, example-backend/src/server.ts, example-backend/src/openapi.test.ts, example-backend/package.json
  - Criteria:
    - `bun run --cwd example-backend openapi` exits 0 with `MONGO_URI` unset and prints the spec (verified by running it; Roast runs the command).
    - The offline spec deep-equals the spec the started app serves, in the same process and environment (verified by a test in `openapi.test.ts`).
    - Every existing `openapi.test.ts` case and the package smoke still pass.
  - Seam: exported function `buildApp` and the `openapi` package script
  - Interface: `buildApp(options?: {httpServer?: http.Server; skipListen?: boolean; websocketsDebug?: boolean}): TerrenoApp` in `example-backend/src/buildApp.ts`. It holds the `TerrenoApp` constructor call and every `.register(...)` now inside `start()` (`example-backend/src/server.ts:193` onward). It makes no awaited call and no model query. Values `start()` reads from MongoDB before registering (today `AppConfiguration.getConfig("debug.websocketsDebug")`) arrive as options with offline defaults. `start()` keeps the database work (`connectToMongoDB`, `access.roles.seedDefaults`, `backfillAdmins`, `syncConsents`, boot seed, harness and jobs worker start), then calls `buildApp(...)` and `.start()`. Every plugin instance is constructed inside `buildApp` (today `notificationsApp` is module-level, `server.ts:102`), so calling it twice in one process works. One registration is conditional on an awaited, replica-set-only value today: `HarnessApp` is registered only when `await openExampleHarness()` succeeds (`server.ts:469-474`, `src/harness/exampleHarness.ts:42-56`), and it must stay before `AdminApp`. `buildApp` registers `HarnessApp` unconditionally with a harness that `start()` opens afterwards (Q6); the harness routes are therefore in the offline spec. Package script: `"openapi": "bun ../api/src/openApiCli.ts --app ./src/buildApp.ts --out -"`.
  - Cases:
    - The offline document, produced in a child process with the test's environment (`bun ../api/src/openApiCli.ts --app ./src/buildApp.ts --out -`), deep-equals the body of `GET /openapi.json` on `await start(true)` in the test process, except for harness paths, which the unit-test MongoDB (not a replica set) does not serve; the test asserts the difference is exactly the paths under the `HarnessApp` mount and that the offline document has them.
    - `buildApp()` called twice in one process returns two apps and does not throw.
    - The offline document has `x-terreno-sync.collection` `"todos"` on the todos list operation and `"projects"` on the projects list operation.
    - The offline document has `/auth/me` `get` and `/admin/todos/` `get` (same assertions the existing cases make against the served spec).
    - Child process `bun run openapi` with `MONGO_URI`, `TOKEN_SECRET` and `SESSION_SECRET` removed from env → exit 0, stdout parses as JSON. The bin supplies throwaway secrets (T1); `buildApp` must not contain a default secret or branch on build mode to skip a route.
    - `example-backend/src/buildApp.ts` contains no string literal used as a fallback for `TOKEN_SECRET`, `SESSION_SECRET` or `BETTER_AUTH_SECRET` (grep in the test).
  - Blast radius: `start()` boots Cloud Run (`src/index.ts`), Vercel (`src/vercelServer.ts`), every `example-backend` test, `spawnExampleBackend` smokes in client packages, and the Playwright suite → the existing `example-backend` test suite and `bun run --cwd example-backend smoke` (http layer) must pass unchanged; no new case, the parity test covers route equality.
  - Test skills: terreno-backend-tests
  - Docs: none here (T7 rewrites the SDK how-to once the frontend uses it).
  - Supporting skills: terreno-backend-api
  - Note: this is the reproduce-first step for plugins beyond `BetterAuthApp` (T2) that need MongoDB inside `register()`; the example registers about twenty. If the script fails on one, record the plugin and line in the stage result and fix it in that plugin by deferring the database access to first use; do not skip the registration in `buildApp`. If more than two plugins need changes, stop and report: that is a new task per plugin, not part of this one.

- [ ] **T4** — Write an empty SDK when nothing is synced, and honour `excludeCollections`
  - Depends on: none
  - Files: syncdb/src/codegen/discoverCollections.ts, syncdb/src/codegen/emitSdk.ts, syncdb/src/codegen/generate.ts, syncdb/src/codegen/types.ts, syncdb/src/codegen/generate.test.ts, syncdb/src/codegen/fixtures/openapi.twoCollections.json, docs/reference/syncdb.md, changelog/unreleased/syncdb-codegen-empty-and-exclude.md
  - Criteria:
    - A spec with no `x-terreno-sync` operation and no `--collections` produces a valid file with an empty `SYNC_COLLECTIONS` and exit 0 (unit test).
    - `excludeCollections` in the config file removes a collection the spec declares (unit test).
    - Output for the existing fixtures is unchanged (existing snapshot/unit tests).
  - Seam: exported `generateSyncDbSdk` and `discoverCollections`
  - Interface: `CodegenConfigFile` gains `excludeCollections?: string[]`. `discoverCollections({spec, collections?, excludeCollections?})`. With no extension in the spec and no `collections`, it returns `[]` (it threw `No synced collections found` before); `generateSyncDbSdk` then writes a file whose only collection export is `export const SYNC_COLLECTIONS = [] as const;` and prints one warning line to stderr: `No synced collections in the spec; wrote an empty SYNC_COLLECTIONS.` `--collections` behaviour is unchanged, including both existing errors when the list matches nothing.
  - Cases:
    - `fixtures/openapi.api.json` with every `x-terreno-sync` removed, no `collections` → returns source containing `export const SYNC_COLLECTIONS = [] as const;`, no `useListQuery`; the source type-checks (parse with the TypeScript API, zero syntax diagnostics).
    - New fixture `fixtures/openapi.twoCollections.json` (a copy of `openapi.example.json`, which syncs only `todos`, plus a `/notes` list, create and patch with `x-terreno-sync.collection: "notes"`): no options → `SYNC_COLLECTIONS` is `["todos", "notes"]`; `excludeCollections: ["notes"]` → `["todos"]` and no `useNotes` export.
    - Same fixture, `excludeCollections: ["nope"]` → throws `excludeCollections names a collection the spec does not sync: nope`.
    - `collections: ["todos"]` with a spec that has extensions but no `todos` → still throws the existing `No synced collections matched --collections todos` error.
    - `fixtures/openapi.example.json` with no new option → byte-identical to the current output.
  - Blast radius: `terreno generate syncdb` (`cli/src/commands/generate.ts`) calls `generateSyncDbSdk` → existing `cli/src/generate.test.ts` cases stay green (unit layer). The warning replaces a non-zero exit, so the fragment is `category: Changed`.
  - Test skills: terreno-frontend-tests
  - Docs: `docs/reference/syncdb.md#codegen` (line 951 today): describe the empty case and `excludeCollections`, and state that `--collections` is a filter kept for compatibility, not the way to declare what syncs.
  - Supporting skills: generate-sdk, update-docs

- [ ] **T5** — Report stale SDK files with `--check` and write nothing
  - Depends on: T4
  - Files: syncdb/src/codegen/generate.ts, syncdb/src/codegen/cli.ts, syncdb/src/codegen/types.ts, syncdb/src/codegen/generate.test.ts, syncdb/src/codegen/cli.test.ts, docs/reference/syncdb.md
  - Criteria:
    - `--check` exits 0 when the files on disk equal fresh output and 1 when any differs or is missing, naming each stale file (unit tests on the function and the CLI).
    - `--check` never changes a target file (unit test compares bytes and mtime).
  - Seam: exported `checkSdk` and the `terreno-syncdb-codegen` CLI
  - Interface: `checkSdk({schema, out?, apiOut?, collections?, config?, format}): Promise<{stale: string[]}>`, exported from `syncdb/src/codegen/generate.ts` (the module `@terreno/syncdb/codegen` resolves to) beside `generateSyncDbSdk`. It generates each requested file exactly as a normal run would (same biome formatting), into a temporary file in the target's directory that is removed before returning, and compares bytes with the target. A missing target is stale. CLI flag `--check`: exit 0 and stdout `SDK is up to date.`; exit 1 and stderr one `Stale: <path as passed>` line per file followed by `Regenerate with: terreno-syncdb-codegen <the same flags without --check>`.
  - Cases:
    - Generate both files into a temp dir from `fixtures/openapi.example.json`, then `checkSdk` with the same arguments → `{stale: []}`.
    - Append `// x` to the generated `syncDbSdk.ts`, check → `stale` equals `[<that path>]`; the file still ends with `// x`; its mtime is unchanged.
    - Delete `apiSdk.ts`, check with `apiOut` → `stale` contains that path and the file is not created.
    - After any check, the target directories contain no file other than the two targets.
    - CLI: fresh → exit 0, stdout `SDK is up to date.`; stale → exit 1, stderr contains `Stale: ` and `Regenerate with:`.
    - `format: false` on both generate and check → `{stale: []}`.
  - Blast radius: none (read-only mode; no state another behaviour reads).
  - Test skills: terreno-frontend-tests
  - Docs: `docs/reference/syncdb.md#codegen` gains the `--check` row. Shares the page with T4, hence the dependency.
  - Supporting skills: generate-sdk, update-docs

- [ ] **T6** — Add `terreno openapi` and `terreno sdk [--check]`
  - Depends on: T3, T5
  - Files: cli/src/commands/sdk.ts, cli/src/runCli.ts, cli/src/help.ts, cli/src/sdk.test.ts, cli/src/sdkOffline.test.ts, cli/e2e/smoke.ts, mcp-server/package.json, docs/reference/cli.md, docs/testing/e2e/cli.md, changelog/unreleased/terreno-sdk-command.md
  - Criteria:
    - `terreno sdk` run inside a project writes `store/apiSdk.ts` and `store/syncDbSdk.ts` from the backend's `buildApp` with no server running (integration test against `example-backend`).
    - `terreno sdk --check` exits 1 and lists stale files, exits 0 when fresh (unit test, E2).
    - `terreno sdk --schema <url|path>` keeps working for apps with no `buildApp` (unit test).
  - Seam: `runCli(argv, io)` and the compiled `terreno` bin
  - Interface:
    - `terreno openapi [--backend <dir>] [--app <module>] --out <file|->`: runs the `terreno-openapi` bin that the backend's own `@terreno/api` ships, found by Node-style resolution of `@terreno/api/package.json` starting at the backend directory and walking up (so a hoisted workspace install such as this monorepo's root `node_modules` works), never downloaded, with the backend as working directory. The child gets a fixed environment: `PATH`, `HOME`, `TMPDIR`, plus any variable named with a repeatable `--env NAME`, and Bun's automatic `.env` loading is turned off for it, so the spec is the same on every machine and in CI. Passes exit code and stderr through.
    - `terreno sdk [--check] [--backend <dir>] [--frontend <dir>] [--app <module>] [--schema <url|path>] [--config <json>] [--env NAME ...] [--no-format] [--json]`. `--env` is passed to the offline build exactly as on `terreno openapi`.
    - Defaults: project root from `resolveTerrenoProjectRoot(io.cwd)`; backend and frontend from `resolveFirstWorkspaceDir` (`backend`, `example-backend`; `frontend`, `example-frontend`), both already in `mcp-server/src/local/projectRoot.ts` and exposed to the CLI through a new `@terreno/mcp/project-root` export; app module `<backend>/src/buildApp.ts`; config `<frontend>/syncdb-codegen.json` when the file exists; outputs `<frontend>/store/apiSdk.ts` and `<frontend>/store/syncDbSdk.ts`.
    - Without `--schema`, the spec comes from the offline build and goes to a temp file that is deleted afterwards. With `--schema`, the offline build is skipped.
    - Output: one `Wrote <path>` line per file; `--json` → `{ok: true, files: string[], collections: string[]}`. `--check`: exit 0 `SDK is up to date.`; exit 1 with `Stale: <path>` lines and `Regenerate with: terreno sdk`; `--json` → `{ok: false, stale: string[]}`.
    - Errors (exit 1): no backend or frontend directory found → `Could not find a backend/ and frontend/ directory from <cwd>. Pass --backend and --frontend.`; no `src/buildApp.ts`, no `--app`, no `--schema` → `No <backend>/src/buildApp.ts. Export buildApp from a module that makes no database call, or pass --schema <url>.`; `@terreno/api` without the bin → `@terreno/api in <backend> has no terreno-openapi. Upgrade @terreno/api or pass --schema <url>.`
    - `HELP_TEXT` and `commandHelp("sdk")`, `commandHelp("openapi")` list both commands.
  - Cases:
    - Temp project with `frontend/` and a `--schema` pointing at `syncdb/src/codegen/fixtures/openapi.example.json` → exit 0; both files exist; `syncDbSdk.ts` contains `SYNC_COLLECTIONS`; stdout has two `Wrote ` lines.
    - Same, `--json` → stdout parses to `{ok: true, files: [2 paths], collections: [...]}` with `collections` equal to the fixture's synced names.
    - Then `--check` → exit 0. Append a character to `apiSdk.ts`, `--check` → exit 1, stderr contains `Stale: ` and that path; file unchanged.
    - Temp dir with neither directory → exit 1 with the `Could not find` message.
    - Temp project with `backend/` but no `src/buildApp.ts` and no `--schema` → exit 1 with the `No <backend>/src/buildApp.ts` message.
    - Offline (`sdkOffline.test.ts`): `--backend <repo>/example-backend --frontend <tmp>` with `MONGO_URI` unset → exit 0; `<tmp>/store/syncDbSdk.ts` lists `"todos"` and `"projects"`; `<tmp>/store/apiSdk.ts` contains the `/auth/me` hook.
    - Offline, same arguments, run once with `AUTH_PROVIDER=jwt BACKEND_SERVICE=api NODE_ENV=production` in the parent environment and once without → the two `apiSdk.ts` files are byte-identical (the child does not inherit them).
    - Offline `terreno sdk` with `COMMS_ENABLED=false` in the parent environment: without `--env COMMS_ENABLED` the output equals the baseline; with it, the run exits 0 (the output may differ).
    - The example backend resolves `@terreno/api` from the repository root `node_modules` (there is no `example-backend/node_modules/@terreno`); the offline case passing is the hoisted-install case.
    - `terreno --help` output contains `sdk` and `openapi`.
  - Blast radius: none (new commands; `generate sdk` and `generate syncdb` are untouched).
  - Test skills: terreno-backend-tests (bun unit tests for a CLI), the cli smoke conventions in `docs/testing/e2e.md`
  - Docs: `docs/reference/cli.md` command table and examples; `docs/testing/e2e/cli.md`.
  - Supporting skills: update-docs

- [ ] **T7** — Regenerate the example SDK offline and drop the hand-typed collection list
  - Depends on: T6
  - Files: example-frontend/package.json, example-frontend/store/apiSdk.ts, example-frontend/store/syncDbSdk.ts, example-frontend/store/syncdb.ts, docs/how-to/generate-the-client-sdk.md, .rulesync/rules/example-frontend/00-example-frontend.md (and its generated copies through `bun run rules`), plugins/terreno-planning/skills/generate-sdk/SKILL.md, .rulesync/skills/generate-sdk/SKILL.md, skills/generate-sdk/SKILL.md, plugins/terreno-claude/skills/generate-sdk/SKILL.md, changelog/unreleased/example-sdk-offline.md
  - Criteria:
    - `bun run --cwd example-frontend sdk` succeeds with no backend running and no `MONGO_URI`; a second run leaves `git diff --stat example-frontend/store` empty (Roast runs both).
    - `example-frontend/package.json` has no `--collections` flag and `store/syncDbSdk.ts` lists `projects` (grep).
    - `bun run frontend:test` and `bun run frontend:e2e` pass (existing suites).
    - Every difference between the regenerated `store/apiSdk.ts` and the committed one is listed in the stage result with its cause (a route the live backend served that the offline build does not, or the reverse). A hook the app imports must not disappear; a route missing offline is fixed in the backend registration, not by editing the SDK.
  - Seam: the `sdk` package script (child process) and the generated files
  - Interface: scripts in `example-frontend/package.json`: `"sdk": "bun ../cli/src/bin.ts sdk --backend ../example-backend --frontend ."`, `"sdk:check": "bun ../cli/src/bin.ts sdk --check --backend ../example-backend --frontend ."`; `api-sdk` and `sync-sdk` stay as aliases of `sdk` so existing docs and habits keep working. A live backend is still usable with `bun run sdk -- --schema $OPENAPI_URL`. `store/syncdb.ts`: `projects` is tenant-scoped with no `adminBroadcast` (`example-backend/src/api/projects.ts:63`), so it joins `PRODUCT_ONLY_COLLECTIONS` and stays out of the admin window store.
  - Cases:
    - After `bun run sdk`: `SYNC_COLLECTIONS` in `store/syncDbSdk.ts` contains `"projects"`, `"todos"`, `"notifications"`, `"notification-preferences"`, `"gpt/histories"`, `"mcp/service-tokens"`, and the file exports `useProjects`.
    - `bun run sdk:check` → exit 0 right after `bun run sdk`.
    - `ADMIN_COLLECTIONS` (exported or asserted through an existing `store` test) does not contain `"projects"`.
    - `bun run --cwd example-frontend typecheck` passes with the regenerated files.
    - If the offline spec syncs a collection beyond the six above (a plugin may register one), it appears in `SYNC_COLLECTIONS`; put it in the product store or in `PRODUCT_ONLY_COLLECTIONS` by whether its route sets `adminBroadcast`, and name it in the stage result.
  - Blast radius: `SYNC_COLLECTIONS` feeds `createSyncDb({collections})` for the product store and, filtered, the admin window store (`example-frontend/store/syncdb.ts:69-118`) → the product client now subscribes to the `projects` tenant stream. Cases at the browser layer: the existing `syncdb-*.spec.ts`, `realtime.spec.ts` and `admin*.spec.ts` suites must pass. If they fail for a reason that is not a one-line fix, apply Q2's fallback (`"excludeCollections": ["projects"]` in `example-frontend/syncdb-codegen.json`) and say so in the stage result.
  - Test skills: terreno-frontend-tests
  - Docs: rewrite `docs/how-to/generate-the-client-sdk.md` to lead with `terreno sdk` (no backend), then `--check`, then the `buildApp` contract with a link to `docs/reference/api.md`, then live mode. Update the `generate-sdk` skill at its source and regenerate the copies with `bun run skills:sync` and `bun run rules`; never hand-edit generated copies.
  - Supporting skills: generate-sdk, update-agent-docs, update-docs

- [ ] **T8** — Fail CI and prepush when the committed example SDK is stale
  - Depends on: T7
  - Files: package.json, .github/workflows/sdk-drift.yml, scripts/ci/prepush/plan.ts, scripts/ci/prepush/plan.test.ts, docs/how-to/run-tests-locally.md, docs/explanation/static-analysis.md
  - Criteria:
    - `bun run check:sdk-drift` exits 0 on a clean tree and 1 after a backend route change that is not regenerated (Roast runs both; the second by adding a `queryFields` entry to `example-backend/src/api/todos.ts` in a scratch copy of the tree, never in the working tree).
    - A GitHub workflow runs the check on every pull request, merge group and push to `master` (the YAML exists and names the command).
    - `bun run prepush` always plans the check, right after compile, because routes come from many packages (unit test on the plan).
  - Seam: the root `check:sdk-drift` script and `planPrepush` (exported function in `scripts/ci/prepush/plan.ts`)
  - Interface: root script `"check:sdk-drift": "bun run --cwd example-frontend sdk:check"`. Workflow `.github/workflows/sdk-drift.yml`, modelled on `.github/workflows/knip.yml`: no `paths:` filter (so `check:circleci-parity` needs no mapping), steps checkout, setup Bun 1.4.4, `bun install --frozen-lockfile`, `bun run compile`, `bun run check:sdk-drift`. It uses no secret, so it needs no secret-validation step. Prepush: one step named `sdk-drift: committed example SDK matches the backend` with command `bun run check:sdk-drift`, added unconditionally right after the compile step.
  - Cases:
    - `planPrepush` with a changed file `example-backend/src/api/todos.ts` → steps include the `sdk-drift` step, after `compile (all packages)`.
    - `planPrepush` with a changed file `admin-backend/src/adminApp.ts` → the step is present. With only `docs/README.md` changed → the step is present whenever `compile (all packages)` is.
    - `bun run check:sdk-drift` on the tree T7 left → exit 0.
    - `bun run check:circleci-parity` → exit 0.
  - Blast radius: none (adds a check; changes no state).
  - Test skills: the existing `scripts/ci/prepush/plan.test.ts` patterns
  - Docs: `docs/how-to/run-tests-locally.md` gains the row for the new job and its local command; `docs/explanation/static-analysis.md` gains one paragraph on the drift gate and how to fix a failure (`bun run --cwd example-frontend sdk`).
  - Supporting skills: update-docs

- [ ] **T9** — Scaffold apps that generate their SDK offline and check drift in CI
  - Depends on: T8, one-command-dev T13, one-command-dev T14
  - Files: create-terreno-app/template/backend/src/buildApp.ts, create-terreno-app/template/backend/src/server.ts, create-terreno-app/template/backend/package.json, create-terreno-app/template/frontend/package.json, create-terreno-app/template/frontend/store/syncdb.ts, create-terreno-app/template/frontend/store/syncDbSdk.ts, create-terreno-app/template/frontend/store/apiSdk.ts, create-terreno-app/template/minimal/frontend/store/syncDbSdk.ts, create-terreno-app/template/minimal/frontend/store/apiSdk.ts, create-terreno-app/package.json, create-terreno-app/template/root/README.md, create-terreno-app/template/root/CLAUDE.md, create-terreno-app/template/root/.github/workflows/frontend-ci.yml, create-terreno-app/src/generate.ts, create-terreno-app/src/__tests__/generate.test.ts, create-terreno-app/e2e/smoke.ts, scripts/ci/check-bootstrap-app.sh, package.json, docs/how-to/create-a-terreno-app.md, docs/reference/create-terreno-app.md, docs/testing/e2e/create-terreno-app.md, changelog/unreleased/scaffold-offline-sdk.md
  - Criteria:
    - A scaffolded backend has `src/buildApp.ts`, and its `src/server.ts` only connects, seeds and starts (unit test on generated files; E3).
    - The scaffolded frontend's `sdk` and `sdk:check` scripts run `terreno sdk`, with no `--collections` flag anywhere, and `store/syncdb.ts` takes `SYNC_COLLECTIONS` from the generated file (unit test; E3).
    - The `--minimal` scaffold, which has no synced model, ships the codegen's empty `store/syncDbSdk.ts` and still type-checks (unit test; existing compile test).
    - The scaffold's frontend CI workflow runs `sdk:check`, and this repository's `check:sdk-drift` also checks the template packages (unit test on the YAML; Roast runs the root script).
    - In an app generated and installed from this checkout, `bun run sdk` works with no backend and no MongoDB, and `bun run sdk:check` passes right after (E4). The scaffold registers `BetterAuthApp`, so this is also the proof of T2 in a real app.
  - Seam: `create-terreno-app` generator output (exported generate function), the compiled bin, and `scripts/ci/check-bootstrap-app.sh`
  - Interface: this task edits the template source tree that `one-command-dev` T8–T13 create (`create-terreno-app/template/{root,backend,frontend}/`); before that plan lands the same content lives as template literals in `create-terreno-app/src/generate.ts`, and this task must not start. Changes: `backend/src/buildApp.ts` (new): `export const buildApp = (options?: {skipListen?: boolean}): TerrenoApp` holding the `TerrenoApp` constructor and every `.register(...)` now in the template's `server.ts`, with two marker comments the resource generator inserts at: `// terreno:router-imports` after the last `./api/*` import and `// terreno:routers` after the last model router registration. The template's Todo example lines keep their `// terreno:example-start` / `// terreno:example-end` wrapping. `backend/src/server.ts`: `start()` awaits the database work it does today, then `buildApp({skipListen}).start()`. `backend/package.json` scripts gain `"openapi": "terreno-openapi --app ./src/buildApp.ts --out -"`. `frontend/package.json`: `"sdk": "terreno sdk"`, `"sdk:check": "terreno sdk --check"`, `api-sdk` and `sync-sdk` as aliases of `sdk` (replacing the `--collections todos` script `one-command-dev` T11 adds); devDependency `@terreno/cli` at the same version as the other Terreno packages. `frontend/store/syncDbSdk.ts` and `apiSdk.ts`: regenerated with `terreno sdk` against the template backend and committed; for `--minimal` the generator writes a second committed pair, `create-terreno-app/template/minimal/frontend/store/{syncDbSdk,apiSdk}.ts`, produced by running `terreno sdk` against the template backend with its example lines stripped (a `bun run --cwd create-terreno-app sdk:minimal` script does the strip into a temp directory and the run). Both pairs are checked by the root `check:sdk-drift`. `frontend/store/syncdb.ts`: `collections: [...SYNC_COLLECTIONS]` imported from `@/store/syncDbSdk`. Frontend CI workflow: a step that installs the backend's dependencies and runs `bun run sdk:check`. `README.md` and `CLAUDE.md` name `bun run sdk` as the step after any backend change and say it needs no running backend. Root `package.json`: `check:sdk-drift` also runs `bun cli/src/bin.ts sdk --check --backend create-terreno-app/template/backend --frontend create-terreno-app/template/frontend`.
  - Cases:
    - Generated file list includes `backend/src/buildApp.ts`; that file contains `export const buildApp`, `// terreno:router-imports`, `// terreno:routers`, and contains neither `connectToMongoDB` nor `await `.
    - Generated `backend/src/server.ts` contains `buildApp(` and `connectToMongoDB()` and no `.register(`.
    - Generated `frontend/package.json`: `scripts.sdk === "terreno sdk"`, `scripts["sdk:check"] === "terreno sdk --check"`, no script contains `--collections`, `devDependencies["@terreno/cli"]` is set.
    - Default scaffold: `frontend/store/syncDbSdk.ts` lists `"todos"` in `SYNC_COLLECTIONS`. `--minimal`: it contains `export const SYNC_COLLECTIONS = [] as const;` and no `todos`. Both: `frontend/store/syncdb.ts` contains `from "@/store/syncDbSdk"` and no hand-written collection array.
    - The generated frontend CI workflow contains `bun run sdk:check`.
    - `bun run check:sdk-drift` at the repository root exits 0 and its output names the example, the template and the minimal-template checks.
    - Neither generated variant contains `terreno:example-start` (existing `one-command-dev` case stays true); both keep the two `terreno:router` markers.
    - `scripts/ci/check-bootstrap-app.sh`, after the installs and before it starts the app, with `MONGO_URI` unset: `cd frontend && bun run sdk:check` exits 0 on the files as scaffolded (so a new app's first CI run passes), then `bun run sdk` exits 0 and leaves the two files byte-identical. The script does this for the default scaffold and for a second `--minimal` scaffold. Roast runs the script when the network allows; otherwise the row is recorded as deferred with that command and accepted only once the `Bootstrap app check` workflow passes on the branch.
    - Smoke: generated backend bundle still builds; every import in the generated backend is declared in its `package.json` (existing checks).
  - Blast radius: every newly scaffolded app → the package smoke, the template packages' own lint, type-check and tests (they are root workspaces after `one-command-dev` T8–T9), and the bootstrap check. `one-command-dev` T10's route tests and T11's Playwright spec import or boot `server.ts`; they must pass unchanged. Existing apps are untouched; `docs/how-to/create-a-terreno-app.md` gains an "Adopt offline SDK generation in an existing app" section with the three moves (split `buildApp`, add the scripts, import `SYNC_COLLECTIONS`).
  - Test skills: terreno-backend-tests (bun unit tests), the smoke conventions in `docs/testing/e2e.md`
  - Docs: the three pages in Files.
  - Supporting skills: update-docs
  - Coordination: `one-command-dev` owns the scaffold template. This task lands after its T13 (template tree, synced Todo, root `package.json` with `@terreno/cli`) and T14 (which also rewrites `scripts/ci/check-bootstrap-app.sh`). If `one-command-dev` is dropped or reordered, this task is re-planned against `create-terreno-app/src/generate.ts` as it is today; T1–T8 do not depend on it.

## Assumptions

- `TerrenoApp.build()` is synchronous and the OpenAPI document is produced by walking the built
  router (`api/src/terrenoApp.ts:396,471`; `api/src/vendor/wesleytodd-openapi/index.js:46`), so a
  spec needs no listener. Verified by reading; T1 proves it.
- Mongoose models can be defined and model routers registered without a connection. Not
  verified by running (the audit and this plan are read-only); T1 and T3 are the proof. One
  plugin is known not to: `BetterAuthApp.register()` and `TerrenoApp.build()` call
  `ensureAuth()`, which needs `mongoose.connection.client` and throws `Mongoose is not
  connected` (`api/src/betterAuthApp.ts:72-86,114`, `api/src/betterAuthSetup.ts:1348-1356`,
  `api/src/terrenoApp.ts:446`). Better Auth is the default in the example and the scaffold, so
  T2 fixes it before anything else builds on the offline path.
- The `api-foundations` group owns replacing the router walk with a route-metadata registry.
  `buildOpenApiDocument` is a wrapper over whatever produces the document, so that refactor
  changes its inside, not its signature or the bin.
- The bin ships as TypeScript source run by Bun, like `terreno-migrate` and
  `terreno-syncdb-codegen` already do.
- Running `bun ../cli/src/bin.ts` from `example-frontend` needs compiled workspace packages, as
  `bun run typecheck` already does; the drift workflow runs `bun run compile` first.
- Policy checks such as Knip run on GitHub Actions only (`.github/workflows/knip.yml`; no
  CircleCI job names them), so the drift gate follows that pattern.
- Spec content depends on environment variables the example reads at registration
  (`AUTH_PROVIDER`, `NODE_ENV`, `BACKEND_SERVICE`, `COMMS_ENABLED`, `MCP_OAUTH_ENABLED`, and
  more), and Bun loads `backend/.env` on its own. The gate is deterministic only because T6
  builds the spec in a child with a fixed environment and `.env` loading off. The exact Bun
  mechanism for the pinned version (1.4.4) is for the implementer to confirm; if there is
  none, the bin removes the keys a `.env` file in the working directory defines before
  importing the app, and T6 gains a case for it.
- The committed example SDK was generated from a live backend with a developer's
  environment, so the first offline regeneration may differ in `apiSdk.ts` beyond `projects`.
  T7 lists that difference instead of assuming it is empty.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q1 (fundamental) | Offline generation needs each app to export a database-free `buildApp`, and needs framework plugins to register without a database (`BetterAuthApp` does not today; T2 changes it). Is that contract acceptable, or should the command boot the real server against an in-memory MongoDB instead? | The `buildApp` contract, with `--schema <url>` kept for apps that have not adopted it | No `mongod` download, runs in any sandbox and in a plain CI job, and the split also makes route tests simpler. The cost: a public contract every adopter migrates to, and one change inside Better Auth setup | The bin and `buildOpenApiDocument` are replaced by a spawn of `mongodb-memory-server` plus the app's `start(true)`; T1 and T3 are rewritten, T2 is dropped, T6–T9 keep their shape, the drift job gets slower and needs the Mongo binary cache | T1, T2, T3, T9 |
| Q2 | The backend already syncs `projects`; the example frontend's hand-typed list leaves it out. Should the example app sync it once the list is derived? | Yes; put it in the product store only | The backend declares it and `RealtimeApp` is configured for its tenant stream (`example-backend/src/server.ts`, the `userModel` comment); hiding it again needs an explicit exclude | Add `"excludeCollections": ["projects"]` to `example-frontend/syncdb-codegen.json` with a one-line reason in the SDK how-to; nothing else changes | T7 |
| Q3 | When no collection is synced, should the codegen fail (today) or write an empty file with a warning? | Write the empty file | A `--minimal` scaffold, and any app before its first synced model, must still compile against a generated `SYNC_COLLECTIONS` | Keep the error; the minimal scaffold keeps a hand-written `SYNC_COLLECTIONS` until its first resource, and the resource generator must rewrite that file | T4, T9 |
| Q4 | Should the drift gate run on every pull request, or only when backend, api, syncdb or example-frontend paths change? | Every pull request, GitHub Actions only | Routes come from many packages (admin, ai, jobs, comms), so a path filter would miss real drift; the job is install, compile and one command | Add a `paths:` filter and the matching CircleCI path mapping that `check:circleci-parity` requires | T8 |
| Q5 | Should `api-sdk` and `sync-sdk` remain as script names? | Keep both as aliases of `sdk` | `CLAUDE.md`, skills and adopter habits name them; aliases cost two lines | Remove them and sweep every doc and skill that names them | T7, T9 |
| Q6 | The example registers its agent harness routes only after opening the harness against a replica set. Offline there is no database. Should those routes be in the offline spec? | Yes: register `HarnessApp` in `buildApp` and open the harness later in `start()` | The frontend's harness screens use generated hooks; a spec without them would delete hooks the app imports | If `HarnessApp` cannot be registered before its harness is open, T3 stops and reports, and the fix becomes a task in `@terreno/ai` (deferred open) before T3 can finish | T3, T7 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Type `syncDb.mutate({collection})` and `useQuery` collection names against the generated union, and replace the string collection names in `example-frontend/app/notifications.tsx` and `components/NotificationCenter.tsx` with generated hooks | Audit `code-refactoring.md` finding 10, last sentence | M | T7 |
| X2 | Emit the spec from a route-metadata registry instead of the Express stack walk | Audit finding owned by `api-foundations`; suggested slug `api-foundations` | L | none |
| X3 | A `terreno sdk --watch` that regenerates when backend route or model files change | Natural next step once generation is offline; pairs with `one-command-dev` | S | T6 |
| X4 | Adopt `buildApp` and the drift gate in Flourish and other existing apps | The Elephant line | M per app | T6 |
| X5 | Remove `--collections` from the codegen after one release of deprecation | It is now only a filter | S | T4 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |

None.

## Corrections to the audit

- The audit says the synced-collection list should be derived "from the spec (an
  `x-terreno-sync` extension) instead of a flag". The extension and the derivation already
  exist (`api/src/openApi.ts:185`, `syncdb/src/codegen/discoverCollections.ts:131-146`). The
  drift comes from the example script passing `--collections` as an allowlist, which filters
  out `projects`, and from the scaffold hard-coding `SYNC_COLLECTIONS: string[] = []`
  (`create-terreno-app/src/generate.ts:2421`). `one-command-dev` T11 plans a scaffold
  `sync-sdk` script with `--collections todos`, which would repeat the pattern; T9 replaces it. The plan removes the allowlist and the
  hand-typed constant instead of building derivation.
- Confirmed as written: both generators default to `http://localhost:4000/openapi.json`
  (`example-frontend/package.json` `api-sdk`, `sync-sdk`); `projects` is synced on the backend
  (`example-backend/src/api/projects.ts:63`) and missing from
  `example-frontend/store/syncDbSdk.ts`; no workflow or script compares the committed SDK.

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds (fresh subagents), 17 findings: 15 fixed, 2 moved to questions (Q1 promoted to fundamental, harness routes to Q6), 0 rebutted. One nit left as is: T9 stays one task (it could split into template and CI halves).
Couldn't assess, carried as assumptions: whether Better Auth creation or any of the example's other plugins touches MongoDB at registration (T2 and T3 are reproduce-first and stop if so); whether the offline example spec under the fixed environment keeps every hook the app imports (T7 lists the diff).
