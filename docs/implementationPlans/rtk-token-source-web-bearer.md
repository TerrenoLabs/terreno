# One token source for @terreno/rtk, and a web bearer scheme for Better Auth

Better Auth is the default for new Terreno apps, but most of `@terreno/rtk` still reads the
legacy JWT from storage. The RTK base query, the socket hook, the chat hook, the MCP tools
hook and offline replay all call the JWT `getAuthToken`. A Better Auth app either forks the
base query (example-frontend and every generated app do) or gets logged out on its first
RTK call (#1217). On web, Better Auth also needs cookies, so an app whose frontend and API
are on different sites depends on third-party cookies that Safari blocks. Lede is
migrating to Better Auth on two Vercel hosts and carries shims until this ships. After
this change, an app registers one token source at startup and every rtk consumer uses it,
and a cross-site web app can sign in, with email and password or a social provider, and
stay signed in without any cookie.

Source: #1579. Also fixes #1217.

## The idea

rtk gets a registered token source: `setTokenSource(source)`, typed as syncdb's
`AuthProvider` (`getToken`, `getUserId`, `onAuthChange`, `refresh?`). rtk imports that
type from `@terreno/syncdb`, so the object an app already builds for syncdb with
`betterAuthAdapter(betterAuthClient)` is the same one rtk uses. Until an app registers one,
rtk uses a built-in JWT source that wraps today's `getAuthToken` and `refreshAuthToken`, so
JWT apps change nothing. Each consumer also takes an optional `tokenSource` override.

`createBetterAuthClient` gets an opt-in `webAuth: "bearer"` mode. On web it captures the
`set-auth-token` header that Better Auth's bearer plugin returns, stores it in
localStorage (or a `bearerStorage` the app passes), sends `Authorization: Bearer` on every
Better Auth client call including `getSession`, and sends no cookies
(`credentials: "omit"`). rtk exports `getBetterAuthBearerToken()` to read that stored
token, and syncdb's `betterAuthAdapter` takes it as an explicit `getBearerToken` option so
it reads the token locally instead of calling `getSession()` per read. Social sign-in is a redirect, so the client never sees
`set-auth-token`. Instead, rtk starts the sign-in with a random nonce, the server appends a
single-use, three-minute one-time token to the callback redirect's URL fragment (only for
configured web origins), and rtk exchanges it for the bearer on return, but only when the
nonce matches the sign-in it started. Native is unchanged: the expo plugin already keeps the
session without browser cookies.

Rejected: passing the token source to every consumer with no global default. Hooks deep in
the tree, like `useMCPTools`, would need it threaded through props, and it is the same
object everywhere.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Registered token source, used by the RTK base query | none | rtk | base query sends the registered source's token and never logs out a Better Auth user for a missing JWT (#1217) |
| T2 | Web bearer scheme for `createBetterAuthClient` | T3 | rtk | sign-in token is stored and sent, cookies are not; sign-out clears it, a failed read does not |
| T3 | Server accepts cookie-less bearer from another origin | none | api | cross-origin sign-in exposes the token; bearer alone reaches `/auth/me`, a model route and `/mcp` |
| T4 | `betterAuthAdapter` takes a `getBearerToken` option | none | syncdb | with the option, `getToken` makes no `getSession` call |
| T5 | Socket hook reads the token source | T1 | rtk | handshake re-reads the token per attempt, refreshes once per failure, reconnects on auth change |
| T6 | Chat hook reads the token source | T1 | rtk | chat requests carry the source's token |
| T7 | MCP tools hook reads the token source | T1 | rtk | MCP transport carries the source's current token |
| T8 | Offline queue and replay read the token source | T1 | rtk | a Better Auth user's mutations queue and replay with the source's token |
| T9 | Document the consumer `tokenSource` options | T5, T6, T7, T8 | docs | reference and how-to pages match the new signatures |
| T10 | example-frontend drops its forks; bearer on web behind a flag | T1, T2, T4, T5, T7 | example-frontend | Playwright, cross-site with no cookies: email sign-in, reload, profile, socket and MCP tools work |
| T11 | Generated apps use the token source | T1 | create-terreno-app | generated store registers `betterAuthAdapter` and drops the base-query fork |
| T12 | Server hands a one-time token to the OAuth callback | none | api | the callback redirect to a configured web origin carries `#ott`, which verifies once into a bearer; nothing else mints one |
| T13 | rtk exchanges the OAuth one-time token for the bearer | T2, T12 | rtk | a nonce-matched return stores the bearer; an unsolicited `#ott` is ignored |
| T14 | Cross-site social sign-in in example-frontend | T10, T13 | example-frontend | Playwright drives a mock OIDC sign-in cross-site with no cookies and lands signed in |
| T15 | Deployed example-frontend runs in bearer mode | T10 | CI deploy | Netlify builds set the flag; a smoke run against the PR preview signs in with no cookie |

