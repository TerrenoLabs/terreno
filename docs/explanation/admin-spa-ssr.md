# Server-rendering the admin SPA

`@terreno/admin-spa` is built with Expo Router's `web.output: "server"`. `AdminSpaServeApp`
renders each admin page inside the Terreno backend's own Express process instead of sending
one static `index.html`. The first HTML already contains the page, so an operator sees the
login form, and later the screen's data, before any JavaScript runs.

## How a request is served

1. `expo export --platform web` writes the export root `dist/`:
   - `dist/client/` holds the hashed JavaScript and assets.
   - `dist/server/_expo/` holds `routes.json`, `server/render.js` and one module per route
     `loader`.
2. `AdminSpaServeApp` serves `dist/client` under `basePath` (`/console` by default) with a
   one-year immutable cache.
3. It publishes `{appConfig, basePath}` on a process global
   (`Symbol.for("terreno.adminSpa.server")`). `render.js` and the loaders are separate bundles
   running in the same process, so the global is how they read the runtime config.
4. It mounts `expo-server`'s Express adapter at `basePath`. The adapter strips `basePath`, so
   `/console/login` matches the route pattern `^/login$`.
5. `app/+html.tsx` writes `window.__ADMIN_SPA_BASE__` and `window.__ADMIN_SPA_CONFIG__` into
   the page. `AppConfigGate` hydrates from them without fetching `app-config.json`. In dev
   proxy mode nothing is injected, so the gate fetches the config as before.
6. A route `loader` (for example `/login`'s, which returns `{appConfig}`) runs on the server.
   Its data is embedded in the page. A client-side navigation fetches it as JSON.

## Constraints from Expo SDK 58

These were found by the T1 tracer on Expo 58.0.14, expo-router 58.0.23 and expo-server
58.0.5. Each one shapes the plugin.

| Finding | Consequence |
| --- | --- |
| The client requests loader data from the site root, `/_expo/loaders/<route>`, ignoring the baked baseUrl | The plugin also routes root `/_expo/loaders/*` to the same handler. A second Expo server app on the same origin would collide with it. |
| `routes.json` is exported unsorted, and expo-server uses the first regex match. `/[model]` matches `/login` and is listed first. | The plugin passes expo-server a manifest whose HTML routes are ordered static, then dynamic, then catch-all, which is the router's own priority. Without that, every static route would render without its loader data. |
| A layout cannot read loader data: only routes have loaders | Data that every page needs (session, admin config) cannot come from a layout loader |
| The baseUrl is baked into the asset URLs at build time | `basePath` must equal the baked baseUrl (`/console` by default), or `register()` throws. For another mount, set `experiments.baseUrl` in `admin-spa/app.json` and rebuild (`EXPO_BASE_URL` in the shell has no effect: Metro reads the app config). |
| `render.js` is self-contained and loaded with a runtime `require` | It runs inside a `bun build --compile` binary with no `node_modules` next to it. `ADMIN_SPA_DIST_DIR` points the binary at the copied export root. |

## Gates while rendering

`AdminGate` still decides access on the client. While the session is loading it renders
`/login` instead of a spinner, so the server-rendered login form stays on screen. Every other
route shows the spinner until the session resolves.

## Related

- [Admin SPA reference](../reference/admin-spa.md)
- [How admin interfaces are shaped](admin-interface.md)
