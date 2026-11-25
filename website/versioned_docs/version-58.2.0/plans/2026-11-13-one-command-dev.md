# One command from zero to a running, synced app

Getting a Terreno app running today takes three prerequisites (Bun, a hand-installed
`mongod`, Node for a one-liner), ten commands and three long-running processes, and one of
the documented commands fails. What the developer has at the end is a login screen and an
empty home page: the scaffold never shows the framework's core loop, a synced model. This
plan makes Bun the only prerequisite, cuts the path to two commands in one terminal, and
makes the first screen after login a todo list that syncs. The scaffold stops being a
2,695-line string template and becomes real source that the repository typechecks and
lints. New adopters, their coding agents and first-time contributors feel it first.

## The idea

Three seams change.

1. **`terreno dev`**, a new command in `@terreno/cli`. Run from an app root, it reads
   `MONGO_URI` from `backend/.env`, checks what is listening there, starts its own
   single-node replica-set `mongod` when nothing is (binary fetched once, data kept in
   `.terreno/dev/mongo`), seeds that database once, then runs the backend and the
   web app as children with prefixed output, and stops everything on Ctrl-C. The scaffold
   gains a root `package.json` whose `dev` script is `terreno dev`; the monorepo root gains
   the same script pointed at `example-backend` and `example-frontend`.
2. **The scaffold template is source code.** `create-terreno-app/template/backend` and
   `template/frontend` are workspace packages with real `.ts`/`.tsx` files. The generator
   copies them with three token substitutions and resolves `catalog:` / `workspace:*` to
   concrete versions at build time. The template ships one synced `Todo` end to end;
   `--minimal` strips it.
3. **Startup tells you what is wrong.** `@terreno/api` gains a Mongo deployment check that
   turns "connection error" into "this is a standalone mongod; sync needs a replica set;
   run `terreno dev` or start it with `--replSet rs0`", and Better Auth reports every
   missing variable in one error.

`@terreno/cli` is not released today (see Corrections), so the release pipeline is fixed
first: the scaffold cannot depend on a package that is not on npm.

Rejected: wrapping `mongodb-memory-server`'s `MongoMemoryReplSet` directly. It picks a
random port and owns the replica-set config, so `MONGO_URI` would change on every run and
the `.env` value would be a lie. The plan uses only its binary downloader and spawns
`mongod` itself on the port already in `MONGO_URI`. Also rejected: Docker Compose as the
default, because it adds a prerequisite.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | `terreno dev` runs the backend and web app in one terminal | none | cli | unit tests on `runDevCommand` with an injected spawner |
| T2 | `terreno dev` starts a persistent replica-set Mongo when none is reachable | T1, T6 | cli | unit tests on `ensureDevMongo`; `cli/e2e/devSmoke.ts` |
| T3 | `terreno dev` seeds a database it manages, once | T2 | cli | unit tests; `cli/e2e/devSmoke.ts` |
| T4 | Startup reports a non-replica-set Mongo and all missing auth variables in one message each | none | api | api unit tests against in-memory standalone and replica-set Mongo |
| T5 | The example backend explains a failed Mongo connection | T4 | example-backend | example-backend unit test |
| T6 | Release `@terreno/cli` in lockstep and resolve every `workspace:*` dependency | none | CI config, scripts | `scripts/ci/publish-lockstep-packages.test.ts`, `prepare-package-publish.test.ts` |
| T7 | `bun run dev` at the monorepo root starts the example stack | T3, T8 | root, docs | `cli/e2e/devSmoke.ts` run from the root |
| T8 | The scaffold backend is generated from typechecked, linted source | T6 | create-terreno-app | root lint and typecheck; `generatedApp.compile.test.ts`; smoke |
| T9 | The scaffold frontend is generated from typechecked, linted source | T8 | create-terreno-app | same, frontend half |
| T10 | The scaffold backend ships a synced `Todo` | T8, T4 | create-terreno-app template | template backend route tests |
| T11 | The scaffold frontend lists and edits todos through SyncDB | T9, T10, T3 | create-terreno-app template | template screen test; Playwright spec run against the template packages |
| T12 | `--minimal` generates the scaffold without the `Todo` example | T11, T3 | create-terreno-app, cli | generator tests; compile test on the minimal output |
| T13 | The scaffold has a root `bun run dev` and installs on create | T3, T6, T12 | create-terreno-app, cli | generator and CLI tests |
| T14 | A generated app reaches a synced todo with two commands | T13 | scripts/ci | `scripts/ci/check-bootstrap-app.sh` |

Tracer: `terreno dev` → spawn backend and web children → health check → ready banner → clean shutdown (T1).
E2E: 3 rows (process+http smoke for `terreno dev`, process+http bootstrap check, browser spec in the generated app).
Regression: None — no hard-to-automate change; the macOS first run is automated on a macOS runner (E2).
User guide: None — developer tooling; nothing an example-app end user sees changes.
Design: None — no canvas.
Out of scope: `terreno generate resource`, MCP scaffold tool, offline SDK generation, tutorial rewrite, legacy JWT removal, template variants, Docker Compose, `--reset`; see Expansions.
Fundamental question: none open. Q1 was answered on 2026-11-13: manage a real `mongod` now (D1).
Open risks: the cause of the missing `@terreno/cli` release is confirmed in code but the npm registry state is not (T6 checks it first); making the template two more workspace packages changes knip, dependency-cruiser and CI path filters (T8).
Elephant: "Bun is the only prerequisite" now depends on MongoDB publishing a `mongod` binary for the developer's OS and on a 100 MB+ first-run download succeeding; and the SQLite driver plan (`2026-11-01-sqlite-mongoose-driver`, awaiting sign-off) would remove the need for a managed `mongod` in dev entirely, so two plans are solving "no mongod" in different ways.

## Corrections to the audit

Each finding was re-read against the code at `6cf1f06c`.

- **1.4 is misdiagnosed.** `publish-cli` has not been failing. Releases run on CircleCI
  (`.circleci/continue-config.yml`, job `publish-release`; the 58.0.4 bump commit is
  authored by `terreno-circleci`), and its three package lists (lines 2529, 2551, 2576)
  never included `cli`. The GitHub workflow `publish-on-tag.yml` is a fallback whose last
  run was `57.21.0` on 2026-11-02 (failed). So `@terreno/cli` is not stuck behind a broken
  job; it has not been in the release since the release moved to CircleCI. No
  reproduce-first task is needed for the cause. The registry state (which `@terreno/cli`
  versions exist on npm) could not be read from the sandbox and is the first step of T6.
- **1.4, the `workspace:*` bug, is real only in the fallback.** The CircleCI path uses
  `scripts/ci/prepare-package-publish.mjs`, which already resolves `create-terreno-app`
  (line 46). Only `publish-on-tag.yml:1588` (the `publish-cli` job) has the
  `@terreno/`-only rewrite. Neither path resolves an arbitrary `workspace:*` key.
- **1.5, "no typecheck", is half right.** `create-terreno-app/src/__tests__/generatedApp.compile.test.ts`
  runs `tsc --noEmit` on a generated app (skipped when the workspace is not compiled), and
  `scripts/ci/check-bootstrap-app.sh` type-checks and exports one weekly and on every tag.
  There is no lint, knip, source-rules or barrel check on the generated code, and the
  barrels, `function` declarations, casts and `@types/express ^4` are all there as
  reported.
- **1.7, the env half, points at dead code.** `setupEnvironment`
  (`api/src/expressServer.ts:111-130`) is called only by its own test. At startup the only
  required-variable checks are Better Auth's (`api/src/betterAuthSetup.ts:197-210`), which
  throw for `BETTER_AUTH_SECRET` and then `BETTER_AUTH_URL` one at a time. The legacy JWT
  secrets are never validated at startup; a missing `TOKEN_SECRET` silently skips the JWT
  strategy (`api/src/auth.ts:569`). The plan aggregates the Better Auth checks and leaves
  the JWT secrets to `api-foundations`, which removes them.
- **1.7, the Mongo half, holds** but the failure is in app code, not `TerrenoApp`: the app
  calls `mongoose.connect` in its own `utils/database.ts` before `TerrenoApp` exists. A
  check inside `TerrenoApp` alone would never run for the reported case, so T4 exports a
  diagnosis function the app's `database.ts` calls.
- **1.5, the deprecated `permissions` form,** is real on the scaffold's user router. It is not fixed here: the two permission systems are `api-foundations`' finding, and the scaffold changes when the replacement form is settled. The new `Todo` router uses the form the example app uses.
- **1.1 and 1.2 hold as reported.**

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `cli/e2e/devSmoke.ts` | process, http | From the monorepo root, the compiled `terreno dev --backend example-backend --no-web` reaches `GET /health` → `healthy: true` on a free port, and SIGINT exits 0 with the backend port closed | T2 (extended in T3, T7) |
| E2 | `scripts/ci/check-bootstrap-app.sh` (Linux and macOS runners) | process, http | A freshly generated app reaches a healthy backend and a served web app with `bun run dev`, the seeded user can log in, and a todo created over REST is listed | T14 |
| E3 | `create-terreno-app/template/frontend/e2e/todos.spec.ts` | browser | A logged-in user adds a todo, sees it in the list, and still sees it after a reload | T11 (against the template packages; run again in the generated app by T14) |

