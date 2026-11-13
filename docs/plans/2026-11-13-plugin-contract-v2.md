# Plugin contract v2: typed context, declared order, shutdown, per-app services

Plugins are how Terreno grows: auth, admin, jobs, comms, AI and realtime are all plugins, and outside authors are expected to write more. Today the contract is one method, `register(app, openApi?: unknown, terrenoApp?)`. Every plugin casts `openApi`, ordering rules live in comments in the example server, there is no shutdown hook, plugins find each other through module-level variables, and the example app forges an internal registration object to add plain routes. This plan gives a plugin a typed context, a name, declared dependencies, a shutdown hook and a per-app service registry, and adds a public way to register non-model routes. Existing plugins keep working unchanged. Plugin authors and anyone reading the example server feel the difference.

Source: audit `docs/audits/2026-11-12/REPORT.md` finding 4.4 and `code-refactoring.md` findings 6 and 7. This IP builds on `docs/plans/2026-11-13-api-foundations.md` (the `TerrenoUserModel` type).

## The idea

`TerrenoPlugin` gains optional members; nothing is removed.

```typescript
export interface TerrenoPluginContext {
  app: express.Application;
  openApi: OpenApiMiddleware;
  terrenoApp: TerrenoApp;
  userModel: TerrenoUserModel;
  accessControl?: AnyTerrenoAccess;
  services: TerrenoServiceRegistry;
}

export interface TerrenoPlugin {
  name?: string;
  dependsOn?: readonly string[];
  after?: readonly string[];
  setup?(ctx: TerrenoPluginContext): void;
  /** @deprecated Implement setup(ctx). */
  register?(app: express.Application, openApi?: OpenApiMiddleware, terrenoApp?: TerrenoApp): void;
  onServerCreated?(server: http.Server): void;
  onShutdown?(): void | Promise<void>;
  adminContribution?(): AdminContribution;
}
```

`TerrenoApp` calls `setup(ctx)` when a plugin has it, otherwise `register(app, openApi, terrenoApp)` exactly as today. Before mounting, it moves a plugin's declared dependencies ahead of it: `dependsOn` names plugins that must be registered, `after` names plugins that mount first only when they are present. `terrenoApp.shutdown()` closes the server and calls `onShutdown` in reverse order. `ctx.services.provide("comms", service)` and `terrenoApp.service("comms")` replace `getCommsService()`-style globals, so two apps in one process no longer share state. `routes("/path", (router, ctx) => …)` returns a plugin, so non-model routes (SSE, dev tools) register without the forged `ModelRouterRegistration` in `example-backend/src/server.ts:106-131`.

Rejected: one `register` method that accepts either an app or a context and sniffs which at runtime. An Express app and a context object are both plain objects to a type guard written by an outside author, and a wrong guess mounts nothing. Rejected: a new `TerrenoPluginV2` interface. Two interfaces means every API that takes a plugin takes a union, and a class cannot `implements` a union.

### Compatibility ledger

| Change | Kind | Lands | Removed or flipped | Upgrade-note section |
| --- | --- | --- | --- | --- |
| `setup(ctx)`, `TerrenoPluginContext` | Additive | 58.x | n/a | New capabilities |
| `name`, `dependsOn`, `after` | Additive (ordering only changes for plugins that declare `dependsOn` or `after`) | 58.x | n/a | New capabilities |
| `onShutdown`, `TerrenoApp.shutdown()`, `TerrenoApp.getHttpServer()` | Additive | 58.x | n/a | New capabilities |
| `ctx.services`, `terrenoApp.service()`, `terrenoAppFor(req)`, `TerrenoServices` | Additive | 58.x | n/a | New capabilities |
| `routes()` helper | Additive | 58.x | n/a | New capabilities |
| `register`'s `openApi` parameter typed `OpenApiMiddleware` instead of `unknown` | Additive for implementers (a method that declares `unknown` still satisfies the interface) | 58.x | n/a | New capabilities |
| `register` becomes optional on the `TerrenoPlugin` interface | Breaking at the type level only, for code that calls `.register()` on a value typed as the interface | 58.x minor with an upgrade note | n/a | Breaking changes |
| `register(app, openApi?, terrenoApp?)` as the way to write a plugin | Deprecate-then-remove | deprecated 58.x | not before 60.0.0 (Q2) | Deprecations |
| `getCommsService`, `getJobsService`, `tryGetJobsService`, `registerJobsService`, `unregisterJobsService`, `registerObservabilityApp` and its getter | Deprecate-then-remove | deprecated 58.x | removed 59.0.0, or three minors after deprecation, whichever is later | Deprecations |
| `userModel` / `accessControl` options on first-party plugins become optional | Additive | 58.x | n/a | New capabilities |
| `AdminApp implements TerrenoPlugin` | Additive | 58.x | n/a | Summary |

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Tracer: `setup(ctx)` with a typed context, called by `TerrenoApp` | none | api terrenoPlugin, terrenoApp | Supertest: a `setup` plugin gets the typed context; a `register`-only plugin is called as before |
| T2 | Plugin names, `dependsOn` and `after` ordering | T1 | api terrenoApp | Mount order test; unknown name and cycle fail at build |
| T3 | `onShutdown` and `TerrenoApp.shutdown()` | T2 | api terrenoApp | Hooks run once in reverse order; server stops accepting connections |
| T4 | Per-app service registry | T3 | api services, terrenoApp | Two apps in one process resolve different services |
| T5 | `routes()` helper for non-model routes, used by example-backend | T4 | api routes helper, example-backend server | Route answers and appears in `/openapi.json`; forged registration deleted |
| T6 | Move `@terreno/api`'s built-in plugins to `setup(ctx)` | T3 | api plugins | No `openApi as` cast left in `api/src`; api suite unchanged |
| T7 | Comms and jobs publish their services through the registry | T4, T6 | comms, jobs | Two-app isolation; global getters still work and are deprecated |
| T8 | `AdminApp` implements `TerrenoPlugin` with `setup(ctx)` | T4, T7 | admin-backend | Type test; admin suite unchanged; reads jobs through the registry |
| T9 | Move the remaining plugin packages to `setup(ctx)` and the registry | T7 | ai, announcements, feature-flags, api-health, admin-spa | No `openApi as` cast left; observability and the jobs runner resolve per app |
| T10 | Plugins take `userModel` and `accessControl` from the context; example-backend uses the new contract | T2, T5, T6, T7, T8, T9 | api, jobs, admin-backend plugins, example-backend server | Plugins built with neither option use the app's; example server passes each once |
| T11 | How-to, explanation, upgrade note, changelog, agent rules | T2, T3, T5, T10 | docs, mcp-server upgrade notes, changelog, .rulesync | `bun run check:changelog`; docs examples compile in the type fixture |

