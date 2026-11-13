# Admin-Only: Serve Admin SPA From a Terreno Backend (Opt-In)

**Status:** Complete
**Closed:** 2026-08-20 — Shipped as `@terreno/admin-spa` (`AdminSpaServeApp`, pre-built Expo web export, Better Auth same-origin). See `admin-spa/` and `admin-only-research.md`.
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1075
**Branch:** `admin-only`
**Owner:** Josh Gachnang
**Created:** 2026-05-11

## Goal

Let any Terreno backend opt-in to serving a pre-built admin SPA from the same Node process, eliminating the need for a separate static-site deploy to GCS / Netlify / Cloudflare Pages. The default backend image stays small (no React) — admin assets only ship in the npm tarball for consumers who actually want them.

The embedded use case (admin screens inside the consumer's main Expo app, as `example-frontend/app/admin/*` does today) remains supported and unchanged.

## Non-Goals

- **SSR.** Admin is behind auth, no SEO benefit, and would drag the Expo runtime into backend containers.
- **A breaking change to existing `/admin/*` API paths.** The SPA mounts at `/console` (configurable). The `AdminApp` plugin's `basePath` default is untouched. Path consolidation onto `/admin` is a future, opt-in migration.
- **Standalone-consumable Expo Router subtree** for embedding into other apps. Deferred — complex with file-based routing.
- **Legacy JWT/Passport auth in the standalone SPA.** Better-Auth only for v1.
- **Tenant scoping in URLs** (e.g. `/console/{tenant}`). Consumer-owned via permissions.
- **Bundle splitting**, brotli precompression, custom font subsetting. Defer to v2 perf pass.

## Decisions

| Question | Decision |
|---|---|
| SPA path | `/console` (configurable via `basePath` option). Non-breaking. |
| Build | `bun expo export -p web --output-dir dist`, run in `prepublishOnly`. `dist/` ships in npm tarball. Build with **no** `experiments.baseUrl` — bundle is path-agnostic. |
| Path-agnostic SPA | `AdminSpaServeApp` rewrites absolute `/_expo/` / `/assets/` references inside `dist/index.html` to `${basePath}/_expo/` / `${basePath}/assets/` once at boot (cached). One pre-built bundle works at any `basePath`. |
| Auth | Better-Auth same-origin session cookies. Admin-spa calls `createAuthClient` from `better-auth/react` **directly** (no expo plugin — admin-spa is web-only). `basePath` passed in via app-config. |
| Base URL resolution | New `__SAME_ORIGIN__` sentinel in `@terreno/rtk`. Resolves to `window.location.origin` at runtime. Sentinel check moves to the **top** of `resolveBaseUrls` (before the `!isDev` gate). |
| Theming / branding | Runtime `GET ${basePath}/app-config.json` (absolute, not relative). Served by `AdminSpaServeApp` from constructor options. SPA fetches on boot. |
| Asset caching | `_expo/` and `assets/` directories: `Cache-Control: public, max-age=31536000, immutable`. `index.html` and `app-config.json`: `Cache-Control: no-store`. |
| Admin gate | Bundle is served to anyone; gating happens in-app (session check + `user.admin === true`). Non-admins see a "Forbidden" screen, not the login form. |
| Navigation vs API base | `@terreno/admin-frontend` is refactored to accept **two** props — `apiBase` (where the JSON lives) and `routeBase` (where navigation points). Backward-compat: `baseUrl` is kept as a deprecated alias that defaults both. The embedded case keeps passing `baseUrl="/admin"` — both ends. The standalone SPA passes `apiBase="/admin"` + `routeBase=""` so `router.push` stays inside the SPA's own root. |
| Express 5 wildcard syntax | Use `${basePath}/*splat` to match the existing convention in `api/src/betterAuthSetup.ts:215`. Register a separate `app.get(basePath, ...)` to handle the no-trailing-slash case without a redirect. |
| Dev iteration | New `bun run admin-spa:dev` script runs `bun expo start --web --port 8083`. Backend in dev mode optionally proxies `/console/*` to `:8083` when `ADMIN_SPA_DEV_PROXY=http://localhost:8083` is set. Avoids 30–60s `expo export` per change. |

## Architecture

```
                                 ┌──────────────────────────────────────────────────┐
                                 │ Consumer's Terreno backend (one Node process)    │
                                 │                                                  │
 Browser ──── GET /console/  ──▶ │  AdminSpaServeApp                                │
                                 │   └─ express.static(dist/_expo, immutable)       │
                                 │   └─ express.static(dist/assets, immutable)      │
                                 │   └─ GET /console/app-config.json  (no-store)    │
                                 │   └─ GET /console/*  → dist/index.html (no-store)│
                                 │                                                  │
 Browser ──── GET /admin/config ▶│  AdminApp           (existing, unchanged)        │
 Browser ──── POST /api/auth/* ─▶│  BetterAuthApp      (existing, unchanged)        │
                                 └──────────────────────────────────────────────────┘
```

Same-origin everywhere → session cookies attach automatically, no CORS.

## Package layout

New workspace package `admin-spa/`:

```
admin-spa/
  package.json                # bun workspace + dist/** in files
  tsconfig.json               # two tsconfigs: one for app/, one for src/
  tsconfig.server.json
  biome.jsonc
  bunfig.toml
  app.json                    # Expo config — web.output:"static", extra.BASE_URL:"__SAME_ORIGIN__"
  README.md
  metro.config.js             # if needed for workspace monorepo resolution
  babel.config.js
  openapi-config.ts           # SDK codegen pointing at admin endpoints only
  app/                        # Expo Router source (the SPA itself)
    _layout.tsx
    index.tsx                 # AdminModelList route
    login.tsx                 # Better-Auth login
    forbidden.tsx             # Non-admin landing
    configuration.tsx
    scripts.tsx
    version-config.tsx
    [model]/
      _layout.tsx
      index.tsx
      [id].tsx
      create.tsx
  store/
    index.ts                  # Redux store + persistor + better-auth slice
    sdk.ts                    # Enhanced endpoints + tags
    openApiSdk.ts             # Generated (gitignored)
  components/
    AppConfigGate.tsx         # Fetches /console/app-config.json, blocks until ready
    AdminGate.tsx             # Session check + admin check; redirects to login or forbidden
  src/                        # Backend-side code (the Express plugin)
    index.ts
    serve.ts
    appConfig.ts              # AppConfig type + defaults
    serve.test.ts
  dist/                       # Pre-built static export (gitignored, populated at publish)
```

Two TypeScript projects: `app/` + `store/` + `components/` compile against Expo's RN web tsconfig, `src/` compiles to plain Node ESM for the Express plugin.

## Files to Create / Modify

### NEW — `admin-spa/` (full package)

| File | Purpose |
|---|---|
| `admin-spa/package.json` | Workspace package. `name: "@terreno/admin-spa"`. `main: "./src/dist/index.js"` (server plugin). `exports`: `"."` → server, `"./serve"` → plugin alias, `"./dist/*"` → static bytes. `files: ["src/dist/**", "dist/**"]`. Scripts: `compile`, `dev`, `build:web`, `prepublishOnly`, `test`, `lint`. Dev deps mirror example-frontend; runtime deps are `@terreno/admin-frontend`, `@terreno/api` (peer), `@terreno/rtk`, `@terreno/ui`, `expo`, `expo-router`, `react`, `react-dom`, `react-native`, `react-native-web`, `react-redux`, `redux-persist`, `better-auth`. |
| `admin-spa/tsconfig.json` | App-side TS config (extends Expo's TS preset). |
| `admin-spa/tsconfig.server.json` | Server-side TS config for `src/*.ts` → `src/dist/*.js`. |
| `admin-spa/biome.jsonc` | Mirror `admin-frontend/biome.jsonc`. |
| `admin-spa/bunfig.toml` | Mirror `admin-frontend/bunfig.toml`. |
| `admin-spa/app.json` | Expo config. `web: {bundler: "metro", output: "static"}`, `extra: {BASE_URL: "__SAME_ORIGIN__"}`, `scheme: "terreno-admin"`. |
| `admin-spa/babel.config.js` | Match example-frontend. |
| `admin-spa/metro.config.js` | Workspace resolution for monorepo. Match example-frontend. |
| `admin-spa/openapi-config.ts` | Codegen against `http://localhost:4000/openapi.json` → `store/openApiSdk.ts`. Filtered to admin endpoints (`endpointFilter` for paths starting with `/admin`). |
| `admin-spa/app/_layout.tsx` | Root. `<Provider><PersistGate><TerrenoProvider><AppConfigGate><AdminGate><Stack/></AdminGate></AppConfigGate></TerrenoProvider></PersistGate></Provider>`. |
| `admin-spa/app/login.tsx` | Calls `authClient.signIn.email` + `<SocialLoginButton>` for each configured provider. Provider list is read from app-config.json. |
| `admin-spa/app/forbidden.tsx` | "You must be an admin to access this page." + sign-out button. |
| `admin-spa/app/index.tsx` | Wraps `<AdminModelList api={terrenoApi} baseUrl="/admin" />`. |
| `admin-spa/app/[model]/_layout.tsx` | `<Stack/>` for model sub-routes. |
| `admin-spa/app/[model]/index.tsx` | Wraps `<AdminModelTable />`. |
| `admin-spa/app/[model]/[id].tsx` | Wraps `<AdminModelForm id={id} />`. |
| `admin-spa/app/[model]/create.tsx` | Wraps `<AdminModelForm />` (no id). |
| `admin-spa/app/configuration.tsx` | Wraps `<ConfigurationScreen />`. |
| `admin-spa/app/scripts.tsx` | Wraps `<AdminScriptList />`. |
| `admin-spa/app/version-config.tsx` | Wraps `<AdminVersionConfig />`. |
| `admin-spa/store/index.ts` | `configureStore` + `generateBetterAuthSlice(authClient)` + persistor. |
| `admin-spa/store/sdk.ts` | Re-exports `openapi` with custom endpoints + tag types. |
| `admin-spa/components/AppConfigGate.tsx` | Fetches `${basePath}/app-config.json` on boot. Provides via React context. Blocks render until loaded. |
| `admin-spa/components/AdminGate.tsx` | Reads `useSelectIsAuthenticated`. If unauth → redirect to `/login`. If auth but not admin → redirect to `/forbidden`. |
| `admin-spa/src/index.ts` | Server-side entry. Exports `AdminSpaServeApp`, `AdminSpaAppConfig`. |
| `admin-spa/src/serve.ts` | `AdminSpaServeApp implements TerrenoPlugin` — see below. |
| `admin-spa/src/appConfig.ts` | `AdminSpaAppConfig` interface; default values. |
| `admin-spa/src/serve.test.ts` | Supertest-driven tests for the plugin. |
| `admin-spa/README.md` | Install, register, customize. |

### MODIFIED — existing files

| File | Change |
|---|---|
| `package.json` (root) | Add `"admin-spa"` to `workspaces` array. Add `admin-spa:*` scripts mirroring `admin-frontend:*`. |
| `rtk/src/constants.ts` | Add `SAME_ORIGIN_SENTINEL = "__SAME_ORIGIN__"`. In `resolveBaseUrls`, if `baseFromExtra === SAME_ORIGIN_SENTINEL` and `typeof window !== "undefined"`, return `baseUrl: window.location.origin` (+ `wss:` for websockets). |
| `rtk/src/constants.test.ts` | Add tests for the sentinel — both with and without `window`. |
| `example-backend/src/server.ts` | Add `.register(new AdminSpaServeApp({basePath: "/console", appConfig: {brandName: "Terreno Example", primaryColor: "#7C3AED"}}))` — gated on `process.env.ADMIN_SPA_ENABLED === "true"` so we don't force-enable in tests. |
| `example-backend/package.json` | Add `"@terreno/admin-spa": "workspace:*"` dep. |
| `CLAUDE.local.md` | Add `admin-spa/` to packages list and example commands. |
| `.claude/rules/admin-spa/00-admin-spa.md` (NEW via `rulesync`) | Package docs file for AI/dev rules — mirror `admin-frontend/00-admin-frontend.md` shape. |

## Express plugin — `AdminSpaServeApp` shape

```typescript
// admin-spa/src/serve.ts
import express from "express";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import type {TerrenoPlugin} from "@terreno/api";
import {logger} from "@terreno/api";
import type {AdminSpaAppConfig} from "./appConfig";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "../../dist"); // src/dist/ -> ../../dist

export interface AdminSpaServeOptions {
  basePath?: string;              // default "/console"
  appConfig?: AdminSpaAppConfig;  // brand name, logo URL, primary color, enabled providers
  distDir?: string;               // override for tests / custom builds
  /** In dev, proxy SPA paths to a running `expo start --web` server. e.g. "http://localhost:8083". */
  devProxyTarget?: string;
}

export class AdminSpaServeApp implements TerrenoPlugin {
  constructor(private readonly opts: AdminSpaServeOptions = {}) {}

  register(app: express.Application): void {
    const basePath = this.opts.basePath ?? "/console";
    const distDir = this.opts.distDir ?? DIST_DIR;
    const appConfig: AdminSpaAppConfig = {
      brandName: "Terreno Admin",
      primaryColor: "#2563EB",
      providers: ["email"],
      ...this.opts.appConfig,
    };

    // 0. Dev proxy short-circuit. Forwards everything under basePath to `expo start --web`.
    if (this.opts.devProxyTarget) {
      const {createProxyMiddleware} = require("http-proxy-middleware");
      app.use(basePath, createProxyMiddleware({
        target: this.opts.devProxyTarget,
        changeOrigin: true,
        pathRewrite: {[`^${basePath}`]: ""},
        ws: true,
      }));
      // app-config still served by the plugin so the dev SPA reads it from the same path.
      app.get(`${basePath}/app-config.json`, (_req, res) => {
        res.set("Cache-Control", "no-store").json(appConfig);
      });
      logger.info(`Admin SPA dev-proxied to ${this.opts.devProxyTarget} at ${basePath}/`);
      return;
    }

    // Read index.html once and rewrite absolute /_expo/ and /assets/ refs to ${basePath}/_expo/...
    // Lets the same pre-built bundle be served from any basePath without rebuilding.
    const rawIndex = fs.readFileSync(path.join(distDir, "index.html"), "utf-8");
    const indexHtml = rawIndex
      .replaceAll('href="/_expo/', `href="${basePath}/_expo/`)
      .replaceAll('src="/_expo/', `src="${basePath}/_expo/`)
      .replaceAll('href="/assets/', `href="${basePath}/assets/`)
      .replaceAll('src="/assets/', `src="${basePath}/assets/`);

    // 1. Hashed asset directories — long cache, immutable.
    const staticOpts = {immutable: true, maxAge: "365d" as const};
    app.use(`${basePath}/_expo`, express.static(path.join(distDir, "_expo"), staticOpts));
    app.use(`${basePath}/assets`, express.static(path.join(distDir, "assets"), staticOpts));

    // 2. Runtime config — never cached.
    app.get(`${basePath}/app-config.json`, (_req, res) => {
      res.set("Cache-Control", "no-store");
      res.json(appConfig);
    });

    // 3. SPA fallback. Two registrations: bare basePath (no trailing slash) AND splat. Matches
    // `api/src/betterAuthSetup.ts:215` convention (`/*name`, no braces).
    const serveSpa = (_req: express.Request, res: express.Response): void => {
      res.set("Cache-Control", "no-store").type("html").send(indexHtml);
    };
    app.get(basePath, serveSpa);
    app.get(`${basePath}/*splat`, serveSpa);

    logger.info(`Admin SPA mounted at ${basePath}/`);
  }
}
```

Path-agnostic plumbing: assets are emitted by Expo at absolute `/_expo/...` and `/assets/...`. We don't pass `experiments.baseUrl` at build time (that would bake the path into the bundle). Instead the plugin rewrites the asset URLs in `index.html` once at boot. The hashed JS files don't need rewriting because they reference each other via relative-to-bundle imports, not absolute roots. **Phase 1 acceptance must grep `dist/index.html` for `_expo` paths and confirm this assumption.** If Expo Router 6 changes asset-reference format (e.g. emits `<link rel="modulepreload" href="...">` differently), the rewrite list must grow.

Express 5 wildcard: matches the repo convention (`/*name`, no braces). Two registrations needed because `/*splat` on its own does NOT match `GET /console` without a trailing slash — Express 5 would otherwise redirect.

## Same-origin BASE_URL — `@terreno/rtk` patch

`rtk/src/constants.ts:75` currently gates `baseFromExtra` behind `!isDev`, so a naive "check sentinel at the end" patch silently breaks the sentinel in dev mode. The sentinel check must run **before** the existing branching:

```typescript
// rtk/src/constants.ts (delta)
export const SAME_ORIGIN_SENTINEL = "__SAME_ORIGIN__";

export const resolveBaseUrls = (args: {
  envApiUrl?: string;
  expoConstants: ExpoConstantsShape;
  isDev: boolean;
  // NEW — defaults to globalThis.location.origin. Injectable for tests.
  windowOrigin?: string;
}): BaseUrls => {
  const baseFromExtra = args.expoConstants.expoConfig?.extra?.BASE_URL;
  const origin =
    args.windowOrigin ??
    (typeof globalThis !== "undefined" && (globalThis as {location?: Location}).location?.origin) ??
    undefined;

  // Sentinel: resolves at runtime to window.location.origin, regardless of isDev.
  if (baseFromExtra === SAME_ORIGIN_SENTINEL && origin) {
    const wsBase = origin.replace(/^http/, "ws");
    return {baseUrl: origin, baseTasksUrl: `${origin}/tasks`, baseWebsocketsUrl: `${wsBase}/`};
  }

  // ...existing resolution unchanged (hostUri / experience / LOCALHOST fallback).
};
```

- Sentinel + native (no `window`): falls through to existing resolution. Admin SPA is web-only — this is a safety net.
- Module-level call passes `globalThis.location?.origin` with a `typeof` guard so it doesn't blow up under Bun/Jest.
- Tests in `rtk/src/constants.test.ts`: sentinel + `https://api.example.com` origin → `baseUrl/wss`; sentinel + http origin → `ws`; sentinel + no window → fallback path; sentinel + isDev=true + window → still returns the origin (regression for the `!isDev` gate); non-sentinel BASE_URL → unchanged.

## App-config endpoint

Lives at `${basePath}/app-config.json`, served by `AdminSpaServeApp`. Shape:

```typescript
// admin-spa/src/appConfig.ts
export interface AdminSpaAppConfig {
  /** Brand name shown in header (default: "Terreno Admin") */
  brandName: string;
  /** Logo asset URL (absolute or relative; optional) */
  logoUrl?: string;
  /** Primary brand color (hex). Default: "#2563EB". */
  primaryColor: string;
  /** Enabled login providers. Drives login screen rendering. */
  providers: ReadonlyArray<"email" | "google" | "github" | "apple">;
  /** Base path of the better-auth routes on this same origin. Default: "/api/auth". */
  authBasePath?: string;
  /** Base path of admin API on this same origin. Default: "/admin". */
  adminApiBasePath?: string;
}
```

The SPA fetches this on boot (`AppConfigGate`), uses it to:
- Set theme primaries.
- Conditionally render `<SocialLoginButton provider="google" />` etc. on login.
- Pass `adminApiBasePath` as `baseUrl` to admin-frontend components.
- Build the better-auth client with `basePath: appConfig.authBasePath`.

This lets one pre-built bundle work for any consumer without rebuild.

## SDK generation

`admin-spa/openapi-config.ts`:

```typescript
import type {ConfigFile} from "@rtk-query/codegen-openapi";