E1 is a second smoke file in `cli/e2e/` because the existing `smoke.ts` must stay offline
(`docs/testing/e2e/cli.md`); T2 adds a `dev:smoke` script and documents it on that page.

## Regression cases

None — no hard-to-automate change. The one check that looked manual (first run on a Mac
with no MongoDB: binary download, ready banner, clean teardown) runs as E2 on a hosted
macOS runner, weekly and on tags (T14).

## User guide

None — developer tooling. `docs/user-guide/` describes the example app to its end users,
and nothing they see changes. Developer-facing pages are listed per task under `Docs:`.

## Design

None — no canvas. The scaffold's Todos screen is built from existing `@terreno/ui`
components (`Page`, `Box`, `TextField`, `Button`, `CheckBox`, `Text`).

## Tasks

- [ ] **T1** — Add `terreno dev` to run the backend and web app in one terminal
  - Depends on: none
  - Files: cli/src/commands/dev.ts, cli/src/commands/dev.test.ts, cli/src/dev/processes.ts, cli/src/dev/envFile.ts, cli/src/runCli.ts, cli/src/help.ts, docs/reference/cli.md, changelog/unreleased/terreno-dev-command.md
  - Criteria:
    - `terreno dev` from a directory with `backend/package.json` (script `dev`) and `frontend/package.json` (script `web`) starts both with `bun run`, each in its own directory, and prefixes every output line with `[api]` or `[web]`. Verified by unit test with an injected spawner.
    - The web child's environment has `EXPO_PUBLIC_API_URL=http://localhost:<PORT>` unless the caller's environment already sets it, so the web app calls the port the backend listens on. Verified by unit test on the spawner's `env`.
    - It polls `GET http://127.0.0.1:<PORT>/health` (PORT from `backend/.env`, else `4000`) every 500 ms for up to 60 s, then prints one ready banner with the API URL and `http://localhost:8082`. Verified by unit test with an injected fetch.
    - When either child exits, the other is stopped and the command returns the child's exit code (1 when that is 0 before a signal). On SIGINT or SIGTERM both children get SIGTERM and the command returns 0. Verified by unit test.
    - `terreno dev --help` and the top-level help list the command and its flags. Verified by unit test.
  - Seam: `runDevCommand(parsed, io, json, deps)` exported from `cli/src/commands/dev.ts`, reached through `runCli(["dev", ...])`
  - Interface: `terreno dev [--backend <dir>] [--frontend <dir>] [--no-web]`. Defaults `./backend`, `./frontend`. `deps` is `{spawn, fetch, onSignal, sleep}`, each defaulting to the real implementation; `spawn({command: string[], cwd: string, env: Record<string,string>, onLine: (line: string) => void}) → {exited: Promise<number>, kill: (signal: string) => void}`. Returns the process exit code.
  - Cases:
    - both dirs present, health answers 200 `{healthy: true}` on the second poll → spawner called with `["bun","run","dev"]` in `backend` and `["bun","run","web"]` in `frontend`; stdout contains `Ready`, `http://localhost:4000` and `http://localhost:8082`; lines from the backend child appear as `[api] <line>`
    - `--no-web` → only the backend is spawned; the banner omits the web URL
    - `backend/` missing → exit 1, stderr `No backend found at <abs path>. Run terreno dev from your app root or pass --backend <dir>.`; nothing spawned
    - `backend/package.json` has no `dev` script → exit 1, stderr names the missing script
    - `backend/.env` has `PORT=4100` → health polled on 4100, the banner shows 4100, and the web spawn's `env.EXPO_PUBLIC_API_URL` is `http://localhost:4100`
    - `EXPO_PUBLIC_API_URL=https://api.example.test` already in the environment → passed through unchanged
    - backend child exits 3 before health → web child gets SIGTERM; command returns 3
    - health never answers in 60 s (injected clock) → both children get SIGTERM; exit 1; stderr `The backend did not answer /health within 60 s. Its output is above.`
    - SIGINT after ready → both children get SIGTERM; command returns 0
    - `terreno help dev` → text contains `--backend`, `--frontend`, `--no-web`
    - `process.platform` injected as `win32` → exit 1, stderr `terreno dev is not supported on native Windows yet. Use WSL.`; nothing spawned
  - Blast radius: none (new command; `runCli` gains one `case`)
  - Test skills: terreno-backend-tests (CLI tests follow `cli/src/commands.test.ts`: `runCli` with an injected `CliIo`)
  - Docs: `docs/reference/cli.md` gains a `dev` section.

- [ ] **T2** — Start a persistent replica-set Mongo from `terreno dev` when none is reachable
  - Depends on: T1, T6 (T6 also writes `cli/package.json`)
  - Files: cli/src/dev/mongo.ts, cli/src/dev/mongo.test.ts, cli/src/commands/dev.ts, cli/src/commands/dev.test.ts, cli/src/help.ts, cli/package.json, cli/e2e/devSmoke.ts, example-backend/package.json, .gitignore, docs/reference/cli.md, docs/testing/e2e/cli.md, docs/testing/e2e.md
  - Criteria:
    - `terreno dev` resolves the Mongo URI from `process.env.MONGO_URI`, else `backend/.env`, else `mongodb://127.0.0.1:27017/<backend dir's parent name, hyphens to underscores>?replicaSet=rs0`, and classifies what is listening as `replicaSet`, `standalone`, `unreachable` or `wrongSetName`. Verified by unit tests against in-memory Mongo servers.
    - `unreachable` on a loopback host (`127.0.0.1`, `localhost`, `::1`): it obtains a `mongod` binary through `MongoBinary.getPath()` from `mongodb-memory-server-core`, spawns it with `--replSet <name> --port <port> --bind_ip 127.0.0.1 --dbpath <data dir>/mongo`, runs `replSetInitiate` once (ignoring `AlreadyInitialized`, code 23), waits for a primary, and passes `MONGO_URI` to both children with the host rewritten to `127.0.0.1` (the managed `mongod` binds IPv4 loopback only, and `localhost` can resolve to `::1`). Stopping the command stops a `mongod` it started and leaves one it did not. Verified by `cli/e2e/devSmoke.ts` and unit tests with an injected spawner.
    - A second run reuses the same data directory: a document written in run one is readable in run two. Verified by `cli/e2e/devSmoke.ts`.
    - `replicaSet` → nothing is started; the banner says `Using MongoDB at <host>:<port>`.
    - `standalone`, `wrongSetName`, and `unreachable` on a non-loopback host → exit 1 before any child starts, with the messages in Cases. The command never starts `mongod` for, and never writes to, a non-loopback host. Verified by unit tests.
    - Before the first download it prints `Downloading MongoDB (one time, about 100 MB)...`. Verified by unit test with an injected binary resolver.
    - `example-backend`'s `dev` script no longer hardcodes the port: it is `bun run --watch src/index.ts`, and the port comes from `PORT` (`example-backend/.env` already sets it). Without this a `PORT` override is ignored and the health poll watches the wrong port. Verified by `devSmoke.ts`, which runs on a free port and asserts `/health` answers on that port and nothing listens on 4000.
  - Seam: `probeMongo({uri}) → {kind, setName?}` and `ensureDevMongo({uri, dataDir, io, deps}) → {uri, managed: boolean, stop: () => Promise<void>}` exported from `cli/src/dev/mongo.ts`; `runDevCommand` for the wiring
  - Interface: `terreno dev [--data-dir <dir>]`: the state directory, default `<cwd>/.terreno/dev`, a relative value resolved against the working directory. It holds `mongo/` (the `--dbpath`), `mongod.log` and, from T3, `seeded`. `ensureDevMongo`'s `dataDir` is this directory. `probeMongo` connects with `directConnection=true` and a 2 s server-selection timeout and runs `hello`. `deps` is `{resolveBinary, spawn}`. Messages are exact strings (below).
  - Cases:
    - URI points at a `MongoMemoryReplSet` named `rs0` → `{kind: "replicaSet", setName: "rs0"}`; `ensureDevMongo` returns `managed: false` and spawns nothing
    - URI points at a `MongoMemoryServer` (standalone) → `kind: "standalone"`; `runDevCommand` exits 1 with `MongoDB at 127.0.0.1:<port> is a standalone server. Terreno sync and realtime need a replica set. Stop it and run terreno dev again (it starts one for you), or restart it with --replSet rs0 and run rs.initiate().`
    - URI `...?replicaSet=rs0` against a set named `other` → `kind: "wrongSetName"`; exit 1 with `MongoDB at <host>:<port> is replica set "other" but MONGO_URI asks for "rs0". Change replicaSet= in backend/.env.`
    - nothing listening on a free loopback port → resolver and spawner called once; spawner args include `--replSet rs0`, `--port <port>`, `--dbpath <dataDir>/mongo`, `--bind_ip 127.0.0.1`; result `managed: true`
    - URI host `localhost`, nothing listening → managed; returned `uri` host is `127.0.0.1`, same port, database and options
    - nothing listening at `mongodb://db.internal.example:27017/app?replicaSet=rs0` → exit 1 with `Cannot reach MongoDB at db.internal.example:27017. terreno dev only starts a local MongoDB; check MONGO_URI in backend/.env.`; resolver and spawner never called
    - `mongodb+srv://` URI that is unreachable → same non-loopback message; never managed
    - binary resolver rejects → exit 1 with `Could not download a MongoDB binary for this platform (<error>). Install MongoDB yourself and start it with --replSet rs0, or set MONGO_URI to a replica set.`
    - `stop()` on a managed instance sends SIGTERM to `mongod` and resolves after it exits; on `managed: false` it resolves without signalling anything
    - `devSmoke.ts`: with `MONGO_URI` at a free loopback port and a temp `--data-dir`, run one inserts a marker through the driver, SIGINT, run two reads it back; after each SIGINT the Mongo port refuses connections
  - Blast radius: `.terreno/dev/` is new on disk → root `.gitignore` gains `.terreno/dev/`. `cli/package.json` gains `mongodb` (`catalog:`) and `mongodb-memory-server-core` (`^11.3.0`, the range `test/package.json` uses; no root `package.json` change); the root `overrides` already pin `mongodb` 7.2.0 and `bson` for Bun.
  - Test skills: terreno-backend-tests, terreno-test-setup (in-memory Mongo from `@terreno/test`)
  - Docs: `docs/reference/cli.md` (`dev` flags `--data-dir`, messages), `docs/testing/e2e/cli.md` and the package table in `docs/testing/e2e.md` (new `dev:smoke`).

