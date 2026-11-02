# Server-render the admin SPA from Express

`@terreno/admin-spa` is an Expo Router web app. Its login screen and admin screens are built as a static export, and `AdminSpaServeApp` serves that export from the Terreno backend at `/console`. Every page, including deep links, returns the same `index.html`. The browser then fetches the app config, the Better Auth session, the admin config and the screen's data, one after another, before anything useful appears. Anonymous users and non-admins are redirected in the browser only after the bundle boots. This plan renders each request on the server instead. Express checks the session and redirects before rendering, and the first HTML already contains the brand, the session and the screen's data. Admins see the real page on the first paint. Anonymous users get a server `302` to `/login`. The browser hydrates from the embedded state instead of fetching it again.

## The idea

The base is `release-58.0.0` (Expo SDK 58, expo-router 58.0.23, expo-server 58.0.5), where server rendering and loaders are stable. Switch the admin-spa build to `web.output: "server"`. No `unstable_` flags are needed (D11). `AdminSpaServeApp` serves `dist/client` statically and mounts `expo-server/adapter/express`'s `createRequestHandler({build: dist/server})` at `basePath`. Expo 58's client still fetches loader data from the site root (`/_expo/loaders/<route>`), so the plugin also routes that root path to the same handler (D11).

An Express gate runs before the handler. It reads `req.user`, which the Better Auth session middleware has already set (`api/src/terrenoApp.ts:433`, before plugins at `:527`). For signed-in users it fetches `/admin/config` once over loopback. It then sends the `302`s, builds the **shell payload** (`{appConfig, basePath, session, adminConfig, adminConfigStatus}`), and runs the Expo handler inside a request scope (`AsyncLocalStorage` on a process global). A layout can't read a route's loader data or the request on SDK 58 (T1 tracer). So the root layout reads the shell from that scope on the server, and `+html.tsx` embeds it for the client.

On release-58 every admin screen loads data through `useAdminRpcQuery`, except the session (`useSession`) and the profile (`useApiQuery` `/auth/me`). There is no RTK or Redux. So one seam carries all screen data: `AdminRpcSeed`, keyed by the exact URL the hook requests. The shell seeds `${apiBase}/config`, which covers every reader that fetches it today. Each route's `loader` fetches its screens' URLs over loopback with the forwarded cookie and returns `{rpc: {[url]: body}}`. The route wraps its screen in `<AdminRpcSeed data={useLoaderData().rpc}>`. The first HTML holds data, and hydration fetches nothing.

Rejected: keep `output: "static"` and gate in Express. The first HTML would contain no data, which contradicts D3. Rejected: Expo `+middleware` for the gate. D6 keeps it in Express, and the gate is also what fills the request scope. X5 stays an expansion.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T0 | E2E guide | none | docs/testing | Already satisfied by `docs/testing/e2e.md` and `docs/testing/e2e/admin-spa.md` (ledger) |
| T1 | Tracer: SSR `/login` through Express under `/console` + root loader alias | T0 | admin-spa build + serve + login/gates, example-backend Dockerfile | Playwright + compiled-binary curl: brand in SSR HTML, client loader fetch works, no hydration warning |
| T2 | Request scope + `loadSsrPayload` loader helper + PHI headers | T1, T5 | admin-spa/src, admin-spa/server | HTTP tests: forwarded cookie, internal origin, allowlist, `no-store, private`, escaped JSON |
| T3 | Express gate: 302s + shell payload into the request scope | T2 | admin-spa/src | Supertest: each redirect, `returnTo` validation, one `/admin/config` fetch per request |
| T4 | Hydrate the shell: app config, session, admin config, profile | T3, T5 | admin-spa layout/components, syncdb session + api client | No spinner in an admin's first HTML; no hydration warning; no shell refetch |
| T5 | `AdminRpcSeed`: initial data for `useAdminRpcQuery` | T1 | admin-frontend | Hook returns seeded data on first render, no fetch |
| T6 | SSR model list | T4 | admin-frontend URL builder, admin-spa `[model]/index` | Users rows in first HTML; no list refetch on hydrate |
| T7 | SSR model detail form | T6 | admin-frontend form, admin-spa `[model]/[id]` | Record fields in first HTML |
| T8 | Windowed syncdb tables render seeded rows | T6 | admin-frontend table | Todo rows in first HTML; rows stay after syncdb starts |
| T9 | SSR home, configuration, roles, scripts, version-config | T4, T6 | admin-spa routes | Each screen's data in first HTML |
| T10 | SSR jobs + comms | T4 | admin-spa routes | Each screen's data in first HTML |
| T11 | SSR orgs directory, settings, members | T4 | admin-spa routes | Each screen's data in first HTML |
| T12 | Docs, changelog, smoke | T3, T4, T13 | docs, admin-spa README, changelog | Docs match behavior; `bun run smoke` green |
| T13 | CI job: SSR inside the built backend image | T1, T2 | CI config | CI curls `/console/login` from the Docker image and gets SSR HTML |

Tracer: Express → `expo-server` Express adapter → `render.js` under `/console`, in the bun-compiled binary. The T1 spike already proved the risky parts on 58; see the Sign-off tracer result.
Shell-and-auth SSR (T0–T5, T12, T13) is usable on its own. T6–T11 deliver D3's data SSR.
E2E: 10 specs (browser), plus HTTP-layer supertest suites in `admin-spa/src` and one CI image smoke (T13).
Regression: None — no hard-to-automate change; the compiled-binary check is automated in T13.
User guide: None — operator-facing; an admin does nothing differently.
Design: None — no new screens; existing screens render on the server.
Out of scope: example-frontend auth SSR, standalone auth app, in-process admin query API (see Expansions).
Open risks: hydration mismatches on RN-web components; `AsyncLocalStorage` context must survive the adapter's own scope into `render.js` (T2 proves it); the root `/_expo/loaders/*` claim collides with any second Expo server app on the same origin.
Elephant: admin data, including PHI, now lands in server-rendered HTML and in new `_expo/loaders/*` JSON responses, at both `/console/_expo/loaders/*` and root `/_expo/loaders/*`. A CDN, proxy or request log could cache or record it unless every one of those responses is `no-store, private` and loader URLs carry no record content.

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `admin-spa/e2e/ssr.spec.ts` | browser | With JavaScript disabled, `/console/login` shows the brand name and the login form. With it enabled, an anonymous visit to `/console/forbidden` client-redirects to `/console/login`. The page requests `/_expo/loaders/login` and gets 200, and the console shows no React hydration warning. | T1 |
| E2 | `admin-spa/e2e/login.spec.ts` (update) | browser | An anonymous visit to `/console/Todo` gets a server 302 to `/console/login?returnTo=%2FTodo`. After sign-in, the user lands on `/console/Todo`. | T3 |
| E3 | `admin-spa/e2e/shell.ssr.spec.ts` | browser | With JavaScript disabled, an admin's `/console` shows the admin shell with the brand and model links, with no spinner. The `serveTestApp` config includes a windowed sync model. With JavaScript enabled, no `GET /admin/config` happens after load, and after load `window.__EXPO_ROUTER_LOADER_DATA__` is undefined and `#admin-spa-ssr` is gone. | T4 |
| E4 | `admin-spa/e2e/integration/adminSpa.ssr.list.integration.spec.ts` | browser | Against a live example-backend: with JavaScript disabled, `/console/User` shows the seeded user emails. With it enabled, the page hydrates without a second `GET /admin/users`. | T6 |
| E5 | `admin-spa/e2e/integration/adminSpa.ssr.detail.integration.spec.ts` | browser | With JavaScript disabled, `/console/User/<id>` shows that user's email in the form | T7 |
| E8 | `admin-spa/e2e/integration/adminSpa.ssr.windowed.integration.spec.ts` | browser | With JavaScript disabled, `/console/Todo` (a windowed syncdb model) shows the seeded todo titles. With it enabled, syncdb starts and the rows stay. | T8 |
| E6 | `admin-spa/e2e/integration/adminSpa.ssr.rpc.integration.spec.ts` | browser | With JavaScript disabled, `/console/configuration` shows its data, not a spinner, and `/console` (home) shows the example config's widget data | T9 |
| E7 | `admin-spa/e2e/integration/adminSpa.ssr.jobs.integration.spec.ts` | browser | With JavaScript disabled, `/console/jobs` shows the jobs dashboard data | T10 |
| E9 | `admin-spa/e2e/integration/adminSpa.ssr.comms.integration.spec.ts` | browser | With JavaScript disabled, `/console/comms` shows the seeded message rows | T10 |
| E10 | `admin-spa/e2e/integration/adminSpa.ssr.orgs.integration.spec.ts` | browser | With organizations enabled and JavaScript disabled, an operator's `/console/orgs` shows the org names, and `/console/orgs/<id>/members` shows member emails | T11 |