Tracer: `TerrenoApp.build()` hands one context object to a plugin's `setup`.
Order: T1 → T2 → T3 → T4 is a chain because all four write `api/src/terrenoApp.ts`; each adds one independent behaviour. T5 follows T4 because both add exports to `api/src/index.ts` and sections to `docs/reference/api.md`. The package migrations (T6, T7, T8, T9) fan out from there.
E2E: 1 existing smoke extended (`api/e2e/smoke.ts`, http). No browser spec: no screen changes.
Regression: None — no hard-to-automate change.
User guide: None — no user-visible change.
Design: None — no canvas.
Out of scope: `@terreno/api` as a peer dependency of plugin packages, per-app collection and MCP registries, OpenAPI built from a registration registry (see Expansions).
Open risks: 22 first-party plugin files change while other audit groups edit some of the same files; the example server's "register Better Auth first" comment may already be stale, since `TerrenoApp` mounts the session middleware before plugins (`api/src/terrenoApp.ts:444-449`) (T2 checks).
Elephant: no plugin has been written outside this repository, so the context is shaped only by first-party needs, and once published every field in it is public API.

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `api/e2e/smoke.ts` (extend) | http | A real server with a `routes()` plugin answers that route with 200 and lists it in `/openapi.json` | T5 |

Other proofs are supertest and type-fixture tests in each task's Cases, not e2e rows.

## Regression cases

None — no hard-to-automate change.

## User guide

None — no user-visible change. Plugin authors get the how-to and reference in T11.

## Design

None — no canvas.

## Tasks

