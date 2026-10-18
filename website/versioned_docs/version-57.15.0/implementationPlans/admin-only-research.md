# Research: Serving Admin from a Terreno App (Opt-In, No Separate SPA Deploy)

**Status:** Complete
**Closed:** 2026-08-20 — Research incorporated into [admin-only.md](admin-only.md); shipped as `@terreno/admin-spa`.
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1075

## Summary

Terreno already has the building blocks for an admin UI — `@terreno/admin-backend` mounts `/admin/*` API routes (config, per-model CRUD, search, scripts, version-config) and `@terreno/admin-frontend` ships React Native components designed to be embedded in a consumer's Expo Router app. The gap is the **deploy surface**: today consumers either bundle admin into their main Expo app (bloats user bundles, requires ~7 route files) or build a separate Expo Web app and host it on GCS/Netlify (one more pipeline to maintain).

The right shape is a **third, opt-in package** — `@terreno/admin-spa` — that contains a complete, pre-built Expo Router web app and an Express plugin that serves the static assets. Consumers who want admin-on-the-API install it and register the plugin; consumers who want a separate frontend or embedded admin do nothing different. The pre-built bundle is shipped via npm (no React/Metro/Expo dependencies in default backend containers). Auth uses Better Auth with same-origin session cookies — no separate IdP, no token plumbing in URLs.

**Recommend static export, not SSR.** Admin is behind auth (no SEO benefit), first-paint speed doesn't matter for internal tools, and SSR drags Expo's runtime into backend containers — exactly the bloat the user wants to avoid.

## Context

### What exists today

**`@terreno/admin-backend`** (`admin-backend/src/adminApp.ts:251`):
- `AdminApp` is a `TerrenoPlugin` registered via `new TerrenoApp({...}).register(admin)`.
- Default `basePath: "/admin"`. All routes require `Permissions.IsAdmin`.
- Endpoints: `GET /admin/config`, `GET /admin/version-config`, per-model `GET/POST/PATCH/DELETE` CRUD, `GET /admin/:model/search?q=...`, script `POST /admin/scripts/:name/run` + task polling/cancel.

**`@terreno/admin-frontend`** (`admin-frontend/src/`):
- Loose React Native components (`AdminModelList`, `AdminModelTable`, `AdminModelForm`, `AdminScriptList`, `AdminVersionConfig`, `ConfigurationScreen`, `DocumentStorageBrowser`, etc.) plus hooks (`useAdminApi`, `useAdminConfig`).
- Consumer is expected to wire these into Expo Router files. The example-frontend has ~10 admin files: `app/admin/_layout.tsx`, `index.tsx`, `configuration.tsx`, `[model]/_layout.tsx`, `[model]/index.tsx`, `[model]/[id].tsx`, `[model]/create.tsx`, plus consent-form-specific screens (`example-frontend/app/admin/...`).
- Each screen passes `baseUrl="/admin"` and a generated `terrenoApi` (RTK Query). Components are **agnostic to where the consumer ran `bun run sdk` against**.

**Auth — Better Auth** (`api/src/betterAuthApp.ts`, `api/src/betterAuthSetup.ts:48`):
- `BetterAuthApp` plugin mounts routes at `basePath: "/api/auth"` by default, plus session middleware that populates `req.user` and a user-sync hook.
- Better Auth uses HTTP-only session cookies. Same-origin auto-attaches cookies; cross-origin needs `trustedOrigins` + `credentials: include`.
- Client side: `createBetterAuthClient({baseURL, basePath: "/api/auth"})` (`rtk/src/betterAuthClient.ts:91`) creates a client usable for `signIn.email`, `signIn.social`, `signUp.email`, `signOut`.
- Redux: `generateBetterAuthSlice(authClient)` (`rtk/src/betterAuthSlice.ts`) — same selectors/actions as the JWT slice. Existing admin components already use the generated RTK Query API, so this is a drop-in.