- [ ] **T3** — Seed a database that `terreno dev` manages, once
  - Depends on: T2
  - Files: cli/src/commands/dev.ts, cli/src/commands/dev.test.ts, cli/src/help.ts, cli/e2e/devSmoke.ts, docs/reference/cli.md
  - Criteria:
    - When `ensureDevMongo` returns `managed: true`, the marker file `<data dir>/seeded` (default `.terreno/dev/seeded`) does not exist, and the backend has a `seed` script, `terreno dev` runs `bun run seed` in the backend directory, with output prefixed `[seed]`, before starting the backend, and the ready banner lists `test@example.com` and `admin@example.com` only when the seed ran. The marker is written only after the seed exits 0, so a first run that is interrupted or fails seeds again next time. Verified by unit test.
    - It does not seed when the marker exists, when Mongo is not managed, or with `--no-seed`. When Mongo is a replica set it did not start and no marker exists, the banner says `Using your own MongoDB at <host>:<port>; not seeded. Run bun run seed (in backend/) for the test logins.` instead of listing logins. `--seed` forces a seed on a loopback host and is refused on a non-loopback host. Verified by unit tests.
    - A failing seed stops the run with the seed's exit code and stops a managed `mongod`. Verified by unit test.
  - Seam: `runDevCommand` through `runCli`
  - Interface: `terreno dev [--seed | --no-seed]`
  - Cases:
    - managed, no marker, backend has `seed` → spawn order is seed, then backend, then web; banner contains `Seeded logins`; marker file exists afterwards
    - managed, marker present → no seed spawn; banner has no logins
    - managed, no marker, no `seed` script → no seed spawn, no error, no marker
    - `--no-seed`, managed, no marker → no seed spawn, no marker
    - `managed: false` on `127.0.0.1`, no flag → no seed spawn; stdout contains `not seeded. Run bun run seed`
    - `--seed` with `managed: false` on `127.0.0.1` → stdout `Seeding database <name> at 127.0.0.1:<port>` and the seed runs
    - `--seed` with `MONGO_URI` host `db.internal.example` (reachable replica set) → exit 1, `Refusing to seed a non-local database (db.internal.example). Run the seed script yourself if you mean it.`; nothing spawned
    - `--seed --no-seed` → exit 1, `Pass --seed or --no-seed, not both.`
    - seed child exits 2 → backend never spawned; managed `stop()` called; command returns 2; no marker; the next run seeds again
    - SIGINT while the seed runs → no marker; the next run seeds again
    - `--seed` with the marker present → seed runs; marker rewritten
    - `devSmoke.ts`: first run's stdout contains `[seed]`; second run's does not
  - Blast radius: the seed writes users with a known password. The cases above pin that it can only ever run automatically against a database this command manages on loopback.
  - Test skills: terreno-backend-tests
  - Docs: `docs/reference/cli.md` notes that a loopback address can be a tunnel to a shared database, and that `--seed` writes users with a known password to whatever is there.

- [ ] **T4** — Report a non-replica-set Mongo and every missing Better Auth variable in one message
  - Depends on: none
  - Files: api/src/mongoDiagnosis.ts, api/src/mongoDiagnosis.test.ts, api/src/terrenoApp.ts, api/src/terrenoApp.test.ts, api/src/betterAuthSetup.ts, api/src/betterAuthSetup.test.ts, api/src/index.ts, docs/reference/api.md, docs/reference/environment-variables.md, docs/explanation/deployment-baseline.md, changelog/unreleased/startup-diagnosis.md
  - Criteria:
    - `describeMongoConnectionFailure({uri, error})` returns one message that names the cause (`standalone`, `wrongSetName`, `unreachable`, or `unknown`) and the fix. Verified by unit tests against in-memory Mongo.
    - When `TerrenoApp` starts with `skipListen` false, a `SyncApp` or `RealtimeApp` registered, and mongoose connected to a server whose `hello` has no `setName`, it logs one `error` line with the standalone message and keeps starting. It logs nothing for a replica set, and nothing when `skipListen` is true. Verified by `terrenoApp.test.ts`.
    - With both `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` unset and neither in config, Better Auth setup throws one `APIError` whose title names both. With one unset it names that one. Verified by `betterAuthSetup.test.ts`.
  - Seam: exported functions `describeMongoConnectionFailure` and `checkMongoDeployment` from `@terreno/api`; `TerrenoApp.start()`; `createBetterAuth` (the function the existing tests at `betterAuthSetup.test.ts:133-162` call)
  - Interface: `describeMongoConnectionFailure({uri: string, error: unknown}) → Promise<{kind: "standalone" | "wrongSetName" | "unreachable" | "unknown", message: string}>`; it probes `uri` with `directConnection=true` and a 2 s timeout and never throws. `checkMongoDeployment() → Promise<{isReplicaSet: boolean, setName?: string}>` reads the current mongoose connection. Messages never include credentials: any `user:pass@` in the URI is replaced with `***@`.
  - Cases:
    - standalone in-memory server, URI with `?replicaSet=rs0` → `kind: "standalone"`, message `MongoDB at 127.0.0.1:<port> is a standalone server, but sync and realtime need a replica set (a single node is enough). Run terreno dev to start one, or restart mongod with --replSet rs0 and run rs.initiate(). See https://github.com/TerrenoLabs/terreno/blob/master/docs/explanation/deployment-baseline.md`
    - replica set `rs0`, URI `?replicaSet=other` → `kind: "wrongSetName"`, message contains `"rs0"` and `"other"`
    - free port → `kind: "unreachable"`, message contains `Nothing is listening at 127.0.0.1:<port>` and `terreno dev`
    - URI `mongodb://alice:secret@127.0.0.1:<free port>/app` → message contains `***@` and not `secret`
    - malformed URI → `kind: "unknown"`, message contains the original error text
    - `TerrenoApp` + `RealtimeApp`, standalone, `skipListen: false` → logger `error` called once with the standalone message; `whenReady()` resolves
    - same with a replica set → no such log
    - same standalone with `skipListen: true` → no such log (existing suites run on standalone in-memory Mongo)
    - no secret, no URL → error title `BETTER_AUTH_SECRET and BETTER_AUTH_URL must be set in env (or pass config.secret and config.baseURL).`
    - secret only missing → title contains `BETTER_AUTH_SECRET` and not `BETTER_AUTH_URL`; existing assertions `"BETTER_AUTH_SECRET must be set"` / `"BETTER_AUTH_URL must be set"` are updated to the new wording
  - Blast radius: every app that calls Better Auth setup sees the new error wording (text only; status stays 500). The standalone check logs and does not throw, so apps and test suites on standalone Mongo keep starting (Q4).
  - Test skills: terreno-backend-tests
  - Docs: `docs/reference/api.md` (two new exports), `docs/reference/environment-variables.md` (Better Auth error), `docs/explanation/deployment-baseline.md` (what the message means). The URL is a constant `DEPLOYMENT_BASELINE_URL` defined in `api/src/mongoDiagnosis.ts`, the same GitHub URL the scaffold links to today.