HTTP-layer proofs (supertest, `admin-spa/src/*.test.ts`) are in each task's Cases. They are unit-suite tests, not e2e rows.
E2 uses `returnTo` (an in-app path without `basePath`). release-58 has no return-path support, so T3 adds it: `sanitizeReturnTo` in the gate and the client, and the login screen honors it.

## Regression cases

None — no hard-to-automate change. Everything here can be asserted from the HTML and the network in a browser spec.

## User guide

None — operator-facing infrastructure. An admin signs in and uses the same screens. Developers and operators get the reference, README and a new upgrade how-to (`docs/how-to/upgrade-admin-spa-ssr.md`) in T12.

## Design

None — no new or changed screens.

## Tasks

- [x] **T0** — E2E guide
  - Already satisfied: `docs/testing/e2e.md` (#1628) names the `browser` and `http` layers, the `getByTestId` rule and the no-`waitForTimeout` rule. `docs/testing/e2e/admin-spa.md` names `test:e2e` and `test:integration`. No change needed.

- [x] **T1** — Tracer: server-render /console/login through Express with the expo-server adapter
  - Depends on: T0
  - Files: admin-spa/app.json, admin-spa/package.json, admin-spa/app/+html.tsx, admin-spa/app/login.tsx, admin-spa/components/AppConfigGate.tsx, admin-spa/components/AdminGate.tsx, admin-spa/components/adminGateUtils.ts, admin-spa/components/AdminGate.test.ts, admin-spa/src/serve.ts, admin-spa/src/serve.test.ts, admin-spa/src/serverContext.ts, admin-spa/e2e/serveTestApp.ts, admin-spa/e2e/ssr.spec.ts, example-backend/Dockerfile, example-backend/src/adminSpaServe.test.ts, root package.json (catalog: `expo-server`), docs/explanation/admin-spa-ssr.md
  - Criteria:
    - The build:
      - `app.json` sets `web.output: "server"`, with no `unstable_` flags (D11).
      - `bun run build:web` writes `dist/client` and `dist/server` (`_expo/server/render.js`, `_expo/routes.json`, `_expo/loaders/`).
    - `AdminSpaServeApp`:
      - It serves `dist/client` with the existing immutable cache rules for `_expo` and `assets`, and keeps `app-config.json`.
      - It mounts `createRequestHandler({build: <distDir>/server})` at `basePath`. `distDir` now points at the export root (`dist`).
      - It also routes root `GET /_expo/loaders/*` to the same handler (D11).
    - `src/serverContext.ts` publishes `{appConfig, basePath}` on a process global (`Symbol.for("terreno.adminSpa.server")`), which `render.js` reads. T2 extends it into a per-request scope.
    - `+html.tsx`, rendered on the server, embeds `window.__ADMIN_SPA_BASE__` and `window.__ADMIN_SPA_CONFIG__` from that global (D10).
    - `AppConfigGate` uses the injected config (or, on the server, the global) on its first render with no fetch. Without it, as in the dev proxy, it fetches `app-config.json` as today.
    - `AdminGate` renders `/login` while the session is still loading, instead of a spinner (D10).
    - `/login` exports a `loader` that returns `{appConfig}`, and the login screen reads the brand name from `useLoaderData`.
    - The findings go in `docs/explanation/admin-spa-ssr.md`: the root loader path, no layout loaders, the runtime result and the binary result.
  - Seam: HTTP `GET /console/login` on a server that registers `AdminSpaServeApp`; browser for hydration
  - Interface: `new AdminSpaServeApp({basePath?, appConfig?, distDir?, devProxyTarget?})` keeps its signature. `GET {basePath}/login` → 200 `text/html` server-rendered. `GET {basePath}/_expo/loaders/login` and `GET /_expo/loaders/login` → 200 JSON `{appConfig}`.
  - Cases:
    - `GET /console/login` → 200. Body contains `appConfig.brandName` ("Terreno Admin" by default, or the override) and `data-testid="admin-spa-login-email"`, and does not contain `admin-spa-app-config-loading`
    - `GET /_expo/loaders/login` → 200 JSON whose `appConfig.brandName` equals the override
    - `GET /console/_expo/static/<hashed>.js` → 200 with `Cache-Control` containing `immutable`
    - `GET /console/app-config.json` → 200, `no-store`, merged config (unchanged)
    - Missing `dist/server` → plugin logs the existing warning and `GET /console/login` → 503 (not a crash)
    - `new AdminSpaServeApp({basePath: "/admin-ui"})` with a bundle baked for `/console` (read from the `/console/_expo/...` asset prefix in `dist/server/_expo/routes.json`) → `register()` throws `Admin SPA basePath "/admin-ui" does not match the bundle's baseUrl "/console"`
    - `devProxyTarget` set → paths still proxy to the Expo dev server (unchanged)
    - AdminGate component: session loading on `/login` → renders children; session loading on `/` → spinner (unchanged)
    - AppConfigGate component: `window.__ADMIN_SPA_CONFIG__` set → children on first render, `fetch` not called
    - Browser (E1)
  - Blast radius: `example-backend/src/adminSpaServe.test.ts` uses `ADMIN_SPA_DIST_DIR`, so update its fixture to the `client/` + `server/` layout (http case). The `publish-on-tag` and `admin-spa-ci` workflows run `build:web`, so the tarball's `files` must keep `dist/**` (assert in serve.test.ts that the plugin resolves `dist/server`).
  - Test skills: none (follow `admin-spa/src/serve.test.ts` supertest and `admin-spa/e2e/login.spec.ts` patterns)
  - Docs: docs/explanation/admin-spa-ssr.md (new; spike results + architecture)

- [ ] **T2** — Request scope, the SSR payload loader helper, and PHI headers
  - Depends on: T1, T5 (imports `adminRpcSeedKey`)
  - Files: admin-spa/src/serverContext.ts, admin-spa/src/serverContext.test.ts, admin-spa/src/serve.ts, admin-spa/src/serve.test.ts, admin-spa/server/loadSsrPayload.ts, admin-spa/server/loadSsrPayload.test.ts, admin-spa/src/appConfig.ts, docs/explanation/admin-spa-ssr.md
  - Criteria:
    - The request scope:
      - `serverContext.ts` gains a per-request scope: `runInAdminSpaRequest(scope, fn)` and `getAdminSpaRequest()`, backed by one `AsyncLocalStorage` on the process global.
      - A value set before the Expo handler runs is readable inside `render.js` during that request's render and loaders, and not in any other request.
    - `internalOrigin`: `AdminSpaServeApp` takes this new option (default `http://127.0.0.1:${process.env.PORT ?? 4000}`).
    - `loadSsrPayload(request, {requests})`:
      - `requests` is a list of `{url, headers?}`. It fetches each in parallel from `${internalOrigin}`, forwarding the request's `Cookie` header plus only the allowlisted request headers each entry names (`X-Organization-Id`, the header the admin hooks send).
      - It returns `{rpc: {[seedKey]: body}, status: {[seedKey]: number}}`, where `seedKey = adminRpcSeedKey(url, headers)` from T5.
      - It never builds an origin from `Host` or `X-Forwarded-*`.
    - `ssrApiPrefixes`, a new option:
      - Default: `[adminApiBasePath, "/auth/me", "/orgs", "/jobs", "/comms", "/configuration", "/rbac"]`.
      - Every URL must start with one of these once normalized. Any other URL is rejected and no request is sent.
      - Route params are `encodeURIComponent`-encoded by the callers' URL builders before they are joined.
    - `Cache-Control: no-store, private` goes on every HTML response, every `{basePath}/_expo/loaders/*` response and every root `/_expo/loaders/*` response.
    - JSON embedded in HTML escapes `<`, `>`, `&`, U+2028 and U+2029.
  - Seam: exported `loadSsrPayload`, `runInAdminSpaRequest` and `getAdminSpaRequest` (with a stub internal server), plus HTTP headers on the served app
  - Interface: `new AdminSpaServeApp({…, internalOrigin?, ssrApiPrefixes?})`; `loadSsrPayload(request: Request, opts: {requests: Array<{url: string; headers?: Record<string, string>}>}): Promise<{rpc: Record<string, unknown>; status: Record<string, number>}>`; `runInAdminSpaRequest<T>(scope: AdminSpaRequestScope, fn: () => T): T`; `getAdminSpaRequest(): AdminSpaRequestScope | undefined`; the process global also carries `{internalOrigin, ssrApiPrefixes}`, which `loadSsrPayload` and the layout read inside `render.js`; `serializeForHtml(value: unknown): string`
  - Cases:
    - Request with `Cookie: a=1` and `Host: evil.example` → stub at `internalOrigin` receives `Cookie: a=1`, and no request goes to `evil.example`
    - `requests: [{url: "/admin/users?limit=20"}]` → `rpc[adminRpcSeedKey("/admin/users?limit=20")]` equals the stub body, `status` 200
    - `requests: [{url: "/orgs/o1/members", headers: {"X-Organization-Id": "o1"}}]` → stub receives `X-Organization-Id: o1`; the key differs from the header-less key
    - `requests: [{url: "/admin/users", headers: {Authorization: "x"}}]` → throws `SSR header not allowed`; no request sent
    - a loader returning a row whose field is `"</script><script>x()"` → the SSR HTML for that page contains no literal `</script><script>x()` (covers expo-server's own loader-data blob)
    - stub 404 for a URL → `rpc[url]` absent, `status[url]` 404
    - `requests: [{url: "/admin/users/..%2Fconfig"}]` → the stub receives the path `/admin/users/..%2Fconfig`, never `/admin/config`
    - `requests` for `/comms/stats` and `/rbac/roles` → allowed
    - `ssrApiPrefixes: ["/admin"]` override + a `/comms/stats` request → throws `SSR path not allowed`
    - a `/auth/../internal/audit-events` request → throws `SSR path not allowed`; stub receives no request
    - Internal fetch rejects → throws an error naming the path, without the cookie value in the message
    - Request with no `Cookie` → zero loopback fetches, so anonymous traffic never shares the loopback IP's rate-limit bucket (`api/src/rateLimit/policies.ts`)
    - `serializeForHtml({brandName: "</script><script>x()"})` → output contains no literal `</script>`
    - Two concurrent requests in different scopes → each render reads its own scope (user A's scope never seen by request B)
    - `GET /console/login`, `GET /console/_expo/loaders/login` and `GET /_expo/loaders/login` → `Cache-Control: no-store, private`
    - A loader whose fetch returns rows and then throws during render → the `logger.error` / Sentry capture contains the route path and error, and no row value. Assert with a sentinel string `PHI-SENTINEL` in the stub body.
  - Blast radius: none (new module; T3/T4/T6–T11 consume it)
  - Test skills: terreno:backend-test-env (process.env PORT default)
  - Docs: docs/explanation/admin-spa-ssr.md (payload, request scope + PHI headers section)

- [ ] **T3** — Express gate: redirects plus the shell payload in the request scope
  - Depends on: T2
  - Files: admin-spa/src/serve.ts, admin-spa/src/gate.ts, admin-spa/src/gate.test.ts, admin-spa/components/returnTo.ts, admin-spa/components/returnTo.test.ts, admin-spa/app/login.tsx, admin-spa/components/AdminGate.tsx, admin-spa/components/AdminGate.test.ts, admin-spa/e2e/serveTestApp.ts, admin-spa/e2e/login.spec.ts, admin-spa/e2e/ssr.spec.ts
  - Criteria:
    - Where the gate runs: on `GET` requests under `basePath` (except `_expo/static`, `assets` and `app-config.json`) and on root `/_expo/loaders/*`, before the handler.
    - Admin check, at most once per request: a user from `req.user` triggers one loopback `GET ${adminApiBasePath}/config` with the forwarded cookie. 200 means admin; 403 means forbidden.
    - HTML page requests:
      - anonymous on any page other than `/login` → `302 {basePath}/login?returnTo=<encoded in-app path>`;
      - a forbidden user → `302 {basePath}/forbidden`;
      - an admin on `/login` → `302` to a valid `returnTo`, or else `{basePath}/`.
      - `returnTo` is accepted only through a new shared `sanitizeReturnTo(value): string | undefined` (`components/returnTo.ts`, used by the gate and the client). It accepts an in-app path that starts with a single `/`, with no scheme, no `//` and no backslash.
    - The client honors it too: after a successful sign-in, `login.tsx` goes to `sanitizeReturnTo(returnTo) ?? "/"`, and the client `AdminGate` does the same for an admin on `/login`.
    - E1's anonymous `/console/forbidden` assertion becomes a server 302 (T3 owns that `ssr.spec.ts` edit).
    - Fail closed: any `/admin/config`, `get-session` or `/auth/me` result other than 200 / 401 / 403 (5xx, timeout after 5 s, network error) → `503` with no render and no loader run. A 401 counts as anonymous. `adminConfig: null` never reaches a render of any page except `/login` and `/forbidden`.
    - Loader requests follow the same rules but return `401` / `403` JSON instead of redirects. The routes `login` and `forbidden` are exempt.
    - Shell payload: otherwise the gate calls the handler inside `runInAdminSpaRequest({appConfig, basePath, session, profile, adminConfig, adminConfigStatus})`.
      - `session` is the Better Auth session snapshot `{userId, user}` from one loopback `GET {authBasePath}/get-session`. It has the same shape the client's session source reads, so the first client read matches it.
      - `profile` is one loopback `GET /auth/me`.
      - Both are fetched in parallel with `/admin/config`, only when `req.user` is set.
  - Seam: HTTP through `AdminSpaServeApp` with `req.user` set by a test middleware and a stub `/admin/config`; the handler stubbed to echo `getAdminSpaRequest()`
  - Interface: `createAdminSpaGate({basePath, internalOrigin, adminApiBasePath, appConfig, handler}): express.RequestHandler`
  - Cases:
    - no user, `GET /console/Todo` → 302 `Location: /console/login?returnTo=%2FTodo`
    - no user, `GET /console/login` → 200; scope `session: null`, `adminConfig: null`; stub `/admin/config` received 0 requests
    - no user, `GET /console/_expo/loaders/Todo` → 401 JSON; same for `GET /_expo/loaders/Todo`
    - no user, `GET /_expo/loaders/login` → 200
    - user, config 403, `GET /console/_expo/loaders/Todo` → 403 JSON
    - user, config 403, `GET /console` → 302 `/console/forbidden`; `GET /console/forbidden` → 200
    - admin, `GET /console/User` → 200; scope has `adminConfig`, `profile` and `session` equal to the stub bodies; each stub received exactly 1 request
    - admin, `GET /console/login?returnTo=%2FTodo` → 302 `/console/Todo`
    - admin, `GET /console/login?returnTo=https%3A%2F%2Fevil.example` → 302 `/console/`
    - admin, `GET /console/login?returnTo=%2F%2Fevil.example` → 302 `/console/`
    - `sanitizeReturnTo`: `"/todos"` → `"/todos"`; `"//evil.example"`, `"https://evil.example"`, `"/\\evil"`, `"todos"`, `undefined` → `undefined`; `["/a", "/b"]` → `"/a"`
    - login screen component: successful sign-in with `returnTo=/todos` → `router.replace("/todos")`; with `returnTo=//evil.example` → `router.replace("/")`
    - no user, `GET /console/_expo/static/x.js` → not redirected (asset served or 404)
    - user, config stub 500 → `GET /console/User` 503; handler not called
    - user, config stub never answers → 503 after the 5 s timeout (fake timers); handler not called
    - user, config stub 401 → `GET /console/User` 302 to login
    - production-style `__Secure-better-auth.session_token` cookie forwarded over the plain-HTTP loopback → get-session stub receives it unchanged
    - Browser (E2)
  - Blast radius: the client `AdminGate` redirects stay as a fallback for client navigation after a session expires. The existing `admin-spa/components/AdminGate.test.ts` cases stay green (component).
  - Test skills: none
  - Docs: docs/reference/admin-spa.md (gate table), via T12

- [ ] **T4** — Hydrate the shell: app config, session, admin config, profile
  - Depends on: T3, T5
  - Files: admin-spa/app/_layout.tsx, admin-spa/app/+html.tsx, admin-spa/components/AppConfigGate.tsx, admin-spa/components/StoreProvider.tsx, admin-spa/components/ssrPayload.ts, admin-spa/components/ssrPayload.test.tsx, syncdb/src/auth/session.ts, syncdb/src/auth/session.test.ts, syncdb/src/api/client.ts, syncdb/src/api/client.test.ts, docs/reference/syncdb.md, admin-spa/e2e/shell.ssr.spec.ts, admin-spa/e2e/serveTestApp.ts, docs/explanation/admin-spa-ssr.md
  - Criteria:
    - Shell payload:
      - `useSsrPayload()` returns the shell payload: from `getAdminSpaRequest()` on the server, and from `<script id="admin-spa-ssr" type="application/json">` on the client.
      - `+html.tsx` writes that script with `serializeForHtml`.
      - The client reads the script once, then removes the node.
      - After hydration it also deletes `globalThis.__EXPO_ROUTER_LOADER_DATA__` and the inline script that holds it. Route loader rows (PHI) then don't stay on `window` or in the DOM after hydration or logout. A later client navigation fetches its loader JSON instead.
    - Session:
      - syncdb `createSessionStore` gains `initialSession?: SessionSnapshot | null` (the same `{userId, user}` shape the source returns). When it is given, the first state is `isLoading: false`, with `isAuthenticated` matching, and `start()` does its first read silently. The state never flips back to loading, and a matching snapshot causes no state change.
      - `StoreProvider` passes the payload's session.
      - On the server the store never calls `start()` (no effect runs).
    - Admin config: the layout wraps `AdminGate` and everything below it in `<AdminRpcSeed data={{[`${apiBase}/config`]: adminConfig}}>`. Every `/admin/config` reader (`useAdminConfig` users, `UserSecurityScreen`, AdminGate) then renders from it on the first render. The case asserts zero `/admin/config` fetches across the whole rendered tree, not per component.
    - Profile: syncdb `ApiClient` gains `primeQuery(args, data)`. The layout primes `{method: "GET", url: "/auth/me"}` with the payload's `profile` (fetched by T3) when present, so `useAdminSpaProfile()` is fulfilled on the first render.
    - Sync start:
      - With a payload, `SyncEnabledAdminProvider` renders its children before `client.start()` resolves.
      - Without one, it keeps today's spinner-until-start.
      - The syncdb origin comes from `internalOrigin` on the server, not `localhost:4000`.
    - An admin's first HTML for `/console` contains the shell (nav + brand) and no `Spinner`, even when the config includes a windowed sync model.
  - Seam: syncdb store/client units; rendered root layout (component test); browser
  - Interface: `createSessionStore({…, initialSession?: SessionSnapshot | null})`; `apiClient.primeQuery(args: ApiRequestArgs, data: unknown): void`; `useSsrPayload(): AdminSpaShellPayload | undefined`
  - Cases:
    - `createSessionStore({source, initialSession: {userId: "ba1", user: ADMIN}})` → `getState()` is `{isLoading: false, isAuthenticated: true, user: ADMIN}` before `start()`
    - same store, `start()` with a source returning the same snapshot → no listener call; `isLoading` never true
    - same store, `start()` with a source returning `null` → `isAuthenticated: false` after the read, without passing through `isLoading: true`
    - `createSessionStore({source, initialSession: null})` → `{isLoading: false, isAuthenticated: false}`
    - no `initialSession` → `isLoading: true` (unchanged)
    - `primeQuery({method: "GET", url: "/auth/me"}, ME)` then `getQueryState` for the same args → fulfilled with ME; `fetch` not called; `invalidateTags(["profile"])` → refetches
    - two stores and clients built for two server requests share no state
    - layout with payload `{session: ADMIN, adminConfig: CONFIG}` → AdminGate renders children on first render; zero `/admin/config` fetches
    - payload with `adminConfigStatus: 403` on the client → redirects to `/forbidden`
    - seeded payload + config with a windowed model → `SyncEnabledAdminProvider` renders children on the first render; `client.start` not yet resolved
    - after the first client render → `document.getElementById("admin-spa-ssr")` is `null` and `globalThis.__EXPO_ROUTER_LOADER_DATA__` is `undefined`
    - no payload → spinner until start (unchanged)
    - server render with `internalOrigin: "http://127.0.0.1:5123"` → the syncdb client and the auth/api client are constructed with origin `http://127.0.0.1:5123` (not `localhost:4000`), and construction touches no `window`, `document` or IndexedDB (render completes under the Node test env without DOM globals)
    - Browser (E3)
  - Blast radius:
    - syncdb `SessionProvider` consumers in example-frontend pass no `initialSession`, so the existing syncdb auth tests stay green.
    - `ApiClient` gains a method, so the existing syncdb api tests stay green.
  - Test skills: terreno:verify-ui-changes
  - Docs: docs/explanation/admin-spa-ssr.md (hydration section); docs/reference/syncdb.md (`initialSession`, `primeQuery`)

- [ ] **T5** — Initial data for useAdminRpcQuery: the AdminRpcSeed context
  - Depends on: T1
  - Files: admin-frontend/src/adminRpcSeed.tsx, admin-frontend/src/useAdminRpc.ts, admin-frontend/src/useAdminRpc.test.tsx, admin-frontend/src/index.tsx, docs/reference/admin-frontend.md
  - Criteria:
    - New exported `<AdminRpcSeed data={Record<seedKey, unknown>}>` context.
      - The key is `adminRpcSeedKey(url, headers?)`, also exported. It combines the exact `url` that `useAdminRpcQuery` receives (query string included, `admin-frontend/src/useAdminRpc.ts:93-128`) with the hook's `X-Organization-Id` header value when one is sent.
      - A body fetched under one org scope, or under none, can never satisfy a hook that asks with another.
    - It can be nested at any depth, and inner seeds merge over outer ones. It is independent of `AdminProvider`, so the layout's two providers both see it.
    - `useAdminRpcQuery` returns the nearest matching seed as `data`, with `isLoading: false`, on the first render, and skips its first fetch. `transformResponse` applies to the seed. The hook refetches on `refetch()`, when its `url` changes, and on tag invalidation.
    - With no seed in the tree, behavior is unchanged, so the embedded admin in example-frontend is unaffected.
  - Seam: rendered hook inside `AdminProvider` + `AdminRpcSeed` (@testing-library/react-native)
  - Interface: `adminRpcSeedKey(url: string, headers?: HeadersInit): string`; `<AdminRpcSeed data={{[adminRpcSeedKey("/admin/roles")]: ROLES}}>{children}</AdminRpcSeed>`; `useAdminRpcQuery({headers?, keepPreviousData?, pollingInterval?, providesTags?, rpc, skip?, transformResponse?, url})` (existing signature)
  - Cases:
    - seeded `"/admin/roles"`, hook `url: "/admin/roles"` → first render `data === ROLES`, `isLoading false`, rpc not called
    - unseeded URL → first render `isLoading true`, rpc called once
    - seeded, then `refetch()` → rpc called once; data updates
    - seeded `"/admin/roles"`, hook `url: "/admin/roles?page=2"` → treated as unseeded (exact match)
    - seeded `adminRpcSeedKey("/orgs/o1/members")` (no header), hook sends `X-Organization-Id: o1` → unseeded; rpc called
    - seeded with header `o1`, hook sends header `o2` → unseeded; seeded with `o1`, hook sends `o1` → seeded
    - `adminRpcSeedKey("/a")` !== `adminRpcSeedKey("/a", {"X-Organization-Id": "o1"})`; other header names do not change the key
    - seeded, `skip: true` → no data, no fetch (skip wins)
    - seeded + `transformResponse: (b) => b.items` → `data` is the seed's `items`
    - seeded, then a mutation invalidates its `providesTags` → rpc called once
    - outer seed `{"/a": 1}`, inner seed `{"/a": 2}` → hook under inner sees 2
    - no `AdminRpcSeed` in tree → identical to today
  - Blast radius: every RPC screen reads `useAdminRpcQuery`, and the hook seam covers them. The existing admin-frontend suite must stay green (component).
  - Test skills: none (follow existing admin-frontend hook tests)
  - Docs: docs/reference/admin-frontend.md (`AdminRpcSeed`)

- [ ] **T6** — Server-render the model list
  - Depends on: T4
  - Files: admin-frontend/src/useAdminModelApi.ts, admin-frontend/src/adminModelUrls.ts, admin-frontend/src/adminModelUrls.test.ts, admin-frontend/src/index.tsx, admin-spa/app/[model]/index.tsx, admin-spa/server/modelRoutes.ts, admin-spa/server/modelRoutes.test.ts, admin-spa/e2e/integration/adminSpa.ssr.list.integration.spec.ts, docs/explanation/admin-spa-ssr.md
  - Criteria:
    - The list loader reuses the existing `buildAdminApiListQueryRequest` (`admin-frontend/src/adminApiQueryParams.ts:27`), which `useListQuery` already uses.
    - `adminModelUrls.ts` adds only `buildAdminReadUrl(routePath, id)`, which encodes `id` with `encodeURIComponent`. `useReadQuery` uses it, so read URLs match by construction.
    - The `[model]` loader:
      - The `[model]` route param is the model **name** (`/console/User`, as `AdminModelList.tsx:146` links), resolved through `adminConfig.models[].name`, as `app/[model]/index.tsx` does today. The loader resolves the model from the scope's `adminConfig` and builds the default list URL (default sort, page 1, default limit).
      - For an org-scoped path (`/orgs/<orgId>/...`), it sends the same `X-Organization-Id` the hook sends.
      - It fetches that URL through `loadSsrPayload` and returns `{rpc}`.
      - The route wraps its screen in `<AdminRpcSeed data={rpc}>`.
    - The table renders rows on the first render, and hydration triggers no list fetch.
  - Seam: exported URL builders + `resolveModelListUrl(adminConfig, modelName)` + rendered `AdminModelTable` under a seed + browser
  - Interface: `buildAdminReadUrl(routePath: string, id: string): string`; `resolveModelListUrl(adminConfig, modelName): string | null`
  - Cases:
    - config with User (`routePath: "/admin/users"`, `defaultSort: "-created"`) → URL equals the one `useListQuery` requests for default table params (assert by rendering the table with a recording rpc and comparing)
    - unknown model name → `null`; the loader returns `{rpc: {}}` and the page renders the existing not-found state
    - seeded `AdminModelTable` for User → rows on first render; rpc not called for the list
    - seeded list, then a delete mutation invalidates `admin_User` → list refetches once
    - windowed model (Todo) → `resolveModelListUrl` still returns the REST membership URL (T8 consumes it)
    - Browser (E4)
  - Blast radius: `useReadQuery` now encodes ids, which changes request URLs for ids that contain reserved characters in every admin host (embedded example-frontend admin included). Two component cases cover it: an ObjectId or plain id produces the same URL as before; an id containing `/` is encoded. The existing model table and form suites stay green.
  - Test skills: terreno:verify-ui-changes
  - Docs: docs/explanation/admin-spa-ssr.md (data SSR section)

- [ ] **T7** — Server-render the model detail form
  - Depends on: T6
  - Files: admin-frontend/src/AdminModelForm.tsx, admin-frontend/src/AdminModelForm.test.tsx, admin-spa/app/[model]/[id].tsx, admin-spa/server/modelRoutes.ts, admin-spa/server/modelRoutes.test.ts, admin-spa/e2e/integration/adminSpa.ssr.detail.integration.spec.ts
  - Criteria:
    - The `[model]/[id]` loader fetches `buildAdminReadUrl(routePath, id)` and seeds it.
    - `AdminModelForm` initializes its form state from `itemData` on the first render when the data is already present. Today it copies it in a `useEffect` (`AdminModelForm.tsx:349-365`), one render late.
    - The form renders field values in the first HTML.
    - A 404 from the backend renders the existing not-found state. The HTTP status stays 200: on expo-server 58 a loader can set a status only by throwing `StatusError`, which replaces the page with an error body.
  - Seam: `resolveModelReadUrl` + rendered form under a seed + browser
  - Interface: `resolveModelReadUrl(adminConfig, modelName, id): string | null`
  - Cases:
    - User id `u1` → `"/admin/users/u1"`; id `"../config"` → `"/admin/users/..%2Fconfig"`
    - seeded form → `admin-form-field-email` has the seeded value on first render; rpc not called
    - backend 404 → loader returns `{rpc: {}, notFound: true}`; HTML (status 200) shows the not-found testID
    - `/console/User/create` is not treated as an id (create route unchanged, no read fetch)
    - seeded read, then save → read refetches once
    - Browser (E5)
  - Blast radius: `AdminModelForm` without a seed keeps today's load-then-fill (existing form tests, component).
  - Test skills: terreno:verify-ui-changes
  - Docs: none beyond T6's section

- [ ] **T8** — Windowed syncdb tables render the first view from seeded rows
  - Depends on: T6
  - Files: admin-frontend/src/AdminModelTable.tsx, admin-frontend/src/adminWindowedTable.ts, admin-frontend/src/AdminModelTable.test.tsx, admin-spa/e2e/integration/adminSpa.ssr.windowed.integration.spec.ts, docs/explanation/admin-spa-ssr.md
  - Criteria:
    - A windowed table (`AdminModelTable.tsx:499-587`) renders its rows from the REST membership response (T6's seed) when the TinyBase store does not have them yet. Today it reads rows only through `store.getEntity` after a `useEffect` upsert.
    - When syncdb is ready, the existing `hydrateWindow` / upsert runs and the store rows take over with no visible change.
    - Without a seed, today's behavior is unchanged. T4 already lets the provider render before `start()`.
  - Seam: rendered `AdminModelTable` with a fake syncDb
  - Interface: unchanged public props
  - Cases:
    - seeded rows + syncDb not started → rows rendered on first render
    - syncDb start resolves → rows still rendered, now from the store; upsert ran once with the seeded ids
    - no seed → behavior identical to today
    - Browser (E8)
  - Blast radius: embedded admin in example-frontend uses windowed tables without SSR → existing admin-frontend table tests stay green (component).
  - Test skills: none
  - Docs: docs/explanation/admin-spa-ssr.md (syncdb note)

- [ ] **T9** — Server-render home, configuration, roles, scripts, and version-config
  - Depends on: T4, T6 (both edit `admin-frontend/src/index.tsx`; the home `recentActivity` widget reuses T6's list URL)
  - Files: admin-spa/app/index.tsx, admin-frontend/src/widgets/homeWidgetUrls.ts, admin-frontend/src/index.tsx, admin-spa/app/configuration.tsx, admin-spa/app/roles/index.tsx, admin-spa/app/scripts.tsx, admin-spa/app/version-config.tsx, admin-spa/server/rpcRoutes.ts, admin-spa/server/rpcRoutes.test.ts, admin-spa/e2e/integration/adminSpa.ssr.rpc.integration.spec.ts
  - Criteria:
    - Each route's loader fetches the exact URLs that its screen's `useAdminRpcQuery` calls request on mount, and the route wraps its screen in `<AdminRpcSeed data={useLoaderData().rpc}>`.
    - Each screen renders its data on the first render.
    - Home: `rpcUrlsForRoute("/", {apiBase, adminConfig})` derives URLs from `adminConfig.home.slots`, using a map of each built-in widget to the URLs it requests on mount (`modelStats`, `versionConfig`, `jobs`, `recentActivity`; see `example-backend/src/exampleAdminConfig.ts`). A custom app widget outside the map is not seeded and loads on the client, as today. The reference documents this.
  - Seam: exported `rpcUrlsForRoute(route, {apiBase})` + each screen rendered inside `AdminProvider` + `AdminRpcSeed`
  - Interface: `rpcUrlsForRoute(route: "/" | "/configuration" | "/roles" | "/scripts" | "/version-config", {apiBase: string; adminConfig: AdminConfigResponse}) → string[]`
  - Cases:
    - `"/configuration"`, apiBase `/admin` → `["/configuration/meta", "/configuration"]` (`useConfigurationApi.ts:38,50`; `ConfigurationScreen.tsx:194` default `basePath`)
    - `"/roles"` → `["/rbac/roles", "/rbac/statements"]` (`useAdminRoles.ts:74,96-106`)
    - `"/scripts"` → the default `"/admin/scripts/runs?page=…&limit=…"` URL that `useAdminScripts.ts:57-80` builds
    - `"/version-config"` → `["/admin/version-config"]` (`AdminVersionConfig.tsx:50-53`)
    - `"/"` with slots `[recentActivity on User]` → the User list URL that `RecentActivityWidget` requests (`widgets/RecentActivityWidget.tsx:14-15`); with no slots → `[]`; with an unknown custom widget → that widget contributes no URLs
    - home rendered with the example config's slots under seeds from `rpcUrlsForRoute("/")` → zero rpc calls on first render (binding check)
    - Binding check, one per route: render the screen under `AdminRpcSeed` built from `rpcUrlsForRoute`, with stub bodies, and expect zero rpc calls on the first render. This fails if any URL differs from the hook's.
    - Browser (E6)
  - Blast radius: none beyond T5
  - Test skills: terreno:verify-ui-changes
  - Docs: none beyond T6's section

- [ ] **T10** — Server-render the jobs and comms screens
  - Depends on: T4
  - Files: admin-spa/app/jobs/index.tsx, admin-spa/app/jobs/[id].tsx, admin-spa/app/comms/index.tsx, admin-spa/app/comms/[id].tsx, admin-spa/server/jobsCommsRoutes.ts, admin-spa/server/jobsCommsRoutes.test.ts, admin-spa/e2e/integration/adminSpa.ssr.jobs.integration.spec.ts, admin-spa/e2e/integration/adminSpa.ssr.comms.integration.spec.ts
  - Criteria:
    - The jobs loaders fetch the URLs that `useJobsDashboardApi` requests on mount (`jobs/useJobsDashboardApi.tsx:58-91`: `/jobs?…`, `/jobs/stats`, `/jobs/schedules`, `/jobs/{id}`, none prefixed with apiBase).
    - The comms loaders fetch the URLs that `useCommsDashboardApi` requests on mount (`comms/useCommsDashboardApi.tsx:43-98`: `/comms/messages?…`, `/comms/stats?…`, `/comms/messages/{id}`).
    - Both seed through `AdminRpcSeed`, and every list and detail renders data on the first render.
  - Seam: exported `jobsSsrUrls(route, {id?})` / `commsSsrUrls(route, {id?})` + rendered screens
  - Interface: `jobsSsrUrls("/jobs" | "/jobs/[id]", {id?}) → string[]`; `commsSsrUrls("/comms" | "/comms/[id]", {id?}) → string[]`
  - Cases:
    - `commsSsrUrls("/comms/[id]", {id: "m1"})` → `["/comms/messages/m1"]`
    - `jobsSsrUrls("/jobs/[id]", {id: "j1"})` → `["/jobs/j1"]`
    - the jobs dashboard, job detail, comms list and comms detail, rendered with seeds from these outputs → zero rpc calls on first render (binding check)
    - unknown comms or job id (backend 404) → the existing not-found state in the first HTML (status 200, same reason as T7)
    - Browser (E7, E9)
  - Blast radius: none beyond T5
  - Test skills: terreno:verify-ui-changes
  - Docs: none beyond T6's section

- [ ] **T11** — Server-render the orgs directory, settings, and members
  - Depends on: T4
  - Files: admin-spa/app/orgs/index.tsx, admin-spa/app/orgs/[orgId]/index.tsx, admin-spa/app/orgs/[orgId]/members.tsx, admin-spa/server/orgsRoutes.ts, admin-spa/server/orgsRoutes.test.ts, admin-spa/e2e/integration/adminSpa.ssr.orgs.integration.spec.ts
  - Criteria:
    - The loaders fetch the URLs that `useOrganizationsApi` (`orgs/useOrganizationsApi.ts:65+`: `/orgs`, `/orgs/mine`, `/orgs/{id}`, `/orgs/{id}/members`) and `useMemberSecurityApi` request on mount, and seed them through `AdminRpcSeed`.
    - The profile (`/auth/me`) is already primed by T4.
    - `isOperator` comes from the scope's `profile`, through the existing `isOrganizationOperatorProfile` (`admin-spa/components/adminSpaProfile.ts:19-21`, roles `operator` or `superadmin`). An org admin who is not an operator gets no directory data: the loader does not fetch it.
    - Org-scoped requests (`/orgs/{id}/members`, member security) carry the same `X-Organization-Id` the hooks send (`adminOrganizationHeaders`).
  - Seam: exported `orgsSsrRequests(route, {orgId?, isOperator})` + rendered screens
  - Interface: `orgsSsrRequests("/orgs" | "/orgs/[orgId]" | "/orgs/[orgId]/members", {orgId?, isOperator: boolean}) → Array<{url, headers?}>`
  - Cases:
    - `("/orgs", {isOperator: true})` → includes `"/orgs"`
    - `("/orgs", {isOperator: false})` → `[]`, and the page shows the existing forbidden behavior
    - `("/orgs/[orgId]/members", {orgId: "o1", isOperator: true})` → includes `{url: "/orgs/o1/members", headers: {"X-Organization-Id": "o1"}}`
    - `isOperator` from profile roles `["operator"]` → true; `["admin"]` → false
    - screens rendered with seeds from these outputs → zero rpc calls on first render (binding check)
    - Browser (E10)
  - Blast radius: none beyond T5
  - Test skills: terreno:verify-ui-changes
  - Docs: none beyond T6's section

- [ ] **T12** — Update docs, changelog, and smoke for SSR serving
  - Depends on: T3, T4, T13
  - Files: docs/reference/admin-spa.md, docs/how-to/upgrade-admin-spa-ssr.md, admin-spa/README.md, admin-spa/e2e/smoke.ts, docs/testing/e2e/admin-spa.md, changelog/unreleased/admin-spa-ssr.md, docs/how-to/deploy-cloud-run.md (only if it names the `ADMIN_SPA_DIST_DIR` layout)
  - Criteria:
    - The reference and README describe:
      - the `client/` + `server/` layout and `internalOrigin`;
      - the gate table, and `no-store, private` on HTML and loaders;
      - the root `/_expo/loaders/*` claim, and why (SDK 58 ignores baseUrl);
      - the mount-path constraint;
      - the loopback rate-limit multiplier (D7): up to about 7 loopback calls per signed-in page.
    - `docs/how-to/upgrade-admin-spa-ssr.md` gives consumers the upgrade path, and the changelog links it. It covers:
      - rebuild with `experiments.baseUrl` set in `app.json` for a non-`/console` mount;
      - the new `dist/client` + `dist/server` layout and the Dockerfile `COPY`;
      - `internalOrigin` behind a proxy;
      - reverse-proxy and CDN rules: never cache `/console/*` HTML or `/_expo/loaders/*`, and route root `/_expo/loaders/*` to the backend.
    - `rewriteIndexHtml` and `injectBaseGlobal` are documented as deprecated (Q4).
    - `bun run smoke` boots the SSR server over the built `dist/` and asserts the SSR login HTML; the package test page is updated.
    - The changelog entry flags two breaking changes:
      - the `distDir` layout changes;
      - `basePath` must equal the bundle's baked `baseUrl` (`/console` by default), or `register()` throws. Any other mount needs `experiments.baseUrl` set in `admin-spa/app.json` and a rebuild.
  - Seam: smoke script
  - Interface: `bun run smoke` exit 0
  - Cases: smoke → `GET /console/login` 200 contains brand; `GET /_expo/loaders/login` 200; `GET /console/app-config.json` 200
  - Blast radius: none
  - Test skills: terreno:update-docs
  - Docs: this task is docs.

- [ ] **T13** — CI job: prove SSR inside the built example-backend image
  - Depends on: T1, T2
  - Files: .circleci/continue-config.yml (new `admin-spa-image-smoke` job beside `admin-spa-integration` at :1891), .circleci/config.yml (path filters: `example-backend/Dockerfile`, `scripts/admin-spa-image-smoke.sh`, `admin-spa/.*` → the job's parameter), scripts/admin-spa-image-smoke.sh
  - Criteria:
    - A CircleCI job (the GitHub `admin-spa-integration.yml` workflow is disabled) builds `example-backend/Dockerfile` and runs the image with `ADMIN_SPA_ENABLED=true` against a service mongo replica set.
    - The job curls `/console/login` and fails unless the response is 200 HTML containing the brand name and `admin-spa-login-email`.
    - It also curls `/_expo/loaders/login` and fails unless that is 200 JSON with `Cache-Control: no-store, private`.
    - The job validates its required env per CLAUDE.md "Required Secret Validation".
  - Seam: process (container) + http
  - Interface: `scripts/admin-spa-image-smoke.sh <base-url>` exit 0/1
  - Cases: SSR HTML present → exit 0; `render.js` missing from the image (simulate by running with `ADMIN_SPA_DIST_DIR=/nonexistent`) → `/console/login` 503 → exit 1
  - Blast radius: none
  - Test skills: none
  - Docs: docs/reference/admin-spa.md deploy note (via T12)

## Assumptions

- `TerrenoApp`'s Better Auth session middleware sets `req.user` before plugins (`api/src/terrenoApp.ts:433` vs `:527`). Consumers that use `BetterAuthApp` as a plugin must register it before `AdminSpaServeApp`, as the README already shows. T12 documents this.
- The admin check stays authoritative on the backend: the gate and loaders ask `/admin/config` instead of reading `user.admin`, matching `AdminGate` today (`adminGateUtils.ts:8-23`).
- Loaders fetch over loopback HTTP with the forwarded cookie, because `AdminApp` has no in-process query API (`admin-backend/src/adminApp.ts:1019` is a closure). Each signed-in page request costs 3 gate calls (`/admin/config`, `get-session`, `/auth/me`) plus 0 to 4 loader calls (jobs is the most: list, stats, schedules), so up to about 7. Anonymous requests make none.
- Dev mode (`devProxyTarget`) keeps proxying to `expo start`, which does its own SSR. The gate still runs in Express ahead of the proxy, but the dev server runs in another process and cannot read the request scope. In dev the shell therefore renders without a payload (today's client fetches).
- `expo-server` 58.0.5 is already in `node_modules` (release-58) and moves to the root catalog.
- `AsyncLocalStorage` context set by Express survives into `render.js`, through the adapter's own `AsyncLocalStorage` scope (T2 proves it; Node and the Bun binary both implement it).
- Better Auth reads the forwarded session cookie, including a `__Secure-` cookie, on a plain-HTTP loopback request. The cookie name is fixed by server config, not by the request scheme. A T3 case proves it.
- syncdb and admin-frontend gain small public options (`initialSession`, `primeQuery`, `AdminRpcSeed`, URL builders). These are additive and land in Terreno 58 with this branch.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q4 | Remove `rewriteIndexHtml` / `injectBaseGlobal` exports? | Deprecate in this release; remove in the next major | They are public exports (`docs/reference/admin-spa.md` "Utility exports") | Remove now (one more breaking line in the changelog) | T12 |
| Q5 | Should forbidden users get a 302 to `/forbidden` or a 403 status page at the same URL? | 302 to `/forbidden` | Keeps today's URLs and `forbidden.tsx` | Render 403 in place; the gate's Cases change | T3 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | ~~Expo SDK 58 upgrade~~: done. This plan now builds on `release-58.0.0` (D11) | — | — | — |
| X2 | Standalone SSR'd auth app (login, signup, reset, verify, MCP consent) served by Express | The "login app" scope question; MCP OAuth needs an app-hosted `consentUrl` | L | none |
| X3 | In-process admin query API on `AdminApp` (config + list/read without loopback HTTP) | Loaders make 2 to 4 loopback calls per page | M | T6 |
| X4 | Server-render the example-frontend auth screens | Considered at question time | M | none |
| X5 | Move the SSR auth gate from Express into `admin-spa/app/+middleware.ts` | D6: middleware is the target home once it is stable | S | T3 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | Which "login app"? | admin-spa's own `/login` only | Scope is one package; X2 and X4 parked |
| D2 (superseded by D11) | Does Expo 58 support SSR better, and what should this build on? | 58 makes it stable. Build on SDK 57 + `unstable_` flags, shaped so the 58 upgrade only deletes flags. | T1 sets the flags; X1 removes them |
| D3 | SSR depth | Full data SSR: model list/detail and RPC screens render with data | Adds T5–T11 |
| D4 | Q1: if the T1 tracer is a no-go on SDK 57, what next? | Stop the run and ask the human. Do not pick a fallback alone. | T1 no-go → BLOCKED (human) |
| D5 | Q2: is a server-only bundle that mounts only at its baked `baseUrl` (a breaking change) OK? | Yes, ship it as a breaking change in the changelog. T1 still checks for runtime `basePath`, and keeps it if possible. | T1 guard, T12 changelog |
| D6 (durable) | Q6: where does the SSR auth gate live? | Express now, ahead of the Expo handler. Expo `+middleware` is the target home after the Expo 58 upgrade (X5). | T3 as written; X5 added |
| D7 | Q7: exempt SSR loopback calls from the admin's rate-limit bucket? | No. Document the multiplier, and build X3 if admins hit 429s. | T12 docs note |
| D8 | Approve the plan for barrel? | Approved; Q3–Q5 stand on their recommendations | Status approved |
| D9 (superseded by D11) | T1 tracer: SDK 57's client fetches loaders from root `/_expo/loaders/<route>`, ignoring the `/console` baseUrl. How should loader requests reach the handler? | Stop and wait for SDK 58. Re-check after X1 whether 58 prefixes baseUrl. Rejected for now: root alias, patching expo-router, client fetch shim. | Run paused at T1; resumes after X1 |
| D10 | T1 cannot put the brand in the first HTML inside its Files line | Widen T1 minimally: `AppConfigGate` reads the config `+html.tsx` injects from the server context, with no fetch; `AdminGate` renders `/login` while auth loads. T4 keeps the session, admin config and store work. | T1 Files gain `admin-spa/components/AppConfigGate.tsx`, `admin-spa/components/AdminGate.tsx`, `admin-spa/components/adminGateUtils.ts` |
| D11 | (supersedes D9, D2) Rebased onto `release-58.0.0`, where SDK 58 still fetches root `/_expo/loaders/<route>`. How do loader requests reach the handler? | Root alias: `AdminSpaServeApp` also routes root `/_expo/loaders/*` to the same handler, behind the same gate and `no-store, private`. On 58 there are no `unstable_` flags; `web.output: "server"` alone. | T1 Interface + Cases; T2/T3 cover the root loader path; docs note the root-path claim |
| D12 | release-58 removed `@terreno/rtk`, Redux and `useAdminApi` | Re-distill T4–T11 against the 58 data layer before building; bring back for sign-off | T4–T11 rewritten |
| D13 | Approve revision 2 for barrel? | Approved; Q4–Q5 stand on their recommendations; not-found renders with HTTP 200 | Status approved |

## Sign-off

Status: approved 2026-11-02 (revision 2, cut rounds 1–2 applied: rebased on release-58.0.0, D11–D12; T1–T11 rewritten; Q3 resolved by design: the gate fetches `/admin/config` once and shares it through the request scope)

### T1 tracer result (2026-11-02, Expo SDK 57.0.14, expo-server 57.0.3)

Spike builds lived in `/data/tmp`, and no code was committed.

- **Go:**
  - `web.output: "server"` with both `unstable_` flags (read from `extra.router` and set through the `expo-router` plugin options) exports `dist/client` and `dist/server/_expo/{routes.json,server/render.js}`.
  - `render.js` (10.8 MB) is self-contained.
- **Go:** `routes.json` patterns carry no `/console` prefix, but asset URLs do (`/console/_expo/static/...`). `createRequestHandler` mounted with `app.use("/console", …)` strips the prefix, so the patterns match.
- **Go:**
  - `GET /console/login` returns 200 SSR HTML under Node, under Bun, and from a `bun build --compile` binary run in a directory with no `node_modules` (runtime `require(render.js)` works).
  - `GET /console/_expo/loaders/login` returns 200 JSON.
- **No-go (D9):** client-side navigation in Chromium requests `http://host/_expo/loaders/login`. That is the site root: expo-router 57's `getLoaderModulePath` ignores baseUrl. So every client navigation to a loader route 404s under `/console`.
- **Layout loaders:** a loader exported from `_layout.tsx` is not addressable. `/_expo/loaders/login` returns only the route's loader data, so T4 must carry the shell payload some other way (an injected blob or each route's loader).
- **Re-run on `release-58.0.0` (97b76d3f; expo-router 58.0.23, expo-server 58.0.5):**
  - `output: "server"` alone (no flags) exports `client/` and `server/_expo/{loaders,routes.json,server}`.
  - `/console/login` SSR returns 200, and `/console/_expo/loaders/login` returns 200.
  - In Chromium, client navigation **still** requests root `/_expo/loaders/login`, so D9's premise that SDK 58 fixes this is false.
  - `release-58.0.0` has removed `@terreno/rtk`, Redux and `useAdminApi` (#1603, #1589). The RTK seeding in T4, T6, T7, T10 and T11 no longer applies on this base.
- **First HTML** shows `admin-spa-app-config-loading`, because `AppConfigGate` and `AdminGate` block on the client (D10).
- `AppConfigGate` falls back to `/app-config.json` at the root when `window.__ADMIN_SPA_BASE__` is absent. The SSR path no longer runs `injectBaseGlobal`, so `+html.tsx` must inject the base.
Cut on revision 2: round 1, 12 findings (4 blocking). All 12 were fixed:
- F1: `returnTo` support added to T3.
- F2: seeds keyed by URL plus allowlisted headers.
- F3: `initialSession` is a `SessionSnapshot` with a silent first read.
- F4: home widget URLs in T9.
- F5: `profile` and `session` fetched by the gate.
- F6: loader-data global cleared after hydration.
- F7: not-found renders with status 200 (`StatusError` replaces the page).
- F8: upgrade how-to.
- F9: reuse `buildAdminApiListQueryRequest`, with id encoding in Blast radius.
- F10: no reader count.
- F11: T3 owns the `ssr.spec.ts` edit.
- F12: D2 and D9 marked superseded.

Cut on revision 2, round 2: 8 findings (3 blocking). 7 fixed:
- F1: model routes use the model name (`/console/User`).
- F2: T13 moved to CircleCI.
- F3: T2 depends on T5.
- F4: `internalOrigin` on the global, with T4 origin and no-DOM cases.
- F5: the gate fails closed with 503.
- F6: T9 depends on T6.
- F8: loopback count corrected to about 7.

0 moved. 1 rebutted: F7, because `dist/server/_expo/routes.json` `assets.js` entries do carry `/console/_expo/static/...` (spike build, line 14).
Couldn't-assess items now have cases or assumptions: server-safe client construction (T4 case) and the `__Secure-` cookie over loopback (Assumption plus T3 case).
Round 1's couldn't-assess items are proved by T2 cases: the AsyncLocalStorage scope reaching `render.js`, and the escaping of expo-server's own loader-data blob.
Revision 1 cut: 2 rounds. Round 2: 10 findings: 8 fixed (F1 jobs/orgs on the RTK seam, F2 seeds keyed by exact `url`, F3 E9/E10 added, F4 loader path allowlist + encoding, F7 T13 → T2, F8 Files lines + T12 → T13, F9 literal route cases, F10 SSR global cleared after seeding), 2 moved to questions (F5 → Q7, F6 → Q2 fundamental), 0 rebutted. Round 1: 11 findings: 10 fixed (F1–F10: windowed spinner moved to T4, T6 retargeted to ObjectId Users with Todo moved to T8, the AdminRpcSeed context seam, T4 → T5, the tracer no-go returns to the human, basePath guard, gate loader cases, one spec file per task, T13 CI image smoke, PHI log and loopback rate-limit cases), 0 moved, 1 rebutted (F11: distill's testing contract requires an e2e guide task when `docs/testing/e2e.md` is missing, and spec-writing tasks depend on it)