Tracer: T1, the registered source through the RTK base query.
Out of scope: moving rtk's hooks out of rtk, admin-frontend's header getter, the missing `/api/chat` route (see Expansions).
Open risks: the one-time token travels in a URL fragment, which servers, access logs and `Referer` never see, but browser history and client-side scripts loaded before the strip could; it is single-use, expires in three minutes, is bound to a nonce, and goes only to configured web origins. A localStorage token can be read by an XSS on the frontend and outlives browser restarts, which matters on shared family devices. Bearer mode is opt-in, `bearerStorage` accepts sessionStorage, and the docs say when to use which.

## Tasks

- [x] **T1** — Register a token source and use it in the RTK base query
  - Depends on: none
  - Files: rtk/package.json, rtk/src/tokenSource.ts, rtk/src/tokenSource.test.ts, rtk/src/authEvents.ts, rtk/src/authSlice.ts, rtk/src/emptyApi.ts, rtk/src/isolated/emptyApi.staggered.isolated.ts, rtk/src/index.ts, docs/reference/legacy/rtk.md, plugins/terreno-planning/skills/terreno-data-fetching/references/auth-and-tokens.md, skills/terreno-data-fetching/references/auth-and-tokens.md, plugins/terreno-claude/skills/terreno-data-fetching/references/auth-and-tokens.md, changelog/unreleased/rtk-token-source.md
  - Behavior: `setTokenSource(source)` and `getTokenSource()` are exported from `@terreno/rtk`; `AuthProvider` is imported as a type from `@terreno/syncdb`, added as a `workspace:*` dependency. Seams, chosen so rtk stays cycle-free: `tokenSource.ts` is a leaf that holds the registered source (`undefined` until an app registers one) and imports nothing from rtk. `authEvents.ts` is a leaf emitter that the `authSlice.ts` login and logout listeners and `refreshAuthToken` call. `emptyApi.ts` exports `jwtTokenSource` (`getToken` is `getAuthToken`, `refresh` is `refreshAuthToken` resolving `true` on success, `getUserId` reads the JWT `sub`, `onAuthChange` subscribes to `authEvents`) for apps that want to register it explicitly. Every consumer treats "no source registered" or `jwtTokenSource` as today's JWT path, so JWT apps run the same code. `staggeredBaseQuery` keeps its exact JWT behavior on that path. With any other source it sends that source's token, sends the request with no `authorization` header when the token is null, and never dispatches `auth/logout` for a missing token. On a 401 it calls `refresh()` once and retries, and dispatches `auth/logout` only when the retry is also 401.
  - Acceptance:
    - With a fake `AuthProvider` registered and no JWT in storage, a query sends `authorization: Bearer <fake token>` and dispatches no `auth/logout`. Verification: new case in `rtk/src/isolated/emptyApi.staggered.isolated.ts`; fails on master (logout dispatched), passes on the branch.
    - With a fake source, a 401 then a 200 calls `refresh` once and returns the 200; two 401s dispatch `auth/logout`. Verification: `rtk/src/isolated/emptyApi.staggered.isolated.ts`.
    - Existing JWT base-query tests pass unchanged, and the default source's `getToken` and `refresh` delegate to `getAuthToken` and `refreshAuthToken`. Verification: `cd rtk && bun test ./src/isolated/emptyApi.isolated.ts && bun test ./src/isolated/emptyApi.staggered.isolated.ts && bun test src/tokenSource.test.ts` (each file its own process; `tokenSource.test.ts` uses no module mocks, otherwise it moves under `isolated/`).
    - rtk coverage stays at or above its 95% threshold. Verification: `cd rtk && bun run test:coverage`.
    - Generated skill copies match, and dependency-cruiser finds no new cycle. Verification: `bun run skills:sync && bun run skills:check && bun run analyze:full`.
  - Docs: `docs/reference/legacy/rtk.md` gets a token-source section. Its Better Auth slice snippet and the skill's `auth-and-tokens.md` contradict the code (`{sessionReducer, sessionMiddleware}` and a nonexistent `basePath`); fix them here because the new section sits next to them.
  - Skills: terreno-data-fetching, update-docs.