- [ ] **T5** — Explain a failed Mongo connection in the example backend
  - Depends on: T4
  - Files: example-backend/src/utils/database.ts, example-backend/src/utils/database.test.ts, example-backend/README.md
  - Criteria:
    - When `mongoose.connect` rejects, `connectToMongoDB` logs the message from `describeMongoConnectionFailure` at `error` level and rethrows the original error. Verified by unit test.
    - `example-backend/README.md` no longer tells the reader to run a standalone `docker run mongo`; it says `bun run dev` from the repository root, with the replica-set `mongod` command as the manual alternative. Verified by a test that asserts the README does not contain `docker run -d -p 27017:27017 --name mongodb mongo`.
  - Seam: `connectToMongoDB()` exported from `example-backend/src/utils/database.ts`
  - Interface: unchanged signature, `() → Promise<void>`
  - Cases:
    - `MONGO_URI` at a free loopback port (server selection timeout set to 1 s in the test through the URI) → rejects; logger `error` received a string containing `Nothing is listening at`
    - `MONGO_URI` at a standalone in-memory server with `?replicaSet=rs0&serverSelectionTimeoutMS=1000` → rejects; logged string contains `standalone server`
    - reachable replica set → resolves; no diagnosis logged
  - Blast radius: none (log text only)
  - Test skills: terreno-backend-tests

- [ ] **T6** — Release `@terreno/cli` in lockstep and resolve every `workspace:*` dependency at publish
  - Depends on: none
  - Files: .circleci/continue-config.yml, scripts/ci/prepare-package-publish.mjs, scripts/ci/prepare-package-publish.test.ts, scripts/ci/publish-lockstep-packages.test.ts, scripts/check-license-coverage/lib.ts, syncdb/LICENSE, syncdb/package.json (`files`), .github/workflows/publish-on-tag.yml, cli/package.json, cli/README.md, README.md, CHANGELOG.md (lockstep list line only), docs/how-to/release-automation.md, docs/explanation/versioning-policy.md, changelog/unreleased/cli-lockstep-release.md
  - Criteria:
    - First step, recorded in the PR description: the output of `npm view @terreno/cli versions --json` and `npm view @terreno/cli dist-tags --json`. If no 58.x exists (expected), continue. If a 58.x exists, stop and report: the diagnosis in Corrections is wrong.
    - `cli` is in all three `publish-release` package lists in `.circleci/continue-config.yml` (compile, publish, master version bump). Verified by `publish-lockstep-packages.test.ts`.
    - A test derives the lockstep set from the workspace manifests (every root workspace whose `package.json` has `publishConfig.access: "public"`) and fails when any of them is missing from any of the three CircleCI lists or from `PUBLISHED_PACKAGES`. `syncdb` is public but missing from `PUBLISHED_PACKAGES` today (`scripts/check-license-coverage/lib.ts:5-22`): this task adds it, and adds `syncdb/LICENSE` so `bun run check:licenses` stays green. The publish list may also hold the two generated plugin directories (`plugins/terreno-claude`, `plugins/terreno-loop-claude`); the test allows exactly those extras. Verified by running it with `cli` removed from one list (red) and present (green).
    - `prepare-package-publish.mjs` replaces every `workspace:*` value in `dependencies` and `peerDependencies` whose key is the `name` of a root workspace package with `publishConfig.access: "public"` with the release version, and throws `Unresolved workspace dependency <name> in <package>` for any other `workspace:` value there (a private workspace such as `@terreno/example-backend`, a non-workspace, or another `workspace:` range). `devDependencies` keep today's behaviour, since npm does not install them for consumers. Verified by `prepare-package-publish.test.ts`.
    - The fallback `publish-cli` job in `publish-on-tag.yml` resolves `create-terreno-app`. Verified by a regex assertion in `publish-lockstep-packages.test.ts`, the pattern that file already uses for `publish-mcp`.
    - `cli/package.json` is at the current lockstep version, `files` includes `README.md`, and `cli/README.md` exists with install and command summary. Verified by the license/metadata check and a test that reads the manifest.
  - Seam: `scripts/ci/prepare-package-publish.mjs` run as a child process on a temp package directory (as its existing test does); the CI config files read as text
  - Interface: `bun run scripts/ci/prepare-package-publish.mjs <package-directory> <version> [release|manual]`, exit 0 and rewritten `package.json`, or exit non-zero with the message above
  - Cases:
    - package with `{"@terreno/mcp": "workspace:*", "create-terreno-app": "workspace:*"}`, version `58.1.0` → both become `58.1.0`
    - package with dependency `{"@terreno/example-backend": "workspace:*"}` (a private workspace) → exits non-zero, stderr contains `Unresolved workspace dependency @terreno/example-backend`
    - package with dependency `{"left-pad": "workspace:*"}` (not a workspace) → exits non-zero, stderr contains `Unresolved workspace dependency left-pad`
    - package with `{"@terreno/api": "workspace:^"}` → exits non-zero (only `workspace:*` is supported; the message names the value)
    - `catalog:` handling unchanged: known key resolves, unknown key still throws `Catalog entry not found`
    - manual mode: `@terreno/api` still resolves to `^<latest>`
    - CircleCI config: each of the three lists matches a regex that includes `cli`
    - derived-set test: the compile and version-bump lists equal the manifest-derived set, ignoring order; the publish list equals it plus the two plugin directories; `PUBLISHED_PACKAGES` equals it
  - Blast radius: the next tag publishes `@terreno/cli` at a version that jumps from 57.3.0 to the lockstep version, and `update-version-on-master` starts bumping `cli/package.json`. `docs/reference/cli.md` already tells users to `bun add -g @terreno/cli`. README, CHANGELOG header and versioning-policy package lists gain `cli`.
  - Test skills: none specific (plain `bun test` under `scripts/ci/`, as the neighbouring tests)
  - Docs: `docs/how-to/release-automation.md` (CircleCI is the release path; the lockstep set is derived), `docs/explanation/versioning-policy.md` and `README.md` package lists.

- [ ] **T7** — Start the example stack with `bun run dev` at the monorepo root
  - Depends on: T3, T8 (T8 also writes the root `package.json`; no other relationship)
  - Files: package.json (scripts), cli/e2e/devSmoke.ts, CONTRIBUTING.md, .rulesync/rules/00-root.md (then `bun run rules:sync` output: AGENTS.md, CLAUDE.md and generated copies), docs/how-to/run-tests-locally.md, changelog/unreleased/monorepo-dev-command.md
  - Criteria:
    - The root `dev` script is `bun cli/dist/bin.js dev --backend example-backend --frontend example-frontend`. Verified by a test that reads root `package.json`.
    - From a bootstrapped checkout with nothing on 27017, `bun run dev` reaches a healthy example backend on 4000 without any environment variable passed on the command line (the tracked `example-backend/.env` supplies them). Verified by `cli/e2e/devSmoke.ts`, which already runs this invocation with `--no-web`; this task adds the assertion that no `MONGO_URI` or secret was passed by the harness other than the port overrides.
    - `CONTRIBUTING.md` "Development setup" is `bun run bootstrap` then `bun run dev`; the manual `mongod` recipe in the root rule's Cursor Cloud section is replaced by `bun run dev`, with the manual recipe kept under a "without `terreno dev`" heading. Verified by a docs test asserting `CONTRIBUTING.md` contains `bun run dev` and not `TOKEN_SECRET=dev-token-secret`.
  - Seam: root `package.json` script; `cli/e2e/devSmoke.ts`
  - Interface: `bun run dev [-- <terreno dev flags>]`
  - Cases:
    - root `package.json` `scripts.dev` equals the string above
    - `devSmoke.ts` invoked through `bun run dev -- --no-web --data-dir <tmp>` with `PORT` and the `MONGO_URI` port overridden to free ports → `/health` healthy; SIGINT → exit 0
    - `cli/dist/bin.js` missing → the script fails with Bun's "module not found"; `CONTRIBUTING.md` says to run `bun run bootstrap` first (asserted by the docs test: the two commands appear in that order)
  - Blast radius: `example-backend/.env` has `MONGO_URI=mongodb://localhost:27017/terreno-example` with no `replicaSet=`; T2's default set name `rs0` applies. Port 8082 is shared with other local apps (root rule "Gotchas"); unchanged.
  - Test skills: none specific
  - Docs: `CONTRIBUTING.md`, root rule source in `.rulesync/rules/`, `docs/how-to/run-tests-locally.md`. Tutorial and quickstart prose belong to `docs-match-the-code`.