- [ ] **T1** — Tracer: call `setup(ctx)` with a typed plugin context from TerrenoApp
  - Depends on: none
  - Files: api/src/terrenoPlugin.ts, api/src/terrenoApp.ts, api/src/index.ts, api/src/terrenoPlugin.test.ts, docs/reference/api.md
  - Criteria:
    - `TerrenoPluginContext` and the extended `TerrenoPlugin` match "The idea". `openApi` in both `setup` and `register` is typed `OpenApiMiddleware` (`api/src/api.ts:126`).
    - `TerrenoApp.build()` calls `setup(ctx)` when present, else `register(app, openApi, terrenoApp)`. A plugin with both gets only `setup`.
    - `TerrenoApp.register()` throws `APIError` 500 with title `Plugin must implement setup(ctx) or register(app)` for an object with neither (model router registrations are unaffected).
    - `ctx.services` exists as an object in this task; its behaviour is T4.
  - Verification: `cd api && bun test src/terrenoPlugin.test.ts` (package directory, so `api/bunfig.toml`'s preload runs); `bun run --cwd api typecheck`
  - Seam: `new TerrenoApp({userModel, accessControl}).register(plugin).build()` plus supertest
  - Interface: plugin `{name: "probe", setup(ctx) { ctx.app.get("/probe", (_req, res) => res.json({ok: true})) }}`
  - Cases:
    - `setup` plugin: `GET /probe` → 200 `{ok: true}`; inside `setup`, `ctx.terrenoApp` is the app instance, `ctx.userModel` is the model passed to `TerrenoApp`, `ctx.accessControl` is the access passed, `typeof ctx.openApi.path === "function"`
    - `register`-only plugin: `register` called once with `(app, openApi, terrenoApp)`, `typeof openApi.path === "function"`
    - plugin with both: `setup` called once, `register` not called
    - `terrenoApp.register({})` → throws, title `Plugin must implement setup(ctx) or register(app)`
    - type-level: a class with `register(app: express.Application, openApi?: unknown): void` still satisfies `implements TerrenoPlugin` (compiles in the test file)
  - Blast radius: every existing plugin goes through the `register` branch → `bun run test:agent` at the repo root
  - Test skills: terreno-backend-tests
  - Docs: docs/reference/api.md (TerrenoPlugin)
  - Skills: terreno-backend-api, update-docs

- [ ] **T2** — Order plugins by name, `dependsOn` and `after`
  - Depends on: T1
  - Files: api/src/terrenoApp.ts, api/src/terrenoPlugin.ts, api/src/pluginOrder.ts, api/src/pluginOrder.test.ts, docs/reference/api.md
  - Criteria:
    - First step (reproduce): prove whether registration order matters for Better Auth today. Build an app with a model router registered before `BetterAuthApp` and request it with a valid session. Record the result. Use an inline test plugin name; first-party names arrive in T6. If it is 200, the "Register Better Auth first" comment at `example-backend/src/server.ts:247-250` is stale and T10 deletes it; if not, T10 expresses it with `after: ["better-auth"]`.
    - Mount order is registration order, except that when plugin A lists B in `dependsOn` and B is registered after A, B (with its own dependencies) moves to just before A. Plugins that declare no `dependsOn`, and model routers, never move relative to each other.
    - `dependsOn` naming a plugin that is not registered throws at `build()`: title `Plugin "a" depends on "b", which is not registered`.
    - A cycle throws at `build()`: title `Plugin dependency cycle: a -> b -> a`.
    - `after` orders exactly like `dependsOn`, except that a name that is not registered is ignored instead of throwing. It is for "mount after X when X is present".
    - Two plugins may share a name; `dependsOn` and `after` then mean all of them.
  - Verification: `cd api && bun test src/pluginOrder.test.ts`
  - Seam: exported `orderRegistrations(registrations)` and `TerrenoApp.build()`
  - Interface: `orderRegistrations(list)` → new array; plugins record their `setup` call order into a shared array
  - Cases:
    - `[a, b, c]`, no `dependsOn` → `[a, b, c]`
    - `[a(dependsOn b), b]` → `[b, a]`
    - `[a(dependsOn c), b, c(dependsOn d), d]` → `[d, c, a, b]`
    - `[router1, a(dependsOn b), router2, b]` → `[router1, b, a, router2]`
    - `[a(dependsOn x)]` → throws `Plugin "a" depends on "x", which is not registered`
    - `[a(dependsOn b), b(dependsOn a)]` → throws `Plugin dependency cycle: a -> b -> a`
    - `[a(dependsOn b), b1(name b), b2(name b)]` → `[b1, b2, a]`
    - unnamed plugin with `dependsOn: ["b"]` and `b` missing → title uses `(unnamed)` in place of the name
    - `[a(after b), b]` → `[b, a]`; `[a(after x)]` with no `x` → `[a]`, no throw
    - `[a(after b), b(after a)]` → throws `Plugin dependency cycle: a -> b -> a`
  - Blast radius: none for apps with no `dependsOn` (order is unchanged) → example-backend suite
  - Test skills: terreno-backend-tests
  - Docs: docs/reference/api.md (ordering rules)
  - Skills: terreno-backend-api, update-docs

- [ ] **T3** — Add `onShutdown` and `TerrenoApp.shutdown()`
  - Depends on: T2
  - Files: api/src/terrenoApp.ts, api/src/terrenoApp.shutdown.test.ts, docs/reference/api.md
  - Criteria:
    - `TerrenoApp` keeps the server it creates (today a local in `completeStart`, `api/src/terrenoApp.ts:699-701`) and exposes `getHttpServer(): http.Server | undefined`, so a caller can read the bound address.
    - `shutdown(options?: {timeoutMs?: number}): Promise<void>` first awaits `whenReady()`, then stops the HTTP server from accepting connections when `TerrenoApp` created it (an `httpServer` passed in by the host is not closed), then awaits each plugin's `onShutdown` in reverse mount order, then waits for open connections to finish. After `timeoutMs` (default 10000) it calls `server.closeAllConnections()` so keep-alive and socket connections cannot hold it open.
    - `shutdown()` on an app that was only `build()`-ed (never started) runs the hooks and resolves.
    - A hook that throws or rejects is logged with `logger.error` and the remaining hooks still run; `shutdown()` then rejects with the first error.
    - A second `shutdown()` call returns the same promise; hooks run once.
    - `TerrenoApp` installs no signal handlers (Q3).
  - Verification: `cd api && bun test src/terrenoApp.shutdown.test.ts`
  - Seam: `TerrenoApp.start()` with `process.env.PORT` set to a port from `freePort()` (`@terreno/test`), read back through `getHttpServer().address()`, then `shutdown()`
  - Interface: `await terrenoApp.shutdown()`
  - Cases:
    - plugins a, b, c with hooks → hooks called in order c, b, a, once each
    - after `shutdown()` resolves, a new `fetch` to the port fails with a connection error
    - b's hook rejects with `Error("boom")` → a's and c's hooks still ran; `shutdown()` rejects with `boom`
    - two concurrent `shutdown()` calls → each hook called once
    - `skipListen: true` (no server) → hooks run, resolves
    - `build()` only, never started → hooks run, resolves
    - an open keep-alive connection, `shutdown({timeoutMs: 200})` → resolves in under 2 s and the connection is closed
    - `shutdown()` called immediately after `start()`, before `whenReady()` resolves → hooks run once after boot completes; resolves
    - host-provided `httpServer` → still listening after `shutdown()`
    - `process.listenerCount("SIGTERM")` is unchanged by `start()`
  - Blast radius: none (no caller exists today)
  - Test skills: terreno-backend-tests
  - Docs: docs/reference/api.md (`shutdown`, `onShutdown`)
  - Skills: terreno-backend-api, update-docs

- [ ] **T4** — Add the per-app service registry
  - Depends on: T3
  - Files: api/src/services.ts, api/src/terrenoApp.ts, api/src/index.ts, api/src/services.test.ts, api/typeFixtures/registeredUser/services.ts, docs/reference/api.md
  - Criteria:
    - `@terreno/api` exports an empty, augmentable `interface TerrenoServices {}`. `ctx.services.provide(name, service)` stores a service on that `TerrenoApp`; `terrenoApp.service(name)` and `ctx.services.get(name)` return it. For a name declared in `TerrenoServices` the return type is the declared type; otherwise `unknown`.
    - `service(name)` for a missing name throws `APIError` 500, title `Service "x" is not registered`. `ctx.services.tryGet(name)` returns `undefined` instead.
    - `provide` for a name already provided on the same app throws, title `Service "x" is already provided`.
    - Registries are per `TerrenoApp` instance.
    - Request handlers reach the registry without a module global: `TerrenoApp.build()` stores itself on the Express app, and `@terreno/api` exports `terrenoAppFor(req): TerrenoApp`, which throws `APIError` 500 `No TerrenoApp for this request` on an app not built by `TerrenoApp`.
    - `ctx.services` is the live registry: a plugin may keep it and read a service per request, so a service provided by a plugin mounted later is still found.
  - Verification: `bun run --cwd api compile && cd api && bun test src/services.test.ts src/types/register.test.ts`
  - Seam: `TerrenoApp.build()` with plugins that provide and read; the type fixture runner from `api-foundations` T1 (fixtures compile against built declarations)
  - Interface: `ctx.services.provide("clock", {now: () => 1})`; `terrenoApp.service("clock").now()`
  - Cases:
    - provide then `service("clock").now()` → 1
    - `service("missing")` → throws `Service "missing" is not registered`; `tryGet("missing")` → undefined
    - second `provide("clock", …)` on the same app → throws `Service "clock" is already provided`
    - app A provides `clock` returning 1, app B provides `clock` returning 2, same process → A reads 1, B reads 2
    - inside a route handler on app A, `terrenoAppFor(req).service("clock").now()` → 1; on a bare `express()` app → throws `No TerrenoApp for this request`
    - plugin p1 keeps `ctx.services` and reads `clock` inside a route handler; p2, mounted after p1, provides `clock` → the route returns 1
    - fixture: with `declare module "@terreno/api" { interface TerrenoServices { clock: {now(): number} } }`, `terrenoApp.service("clock").now()` compiles; `// @ts-expect-error` on `.missing()` → `tsc` exit 0
  - Blast radius: none (new API)
  - Test skills: terreno-backend-tests
  - Docs: docs/reference/api.md (service registry)
  - Skills: terreno-backend-api, update-docs

- [ ] **T5** — Add `routes()` for non-model routes and use it in example-backend
  - Depends on: T4
  - Files: api/src/routes.ts, api/src/index.ts, api/src/routes.test.ts, api/e2e/smoke.ts, example-backend/src/server.ts, docs/explanation/model-router-actions.md, docs/reference/api.md
  - Criteria:
    - `routes(path, (router, ctx) => void, options?: {name?: string})` returns a `TerrenoPlugin` whose `setup` builds an `express.Router`, calls the callback with it and the plugin context, and mounts it at `path`.
    - Routes that use `ctx.openApi.path(...)` appear in `/openapi.json`.
    - `example-backend/src/server.ts` no longer defines `createOpenApiAwareRouteRegistration`; the two call sites (`addAiRoutes`, `addDevNotificationRoutes`) use `routes("/", …)`. `/openapi.json` for the example lists the same paths as before; compare the sorted path list before and after and record it.
    - `docs/explanation/model-router-actions.md` states which route kinds belong outside `modelRouter` (SSE and streaming, webhooks via `WebhooksApp`, static serving, auth, health, version) and that `routes()` is the way to register them.
  - Verification: `cd api && bun test src/routes.test.ts`; `bun run --cwd api smoke`; `bun run --cwd example-backend test:agent`
  - Seam: `TerrenoApp.build()` plus supertest; `api/e2e/smoke.ts` for E1
  - Interface: `app.register(routes("/tools", (router, {openApi}) => { router.get("/ping", openApi.path({responses: {200: {description: "ok"}}}), (_req, res) => res.json({pong: true})) }))`
  - Cases:
    - `GET /tools/ping` → 200 `{pong: true}`
    - `GET /openapi.json` → `paths["/tools/ping"].get` is defined
    - callback receives `ctx.userModel` equal to the app's user model
    - a route in the callback behind `authenticateMiddleware()` with no credentials → 401
    - `routes("/tools", cb, {name: "tools"}).name` → `"tools"`
    - E1: real server → `GET /tools/ping` 200 and the path is in `/openapi.json`
  - Blast radius: generated SDK reads the example's `/openapi.json` → the before-and-after path list above; example-frontend SDK must not change (`cd example-frontend && bun run sdk` produces no diff, run where a backend is available, otherwise recorded as deferred with that command)
  - Test skills: terreno-backend-tests
  - Docs: docs/explanation/model-router-actions.md, docs/reference/api.md (`routes`)
  - Skills: terreno-backend-api, model-router-actions, update-docs

- [ ] **T6** — Move the built-in `@terreno/api` plugins to `setup(ctx)`
  - Depends on: T3
  - Files: api/src/betterAuthApp.ts, api/src/configurationApp.ts, api/src/consentApp.ts, api/src/versionCheckPlugin.ts, api/src/accountSecurity/accountSecurityApp.ts, api/src/audit/auditApp.ts, api/src/notifications/notificationsApp.ts, api/src/orgs/orgsApp.ts, api/src/realtime/realtimeApp.ts, api/src/sync/syncApp.ts, api/src/webhooks/webhooksApp.ts, api/src/pluginContract.test.ts, docs/reference/api.md
  - Criteria:
    - Each of the 11 plugin classes implements `setup(ctx)` and declares a `name`. Each keeps a `register(app, openApi?, terrenoApp?)` that produces the same routes, so a direct `plugin.register(app)` call behaves as today.
    - `grep -rn "openApi as " api/src --include=*.ts | grep -v "\.test\."` returns nothing (today: `consentApp.ts:431,570`, `versionCheckPlugin.ts:33`, `accountSecurityApp.ts:367`, `notificationsApp.ts:104`, `orgsApp.ts:195`).
    - `BetterAuthApp`'s name is `better-auth`, `AuditApp`'s is `audit`, `RealtimeApp`'s is `realtime`, `SyncApp`'s is `sync`, `WebhooksApp`'s is `webhooks`.
    - `RealtimeApp` implements `onShutdown`, so the hook has a first-party user. Its existing `close()` (`api/src/realtime/realtimeApp.ts:312-323`) calls `io.close()`, which also closes the attached HTTP server, and swallows errors. `onShutdown` must disconnect sockets and stop its watcher without closing a host-provided `httpServer`, and must let errors reach `shutdown()`.
    - `NotificationsApp`'s `getComms` option defaults to `ctx.services.tryGet("comms")` read at call time, so apps stop passing `getComms: getCommsService`.
    - Known limit, recorded in docs: the change-stream watcher is process-wide (`api/src/realtime/changeStreamWatcher.ts`), so shutting down one of two apps in a process stops realtime for both. Per-app watchers are X2.
    - The api suite passes with no edits to existing tests.
  - Verification: `cd api && bun test src/pluginContract.test.ts`; `bun run --cwd api test:agent`
  - Seam: each plugin class's public shape, and the source guard
  - Interface: `new X(options)` for each class; `typeof plugin.setup`, `plugin.name`
  - Cases:
    - for each of the 11 classes: `typeof instance.setup === "function"`, `typeof instance.register === "function"`, `instance.name` is a non-empty kebab-case string, and the 11 names are distinct
    - source guard: no non-test file under `api/src` matches `/openApi as /`
    - `new VersionCheckPlugin(opts).register(expressApp)` called directly (no `TerrenoApp`) still mounts its route → `GET` on it returns 200
    - app started with `realtime: true`, then `terrenoApp.shutdown()` → a connected socket receives a disconnect and a new socket connection fails
    - host-provided `httpServer` plus `realtime: true`, then `shutdown()` → the host server is still listening (a plain HTTP request to it gets a response)
    - app with `NotificationsApp` (no `getComms`) and `CommsApp`: `notify()` with a push channel reaches that app's comms service (assert on the app's own fake provider)
  - Blast radius: every route these plugins mount → the existing api suite and `bun run --cwd api smoke`
  - Test skills: terreno-backend-tests
  - Docs: none (internal move; public behaviour unchanged; the names are documented in T11)
  - Skills: terreno-backend-api