- [x] **T2** — Add a web bearer scheme to createBetterAuthClient
  - Depends on: T3
  - Files: rtk/src/betterAuthClient.ts, rtk/src/betterAuthTypes.ts, rtk/src/betterAuthClient.test.ts, docs/how-to/configure-better-auth.md, docs/explanation/authentication.md, docs/how-to/migrate-rtk-to-syncdb.md, changelog/unreleased/better-auth-web-bearer.md
  - Behavior: `BetterAuthClientConfig` gains `webAuth?: "cookie" | "bearer"` (default `"cookie"`) and `bearerStorage?: {getItem, setItem, removeItem}` (default `window.localStorage`, key `${storagePrefix}_bearer_token`). With `"bearer"` on web, the client passes `fetchOptions` with: `credentials: "omit"`; `onSuccess` that stores a `set-auth-token` response header, and clears the stored token after a successful `get-session` response whose body has no session, but only when the token that request sent equals the token stored now; `auth: {type: "Bearer", token: () => stored token}`. A failed or errored `get-session` leaves the token in place. Calling `signOut` clears the stored token locally before the request, whatever the response, so a failed sign-out never leaves a usable token on the device. rtk exports `getBetterAuthBearerToken({storagePrefix?, bearerStorage?}): string | null`, which reads the same key. Nothing is added to the client object: `createAuthClient` returns a route proxy, so an added property would be unreadable and `client.getBearerToken` already resolves to a `/get-bearer-token` request. On native, or with `"cookie"`, the options passed to `createAuthClient` are unchanged.
  - Acceptance:
    - On web with `webAuth: "bearer"`, `onSuccess` with a `set-auth-token: t1` response stores `t1`; `fetchOptions.auth.token()` and `getBetterAuthBearerToken()` return `t1`; `fetchOptions.credentials` is `"omit"`. Verification: `rtk/src/betterAuthClient.test.ts` against the captured `createAuthClient` options.
    - A sign-out clears the token even when its request fails or returns 5xx. A successful `get-session` with a null session clears it, unless a newer token was stored while that request was in flight. A `get-session` that errors or returns 5xx keeps it. Verification: `rtk/src/betterAuthClient.test.ts`.
    - A custom `bearerStorage` is used instead of localStorage. Verification: `rtk/src/betterAuthClient.test.ts`.
    - On native, or without `webAuth`, the captured options equal today's. Verification: existing `createBetterAuthClient` tests pass unchanged.
  - Docs: `configure-better-auth.md` gets "Frontend and API on different sites": when to use bearer, that it sends no cookies so the server's `corsOrigin` default works and the bearer plugin exposes `set-auth-token` itself (both proved by T3), the XSS and shared-device trade-off, and `sessionStorage` for shared devices. Its slice snippet and the missing required `scheme` contradict the code; fix them in this section's neighbourhood. `authentication.md:39` and `:311` describe bearer on web as the cross-site option. `migrate-rtk-to-syncdb.md:336` stops saying web tokens live in AsyncStorage.
  - Skills: update-docs.
- [x] **T3** — Accept a cookie-less bearer from another origin on the server
  - Depends on: none
  - Files: api/src/betterAuthApp.test.ts
  - Behavior: with `TerrenoApp` and `BetterAuthApp`, both with the default `corsOrigin` (`"*"`) and with an explicit one, a cross-origin `POST /api/auth/sign-in/email` sent without credentials returns `set-auth-token` and lists it in `access-control-expose-headers`. A later request carrying only `Authorization: Bearer <that token>` and no cookie reaches `GET /auth/me` as the user, an authenticated `modelRouter` list route returns 200, and `POST /mcp` `initialize` succeeds. If any of these fails, the task fixes the server (for example `exposedHeaders` in `api/src/terrenoApp.ts`) and adds that file.
  - Acceptance: the cases pass. Verification: `cd api && bun test src/betterAuthApp.test.ts`.
  - Skills: terreno-backend-api.
