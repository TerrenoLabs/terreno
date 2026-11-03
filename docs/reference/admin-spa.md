# @terreno/admin-spa

Standalone Expo Router admin web SPA plus an Express plugin (`AdminSpaServeApp`) that server-renders the pre-built export from a Terreno backend on the same origin.

How screens and nav work (including `routeBase=""`): [How admin interfaces are shaped](../explanation/admin-interface.md).
How to add a screen: [Build admin screens](../how-to/build-admin-screens.md).
How server rendering works: [Server-rendering the admin SPA](../explanation/admin-spa-ssr.md).
Upgrading from the static export: [Upgrade to the server-rendered admin SPA](../how-to/upgrade-admin-spa-ssr.md).

## Table of Contents

- [Install](#install)
- [Commands](#commands)
- [Architecture](#architecture)
- [AdminSpaServeApp](#adminspaserveapp)
- [App config](#app-config)
- [Serving and caching](#serving-and-caching)
- [Access gate](#access-gate)
- [Loopback calls and rate limits](#loopback-calls-and-rate-limits)
- [Mount path constraint](#mount-path-constraint)
- [Standalone SPA vs embedded admin-frontend](#standalone-spa-vs-embedded-admin-frontend)

## Install

```bash
bun add @terreno/admin-spa @terreno/api
```

`@terreno/api` is a peer dependency (TerrenoPlugin registration).

## Commands

From the `@terreno/admin-spa` package directory:

```bash
bun run compile      # Compile the server plugin (src/ -> src/dist)
bun run build:web    # Expo server export into dist/ (client/ + server/)
bun run dev          # expo start --web --port 8083
bun run test:ci      # Serve-plugin unit tests
bun run smoke        # HTTP smoke over the built dist/ (SSR login, root loader, app-config)
bun run test:e2e     # Playwright e2e over built dist/
```

## Architecture

```
admin-spa/
  src/
    serve.ts           # AdminSpaServeApp TerrenoPlugin
    gate.ts            # Access gate, run in Express before any render
    appConfig.ts       # AdminSpaAppConfig defaults + merge helper
    index.ts           # Public exports
  app/                 # Expo Router routes (Better Auth + admin screens), with route loaders
  server/              # Loader helpers: loadSsrPayload, model, RPC, jobs/comms and orgs requests
  components/          # AppConfigGate, StoreProvider (session + request client), AdminGate
  store/               # Admin window syncdb config
  dist/                # Export root, produced by build:web
    client/            # Hashed JavaScript and assets
    server/            # Expo server build: _expo/routes.json, render.js, one module per loader
```

Boot flow in the SPA: `AppConfigGate` reads the config the server render wrote into the page
(`window.__ADMIN_SPA_CONFIG__`), and fetches `${basePath}/app-config.json` only in dev proxy
mode →
`StoreProvider` builds a cookie-session Better Auth client and a same-origin
request client (`createApiClient({credentials: "same-origin"})` from
`@terreno/syncdb/api`), then mounts `SessionProvider` (`@terreno/syncdb/auth`) and
`ApiClientProvider` → `AdminGate` reads `useSession()` and redirects anonymous
users to `/login` and non-admins to `/forbidden` → the authorized provider reads
`/admin/config`. The SPA loads the signed-in profile (`/auth/me`, for operator
roles) with `useApiQuery` over that request client. It has no Redux store and no
`@terreno/rtk` dependency. When config contains String-`_id` models with `adminBroadcast`
and `syncCollection`, it starts a same-origin cookie-authenticated syncdb client
with those collections in window mode and forwards `useConflicts()` to the admin.
ObjectId and non-broadcast models use the cookie-bound `AdminProvider` fetch client.

When the backend enables organizations, the bundled SPA exposes:

- `/orgs` — operator-only organization directory;
- `/orgs/:orgId` — organization settings;
- `/orgs/:orgId/members` — organization memberships.

`AdminSpaShell` renders `OrgSwitcher` on every admin route. The switcher and
directory use `/orgs` API routes while generic model CRUD continues under the
configured `adminApiBasePath`. Org-admins do not receive the directory link.
The default `/console` mount therefore serves these as `/console/orgs/...`.

## AdminSpaServeApp

`AdminSpaServeApp` implements `TerrenoPlugin`. Register it after `BetterAuthApp` and `AdminApp`. The access gate reads `req.user`, which the Better Auth session middleware sets, so `BetterAuthApp` must be registered before `AdminSpaServeApp`:

```typescript
import {AdminSpaServeApp} from "@terreno/admin-spa";
import {AdminApp} from "@terreno/admin-backend";
import {BetterAuthApp, TerrenoApp} from "@terreno/api";

new TerrenoApp({userModel: User})
  .register(new BetterAuthApp({config: betterAuthConfig, userModel: User}))
  .register(new AdminApp({models: [...]}))
  .register(
    new AdminSpaServeApp({
      basePath: "/console",
      appConfig: {brandName: "Acme Admin", providers: ["email", "google"]},
      devProxyTarget: process.env.ADMIN_SPA_DEV_PROXY,
    })
  )
  .start();
```

`example-backend` registers the plugin when `ADMIN_SPA_ENABLED=true`, with optional `ADMIN_SPA_DEV_PROXY` and `ADMIN_SPA_DIST_DIR` (the export root, passed as `distDir`) overrides.

### AdminSpaServeOptions

| Option | Default | Description |
|--------|---------|-------------|
| `basePath` | `"/console"` | URL prefix where the SPA is mounted. Admin API stays at `/admin`. |
| `appConfig` | see [App config](#app-config) | Partial config merged over defaults; served at `${basePath}/app-config.json`. |
| `distDir` | `<package>/dist` | The export root: the directory that holds `client/` and `server/`, not `client/` itself. Set it for a compiled binary, a custom build, or tests. |
| `devProxyTarget` | — | When set, proxy all SPA paths to a running `expo start --web` server (e.g. `http://localhost:8083`). `app-config.json` is still served by the plugin. |
| `internalOrigin` | `http://127.0.0.1:${PORT ?? 4000}` | Origin server renders fetch API data from, with the visitor's cookie. Never derived from `Host` or `X-Forwarded-*`. |
| `ssrApiPrefixes` | admin API base path, `/auth/me`, `/orgs`, `/jobs`, `/comms`, `/configuration`, `/rbac`, and the RBAC root for a nested admin base (`/internal/admin` adds `/internal/rbac`) | API path prefixes a server render may fetch; any other path is rejected before a request is sent, and that screen loads its data on the client. A value replaces the defaults; it is not merged. Include the admin API base path, or model screens load on the client. |

`devProxyTarget` returns before the server render is mounted: in dev there is no access gate,
no root `/_expo/loaders/*` route and no injected config. `expo start` renders the pages itself.

### Utility exports

- `rewriteIndexHtml(html, basePath)` — **Deprecated.** Rewrites absolute `/_expo/` and `/assets/` refs in a static `index.html`. The server-rendered build has no `index.html`. Removed in the next major release.
- `injectBaseGlobal(html, basePath)` — **Deprecated.** Injects `window.__ADMIN_SPA_BASE__` before `</head>`. `app/+html.tsx` now writes it into every rendered page. Removed in the next major release.
- `resolveAppConfig(overrides?)` — Merge partial config with `DEFAULT_APP_CONFIG`.
- `DEFAULT_APP_CONFIG` — Default `app-config.json` values.

## App config

`AdminSpaAppConfig` fields (from `appConfig.ts`):

| Field | Default | Description |
|-------|---------|-------------|
| `brandName` | `"Terreno Admin"` | Header brand name |
| `logoUrl` | — | Optional logo URL (absolute or relative) |
| `primaryColor` | `"#2563EB"` | Primary brand color (hex) |
| `providers` | `["email"]` | Login providers: `"email"`, `"google"`, `"github"`, `"apple"` |
| `authBasePath` | `"/api/auth"` | Better Auth routes on this origin |
| `adminApiBasePath` | `"/admin"` | Admin API base path on this origin |

## Serving and caching

**Production (no `devProxyTarget`):** `build:web` runs `expo export --platform web` with
`web.output: "server"`. It writes the export root `dist/`, and the plugin serves it like this:

| Path | Served from | `Cache-Control` |
| --- | --- | --- |
| `${basePath}/_expo/*`, `${basePath}/assets/*` | `dist/client/` (`express.static`) | `public, max-age=31536000, immutable` |
| `${basePath}/app-config.json` | the plugin's merged `appConfig` | `no-store` |
| `${basePath}` and `${basePath}/*` (pages) | rendered by `dist/server/` behind the [access gate](#access-gate) | `no-store, private` |
| `${basePath}/_expo/loaders/*` and root `/_expo/loaders/*` (loader data) | rendered by `dist/server/` behind the access gate | `no-store, private` |
| a gate denial (401/403 JSON), the gate's 503, a render error (500) | the plugin | `no-store, private` |

Pages and loader data can hold PHI, so neither may be cached or shared by a browser, proxy or
CDN. See [Server-rendering the admin SPA](../explanation/admin-spa-ssr.md) for the request
scope, `loadSsrPayload` and the escaping rules.

**Root `/_expo/loaders/*`.** Expo SDK 58's client fetches route loader data from the site root,
`/_expo/loaders/<route>`, and ignores the baked `baseUrl`. The plugin therefore also claims root
`/_expo/loaders/*` on the backend's origin, behind the same gate and headers. A second Expo
server app on the same origin would collide with it. A reverse proxy must route root
`/_expo/loaders/*` to the backend.

**No server build.** If `distDir/server/_expo/routes.json` is missing, the plugin logs a warning
suggesting `bun run --filter '@terreno/admin-spa' build:web` or `devProxyTarget`, and answers
`503 Admin SPA unavailable` on `${basePath}` and `${basePath}/*`. Assets and `app-config.json`
are still mounted. The backend keeps running.

**Development (`devProxyTarget` set):**

- `${basePath}/app-config.json` served locally (no cache).
- All other `${basePath}/*` requests proxied to the Expo dev server (WebSocket enabled). No gate
  and no root loader route are mounted.

## Access gate

`createAdminSpaGate` decides access in Express before anything renders. It gates `GET` and
`HEAD` requests for pages and loader data. It decides on the normalized path (escapes of
unreserved characters decoded, dot segments resolved) and hands Expo that same path.

For a visitor with `req.user`, it reads three things over loopback, in parallel, with the
visitor's cookie: `{authBasePath}/get-session`, `/auth/me` and `{adminApiBasePath}/config`. A
visitor without `req.user` is anonymous and costs no loopback call.

| Visitor | Page | Loader data |
| --- | --- | --- |
| Anonymous (no session, or a 401 from any read) | `/login` renders; any other page answers 302 to `${basePath}/login?returnTo=<path>` | 401 JSON, except `login` and `forbidden` |
| Forbidden (`/admin/config` answers 403) | `/login`, `/forbidden` and the signed-in-only `/oauth/consent` render; any other page answers 302 to `${basePath}/forbidden` | 403 JSON, except `login`, `forbidden` and `oauth/consent` |
| Admin (`/admin/config` answers 200) | `/login` answers 302 to a safe `returnTo` (or `${basePath}/`); `/forbidden` answers 302 to `${basePath}/`; every other page renders | renders |
| Any, when a read answers another status, fails, or takes over 5 s | 503 `Admin SPA unavailable`, nothing rendered (fails closed) | 503 |

- `returnTo` passes through `sanitizeReturnTo`: one leading `/`, no scheme, no backslash.
- A path under `${basePath}/_expo/static`, `${basePath}/assets` or `${basePath}/app-config.json`
  that is not a real file gets a 404. It never reaches the page renderer.
- Requests other than `GET` and `HEAD` are not gated.

## Loopback calls and rate limits

The gate and the route loaders read API data over HTTP from `internalOrigin`, with the
visitor's cookie. Those requests pass through the backend's rate limiter like any other, keyed
by the visitor's user id, so they count against the visitor's own `api` bucket (600 per
15 minutes by default).

| Request | Loopback calls |
| --- | --- |
| Anonymous page or loader | 0 |
| Signed-in page, gate | 3: `get-session`, `/auth/me`, `{adminApiBasePath}/config` |
| Signed-in page, loader | By screen: 1 for a model list or detail; 2 for configuration or roles; 3 for the jobs dashboard; on the home page, one per readable model for `modelStats` plus up to 3 for the other widgets |
| Signed-in page, total | 3 + the loader's calls: about 4 to 6 on most screens; on the home page it grows with the number of models |

The browser's own requests after hydration come on top. If admins hit 429s, raise
`rateLimit.limits.apiMax` on `TerrenoApp`.

## MCP OAuth consent route

`${basePath}/oauth/consent?request=<id>` is the consent screen for `@terreno/api` MCP OAuth. Set `mcpOAuth.consentUrl` to `${issuer}${basePath}/oauth/consent` on a backend that serves the SPA from the same origin.

- Any signed-in user can open it, not only admins. Admin providers (sync client, org context) do not start on this route.
- A signed-out user is sent to `${basePath}/login?returnTo=<path>` and returned after sign-in. `returnTo` must start with a single `/` and contain no `\`, scheme, whitespace, or control characters; anything else is ignored.
- The screen calls `GET /oauth/authorize/:request` and `POST /oauth/authorize/:request/approve` or `/deny` with the Better Auth session cookie, then follows `data.redirectUrl`.
- States: loading, missing `request`, expired (400), already decided (409), not found, signed out, and error. Test ids start with `admin-spa-oauth-consent-`.

## Mount path constraint

The bundle's mount path is baked in at build time from `experiments.baseUrl` in
`admin-spa/app.json` (`/console`). `basePath` must equal it. `register()` reads the baked
`baseUrl` from `dist/server/_expo/routes.json` and throws on a mismatch:

```text
Admin SPA basePath "/admin-ui" does not match the bundle's baseUrl "/console"
```

To mount elsewhere, set `experiments.baseUrl` in `admin-spa/app.json`, run `build:web`, and
pass the same value as `basePath`. `EXPO_BASE_URL=/admin-ui bun run build:web` does not change
the mount: Metro reads the base URL from the app config, not the shell. The published package
ships only the `/console` export (`files` holds `src/dist/**` and `dist/**`, not `app.json` or
`app/`), so another mount means building admin-spa from the Terreno source and pointing
`distDir` at that export root. Mounting at the site root is not supported.

## Standalone SPA vs embedded admin-frontend

Use **`@terreno/admin-spa`** when you want a complete admin UI served and server-rendered by the API process (same-origin Better Auth cookies, no separate static deploy). The backend image stays lean until you opt in by registering `AdminSpaServeApp`.

Use **`@terreno/admin-frontend`** when admin screens live inside your main Expo app (e.g. `example-frontend/app/admin/*`). You bring your own routing, auth, and deploy; the package supplies reusable list/table/form components and hooks against `/admin` CRUD routes from `@terreno/admin-backend`.
