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
3. It publishes `{appConfig, basePath, internalOrigin, ssrApiPrefixes}` on a process global
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
| Expo exports a `pageHeaders` rule that sets `Cache-Control: no-store` on every loader response, applied after Express middleware | The plugin rewrites that rule to `no-store, private` when it prepares the manifest. A header set in Express alone would be overwritten. |
| `render.js` is self-contained and loaded with a runtime `require` | It runs inside a `bun build --compile` binary with no `node_modules` next to it. `ADMIN_SPA_DIST_DIR` points the binary at the copied export root. |

## Request scope and server-side data

Each server render runs inside a request scope: one `AsyncLocalStorage`, shared by every
bundle in the process through `Symbol.for("terreno.adminSpa.requestStore")`.
`runInAdminSpaRequest(scope, fn)` sets it, and `getAdminSpaRequest()` reads it in `render.js`,
`+html.tsx` and the loaders. The plugin opens a base scope (`appConfig`, `basePath`) for every
render; middleware that opened one earlier keeps its own. Two concurrent renders never see each
other's scope, so data loaded for one operator cannot reach another's page.

A loader fetches the API data a screen needs with `loadSsrPayload(request, {requests})`:

- Each request is a path plus query (route params already `encodeURIComponent`-encoded) and,
  optionally, `X-Organization-Id`. Any other header is rejected with `SSR header not allowed`.
- The path is normalized first (dot segments resolved, encoded segments kept encoded) and must
  start with one of `ssrApiPrefixes`: by default the admin API base path, `/auth/me`, `/orgs`,
  `/jobs`, `/comms`, `/configuration` and `/rbac`. Anything else, including an absolute URL, is
  rejected with `SSR path not allowed`. Every request is checked before any is sent.
- Requests go in parallel to `internalOrigin` (default `http://127.0.0.1:${PORT ?? 4000}`)
  with only the visitor's `Cookie`. The origin never comes from `Host` or `X-Forwarded-*`.
- A visitor with no cookie fetches nothing, so anonymous traffic never shares the loopback
  address's rate-limit bucket.
- The result is `{rpc, status}`, keyed by `adminRpcSeedKey(url, headers)` from
  `@terreno/admin-frontend`, ready for `AdminRpcSeed`. A failed read has a status and no body.
- A transport failure or a 2xx body that is not JSON throws an error naming only the API path,
  without its query string (a search filter can hold PHI). The underlying error is not
  attached, because its message carries the full URL, and the parser's would quote the body.

## PHI in rendered pages

Rendered pages and loader data can hold PHI, so:

- Every HTML page, every `{basePath}/_expo/loaders/*` response and every root
  `/_expo/loaders/*` response sends `Cache-Control: no-store, private`. `app-config.json` stays
  `no-store`; hashed assets keep their immutable cache.
- JSON written into HTML goes through `serializeForHtml`, which escapes `<`, `>`, `&`, U+2028
  and U+2029, so a stored value such as `</script><script>` cannot end the script.
- A failed render or loader logs `Admin SPA render failed for <route path>` with the error
  message only. The page's query string is never logged, and `loadSsrPayload` errors leave out
  the API query string, the cookie and response data. A loader that throws its own error owns
  what that message says.

## Gates while rendering

`AdminGate` still decides access on the client. While the session is loading it renders
`/login` instead of a spinner, so the server-rendered login form stays on screen. Every other
route shows the spinner until the session resolves.

## Related

- [Admin SPA reference](../reference/admin-spa.md)
- [How admin interfaces are shaped](admin-interface.md)
