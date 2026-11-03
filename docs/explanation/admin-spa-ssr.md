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

## Access is decided before rendering

`createAdminSpaGate` runs in Express before any page or loader renders. It gates `GET`
requests under `basePath` (except `_expo/static`, `assets` and `app-config.json`) and loader
requests at the root `/_expo/loaders/*`. It decides on the normalized path (dot segments,
including encoded ones, resolved) and hands Expo that same path, so a path such as
`/console/assets/../Todo` cannot pass as an asset and then render as `/Todo`. A request under
`_expo/static`, `assets` or `app-config.json` that is not a real file gets a 404: it never
reaches the page renderer, which would otherwise render `/assets/Todo` as a model page.

For a visitor with `req.user`, it reads three things over loopback, in parallel, with the
visitor's cookie: `{authBasePath}/get-session`, `/auth/me` and `{adminApiBasePath}/config`.
A 200 from the config means admin, a 403 means signed in but not an admin, and a 401 from any
of them means anonymous. Anything else (a 5xx, a network error, no answer within 5 s) answers
503 without rendering: the gate fails closed.

| Visitor | Page | Loader data |
| --- | --- | --- |
| Anonymous | `/login` renders; any other page redirects to `/login?returnTo=<path>` | 401 JSON, except `login` and `forbidden` |
| Not an admin | `/login` and `/forbidden` render; any other page redirects to `/forbidden` | 403 JSON, except `login` and `forbidden` |
| Admin | `/login` redirects to `returnTo` (or `/`); `/forbidden` redirects to `/`; every other page renders | runs |

`returnTo` is an in-app path. `sanitizeReturnTo` accepts it only when it starts with a single
`/` and has no scheme and no backslash, so it cannot send anyone to another site. The gate and
the login screen use the same function.

An admin's render runs in a request scope that holds the session snapshot `{userId, user}`, the
profile, and the admin config, so the shell can render from them. `AdminGate` keeps its client
redirects as a fallback for a session that ends after the page has loaded. While the client
session is still loading, it renders `/login` as is, so the server-rendered form stays on
screen, and shows a spinner on other routes.

## Hydrating the shell

The server render hands the browser what the gate already read, so the shell renders on its
first client render with no spinner and no repeated requests:

- `+html.tsx` writes the request scope into `<script id="admin-spa-ssr" type="application/json">`
  with `serializeForHtml`. `useSsrPayload()` returns that scope on the server and, in the
  browser, reads the script once and removes it.
- `StoreProvider` passes the payload's session to the session store as `initialSession`, so
  `useSession()` is settled from the first render, and primes the request client's
  `GET /auth/me` entry with the profile (`primeQuery`).
- The layout wraps `AdminGate` in `<AdminRpcSeed>` with the payload's admin config, so every
  `/admin/config` reader renders from it. The config is filtered per user, so it seeds only
  while the payload's session is the live one; after another sign-in, readers fetch their own.
  Likewise, a payload with `adminConfigStatus: 403` sends the session to `/forbidden` without
  probing the config again, but only while the live session is the payload's.
- With a payload, the sync provider renders the shell at once and starts syncdb behind it; a
  failed start shows an error above the shell. Without one (dev proxy), it keeps the spinner.
- On the server, clients are built on `internalOrigin`, and nothing starts: no session watch,
  no socket, no request.
- The server lays out for a 1280×800 viewport (`Dimensions.set` in `+html.tsx`), so a desktop
  browser hydrates into the same tree. A narrower browser re-renders once after hydration.

The payload describes only the page the server rendered. After the first client commit,
`useSsrPayload()` returns `undefined` to anything that mounts later, so a sign-in, sign-out
or navigation reads live state. Route loader data (`__EXPO_ROUTER_LOADER_DATA__` and its
inline script) is deleted once every route has read its entry, or after 5 s. Loader rows can
hold PHI, so they do not stay on `window` or in the DOM, and a later client navigation fetches
loader JSON instead.

## Server-rendered data