- [x] **T4** — Take a getBearerToken option in betterAuthAdapter
  - Depends on: none
  - Files: syncdb/src/auth/betterAuthAdapter.ts, syncdb/src/auth/betterAuthAdapter.test.ts, docs/reference/syncdb.md, changelog/unreleased/syncdb-adapter-bearer-token.md
  - Behavior: `BetterAuthAdapterOptions` gains `getBearerToken?: () => string | null`. When it is passed and returns a token, `getToken` returns that token without calling `getSession()`. Otherwise `getToken` behaves as today. `getUserId`, `onAuthChange` and `refresh` are unchanged. The option is explicit, never detected on the client, so the bridged client from `bridgeBetterAuthReactClient` needs no change.
  - Acceptance: with `getBearerToken` returning `t1`, `getToken()` resolves `t1` and the fake client's `getSession` is not called; without the option, or with it returning null, `getSession` is read as today. Verification: `cd syncdb && bun test src/auth/betterAuthAdapter.test.ts`.
  - Docs: `docs/reference/syncdb.md` adapter section.
- [x] **T5** — Read the token source in useSocketConnection
  - Depends on: T1
  - Files: rtk/src/socket.ts, rtk/src/isolated/socket.web.isolated.ts, changelog/unreleased/rtk-socket-token-source.md
  - Behavior: `getAuthToken` becomes optional. Without it, the hook reads the token source (the `tokenSource` option, else the registered one). The socket's `auth` is a callback that reads the token on every connect and reconnect. On an auth `connect_error` it calls `refresh()` once per failure episode and reconnects; a second auth failure before a successful connect stops reconnecting and calls `onConnectError`. A successful connect resets the episode. It reconnects when `onAuthChange` fires. The JWT expiry check stays as it is while the JWT source is registered.
  - Acceptance:
    - With a registered fake source and no `getAuthToken`, the handshake sends `Bearer <token>`; after the token changes and `onAuthChange` fires, the next handshake sends the new token. Verification: `rtk/src/isolated/socket.web.isolated.ts`.
    - When `refresh` resolves true but the server keeps rejecting the token, the hook refreshes once and stops. Verification: same file.
    - Passing `getAuthToken` keeps today's behavior, and existing socket tests pass. Verification: `cd rtk && bun test ./src/isolated/socket.isolated.ts && bun test ./src/isolated/socket.web.isolated.ts && bun test src/socket.test.ts`.
  - Docs: JSDoc on the new options (feeds the generated reference); prose in T9.
- [x] **T6** — Read the token source in useTerrenoChat
  - Depends on: T1
  - Files: rtk/src/useTerrenoChat.ts, rtk/src/isolated/useTerrenoChat.isolated.ts, changelog/unreleased/rtk-chat-token-source.md
  - Behavior: the transport `headers` callback reads the token source (`tokenSource` option, else the registered one) per request, and omits `Authorization` when there is no token.
  - Acceptance: with a registered fake source, the headers callback returns `Authorization: Bearer <token>`; with a null token it returns none. Verification: `cd rtk && bun test ./src/isolated/useTerrenoChat.isolated.ts`.
  - Docs: JSDoc on the new option; prose in T9.
- [x] **T7** — Read the token source in useMCPTools
  - Depends on: T1
  - Files: rtk/src/useMCPTools.ts, rtk/src/isolated/useMCPTools.isolated.ts, changelog/unreleased/rtk-mcp-token-source.md
  - Behavior: the MCP transport's `authProvider.token` reads the token source (`tokenSource` option, else the registered one) on each call instead of capturing one token per fetch.
  - Acceptance: with a registered fake source, `authProvider.token()` resolves to the source's current token, including after it changes. Verification: `cd rtk && bun test ./src/isolated/useMCPTools.isolated.ts`.
  - Docs: JSDoc on the new option; prose in T9.
