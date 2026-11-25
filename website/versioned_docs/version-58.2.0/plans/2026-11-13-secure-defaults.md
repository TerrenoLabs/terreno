# Secure by default

A developer who scaffolds a Terreno app and deploys it today ships several unsafe defaults: request bodies in the logs, `list: [IsOwner]` returning every user's rows, 50 MB JSON parsed before the rate limiter, one shared login rate-limit bucket behind a proxy, wildcard CORS, and placeholder secrets that pass the boot check. The 2026-11-12 audit ranks these as the third of three changes that close most of the gap for an open source framework (findings 3.1 to 3.10). This plan fixes the defaults in `@terreno/api`, `@terreno/syncdb` and the local MCP server. Existing apps, including a HIPAA app in production, keep booting: anything that could break a running app warns now and becomes the default in Terreno 59. New apps created with `create-terreno-app` get the strict behaviour from day one.

## The idea

One switch, `secureDefaults: "warn" | "enforce"` on `TerrenoApp` (env `TERRENO_SECURE_DEFAULTS`), decides what happens when an app relies on an unsafe default. On 58.x the default is `warn`: the app behaves as before and logs one `[secure-defaults] <code>` line per problem, naming the option that fixes it. `enforce` applies the Terreno 59 default now. Terreno 59 flips the default to `enforce`.

Each finding gets one of three rollouts, recorded here so nobody has to infer it:

| Finding | Change | Rollout | Why this rollout |
| --- | --- | --- | --- |
| 3.1 | Request bodies are not logged; body size is. Opt in with `loggingOptions.logRequestBodies` | Silent safe default | Removing data from logs cannot break a request |
| 3.2 | `list: [Permissions.IsOwner]` with no `queryFilter` or `access` scopes the list to the caller's `ownerId` | Default with opt-out (`ownerScopedList: false`) | Fails closed; see Q1 |
| 3.3a | JSON limit 1 MB, `bodyParser.jsonLimit` and per-route overrides | Warn now, flip at 59 | A 413 on an existing upload or signature route is an outage |
| 3.3b | Rate limiter runs before body parsing | Silent safe default | Internal order; no API change |
| 3.3c | `req.rawBody` only on webhook routes | Warn now, flip at 59 | Apps may verify signatures outside `WebhooksApp` |
| 3.4 | `authOptions.profileWritableFields` allowlist for `PATCH /auth/me` and signup | Opt-in now; warn when unset; default `["name", "email"]` at 59 | Silently dropping profile fields breaks existing profile screens |
| 3.5 (part) | A `populatePaths` entry with no `fields` on a registered router | Warn now; registration error at 59 | An error at boot is an outage; full field-level control is X1 |
| 3.6a | `trust proxy` is `1` when `K_SERVICE` or `VERCEL` is set and `trustProxy` is unset | Silent safe default | Rate-limit buckets are never worse than with it off (Q7); it also changes `req.protocol`, `req.secure` and `req.hostname` |
| 3.6b | Memory rate-limit store in production | Warn now; `mongo` at 59 | Adds a database write per request |
| 3.7a | `*` or reflected CORS origin with credentials in production | Warn now; boot error at 59 | A boot error is an outage |
| 3.7b | `nosniff`, `Referrer-Policy`, `X-Frame-Options`, HSTS in production, no `X-Powered-By` | Default with opt-out (`securityHeaders: false`) | Additive headers; see Q8 |
| 3.8 | `wipeOnSignOut` unset | Warn now; `true` at 59 | A wipe drops unsynced local writes |
| 3.9 | Local MCP `database_query` refuses non-loopback hosts, redacts credential fields, blocks session and token collections | Default with opt-out (two env vars) | Developer tool; the refusal names the opt-out |
| 3.10a | Secrets under 32 characters or equal to a known example value, in production | Warn now; boot error at 59 | A boot error is an outage |
| 3.10b | `example-backend/.env` untracked | Repository change | No adopter impact |

Rejected: flipping every default now with opt-outs. It is the shortest path to safe new apps, but it turns a routine upgrade of a production app into an incident (413s, dropped profile fields, boot failures). The scaffold opts new apps into `enforce` instead.

Three parts of the assigned findings are not built here, and Q3 puts that deferral in front of the requester: full field-level read and write control (3.5; this plan ships only the populate guard, T17), native local-data encryption (3.8; this plan ships the sign-out warning and the documentation), and refresh-token rotation with minimum password length (3.10). Each has a follow-up slug under Expansions.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Tracer: `secureDefaults` mode, weak and placeholder secret check | none | api | Production build with a 10-char `TOKEN_SECRET`: one warning in `warn`, throws in `enforce` |
| T2 | Stop logging request bodies by default | T1 | api | Request log line has a byte count and no body unless opted in |
| T3 | Scope `list` to the owner when `list` uses `IsOwner` | none | api | User A lists only A's rows; admin lists all; opt-out restores old rows |
| T4 | Bound JSON body size | T2 | api | 2 MB POST: 413 in `enforce`; 200 plus one warning in `warn` |
| T5 | Run the rate limiter before body parsing | T4 | api | An over-limit client sending malformed JSON gets 429, not 400 |
| T6 | Capture `rawBody` only for webhook routes | T5 | api | `enforce`: `rawBody` set on webhook route only; `warn`: one warning on a read elsewhere |
| T7 | Trust the platform proxy on Cloud Run and Vercel | none | api | `K_SERVICE=x`: two forwarded IPs get separate auth buckets |
| T8 | Warn on, then replace, the in-memory rate-limit store in production | T6, T7 | api | Production, no `store`: warning in `warn`, Mongo store in `enforce` |
| T9 | Refuse wildcard CORS with credentials in production | T8 | api | Production, no `corsOrigin`: warning in `warn`, throws in `enforce` |
| T10 | Send security headers by default | T9 | api | `GET /health` carries the four headers; `securityHeaders: false` removes them |
| T11 | Allowlist self-service user writes | T2 | api | With `profileWritableFields: ["name"]`, `plan` in `PATCH /auth/me` is not saved |
| T12 | Warn when sign-out keeps local data; document native storage | none | syncdb, docs | `signOut()` with `wipeOnSignOut` unset warns once and keeps data |
| T13 | Guard the local MCP `database_query` tool | none | mcp-server | Remote URI refused; `hash` redacted; `sessions` refused |
| T14 | Untrack `example-backend/.env` | none | example-backend | `git ls-files` no longer lists it; `ensureEnvFile` creates it from the example |
| T15 | New apps and local example runs use `enforce` | T11, T17 | create-terreno-app, example-backend | Generated server passes `secureDefaults: "enforce"`; example e2e suite passes |
| T17 | Flag populate paths that return whole documents | T10 | api | Router with `populatePaths: [{path: "ownerId"}]`: warning in `warn`, `build()` throws in `enforce` |
| T16 | Reference docs, explanation page, upgrade note, agent rules | T3, T8, T12, T13, T14, T15 | docs | Docs match shipped behaviour; `check:upgrade-docs` and `rules:check` pass |