const config: ConfigFile = {
  apiFile: "@terreno/rtk",
  apiImport: "emptySplitApi",
  outputFile: "./store/openApiSdk.ts",
  schemaFile: "http://localhost:4000/openapi.json",
  hooks: true,
  tag: true,
  flattenArg: true,
  filterEndpoints: [/^get.+Admin/i, /^post.+Admin/i, /^patch.+Admin/i, /^delete.+Admin/i],
};
export default config;
```

The filter narrows the generated hooks to admin endpoints. We still generate the file at build time so types stay correct, but the runtime cost is bound by admin-only endpoints.

## Build / publish pipeline

`admin-spa/package.json` scripts:

```json
{
  "scripts": {
    "compile": "tsc -p tsconfig.server.json",
    "compile:watch": "tsc -p tsconfig.server.json -w",
    "build:web": "bun expo export --platform web --output-dir dist",
    "sdk": "bunx @rtk-query/codegen-openapi openapi-config.ts",
    "prepublishOnly": "bun run sdk && bun run build:web && bun run compile",
    "test": "bun test src/",
    "test:ci": "bun run test",
    "lint": "biome check ./src ./app ./store ./components",
    "lint:fix": "biome check --write ./src ./app ./store ./components"
  }
}
```

- `dist/` is gitignored; included in npm tarball via `files: ["src/dist/**", "dist/**"]`.
- `prepublishOnly` runs SDK gen, builds the SPA, compiles the server plugin. On a fresh checkout the consumer skips this — they pull a published tarball.

## Consumer DX

```typescript
import {AdminSpaServeApp} from "@terreno/admin-spa";