**Express server** (`api/src/expressServer.ts:181`):
- Stack: cors → optional `addMiddleware` → JSON → auth → logging → Sentry → OpenAPI → user routes → error middleware. No static file serving today.
- Plugins extend it via the `TerrenoPlugin` interface (`register(app)`). Adding a new plugin that calls `app.use(express.static(...))` + a SPA fallback is trivial — same shape as `AdminApp.register`.

**Expo Web export** (`example-frontend/app.json`, `example-frontend/package.json`):
- `web.output: "static"` + `bun expo export --platform web` produces a `dist/` directory of static HTML/JS/CSS with file-based code splitting per Expo Router route.
- Same toolchain that already runs in this repo. No new build infra.
- Base URL is read from `Constants.expoConfig?.extra?.BASE_URL` (`rtk/src/constants.ts`), falling back to `process.env.EXPO_PUBLIC_API_URL`. For same-origin deploys we want **relative paths** — needs a small change so the SPA can be told "use same origin as the page that loaded me."

### What's not there

1. No package that produces a *prebuilt admin SPA bundle* via npm.
2. No Express plugin that *serves* a prebuilt SPA + SPA fallback.
3. No same-origin base-URL story in `@terreno/rtk` — `baseUrl` always resolves from Expo config/env, never `window.location.origin`.
4. Path collision: today `/admin/*` is **all API**. If we want the SPA at `/admin`, we either need to relocate the API or mount the SPA somewhere else.

## Findings

### F1 — Path layout: where does the SPA live?

Three options. Picking one is the most important early decision because it shapes the rest of the plan.

| Layout | API path | SPA path | Pros | Cons |
|---|---|---|---|---|
| **A. SPA owns `/admin`** | `/admin/_api/*` (relocated) | `/admin/*` (HTML routes) | Pretty URLs (`/admin/users`); matches how Django admin / Rails admin URLs feel | One-time breaking change to `AdminApp.basePath` defaults; existing consumers must update `baseUrl` prop |
| **B. SPA at `/console` (or `/admin-ui`)** | `/admin/*` (unchanged) | `/console/*` | No breaking change; can ship today | Two related paths to remember; URLs less pretty |
| **C. Hybrid mount** | `/admin/*` for non-GET-HTML | `/admin/*` for `Accept: text/html` GETs | Pretty URLs without renaming | Fragile — content negotiation on URLs that look identical; debugging confusion |

**Recommendation: B for v1, A for v2.** B is non-breaking and ships fast. A is the "right" long-term shape but needs a migration of `AdminApp` defaults and the admin-frontend `baseUrl` prop. Defer until we have user feedback.

### F2 — How to ship a pre-built SPA via npm

Create `@terreno/admin-spa` package with this layout:

```
admin-spa/
  app/                       # Expo Router source
    _layout.tsx              # Provider + Better Auth gate + admin Stack
    index.tsx                # AdminModelList wrapper
    login.tsx                # SocialLoginButton + email/pw via better-auth client
    [model]/index.tsx, [id].tsx, create.tsx, _layout.tsx
    configuration.tsx
    scripts.tsx
    version-config.tsx
  store/                     # Redux + RTK Query — minimal, only admin endpoints
    sdk.ts                   # Generated SDK against admin endpoints
    index.ts                 # store wiring with generateBetterAuthSlice
  app.json                   # web.output: "static"
  package.json               # scripts: build, export
  dist/                      # Pre-built static bundle (gitignored, populated by prepublish)
  src/serve.ts               # AdminSpaServePlugin (Express plugin)
  src/index.ts
```

**Build at publish time, not install time:**
- `prepublishOnly`: `bun expo export --platform web --output-dir dist`
- The `dist/` folder ships in the npm tarball (added to `files` in package.json)
- Consumer's `npm install @terreno/admin-spa` pulls down ~1–3 MB of pre-built assets — no Metro, no Expo CLI, no React build step on consumer machines