- [x] **T8** — Read the token source in the offline queue and replay
  - Depends on: T1
  - Files: rtk/src/offlineMiddleware.ts, rtk/src/isolated/offlineMiddleware.isolated.ts, changelog/unreleased/rtk-offline-token-source.md
  - Behavior: with a non-JWT source (`OfflineMiddlewareConfig.tokenSource`, else the registered one), the middleware tags and filters queued mutations by the source's `getUserId()` instead of `state.auth.userId` (`offlineMiddleware.ts:142-152, 541, 641`), and `replayMutation` sends the source's token, omitting `authorization` when there is none. On the JWT path it behaves as today.
  - Acceptance: with a registered fake Better Auth source and no `state.auth` slice, a mutation made offline is queued under the source's user id and, on reconnect, replayed with `authorization: Bearer <token>`. Verification: `cd rtk && bun test ./src/isolated/offlineMiddleware.isolated.ts`; existing offline tests pass.
  - Docs: JSDoc on the new option; prose in T9.
- [x] **T9** — Document the token-source options on rtk's consumers
  - Depends on: T5, T6, T7, T8
  - Files: docs/reference/legacy/rtk.md, docs/how-to/websocket-integration.md
  - Behavior: `legacy/rtk.md` stops calling `getAuthToken` required and JWT-only (`:165`), and documents `tokenSource` on the socket, chat, MCP and offline APIs. `websocket-integration.md:146-165` describes the registered source. The generated rtk reference is built from JSDoc at docs-site build time, so it needs no edit.
  - Acceptance: every option named on the pages exists in the exported signatures, and the docs site builds with the generated rtk reference. Verification: `cd website && bun run build` succeeds, and the docs-audit skill reports no rtk drift.
  - Skills: update-docs, docs-audit.
- [x] **T10** — Use the token source in example-frontend, with web bearer behind a flag
  - Depends on: T1, T2, T4, T5, T7
  - Files: example-frontend/lib/betterAuth.ts, example-frontend/store/betterAuthApi.ts, example-frontend/store/index.ts, example-frontend/store/syncdb.ts, example-frontend/openapi-config.ts, example-frontend/store/openApiSdk.ts, example-frontend/app/_layout.tsx, example-frontend/app/admin/_layout.tsx, example-frontend/e2e/crossSiteBearer.spec.ts, example-frontend/e2e/helpers/syncdbSuite.ts, example-frontend/playwright.config.ts, example-frontend/.env.example
  - Behavior: the app registers the `authProvider` it already builds in `store/syncdb.ts` (`betterAuthAdapter(bridgeBetterAuthReactClient(betterAuthClient), ...)`, now with `getBearerToken: getBetterAuthBearerToken`) with `setTokenSource` at startup. It turns on `webAuth: "bearer"` on web when `EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER=true`; T15 sets the flag in the Netlify builds (D6). The generated SDK points back at rtk's `emptySplitApi`, and `store/betterAuthApi.ts` keeps only `getAdminAuthHeaders`, reading the token source. `_layout.tsx` stops passing its own `getAuthToken` to `useSocketConnection`.
  - Acceptance:
    - A Playwright project runs the web app at `localhost:8082` against the API at `127.0.0.1:4000` (different sites) with the flag on. The test strips `set-cookie` from API responses, signs in through the UI, asserts `context.cookies()` holds no Better Auth session cookie, reloads, and sees the profile screen load (`useGetMeQuery`), the socket connect, and the AI tab's MCP tools load. Verification: `cd example-frontend && bunx playwright test e2e/crossSiteBearer.spec.ts`; it fails on master.
    - The `useMCPTools error` console allowance is removed and the existing Better Auth suites pass: login, signup, profile, realtime, ai-chat. Verification: `bun run check:e2e-affected` then the affected shards.
    - Screenshots of the signed-in profile and AI tab after the reload are saved to `/opt/cursor/artifacts/` and attached to the PR. Verification: verify-ui-changes skill.
  - Skills: generate-sdk, verify-ui-changes, terreno-data-fetching.
- [ ] **T11** — Generate apps that register the token source
  - Depends on: T1
  - Files: create-terreno-app/src/generate.ts, create-terreno-app/src/__tests__/generate.test.ts, changelog/unreleased/cta-token-source.md
  - Behavior: the generated store registers its existing bridged `authProvider` (`generate.ts:2544-2564`) with `setTokenSource`, the generated codegen config points at rtk's `emptySplitApi`, and `store/betterAuthApi.ts` (with its `readSessionToken` fork) is no longer generated. The generated client keeps cookie mode.
  - Acceptance:
    - Generator tests assert the registration and the codegen target, and that no `betterAuthApi.ts` is emitted. Verification: `cd create-terreno-app && bun test src/`.
    - A generated app type-checks against the workspace packages. Verification: generate into a temp dir, link `node_modules`, run `tsc -p frontend/tsconfig.json`.