new TerrenoApp({userModel: User})
  .register(new BetterAuthApp({config: betterAuthConfig, userModel: User}))
  .register(new AdminApp({models: [...]}))
  .register(new AdminSpaServeApp({
    basePath: "/console",
    appConfig: {
      brandName: "Acme Admin",
      logoUrl: "/static/logo.svg",
      primaryColor: "#FF6B35",
      providers: ["email", "google"],
    },
  }))
  .start();
```

Open `https://api.acme.com/console/` → admin UI. Done.

## Phases

### Phase 0 — `@terreno/admin-frontend` API split (prerequisite — adversarial review fallout)
Before any admin-spa work: refactor `AdminModelList`, `AdminModelTable`, `AdminModelForm`, etc. to accept `apiBase` and `routeBase` separately. Existing `baseUrl` prop is kept as deprecated alias that defaults both. Embedded consumers continue to work with no changes (they pass `baseUrl="/admin"` → both become `/admin`). The standalone SPA passes `apiBase="/admin"` + `routeBase=""` so `router.push(\`${routeBase}/${modelName}\`)` stays inside the SPA root.

Tasks:
- 0.1 Add `apiBase` + `routeBase` props to each admin-frontend component that currently accepts `baseUrl`. Internally: `const resolvedApiBase = apiBase ?? baseUrl; const resolvedRouteBase = routeBase ?? baseUrl;`. Use `resolvedApiBase` everywhere data is fetched and `resolvedRouteBase` for every `router.push` / `href` call. Files: `admin-frontend/src/AdminModelList.tsx`, `AdminModelTable.tsx`, `AdminModelForm.tsx`, `AdminRefField.tsx`, `AdminScriptList.tsx`, `AdminVersionConfig.tsx`, `ConfigurationScreen.tsx`, `useAdminConfig.tsx`, `useAdminApi.ts`.
- 0.2 Update existing tests to keep using `baseUrl` (alias path) — verify backward compat.
- 0.3 Add a focused test in admin-frontend that asserts `router.push` is called with the `routeBase`-prefixed path when both props are passed independently.
- 0.4 Verify `example-frontend` (embedded admin) still compiles and renders unchanged.

