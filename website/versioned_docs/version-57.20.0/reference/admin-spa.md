# @terreno/admin-spa

Standalone Expo Router admin web SPA plus an Express plugin (`AdminSpaServeApp`) that serves the pre-built static export from a Terreno backend on the same origin.

How screens and nav work (including `routeBase=""`): [How admin interfaces are shaped](../explanation/admin-interface.md).
How to add a screen: [Build admin screens](../how-to/build-admin-screens.md).

## Table of Contents

- [Install](#install)
- [Commands](#commands)
- [Architecture](#architecture)
- [AdminSpaServeApp](#adminspaserveapp)
- [App config](#app-config)
- [Serving and caching](#serving-and-caching)
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
bun run build:web    # Expo static export into dist/
bun run dev          # expo start --web --port 8083
bun run test:ci      # Serve-plugin unit tests
bun run smoke        # Smoke test over built dist/
bun run test:e2e     # Playwright e2e over built dist/
```

## Architecture

```
admin-spa/
  src/
    serve.ts           # AdminSpaServeApp TerrenoPlugin
    appConfig.ts       # AdminSpaAppConfig defaults + merge helper
    index.ts           # Public exports
  app/                 # Expo Router SPA (Better Auth + admin screens)
  store/               # Redux + Better Auth client
  dist/                # Pre-built static export (produced by build:web)
```

Boot flow in the SPA: `AppConfigGate` fetches `${basePath}/app-config.json` →
`StoreProvider` builds Better Auth + Redux → `AdminGate` redirects anonymous
users to `/login` and non-admins to `/forbidden` → the authorized provider reads
`/admin/config`. When config contains String-`_id` models with `adminBroadcast`
and `syncCollection`, it starts a same-origin cookie-authenticated syncdb client
with those collections in window mode and forwards `useConflicts()` to the admin.
ObjectId and non-broadcast models remain on RTK.

When the backend enables organizations, the bundled SPA exposes:

- `/orgs` — operator-only organization directory;
- `/orgs/:orgId` — organization settings;
- `/orgs/:orgId/members` — organization memberships.

`AdminSpaShell` renders `OrgSwitcher` on every admin route. The switcher and
directory use `/orgs` API routes while generic model CRUD continues under the
configured `adminApiBasePath`. Org-admins do not receive the directory link.
The default `/console` mount therefore serves these as `/console/orgs/...`.

## AdminSpaServeApp

`AdminSpaServeApp` implements `TerrenoPlugin`. Register it on `TerrenoApp` alongside `AdminApp` and auth plugins:

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

`example-backend` registers the plugin when `ADMIN_SPA_ENABLED=true`, with optional `ADMIN_SPA_DEV_PROXY` and `ADMIN_SPA_DIST_DIR` overrides.

### AdminSpaServeOptions

| Option | Default | Description |
|--------|---------|-------------|
| `basePath` | `"/console"` | URL prefix where the SPA is mounted. Admin API stays at `/admin`. |
| `appConfig` | see [App config](#app-config) | Partial config merged over defaults; served at `${basePath}/app-config.json`. |
| `distDir` | `<package>/dist` | Directory containing the pre-built static export (tests/custom builds). |
| `devProxyTarget` | — | When set, proxy all SPA paths to a running `expo start --web` server (e.g. `http://localhost:8083`). `app-config.json` is still served by the plugin. |

### Utility exports

- `rewriteIndexHtml(html, basePath)` — Rewrites absolute `/_expo/` and `/assets/` refs for sub-path mounts.
- `injectBaseGlobal(html, basePath)` — Injects `window.__ADMIN_SPA_BASE__` before `</head>`.
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

**Production (no `devProxyTarget`):**

1. `${basePath}/_expo` and `${basePath}/assets` — `express.static` with `maxAge: 365d`, `immutable: true`.
2. `${basePath}/app-config.json` — `Cache-Control: no-store`.
3. `${basePath}` and `${basePath}/*splat` — SPA fallback returns rewritten `index.html` with `Cache-Control: no-store`.

`index.html` is read once at startup; asset paths are rewritten to `${basePath}/...` and `window.__ADMIN_SPA_BASE__` is injected for deep-link config fetches.

**Development (`devProxyTarget` set):**

- `${basePath}/app-config.json` served locally (no cache).
- All other `${basePath}/*` requests proxied to the Expo dev server (WebSocket enabled).

If no bundle exists at `distDir/index.html`, the plugin logs a warning suggesting `bun run --filter '@terreno/admin-spa' build:web` or `devProxyTarget`.

## Mount path constraint

The default web export is built with `experiments.baseUrl: "/console"`, so `basePath` must match. To mount elsewhere, rebuild with a matching base (e.g. `EXPO_BASE_URL=/admin-ui bun run build:web`) and set `basePath` accordingly. Mounting at `/` requires a root-base build and `basePath: "/"`.

## Standalone SPA vs embedded admin-frontend

Use **`@terreno/admin-spa`** when you want a complete admin UI served from the API process (same-origin Better Auth cookies, no separate static deploy). The backend image stays lean until you opt in by registering `AdminSpaServeApp`.

Use **`@terreno/admin-frontend`** when admin screens live inside your main Expo app (e.g. `example-frontend/app/admin/*`). You bring your own routing, auth, and deploy; the package supplies reusable list/table/form components and hooks against `/admin` CRUD routes from `@terreno/admin-backend`.