- [ ] **T12** — Hand a one-time token to the OAuth callback on the server
  - Depends on: none
  - Files: api/src/betterAuth.ts, api/src/betterAuthSetup.ts, api/src/betterAuthOAuthHandoff.test.ts, changelog/unreleased/better-auth-oauth-handoff.md
  - Behavior: `BetterAuthConfig` gains `oauthHandoff?: {webOrigins: string[]}` (unset by default). When set, `createBetterAuth` adds Better Auth's `oneTimeToken` plugin with `expiresIn: 3`, `storeToken: "hashed"`, `disableClientRequest: true` and `setOttHeaderOnNewSession` off, then a Terreno plugin whose after-hook matches only `ctx.path?.startsWith("/callback/")` (social and generic OAuth share `/callback/:id` in 1.7.4). When the callback created a session (`ctx.context.newSession`), the hook resolves the redirect `Location` against `baseURL`. If its origin exactly equals an http(s) origin in `webOrigins`, it mints a token with `auth.api.generateOneTimeToken` (server-side, headers `authorization: Bearer <new session token>`) and appends `ott=<token>` to the `Location` fragment. App schemes (`exp://`, `terreno://`), relative paths and the API's own origin never get a token. `POST /api/auth/one-time-token/verify` returns the session with `set-auth-token`, once.
  - Acceptance:
    - With `oauthHandoff.webOrigins` set and a local mock OIDC provider registered through `plugins` (`genericOAuth`), completing the flow with a `callbackURL` on a listed web origin redirects with `#ott=` in `Location`. Verifying it returns `set-auth-token`; a second verify fails. Verification: `cd api && bun test src/betterAuthOAuthHandoff.test.ts`.
    - A `callbackURL` that passes Better Auth's origin check but is not a listed web origin (an `exp://` scheme in `trustedOrigins`, a relative path, the API origin) gets no `ott`. Verification: same file.
    - The client route `GET /one-time-token/generate` is refused; email sign-in and verify responses carry no `set-ott` header; with `oauthHandoff` unset, no `/one-time-token/*` route exists. Verification: same file.
  - Docs: in T13 (the same page).
  - Skills: terreno-backend-api.
- [ ] **T13** — Exchange the OAuth one-time token for the bearer in rtk
  - Depends on: T2, T12
  - Files: rtk/src/betterAuthClient.ts, rtk/src/betterAuthClient.test.ts, docs/how-to/configure-better-auth.md, changelog/unreleased/better-auth-web-bearer-oauth.md
  - Behavior: rtk exports `signInSocialWithHandoff(client, {provider, callbackURL?})`, which stores a random nonce in sessionStorage and calls `client.signIn.social` with a `callbackURL` that carries `handoff=<nonce>` in its query. It also exports `completeBetterAuthOAuthHandoff(client): Promise<boolean>`. On web in bearer mode, when the URL fragment has `ott` and the `handoff` query equals the stored nonce, it removes `ott`, `handoff` and the stored nonce first (`history.replaceState`), then POSTs the token to `/one-time-token/verify`; T2's `onSuccess` stores the bearer. A missing or mismatched nonce drops `ott` from the URL and makes no request. It resolves `true` only when a token was stored. Apps await it before anything reads the session, and before Sentry or analytics start.
  - Acceptance:
    - After `signInSocialWithHandoff`, a URL with the matching `handoff` and `#ott=abc` makes the function strip both before the request, call verify with `abc`, and leave `t2` stored from a `set-auth-token: t2` response. Verification: `rtk/src/betterAuthClient.test.ts`.
    - An unsolicited `#ott` (no stored nonce, or a different one) makes no request and stores nothing. Without `ott`, on native, or in cookie mode, no request is made. A failed verify resolves `false`. Verification: same file.
    - A null-session `get-session` that was sent before verify finished does not clear the token verify stored. Verification: same file, with the two responses resolved in that order.
  - Docs: `configure-better-auth.md` "Frontend and API on different sites" covers social sign-in: `oauthHandoff: {webOrigins}` on the server, `signInSocialWithHandoff` for the buttons, and awaiting `completeBetterAuthOAuthHandoff` at startup before session reads and Sentry.
  - Skills: update-docs.