Route loaders render a screen's data into the first HTML. Each one asks for the same URLs the
screen's hooks request, through `loadSsrPayload`, and the route wraps its screen in
`<AdminRpcSeed data={rpc}>`, so the hooks render the seeded bodies and skip their first fetch.

- **Model list** (`/console/<Model>`): the loader resolves the model by name from the gate's
  admin config with `resolveModelListUrl` and fetches its first page: page 1, the model's page
  size, its default sort. It builds the URL with the table's own builders
  (`buildAdminListQueryParams`, `buildAdminApiListQueryRequest`), so the key matches the
  table's request. An unknown name or a screen that is not a model list loads nothing.
- **Model detail** (`/console/<Model>/<id>`): the loader fetches the document's read URL
  (`resolveModelReadUrl`) and seeds the form, which fills its fields on the first render. A
  backend 404 renders a "Not found" page with HTTP 200: expo-server 58 can set another status
  only by throwing, which replaces the page with an error body.
- **Read URLs:** `useReadQuery` builds them with `buildAdminReadUrl(routePath, id)`, which
  encodes the id, so a server render that uses the same builder seeds the same key. Loaders
  decode their route params first, because expo-server passes them still encoded.
- **Encoded ids (Expo 58 limitation):** Expo keys server loader data by the raw path but looks
  it up by the decoded params. The gate canonicalizes escapes (RFC 3986: `%36` becomes `6`), so
  an over-encoded plain id renders normally. An id that must stay encoded (a space, `/`, `%` or
  a non-ASCII character) renders its page without the form's values; the browser then fetches
  the loader data and fills the form. Expo's client trims leading and trailing whitespace
  from the path, so for such an id it fetches another path's loader data; the form then falls
  back to its own read, and a missing record shows an empty form rather than "Not found".
  ObjectIds and UUIDs never need encoding.
- **RPC screens** (home, configuration, roles, scripts, version config): each route's loader
  fetches `rpcUrlsForRoute(route)`, the exact URLs its screen's `useAdminRpcQuery` calls request
  on mount, and wraps the screen in `RouteSeed`. A read that fails, or a URL outside the SSR
  allowlist, is left out and loads on the client.
- **Home widgets:** `homeWidgetUrls` derives the home page's URLs from `adminConfig.home.slots`
  for the built-in widgets (`modelStats` / `modelsGrid`, `recentActivity`, `versionConfig`,
  `jobs`). Custom app widgets are not seeded and load on the client, as are organization-scoped
  models, because a server render has no organization selected.
- **Jobs and comms** (`/console/jobs`, `/console/comms` and their detail pages): the loaders
  fetch the URLs the dashboards request on mount (`jobsSsrUrls`, `commsSsrUrls`); a missing
  job or message renders "Not found" with HTTP 200. The comms dashboard's default 7-day range
  ends at the next whole minute, so the server render and the hydrating browser build the same
  URL within that minute.
- **Organizations** (`/console/orgs` and an organization's settings and members): the loaders
  build their requests with `orgsSsrRequests`. Organization-scoped reads carry the hooks'
  `X-Organization-Id`, which is part of the seed key. The directory is fetched only for an
  operator (`operator` or `superadmin` role on the gate's profile); an organization admin gets
  no directory data, as on the client. An organization id that is not one path segment seeds
  nothing.
- **Selected organization (limitation):** once the client selects an organization (from
  `/orgs/mine`), its model reads carry `X-Organization-Id`. A server render has no selected
  organization, so for a visitor who belongs to one, the model list and detail seeds do not
  match and those screens refetch after hydration. The first HTML still shows the visitor's
  own data; nothing crosses organizations, since every read uses the visitor's session.
- **Windowed sync models** render the seeded REST page first. The admin provider binds the
  syncdb client only after `start()` resolves, and the table then switches to its window,
  so live updates reach it. On that switch the table refetches its REST page once, so a change
  made between the server render and the sync start shows up without a manual refresh.

## Related

- [Admin SPA reference](../reference/admin-spa.md)
- [How admin interfaces are shaped](admin-interface.md)