- [ ] **T7** — Publish the comms and jobs services through the registry
  - Depends on: T4, T6
  - Files: comms/src/commsApp.ts, comms/src/routes/pushTokens.ts, comms/src/routes/commsDashboard.ts, comms/src/commsApp.registry.test.ts, jobs/src/jobsApp.ts, jobs/src/jobsService.ts, jobs/src/routes/jobsAdmin.ts, jobs/src/jobsApp.registry.test.ts, docs/reference/comms.md, docs/reference/jobs.md
  - Criteria:
    - `CommsApp` and `JobsApp` implement `setup(ctx)`, declare `name: "comms"` / `name: "jobs"`, and call `ctx.services.provide` with that name. Each package augments `TerrenoServices` so `terrenoApp.service("comms")` is typed `CommsService` and `service("jobs")` is `JobsService`.
    - `getCommsService`, `getJobsService`, `tryGetJobsService`, `registerJobsService` and `unregisterJobsService` keep today's behaviour (last registered wins) and gain `@deprecated` JSDoc naming `terrenoApp.service(...)` and "removed not before 59.0.0".
    - No `openApi as` cast remains in `comms/src` or `jobs/src` non-test files.
    - `JobsApp` implements `onShutdown` by calling its existing `stopWorker()` (`jobs/src/jobsApp.ts:200`).
  - Verification: `cd comms && bun test src/commsApp.registry.test.ts`; `cd jobs && bun test src/jobsApp.registry.test.ts`; `bun run comms:test`; `bun run jobs:test`
  - Seam: two `TerrenoApp` instances built in one process
  - Interface: `appA.service("comms")`, `appB.service("comms")`; `getCommsService()`
  - Cases:
    - app A with `CommsApp` a, app B with `CommsApp` b → `appA.service("comms") === a.service`, `appB.service("comms") === b.service`, and they differ
    - same for jobs
    - `getCommsService()` after both are built → b's service (last registered, unchanged behaviour)
    - app with no `CommsApp`: `app.service("comms")` → throws `Service "comms" is not registered`
    - two `CommsApp` on one app → `build()` throws `Service "comms" is already provided`
    - app with a `JobsApp` whose worker is running, `terrenoApp.shutdown()` → the worker is stopped (the same observable the existing `stopWorker` test asserts)
  - Blast radius: `NotificationsApp({getComms: getCommsService})` in example-backend and `admin-backend/src/adminScriptJob.ts`, `ai/src/harness/runners/jobsRunner.ts` and `example-backend/src/adminScripts.ts` keep working through the deprecated getters until T8, T9 and T10 move them → example-backend suite
  - Test skills: terreno-backend-tests
  - Docs: docs/reference/comms.md, docs/reference/jobs.md (service access)
  - Skills: terreno-backend-api, update-docs