Tracer: `TerrenoApp.build()` → `secureDefaults` reporter → a production check that warns or throws.
E2E: None new — every criterion is provable in-process with supertest or a unit test; T15 reruns the existing `example-frontend/e2e` suite under `enforce`.
Regression: 1 case (API-new-1 → `docs/regression/api.md`): proxy and warning behaviour on a real Cloud Run deployment.
User guide: None — framework defaults for developers; no screen in the example app changes.
Design: None — no canvas.
Out of scope: full field-level access control, native encryption, refresh-token rotation, password length, one origin list for sockets and Better Auth, production log level (see Expansions).
Open risks: on Cloud Run and Vercel `req.protocol`, `req.secure` and `req.hostname` start following the forwarded headers (T7); an app that relied on `list: [IsOwner]` returning all rows to non-admin staff gets fewer rows with no error (Q1); an app that embeds a backend-served page in a cross-origin frame is blocked by `X-Frame-Options` until it opts out (Q8); `rateLimit.skip` functions that read `req.body` see `undefined` after T5.
Elephant: nobody has checked the production HIPAA app against these changes. T3 changes which rows a list returns the moment the package is upgraded, and the `warn` lines are only useful if someone reads the first production boot log after upgrading. The upgrade note says to grep for `list: [Permissions.IsOwner]` and read that log, but a routine dependency bump can skip both.

## E2E tests

None — no new spec. Every acceptance criterion is an HTTP response, a log line, a thrown error or a returned string that an in-process test asserts (`bun test` with supertest, per the unit and integration tier in `docs/testing/e2e.md`). T15's cross-process criterion is covered by the existing specs in `example-frontend/e2e/*.spec.ts`, run with `bun run frontend:e2e`.

## Regression cases

Destination: API → docs/regression/api.md (use the suite that declares `Area: API`; create the file if none does)

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| API-new-1 | Deployed proxy and warning behaviour | A backend on this version deployed to Cloud Run with `rateLimit.trustProxy` unset and `limits.authMax` 3. Read the first boot log. From network A send 4 wrong-password logins; from network B send 1; from network A send 1 more with a made-up `X-Forwarded-For: 9.9.9.9` header | The boot log shows one `[secure-defaults]` line per unsafe default and no secret values. Network A's 4th login is 429, network B's login is not 429, and A's spoofed request is still 429 | Cloud Run | manual | secure-defaults |

Supertest proves the code path with hand-set headers (T7); only a real deployment proves what the platform puts in `X-Forwarded-For` (A6).

## User guide

None — no user-visible change. The plan changes framework defaults that developers configure; no example-app screen, label or flow changes.

## Design

None — no canvas.

## Assumptions

- A1. The audit was re-verified against the code at `6cf1f06c`. Corrections:
  - `setupEnvironment` (`api/src/expressServer.ts:111`), which the audit cites as the secret presence check, has no caller outside its own test. `TerrenoApp.build()` validates no secret today. T1 adds the check to `build()` and leaves `setupEnvironment` alone.
  - `logRequests` is mounted after the auth routes (`api/src/terrenoApp.ts:481-485`), so login and signup bodies are not in the request log today. Every model route body is.
  - `OwnerQueryFilter` does not exempt admins, while `Permissions.IsOwner` lets admins through. T3 uses its own filter that matches `IsOwner`, not `OwnerQueryFilter`.
  - `IsOwnerOrReadOnly` on `list` is read-for-everyone by design, so T3 leaves it unscoped. Only `Permissions.IsOwner` in `list` triggers scoping.
  - No router in this repository uses `list: [Permissions.IsOwner]`, so T3 changes no in-repo behaviour.
  - The tracked `example-backend/.env` holds `your-secret-key-here` placeholders and differs from `.env.example` (no `AUTH_PROVIDER`, no replica-set URI). After T14 a fresh clone runs on the `.env.example` values.
  - Minimum password length on legacy signup stays suspected: `api/src` sets no `passwordValidator`. It is parked in X3 as reproduce-first.
- A2. "58.x" means the next release on the 58 line. The upgrade note file is `mcp-server/src/docs/upgrades/<that version>.md`; T16 names it from `package.json` at build time. "Terreno 59" is the next Expo-aligned major, where the default flips. This plan does not make the 59 change.
- A3. Docs shared by several tasks (`docs/reference/api.md`, the explanation page, the upgrade note) and every agent-rule file are written once in T16, so no other task waits on them. Tasks whose docs live in a page nobody else edits write that page themselves. The repository rule is docs in the same slice; the slice is this plan's pull request. `2026-11-02-admin-spa-ssr.md` T12 is the precedent.
- A4. Each task writes its own fragment in `changelog/unreleased/` (category `Changed` for behaviour changes, `Added` for new options, `Breaking` for T3 because it changes the rows an existing route returns).
- A5. Code follows the repository rules: Bun, const arrow functions, explicit return types, Luxon for dates, `logger` on the backend, no barrel files, no AI attribution, no conventional-commit prefixes, `master` as the base.
- A6. Vercel sets `VERCEL=1` and overwrites `X-Forwarded-For`, and Cloud Run sets `K_SERVICE` and appends the client address as the last `X-Forwarded-For` entry. The repository's own doc already tells Cloud Run users to pass `trustProxy: 1` (`docs/how-to/rate-limiting.md`).
- A7. T1 → T2 → T4 → T5 → T6 → T8 → T9 → T10 → T17 is a serial chain for file contention, not because each task reads the previous one's behaviour: every link edits the middleware block in `TerrenoApp.build()` (`api/src/terrenoApp.ts:416-490`), and the build tool will not run two tasks that share a file at once. Real read dependencies are only T1 (the reporter), T4 → T6 (`bodyParsing.ts`) and T4 → T5 (parser mount). T3, T7, T12, T13 and T14 are independent and ship first.

## Tasks

Shared interface from T1, used by T4, T6, T8, T9, T11:

```typescript
// api/src/secureDefaults.ts
export type SecureDefaultsMode = "warn" | "enforce";
export interface SecureDefaultsReporter {
  mode: SecureDefaultsMode;
  // warn mode: logger.warn once per code+key. enforce mode: no log; the caller applies the strict default.
  report: (args: {code: string; key?: string; message: string}) => void;
  // warn mode: same as report. enforce mode: throws APIError 500 with title `[secure-defaults] <code>: <message>`.
  reportOrThrow: (args: {code: string; key?: string; message: string}) => void;
}
export const resolveSecureDefaultsMode = (option?: SecureDefaultsMode): SecureDefaultsMode; // option, else env TERRENO_SECURE_DEFAULTS, else "warn"
export const createSecureDefaultsReporter = (args: {mode: SecureDefaultsMode}): SecureDefaultsReporter;
```

Warning text: `[secure-defaults] <code>: <message> This becomes the default in Terreno 59. Set secureDefaults: "enforce" to adopt it now.` `build()` stores the reporter on `app.locals.secureDefaults`. "Production" means `process.env.NODE_ENV === "production"`.