**Why this works for Expo Router**: `expo export -p web` produces deterministic, static HTML/JS/CSS. There's no Node runtime required to serve it. We've already confirmed `example-frontend/package.json` has an `export` script using this pattern.

### F3 — Same-origin base URL (the one real change to existing packages)

The SPA is served from the same Node process as the API. So:
- Auth cookies: `SameSite=Lax` + same origin → just works, no CORS.
- API base URL: must be the page's own origin. The bundle is pre-built and reused across deploys, so we can't bake the URL in at build time.

Current `@terreno/rtk` base URL resolution (`rtk/src/constants.ts`):
1. `Constants.expoConfig?.extra?.BASE_URL`
2. `process.env.EXPO_PUBLIC_API_URL`
3. `Constants.expoConfig?.hostUri + ':3000'`
4. `http://localhost:3000`

We need a 5th tier or a way to opt into `window.location.origin`. Options:
- **Option I**: Add `BASE_URL: "__SAME_ORIGIN__"` sentinel that `rtk` interprets as `window.location.origin`. Bake the sentinel into the admin-spa `app.json`.
- **Option II**: Expose a helper `setRuntimeBaseUrl(url)` and call it from `app/_layout.tsx` before the store boots, using `window.location.origin`.
- **Option III**: Have the backend serve a `/admin-config.json` with the base URL, fetched on app boot.

**Recommendation: Option I.** Smallest surface area, no extra fetch, works with redux-persist rehydration. One ~5-line change to `rtk/src/constants.ts`.

### F4 — Auth flow for the SPA

Better Auth + same-origin is the cleanest path:

1. User visits `/console/` (or whatever path) → SPA loads.
2. SPA boots `betterAuthClient.getSession()`. Cookie is on same origin → session returns or is null.
3. If null: render login screen (email/pw and/or `SocialLoginButton` for Google/GitHub/Apple). `betterAuthClient.signIn.*` calls hit `/api/auth/*` on the same origin. Cookie is set. Reload session.
4. If session exists but `user.admin !== true`: render "403 — Admins only" instead of forwarding to admin screens. This matches how the backend gates `/admin/*` API calls.
5. Logged-in admin: render `AdminModelList`. From here, RTK Query calls flow to `/admin/*` API and Better Auth's session middleware (`api/src/betterAuthSetup.ts:103`) populates `req.user`.

Better Auth's existing `BetterAuthApp` plugin already does everything we need on the backend side. No changes to `@terreno/api`.

**One config note:** for same-origin we don't need `trustedOrigins`. For cross-origin (consumer hosts the SPA on a CDN and the API elsewhere), the consumer adds the SPA origin to `trustedOrigins` and we use `credentials: include` in fetch. This is already supported.

### F5 — Express plugin for static serving

A `TerrenoPlugin` that does:

```typescript
// admin-spa/src/serve.ts
import express from "express";
import path from "node:path";
import {fileURLToPath} from "node:url";
import type {TerrenoPlugin} from "@terreno/api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "../dist");

export interface AdminSpaServeOptions {
  basePath?: string; // default "/console"
  // Only serve to users with admin=true. Default true.
  requireAdmin?: boolean;
}

export class AdminSpaServeApp implements TerrenoPlugin {
  constructor(private opts: AdminSpaServeOptions = {}) {}

  register(app: express.Application): void {
    const basePath = this.opts.basePath ?? "/console";

    // Serve hashed JS/CSS/img assets with long cache
    app.use(`${basePath}/_expo`, express.static(path.join(DIST_DIR, "_expo"), {
      immutable: true, maxAge: "365d",
    }));
    app.use(`${basePath}/assets`, express.static(path.join(DIST_DIR, "assets"), {
      immutable: true, maxAge: "365d",
    }));

    // SPA fallback — every other GET under basePath returns index.html
    app.get(`${basePath}*`, (_req, res) => {
      res.sendFile(path.join(DIST_DIR, "index.html"));
    });
  }
}
```

