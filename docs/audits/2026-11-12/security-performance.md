# Terreno audit: security + performance (framework defaults)

Scope: read-only review of `/workspace` at `6cf1f06c` (58.0.4). Every finding was read in code unless marked SUSPECTED. No S0 found. Severity S0 (critical) to S3 (low). Paths are relative to `/workspace`.

## Findings, ranked by impact

### 1. Request bodies are logged by default, at the default log level, to console and file
- **Domain:** Security (data exposure) | **Severity:** S1 | **Effort:** hours
- **Evidence:** `api/src/expressServer.ts:216-222` (logs `Body: ${JSON.stringify(redacted body)}` at `debug` for every request); `api/src/terrenoApp.ts:483` (`logRequests` on unless explicitly `false`); `api/src/logger.ts:621` (console level defaults to `debug`); `api/src/logger.ts:625-650` (file logging on by default); redaction is a key-name denylist only, `api/src/expressServer.ts:23-41`.
- **Scenario:** An adopter scaffolds an app and deploys. Every create/update body (names, addresses, health notes, messages) lands in stdout, Cloud Logging, and Sentry when `USE_SENTRY_LOGGING=true`. Only keys that look like credentials (plus `note`, `reason`, `code`) are masked. A HIPAA or GDPR adopter has a log-retention incident on day one.
- **Recommendation:** Default to logging method, path, status, duration, user id and body *size* only. Make body logging opt-in (`loggingOptions.logRequestBodies`), and default the level to `info` when `NODE_ENV=production`. Keep the redactor for the opt-in path.

### 2. `list: [Permissions.IsOwner]` returns every user's documents
- **Domain:** Security (authorization footgun) | **Severity:** S1 | **Effort:** hours
- **Evidence:** `api/src/permissions.ts:94-98` (`IsOwner` returns `true` when there is no object, before it checks the user); `api/src/permissions.ts:183-195` (list/create never get an object); `api/src/api.ts:966-1002` (list runs `model.find(query)` with no per-document check). Owner scoping on list exists only if the app also sets `queryFilter: OwnerQueryFilter`. No warning at registration (`api/src/api.ts:764-778` has the only registration warning, for sync).
- **Scenario:** A developer writes `permissions: {list: [IsOwner], read: [IsOwner], ...}`, which reads naturally, and forgets `queryFilter`. Any signed-in user can page through every row. With `allowAnonymous: true` it is public. The sync path does not have this gap (it derives the owner filter), so REST and sync disagree silently.
- **Recommendation:** When any of `list`/`read`/`update`/`delete` contains an owner-identity permission and no `queryFilter` or `access` is set, apply `OwnerQueryFilter` automatically (the executors already detect owner routers: `api/src/sync/executors.ts:231-252`). At minimum throw at registration, as actions already do for missing permissions (`api/src/actions.ts:399-407`).

### 3. 50 MB JSON bodies are parsed and copied before auth and before the rate limiter
- **Domain:** Security (DoS) + Performance | **Severity:** S1 | **Effort:** hours
- **Evidence:** `api/src/webhooks/rawBody.ts:16-19` (`limit: "50mb"`, `verify: captureRawBody`); `api/src/webhooks/rawBody.ts:9-14` (`Buffer.from(buf)` copy on every request, not only webhook routes); `api/src/terrenoApp.ts:433` (parser mounted) vs `api/src/terrenoApp.ts:452-463` (rate limiter mounted later).
- **Scenario:** An unauthenticated client posts 50 MB JSON documents to any path. Each one is buffered, copied a second time into `req.rawBody`, and `JSON.parse`d on the event loop before any limiter or auth runs. A handful of concurrent requests exhausts a 512 MB Cloud Run instance. In normal traffic, every request pays a body copy that only webhook routes need.
- **Recommendation:** Default the JSON limit to 1 MB with a `jsonLimit` option and per-route overrides for uploads. Capture `rawBody` only for paths registered through `WebhooksApp`. Mount the rate limiter (IP-keyed pass) ahead of body parsing.