- [ ] **T1** — Add the secureDefaults mode and check secret strength in production
  - Depends on: none
  - Files: api/src/secureDefaults.ts, api/src/secureDefaults.test.ts, api/src/terrenoApp.ts, api/src/terrenoApp.secureDefaults.test.ts, api/src/index.ts, docs/explanation/secure-defaults.md, docs/reference/environment-variables.md, changelog/unreleased/secure-defaults-mode.md
  - Criteria: `TerrenoAppOptions.secureDefaults` and `TERRENO_SECURE_DEFAULTS` select the mode (option wins; an unknown env value throws at `build()`). In production, `build()` checks each of `TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `SESSION_SECRET`, `BETTER_AUTH_SECRET` that is set: shorter than 32 characters, or equal to a known example value, calls `reportOrThrow` with code `weak-secret` and the variable name as key. The secret value never appears in a log or error. Outside production nothing is checked.
  - Seam: `new TerrenoApp(options).build()` and the exported functions above
  - Interface: as in the shared block. Known example values: `your-secret-key-here`, `your-refresh-secret-key-here`, `your-session-secret-here`, `dev-token-secret`, `dev-refresh-secret`, `dev-session-secret`, `terreno-example-better-auth-secret-dev-only-32`, `secret`, `changeme`.
  - Cases:
    - no option, no env → `mode === "warn"`; env `enforce` → `"enforce"`; option `"warn"` with env `enforce` → `"warn"`; env `strict` → `build()` throws with `TERRENO_SECURE_DEFAULTS` in the message
    - `report` twice with the same code and key → one `logger.warn`; different key → two
    - `NODE_ENV=production`, `TOKEN_SECRET="short"`, mode `warn` → `build()` returns; one warning containing `weak-secret` and `TOKEN_SECRET`, not containing `short`
    - same, mode `enforce` → `build()` throws; message contains `TOKEN_SECRET`, not `short`
    - `NODE_ENV=production`, `SESSION_SECRET="terreno-example-better-auth-secret-dev-only-32"` (long but known), `enforce` → throws
    - `NODE_ENV=production`, all four secrets 40 random characters, `enforce` → no throw, no `weak-secret` warning
    - `NODE_ENV=test`, `TOKEN_SECRET="short"`, `enforce` → no throw
    - `BETTER_AUTH_SECRET` unset → not checked
  - Blast radius: none (new checks; `warn` changes no behaviour)
  - Docs: creates `docs/explanation/secure-defaults.md` with the mode and the secret rule; adds `TERRENO_SECURE_DEFAULTS` to `docs/reference/environment-variables.md`
  - Test skills: terreno-backend-tests
- [ ] **T2** — Stop logging request bodies by default
  - Depends on: T1
  - Files: api/src/expressServer.ts, api/src/expressServer.test.ts, api/src/terrenoApp.ts, api/src/terrenoApp.requestLogging.test.ts, api/src/logger.ts, changelog/unreleased/request-body-logging-off.md
  - Criteria: the request log line for a request with a body ends with ` Body: <n> bytes` and holds no body content. With `loggingOptions.logRequestBodies: true` it holds the redacted JSON as today. `DISABLE_LOG_ALL_REQUESTS=true` still suppresses the line.
  - Seam: exported `logRequests(req, res, next)` middleware, asserting on the `logger.debug` call; one case through a built `TerrenoApp` (supertest). Depends on T1 only because both edit `api/src/terrenoApp.ts`.
  - Interface: `LoggingOptions.logRequestBodies?: boolean` (default `false`), read from `res.locals.loggingOptions`. `<n>` is `Buffer.byteLength(JSON.stringify(req.body))`. Note for the implementer: `res.locals.loggingOptions` is set after `logRequests` is mounted today (`api/src/terrenoApp.ts:483-490`); swap the two.
  - Cases:
    - `POST /todos` body `{"title":"Buy milk"}`, option unset → message matches `POST <- /todos` and ends ` Body: 20 bytes`; does not contain `Buy milk`
    - same with `logRequestBodies: true` → contains `Body: {"title":"Buy milk"}`
    - `logRequestBodies: true`, body `{"password":"hunter2"}` → contains `<REDACTED>`, not `hunter2`
    - `GET /todos` with no body → no `Body:` segment
    - `DISABLE_LOG_ALL_REQUESTS=true` → `logger.debug` not called
    - built `TerrenoApp` with `loggingOptions: {logRequestBodies: true}`, `POST` to a registered route with `{"title":"Buy milk"}` → a debug line contains `Body: {"title":"Buy milk"}`; same app without the option → the line ends ` Body: 20 bytes`
  - Blast radius: the dev JSONL log that `terreno-mcp-local` `read_logs` reads carries the same line → covered by the first case (same logger call)
  - Docs: the reference paragraph and the agent rule (`.rulesync/rules/api/02-logging-tracing.md`) are written in T16
  - Test skills: terreno-backend-tests
- [ ] **T3** — Scope list to the owner when list uses IsOwner without a filter
  - Depends on: none
  - Files: api/src/ownerListScope.ts, api/src/ownerListScope.test.ts, api/src/api.ts, changelog/unreleased/owner-scoped-list.md
  - Criteria: when a router's `permissions.list` contains `Permissions.IsOwner`, it has no `queryFilter` and no `access`, `ownerScopedList` is not `false`, and the model has an `ownerId` path, `_buildModelRouter` sets `options.queryFilter` to the owner list filter before its `replaceCollectionOptions` call (`api/src/api.ts:805`), so the collection registry, sync and MCP read the scoped options. Registration logs one `logger.info` naming the model and the opt-out. A model with no `ownerId` path is left unscoped with one `logger.warn`. A router whose `read`, `update` or `delete` uses `IsOwner` or `IsOwnerOrReadOnly`, whose `list` is non-empty and has no owner permission, and that has no `queryFilter` or `access`, logs one `logger.warn` at registration saying list returns every owner's rows; its behaviour does not change (the audit's wider recommendation, kept as a warning because public lists are a legitimate design).
  - Seam: `GET /<path>` on a `modelRouter` (HTTP route, supertest)
  - Interface: `ModelRouterOptions.ownerScopedList?: boolean` (default `true`). Filter: admin (`user.admin`) → `{}`; signed-in user → `{ownerId: user.id}`; no user → `null` (empty list). Response shape unchanged: `{data, more, page, limit, total}`, except that a `null` filter answers `{data: []}` only, as today (`api/src/api.ts:944-946`).
  - Cases (documents: 2 owned by A, 3 owned by B; router `permissions: {list: [Permissions.IsOwner], read: [Permissions.IsOwner], create: [Permissions.IsAuthenticated], update: [Permissions.IsOwner], delete: [Permissions.IsOwner]}`):
    - A lists → 200, `data.length === 2`, `total === 2`, every `ownerId` is A
    - A lists with `?ownerId=<B id>` (with `ownerId` in `queryFields`) → 200, same 2 rows
    - admin lists → 200, 5 rows
    - `allowAnonymous: true`, no token → 200, body exactly `{"data": []}`
    - `ownerScopedList: false` → A gets 5 rows
    - explicit `queryFilter: () => ({})` → A gets 5 rows; the info line is not logged
    - `list: [Permissions.IsOwnerOrReadOnly]` → A gets 5 rows
    - `list: [Permissions.IsAuthenticated]`, `read: [Permissions.IsOwner]`, no `queryFilter` → A gets 5 rows (unchanged) and registration logged one warning naming the model and `queryFilter`; the same router with `queryFilter: OwnerQueryFilter` → no warning
    - no token, `allowAnonymous` unset → 401
  - Blast radius: sync snapshots and `GET /sync/entities` read `options.queryFilter` (`resolveSyncQueryFilter`, `api/src/sync/routes.ts`) → one backend case: a `broadcast`-scoped synced router with `list: [Permissions.IsOwner]` serves A only A's rows in the snapshot. MCP list tools read the same registry options → no separate case. Live sync deltas were not traced: add one case that a change to B's document is not delivered to A's socket on that router; if it is delivered, that gap also exists for an explicit `queryFilter` today, so record it for `sync-and-query-performance` instead of fixing it here.
  - Docs: `docs/reference/api.md` "modelRouter list queries" in T16
  - Test skills: terreno-backend-tests
  - Coordination: `api-foundations` unifies the two permission systems and also edits `permissions`. This task stays out of `api/src/permissions.ts`. Whichever lands second rebases, and the unified system must keep the rule "owner permission on list implies owner list scope".
- [ ] **T4** — Bound JSON body size with a configurable limit
  - Depends on: T2
  - Files: api/src/bodyParsing.ts, api/src/bodyParsing.test.ts, api/src/webhooks/rawBody.ts, api/src/terrenoApp.ts, changelog/unreleased/json-body-limit.md
  - Criteria: `TerrenoAppOptions.bodyParser` sets the JSON limit globally and per path prefix. With no `jsonLimit`: `enforce` uses `1mb`; `warn` keeps `50mb` and reports code `json-limit` the first time a JSON body over 1 MB arrives under a path prefix. The key is the first path segment (`/todos/123` → `/todos`), and each reporter keeps at most 50 keys per code, so ids in paths cannot grow the log.
  - Seam: `POST` to a route on a built `TerrenoApp` (supertest)
  - Interface: `bodyParser?: {jsonLimit?: string | number; routeJsonLimits?: Record<string, string | number>}`. The longest matching path prefix in `routeJsonLimits` wins over `jsonLimit`. Over the limit → 413.
  - Cases:
    - `enforce`, no options, 2 MB JSON to `/echo` → 413
    - `enforce`, 500 KB JSON → 200
    - `warn`, no options, 2 MB JSON → 200 and one warning with `json-limit` and `/echo`; a second 2 MB request to `/echo` → no second warning
    - `warn`, 500 KB JSON → no warning
    - `jsonLimit: "5mb"`, either mode, 2 MB → 200, no warning; 6 MB → 413
    - `enforce`, `routeJsonLimits: {"/uploads": "10mb"}`: 2 MB to `/uploads/a` → 200; 2 MB to `/echo` → 413
    - 51 MB in `warn` → 413
    - `warn`: 2 MB to `/echo/1` then 2 MB to `/echo/2` → one warning (key `/echo`)
  - Blast radius: none (request parsing only)
  - Docs: `TerrenoApp` options in T16
  - Test skills: terreno-backend-tests
- [ ] **T5** — Run the rate limiter before body parsing
  - Depends on: T4
  - Files: api/src/terrenoApp.ts, api/src/terrenoApp.bodyOrder.test.ts, changelog/unreleased/rate-limit-before-body-parsing.md
  - Criteria: in `build()` the JSON and urlencoded parsers mount after the rate-limit middleware. JWT decode and the Better Auth session middleware stay ahead of the limiter, so authenticated keys still use the user id. The middleware-order comment at `api/src/terrenoApp.ts:180-190` matches the new order.
  - Seam: requests to a built `TerrenoApp` (supertest)
  - Interface: no new option. Order: CORS → `beforeJsonSetup` and custom middleware → auth decode → rate limiter → body parsers → auth routes.
  - Cases:
    - `rateLimit: {limits: {apiMax: 1}}`: first `POST /echo` with `{"a":1}` → 200; second `POST /echo` with the malformed body `{"a":` → 429 (today: 400)
    - same limits, two different signed-in users from one address → each user's first request is 200
    - `POST /auth/login` with valid credentials → 200 and a token (the body still reaches the auth route)
    - `rateLimit: false`: malformed JSON → 400
    - a webhook route registered through `WebhooksApp` still receives `req.rawBody` and verifies an HMAC signature → 200
    - `rateLimit: {skip: (req) => { seen = req.body; return false; }}`, `POST /echo` with `{"a":1}` → `seen` is `undefined` and the handler still receives `{a: 1}`
  - Blast radius: a `rateLimit.skip` function no longer sees `req.body` → the case above, and the upgrade note (T16)
  - Docs: the middleware order sentence in `docs/how-to/rate-limiting.md` is written in T16
  - Test skills: terreno-backend-tests
- [ ] **T6** — Capture rawBody only for webhook routes
  - Depends on: T5
  - Files: api/src/bodyParsing.ts, api/src/bodyParsing.rawBody.test.ts, api/src/webhooks/rawBody.ts, api/src/webhooks/rawBody.test.ts, api/src/webhooks/webhooksApp.ts, api/src/terrenoApp.ts, docs/how-to/inbound-webhooks.md, changelog/unreleased/raw-body-webhooks-only.md
  - Criteria: `build()` collects the paths of every route registered on a `WebhooksApp` plus `bodyParser.rawBodyPaths`. In `enforce`, `req.rawBody` is set only for requests whose path starts with one of them. In `warn`, it is set on every request as today, and reading it on any other path reports code `raw-body` once per first path segment (same keying and cap as T4).
  - Seam: requests to a built `TerrenoApp` with a `WebhooksApp` route and a plain route that returns `Boolean(req.rawBody)`
  - Interface: `bodyParser.rawBodyPaths?: string[]` (path prefixes). `WebhooksApp` exposes its route paths to `TerrenoApp` (a read-only getter).
  - Cases:
    - `enforce`: `POST /webhooks/stripe` with a valid signature → 200; `POST /plain` → handler sees `rawBody` `undefined`
    - `enforce`, `rawBodyPaths: ["/plain"]` → handler sees a Buffer equal to the sent bytes
    - `warn`: `POST /plain` whose handler reads `req.rawBody` → Buffer present; one warning with `raw-body` and `/plain`; a second request → no second warning
    - `warn`: `POST /plain2` whose handler never reads `req.rawBody` → no warning
    - `warn`: webhook route reads `req.rawBody` → no warning
  - Blast radius: `hmacSignature`, `stripeSignature`, `sendgridSignature` and `twilioSignature` read `req.rawBody` → the first case covers the HMAC verifier through a real route
  - Docs: `docs/how-to/inbound-webhooks.md` (signature checks outside `WebhooksApp` need `rawBodyPaths`)
  - Test skills: terreno-backend-tests
- [ ] **T7** — Trust the platform proxy on Cloud Run and Vercel and flag ignored forwarded addresses
  - Depends on: none
  - Files: api/src/rateLimit/applyTrustProxy.ts, api/src/rateLimit/applyTrustProxy.test.ts, api/src/rateLimit/middleware.ts, api/src/rateLimit/rateLimit.test.ts, docs/how-to/rate-limiting.md, changelog/unreleased/rate-limit-trust-proxy-default.md
  - Criteria: with `rateLimit.trustProxy` unset, `trust proxy` is `1` when `K_SERVICE` or `VERCEL` is set, otherwise `false`. An explicit value, including `false`, always wins. With `rateLimit: false` the helper is not called and `trust proxy` keeps Express's default. When `trust proxy` is off and a request carries `X-Forwarded-For`, the limiter logs one `logger.error` per app that names `rateLimit.trustProxy`.
  - Seam: `applyRateLimitTrustProxy(app, options)` and requests through the rate-limit middleware (supertest)
  - Interface: unchanged signature; reads `process.env.K_SERVICE` and `process.env.VERCEL`
  - Cases:
    - no env, `trustProxy` unset → `app.get("trust proxy")` is `false`
    - `K_SERVICE=svc`, unset → `1`; `VERCEL=1`, unset → `1`
    - `K_SERVICE=svc`, `trustProxy: false` → `false`; `trustProxy: 2` → `2`
    - `K_SERVICE=svc`, `limits: {authMax: 1}`: `POST /auth/login` with `X-Forwarded-For: 1.1.1.1` → not 429; again with `1.1.1.1` → 429; with `2.2.2.2` → not 429
    - no env: request with `X-Forwarded-For: 1.1.1.1` → one error log containing `trustProxy`; a second request → no second log
    - no env: request without the header → no error log
    - `K_SERVICE=svc`, `rateLimit: false` on a built `TerrenoApp` → `app.get("trust proxy")` is `false`
    - `K_SERVICE=svc`: a route returning `{protocol: req.protocol, secure: req.secure}` called with `X-Forwarded-Proto: https` → `{protocol: "https", secure: true}`; with no env → `{protocol: "http", secure: false}`
  - Blast radius: `trust proxy` also makes Express honour `X-Forwarded-Proto` and `X-Forwarded-Host`, so `req.protocol`, `req.secure` and `req.hostname` change on those platforms as well as `req.ip`. Readers in this repository: `api/src/mcp/serviceTokens.ts:116` (builds the MCP URL from `req.protocol`) and `api/src/githubAuth.ts:214` (`req.secure` for the cookie flag); both become correct behind TLS termination → the protocol case above. `DocumentStorageApp` upload limits key on `req.ip`. All four are listed in the upgrade note.
  - Docs: `docs/how-to/rate-limiting.md` Cloud Run and trust-proxy sections
  - Test skills: terreno-backend-tests
- [ ] **T8** — Warn on the in-memory rate-limit store in production and use Mongo under enforce
  - Depends on: T6, T7
  - Files: api/src/rateLimit/createStore.ts, api/src/rateLimit/createStore.test.ts, api/src/webhooks/webhooksApp.ts, api/src/webhooks/webhooksApp.test.ts, api/src/terrenoApp.ts, docs/how-to/rate-limiting.md, changelog/unreleased/rate-limit-store-default.md
  - Criteria: in production with `rateLimit.store` unset, `warn` keeps the memory store and reports code `rate-limit-memory-store`; `enforce` uses the Mongo store. An explicit `store` is used as given with no warning. In production a `WebhooksApp` with `idempotency.store` unset logs one `logger.warn` at `register()` naming `idempotency.store: "mongo"`, in both modes; its store does not change.
  - Seam: `createRateLimitStore(options, context)` and `WebhooksApp.register`
  - Interface: `createRateLimitStore(options: RateLimitOptions, context?: {reporter?: SecureDefaultsReporter}): RateLimitStore`. T6 is a dependency because both edit `api/src/terrenoApp.ts` and `api/src/webhooks/webhooksApp.ts`; T7 because both edit `docs/how-to/rate-limiting.md`.
  - Cases:
    - `NODE_ENV=production`, no store, `warn` → memory store; one warning with `rate-limit-memory-store`
    - `NODE_ENV=production`, no store, `enforce` → Mongo store (a `consume` call writes to the `rateLimitHits` collection)
    - `NODE_ENV=production`, `store: "memory"`, either mode → memory store, no warning
    - `NODE_ENV=test`, no store, `enforce` → memory store, no warning
    - `NODE_ENV=production`, `new WebhooksApp()` registered → one warning naming `idempotency.store`; `new WebhooksApp({idempotency: {store: "mongo"}})` → none
  - Blast radius: under `enforce` every limited request writes to Mongo, and the database-wide change stream sees those writes until `sync-and-query-performance` narrows it (finding 3.11) → stated in the explanation page (T16); no test
  - Docs: `docs/how-to/rate-limiting.md` "Stores in production"
  - Test skills: terreno-backend-tests
- [ ] **T9** — Refuse wildcard CORS with credentials in production
  - Depends on: T8
  - Files: api/src/corsDefaults.ts, api/src/corsDefaults.test.ts, api/src/terrenoApp.ts, changelog/unreleased/cors-production-check.md
  - Criteria: in production, `corsOrigin` unset, `"*"` or `true` calls `reportOrThrow` with code `cors-wildcard` at `build()`. A string, RegExp, array or function origin passes. Outside production nothing is checked and the default stays `"*"`.
  - Seam: `new TerrenoApp(options).build()`
  - Interface: `assertSafeCorsOrigin(args: {corsOrigin: CorsOrigin | undefined; reporter: SecureDefaultsReporter}): void`
  - Cases:
    - production, unset, `warn` → builds; one warning with `cors-wildcard`; `OPTIONS /health` with `Origin: https://a.example` still answers `Access-Control-Allow-Origin: *`
    - production, unset, `enforce` → `build()` throws; message contains `corsOrigin`
    - production, `true`, `enforce` → throws; `"*"`, `enforce` → throws
    - production, `["https://app.example.com"]`, `enforce` → builds; no warning
    - production, `/\.example\.com$/`, `enforce` → builds
    - `NODE_ENV=test`, unset, `enforce` → builds
  - Blast radius: none
  - Docs: `corsOrigin` reference in T16
  - Test skills: terreno-backend-tests
- [ ] **T10** — Send security headers by default
  - Depends on: T9
  - Files: api/src/securityHeaders.ts, api/src/securityHeaders.test.ts, api/src/terrenoApp.ts, changelog/unreleased/security-headers.md
  - Criteria: every response from a built `TerrenoApp` carries the default headers unless `securityHeaders` turns them off; `X-Powered-By` is never sent. The middleware mounts before routes and plugins, so a route that sets one of these headers itself wins. No new dependency is added.
  - Seam: `GET /health` (or any route) on a built `TerrenoApp` (supertest)
  - Interface: `securityHeaders?: false | {contentTypeOptions?: boolean; referrerPolicy?: string | false; frameOptions?: "DENY" | "SAMEORIGIN" | false; hsts?: string | false}`. Defaults: `X-Content-Type-Options: nosniff`; `Referrer-Policy: no-referrer`; `X-Frame-Options: SAMEORIGIN`; `Strict-Transport-Security: max-age=15552000` only in production.
  - Cases:
    - defaults, `NODE_ENV=test` → the three non-HSTS headers present with the values above; no `Strict-Transport-Security`; no `X-Powered-By`
    - defaults, `NODE_ENV=production` → `Strict-Transport-Security: max-age=15552000`
    - `securityHeaders: false` → none of the four; still no `X-Powered-By`
    - `{frameOptions: false}` → no `X-Frame-Options`; `nosniff` still present
    - `{frameOptions: "DENY", hsts: "max-age=60"}` in production → those exact values
    - a route that calls `res.setHeader("X-Frame-Options", "DENY")` → response has `DENY`
    - a 404 and a 500 response also carry `nosniff`
  - Blast radius: pages the backend serves (`AdminSpaServeApp`, OAuth consent, Swagger UI) can no longer be framed cross-origin → Q8 and the upgrade note; one case: `GET` on a static plugin route carries `X-Frame-Options: SAMEORIGIN`
  - Docs: `TerrenoApp` options in T16
  - Test skills: terreno-backend-tests
- [ ] **T11** — Allowlist self-service user writes on PATCH /auth/me and signup
  - Depends on: T2
  - Files: api/src/auth.ts, api/src/selfServiceUserFields.ts, api/src/selfServiceUserFields.test.ts, api/src/auth.selfService.test.ts, api/src/betterAuth.selfService.test.ts, api/src/betterAuthSetup.ts (only if the reproduce-first case fails), api/src/expressServer.ts, changelog/unreleased/profile-writable-fields.md
  - Criteria: with `authOptions.profileWritableFields` set, `PATCH /auth/me` saves only listed top-level fields (a dotted or nested write key counts by its root field); `SELF_SERVICE_BLOCKED_USER_FIELDS` are dropped even when listed. Signup uses `authOptions.signupWritableFields`, defaulting to `profileWritableFields`; `email` and `password` are always accepted at signup. Dropped keys log one `logger.warn` with the key names and the route, never the values. With the option unset: `warn` keeps today's behaviour and reports code `profile-writable-fields` (key: field name) once per field outside `["name", "email"]`; `enforce` applies `["name", "email"]`. The email-change password check is unchanged.
  - Seam: `PATCH /auth/me` and `POST /auth/signup` (HTTP routes, supertest), legacy JWT app with a User schema that adds `plan: String` and `credits: Number`
  - Interface: `AuthOptions.profileWritableFields?: string[]`, `AuthOptions.signupWritableFields?: string[]`. Responses keep today's shape and statuses.
  - Cases:
    - `profileWritableFields: ["name"]`: `PATCH /auth/me {"name":"Ann","plan":"pro"}` → 200; stored `name` is `Ann`, `plan` unchanged; one warning naming `plan`
    - `profileWritableFields: ["name"]`: `{"email":"new@example.com","currentPassword":"<correct>"}` → 200; stored email unchanged
    - `profileWritableFields: ["name","plan"]`: `{"plan":"pro"}` → stored `plan` is `pro`
    - `profileWritableFields: ["name","admin"]`: `{"admin":true}` → stored `admin` stays `false`
    - `profileWritableFields: ["name"]`: `{"plan.tier":"pro"}` → nothing saved
    - unset, `warn`: `{"plan":"pro"}` → stored `plan` is `pro`; one warning with `profile-writable-fields` and `plan`; a second request → no second warning; `{"name":"Ann"}` → no warning
    - unset, `enforce`: `{"name":"Ann","plan":"pro"}` → `name` saved, `plan` not
    - signup, `profileWritableFields: ["name"]`: body `{email, password, name: "Ann", credits: 999}` → user created with `name` `Ann` and default `credits`
    - signup, `signupWritableFields: ["name","credits"]`, `profileWritableFields: ["name"]` → `credits` 999 saved
    - `PATCH /auth/me` with no token → 401; with `{"password":"x"}` → 400 as today
    - reproduce first (Better Auth is the default provider): app with `BetterAuthApp`, `POST {basePath}/sign-up/email` with `{email, password, name, plan: "pro", credits: 999}` → the app User row has default `plan` and `credits`. If this case fails before any change, apply the same allowlist where the Better Auth user is synced to the app User (`syncBetterAuthUser` in `api/src/betterAuthSetup.ts`, added to this task's files) until it passes.
  - Blast radius: T2 is a dependency only because both edit `api/src/expressServer.ts` (`AuthOptions`). The example frontend profile screen calls `PATCH /auth/me` → T15 checks it under `enforce`.
  - Docs: "PATCH /auth/me" reference in T16
  - Test skills: terreno-backend-tests
- [ ] **T12** — Warn when sign-out keeps local data and document native storage
  - Depends on: none
  - Files: syncdb/src/client.ts, syncdb/src/client.signOutWarning.test.ts, docs/reference/syncdb.md, docs/how-to/use-syncdb-correctly.md, docs/explanation/local-first-data.md, changelog/unreleased/syncdb-sign-out-wipe-warning.md
  - Criteria: `client.signOut()` with a signed-in user and `wipeOnSignOut` undefined keeps local data, as today, and calls `console.warn` once per client saying the data was kept and that the default becomes `true` in Terreno 59. `true` wipes with no warning; `false` keeps with no warning. The docs say that native local data is not encrypted by the library (app sandbox only), that web is encrypted, and what `wipeOnSignOut` does to unsynced writes. The agent-rule wording is updated in T16.
  - Seam: `createSyncDb(config)` → `client.signOut()` with the memory persister
  - Interface: no new option; `wipeOnSignOut?: boolean` keeps its type
  - Cases:
    - unset, one local row, signed in as `u1`, `signOut()` → row still in the store after a restart as `u1`; `console.warn` called once with `wipeOnSignOut`
    - unset, `signOut()` twice on one client → one warning
    - `wipeOnSignOut: true` → row gone; no warning
    - `wipeOnSignOut: false` → row kept; no warning
    - unset, `signOut()` with no signed-in user → no warning
  - Blast radius: none (log only)
  - Docs: the three pages above
  - Test skills: terreno-frontend-tests
- [ ] **T13** — Guard the local MCP database_query tool
  - Depends on: none
  - Files: mcp-server/src/local/tools/databaseQuery.ts, mcp-server/src/local/tools/databaseQuery.test.ts, mcp-server/src/local/tools/databaseQueryGuards.ts, mcp-server/src/local/tools/databaseQueryGuards.test.ts, mcp-server/src/local/localTools.ts, docs/reference/mcp-server.md, docs/how-to/debug-with-mcp.md, changelog/unreleased/mcp-database-query-guards.md
  - Criteria: `database_query` refuses a Mongo URI with any non-loopback host, and every `mongodb+srv://` URI, unless `TERRENO_MCP_ALLOW_REMOTE_DB=1`. It refuses collections whose name, split into words on case changes and separators, has the word `session(s)`, `account(s)`, `token(s)`, `verification(s)` or `apikey(s)`, as the target collection or inside `$lookup.from`, `$graphLookup.from` or `$unionWith`, and replaces string values of credential-like keys with `<REDACTED>` at any depth (numbers, booleans and dates are never redacted), unless `TERRENO_MCP_ALLOW_SENSITIVE_DATA=1`. One operator denylist (`$where`, `$function`, `$accumulator`, `$out`, `$merge`) applies to filters and pipelines at any depth. Refusals are returned as text that names the env var; nothing connects to the database before the checks pass. The tool description states the guards.
  - Seam: exported `databaseQuery(args)` (returns a string) and the pure guards
  - Interface: `isLoopbackMongoUri(uri: string): boolean` (hosts `localhost`, `127.0.0.0/8`, `::1`, `[::1]`); `findSensitiveCollection(args): string | undefined`; `redactRows(rows: unknown[]): unknown[]`. A key matches when one of its words (split on case changes, `_`, `-`, `.`) is `password`, `passwd`, `hash`, `salt`, `secret`, `token`, `authorization`, `credential`, or when the key lowercased with separators removed ends in `apikey` or `privatekey`.
  - Cases:
    - `mongodb://127.0.0.1:27017/app` and `mongodb://localhost/app?replicaSet=rs0` → loopback; `mongodb://db.internal:27017/app`, `mongodb://127.0.0.1,10.0.0.5/app`, `mongodb+srv://cluster0.example.mongodb.net/app` → not loopback
    - `MONGO_URI=mongodb+srv://…`, no flag → text contains `TERRENO_MCP_ALLOW_REMOTE_DB`; no connection attempted
    - `find` on `users` returning `{email: "a@example.com", hash: "abc", profile: {apiKey: "k"}}` → `hash` and `profile.apiKey` are `<REDACTED>`; `email` intact
    - same with `TERRENO_MCP_ALLOW_SENSITIVE_DATA=1` → raw values
    - row `{tokensUsed: 42, hashtags: ["a"], refreshToken: "abc", salted: "x"}` → `tokensUsed` stays `42`, `hashtags` and `salted` unchanged, `refreshToken` is `<REDACTED>`
    - `find` on `hashtags` → allowed; on `chatSessions` → refused; on `authTokens` → refused; on `accounting` → allowed
    - `find` on `sessions` → refusal text naming `TERRENO_MCP_ALLOW_SENSITIVE_DATA`
    - `aggregate` on `todos` with `[{$lookup: {from: "accounts", …}}]` → refused; with `[{$unionWith: "authTokens"}]` → refused; with `[{$unionWith: {coll: "sessions"}}]` → refused
    - `aggregate` with `[{$group: {_id: null, x: {$accumulator: {…}}}}]` → refused; `find` with `{$expr: {$function: {…}}}` → refused
    - `countDocuments` on `todos` on loopback → count returned as today
  - Blast radius: `database_schema` uses the same URI and returns no rows → unchanged, stated in the docs
  - Docs: `docs/reference/mcp-server.md` (`database_query`, both env vars) and `docs/how-to/debug-with-mcp.md`
  - Test skills: terreno-backend-tests
- [ ] **T14** — Untrack example-backend/.env and create it from the example on first run
  - Depends on: none
  - Files: example-backend/.env (removed from the index), .gitignore, example-backend/src/scripts/ensureEnv.ts, example-backend/src/scripts/ensureEnv.test.ts, example-backend/package.json, docs/how-to/set-up-social-login.md, changelog/unreleased/example-backend-env-untracked.md
  - Criteria: `git ls-files example-backend/.env` prints nothing and `.gitignore` ignores that path. `bun run backend:dev` and `bun run backend:seed` create `example-backend/.env` from `.env.example` when it is missing and never overwrite an existing file. `example-backend/.env.example` holds no value that passes the T1 production check as a real secret (its values stay on the known-example list).
  - Seam: exported `ensureEnvFile({dir})`; `predev` and `preseed` scripts in `example-backend/package.json` call it
  - Interface: `ensureEnvFile(args: {dir: string}): {created: boolean}`
  - Cases:
    - temp dir with `.env.example` only → `created: true`; `.env` content equals the example
    - temp dir with both, `.env` containing `A=1` → `created: false`; `.env` still `A=1`
    - temp dir with neither → `created: false`; no file written; no throw
  - Blast radius: a fresh clone now runs on `.env.example` values (Better Auth provider, replica-set URI) instead of the old tracked placeholders. The Playwright suite starts the backend with its own `env` block (`example-frontend/playwright.config.ts:187-200`) and never reads `.env`, so it is unaffected → no case
  - Docs: `docs/how-to/set-up-social-login.md` line on `example-backend/.env` says the file is created from the example
  - Test skills: terreno-backend-tests
- [ ] **T15** — Generate new apps with enforce and run the example locally under enforce
  - Depends on: T11, T17
  - Files: create-terreno-app/src/generate.ts, create-terreno-app/src/__tests__ (the scaffold tests and snapshots that cover the server and syncdb templates), example-frontend/playwright.config.ts, example-backend/.env.example, example-backend/src/server.ts, docs/how-to/create-a-terreno-app.md, changelog/unreleased/scaffold-secure-defaults.md
  - Criteria: the generated backend passes `secureDefaults: "enforce"` to `TerrenoApp` and sets `authOptions.profileWritableFields` to the fields its profile screen edits. The generated `createSyncDb` call sets `wipeOnSignOut: true`. `example-backend/.env.example` and the backend `webServer.env` block in `example-frontend/playwright.config.ts` set `TERRENO_SECURE_DEFAULTS=enforce`, and `example-backend/src/server.ts` sets `profileWritableFields` to the fields the example profile screen sends. The deployed example keeps whatever its environment sets (default `warn`).
  - Seam: the scaffold generator's output (existing generator tests) and the example stack
  - Interface: generated `src/server.ts` contains `secureDefaults: "enforce"`; generated syncdb store contains `wipeOnSignOut: true`
  - Cases:
    - generate an app → server file contains `secureDefaults: "enforce"` and `profileWritableFields`; syncdb store file contains `wipeOnSignOut: true`
    - generated project typechecks (the existing scaffold typecheck test, if present, stays green)
    - `bun run frontend:e2e` passes with `TERRENO_SECURE_DEFAULTS: "enforce"` in the Playwright backend env, including the profile spec that edits the name; a request over 1 MB or a populate path without `fields` that surfaces here is fixed in the example (`routeJsonLimits`, `fields`), not by leaving `enforce`
  - Blast radius: generated apps reject JSON over 1 MB and wildcard CORS in production → `docs/how-to/create-a-terreno-app.md` says so
  - Docs: `docs/how-to/create-a-terreno-app.md`
  - Test skills: terreno-backend-tests
  - Coordination: the scaffold is also being reworked by the group that owns findings 1.2 and 1.5. This task changes three lines in the templates; whichever lands second rebases.
- [ ] **T17** — Flag populate paths that return whole documents
  - Depends on: T10
  - Files: api/src/populateDefaults.ts, api/src/populateDefaults.test.ts, api/src/terrenoApp.ts, docs/how-to/create-a-model.md, changelog/unreleased/populate-fields-check.md
  - Criteria: at `build()`, every `ModelRouterRegistration` passed to `TerrenoApp.register` is checked: a `populatePaths` entry with no `fields`, or with only `-` (blocklist) fields, calls `reportOrThrow` with code `populate-without-fields` and key `<Model>.<path>`. The message says a populated document skips the referenced model's permissions and names `fields`. Routers built inside framework plugins are not checked. This is the hours-sized part of finding 3.5; first-class field control is X1.
  - Seam: `new TerrenoApp(options).register(modelRouter(path, Model, options)).build()`; depends on T10 only because both edit `api/src/terrenoApp.ts`
  - Interface: `findUnsafePopulatePaths(args: {modelName: string; populatePaths?: PopulatePath[]}): string[]` (returns keys)
  - Cases:
    - `populatePaths: [{path: "ownerId"}]`, `warn` → builds; one warning with `populate-without-fields` and `Todo.ownerId`; `GET /todos` still returns the populated owner as today
    - same, `enforce` → `build()` throws; message contains `Todo.ownerId` and `fields`
    - `[{path: "ownerId", fields: ["name"]}]`, `enforce` → builds; no warning; list response `ownerId` has only `_id` and `name`
    - `[{path: "ownerId", fields: ["-hash"]}]`, `enforce` → throws
    - no `populatePaths`, `enforce` → builds
    - check runs in every `NODE_ENV` (it is a registration fact, not a production one)
  - Blast radius: none (`warn` changes no response)
  - Docs: `docs/how-to/create-a-model.md` populate paragraph; reference text in T16
  - Test skills: terreno-backend-tests
- [ ] **T16** — Write the reference docs, the explanation page, the upgrade note and the agent rules
  - Depends on: T3, T8, T12, T13, T14, T15
  - Files: docs/how-to/rate-limiting.md, docs/reference/api.md, docs/explanation/secure-defaults.md, docs/explanation/README.md, mcp-server/src/docs/upgrades/<next 58.x version>.md, .rulesync/rules/api/00-api.md, .rulesync/rules/api/02-logging-tracing.md, .rulesync/rules/00-root.md, .rulesync/rules/syncdb/00-syncdb.md, every tracked file `bun run rules` regenerates from them (`CLAUDE.md`, `AGENTS.md`, `.claude/rules/**`, `.cursor/rules/**`, `.devin/rules/**`, `.github/instructions/**`), docs/how-to/upgrade-terreno.md
  - Criteria: `docs/explanation/secure-defaults.md` holds the rollout table from this plan with every warning code, its fix, and what Terreno 59 changes. `docs/reference/api.md` documents `secureDefaults`, `bodyParser`, `securityHeaders`, `ownerScopedList`, `logRequestBodies`, `profileWritableFields`, `signupWritableFields` and the populate rule, and its request-log paragraph says bodies are off by default. The upgrade note follows `mcp-server/src/docs/upgrades/README.md`, has `Action required: Yes`, and gives these steps: grep for `list: [Permissions.IsOwner]` routers without a `queryFilter`; read the first boot log for `[secure-defaults]` lines; check `rateLimit.skip` functions that read `req.body`; check for pages framed cross-origin; on Cloud Run and Vercel, check code that reads `req.ip`, `req.protocol`, `req.secure` or `req.hostname`. `docs/how-to/rate-limiting.md` states that the limiter runs before body parsing. All agent-rule edits for this plan happen here, followed by one `bun run rules`: `.rulesync/rules/api/00-api.md` no longer shows `corsOrigin: true`; `02-logging-tracing.md` says bodies are not logged unless `logRequestBodies` is set; the root rule's "encrypted persistence" gains "(web; native relies on the app sandbox)"; the syncdb rule states the `wipeOnSignOut` warning.
  - Seam: none (prose)
  - Cases: none (untestable: prose). Verification: `bun run check:upgrade-docs`, `bun run check:changelog`, `bun run rules:check` and the repository docs checks in `bun run lint` pass; every option name in the docs exists in `api/src` (grep).
  - Blast radius: none
  - Docs: this task
  - Test skills: update-docs
  - Coordination: the group fixing non-existent API names in the rules (findings 2.1 to 2.3) also edits `.rulesync/rules/api/00-api.md`. If its change removed the `setupServer` example that contains `corsOrigin: true`, skip that edit.

Supporting skills for the build: `terreno:terreno-backend-api`, `terreno:terreno-backend-tests`, `terreno:terreno-frontend-tests`, `terreno:update-docs`, `model-router-actions` (T3 reads `modelRouter`), `terreno:upgrading-terreno` (T16 note format).

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q2 (fundamental) | Should JSON over 1 MB, `rawBody` outside webhooks, profile fields outside the allowlist, weak secrets, wildcard CORS and the memory store warn on 58.x and flip at 59, or flip now with opt-outs? | Warn on 58.x through one `secureDefaults` switch; the scaffold opts new apps into `enforce` | Each of these can take a running app down or silently drop writes on a routine upgrade. The cost: `secureDefaults` and `TERRENO_SECURE_DEFAULTS` become permanent public API, and existing apps, including the HIPAA one, still parse 50 MB bodies (finding 3.3, S1) until they set `bodyParser.jsonLimit` or `enforce`; the audit lists the 1 MB limit as a week-one change | Flip now: the default mode becomes `enforce`, T4, T6, T8, T9, T11 and T1 keep their code, and the upgrade note becomes a required checklist before upgrading | T1, T4, T6, T8, T9, T11, T15, T17 |
| Q3 (fundamental) | The assigned findings include field-level read and write control (3.5), native local-data encryption (3.8) and refresh-token rotation (3.10). Plan them now or as follow-up plans? | Follow-up plans (X1, X2, X3); this plan ships the populate guard, the sign-out warning and the native-storage documentation | X1 must sit on the permission model `api-foundations` is unifying; X2 needs a real-device migration and shares the native persister with finding 3.14; X3 changes legacy JWT, which `api-foundations` is making opt-in | If now: each becomes its own plan before this group counts as covered; nothing in this task list changes. Until X1 ships, a populated reference with a `fields` list is the only field-level protection | none |
| Q8 | Send `X-Frame-Options: SAMEORIGIN` and HSTS by default on 58.x? | Yes, with `securityHeaders` to change or disable | Additive headers; nothing in this repository frames a backend page cross-origin | If any app embeds the admin console or an OAuth page in another origin's frame: move `frameOptions` under `enforce` | T10 |
| Q4 | At Terreno 59, should sign-out wipe local data by default even when the outbox holds unsynced writes? | Yes, but decide in the 59 plan; 58.x only warns | Shared-device privacy outweighs keeping unsynced writes for a user who chose to sign out | If no: T12's warning text drops the "default becomes true" sentence | T12 |
| Q5 | Should the deployed example backend run under `enforce`? | Not in this plan; local runs and e2e do | `enforce` fails boot on a secret under 32 characters, and the deployed secrets cannot be read from here | If yes: add `secureDefaults: "enforce"` in `example-backend/src/server.ts` after confirming the deployed secrets | T15 |
| Q6 | Block `database_query` on collections whose name contains `account`? | Yes, with the env opt-out | Better Auth stores OAuth tokens in `account` | If an app has a business `accounts` collection it sets `TERRENO_MCP_ALLOW_SENSITIVE_DATA=1`, or the pattern narrows to exact Better Auth names | T13 |
| Q7 | Turn on `trust proxy: 1` automatically on Cloud Run (`K_SERVICE`) and Vercel (`VERCEL`) when `rateLimit.trustProxy` is unset? This is the one silent default that changes request properties on the platform the production app runs on. | Yes, as a silent default | Without it every signed-out client shares one login bucket, so one script locks everyone out. A Cloud Run container is reachable only through the Google front end, which appends the client address, so buckets are never worse than today; `docs/how-to/rate-limiting.md` already tells Cloud Run users to set it. Side effect: `req.protocol` and `req.secure` follow `X-Forwarded-Proto`, and `req.hostname` follows `X-Forwarded-Host`, which a client can set if the platform does not overwrite it, so code that builds links from `req.hostname` should use a configured base URL | Warn-first instead: the auto-set moves under `enforce`, 58.x keeps only the one-time error log, and existing apps keep the shared bucket until they set `trustProxy`. Cloud Run only: drop the `VERCEL` branch | T7 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Field-level read and write control (`readFields` / `writeFields` or schema `private` / `readOnly`) enforced in the shared executors and serializer for REST, sync and MCP, building on the T17 populate guard. Suggested slug `field-access-control` | Finding 3.5. Too large for this plan, and its contract must sit on the unified permission system | L | `api-foundations` permission unification |
| X2 | Encrypt native local data with a key in `expo-secure-store`, with a migration for existing plaintext stores. Suggested slug `native-local-encryption` | Finding 3.8. Needs real-device proof and rewrites the native persister that the per-collection persistence work (3.14) also rewrites | L | `sync-and-query-performance` persister decision |
| X3 | Refresh-token rotation with a family id and reuse detection, and a minimum password length on legacy signup (reproduce first: suspected, not confirmed). Suggested slug `legacy-jwt-hardening` | Finding 3.10 / audit item 14. Legacy JWT is becoming opt-in, and rotation breaks clients that retry a refresh | M | `api-foundations` legacy-auth decision |
| X4 | One origin list for HTTP CORS, socket.io and Better Auth `trustedOrigins` | Finding 3.7. Socket auth uses a handshake token, so the exposure is small | S | T9 |
| X5 | Default the console log level to `info` in production | Finding 3.1 recommendation. With bodies off, the remaining risk is volume, not data | S | T2 |
| X6 | Scope, not just warn, lists on routers where only `read`, `update` or `delete` use an owner permission | The audit's wider recommendation for 3.2; T3 warns only, because public lists are legitimate | S | T3 |
| X7 | Auto-select the Mongo idempotency store for `WebhooksApp` in production | Finding 3.6; T8 only warns because the store is built in the constructor | S | T8 |
| X8 | Remove the public default upload token in `example-backend/src/scripts/announcement-pack.ts` | Audit item 14 | S | none |
| X10 | `readPreference: "secondaryPreferred"` for local MCP queries | Audit item 13; no effect on the single-node replica set local dev uses | S | T13 |
| X9 | Flip `secureDefaults` to `enforce` and `wipeOnSignOut` to `true` in Terreno 59 | The second half of every "warn now" row | M | this plan shipped for one release |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | How are questions settled when the requester is not in the chat? | "if there is a recommended answer, use that answer across the board, only bring me the most critical questions" | Every question is built on its recommendation; Q1, Q2 and Q3 are raised as fundamental |
| D2 | What ranks the work? | "making it as easy as possible to get an app off the ground" with "best in class DX" | New apps get `enforce` from the scaffold (T15); warnings name the exact option to set |
| D3 | Order of work | Brief: hours-sized, non-breaking changes first | T3, T7, T12, T13 and T14 have no dependencies and ship first; T1 then heads the serial `build()` chain (A7), with T11 forking off after T2 |
| D4 | Q1: should upgrading scope `list: [Permissions.IsOwner]` lists with no `queryFilter` to the owner immediately, or only warn until the flip? | Owner, 2026-11-13: the recommendation. Scope immediately, with `ownerScopedList: false` as the opt-out and a registration log line per affected router. | Nothing; T3 and T16 were built on this. |

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds (fresh subagent), 19 findings (1 blocking): 17 fixed, 2 moved to questions or expansions, 0 rebutted