- [ ] **T8** — Make AdminApp implement TerrenoPlugin with `setup(ctx)`
  - Depends on: T4, T7
  - Files: admin-backend/src/adminApp.ts, admin-backend/src/adminScriptJob.ts, admin-backend/src/adminApp.contract.test.ts, admin-backend/src/documentStorageApp.ts, docs/reference/admin-backend.md
  - Criteria:
    - `class AdminApp implements TerrenoPlugin` (it does not today, `admin-backend/src/adminApp.ts:648`), with `name: "admin"` and `setup(ctx)`. `register(app, openApi?, terrenoApp?)` stays for direct callers (`admin.register(app)` is the documented usage).
    - The jobs service is looked up per request, as today (`adminApp.ts:2121,2239` call `tryGetJobsService()` inside handlers; `adminScriptJob.ts:262,275` use the getters). `tryEnqueueAdminScriptJob(payload, jobs?)` and `tryCancelAdminScriptJob(taskId, jobs?)` gain an optional second parameter, the jobs service; with it omitted they use the deprecated getter as today. Under `setup`, `AdminApp`'s handlers pass `ctx.services.tryGet("jobs")`, read at request time, so `JobsApp` may be registered before or after `AdminApp`. The global getter is used only on the legacy `register` path.
    - In `admin-backend/src` non-test files, the getters are called only as the default inside those two functions.
    - No `openApi as` cast remains in `admin-backend/src` non-test files. The body of the 1,270-line `register` is not otherwise restructured (that is `decompose-core-functions`).
    - `DocumentStorageApp` gains `setup(ctx)` and a name the same way.
  - Verification: `cd admin-backend && bun test src/adminApp.contract.test.ts`; `bun run --cwd admin-backend test:ci`; `bun run --cwd admin-backend smoke`
  - Seam: `AdminApp` public shape; two apps in one process
  - Interface: `const plugin: TerrenoPlugin = new AdminApp({models: []})`
  - Cases:
    - the assignment above compiles with no cast
    - `GET /admin/config` as admin on an app built through `TerrenoApp.register(new AdminApp(...))` → 200 (existing behaviour)
    - app A with `JobsApp`, app B without: an admin script run on B executes in-process, on A it is enqueued (the existing jobs/no-jobs behaviours, now decided per app)
    - `new AdminApp(opts).register(expressApp)` directly → `GET /admin/config` as admin 200
    - registration order `[AdminApp, JobsApp]` on one app → an admin script run is enqueued, same as `[JobsApp, AdminApp]`
  - Blast radius: admin scripts' jobs-or-in-process decision → the two-app case; admin-spa and admin-frontend smokes read `/admin/config` → `bun run smoke admin-backend admin-frontend`
  - Test skills: terreno-backend-tests
  - Docs: docs/reference/admin-backend.md (registration)
  - Skills: building-admin-interfaces, terreno-backend-api, update-docs

