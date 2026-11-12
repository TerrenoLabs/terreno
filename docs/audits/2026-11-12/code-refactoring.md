# Terreno audit: code quality + refactoring / architecture

Scope: read-only review of `/workspace` at `6cf1f06c` (58.0.4), 2026-11-12. Every finding was verified by reading the cited code unless marked SUSPECTED. Severity S0–S3 (S0 blocking, S1 major friction, S2 annoying, S3 minor). Effort in hours / days / weeks.

Start with findings 1, 2 and 3: they are what a new adopter hits in the first hour, and 2 and 3 are fixes of hours to a day.

## Findings (ranked by adopter/contributor impact)

### 1. A new Better Auth app still has to carry the whole legacy Passport/JWT stack — S1, 1–2 weeks

Evidence
- `api/src/terrenoApp.ts:80-81` — `TerrenoAppOptions.userModel` is typed as the passport model ("Mongoose User model with passport-local-mongoose plugin").
- `api/src/auth.ts:52-65` — that `UserModel` type requires `createStrategy`, `serializeUser`, `deserializeUser`, `findByUsername`.
- `api/src/auth.ts:532-537` — `setupAuth` throws if `userModel.createStrategy` is missing; `api/src/terrenoApp.ts:438,481` call `setupAuth` and `addAuthRoutes` unconditionally, so the legacy `/auth/*` routes mount in every app.
- `create-terreno-app/src/generate.ts:377,1049,1084` — the scaffold installs and applies `passport-local-mongoose`; `:2322-2338,2356-2363` — the generated `.env` sets `AUTH_PROVIDER=better-auth` and still ships `TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `SESSION_SECRET`.
- `api/package.json` — `passport`, `passport-jwt`, `passport-local`, `passport-anonymous`, `passport-github2`, `jsonwebtoken`, `@thream/socketio-jwt` are hard dependencies.
- `docs/explanation/authentication.md:7-11` calls JWT/Passport "legacy".

Why it matters: the docs say Better Auth is the default, but the type system, the scaffold, the env file and the dependency tree all say "both". A newcomer cannot tell which user fields, routes and secrets are load-bearing, and the attack surface of an unused login system is mounted by default.

Recommended change
1. Split `UserModel` into a minimal `TerrenoUserModel` (`Model<{_id; id; admin; email?}>`) and a `PassportUserModel` extension.
2. Make legacy auth opt-in: `new TerrenoApp({legacyJwtAuth: {...}})` or a `LegacyJwtAuthApp` plugin; skip `setupAuth` / `addAuthRoutes` when absent.
3. Move the passport packages to optional peers, drop them and the three JWT secrets from the scaffold.

### 2. Day-one code needs `as unknown as` casts for the user model and `req.user` — S1, 2–4 days

Evidence
- Scaffold output: `create-terreno-app/src/generate.ts:526,595,758,764,766,771,773,1207` (8 casts in generated app code, including `User as unknown as TerrenoAuthUserModel` and `User as unknown as Model<UserDocument>`).
- Example app: 27 non-test casts in `example-backend/src`, e.g. `server.ts:155,240,256,262,314`, `access.ts:40`, `api/users.ts:28`, `api/todos.ts:94,176`, `api/projects.ts:39`.
- Official reference teaches the cast: `docs/reference/syncdb.md:132` (`req.user as unknown as UserDocument`); `/workspace/CLAUDE.md` "API Conventions" tells callers to cast `u as unknown as UserDocument`.
- Root cause: `api/src/express.d.ts:12-21` fixes `req.user` to an anonymous structural type; `api/src/auth.ts:52` is not generic over the app's document type. Inconsistently, `NotificationsApp` accepts the same `User` with no cast (`example-backend/src/server.ts:101-104`).
- 172 non-test `as unknown as` in `api/src` itself.

Why it matters: a framework whose hello-world needs double casts reads as unfinished, and the casts disable exactly the type checking that would catch a wrong user model.

Recommended change: expose one augmentable registry, the pattern already used for org settings (`api/src/types/organization.ts:27`, `declare module "@terreno/api" { interface OrganizationSettings … }`). Add `interface TerrenoRegister { user: UserDocument }`, derive `req.user`, action-handler `user`, and every plugin's `userModel` option from it, then delete the casts from the scaffold and example as the acceptance test.

### 3. `setupServer` is documented as a key export but no longer exists; dead legacy helpers remain public — S1, 4–8 hours

Evidence
- No definition anywhere: `grep -rnE "(const|function) setupServer"` over the repo returns nothing; `api/src/expressServer.ts` exports only `setupEnvironment`, `createRouter`, `createRouterWithAuth`, `cronjob`, `wrapScript`, types.
- Still advertised: `/workspace/CLAUDE.md:200,270,278` and `AGENTS.md:200,270,278` ("Key imports … `setupServer`"), `api/README.md:132-135,155`, `docs/explanation/authentication.md:230,505`, 27 files under `docs/` mention it.
- `api/src/expressServer.ts:251-260` — exported `createRouterWithAuth` calls `passport.authenticate("firebase-jwt")`; no `firebase-jwt` strategy is registered anywhere in `api/src` (only `firebaseJWTPlugin` schema fields at `api/src/plugins.ts:147`), so any caller fails at request time.
- `api/src/expressServer.ts:111-124` — `setupEnvironment` has no callers outside its own file.
- `api/src/api.ts:1670-1671` — `gooseRestRouter` / `GooseRESTOptions` aliases from the pre-Terreno name are still exported (acknowledged in `knip.jsonc:72`).

Why it matters: the first import an agent or human copies from the README fails to compile. AI agents are a stated first-class client and they read exactly these files.

Recommended change: remove `setupServer` from CLAUDE.md/AGENTS.md/README, rewrite the two `authentication.md` samples to `TerrenoApp`, delete `createRouterWithAuth`, `setupEnvironment`, and the `gooseRest*` aliases (or move them to a `@terreno/api/legacy` entry), and add a docs check that every `import {X} from "@terreno/api"` in markdown resolves against `api/src/index.ts`.

### 4. `@terreno/api` ships its test harness as a production dependency — S1, 1 day

Evidence
- `api/package.json` `dependencies` includes `"@terreno/test": "workspace:*"`.
- `test/package.json:10-20` — `@terreno/test` depends on `mongodb-memory-server`, `mongodb-memory-server-core`, `mongodb-memory-server-global`, `supertest`, `typescript`.
- The only non-test importers are the `./testing` entry: `api/src/tests.ts`, `api/src/tests/testHelper.ts`, `api/src/tests/mongoTestSetup.ts`, `api/src/tests/bunSetup.ts`.
- `api/package.json` `files` also publishes `src/**/*` (all tests and fixtures).
- `test/package.json:67-91` still lists `react-redux` as a peer (Redux was removed in 58; `test/src/expo/renderWithTerreno.ts:5-38` keeps the store path).

Why it matters: every production install and container image of a Terreno backend pulls an in-memory MongoDB toolchain. SUSPECTED: `mongodb-memory-server-global` downloads a mongod binary in its postinstall, which would add a large download to every `bun install` and fail in locked-down build environments (not run here).

Recommended change: make `@terreno/test` an optional peer of `@terreno/api`, required only by `@terreno/api/testing`; exclude `**/*.test.ts`, `src/tests/**`, fixtures from `files`; drop the Redux path from `@terreno/test`.

### 5. Two permission systems, and the deprecated one is the required field — S1, 3–5 days

Evidence
- `api/src/api.ts:155-158` — `permissions` is `@deprecated … Still required as a type-level fallback`, and is non-optional.
- `example-backend/src/api/todos.ts:44` uses `access: {resource: "todo"}` while `:121,145,154` in the same file still pass `Permissions.*` arrays; `:53-54` adds a third and fourth knob (`adminAccess`, `adminPermissions`).
- The scaffold uses only the deprecated form: `create-terreno-app/src/generate.ts:1207-1214`; `/workspace/CLAUDE.md` "modelRouter Usage" and the MCP codegen templates (`mcp-server/src/tools.ts:225,522,531`) teach only `permissions`.

Why it matters: an adopter sees a deprecation warning on the only form the scaffold, the agent docs and the code generator produce, and cannot tell which rules actually run when both are set.

Recommended change: pick one. Either un-deprecate `permissions` and document `access` as the RBAC layer on top, or make `permissions` optional when `access` is set, fail at registration when neither is given, and switch the scaffold, CLAUDE.md and MCP templates to `access`. Fold `adminPermissions` / `adminAccess` into the same model.

### 6. Plugin contract is thin, untyped and order-dependent; plugins reach each other through process globals — S1, 1–2 weeks

Evidence
- `api/src/terrenoPlugin.ts:42` — `register(app, openApi?: unknown, terrenoApp?)`. Every plugin then casts: `api/src/consentApp.ts:431,570`, `api/src/orgs/orgsApp.ts:195`, `jobs/src/routes/jobsAdmin.ts:318`, `comms/src/routes/pushTokens.ts:31`, `comms/src/routes/commsDashboard.ts:92`, `admin-backend/src/adminApp.ts:851`, `ai/src/harness/routes/approvals.ts:66`.
- No `name`, no declared dependencies, no shutdown hook (only `onServerCreated`, `adminContribution`). Ordering lives in comments: `example-backend/src/server.ts:247-250` ("Register Better Auth first"), `:243-245` (webhooks built before CommsApp, registered after).
- `admin-backend/src/adminApp.ts:648` — `AdminApp` does not declare `implements TerrenoPlugin`; every other plugin does.
- Service location by module-level singleton: `comms/src/commsApp.ts:25-31` (`getCommsService`), `jobs/src/jobsService.ts:376-395`, `ai/src/observability/observabilityAppRegistry.ts:23`, `api/src/orgs/organizationSettings.ts:8`, `api/src/collectionRegistry.ts:49`, `api/src/mcp/registry.ts:21`.
- `accessControl` and `userModel` must be re-passed to `TerrenoApp`, `SyncApp`, `RealtimeApp`, `BetterAuthApp`, `rbacRouter`, `JobsApp`, `AdminApp` (`example-backend/src/server.ts:193-314`).
- Package wiring differs: `comms`, `jobs`, `feature-flags`, `admin-backend`, `announcements`, `api-health` list `@terreno/api` under `dependencies`; `ai` and `admin-spa` list it under `peerDependencies`. SUSPECTED: with `workspace:*` published as an exact version, a version skew installs two copies of `@terreno/api`, splitting those singletons and breaking `instanceof APIError`.

Why it matters: third-party plugins are the growth path for an open-source framework. Today an author has to read `TerrenoApp.build()` to learn the contract, and two apps in one process (tests, multi-tenant hosts) share state silently.

Recommended change: define `TerrenoPlugin` v2 with `name`, `dependsOn?: string[]`, `register(ctx: {app, openApi: OpenApiMiddleware, terrenoApp, userModel, accessControl, services})`, `onServerCreated`, `onShutdown`. Have `TerrenoApp` sort by `dependsOn`, inject `userModel`/`accessControl`, and own a per-app service registry (`terrenoApp.service("comms")`) with the globals kept as thin deprecated shims. Make `@terreno/api` a peer dependency in every plugin package.

### 7. The example backend fakes an internal registration object to add plain routes — S2, 1–2 days

Evidence
- `example-backend/src/server.ts:106-131` — `createOpenApiAwareRouteRegistration` builds a `ModelRouterRegistration` by hand with `__type: "modelRouter"`, the underscore-private `_buildWithContext`, `model: {} as …`, `options: {} as …`, and a placeholder router; used at `:263,266`.
- The convention says not to use `router.get/post` for app APIs (`/workspace/CLAUDE.md` "Custom endpoints"), yet the framework's own packages contain raw route registrations (non-test counts: `api` 86, `ai` 60, `admin-backend` 15, `jobs` 10, `comms` 8).

Why it matters: the example is the documentation. It shows that non-model routes (streaming AI, dev tools) have no public registration path and that the answer is to forge an internal type.

Recommended change: add a public `routes("/path", (router, {openApi}) => …)` registration (or `TerrenoApp.addRoutes`) that returns a typed registration, use it in the example, and state in `model-router-actions.md` which route kinds are legitimately outside `modelRouter`.

### 8. `RealtimeApp`'s `adapter: "redis"` option does nothing, and the example carries 502 lines of dead socket code around it — S2, 2–4 days

Evidence
- `api/src/realtime/realtimeApp.ts:326-350` — `setupAdapter` logs "Redis adapter configured with URL" and then tells the caller to do it themselves via `getIo()`; no adapter is attached. Option documented at `api/src/realtime/types.ts:32-40`.
- `example-backend/src/websockets.ts` (502 lines) is a complete second Socket.IO stack (own `Server`, change stream, redis/mongo adapters with `as unknown as` at `:232,266,268`, form-presence events from another product at `:42-47`). `connectToWebsockets` has no caller outside `websockets.test.ts`; `server.ts:99,433` imports only `io`, which is therefore always `null`.
- Process-global realtime state: `api/src/realtime/changeStreamWatcher.ts:35-58,101` (single watcher, resume token, generation counters at module scope); per-process sync rate limiter `api/src/sync/syncBatch.ts:50` (the 100 mutations/s budget is per instance, not per user, once you scale out).

Why it matters: an adopter who sets `adapter: "redis"` for a two-instance deploy gets a reassuring log line and nothing else. Whether an adapter is even needed (each instance runs its own change stream and emits to its own sockets) is not stated in code, so the safe multi-instance topology is guesswork.

Recommended change: either implement the option (dynamic `import("@socket.io/redis-adapter")`, fail loudly if the peer is missing) or remove it and accept `adapter?: (io) => void`. Delete `example-backend/src/websockets.ts` and its test. Document the multi-instance model in `local-first-data.md`, and move the mutation budget to the existing rate-limit store when one is configured.

### 9. Web persistence has no cross-tab coordination for the outbox — S1 (SUSPECTED data loss), 1–2 weeks

Evidence
- `syncdb/src/persisters/encryptedIndexedDbPersister.ts:23-45` — the whole MergeableStore is saved as one encrypted blob under a single key, trailing debounce 500 ms; `:219-222` — "Nothing mutates the blob outside this persister, so no change listener".
- `syncdb/src/mutations/outbox.ts:199-275` — the outbox lives in that same store (`OUTBOX_TABLE`).
- No `BroadcastChannel`, `navigator.locks` or leader election for data in `syncdb/src` (the only `BroadcastChannel` is the debug bridge, `syncdb/src/debug/debugChannel.ts`). No `pagehide` / `visibilitychange` flush anywhere in `syncdb/src`.

Why it matters: two tabs of the same app each hold a full in-memory copy and each write the whole blob. SUSPECTED sequence: tab A queues an offline write and saves; tab B saves its older copy afterwards; A is closed; on reload the queued write is gone. A write enqueued under 500 ms before the tab closes can also miss the save. Server-side idempotency (finding in strengths) covers double sends, not this loss. Not reproduced here; no doc states a single-tab limit.

Recommended change: take a `navigator.locks` lock per `databaseName` so one tab owns persistence and the drain loop, relay other tabs' mutations to it over `BroadcastChannel` (or merge on load using the MergeableStore CRDT metadata that is already persisted), flush on `pagehide`, and add a two-context Playwright test that queues offline in both tabs.

### 10. SDK generation needs a live backend and a hand-kept collection list, with no drift gate — S2, 2–4 days

Evidence
- `example-frontend/package.json:68,82` — both generators read `${OPENAPI_URL:-http://localhost:4000/openapi.json}`; the dev server in turn needs a replica-set mongod and secrets (`/workspace/CLAUDE.md` "Example full stack").
- `:82` — `--collections todos,notifications,notification-preferences,gpt/histories,mcp/service-tokens` is typed by hand. The backend also syncs `projects` (`example-backend/src/api/projects.ts:63`), which is absent from the list and from `example-frontend/store/syncDbSdk.ts`.
- Screens bypass the generated hooks with string collection names: `example-frontend/app/notifications.tsx:54,69,84`, `components/NotificationCenter.tsx:99,114,129`.
- No CI job or script compares the committed `store/apiSdk.ts` (8,973 lines) / `syncDbSdk.ts` with the backend (no match for the SDK files in `.circleci`, `.github/workflows`, or `scripts/` checks).

Why it matters: "change the model, regenerate, get type errors" is the core promise. Today a backend change can merge with a stale SDK, and regenerating requires booting the full stack.

Recommended change: add `terreno openapi --out openapi.json` that builds the app without listening or connecting to Mongo, derive synced collections from the spec (an `x-terreno-sync` extension) instead of a flag, and add a CI step that regenerates and fails on diff. Type `syncDb.mutate({collection})` against the generated collection union.

### 11. Three functions hold most of the framework's behaviour — S2, 2–3 weeks (incremental)

Evidence
- `admin-backend/src/adminApp.ts:849-2118` — `AdminApp.register()` is about 1,270 lines in one method (file 2,401 lines).
- `syncdb/src/client.ts:380-2491` — `createSyncDb` is one ~2,100-line closure with about 50 inner functions sharing mutable locals.
- `api/src/api.ts:781-1556` — `_buildModelRouter` is ~775 lines; `ModelRouterOptions` spans `:150-427`.
- Cycles acknowledged in `.dependency-cruiser-known-violations.json`: 12 of 14 `no-circular` entries are in the `api.ts` ↔ `auth.ts` ↔ `permissions.ts` ↔ `actions.ts` ↔ `docLoader.ts` ↔ `sync/executors.ts` cluster, plus `sync/mutationHandler.ts` ↔ `sync/routes.ts`.
- Other large units: `api/src/betterAuthSetup.ts` (1,387), `api/src/auth.ts` (1,057), `comms/src/commsService.ts` (1,120), `ui/src/Common.ts` (4,302 lines of prop types for every component).

Why it matters: these are the files an outside contributor must edit for almost any core fix, and each needs whole-file context. The cycle cluster makes initialization order fragile and blocks extracting legacy auth (finding 1).

Recommended change: extract by seam, one PR each, behind existing tests. `adminApp.ts` → `routes/{models,scripts,roles,users,config}.ts`; `createSyncDb` → lifecycle, drain loop, subscription manager, auth-pause modules over an explicit state object; `_buildModelRouter` → one file per verb plus `listQuery.ts`. Break the api cycle by moving the `User` / permission types into a leaf `types` module, then ratchet the dependency-cruiser baseline down.

### 12. `@terreno/syncdb/auth` (data layer) contains screens and effectively requires `@terreno/ui` — S2, 2–3 days

Evidence
- `syncdb/src/auth/auth.ts:96-97` — the `/auth` entry does `export *` from `TerrenoAccountSecurityScreen` and `TerrenoLoginScreen`; both import `@terreno/ui` statically, as do `useLoginController.ts`, `useAccountSecurity.ts`, `rememberedAccounts.ts`, `loginErrors.ts`.
- `syncdb/package.json:117,145-147` marks `@terreno/ui` as an optional peer.
- `ui/src/login/` already holds `LoginScreen.tsx`, `TwoFactorChallengeScreen.tsx`.

Why it matters: `useSession` and `SessionProvider` come from the same entry, so the "optional" peer is required for any app that authenticates. Someone using syncdb with their own design system cannot. It also blurs which package owns login UI.

Recommended change: move the two screens and UI-typed helpers to `@terreno/syncdb/auth-ui` (or into `@terreno/ui` taking a controller prop), keep `/auth` free of `@terreno/ui` imports, and add a dependency-cruiser rule forbidding `syncdb/src/**` → `@terreno/ui` outside that entry.

### 13. The scaffold is a 2,695-line string template that restates the example app — S2, 1 week

Evidence
- `create-terreno-app/src/generate.ts` (2,695 lines) emits whole source files from template literals, e.g. server (`:535+`), user model (`:1049-1084`), seed (`:745-780`), env (`:2322-2363`).
- It already diverges from repo rules: `:1195-1199` generates a `models/index.ts` barrel of `export *`, which `/workspace/CLAUDE.md` bans; `:1207-1214` uses the deprecated `permissions` form (finding 5); it repeats the casts (finding 2).
- `cli/package.json:72` is at `57.3.0` while every other package is `58.0.4`.

Why it matters: template strings get no typecheck, lint or knip coverage, so the first code an adopter owns is the least verified code in the repo, and every API change has to be made twice.

Recommended change: keep the template as a real, typechecked workspace package (`templates/app/`) that CI compiles and smoke-tests, and have the generator copy it with a small token substitution. Derive it from a trimmed `example-*` where possible. Put `cli` on the shared version or document why it is independent.

### 14. OpenAPI generation depends on a vendored fork plus a process-wide Express prototype patch — S2, 1–2 weeks

Evidence
- `api/src/openApiCompat.ts:14,154-169` — patches `express.Router` prototype `use` once per process; `:194-206` wraps `app.use` and reads `app._router ?? app.router` to annotate layers.
- `api/src/vendor/wesleytodd-openapi/` (614 lines of CommonJS, exempted in `knip.jsonc`).
- `api/src/terrenoApp.ts:468-480` — the generator "walks the router stack on each /openapi.json request".
- `api/src/openApiValidator.ts:98,169,200` — validator configuration and Ajv caches are module-level, set by a global `configureOpenApiValidator()` call (`example-backend/src/server.ts:165`).

Why it matters: importing `@terreno/api` changes the behaviour of every Express router in the host process, and the spec depends on Express 5 private fields. An Express minor release can silently produce an incomplete spec, which then produces an incomplete SDK (finding 10).

Recommended change: have `modelRouter`, actions and the new `routes()` helper (finding 7) record route metadata in a per-`TerrenoApp` registry at registration time and build the spec from that registry; keep the stack walk only as a fallback for raw routers. Scope validator config to the app instance.

### 15. Public surface of `@terreno/api` is uncurated — S3, 2–3 days

Evidence
- `api/src/index.ts` has 93 `export *` lines; `ui/src/index.tsx` has 141.
- Test-only hooks are public from the root: `api/src/index.ts` exports `flushAuditRecorderForTests`, `resetAuditRecorderForTests` (`api/src/audit/record.ts:59,66`); also `clearSecurityActionListenersForTests` (`api/src/accountSecurity/securityEvents.ts:103`), `flushSecurityNotificationsForTests` (`securityNotifications.ts:512`).
- 17 `@internal` tags in `api/src` with no `stripInternal` in the tsconfigs (grep found none), so they remain in the published types.
- No `engines` field in `api/package.json` although 14 non-test source files import `@sentry/bun` and the `bin` points at TypeScript source (`"terreno-migrate": "./src/migrations/cli.ts"`), i.e. the package is Bun-only without declaring it.

Why it matters: with `export *`, any helper added to a module becomes semver-bound public API, and autocomplete on `@terreno/api` shows test resets next to `modelRouter`.

Recommended change: replace `export *` with explicit named exports per module (knip then reports the rest), move `*ForTests` to `@terreno/api/testing`, enable `stripInternal`, and add `"engines": {"bun": ">=1.x"}`.

## Strengths to preserve

1. **Server-side sync idempotency is carefully built.** `api/src/sync/mutationHandler.ts:130-147,333-420` claims a ledger row per `mutationId` before applying, takes over stale leases, and treats same-`_id` E11000 as an ack; the client mirrors it with an explicit outbox state machine (`syncdb/src/mutations/outbox.ts:22-38`). Keep this design when refactoring `createSyncDb`.
2. **Realtime failure handling.** The change-stream watcher restarts with backoff from a resume token, emits `sync:resync-required` on history loss, and serializes dispatch per entity (`api/src/realtime/changeStreamWatcher.ts:35-110`).
3. **Jobs leasing works across instances.** Claim-ownership filters plus a heartbeat that requires `status: "running"` mean a cancel on one instance aborts the handler on another (`jobs/src/jobExecutor.ts:233-252`).
4. **Debt is ratcheted, not hidden.** Knip runs with zero baseline and commented exceptions (`knip.jsonc`), dependency-cruiser has a 49-entry known-violations file, and explicit `any` is inventoried per file (`scripts/check-explicit-any/baseline.json`: 58 in non-test `api` source, all documented).
5. **The seams already exist.** `TerrenoPlugin`, `adminContribution()`, `collectionActions` / `instanceActions`, and the `declare module` augmentation for org settings are the right primitives; findings 2, 6 and 7 extend them rather than replace them.

## Not covered

- Security and performance (other auditors); the multi-tab and adapter findings are stated as correctness/architecture only.
- `ui/` component internals and UX, `demo/`, `website/`, `terraform/`, `infra/`.
- `ai/` internals (harness, observability) beyond its plugin wiring; `blocks/`, `mcp-server/` and `cli/` beyond the cited lines.
- `admin-frontend/` and `admin-spa/` source structure (only package wiring was checked).
- Test quality and coverage; no test suites, builds, knip or dependency-cruiser runs were executed. Line counts and grep counts are from the working tree, excluding `*.test.*`, `isolated`, and `tests/` paths unless stated.
- SUSPECTED items (not reproduced): the `mongodb-memory-server-global` postinstall download (4), duplicate `@terreno/api` copies under version skew (6), multi-tab outbox loss and the sub-500 ms close window (9).
