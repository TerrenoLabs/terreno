# @terreno/admin-spa

Opt-in admin SPA (Expo Router web app) plus an Express plugin that serves it from a Terreno backend.

Opt-in package that lets any Terreno backend server-render a pre-built admin SPA from the
same Node process — no separate static-site deploy to GCS/Netlify/Cloudflare Pages.

The default backend image stays small: React/Expo assets only ship in the npm
tarball for consumers who actually register the plugin. The embedded admin use case
(admin screens inside a consumer's main Expo app, as `example-frontend/app/admin/*`
does) remains supported and unchanged.

## What's here

- **Backend serving plugin** (`src/`, `AdminSpaServeApp`): server-renders the pre-built
  Expo Router export (`dist/client` + `dist/server`) behind an access gate, and serves a
  runtime `app-config.json`, from a Terreno backend.
- **Route loaders** (`server/`): fetch each screen's data with the visitor's cookie, so the
  first HTML holds the page and its data.
- **The SPA frontend** (`app/`, `store/`, `components/`): an Expo Router web app that
  wires `@terreno/admin-frontend`'s screens with a Better-Auth session gate. It uses the
  `@terreno/admin-frontend` `apiBase`/`routeBase` prop split so API calls go to `/admin`
  while in-app navigation stays inside the SPA.

Boot flow: the Express gate decides access and the server renders the page →
`AppConfigGate` hydrates from the config written into the page → `StoreProvider` builds the
Better-Auth client and a same-origin request client and mounts `SessionProvider` from
`@terreno/syncdb/auth` → `AdminGate` reads `useSession()` and redirects
anonymous users to `/login` and non-admins (admin API returns 403) to `/forbidden`.

## Install

```bash
bun add @terreno/admin-spa
```

`@terreno/api` is a peer dependency.

## Register with a backend

Register `BetterAuthApp` before `AdminSpaServeApp`: the gate reads `req.user`, which the
Better Auth session middleware sets.

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
| `distDir` | `<pkg>/dist` | The export root holding `client/` and `server/` (compiled binaries, custom builds, tests). |
| `devProxyTarget` | — | In dev, proxy all SPA paths to a running `expo start --web`, e.g. `http://localhost:8083`. No gate or server render is mounted. |
| `internalOrigin` | `http://127.0.0.1:${PORT ?? 4000}` | Where server renders fetch API data, with the visitor's cookie. Never taken from `Host` or `X-Forwarded-*`. |
| `ssrApiPrefixes` | admin API base, `/auth/me`, `/orgs`, `/jobs`, `/comms`, `/configuration`, `/rbac` | API prefixes a render may fetch. Replaces the defaults; keep the admin API base. |

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

| Path | `Cache-Control` |
|---|---|
| `${basePath}/_expo/*`, `${basePath}/assets/*` (from `dist/client`) | `public, max-age=31536000, immutable` |
| `${basePath}/app-config.json` | `no-store` |
| Pages under `${basePath}` and loader data at `${basePath}/_expo/loaders/*` and root `/_expo/loaders/*` | `no-store, private` |

- Pages and loader data can hold PHI. Never cache them in a proxy or CDN.
- Expo SDK 58's client fetches loader data from the site root, `/_expo/loaders/<route>`,
  ignoring the baked base URL. The plugin claims that root path too; route it to the backend.
- The gate runs before any render. Anonymous visitors get `/login` (other pages redirect to
  it; loaders answer 401). Signed-in non-admins get `/forbidden` (loaders answer 403). If a
  loopback read fails or takes over 5 s, the gate answers 503 and renders nothing.
- Each signed-in page makes 3 gate calls (`get-session`, `/auth/me`, `/admin/config`) plus its
  loader's calls to `internalOrigin` (1 to 3 on most screens; on the home page one per model plus
  up to 3), counted in the visitor's own rate-limit bucket.
- Without `dist/server`, the plugin logs a warning and answers 503 on `${basePath}/*`.
- `rewriteIndexHtml` and `injectBaseGlobal` are deprecated and will be removed in the next
  major release.

### Mount path / `baseUrl`

`app.json` sets `experiments.baseUrl: "/console"`, and that value is baked into the build.
`basePath` must equal it, or `register()` throws. To mount elsewhere, change
`experiments.baseUrl` in `app.json`, run `bun run build:web`, and set `basePath` to match.
`EXPO_BASE_URL` in the shell has no effect: Metro reads the app config. The published
package ships the `/console` build only. Mounting at the origin root is not supported.

## Develop, build, and test

```bash
bun run compile      # compile the server plugin (src/ -> src/dist, CommonJS)
bun run build:web    # produce the server export in dist/ (client/ + server/)
bun run dev          # expo start --web for local SPA development
bun run test:ci      # serve-plugin unit tests (supertest)
bun run smoke        # backend-free HTTP smoke over the built dist/ (SSR login, root loader)
bun run test:e2e     # Playwright e2e (SSR, login, shell hydration) over the built dist/
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

Upgrading from the static export: [docs/how-to/upgrade-admin-spa-ssr.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/upgrade-admin-spa-ssr.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