- [ ] **T8** — Generate the scaffold backend from typechecked, linted source files
  - Depends on: T6 (both write `.circleci/continue-config.yml`; no other relationship)
  - Files: create-terreno-app/template/backend/** (new private workspace package named `@terreno-template-app/backend`, so the app-name token turns it into `@<app>/backend`), create-terreno-app/scripts/buildTemplate.ts, create-terreno-app/src/template.ts, create-terreno-app/src/generate.ts, create-terreno-app/src/__tests__/generate.test.ts, create-terreno-app/src/__tests__/template.test.ts, create-terreno-app/src/__tests__/generatedApp.compile.test.ts, create-terreno-app/package.json, create-terreno-app/.gitignore, .gitignore, package.json (workspaces: both `create-terreno-app/template/backend` and `create-terreno-app/template/frontend` are added here, so T9 does not write the root manifest), knip.jsonc, .dependency-cruiser config and baseline, .circleci/continue-config.yml (path filter for `run-create-terreno-app`), scripts/ci/prepush (path map), docs/reference/create-terreno-app.md, docs/explanation/static-analysis.md, changelog/unreleased/scaffold-template-source.md
  - Criteria:
    - Every file the generator writes under `backend/` comes from a file of the same relative path under `create-terreno-app/template/backend/`; `generate.ts` holds no backend source as a template literal. Verified by `template.test.ts` (output paths under `backend/` equal the template's tracked files, minus `node_modules`, `dist` and `bun.lock`).
    - The template backend is a root workspace, so `bun run lint`, `bun run typecheck`, `bun run check:no-barrel-imports`, `bun run check:source-rules` and `bun run check:knip` cover it and pass. Verified by those commands in CI.
    - To pass them: the `models/index.ts` and `types/**/index.ts` barrels are removed and imports point at concrete files; `addDefaultPlugins` is a `const` arrow function; `@types/express` matches the root catalog's Express 5 types. The template backend's `dev` script is `bun run --watch src/index.ts` (no inline `PORT=4000`; `backend/.env` sets `PORT=4000`), so `terreno dev` and deploys control the port. The `as any` / `as unknown as` user-model casts, the legacy `TOKEN_*` env entries and the user router's `permissions` form stay, each with the documented-exception comment the explicit-any check accepts, because removing them is `api-foundations`' work.
    - Tokens: the template uses the literal app name `terreno-template-app`, display name `Terreno Template App` and database name `terreno_template_app`; the generator replaces each everywhere with the caller's values. Verified by `generate.test.ts`: output for `appName: "my-app"` contains none of the three literals.
    - Generated `backend/package.json` has no `catalog:` or `workspace:` value; every `@terreno/*` dependency is `^<create-terreno-app version>` and every other version equals the root catalog's where the catalog has the key. Verified by `generate.test.ts`.
    - `generateAllFiles(args)` keeps its signature and stays synchronous; `terreno bootstrap app` and `cli/src/linkTerreno.test.ts` pass unchanged. Verified by the cli test suite.
  - Seam: `generateAllFiles` exported from `create-terreno-app`; the compiled binary through `create-terreno-app/e2e/smoke.ts`
  - Interface: `generateAllFiles({appName, appDisplayName, description?, mcpServerUrl?}) → GeneratedFile[]` (`{path, content}`), unchanged. `buildTemplate.ts` runs as the first step of `compile` and writes `create-terreno-app/src/template.generated.json` (git-ignored): `{files: {[relativePath]: content}}` with versions resolved. `template.ts` imports it.
  - Cases:
    - `generateAllFiles({appName: "my-app", appDisplayName: "My App"})` → contains `backend/src/server.ts`, `backend/src/models/user.ts`, `backend/.env`; does not contain `backend/src/models/index.ts` or `backend/src/types/index.ts`
    - `backend/.env` content contains `MONGO_URI=mongodb://127.0.0.1:27017/my_app?replicaSet=rs0` and `BETTER_AUTH_SECRET=my-app-better-auth-secret-dev-only-32chars`
    - `backend/src/server.ts` contains `Starting My App server`
    - `backend/package.json` `scripts.dev` is `bun run --watch src/index.ts`; `name` is `@my-app/backend`; `devDependencies["@types/express"]` starts with `^5`; no value matches `/^(catalog|workspace):/`
    - no generated backend file contains `terreno-template-app`, `Terreno Template App` or `terreno_template_app`
    - `generatedApp.compile.test.ts` backend half: `tsc --noEmit` exits 0
    - `create-terreno-app/e2e/smoke.ts` passes unchanged (expected files, declared imports, backend build)
    - `backend/.env` and `backend/.env.example` are in the output (the root `.gitignore` ignores `.env*`; this task adds negations for `create-terreno-app/template/**/.env` and `.env.example` so they are tracked; the dev-only values in them are the ones the scaffold writes today)
    - `buildTemplate.ts` skips `node_modules/`, `dist/`, `.expo/`, `.terreno/` and `bun.lock` by an explicit list, not by git state: a file `template/backend/node_modules/x.js` is not in the output
  - Blast radius: `cli` and `@terreno/mcp` consume `create-terreno-app` → their suites and `scripts/ci/check-bootstrap-app.sh` are the consumer cases. The SQLite plan (`2026-11-01-sqlite-mongoose-driver`, T-docs task) edits `create-terreno-app/src/generate.ts`; whichever lands second rebases onto the template files. New workspace packages change the knip and dependency-cruiser inputs; update the config, and regenerate the dependency-cruiser baseline only for the new package's own edges.
  - Test skills: terreno-backend-tests
  - Docs: `docs/reference/create-terreno-app.md` (how the template is built and how to change it), `docs/explanation/static-analysis.md` (template packages are covered).

- [ ] **T9** — Generate the scaffold frontend from typechecked, linted source files
  - Depends on: T8
  - Files: create-terreno-app/template/frontend/** (new private workspace package named `@terreno-template-app/frontend`), create-terreno-app/template/root/** (README.md, CLAUDE.md, .cursorrules, .gitignore, Dockerfile, .dockerignore, MCP config, CI workflows), create-terreno-app/scripts/buildTemplate.ts, create-terreno-app/src/generate.ts, create-terreno-app/src/__tests__/generate.test.ts, create-terreno-app/src/__tests__/template.test.ts, create-terreno-app/src/__tests__/generatedApp.compile.test.ts, knip.jsonc, docs/reference/create-terreno-app.md
  - Criteria:
    - Every file the generator writes comes from `create-terreno-app/template/{root,backend,frontend}/`; `generate.ts` contains no file body as a template literal and is under 300 lines. Verified by `template.test.ts` and a line-count assertion.
    - The template frontend is a root workspace and passes `bun run lint`, `bun run typecheck`, `bun run check:no-barrel-imports`, `bun run check:source-rules` and `bun run check:knip`. `utils/index.ts` is renamed to a concrete module. Verified in CI.
    - Generated `frontend/package.json` has no `catalog:` or `workspace:` value; `better-auth`, `@better-auth/expo` and `@better-auth/passkey` equal the root catalog's version; Expo, React and React Native versions equal the catalog's. Verified by `generate.test.ts`.
    - `mcpServerUrl` and `description` still take effect: `.mcp.json` and `.cursor/mcp.json` carry the given URL. Verified by `generate.test.ts`.
    - The generated file list is the pre-change list minus the removed barrels (55 files before this plan; the test pins the exact list).
  - Seam: `generateAllFiles`; `create-terreno-app/e2e/smoke.ts`
  - Interface: unchanged from T8. A fourth token, `https://mcp.terreno.app`, is replaced by `mcpServerUrl` when given.
  - Cases:
    - `generateAllFiles({appName: "my-app", appDisplayName: "My App"})` → contains `frontend/app/_layout.tsx`, `frontend/store/syncdb.ts`, `README.md`, `CLAUDE.md`, `.mcp.json`, `.github/workflows/backend-ci.yml`
    - `frontend/store/syncdb.ts` contains `SYNC_DB_NAME = "my-app"`
    - `frontend/app.json` `expo.name` is `My App`, `expo.slug` is `my-app`
    - `mcpServerUrl: "https://mcp.example.test"` → `.mcp.json` `mcpServers.terreno.url` is `https://mcp.example.test/mcp`
    - `frontend/package.json` `dependencies["better-auth"]` equals root catalog `better-auth`
    - no generated file contains any of the three template literals
    - `generatedApp.compile.test.ts` frontend half: `tsc --noEmit` exits 0
    - `wc -l create-terreno-app/src/generate.ts` < 300
  - Blast radius: same consumers as T8. `scripts/ci/check-bootstrap-app.sh` exports the generated frontend with Expo; it must still produce `index.html`.
  - Test skills: terreno-frontend-tests
  - Docs: `docs/reference/create-terreno-app.md`.