A few subtle points:
- The static middleware comes **before** the SPA fallback so hashed asset URLs serve their bytes, not index.html.
- We don't put admin-auth in front of the SPA itself — non-admins get the bundle, but their `/admin/config` calls 403 and the SPA shows "Admins only." That's the right tradeoff: the bundle isn't sensitive, and gating it adds complexity (need a session-cookie-aware HTML response, which means delaying the response on auth lookup for every static request).
- Pre-compressed bundles (`.br`, `.gz`) — Expo doesn't emit these by default. We can either skip (express compression at runtime), or add a tiny prebuild step that runs `brotli` on `dist/*.{js,css}`. Defer to v2.

### F6 — Consumer DX

What the consumer writes:

```typescript
// In their server setup:
import {AdminApp} from "@terreno/admin-backend";
import {AdminSpaServeApp} from "@terreno/admin-spa/serve";
import {BetterAuthApp} from "@terreno/api";

const app = new TerrenoApp({userModel: User})
  .register(new BetterAuthApp({config: betterAuthConfig, userModel: User}))
  .register(new AdminApp({models: [...]}))           // existing API at /admin
  .register(new AdminSpaServeApp({basePath: "/console"}))  // NEW — serves SPA
  .start();
```

That's it. Visit `http://localhost:4000/console/` → admin UI. No separate deploy.

### F7 — Embedded use case (unchanged)

Consumers who want admin **inside** their Expo app continue to do what example-frontend does today: import `AdminModelList` / `AdminModelTable` / etc. from `@terreno/admin-frontend` and wire them in `app/admin/*` routes. Zero breaking change.

A nice future-iteration win: have `@terreno/admin-spa` *export* its own pre-wired Expo Router subtree as a library that can be `import("@terreno/admin-spa/routes")`-ed by the consumer's app. But that's tricky with Expo Router's file-based scanning — defer.

### F8 — SSR consideration

Expo Router supports `web.output: "server"` (SSR via the Expo runtime). Why we should **not** use it for admin:

- **No SEO benefit** — admin is behind auth, no public crawling.
- **First paint is fine** — internal/admin users, not consumer-facing.
- **Backend footprint** — SSR requires the Expo runtime (`@expo/server`, React, Metro chunks) loaded in the Node process. Multiplies backend container size and cold-start time. The whole point is to *not* ship admin code in the default backend image.
- **Static avoids deploy complexity** — a static `dist/` ships in the npm package; SSR ships compiled server code that needs Expo's runtime versions to match. Painful upgrade path.

If someone really needs SSR for an admin UI, they can fork — but it's an anti-pattern for this use case.

## Options Considered

| Option | Description | Pros | Cons | Effort |
|---|---|---|---|---|
| **1. Standalone SPA + serve plugin (recommended)** | New `@terreno/admin-spa` package: prebuilt static bundle + Express plugin to serve it. Auth via Better Auth same-origin cookies. | One opt-in install; no backend bloat for non-users; reuses all existing admin-frontend components; works for both internal ops and customer-facing | New package to maintain; one rtk change (`__SAME_ORIGIN__`); decide path layout (B = `/console`) | M — 2–3 days |
| **2. Bundle admin into `@terreno/admin-backend`** | Add `dist/` to admin-backend and serve it from `AdminApp` itself. | Single package; one fewer thing to install | Couples backend-only consumers to React bundle bytes (~1–3 MB in dist) | S, but wrong shape |
| **3. SSR via `web.output: "server"`** | Embed Expo Server runtime in the backend container; SSR each request. | First-paint speed | Backend dep on Expo runtime, large container, complex upgrades, no benefit for admin UX | L |
| **4. Higher-level `<AdminApp />` for embedded use** | Replace the 7-file embedded scaffold with a single component that internally renders Stack + routes. | Less code in consumer apps using embedded admin | Doesn't solve the "no separate deploy" ask; Expo Router can't fully express file-based routes from a single component | M |
| **5. Iframe the admin SPA into the consumer's Expo app** | Render `<WebView src="/console" />` inside the consumer app. | Truly zero coupling | Iframe UX (auth flows, deep-linking) is bad; defeats native parity | S, but wrong shape |