- [ ] **T9** — Move the remaining plugin packages to `setup(ctx)` and the registry
  - Depends on: T7
  - Files: ai/src/aiApp.ts, ai/src/aiAdminApp.ts, ai/src/harness/harnessApp.ts, ai/src/harness/routes/conversations.ts, ai/src/harness/routes/approvals.ts, ai/src/harness/routes/tasks.ts, ai/src/harness/runners/jobsRunner.ts, ai/src/observability/observabilityApp.ts, ai/src/observability/observabilityAppRegistry.ts, announcements/src/announcementsApp.ts, feature-flags/src/featureFlagsApp.ts, api-health/src/healthApp.ts, admin-spa/src/serve.ts, ai/src/pluginContract.test.ts, announcements/src/pluginContract.test.ts, feature-flags/src/pluginContract.test.ts, api-health/src/pluginContract.test.ts, admin-spa/src/pluginContract.test.ts
  - Criteria:
    - Each of the 8 plugin classes implements `setup(ctx)`, declares a distinct `name`, and keeps `register` for direct callers.
    - No `openApi as` cast remains in non-test files of these packages. Today there are seven: `ai/src/harness/routes/conversations.ts:76`, `approvals.ts:66`, `tasks.ts:124`, `announcements/src/announcementsApp.ts:295,324`, `feature-flags/src/featureFlagsApp.ts:95,121`. `tasks.ts:124` narrows a Proxy to `{path: …}`; with `ctx.openApi` typed `OpenApiMiddleware` it takes the typed value directly.
    - `ObservabilityApp` provides itself as the `observability` service; `registerObservabilityApp` and its getter (`ai/src/observability/observabilityAppRegistry.ts:23-27`, a last-registered-wins global like comms and jobs) become deprecated shims.
    - `JobsRunner` (`ai/src/harness/runners/jobsRunner.ts:110-115,217`) takes an optional `jobs: () => JobsService` resolver. `HarnessApp.setup` supplies one that reads `ctx.services.get("jobs")`; with none supplied the runner uses the deprecated getter as today.
    - Names: `AiApp` `ai`, `AIAdminApp` `ai-admin`, `HarnessApp` `harness`, `ObservabilityApp` `observability`, `AnnouncementsApp` `announcements`, `FeatureFlagsApp` `feature-flags`, `HealthApp` `health`, `AdminSpaServeApp` `admin-spa`.
    - Package suites pass with no edits to existing tests.
  - Verification: `bun test src/pluginContract.test.ts` run from each of `ai`, `announcements`, `feature-flags`, `api-health`, `admin-spa`; `bun run test:agent`
  - Seam: each plugin class's public shape, tested in its own package; a source guard in each package
  - Interface: `new X(options)`; `typeof plugin.setup`, `plugin.name`
  - Cases:
    - for each of the 8 classes, in its own package's test: `typeof instance.setup === "function"`, `typeof instance.register === "function"`, and `instance.name` equals the name listed above
    - source guard: no non-test file in `ai/src`, `announcements/src`, `feature-flags/src`, `api-health/src`, `admin-spa/src` matches `/openApi as /`
    - (api-health test) `new HealthApp().register(expressApp)` directly → `GET /health` 200
    - (ai test) two apps in one process, each with `JobsApp` and `HarnessApp` using the jobs runner: a task started on app A is enqueued on A's jobs service and not on B's
    - two apps in one process, each with its own `ObservabilityApp` → `appA.service("observability")` and `appB.service("observability")` are different instances
    - source guard: in `ai/src` non-test files, `getJobsService` and `tryGetJobsService` appear only as the runner's default resolver
  - Blast radius: each package's routes → their existing suites and smokes
  - Test skills: terreno-backend-tests
  - Docs: none (internal move; names documented in T11)
  - Skills: terreno-backend-api