- [ ] **T10** — Ship a synced `Todo` model and route in the scaffold backend
  - Depends on: T8, T4
  - Files: create-terreno-app/template/backend/src/models/todo.ts, create-terreno-app/template/backend/src/types/models/todoTypes.ts, create-terreno-app/template/backend/src/api/todos.ts, create-terreno-app/template/backend/src/api/todos.test.ts, create-terreno-app/template/backend/src/models/modelPlugins.ts, create-terreno-app/template/backend/src/server.ts, create-terreno-app/template/backend/src/scripts/seed.ts, create-terreno-app/template/backend/src/utils/database.ts, create-terreno-app/template/backend/bunfig.toml and test preload, create-terreno-app/template/backend/package.json
  - Criteria:
    - The template backend has a `Todo` model (`title` required string, `completed` boolean default false, `ownerId` ref User required, String `_id` as in `example-backend/src/models/todo.ts`) with `syncPlugin` applied, and a `todoRouter` at `/todos` with a `sync` config scoped to the owner, registered in `server.ts` and listed in `AdminApp`. Verified by route tests in the template package.
    - A user sees and changes only their own todos over REST. Verified by route tests with exact statuses.
    - The seed creates two todos for `test@example.com` and is idempotent. Verified by a seed test that runs it twice.
    - `utils/database.ts` logs `describeMongoConnectionFailure`'s message when the connection fails (same behaviour as T5). Verified by unit test.
  - Seam: HTTP routes of the template backend built with `skipListen`, per `terreno-backend-tests`
  - Interface: `GET /todos` → `{data: Todo[], ...}`; `POST /todos {title}` → 201 `{data: Todo}`; `PATCH /todos/:id {completed?, title?}`; `DELETE /todos/:id`. Each Todo: `_id`, `title`, `completed`, `ownerId`, `created`, `updated`, `deleted`. Authenticated users only; object access by owner; `ownerId` is set from the session and cannot be supplied.
  - Cases:
    - user A `POST /todos {title: "Buy milk"}` → 201; body `data.title === "Buy milk"`, `data.completed === false`, `data.ownerId === A.id`
    - `POST /todos {}` → 400
    - `POST /todos {title: "x", ownerId: B.id}` as A → stored `ownerId` is A's
    - A has 2 todos, B has 1 → A `GET /todos` returns exactly A's 2
    - B `PATCH /todos/<A's id> {completed: true}` → 403 (object permission); A's todo unchanged
    - B `GET /todos/<A's id>` → 403; B `DELETE /todos/<A's id>` → 403 and the todo still exists
    - A `PATCH /todos/<own id> {completed: true}` → 200, `data.completed === true`
    - A `DELETE /todos/<own id>` → 204; subsequent `GET /todos` omits it
    - no session → 401 on each verb
    - the Todo schema has the `_syncSeq` path (proves `syncPlugin`); a write increments it
    - seed run twice → `test@example.com` has exactly 2 todos
  - Blast radius: `server.ts` registration order (router before `SyncApp`); `modelPlugins.ts` is shared with `User`, so `syncPlugin` is applied on the Todo schema only, not in `addDefaultPlugins`. The user router keeps the `permissions` form already there; the todo router uses the form `example-backend/src/api/todos.ts` uses (`access: {resource: "todo"}` plus the roles in `access.ts`) so the scaffold shows the current API.
  - Test skills: terreno-backend-tests, terreno-test-setup, mongoose-schema-safety
  - Docs: none here; T12 and T13 update the scaffold README and CLAUDE.md once the full shape exists.

- [ ] **T11** — List, add, complete and delete todos through SyncDB in the scaffold frontend
  - Depends on: T9, T10, T3 (its browser proof starts the template packages with `terreno dev`)
  - Files: create-terreno-app/package.json (`e2e:template` script), docs/testing/e2e/create-terreno-app.md, create-terreno-app/template/frontend/app/(tabs)/index.tsx, create-terreno-app/template/frontend/app/(tabs)/index.test.tsx, create-terreno-app/template/frontend/store/syncdb.ts, create-terreno-app/template/frontend/store/syncDbSdk.ts (generated, committed), create-terreno-app/template/frontend/store/apiSdk.ts (regenerated), create-terreno-app/template/frontend/package.json (`sync-sdk` script), create-terreno-app/template/frontend/e2e/todos.spec.ts, create-terreno-app/template/frontend/e2e/helpers/login.ts, create-terreno-app/template/frontend/playwright.config.ts, create-terreno-app/template/frontend test preload
  - Criteria:
    - The home tab is a Todos screen: a text field and Add button, a list of the user's todos with a checkbox each and a delete button, an empty state, and a loading state. Data comes from `useQuery` / `useMutate` on the `todos` collection. Verified by a render test.
    - `frontend/package.json` has `sync-sdk` (`terreno-syncdb-codegen ... --out ./store/syncDbSdk.ts --collections todos`) and `sdk` runs both `api-sdk` and `sync-sdk`; `SYNC_COLLECTIONS` comes from the generated `store/syncDbSdk.ts`. Verified by `generate.test.ts`-style assertions in the template test and by typecheck.
    - A todo added in the browser is still listed after a reload. Verified by the Playwright spec (E3), run in this task against the template packages themselves: `bun run --cwd create-terreno-app e2e:template` starts `terreno dev --backend template/backend --frontend template/frontend --data-dir <tmp>` and runs the spec. Screenshots of the empty, filled and reloaded Todos screen are saved to `/opt/cursor/artifacts/` and attached to the PR, per the repository's frontend verification rule.
    - Every interactive element has a `testID`: `todos-screen`, `todos-title-input`, `todos-add-button`, `todos-list`, `todos-item-<id>`, `todos-item-checkbox-<id>`, `todos-item-delete-<id>`, `todos-empty`, `todos-loading`.
  - Seam: rendered screen component with the SyncDB test provider (`terreno-frontend-tests`); browser for E3
  - Interface: default export `TodosScreen: React.FC` at `app/(tabs)/index.tsx`
  - Cases:
    - no todos → `todos-empty` visible with text `No todos yet`
    - store not ready → `todos-loading` visible; Add button disabled
    - two todos in the store → two `todos-item-*` rows with their titles
    - type `Buy milk`, press `todos-add-button` → `mutate` called with collection `todos`, `{title: "Buy milk", completed: false}`; input cleared
    - empty or whitespace title → Add button disabled; no mutate
    - press `todos-item-checkbox-<id>` on an incomplete todo → update with `{completed: true}`
    - press `todos-item-delete-<id>` → delete for that id
    - E3: `loginAs(page)` as `test@example.com`, wait for `todos-screen`, fill `todos-title-input` with a unique title, click `todos-add-button`, expect a `todos-item-*` containing it; reload; expect it again. No `waitForTimeout`.
  - Blast radius: `store/syncdb.ts` is read by `_layout.tsx` (start/stop on login) and the profile screen; `SYNC_COLLECTIONS` changing from `[]` to `["todos"]` starts the sync socket for real, which is why this depends on T10's router.
  - Test skills: terreno-frontend-tests, terreno-test-setup, terreno-ui, terreno-data-fetching
  - Docs: none here (see T13).

- [ ] **T12** — Generate the scaffold without the `Todo` example with `--minimal`
  - Depends on: T11, T3 (T1–T3 also write `cli/src/help.ts` and `docs/reference/cli.md`)
  - Files: create-terreno-app/src/generate.ts, create-terreno-app/src/template.ts, create-terreno-app/src/writeScaffold.ts, create-terreno-app/src/cli.ts, create-terreno-app/scripts/buildTemplate.ts, create-terreno-app/template/example.json (the list of Todo-only files), create-terreno-app/template/backend/src/server.ts, create-terreno-app/template/backend/src/scripts/seed.ts, create-terreno-app/template/frontend/store/syncdb.ts, create-terreno-app/src/__tests__/generate.test.ts, create-terreno-app/src/__tests__/cli.test.ts, create-terreno-app/src/__tests__/generatedApp.compile.test.ts, cli/src/commands/bootstrap.ts, cli/src/commands.test.ts, cli/src/help.ts, create-terreno-app/README.md, docs/reference/create-terreno-app.md, docs/reference/cli.md
  - Criteria:
    - `create-terreno-app my-app --minimal` and `terreno bootstrap app --minimal` write the scaffold without any Todo file, with `SYNC_COLLECTIONS` empty, no `sync-sdk` script, and the home tab showing the welcome text the scaffold has today. Verified by `generate.test.ts`.
    - Todo-only files are listed in `template/example.json`; Todo-only lines in shared files sit between `// terreno:example-start` and `// terreno:example-end` comments, which are removed from both outputs. JSON files cannot carry comments, so `example.json` also lists `package.json` edits for the minimal variant (`{"frontend/package.json": {"removeScripts": ["sync-sdk"], "setScripts": {"sdk": "bun run api-sdk"}}}`). Verified by `generate.test.ts`: no output contains `terreno:example`.
    - The minimal output typechecks. Verified by `generatedApp.compile.test.ts` running both variants.
    - Without the flag the output is the full scaffold (T11). Verified by `generate.test.ts`.
  - Seam: `generateAllFiles`; `parseCliArgs` in `writeScaffold.ts`; `runCli(["bootstrap","app",...])` in cli
  - Interface: `generateAllFiles({..., minimal?: boolean})`; `create-terreno-app <name> [--minimal]`; `terreno bootstrap app --name <n> --display-name <t> [--minimal]`
  - Cases:
    - `minimal: true` → no path contains `todo` (case-insensitive); `frontend/store/syncDbSdk.ts` absent; `frontend/package.json` has no `sync-sdk` script and `sdk` is `bun run api-sdk`; `frontend/store/syncdb.ts` contains `SYNC_COLLECTIONS: string[] = []`; `backend/src/server.ts` does not contain `todoRouter`; `frontend/app/(tabs)/index.tsx` contains `Your app is ready for development!`
    - `minimal` omitted or false → `backend/src/models/todo.ts` and `frontend/store/syncDbSdk.ts` present; `server.ts` contains `todoRouter`
    - neither variant contains `terreno:example-start` or `terreno:example-end`
    - `parseCliArgs(["my-app","--yes","--minimal"])` → `{minimal: true}`, no errors
    - `--minimal` given twice → no error, still true
    - compile test: `tsc --noEmit` exits 0 for backend and frontend of both variants
  - Blast radius: the welcome home screen must exist as a second file for the minimal variant. It lives outside the router directory, at `template/frontend/minimal/homeScreen.tsx`, and is written to `app/(tabs)/index.tsx`, so it is typechecked without becoming a route in the template app. Starter variants beyond minimal belong to `batteries`.
  - Test skills: terreno-backend-tests
  - Docs: `create-terreno-app/README.md`, `docs/reference/create-terreno-app.md`, `docs/reference/cli.md` (`--minimal`).