### Phase 1 — Scaffold the package (foundation)
Create the empty `admin-spa/` workspace, wire it into root `package.json`, get `bun install` + `bun run compile` green. Smallest-possible Expo Router app that exports successfully.

Tasks:
- 1.1 Create `admin-spa/package.json` (runtime deps: `@terreno/admin-frontend`, `@terreno/rtk`, `@terreno/ui`, `expo`, `expo-router`, `expo-constants`, `expo-font`, `react`, `react-dom`, `react-native`, `react-native-web`, `react-native-screens`, `react-native-safe-area-context`, `react-redux`, `redux-persist`, `@reduxjs/toolkit`, `@react-native-async-storage/async-storage`, `better-auth`; peer dep `@terreno/api`; runtime dep `http-proxy-middleware` for the dev proxy; dev deps mirror `example-frontend`). Add `tsconfig.json`, `tsconfig.server.json`, `biome.jsonc`, `bunfig.toml`, `app.json` (with `web.output: "static"`, `extra.BASE_URL: "__SAME_ORIGIN__"`, **no** `experiments.baseUrl`), `babel.config.js`. **No `expo-secure-store`** — admin-spa is web-only.
- 1.2 Copy `example-frontend/metro.config.js` to `admin-spa/`, adjust `monorepoPackages` to include `@terreno/admin-frontend` (already there) and exclude `@terreno/api`, `express`, anything backend-only via `backendOnlyModules`.
- 1.3 Add `"admin-spa"` to root `workspaces`. Add `admin-spa:compile`, `admin-spa:lint`, `admin-spa:test`, `admin-spa:build`, `admin-spa:dev`, `admin-spa:sdk` scripts.
- 1.4 Stub `src/index.ts` exporting `AdminSpaServeApp` (no-op `register`). Add `"type": "module"` to `admin-spa/package.json`. Verify `tsc -p tsconfig.server.json` produces `src/dist/index.js`.
- 1.5 Stub `app/_layout.tsx` + `app/index.tsx` returning a "Hello admin" `Box`.
- 1.6 Verify `bun run --filter '@terreno/admin-spa' build:web` succeeds and outputs `dist/index.html`. **Grep `dist/index.html` for `_expo` and verify the path prefix matches what `AdminSpaServeApp` rewrites** (`/_expo/` absolute). If Expo emits a different format, expand the rewrite list in `serve.ts` before Phase 3.

