# How to upgrade to the server-rendered admin SPA

`@terreno/admin-spa` now server-renders every admin page in the backend's Express process.
The first HTML holds the login form, the shell and the screen's data. The upgrade changes the
build output, the mount path rules and what a proxy may cache:

| Concern | Static export | Server-rendered |
| --- | --- | --- |
| `build:web` output | `dist/index.html` + assets | `dist/client/` (assets) + `dist/server/` (render and loaders) |
| `distDir` / `ADMIN_SPA_DIST_DIR` | the folder with `index.html` | the export root, holding `client/` and `server/` |
| Mount path | any `basePath`, rewritten at boot | only the baked `experiments.baseUrl` (`/console`); anything else throws |
| Access check | in the browser, after load | in Express, before anything renders |
| Paths on the origin | `${basePath}/*` | `${basePath}/*` and root `/_expo/loaders/*` |
| HTML caching | `no-store` | `no-store, private` on pages and loader data |

Work through the steps in order. The behavior behind each step is in the
[admin SPA reference](../reference/admin-spa.md) and
[Server-rendering the admin SPA](../explanation/admin-spa-ssr.md).

## 1. Check the registration order

The gate reads `req.user`, which the Better Auth session middleware sets. Register
`BetterAuthApp` before `AdminSpaServeApp`, or every visitor is treated as anonymous:

```typescript
new TerrenoApp({userModel: User})
  .register(new BetterAuthApp({config: betterAuthConfig, userModel: User}))
  .register(new AdminApp({models: [...]}))
  .register(new AdminSpaServeApp({appConfig: {brandName: "Acme Admin"}}))
  .start();
```

## 2. Rebuild the export

```bash
bun run --filter '@terreno/admin-spa' compile
bun run --filter '@terreno/admin-spa' build:web
ls admin-spa/dist   # client  server
```

An old `dist/` with only `index.html` makes the plugin log a warning and answer 503 on
`/console/*`. Consumers of the published package get the new layout in the tarball.

## 3. Keep `/console`, or rebuild for another mount

`basePath` must equal the `experiments.baseUrl` baked into the build. The default is
`/console`. On a mismatch `register()` throws:

```text
Admin SPA basePath "/admin-ui" does not match the bundle's baseUrl "/console"
```

- **Default mount:** pass no `basePath`, or `basePath: "/console"`. Nothing else to do.
- **Another mount:** the published package ships only the `/console` build. Build admin-spa
  from the Terreno source (or your fork): set `experiments.baseUrl` in `admin-spa/app.json`,
  run `build:web`, pass the same value as `basePath`, and point `distDir` (or
  `ADMIN_SPA_DIST_DIR`) at that export root.

`EXPO_BASE_URL=/admin-ui bun run build:web` does not change the mount: Metro reads the app
config. Mounting at the site root is not supported.

## 4. Copy the whole export root into the image

A compiled backend (`bun build --compile`) cannot find the bundle next to its own code. Copy
all of `dist`, not `dist/client`, and point `ADMIN_SPA_DIST_DIR` at it:

```dockerfile
COPY --from=builder /app/admin-spa/dist ./admin-spa-dist
ENV ADMIN_SPA_DIST_DIR=/app/admin-spa-dist
```

Pass it through to the plugin:

```typescript
new AdminSpaServeApp({distDir: process.env.ADMIN_SPA_DIST_DIR});
```

`example-backend/Dockerfile` does exactly this. Check it: `curl -s
localhost:3000/console/login` returns HTML with your brand name, and `curl -si
localhost:3000/_expo/loaders/login` returns 200 JSON with `Cache-Control: no-store, private`.

## 5. Set `internalOrigin` if the backend is not at `127.0.0.1:$PORT`

The gate and the loaders fetch API data from this backend over HTTP, with the visitor's
cookie. The default origin is `http://127.0.0.1:${PORT ?? 4000}`. Set `internalOrigin` when
that address does not reach the API, for example when:

- the process listens on another interface or a port not in `PORT`;
- the API is only reachable through a local proxy or sidecar.

```typescript
new AdminSpaServeApp({internalOrigin: "http://127.0.0.1:8080"});
```

The origin is never taken from `Host` or `X-Forwarded-*`. A wrong origin makes the gate fail
closed: every signed-in page answers 503.

## 6. Update reverse-proxy and CDN rules

Pages and loader data can hold PHI.

| Path | Rule |
| --- | --- |
| `/console/*` HTML | Never cache. Pass `Cache-Control: no-store, private` through. |
| `/console/_expo/loaders/*` | Never cache. |
| `/_expo/loaders/*` (site root) | Route to the backend. Never cache. |
| `/console/_expo/static/*`, `/console/assets/*` | Cache freely (hashed, immutable). |
| `/console/app-config.json` | Do not cache (`no-store`). |

The root `/_expo/loaders/*` route exists because Expo SDK 58's client fetches loader data from
the site root, ignoring the baked base URL. If the origin already serves another Expo server
app, the two collide on that path.

## 7. Check `ssrApiPrefixes` overrides

A server render may fetch only API paths under `ssrApiPrefixes`. The default covers the admin
API base path, `/auth/me`, `/orgs`, `/jobs`, `/comms`, `/configuration` and `/rbac`. Most apps
need no override. If you pass one, it replaces the defaults, so include the admin API base
path:

```typescript
new AdminSpaServeApp({ssrApiPrefixes: ["/admin", "/auth/me", "/jobs", "/billing"]});
```

A screen whose URLs fall outside the list still works: it loads its data in the browser.

## 8. Watch admin rate limits

Each signed-in page makes 3 gate calls (`get-session`, `/auth/me`, `/admin/config`) plus its
loader's calls over loopback: 1 to 3 on most screens, and on the home page one per model for the
models widget plus up to 3 more. They count against the admin's own `api` rate-limit
bucket (600 per 15 minutes by default). If admins hit 429s, raise
`rateLimit.limits.apiMax` on `TerrenoApp`.

## 9. Drop the deprecated helpers

`rewriteIndexHtml` and `injectBaseGlobal` still export, but the server-rendered build has no
`index.html` for them to change. They are removed in the next major release. Delete any calls.