## Recommendation

Ship **Option 1** with the following shape:

1. New package `@terreno/admin-spa` (workspace package, published to npm).
2. Internally a complete Expo Router web app at `admin-spa/app/*` that reuses `@terreno/admin-frontend` components.
3. Better Auth via the existing `BetterAuthApp` plugin + `createBetterAuthClient` from `@terreno/rtk`. Login screen renders `SocialLoginButton` and email/pw form.
4. Builds via `bun expo export --platform web --output-dir dist` in `prepublishOnly`; `dist/` is included in the published tarball.
5. Express plugin `AdminSpaServeApp` registered on `TerrenoApp` to serve assets + SPA fallback at `/console` (configurable).
6. `@terreno/rtk` gets a tiny patch to support a `__SAME_ORIGIN__` sentinel for `BASE_URL` → resolves to `window.location.origin` at runtime.
7. **Do not** touch existing `/admin/*` API paths or the embedded admin-frontend usage.

Out of scope for v1:
- SSR (don't do it).
- Auto-renaming the API to `/admin/_api` so the SPA can own `/admin`. Revisit when consumers ask.
- A standalone-consumable Expo Router subtree for embedding into other apps (`@terreno/admin-spa/routes`).
- Pre-compressed brotli assets.
- Configurable theming pulled from the consumer's `app.json` (just use Terreno defaults).

## Open Questions

1. **Path: `/console` or `/admin-ui` or `/admin`?** I'm recommending `/console` for v1. If you'd rather take the breaking-change pain now and move the API to `/admin/_api/*`, that's option A in F1.
2. **Multi-tenant scoping**: for the "customer-facing admin" persona, do we need any tenant-aware base path (e.g., `/console/{tenantSlug}`) baked in, or do we leave that to the consumer's API/permissions?
3. **Asset cache busting**: Expo's static export hashes asset filenames but not the `index.html`. We probably want `Cache-Control: no-store` on `index.html` and immutable on `_expo/*`. Default behavior I propose is correct, but worth flagging.
4. **Theming**: should the SPA accept a small `app-config.json` (fetched on boot) for brand colors / logo / app name? Or hardcode "Terreno Admin" for v1?
5. **Bundle size budget**: any preference for tree-shaking aggressively? Today admin-frontend pulls in heavy deps (jspdf for consent PDFs, signature pad, markdown editor). If consumer doesn't use those, we may want to code-split admin into "core" and "extras".
6. **Auth fallback for non-better-auth users**: do we care about supporting the legacy JWT/Passport flow in the standalone SPA too? It's harder (token in URL? localStorage?). Recommend better-auth-only for v1.

## References

- `admin-backend/src/adminApp.ts:251` — `AdminApp` plugin (route mounting)
- `admin-frontend/src/index.tsx` — exported components
- `api/src/betterAuthApp.ts` — `BetterAuthApp` plugin
- `api/src/betterAuthSetup.ts:48` — basePath default, cookie config
- `api/src/expressServer.ts:181` — server setup; where new plugin slots in
- `rtk/src/constants.ts` — base URL resolution
- `rtk/src/betterAuthClient.ts:91` — client factory
- `example-frontend/app.json` — Expo static export config (model to follow)
- `example-frontend/app/admin/*` — example of embedded admin (unchanged path)
- Expo Router static export: https://docs.expo.dev/router/reference/static-rendering/
- Better Auth Express integration: https://www.better-auth.com/docs/integrations/express