- [ ] **T14** — Run cross-site social sign-in in example-frontend
  - Depends on: T10, T13
  - Files: example-frontend/lib/betterAuth.ts, example-frontend/app/_layout.tsx, example-frontend/e2e/crossSiteOAuth.spec.ts, example-frontend/e2e/helpers/mockOidcProvider.ts, example-frontend/playwright.config.ts, example-backend/src/utils/betterAuthConfig.ts
  - Behavior: with the bearer flag on, the social buttons use `signInSocialWithHandoff`, and `_layout.tsx` awaits `completeBetterAuthOAuthHandoff` before the session sync and Sentry start. example-backend sets `oauthHandoff.webOrigins` from `getWebOrigins()` when `BETTER_AUTH_OAUTH_HANDOFF=true`, and registers a `genericOAuth` provider only when `MOCK_OIDC_ISSUER` is set (never in production). Playwright starts the mock OIDC provider as a web server.
  - Acceptance:
    - Cross-site (`localhost:8082` to `127.0.0.1:4000`), with `set-cookie` stripped from API responses, clicking the mock provider's button completes the redirect and lands signed in. `ott` is gone from the URL and `context.cookies()` holds no Better Auth session cookie. Verification: `cd example-frontend && bunx playwright test e2e/crossSiteOAuth.spec.ts`.
    - Opening the app with a made-up `#ott=` does not sign in. Verification: same file.
    - A screenshot of the signed-in page after the return is saved to `/opt/cursor/artifacts/` and attached to the PR. Verification: verify-ui-changes skill.
  - Skills: verify-ui-changes.

- [ ] **T15** — Deploy example-frontend in bearer mode
  - Depends on: T10
  - Files: scripts/ci/netlify-deploy.sh, scripts/ci/netlify-deploy.test.ts, .circleci/continue-config.yml, example-frontend/e2e/deployedBearer.smoke.ts, example-frontend/playwright.smoke.config.ts, example-frontend/package.json, docs/how-to/run-tests-locally.md
  - Behavior: `netlify-deploy.sh frontend` exports `EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER=true` before `bun run export`, for production and previews. The backends keep `CROSS_DOMAIN_AUTH_COOKIES=true`, so a browser still holding an old cookie build keeps working until it reloads. `deploy-frontend-preview` then runs `bun run smoke:deployed` with `SMOKE_BASE_URL=https://pr-<n>--terreno-frontend.netlify.app`: a Playwright config with no web servers and one spec that signs up a fresh `smoke-<run id>@example.com` user on the PR's isolated preview backend through the UI, reloads, sees the profile screen load, and asserts `context.cookies()` for the API origin holds no Better Auth session cookie. Production deploys only build with the flag: the smoke never creates users on the prod backend.
  - Acceptance:
    - The frontend build step exports the flag before `bun run export`, for both modes. Verification: a `scripts/ci/netlify-deploy.test.ts` case that runs the script with `bun run export` stubbed and asserts the stub saw `EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER=true`.
    - The smoke spec passes against a local cross-site stack (`SMOKE_BASE_URL=http://localhost:8082`, API at `127.0.0.1:4000`). Verification: `cd example-frontend && SMOKE_BASE_URL=http://localhost:8082 bun run smoke:deployed`.
    - On the PR, the `deploy-frontend-preview` CircleCI job runs the smoke after the deploy and it passes. Verification: the job's log on the PR head.
  - Docs: `run-tests-locally.md` maps the new CircleCI step to its local command.
  - Skills: verify-ui-changes.

## Assumptions

