# @terreno/admin-spa

Opt-in admin SPA (Expo Router web app) plus an Express plugin that serves it from a Terreno backend.

Opt-in package that lets any Terreno backend serve a pre-built admin SPA from the
same Node process — no separate static-site deploy to GCS/Netlify/Cloudflare Pages.

The default backend image stays small: React/Expo assets only ship in the npm
tarball for consumers who actually register the plugin. The embedded admin use case
(admin screens inside a consumer's main Expo app, as `example-frontend/app/admin/*`
does) remains supported and unchanged.

## What's here

- **Backend serving plugin** (`src/`, `AdminSpaServeApp`): serves the pre-built Expo
  Router static export (`dist/`) and a runtime `app-config.json` from a Terreno backend.
- **The SPA frontend** (`app/`, `store/`, `components/`): an Expo Router web app that
  wires `@terreno/admin-frontend`'s screens with a Better-Auth session gate. It uses the
  `@terreno/admin-frontend` `apiBase`/`routeBase` prop split so API calls go to `/admin`
  while in-app navigation stays inside the SPA.

Boot flow: `AppConfigGate` fetches `app-config.json` → `StoreProvider` builds the
Better-Auth client + Redux store → `AdminGate` syncs the session and redirects
anonymous users to `/login` and non-admins (admin API returns 403) to `/forbidden`.

## Install

```bash
bun add @terreno/admin-spa
```

`@terreno/api` is a peer dependency.

## Register with a backend

```typescript
import {AdminSpaServeApp} from "@terreno/admin-spa";
import {AdminApp} from "@terreno/admin-backend";
import {BetterAuthApp, TerrenoApp} from "@terreno/api";

new TerrenoApp({userModel: User})
  .register(new BetterAuthApp({config: betterAuthConfig, userModel: User}))
  .register(new AdminApp({models: [...]}))
  .register(
    new AdminSpaServeApp({
      basePath: "/console", // default; non-breaking with the /admin API
      appConfig: {
        brandName: "Acme Admin",
        logoUrl: "/static/logo.svg",
        primaryColor: "#FF6B35",
        providers: ["email", "google"],
      },
    })
  )
  .start();
```

Open `https://api.acme.com/console/` → admin UI. Same-origin → Better-Auth session
cookies attach automatically, no CORS.

## Options (`AdminSpaServeOptions`)

| Option | Default | Description |
|---|---|---|
| `basePath` | `/console` | Path the SPA mounts at. The `/admin` API is untouched. |
| `appConfig` | see below | Runtime config served at `${basePath}/app-config.json`. Merged over defaults. |
| `distDir` | `<pkg>/dist` | Override the pre-built bundle directory (tests / custom builds). |
| `devProxyTarget` | — | In dev, proxy all SPA paths to a running `expo start --web`, e.g. `http://localhost:8083`. |

### App config

`app-config.json` lets a single pre-built bundle be themed and pointed at the right
auth/admin API paths per consumer without rebuilding. Defaults:

```typescript
{
  brandName: "Terreno Admin",
  primaryColor: "#2563EB",
  providers: ["email"],
  authBasePath: "/api/auth",
  adminApiBasePath: "/admin",
}
```

## How serving works

- `${basePath}/_expo` and `${basePath}/assets` are served with
  `Cache-Control: public, max-age=31536000, immutable`.
- `${basePath}/app-config.json` and `index.html` are served with
  `Cache-Control: no-store`.
- `index.html`'s absolute `/_expo/` and `/assets/` references are rewritten once at
  boot to `${basePath}/...` (a no-op when the bundle was already built for that base).
- The serve plugin injects `window.__ADMIN_SPA_BASE__ = "${basePath}"` into `index.html`
  so the SPA can resolve `app-config.json` on deep refreshes.
- SPA fallback: both the bare `${basePath}` and `${basePath}/*splat` return
  `index.html` (Express 5 named-splat convention).

### Mount path / `baseUrl`

Client-side routing under a sub-path requires the bundle to be built with a matching
router base. `app.json` sets `experiments.baseUrl: "/console"`, so the default build is
served at `/console` and `basePath` must match. To mount elsewhere, rebuild with the
matching base (e.g. `EXPO_BASE_URL=/admin-ui bun run build:web`) and set `basePath`
accordingly. Mounting at the origin root (`basePath: "/"`) needs no base.

## Develop, build, and test

```bash
bun run compile      # compile the server plugin (src/ -> src/dist, CommonJS)
bun run build:web    # produce the static export in dist/
bun run dev          # expo start --web for local SPA development
bun run test:ci      # serve-plugin unit tests (supertest)
bun run smoke        # backend-free smoke over the built dist/
bun run test:e2e     # Playwright e2e (anonymous -> login) over the built dist/
```

`dist/` is produced by `bun run build:web` and shipped via
`files: ["src/dist/**", "dist/**"]`. The `publish-on-tag` CI job runs both the server
compile and the web export before `npm publish`, so the published tarball's `dist/` is
populated.

## Comparison with embedded admin-frontend

| | Standalone SPA (`@terreno/admin-spa`) | Embedded (`@terreno/admin-frontend`) |
|---|---|---|
| Deploy | Served by the API process at `/console` | Bundled into the consumer's Expo app |
| Backend footprint | Opt-in; no React in default image | n/a |
| Auth | Better-Auth same-origin cookies | Consumer's existing auth |

## Documentation

Full API reference: [docs/reference/admin-spa.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/admin-spa.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