### Phase 2 — Same-origin BASE_URL support (`@terreno/rtk`)
The one change to an existing package.

Tasks:
- 2.1 Add `SAME_ORIGIN_SENTINEL` export and `windowOrigin` parameter to `resolveBaseUrls` in `rtk/src/constants.ts`.
- 2.2 Wire the resolver call to read `globalThis.location?.origin`.
- 2.3 Tests: sentinel + window (http → ws, https → wss), sentinel + no window (falls back), sentinel + dev mode + window, missing sentinel (unchanged behavior).
- 2.4 Verify `bun run rtk:test` passes.

### Phase 3 — Express plugin (`AdminSpaServeApp`)
Backend-side serving + app-config endpoint. No SPA logic yet; serve a placeholder `index.html`.

Tasks:
- 3.1 Implement `src/appConfig.ts` (type + defaults).
- 3.2 Implement `src/serve.ts` with static + `app-config.json` + SPA fallback.
- 3.3 `src/serve.test.ts` — supertest cases:
  - `GET /console/` returns 200 + HTML.
  - `GET /console/users` returns 200 + same HTML (SPA fallback).
  - `GET /console/_expo/hashed-asset.js` returns 200 with immutable cache header.
  - `GET /console/app-config.json` returns 200 + provided config + `Cache-Control: no-store`.
  - `GET /console/app-config.json` returns defaults when no config passed.
  - With `basePath: "/admin-ui"` everything moves.
  - Passing a `distDir` override works (use a tmpdir with stub files).
- 3.4 `bun run admin-spa:test` passes.

### Phase 4 — App-config gate, store creation, auth gate (UI plumbing)
Ordering is critical: app-config drives the auth client config, which the Redux store depends on. So app-config must be loaded **before** the Redux Provider is mounted.