- `@terreno/syncdb` has no `@terreno/*` dependencies, so `rtk → syncdb` adds no cycle. Both are lockstep-versioned.
- No Redux shape changes for auth: the JWT `onAuthChange` comes from the `authEvents.ts` emitter, not from state. T8 adds optional fields to the offline slice (`lastUserId`, and `userIdConfirmed` on queued mutations) so mutations made after an offline launch keep their user; they are additive.
- The registered source is module-global, like rtk's existing `baseUrl`. One app, one source.
- All changelog fragments are `Added` or `Fixed`, so no upgrade note is needed (`bun run check:upgrade-docs`).
- The bearer plugin exposes `set-auth-token` itself on responses that set a session (`node_modules/better-auth/dist/plugins/bearer/index.mjs:62-65`); T3 proves it from another origin.
- The OAuth handoff hook mints its own token through `auth.api.generateOneTimeToken`; `setOttHeaderOnNewSession` stays off because it fires on every new session, including email sign-in and verify (`node_modules/better-auth/dist/plugins/one-time-token/index.mjs:89-100`). After-hooks run on the callback's thrown redirect, and a hook can rewrite `Location`, as `oauthPopup` does.
- T9 is a docs join: the prose pages are shared by T5–T8, so one task writes them after all four land. Each of T5–T8 ships its own JSDoc and changelog fragment.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q1 | Is the web bearer scheme opt-in, or on by default on web? | Opt-in with `webAuth: "bearer"` | The issue asks for opt-in; same-site apps keep HttpOnly cookies, which an XSS cannot read | Default flips to `"bearer"` on web: T2's default and tests change, and the change becomes `Changed` with an upgrade note | T2, T10 |
| Q2 | Does this plan also close #1217? | Yes | #1579 names the base query as a consumer, and T1's test is #1217's repro | T1 drops the base-query change and only adds the registry; #1217 stays open | T1, T10, T11 |
| Q3 | With a non-JWT source, what does the base query do when the token is null? | Send the request without auth and let the server answer; log out only after a 401 survives one refresh | The #1217 bug is exactly the client deciding "logged out" on its own | Dispatch `auth/logout` on a null token, as JWT does: T1's first acceptance case inverts | T1 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Move the token source and hooks out of rtk before the next major | `versioning-policy.md:21`: rtk does not ship in the next major | M | T1–T8 |
| X2 | admin-frontend's `AdminGetAuthHeaders` reads the token source by default | It is another hand-rolled token getter | S | T1 |
| X3 | `useTerrenoChat`'s default `/api/chat` route does not exist on any backend | Found while tracing chat auth; T6 proves the header, not a live chat | S | T6 |
| X4 | `createSessionApi` uses `credentials: "same-origin"`, so it cannot work cross-site | Found while tracing cookies | S | none |
| X5 | Move the deployed example-frontend and API onto same-site custom domains (first-party `SameSite=Lax` cookies) | Q4 trade-offs: neither cross-site cookies nor bearer is the production best practice | S (about half a day, DNS plus deploy config) | none |
| X6 | syncdb's `betterAuthAdapter` marks its first-load emission so rtk's offline queue can tell it from a sign-in | T8 drops unconfirmed offline-launch writes on any `onAuthChange`, including the adapter's first successful load | S | T8 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | Where does the token-source API live? | Import syncdb's `AuthProvider` type into rtk | rtk depends on `@terreno/syncdb`; syncdb's `betterAuthAdapter` is the Better Auth source, so rtk writes no Better Auth source of its own |
| D2 | Where does the web bearer scheme store the token? | localStorage by default, with a `bearerStorage` option | T2's default storage; docs state the XSS and shared-device trade-off |
| D3 | How do apps give rtk the token source? | Register once with `setTokenSource`, JWT by default, optional per-consumer override | Every consumer task reads the registry first |
| D4 | Q5: Should bearer mode cover social OAuth sign-in in this plan? | Yes, add the handoff (recommendation was to document the limit) | Adds T12 (server one-time token on the callback, web origins only), T13 (nonce-bound rtk exchange) and T14 (cross-site mock-OIDC Playwright run) |
| D5 | Approve the plan? | Approved 2026-10-20, with D4 | Status: approved after cut checked the D4 tasks |
| D6 | Q4: Should the deployed example-frontend switch to bearer mode? | Yes, deploy bearer (recommendation was flag-only) | Adds T15: Netlify builds set the flag, and the PR preview runs a cookie-less sign-in smoke |

## Sign-off

Status: approved 2026-10-20
Cut: 3 rounds (the third on the D4 tasks), 28 findings: 26 fixed, 1 moved to questions then decided (social OAuth → Q5 → D4), 1 rebutted in part (round 1 F11: the slice-snippet fixes stay, because distill must resolve docs that contradict the code in the affected area)
