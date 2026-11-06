---
category: Breaking
---

- `@terreno/admin-spa` now server-renders every admin page in the backend's Express process, behind an access gate that runs before anything renders. The first HTML holds the login form, the shell and the screen's data. Upgrade steps: [Upgrade to the server-rendered admin SPA](docs/how-to/upgrade-admin-spa-ssr.md).
- `AdminSpaServeApp`'s `distDir` (and example-backend's `ADMIN_SPA_DIST_DIR`) now names the export root, which holds `client/` and `server/`. `build:web` no longer writes `dist/index.html`. Rebuild, and copy the whole `dist` into images. Without `dist/server` the plugin answers 503 on `/console/*`.
- `basePath` must equal the `experiments.baseUrl` baked into the bundle (`/console` by default), or `register()` throws. Any other mount needs `experiments.baseUrl` set in `admin-spa/app.json` and a rebuild from source; the published package ships only the `/console` build. Mounting at the site root (`basePath: "/"`) is no longer supported.