### 4. Self-service user writes use a denylist, so app-defined user fields are writable by the user
- **Domain:** Security (mass assignment) | **Severity:** S2 | **Effort:** days
- **Evidence:** `api/src/auth.ts:983-1032` (`PATCH /auth/me` does `Object.assign(doc, update)` after `stripPrivilegedUserFields`; the `TODO support limited updates for profile` is still there); `api/src/auth.ts:121-160` (fixed denylist: `admin`, `roles`, `organizationIds`, etc.); `api/src/auth.ts:301-316` (signup passes the rest of the body to `register`).
- **Scenario:** An app adds `plan`, `credits`, `stripeCustomerId`, `tenantId`, `role` (singular) or `carePod` to its User schema. Any user can set them with `PATCH /auth/me` or at signup, because only framework-known field names are stripped.
- **Recommendation:** Flip to an allowlist: `authOptions.profileWritableFields` (default `["name", "email"]`, plus fields a schema marks `selfWritable: true`). Apply the same list to signup. Log dropped keys as today.

### 5. No field-level read/write allowlist in the supported API; default responses and populates return whole documents
- **Domain:** Security (field exposure) | **Severity:** S2 | **Effort:** days
- **Evidence:** `api/src/api.ts:820` (default `responseHandler` serializes the full document); `api/src/transformers.ts:9-16` and `.claude/rules/api/00-api.md` (the only declarative field filter, `AdminOwnerTransformer`, lives in the deprecated transformer module); `api/src/populate.ts:30-38` (`fields` on a populate path is optional, and a populated document bypasses the referenced model's permissions and `responseHandler`); `api/src/sync/executors.ts:299-320` (only `deleted` and sync stamps are stripped from write bodies).
- **Scenario:** A `Post` router with `populatePaths: [{path: "ownerId"}]` returns each author's full User record (email, `admin`, any internal fields) to every reader. A model with an internal `moderationNotes` or `costCents` field exposes and accepts it unless the developer hand-writes a `responseHandler` and `preUpdate`.
- **Recommendation:** Add first-class `readFields` / `writeFields` (or schema-level `private: true` / `readOnly: true`) enforced in the shared executors and serializer so REST, sync and MCP all honor them. Require `fields` on `populatePaths` (or default to `_id` plus a declared public projection). `api/src/rbac/fieldViews.ts` exists for RBAC users; it was not audited and is opt-in.

### 6. One database-wide change stream with `updateLookup`, opened by every API instance
- **Domain:** Performance (scalability) | **Severity:** S2 | **Effort:** days
- **Evidence:** `api/src/realtime/changeStreamWatcher.ts:567-581` (pipeline matches every collection except six ignored names, `:121-128`); `:595` (`fullDocument: "updateLookup"`); `:646-651` (non-synced collections are discarded in JS after delivery); `:605` (`nativeDb.watch`, one per process).
- **Scenario:** An app with three synced collections also writes job rows, audit events, AI request logs, rate-limit hits (`store: "mongo"`) and Better Auth sessions. Every one of those writes triggers a full-document lookup on the primary and is shipped to every API instance, which then drops it. Cost grows as writes x instances, independent of how many clients are connected.
- **Recommendation:** Build the `$match` from the sync registry (`"ns.coll": {$in: registeredCollections}`) and rebuild it when registrations change. Document a dedicated "sync worker" role (the example `.env` already hints at `BACKEND_SERVICE=websockets`).

### 7. Delta fan-out is sequential per socket, with a permission check and serialization for each
- **Domain:** Performance | **Severity:** S2 | **Effort:** days
- **Evidence:** `api/src/realtime/changeStreamWatcher.ts:277-321` (`for (const socket of sockets)` with `await awaitSocketFullUser`, `await canReadDocument`, `await buildPayload(user)` per socket); `:430-447` (one `computeStableFrontier` query plus one serialization per socket); `api/src/realtime/sessionRevalidation.ts:20` and `:173` (a per-socket revalidation sweep every 60 s).
- **Scenario:** A `broadcast` or large-tenant stream with 5,000 connected sockets: one document change runs 5,000 awaited permission checks and 5,000 serializations in series on one event loop. Bursty writes queue behind each other and latency climbs to seconds.
- **Recommendation:** Group sockets by user id (and by serialized-payload identity when no per-user `responseHandler` is configured), check and serialize once per group, then `io.to(room)` emit. Bound concurrency instead of strict sequence. Sweep revalidation by distinct user, not socket.

### 8. Every list request runs `countDocuments`, and pagination is `skip`-based
- **Domain:** Performance | **Severity:** S2 | **Effort:** hours to days
- **Evidence:** `api/src/api.ts:966-967` (`find(...).limit(limit + 1)` then an unconditional `await model.countDocuments(query)`); `api/src/api.ts:977` (`skip((page - 1) * limit)`); `api/src/api.ts:981-985` (client-chosen sort on any `queryFields`/`sortFields` entry, no index check).
- **Scenario:** A table reaches a few million rows. Each list call scans every matching index entry to produce `total`, even though `limit + 1` already yields `more`. Deep pages get linearly slower. A sort on an unindexed allowed field is an in-memory sort on the server.
- **Recommendation:** Make `total` opt-in (`?includeTotal=true` or `options.includeTotal`), or cap it (`countDocuments(query, {limit: 10_001})`). Run the count in parallel with the find. Add cursor pagination (`?after=<id>`). At registration, warn in non-production when a `queryFields`/`sort` field has no index.
- **Keep:** defaults of 100 and max 500 (`api/src/api.ts:955-957`) are good.

### 9. syncdb persistence rewrites the whole store on every save
- **Domain:** Performance (client) | **Severity:** S2 | **Effort:** weeks
- **Evidence:** `syncdb/src/persisters/encryptedIndexedDbPersister.ts:97-98` and `:116-117`, `:141` (`JSON.stringify(store.getMergeableContent())`, encrypt, write to the single record `RECORD_KEY = "content"`, `:9`); `syncdb/src/persisters/defaultPersisterFactory.native.ts:39-58` (native uses TinyBase JSON mode, one serialized blob in SQLite).
- **Scenario:** A user accumulates 20 MB of synced data. Each debounced save after any mutation or delta serializes, encrypts and writes all 20 MB on the JS thread. Typing in a form stutters on mid-range Android; web tabs jank and IndexedDB quota pressure rises. Cost is proportional to total data, not to the change.
- **Recommendation:** Persist per collection (or per row chunk) keyed by content hash so a save writes only dirty partitions. Short term: document a size ceiling, expose `saveDebounceMs`, and steer large collections to `queryCollections` / `useWindowQuery`.

### 10. Native local data is stored unencrypted, and sign-out does not wipe by default
- **Domain:** Security (data at rest) | **Severity:** S2 | **Effort:** days
- **Evidence:** `syncdb/src/persisters/defaultPersisterFactory.native.ts:36-37` ("no additional encryption layer is applied here"); `syncdb/src/client.ts:176` and `:2433` (wipe on sign-out only when `wipeOnSignOut` is set). Web is encrypted by default (`syncdb/src/persisters/defaultPersisterFactory.web.ts:20-36`). The root `CLAUDE.md` describes `createSyncDb` as having "encrypted persistence" without the native caveat.
- **Scenario:** A health or finance app ships on the defaults. Synced records sit in plaintext SQLite, are included in device backups unless the app opts out, and remain on a shared device after the user signs out.
- **Recommendation:** Default `wipeOnSignOut` to `true`. On native, encrypt with a key held in `expo-secure-store` (SQLCipher via expo-sqlite, or the existing AES-GCM codec over the JSON blob). State the native behavior in the docs until then.

### 11. Rate-limit defaults break behind a proxy and across instances
- **Domain:** Security (availability, brute force) | **Severity:** S2 | **Effort:** hours
- **Evidence:** `api/src/rateLimit/applyTrustProxy.ts:14-16` (`trust proxy` false by default); `api/src/rateLimit/createStore.ts:11-12` (memory store by default); webhook idempotency also defaults to memory, `api/src/webhooks/webhooksApp.ts:44`. No boot-time or runtime warning exists (grep for `x-forwarded-for` finds only the comment).
- **Scenario:** On Cloud Run, Fly or Vercel every unauthenticated request appears to come from the proxy address. All users share one 20-per-15-minute auth bucket, so one script locks everyone out of login. With N instances the per-user limit is N times the configured value, and webhook replays pass when they hit a different instance.
- **Recommendation:** When `trust proxy` is unset and a request carries `X-Forwarded-For`, log a one-time error naming `trustProxy`. Auto-set `trustProxy: 1` when `K_SERVICE` (Cloud Run) or `VERCEL` is present. Warn at boot when `NODE_ENV=production` and a store is `memory`; auto-select `mongo` since Mongo is always present.

### 12. CORS defaults: `*` with credentials on HTTP, `*` on sockets, no security headers
- **Domain:** Security (hardening) | **Severity:** S2 | **Effort:** hours
- **Evidence:** `api/src/terrenoApp.ts:416` (`cors({credentials: true, origin: options.corsOrigin ?? "*"})`); `api/src/realtime/realtimeApp.ts:192-194` (socket `origin: "*"`); no `helmet`, HSTS, `nosniff` or frame headers anywhere in `api/src`; `.claude/rules/api/00-api.md` shows `corsOrigin: true` in the `setupServer` example; `api/src/auth.ts:559-560` accepts the access JWT from a `jwt` cookie.
- **Scenario:** `*` plus credentials fails in browsers for cookie auth, so the adopter copies `corsOrigin: true` from the docs. That reflects any origin with credentials. Combined with `crossDomainCookies` (`SameSite=None`, `api/src/betterAuthSetup.ts:245-251`) or the `jwt` cookie, any website can call the API as the visitor.
- **Recommendation:** Require an explicit origin list when `NODE_ENV=production` (fail at boot on `*` or `true` with credentials). Reuse it for socket.io and Better Auth `trustedOrigins`. Add a default header set (HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors`), and call `app.disable("x-powered-by")`.

### 13. Local MCP `database_query` is ungated, connects to whatever `MONGO_URI` is set, and returns raw rows
- **Domain:** Security (agent tooling) | **Severity:** S2 | **Effort:** hours
- **Evidence:** `mcp-server/src/local/localTools.ts:338` (no `TERRENO_MCP_EVAL` check, unlike the tools at `:120-255`); `mcp-server/src/local/tools/databaseQuery.ts:122-131` (uses `process.env.MONGO_URI` or `backend/.env`, no loopback check); `:136-162` (returns documents unredacted); `:34` (aggregate denylist is `$out`, `$merge`, `$function`; `$accumulator` and `$where` are blocked for `find` at `:37` but not for pipelines; `$lookup`/`$unionWith` let a query on one collection read any other).
- **Scenario:** A developer exports a staging or production `MONGO_URI` to debug an issue, then asks an agent for help. The agent, or a prompt injection in a log line it just read through `read_logs`, can read users, sessions, tokens and PHI into the model context, 200 rows at a time.
- **Recommendation:** Refuse non-loopback hosts unless `TERRENO_MCP_ALLOW_REMOTE_DB=1`. Redact credential-like fields and the session/account/token collections by default. Apply one recursive operator denylist to both filters and pipelines (add `$accumulator`, `$where`), and set `readPreference: "secondaryPreferred"`.

### 14. Legacy JWT hardening gaps: secret strength, refresh rotation, committed example `.env`
- **Domain:** Security (auth) | **Severity:** S3 | **Effort:** hours to days
- **Evidence:** `api/src/expressServer.ts:115-123` (secrets only checked for presence; Better Auth secret likewise, `api/src/betterAuthSetup.ts:197-202`); `api/src/auth.ts:765-784` (refresh tokens are stateless, valid 30 days, re-issued without invalidating the old one; only `tokenEpoch` revokes); `example-backend/.env` is tracked in git with placeholder JWT secrets (the example guards its Better Auth dev secret in production, `example-backend/src/utils/betterAuthConfig.ts:321`, but not `TOKEN_SECRET`); `example-backend/src/scripts/announcement-pack.ts:10,88` falls back to a public default upload token. No minimum password length was found on the legacy signup path (`api/src/auth.ts:293-316`) — SUSPECTED, not traced through passport-local-mongoose options.
- **Scenario:** An app scaffolded from the example ships with the committed `TOKEN_SECRET`; anyone can mint admin JWTs. A stolen refresh token works for 30 days with no reuse detection.
- **Recommendation:** In production, reject secrets under 32 bytes and a list of known example values for all four secrets. Rotate refresh tokens with a family id and reuse detection (the MCP OAuth code already has `mcpOAuthRevokedFamily`). Untrack `example-backend/.env`. Enforce a minimum password length in `signupUser`.

### 15. `@terreno/ui` is one barrel with no `sideEffects` flag and hard dependencies on the host runtime
- **Domain:** Performance (bundle) | **Severity:** S3 | **Effort:** days
- **Evidence:** `ui/package.json` has no `sideEffects` field; `ui/src/index.tsx` (1,530 lines, 141 `export *`); `ui/package.json:53-70` lists `react-dom`, `react-native`, `react-native-web` under `dependencies` as well as peers (`:119-120`); `@shopify/react-native-skia`, `react-native-webview`, `react-native-google-places-autocomplete`, `expo-notifications`, `expo-updates`, `react-native-calendars`, `react-native-markdown-display` are all hard dependencies.
- **Scenario:** An app that imports `Box` and `Button` from the package root evaluates every component module on native (Metro does not tree-shake by default) and ships Skia, WebView, calendars and markdown on web unless the bundler can prove purity. Listing `react-native` as a direct dependency risks a second copy when the app's version differs.
- **Recommendation:** Add `"sideEffects": false` after confirming no module-level registration. Move `react-native`, `react-dom`, `react-native-web` to peers only. Make Skia, WebView, Places, QR and calendars optional peers behind the existing `./*` subpath exports (`ui/package.json:100-103`), and document subpath imports.
- **Keep:** per-method lodash imports, lazy `import("emoji-datasource")` (`ui/src/EmojiSelector.tsx`), and a single icon set (`@expo/vector-icons/FontAwesome6`).

## Strengths to preserve

1. **Deny by default.** An omitted or empty permission key denies (`api/src/permissions.ts:131-144`, `:176-177`); actions without `permissions` fail at registration (`api/src/actions.ts:399-407`); `queryFields` and `sort` are allowlists (`api/src/api.ts:497-530`).
2. **One write path for REST, sync and MCP.** Shared executors enforce owner write scope (a create or update cannot name another owner, `api/src/sync/executors.ts:255-283`) and strip server-owned fields (`:299-320`).
3. **Sync authorization is thorough.** Stream membership is derived from the server-side user, never the client (`api/src/sync/streams.ts:170-194`); snapshots apply `list` permission, `queryFilter` and per-document `read` (`api/src/sync/routes.ts:423-427`, `:532-575`); deltas are permission-checked per socket; sessions are re-validated; the `{scope, _syncSeq}` index is created at registration (`api/src/sync/registrationSideEffects.ts:106-109`).
4. **Security-aware auth details.** Rate limiting on by default with a separate auth bucket; email change requires the current password and invalidates reset tokens (`api/src/auth.ts:1008-1040`); privileged-field stripping covers dotted paths; webhook HMAC with timing-safe compare and timestamp tolerance (`api/src/webhooks/verifiers/hmac.ts`); dev-only routes are off in production (`api/src/browserLogsRoute.ts:14-25`).
5. **Client hot paths already tuned.** `useSyncExternalStore` with cached selectors (`syncdb/src/react/hooks.ts:31-95`), web persistence encrypted by default with non-extractable keys, bounded snapshot pages (`api/src/sync/routes.ts:82-88`).

## Not covered

- Dependency CVE scan (`bun audit`) and license review: not run.
- `admin-backend` (2,300+ lines), `admin-spa` gate, script runner, document storage and `aggregateAdmin`/text search: only the permission wiring was skimmed (routes use `authenticateMiddleware` plus `IsAdmin`/RBAC).
- RBAC (`api/src/rbac/*`), organizations, account security, MCP OAuth server and service tokens, Better Auth OAuth handoff/proxy: not reviewed in depth.
- `@terreno/ai` (prompt injection, attachment URL fetching/SSRF), `comms`, `jobs`, `cli`: not reviewed.
- Query-operator values on allowed `queryFields` (for example `?name[$regex]=`) are passed to Mongoose (`api/src/api.ts:914`); impact looked limited to allowed fields but was not exercised.
- CI workflows, Terraform/infra, and runtime measurements (no load tests, bundle builds or profiling were run; performance findings are from code reading).