- [ ] **T13** — Give the scaffold a root `bun run dev` and install dependencies on create
  - Depends on: T3, T6, T12
  - Files: create-terreno-app/template/root/package.json, create-terreno-app/template/root/README.md, create-terreno-app/template/root/CLAUDE.md, create-terreno-app/template/root/.cursorrules, create-terreno-app/template/root/.gitignore, create-terreno-app/src/writeScaffold.ts, create-terreno-app/src/cli.ts, create-terreno-app/src/install.ts, create-terreno-app/src/__tests__/cli.test.ts, create-terreno-app/src/__tests__/generate.test.ts, create-terreno-app/e2e/smoke.ts, cli/src/linkTerreno.ts, cli/src/linkTerreno.test.ts, mcp-server/src/bootstrap.ts (the bootstrap prompt's command list), mcp-server tests for that prompt, create-terreno-app/README.md, docs/reference/create-terreno-app.md, docs/how-to/create-a-terreno-app.md, docs/testing/e2e/create-terreno-app.md, changelog/unreleased/scaffold-one-command-dev.md
  - Criteria:
    - The generated app has a root `package.json`: `private`, `name` = app name, `devDependencies["@terreno/cli"]` = `^<version>`, the same `overrides` for `bson` and `mongodb` as the backend, and scripts `dev` (`terreno dev`), `seed` (`bun run --cwd backend seed`), `sdk` (`bun run --cwd frontend sdk`). The backend and frontend stay separate installs with their own lockfiles (Q2). Verified by `generate.test.ts`.
    - `.gitignore` ignores `.terreno/`. Verified by `generate.test.ts`.
    - `create-terreno-app <name>` runs `bun install` in the app root, `backend/` and `frontend/` after writing, streaming output, and `--no-install` skips it. A failed install exits 1 after printing which directory failed and the command to retry; the files stay. Verified by `cli.test.ts` with an injected installer.
    - Next steps printed after a successful run are exactly `cd <name>` and `bun run dev` (plus the three `bun install` lines first when `--no-install` was passed). Verified by `cli.test.ts`.
    - The generated README's "Local development" section is `bun run dev`, the two seeded logins, and where the data lives (`.terreno/dev/mongo`), with the manual replica-set recipe moved under "Use your own MongoDB". The generated `CLAUDE.md` "Adding Features" lists the sync steps (model with `syncPlugin`, router `sync` config, `bun run sdk`, `useQuery`). Verified by `generate.test.ts` string assertions.
    - `terreno bootstrap app --terreno-path` links `@terreno/cli` and its `@terreno/*` closure into the generated root package. Verified by `linkTerreno.test.ts`.
    - `docs/how-to/create-a-terreno-app.md` steps 2–6 (install, MongoDB, seed, start) become `bun run dev`; the failing `node -e` command is removed. Verified by a docs test asserting the page does not contain `replSetInitiate`.
  - Seam: `runCli` in `create-terreno-app/src/cli.ts` with an injected `install`; `generateAllFiles`; `prepareLinkTerreno` / `linkTerreno`
  - Interface: `create-terreno-app <name> [--no-install]`; `RunCliOptions.install?: ({cwd}) → {exitCode: number}`; `runCli` stays synchronous
  - Cases:
    - default run → installer called for `<app>`, `<app>/backend`, `<app>/frontend`, in that order; exit 0; `nextSteps` equals `["cd my-app", "bun run dev"]`
    - `--no-install` → installer never called; `nextSteps` equals `["cd my-app", "bun install", "(cd backend && bun install)", "(cd frontend && bun install)", "bun run dev"]`
    - installer returns 1 for `backend` → exit 1; stderr `bun install failed in my-app/backend. Fix the error above, then run: (cd my-app/backend && bun install)`; `frontend` not attempted; target directory still exists
    - root `package.json` → `scripts.dev === "terreno dev"`; `devDependencies["@terreno/cli"]` matches `/^\^\d+\.\d+\.\d+$/`; `overrides.mongodb` equals the backend's
    - `--minimal` → root `package.json` has no `sdk` change (still present; runs `api-sdk` only)
    - `.gitignore` contains a line `.terreno/`
    - README contains `bun run dev` and does not contain `# Terminal 2`
    - `create-terreno-app/e2e/smoke.ts` passes with `--no-install` added to its invocation (it links `node_modules` itself and must stay offline)
    - `linkTerreno` plan for the generated files includes `@terreno/cli`, `@terreno/mcp`, `create-terreno-app`
  - Blast radius: `scripts/ci/check-bootstrap-app.sh` and `e2e/smoke.ts` call the generators and must pass `--no-install` or expect installs; the MCP bootstrap prompt (`mcp-server/src/bootstrap.ts:531`) prints the command sequence agents follow and must match. `@terreno/cli` must be on npm at the scaffold's version before this releases: T6 lands and a tag is cut first (Q3).
  - Test skills: terreno-backend-tests
  - Docs: listed in Files. The tutorial (`docs/tutorials/getting-started.md`) and README quickstart are `docs-match-the-code`'s; this task changes only the commands in the how-to that would otherwise be wrong.

- [ ] **T14** — Prove a generated app reaches a synced todo with two commands
  - Depends on: T13
  - Files: scripts/ci/check-bootstrap-app.sh, .github/workflows/bootstrap-app-check.yml, scripts/ci/prepush (path map: template and `cli/src/dev/**` changes trigger the check), docs/testing/e2e/create-terreno-app.md, docs/testing/e2e.md
  - Criteria:
    - After generating with `--terreno-path` and installing, the script runs `bun run dev` in the app root in the background with no MongoDB provided, and within 180 s: `GET :4000/health` returns `healthy: true`; `GET :8082/` returns 200 HTML; signing in as `test@example.com` / `testpassword123` through the Better Auth endpoint succeeds; `POST /todos {title}` returns 201 and `GET /todos` lists it plus the two seeded todos. Verified by the script's exit code.
    - It runs the generated app's `bun test` in `backend/` (which finds and passes the todo route tests) and the Playwright spec `frontend/e2e/todos.spec.ts` against the running stack; both pass.
    - It sends SIGINT to `bun run dev` and asserts exit within 15 s and that ports 4000, 8082 and 27017 refuse connections.
    - It repeats generate, typecheck and backend test (no boot) for `--minimal`.
    - The workflow runs on pull requests that touch `create-terreno-app/**`, `cli/src/dev/**`, `cli/src/commands/dev.ts` or the script, as well as weekly and on tags; it caches `~/.cache/mongodb-binaries`. On a tag, a third job waits up to 30 minutes for `create-terreno-app@<tag>` and `@terreno/cli@<tag>` to appear on npm (`npm view`), then runs the script with `BOOTSTRAP_SOURCE=npm`: it generates with `bunx create-terreno-app@<tag>` and installs from the registry, with no `--terreno-path`, which is the path a real user takes. If either package never appears the job fails and names it. A second job runs the same script on `macos-latest` weekly and on tags, with no MongoDB cache restored, so the first-run download and teardown are proven on macOS. The check stays on GitHub Actions only; CircleCI has no bootstrap check and gains none. Verified by reading the workflow in a test alongside the existing lockstep tests.
  - Seam: `scripts/ci/check-bootstrap-app.sh` as a process; HTTP against the generated app; Playwright
  - Interface: `[BOOTSTRAP_SOURCE=checkout|npm] [BOOTSTRAP_VERSION=<tag>] bash scripts/ci/check-bootstrap-app.sh` (default `checkout`) → exit 0, or non-zero with the failing step's name and the last 50 lines of `terreno dev` output
  - Cases:
    - full variant: every assertion above
    - minimal variant: `backend` typechecks; `bun test` in `backend` exits 0 with no todo tests; `grep -ri todo` over the generated tree (excluding `node_modules`) finds nothing
    - a port already in use at start (4000) → the script fails fast with `Port 4000 is in use` rather than timing out
  - Blast radius: the job's wall-clock grows from two installs and an export to a full boot plus a browser run; budget 10 minutes and state the measured time on `docs/testing/e2e/create-terreno-app.md`.
  - Test skills: terreno-frontend-tests (Playwright rules), terreno-test-setup
  - Docs: `docs/testing/e2e/create-terreno-app.md`, the package table in `docs/testing/e2e.md`.

## Assumptions

- The IP lives at `docs/plans/` and state at `.terreno/pipeline/`, per the repository's recent plans.
- `mongod` is spawned directly with a binary from `mongodb-memory-server-core`'s `MongoBinary.getPath()`, using that library's default version so the cache in `~/.cache/mongodb-binaries` is shared with `@terreno/test`. If the driver cannot run `replSetInitiate` under Bun in the CLI process, T2 falls back to running the same three-line script with `bun -e` in the backend directory, where the Bun-safe `mongodb` pin already resolves.
- Managed data lives in `<app root>/.terreno/dev/mongo`; `mongod` logs to `.terreno/dev/mongod.log`. The existing `.devdata/` convention in the root rule is left for people who run `mongod` by hand.
- `terreno dev` does not run SDK codegen. The template commits generated `apiSdk.ts` and `syncDbSdk.ts`; keeping them fresh without a live backend is `resource-generator`'s offline generation.
- Template tokens are plain string replacement over file contents and paths; the three literals are distinctive enough not to collide.
- `create-terreno-app` stays dependency-free at runtime; `bun install` is run by spawning `bun`, which the user already has because they ran `bunx`.
- Commits follow the repository rules: no conventional-commit prefixes, no AI attribution, `master` as base, Bun only, a `changelog/unreleased/` fragment per user-facing task as listed in `Files:`. Nothing here is a breaking change for an existing app, so no upgrade note is required; `check:upgrade-docs` decides at release.

## Dependencies on other plans

- `api-foundations` (legacy JWT secrets, user-model casts, the deprecated `permissions` form): the template keeps the casts, the `TOKEN_*` env lines and the user router's `permissions` form until it lands, then drops them there.
- `resource-generator` depends on T8–T9 (it generates into the template's file layout) and owns `terreno generate resource`, the MCP scaffold tool and offline SDK generation.
- `docs-match-the-code` owns the tutorial and quickstart prose; it should land after T13 so it documents `bun run dev`.
- `batteries` owns template variants beyond `--minimal`, built on T12's `example.json` mechanism.
- `2026-11-01-sqlite-mongoose-driver` edits the scaffold's `server.ts` and `database.ts`; after T8 those are template files.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q2 | Should the generated app be one Bun workspace (single install, one lockfile) or keep `backend/` and `frontend/` as separate installs? | Separate installs plus a small root package | The generated Dockerfile, CI workflows and deploy docs all build `backend/` on its own lockfile; a workspace changes all three | T13 writes `workspaces` in the root package, drops two installs, and the Dockerfile and both CI workflows in the template are rewritten | T13, T14 |
| Q3 | `@terreno/cli` goes from 57.3.0 straight to the lockstep version on the next tag, and the scaffold depends on it from then on. Publish it in lockstep? | Yes | The docs already tell users to install it; the GitHub fallback already publishes it; the scaffold needs it | The dev command moves into a `scripts/dev.ts` file inside the template, T13 drops the dependency, and T6 shrinks to the `workspace:*` fix | T1–T3, T6, T7, T13 |
| Q4 | Should a standalone Mongo with sync or realtime registered stop the server, or only log? | Log one error and keep starting | `@terreno/test` runs standalone in-memory Mongo by default and adopters' suites boot `TerrenoApp` with `RealtimeApp`; throwing would break them | T4 throws instead, gains an opt-out option, and needs an upgrade note as a breaking change | T4 |
| Q5 | Should `create-terreno-app` install by default? | Yes, with `--no-install` | It is what makes the path two commands; `create-next-app` and `create-expo-app` do the same | T13 keeps install opt-in (`--install`) and the path is five commands | T13, T14 |
| Q6 | Should the default scaffold include the `Todo` example, with `--minimal` to remove it, or the reverse? | Todo by default | The audit's S1 finding is that the scaffold does not show the core loop; agents copy what is there | The flag becomes `--example` and T14's default path covers the bare shell | T12, T13, T14 |
| Q7 | Which MongoDB version should the managed `mongod` run? | The `mongodb-memory-server` default (shared cache with tests) | One download for tests and dev | T2 pins a version (for example the Atlas production major) and documents how to change it | T2 |
| Q9 | Should `terreno dev` support native Windows now? | No: macOS, Linux and WSL only; on `win32` it prints `terreno dev is not supported on native Windows yet. Use WSL.` and exits 1 | Signal handling and `mongod` teardown differ on Windows and there is no Windows CI | T1–T3 gain Windows spawn and shutdown paths and T14 a Windows runner job | T1, T2, T3, T14 |
| Q10 | When MongoDB is already running locally (not started by `terreno dev`), should it seed automatically? | No: print the "not seeded" line | A loopback address can be a tunnel to a shared database, and the seed writes known-password users | T3 seeds any loopback replica set whose target database is empty | T3 |
| Q8 | Should the template packages be private root workspaces (installed for every contributor), or a separate nested workspace checked only in CI? | Root workspaces | Root lint, typecheck, knip and source rules cover them with no new machinery | T8–T9 add a nested install and their own lint/typecheck CI job | T8, T9 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | `terreno dev --reset` to wipe `.terreno/dev/mongo`, and a clear message when the data directory was written by an incompatible `mongod` | A binary version bump can leave an unreadable data directory | S | T2 |
| X2 | `docker-compose.yml` in the scaffold as the alternative to a managed `mongod` | The audit offered it; unsupported distros need a way out | S | T13 |
| X3 | Run `sdk` and `sync-sdk` from `terreno dev` once the backend is healthy | Keeps the SDK fresh with no second terminal | S | `resource-generator` offline generation |
| X4 | `terreno dev --native` (iOS / Android) and a QR code in the banner | The pitch is universal apps; the banner only names web | M | T1 |
| X5 | Collapse the 18 GitHub publish jobs into one matrix job and delete the disabled CI twins | Audit finding 13 in `docs-process-dx.md`; T6 only patches the fallback | M | T6 |
| X6 | Typecheck the dead `setupEnvironment` away and validate legacy JWT secrets | Found while verifying 1.7 | S | `api-foundations` |
| X7 | A `TerrenoApp` preflight hook that plugins contribute checks to, with one combined report | The plan's checks are two fixed ones | M | plugin contract v2 |
| X8 | Windows support for `terreno dev` without WSL, tested in CI | Q9 | M | T2 |
| X9 | `terreno doctor`: Bun version, ports, Mongo, env, SDK drift in one report | Natural home for the T4 diagnosis outside startup | M | T2, T4 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | Q1: should `terreno dev` manage a real `mongod`, or wait for the SQLite driver plan? | Owner, 2026-11-13: manage `mongod` now. | Nothing; T2, T3 and T14 were built on this. The SQLite plan rebases onto the template files if it lands second. |

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds (fresh subagent each), 23 findings: 20 fixed, 3 moved to questions or expansions, 0 rebutted. Round 1: 11 findings, 1 blocking (the backend `dev` scripts hardcode `PORT=4000`, so port overrides were ignored: fixed in T2 and T8); Q1 raised to fundamental; the manual macOS regression case became a macOS runner job. Round 2: 12 findings, 3 blocking (T7 and T9 both wrote the root manifest; `--data-dir` was undefined and the seed marker sat outside it; the template package name could not produce `@<app>/backend`), all fixed; Windows support and seeding an unmanaged local Mongo moved to Q9 and Q10. Not checked by cut and still unverified: npm registry state for `@terreno/cli` (first step of T6), Bun accepting workspaces nested inside the `create-terreno-app` workspace (T8 finds out; the fallback is Q8's other option), and `MongoBinary.getPath()` plus `replSetInitiate` under Bun in the CLI process (T2; fallback in Assumptions).