- [ ] **T10** — Default plugin `userModel` and `accessControl` from the context, and move example-backend to the new contract
  - Depends on: T2, T5, T6, T7, T8, T9
  - Files: api/src/betterAuthApp.ts, api/src/accountSecurity/accountSecurityApp.ts, api/src/orgs/orgsApp.ts, api/src/realtime/realtimeApp.ts, api/src/sync/syncApp.ts, api/src/rbac/routes.ts, jobs/src/jobsApp.ts, admin-backend/src/adminApp.ts, example-backend/src/server.ts, example-backend/src/api/commsDev.ts, example-backend/src/firstPartyGetters.test.ts, api/src/pluginDefaults.test.ts, docs/reference/api.md
  - Criteria:
    - Enumerate every first-party plugin or registration factory that takes `userModel` or `accessControl` and record the list. Each option becomes optional and defaults to `ctx.userModel` / `ctx.accessControl`; an explicit option wins.
    - `rbacRouter({access})` with no `userModel` uses the app's.
    - `BetterAuthApp` and `AccountSecurityApp` already default from the app (`api/src/terrenoApp.ts:401-403`, `api/src/accountSecurity/accountSecurityApp.ts:202-204`); they are not the proof. The proof is the factories that require the option today, starting with `rbacRouter` (`api/src/rbac/routes.ts:18`).
    - No authorization fallback changes: a plugin with no `accessControl` from either source keeps its existing fallback (`AccountSecurityApp` requires `admin: true`, `api/src/accountSecurity/accountSecurityApp.ts:201-203`). Nothing newly throws.
    - `example-backend/src/server.ts` passes `userModel` and `accessControl` to `TerrenoApp` only, except where a plugin is constructed for a different process (the jobs worker).
    - Each ordering comment in `example-backend/src/server.ts` is resolved and the outcome recorded: `:243-245` (webhooks after `CommsApp`), `:247-250` (Better Auth first; delete if T2's reproduction showed it stale), `:462` ("Needs AuditApp"), `:469` (`HarnessApp` before `AdminApp`). A hard requirement becomes `dependsOn` on the plugin class, a "when present" rule becomes `after`, and a comment that describes no real constraint is deleted. At least one first-party plugin declares `dependsOn` or `after` as a result, or the task result says why none needed it.
    - `example-backend` code that runs under the app stops using the getters: `server.ts` (`:103` drops `getComms: getCommsService` thanks to T6's default; `:199,344,347` use `terraApp.service(...)`) and `api/commsDev.ts:46` uses `terrenoAppFor(req).service("comms")`. It replaces `registerJobsWorkerShutdown(exampleJobsApp)` (`server.ts:601`) with a call to `terraApp.shutdown()` from its existing signal handling.
    - Code with no request and no app keeps the deprecated getters for now and says so in a comment: `example-backend/src/adminScripts.ts:248` (an admin-script runner), `example-backend/src/utils/betterAuthConfig.ts:426` (a mail callback built before the app), and the standalone worker `example-backend/src/jobs/bootstrapJobsWorker.ts`. Q8 tracks the seam they need.
    - Source guard: `example-backend/src/server.ts` and `example-backend/src/api/**` contain no `getCommsService`, `getJobsService`, `tryGetJobsService` or `registerJobsService` identifier (bare references included).
  - Verification: `cd api && bun test src/pluginDefaults.test.ts`; `cd example-backend && bun test src/firstPartyGetters.test.ts`; `bun run --cwd example-backend compile`; `bun run --cwd example-backend test:agent`
  - Seam: `TerrenoApp.build()` with plugins constructed without the options; a source guard test
  - Interface: `new TerrenoApp({userModel: User, accessControl: access}).register(new BetterAuthApp({config})).register(rbacRouter({access})).register(new AccountSecurityApp())`
  - Cases:
    - `rbacRouter({access})` with no `userModel` (a compile error today): a role-assignment request by an admin updates a row in the app's `User` collection → 200
    - the same route as a non-admin → 403
    - `new AccountSecurityApp()` on a `TerrenoApp` with `AuditApp` registered and no `accessControl` anywhere: a recovery route as a non-admin → 403; as an admin → 200 (existing fallback, unchanged)
    - plugin constructed with an explicit different `userModel`: that model is used, not the app's
    - `example-backend/src/server.ts` contains `userModel:` at most twice (TerrenoApp and `NotificationsApp`, which is constructed at module scope) — source assertion
    - source guard: zero matches for the four identifiers in `server.ts` and `api/**`; fed the string `getComms: getCommsService` the matcher returns 1 match
  - Blast radius: authorization on every route these plugins mount (security-relevant: a plugin silently getting no `accessControl` would open routes) → the 403 case above and each package's existing permission tests
  - Test skills: terreno-backend-tests
  - Docs: docs/reference/api.md (which options default from the app)
  - Skills: terreno-backend-api, update-docs

- [ ] **T11** — Write the plugin how-to, explanation, upgrade note, changelog and agent rules
  - Depends on: T2, T3, T5, T10
  - Files: docs/how-to/write-a-plugin.md, docs/explanation/modular-api-design.md, docs/reference/api.md, mcp-server/src/docs/upgrades/58.1.0.md, changelog/unreleased/plugin-contract-v2.md, changelog/unreleased/plugin-register-optional.md, changelog/unreleased/deprecate-plugin-service-getters.md, changelog/unreleased/routes-helper.md, .rulesync/rules/api/00-api.md, api/typeFixtures/registeredUser/pluginDocs.ts
  - Criteria:
    - `TerrenoPluginContext` carries an `@experimental` JSDoc tag and the how-to says its fields may change until 59.0.0 (Q6).
    - `docs/how-to/write-a-plugin.md` shows one complete plugin: name, `dependsOn`, `setup(ctx)` mounting a route with OpenAPI, providing a service, `onShutdown`. The same code is in `api/typeFixtures/registeredUser/pluginDocs.ts`, a project outside `api/src` that imports only `@terreno/api`, the way an outside package would, and compiles.
    - `docs/explanation/modular-api-design.md` describes ordering, the service registry and why the globals are deprecated. The first-party plugin names are listed in `docs/reference/api.md`.
    - Upgrade note: one entry per row of this IP's Compatibility ledger, in the section the ledger names. If `api-foundations` already created the file for the same release, append sections to it; otherwise create it per `mcp-server/src/docs/upgrades/README.md`.
    - Fragments: `plugin-contract-v2.md` (`Added`), `routes-helper.md` (`Added`), `plugin-register-optional.md` (`Breaking`), `deprecate-plugin-service-getters.md` (`Deprecated`).
    - The "TerrenoPlugin Interface" section of `.rulesync/rules/api/00-api.md` shows `setup(ctx)`; regenerate the rule copies, never hand-edit them.
  - Verification: `bun run check:changelog`; `bun run --cwd api compile && cd api && bun test src/types/register.test.ts`
  - Seam: none beyond the docs fixture
  - Interface: none
  - Cases: none (untestable: prose and release metadata; the docs example is compiled by the fixture runner and `check:changelog` validates the fragments)
  - Blast radius: none
  - Test skills: none
  - Docs: this task is the docs
  - Skills: update-docs, update-agent-docs, upgrading-terreno

## Assumptions

- `api-foundations` T1 and T3 have landed: this plan uses `TerrenoUserModel` and the `api/typeFixtures/` runner. If it has not, T1 here types `ctx.userModel` with today's `UserModel` and T4 adds the fixture runner.
- First-party plugins keep both `setup` and `register` until `register` is removed, so `plugin.register(app)` in adopters' code and docs keeps working.
- Plugin names are kebab-case and stable; they are public API once documented.
- Three of the other module-level registries the audit lists (`api/src/collectionRegistry.ts:49`, `api/src/mcp/registry.ts:21`, `api/src/orgs/organizationSettings.ts:8`) hold model and schema registrations made at import time, before any `TerrenoApp` exists. They are not services and are out of this plan (X2). The fourth, the observability registry, is a last-registered-wins service global and moves to the registry in T9.
- Audit corrections: the plugin count is 22 classes that implement `TerrenoPlugin` (`JobsApp` declares it alongside `JobsRunnerHost`), plus a doc-comment example, plus `AdminApp`, which does not declare it. `TerrenoApp` already mounts the Better Auth session middleware before plugins, so one of the two "ordering lives in comments" examples may be stale; T2 checks before relying on it. All cited cast lines matched the code at `4f1c5370`.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q1 | Is making `register` optional on the `TerrenoPlugin` interface acceptable in a 58.x minor? | Yes, with an upgrade note. | It only breaks code that calls `.register()` on a value typed as the interface; classes and their direct callers are unaffected, and the policy allows a noted breaking change in a minor. | No: keep `register` required until 59, so a v2-only plugin must still ship an empty `register`; T1's "neither" check and the how-to change. | T1, T11 |
| Q2 | When is `register` removed as the way to write a plugin? | Not before 60.0.0. | Outside plugins need more than one major to move; first-party plugins carry both methods at no cost. | 59.0.0: add a removal task to the 59 follow-up and say so in the deprecation. | T11 |
| Q3 | Should `TerrenoApp` handle `SIGTERM` and call `shutdown()` itself? | No. Ship `shutdown()` only; document a three-line handler. | Hosts (Cloud Run entrypoints, the example's `index.ts`, test runners) already own process signals; a framework handler would change exit behaviour for every existing app. | Yes, opt-in `shutdownOnSignals: true`: one option and two cases in T3. | T3 |
| Q4 | Should two plugins with the same name on one app be an error? | No. Names may repeat; service names may not. | Apps may register two instances of one plugin (two health paths, two SPA mounts); a duplicate service is always a bug. | Error: T2 gains a duplicate check and apps with two instances must pass a `name` override. | T2, T6, T9 |
| Q5 | Should `getCommsService()` and the jobs getters be removed in 59.0.0? | Yes: 59.0.0, or three minors after deprecation, whichever is later. | They are the process-global state the registry replaces; the policy requires at least three minors. | Later: change one sentence in the deprecation text. | T7, T11 |
| Q6 | Should `TerrenoPluginContext` ship as stable API in 58.x? | No: mark it `@experimental` until 59.0.0. | No plugin has been written outside the repo; a field is cheap to change now and semver-bound later. | Stable now: drop the tag and one sentence in T11; any later change to the context needs a deprecation cycle. | T1, T11 |
| Q7 | The audit also recommends making `@terreno/api` a peer dependency of every plugin package. Should that be in this plan? | No: X1. | The duplicate-copy bug behind it is suspected, not reproduced, and the change depends on how publish rewrites `workspace:*` (audit 1.4, owned elsewhere). | Yes: add a reproduce-first task and a packaging task, and the install change becomes a Breaking entry. | T11 |
| Q8 | How does code with no request and no app (admin-script runners, mail callbacks built before the app, the standalone jobs worker) reach a service once the global getters are removed? | Leave those call sites on the deprecated getters in this plan; design the seam (for example runners receive `services`) before X4 removes the getters. | Three example-backend call sites have no `TerrenoApp` in scope today; inventing the seam here would add a second contract change to every runner signature. | Design it now: add a task that passes `services` to admin-script runners and worker bootstrap, and widen T10's guard to all of example-backend. | T8, T9, T10 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | `plugin-peer-dependency`: make `@terreno/api` a peer dependency in `comms`, `jobs`, `feature-flags`, `admin-backend`, `announcements`, `api-health` (as `ai` and `admin-spa` already do). Needs a reproduce-first task for the suspected duplicate-copy bug, and is breaking for installs. | Finding 6; suspected only, and it depends on how publish rewrites `workspace:*` (audit 1.4) | M | the publish-pipeline fix for `workspace:*` |
| X2 | `per-app-model-registries`: move the collection, MCP tool and organization-settings registries behind the app | Finding 6 lists them as singletons; they register at import time, which needs a different design | L | T4 |
| X3 | `openapi-registry` (4.10): build the spec from metadata recorded by `modelRouter`, actions and `routes()` | `routes()` is the third registrar the audit's recommendation needs | L | T5 |
| X4 | Remove deprecated service getters and, later, `register` | Second half of the deprecate-then-remove rows | S | Q8's seam; 59.0.0, 60.0.0 |
| X5 | A `terreno generate plugin` scaffold and a published example plugin written outside the repo | The Elephant: the contract has no outside author yet | M | T11 |

## Decisions

None.

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds (fresh subagent each), 17 findings: 15 fixed, 2 moved to questions or expansions (Q6/Q7 from round 1 C10, Q8 from round 2 C1), 0 rebutted. Blocking: 3, all fixed. Left unchecked by cut: whether `after: ["better-auth"]` is needed (T2's reproduction decides).