Tasks:
- 4.1 `components/AppConfigGate.tsx` — top-level component (above `<Provider>`). Fetches `${basePath}/app-config.json` using `window.location.pathname` to derive `basePath` (split on the first `/` after origin and take everything before the SPA-internal route). Falls back to the path the SPA is mounted at — exposes via a small helper. Provides config via React context, shows splash with `testID="admin-spa-app-config-loading"` while loading. Errors → retry button.
- 4.2 `components/StoreProvider.tsx` (NEW — replaces the "factory function inside child" pattern from the prior draft) — child of `AppConfigGate`. Reads `useAppConfig()`. **Inside the component body** builds:
  - `authClient = createAuthClient({baseURL: window.location.origin, basePath: appConfig.authBasePath ?? "/api/auth"})` (using `better-auth/react`'s `createAuthClient` **directly** — not the `@terreno/rtk` factory, because the Expo plugin is native-only).
  - `{betterAuthReducer, middleware, selectors} = generateBetterAuthSlice(authClient)`.
  - `store = configureStore(...)` + `persistor = persistStore(store)`.
  - Memoizes these once and renders `<Provider store={store}><PersistGate loading={<Spinner/>} persistor={persistor}>{children}</PersistGate></Provider>`. The PersistGate **must** have a `loading` prop so children don't render with empty state during rehydration (admin gate would otherwise flash login screen).
- 4.3 `components/AdminGate.tsx` — child of `StoreProvider`. Calls `authClient.getSession()` on mount. While loading → spinner with `testID="admin-spa-admin-gate-loading"`. Unauth + not on `/login` → `router.replace("/login")`. Auth + `user.admin !== true` and not on `/forbidden` → `router.replace("/forbidden")`. Auth + admin + on `/login` or `/forbidden` → `router.replace("/")`. Otherwise pass-through.
- 4.4 `app/login.tsx` — `useAppConfig().providers`. Email/password form via `authClient.signIn.email`. Per non-`"email"` provider, `<SocialLoginButton onPress={() => authClient.signIn.social({provider})}>`. On success → `router.replace("/")`.
- 4.5 `app/forbidden.tsx` — heading + sign-out button calling `authClient.signOut()` then `router.replace("/login")`.
- 4.6 `app/_layout.tsx` — final assembly order: `<AppConfigGate><StoreProvider><TerrenoProvider><AdminGate><Stack/></AdminGate></TerrenoProvider></StoreProvider></AppConfigGate>`. (`AppConfigGate` outside because we can't build the store without the config. `StoreProvider` includes `Provider` + `PersistGate`. `TerrenoProvider` is inside Provider so its theme hooks work. `AdminGate` is innermost so it has full access to Redux + persisted state.)

### Phase 5 — Wire the admin screens
Drop in the existing admin-frontend components on the right routes. **All screens now pass `apiBase={appConfig.adminApiBasePath ?? "/admin"}` and `routeBase=""`** — navigation stays inside the SPA's own `/console` root.

Tasks:
- 5.1 `app/index.tsx` — `<AdminModelList api={terrenoApi} apiBase={apiBase} routeBase={routeBase} customScreens={[]} />`. Get `apiBase`/`routeBase` from `useAppConfig()`.
- 5.2 `app/[model]/_layout.tsx`, `[model]/index.tsx`, `[model]/[id].tsx`, `[model]/create.tsx` — wire `AdminModelTable` / `AdminModelForm` using `useLocalSearchParams`. Sentinel-handle `__scripts` and `version-config` like example-frontend does — those route to `<AdminScriptList>` and `<AdminVersionConfig>` instead of the generic table.
- 5.3 `app/configuration.tsx`, `app/scripts.tsx`, `app/version-config.tsx` — wrap the corresponding `@terreno/admin-frontend` screens.
- 5.4 `app/+not-found.tsx` + `app/+html.tsx` (Expo Router conventions; `+html.tsx` carries `<meta>` viewport + favicon).

### Phase 6 — SDK glue
Most admin endpoints are injected at runtime by `admin-frontend/src/useAdminApi.ts` and `useAdminConfig.tsx` — they do NOT depend on `@rtk-query/codegen-openapi`. The codegen-filter scheme in the prior draft was theatre.

Tasks:
- 6.1 Commit a hand-written `store/sdk.ts` that re-exports `emptySplitApi as openapi` from `@terreno/rtk` and adds the tag types admin-frontend expects (`admin-models`, `admin-version-config`, `admin-scripts`, `profile`). Export a `terrenoApi` that admin-frontend components are passed.
- 6.2 Optional `openapi-config.ts` for consumers who want generated types for their **own** non-admin endpoints (useful if admin-spa is ever extended with custom screens). Default is to ship without running codegen.
- 6.3 Document the optional codegen workflow in README; do not bake it into `prepublishOnly`.

### Phase 7 — Example backend integration
Make `example-backend` demo the new flow.

Tasks:
- 7.1 Add dep to `example-backend/package.json`.
- 7.2 Register `AdminSpaServeApp` in `example-backend/src/server.ts`, gated on `ADMIN_SPA_ENABLED=true`.
- 7.3 Manual smoke test:
  - Start backend with `ADMIN_SPA_ENABLED=true AUTH_PROVIDER=better-auth`.
  - Visit `http://localhost:4000/console/` → login screen.
  - Sign in with admin user → admin list shown.
  - Click "Users" → users table loads from `/admin/users`.
  - Click a user → form loads, edit, save, see toast.
  - Verify `app-config.json` is served and bundle is cached.

### Phase 8 — Docs, rules, CI
Update repo-level docs and the publish pipeline.

Tasks:
- 8.1 `admin-spa/README.md`.
- 8.2 Author `.claude/rules/admin-spa/00-admin-spa.md`. Run `bun run rules` to regenerate rulesync artifacts. Verify `bun run rules:check` passes in the same PR.
- 8.3 Add `admin-spa:*` to `CLAUDE.local.md`.
- 8.4 "Standalone admin SPA" subsection in `admin-backend/README.md` pointing at admin-spa.
- 8.5 **Add an `admin-spa` publish job to `.github/workflows/publish-on-tag.yml`** mirroring the existing 8 publish jobs but running `bun run --filter '@terreno/admin-spa' build:web` (and `compile`) before `bun publish` so the `dist/` directory is populated in the tarball. Without this, tagged releases will publish an empty `dist/`.
- 8.6 Add a CI smoke job (separate workflow or extension of existing E2E): boot `example-backend` with `ADMIN_SPA_ENABLED=true AUTH_PROVIDER=better-auth` and `bun run --filter '@terreno/admin-spa' build:web`; curl `/console/`, `/console/app-config.json`, and one `/console/_expo/static/js/web/*.js` asset; assert 200s with correct cache headers. Catches the path-rewrite logic in CI.

### Phase 9 — E2E (optional, only if Phase 7 looks shaky)
Playwright test that exercises the full flow against example-backend. Spec: `e2e/admin-spa.spec.ts`. testIDs to add: `admin-spa-login-email`, `admin-spa-login-submit`, `admin-spa-model-list-screen`, `admin-spa-users-row-{id}`. Defer if Phase 7 manual smoke is sufficient.

## Files needing testIDs (added during Phase 4/5)

| Component | testID |
|---|---|
| `AppConfigGate` loading screen | `admin-spa-app-config-loading` |
| `AdminGate` loading screen | `admin-spa-admin-gate-loading` |
| `login.tsx` email input | `admin-spa-login-email` |
| `login.tsx` password input | `admin-spa-login-password` |
| `login.tsx` submit button | `admin-spa-login-submit` |
| `login.tsx` per-provider button | `admin-spa-login-{provider}` |
| `forbidden.tsx` root | `admin-spa-forbidden-screen` |
| `forbidden.tsx` sign-out button | `admin-spa-forbidden-signout` |
| `app/index.tsx` root | `admin-spa-model-list-screen` |

Existing `@terreno/admin-frontend` components already expose their own testIDs (verified in `admin-frontend/src/AdminModelList.test.tsx`).

## Risks

| Risk | Mitigation |
|---|---|
| **`baseUrl` overload in admin-frontend** — `AdminModelList.tsx:129`, `AdminModelTable.tsx:126,222,314` use `baseUrl` BOTH as API path AND as navigation path. SPA-at-`/console` + API-at-`/admin` breaks navigation. | Phase 0 splits the prop into `apiBase` + `routeBase` with `baseUrl` as a deprecated alias defaulting both. Embedded consumers unchanged. |
| **`createBetterAuthClient` has no `basePath` param** — only takes `baseURL`/`scheme`/`storagePrefix`. Prior draft of Task 4.2 wouldn't compile. | Admin-spa is web-only, so we call `createAuthClient` from `better-auth/react` **directly** (no expo plugin) and pass `basePath` as a top-level option. |
| **Expo `experiments.baseUrl` would make the bundle path-specific** — baking `/console` into the build means the configurable `basePath` is fiction. | Don't pass `experiments.baseUrl`. The `AdminSpaServeApp` rewrites the absolute `/_expo/` and `/assets/` URLs in `index.html` once at boot to match the configured `basePath`. One pre-built tarball works at any path. Phase 1.6 verifies the rewrite list covers all generated references. |
| **Expo Router web export breaks under monorepo** (Metro resolution of workspace deps) | Copy `example-frontend/metro.config.js` and its `extraNodeModules`, `nodeModulesPaths`, `unstable_enableSymlinks` settings. Phase 1.2 explicitly clones the file. |
| **Express 5 wildcard syntax** — Express 5 ships path-to-regexp v8; bare `*` is gone. | Use `${basePath}/*splat` (named splat, no braces) to match `api/src/betterAuthSetup.ts:215`. Register a separate `app.get(basePath, ...)` for the no-trailing-slash case to avoid a redirect. AC3 tests both `GET /console` and `GET /console/`. |
| **`!isDev` gate in `rtk/src/constants.ts:75`** silently kills the sentinel in dev mode. | Move the sentinel check to the top of `resolveBaseUrls`, before any branching. Test for `isDev=true + sentinel + window` returning origin. |
| **PersistGate hydration races AdminGate** — store starts empty → AdminGate runs → flashes login screen → rehydration completes. | `PersistGate` gets a `loading={<Spinner/>}` prop so children don't render until rehydration is done. Phase 4.2 codifies this. |
| **`app-config.json` fetched relative breaks on deep refresh** — from `/console/users/abc`, `./app-config.json` becomes `/console/users/app-config.json` → falls through to SPA fallback → returns HTML → JSON.parse error. | Use an absolute `${basePath}/app-config.json` URL, derived by `AppConfigGate` from `window.location.pathname` at the SPA root. |
| **`createBetterAuthClient` Expo plugin** stores tokens in SecureStore on native; web variant uses AsyncStorage; both go through the RN-targeted factory. The admin-spa is web-only and using the factory drags `expo-secure-store` into the bundle for no reason. | Call `createAuthClient` from `better-auth/react` directly in admin-spa; rely on better-auth's built-in browser session cookies (no client-side token storage needed). |
| **Auth cookie SameSite / Secure flags** — production HTTPS only. | Same-origin → `SameSite=Lax` default works for both http://localhost and HTTPS. Document. |
| **Cookie `Path=/` from better-auth** — verify the session cookie set at `/api/auth/login` is sent to `/admin/*` and `/console/*` requests on the same origin. Default is `Path=/`; assumed correct but not verified against `betterAuthSetup.ts:73-89`. | Phase 7.3 manual smoke verifies; add a `supertest` regression in `betterAuthSetup.test.ts` if it bites. |
| **Stale `index.html` at the edge** after a redeploy | Plugin returns `Cache-Control: no-store` on HTML and `app-config.json`. CDN/proxy may still cache — document. |
| **Bundle size** — admin-frontend pulls in jspdf, signature-canvas, markdown editor. Plan's "1–3 MB gzip" estimate is unverified. | Measure in Phase 1.6. If > 5 MB gzip, code-split deferred imports (`AdminScriptRunModal`, `ConsentFormEditor`, etc.) via React.lazy or Expo Router's per-route splitting. |
| **`Constants.expoConfig?.extra?.BASE_URL` propagation in static export** — assumed yes, not verified. | Phase 1.6 adds: `bun run admin-spa:build` then `grep -r '__SAME_ORIGIN__' admin-spa/dist/` — must find the sentinel string in at least one bundle JS file. If not, switch to a different injection mechanism (e.g. `<script>window.__ADMIN_BASE__ = "${origin}"</script>` injected by the plugin). |
| **CI publish job missing for admin-spa** | Phase 8.5 adds it to `.github/workflows/publish-on-tag.yml`. |
| **No dev iteration story** — re-exporting on every change is 30–60s. | Phase 4 + serve plugin support a `devProxyTarget` option. Dev workflow: run `bun run admin-spa:dev` (= `bun expo start --web --port 8083`) + `ADMIN_SPA_DEV_PROXY=http://localhost:8083 bun run backend:dev`. |
| **`@rtk-query/codegen-openapi` filter regex was theatre** — admin endpoints are injected at runtime by `useAdminApi.ts:47-104`, not generated. | Phase 6 drops the codegen filter; ships a hand-written `store/sdk.ts` instead. Optional codegen is documented but not part of the build. |
| **`bun pm ls | grep` heuristic for AC9** is unreliable (transitive deps from other workspace packages can pollute results). | AC9 verifies by reading the consumer's resolved lockfile / running `bun install` in a stripped-down test fixture without `admin-spa` and confirming no `react-native-web` or `expo-router` entries. |

## Acceptance Criteria

Each criterion lists: **Setup**, **Steps**, **Expected**, and (where relevant) **testIDs** needed for automated runs.

### AC1 — Static export builds clean (automated)
- **Setup:** Phase 1 + 4 + 5 complete. `bun install` done.
- **Steps:** Run `bun run --filter '@terreno/admin-spa' build:web` from repo root.
- **Expected:** Exit code 0. `admin-spa/dist/index.html` exists and is non-empty. `admin-spa/dist/_expo/static/js/web/` contains at least one bundled `.js` file. No `error:` lines in output. No `Cannot find module` warnings.

### AC2 — Same-origin BASE_URL sentinel works (automated)
- **Setup:** Phase 2 complete.
- **Steps:** Run `bun run rtk:test`.
- **Expected:** Existing tests pass. New cases pass: sentinel + `https` origin → `baseUrl: "https://api.example.com"`, `baseWebsocketsUrl: "wss://api.example.com/"`; sentinel + `http` origin → `ws://...`; sentinel + no window → falls back to existing localhost resolution; non-sentinel BASE_URL → unchanged behavior.

### AC3 — Plugin serves bundle and config (automated)
- **Setup:** Phase 3 complete.
- **Steps:** Run `bun run --filter '@terreno/admin-spa' test`.
- **Expected:** Supertest cases pass: `GET /console/` → 200 + HTML + `Cache-Control: no-store`; `GET /console/users/abc` → same HTML; `GET /console/_expo/static/js/web/foo.abc123.js` → 200 + `Cache-Control: public, max-age=31536000, immutable`; `GET /console/app-config.json` → 200 + JSON + `Cache-Control: no-store`; defaults returned when no `appConfig` passed; provided `appConfig` overrides defaults field-by-field; custom `basePath` works; `GET /unrelated` → 404.

### AC4 — Anonymous user lands on login (manual + E2E)
- **Setup:** Backend running with `ADMIN_SPA_ENABLED=true AUTH_PROVIDER=better-auth`. SPA built.
- **Steps:** Open browser to `http://localhost:4000/console/` in a fresh incognito window.
- **Expected:** No flash of admin content. Login screen renders. Brand name from `app-config.json` is visible. Email + password fields present. URL navigates to `/console/login` after redirect.
- **testIDs:** `admin-spa-login-email`, `admin-spa-login-password`, `admin-spa-login-submit`.

### AC5 — Email/password sign-in succeeds for admin (manual + E2E)
- **Setup:** Same as AC4. An admin user (`admin: true`) exists in DB.
- **Steps:** Fill email + password. Click sign in.
- **Expected:** Loading spinner during request. On success, redirects to `/console/`. Admin model list renders. `app-config.json` brand name appears in header. No console errors.
- **testIDs:** `admin-spa-model-list-screen` after login.

### AC6 — Non-admin user is forbidden (manual + E2E)
- **Setup:** A user with `admin: false` exists.
- **Steps:** Sign in as that user.
- **Expected:** No admin model list shown. URL becomes `/console/forbidden`. "Admins only" message + sign-out button visible.
- **testIDs:** `admin-spa-forbidden-screen`, `admin-spa-forbidden-signout`.

### AC7 — CRUD round-trip on a model (manual)
- **Setup:** Logged in as admin. At least one User exists.
- **Steps:** From the model list, click "Users". Click a row. Edit the `name` field. Click save.
- **Expected:** Form opens with current values. Saving shows success toast. Navigating back to the table reflects the new value. Page reload preserves the change (server-confirmed).

### AC8 — Embedded admin still works (manual regression)
- **Setup:** `example-frontend` running locally (`bun run frontend:web`) against the example-backend.
- **Steps:** Log in as admin in the main app. Navigate to the existing `/admin` route inside the main Expo app.
- **Expected:** No regression — the embedded admin screens render identically to before this branch. (Spot-check the model list, a model table, and a form.)

### AC9 — Backend image stays small when admin-spa is not installed (manual / inspection)
- **Setup:** A fresh consumer project that depends on `@terreno/api` but not `@terreno/admin-spa`.
- **Steps:** `bun install`. Inspect `node_modules` for `react`, `react-dom`, `react-native-web`, `expo`, `expo-router`.
- **Expected:** None of those packages appear in the consumer's resolved deps. (Verified by `bun pm ls 2>&1 | grep -E 'react-native-web|expo-router'` returning empty.)

### AC10 — Default app-config returned when none provided (automated)
- **Setup:** Plugin registered with no `appConfig` argument.
- **Steps:** `GET /console/app-config.json`.
- **Expected:** Returns `{brandName: "Terreno Admin", primaryColor: "#2563EB", providers: ["email"]}` (plus optional fields undefined).

### AC11 — Provider list drives login UI (manual + E2E)
- **Setup:** Plugin registered with `appConfig: {providers: ["email", "google"]}`.
- **Steps:** Open login screen.
- **Expected:** Email/password form + a Google `<SocialLoginButton>`. No GitHub or Apple buttons. With `providers: ["email", "google", "github", "apple"]`, all three social buttons render.
- **testIDs:** `admin-spa-login-google`, `admin-spa-login-github`, `admin-spa-login-apple`.

### AC12 — Sign-out clears session and returns to login (manual)
- **Setup:** Logged in as admin, on model list screen.
- **Steps:** Trigger sign-out (from the header menu or `/console/forbidden` if testing non-admin).
- **Expected:** Session cookie cleared. Redirects to `/console/login`. Hitting `/console/` directly afterwards re-routes to login. (Verified by clearing devtools `Application > Cookies` shows the better-auth session cookie removed.)

## Review Log (2026-05-11 / 2026-05-12)

Adversarial review (Opus, fallback after codex CLI hit 401) found 5 verified CRITICAL issues against an earlier draft. All have been folded back into the plan above:

1. **`baseUrl` is overloaded as nav + API in admin-frontend.** Verified at `AdminModelList.tsx:129`, `AdminModelTable.tsx:126,222,314`. → Added **Phase 0**: split `baseUrl` into `apiBase` + `routeBase`, with backward-compat alias.
2. **`createBetterAuthClient` has no `basePath` prop.** Verified at `rtk/src/betterAuthClient.ts:91-105` + `betterAuthTypes.ts`. → Plan now uses `createAuthClient` from `better-auth/react` **directly** in admin-spa (web-only, no expo plugin).
3. **Express 5 wildcard syntax was invented** (`{/*splat}`). Repo convention is `/*name` per `betterAuthSetup.ts:215`. → Updated `AdminSpaServeApp` to use `${basePath}/*splat` + a separate `app.get(basePath, ...)` for the no-slash case.
4. **Expo Router emits absolute `/_expo/...` paths** in `dist/index.html` — without `experiments.baseUrl` they 404 when mounted at `/console`; WITH `experiments.baseUrl` the bundle becomes path-specific (contradicting "one tarball, any path"). → Don't pass `experiments.baseUrl`; have the plugin rewrite `/_expo/` and `/assets/` in `index.html` at boot.
5. **`rtk/src/constants.ts:75` gates `baseFromExtra` behind `!isDev`** — sentinel would be silently dead in dev. → Sentinel check moves to the **top** of `resolveBaseUrls`, before all branching.

Also folded in HIGH/MEDIUM findings:
- Codegen `filterEndpoints` regex was theatre (admin endpoints are injected at runtime). Phase 6 now ships a hand-written sdk.ts.
- PersistGate needs an explicit `loading` prop or AdminGate flashes login screen. Phase 4.2 codifies this.
- `app-config.json` fetched with a relative URL breaks on deep refresh. Use absolute `${basePath}/app-config.json`.
- Provider order: AppConfigGate must be **outside** Provider (the store is built using config). Phase 4 reorders.
- Missing CI publish job → Phase 8.5.
- Missing dev iteration story → `devProxyTarget` option + `admin-spa:dev` script.
- Missing deps in package.json (`better-auth`, `@react-native-async-storage/async-storage`, `http-proxy-middleware`) — Task 1.1 enumerated.
- `metro.config.js` workspace setup must be cloned from `example-frontend`, not handwaved — Task 1.2 explicit.

## Out of Scope (Future Work)

- Path consolidation: SPA at `/admin`, API moved to `/admin/_api/*`. One-time breaking change.
- Embeddable Expo Router subtree (`@terreno/admin-spa/routes`) for consumers wanting to drop admin into their main app without 7 wrapper files.
- Multi-bundle per-tenant theming (`/console/{tenantSlug}` with tenant-aware app-config).
- Brotli/gzip precompression of static assets.
- Service worker for offline / PWA support.
- JWT/Passport fallback in standalone SPA.
- Custom field renderer plugin system.
