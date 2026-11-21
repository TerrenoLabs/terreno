# MCP OAuth consent on the prebuilt login screen

Terreno already acts as the OAuth 2.1 authorization server for remote MCP clients like
Claude.ai and ChatGPT. The only consent page lives inside admin-spa, though. It is
hard-coded, it uses its own login form, and its scopes mean nothing: any OAuth token can
call every tool its user can. This plan gives consumer apps a prebuilt consent screen. It
reuses the same login screen they already ship, with every sign-in method they support, and
then lets the user grant a client read-only or read/write access. The server enforces that
choice. App developers pick which grants to offer, either the read-only or read/write
presets or their own, and which login methods the consent screen shows.

## The idea

- **Backend:** `mcpOAuth.grants` turns scopes into enforced grants. It takes
  `"readOnly"`, `"readWrite"`, or a list of `{scope, label, description, access}`.
  - Every MCP tool is tagged `read` or `write`. A token sees and can call only the tools its
    grants allow, and write implies read.
  - Approve accepts an optional narrowed `{scope}`.
  - The consent request returns each grant's label and description.
- **Frontend:** `@terreno/syncdb/auth` gains `TerrenoOAuthConsentScreen`.
  - A signed-out visitor sees `TerrenoLoginScreen` inline on the consent route. Social
    sign-in returns to the same URL with `?request=` intact.
  - A signed-in visitor sees the client, the redirect host, and a checkbox per requested
    grant.
  - A new `methods` option on the login screen limits the providers, email form, and
    passkey to a subset of what the server offers.

Rejected alternative: labels without enforcement (D1). A "read-only" grant that can still
write is worse than having no grant at all.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Resolve `mcpOAuth.grants` presets and custom grants | none | api | `resolveMcpOAuthOption` unit tests, discovery `scopes_supported` |
| T2 | Enforce grants on MCP tools | T1 | api | `/mcp` tools/list and tools/call tests per token scope |
| T3 | Narrow scope on approve; return grant metadata | T1 | api, example-frontend SDK | consent route tests, token scope after exchange and refresh |
| T4 | Login `methods` allowlist | none | syncdb | isolated `TerrenoLoginScreen` and `useLoginController` tests |
| T5 | `useMcpOAuthConsent` hook | T3 | syncdb | isolated hook tests against a stub client |
| T6 | `TerrenoOAuthConsentScreen` | T4, T5 | syncdb | isolated screen tests: signed-out login, consent, errors |
| T7 | Example apps: `/oauth/consent` route, readWrite preset, CI wiring, e2e | T2, T6 | example-backend, example-frontend, CircleCI | E1, E2 |
| T8 | Docs, user guide, upgrade note | T2, T3, T6, T9 | docs | docs review against the shipped API |
| T9 | Social sign-in returns to consent in bearer mode | T7 | example-backend, example-frontend, CircleCI | E3 |

Tracer: T1. The grant model (`McpOAuthGrant`, resolved `grants`) is the contract that T2, T3, and every frontend task build on.

E2E: 3 cases at the browser layer, in 2 specs: `mcpOAuthConsent.spec.ts` (CI `app` shard) and `crossSiteMcpOAuthConsent.spec.ts` (CI `e2e-cross-site` job, which serves mock-oidc).

Regression: AUTH-new-1 (a real Claude.ai connector on a read-only grant), going to `docs/regression/auth.md`.

User guide: new page `docs/user-guide/account/connect-ai-assistant.md`.

Design: None. The signed-out state is `TerrenoLoginScreen` unchanged. The signed-in state is admin-spa's shipped consent layout plus a checkbox per grant (Q6).

Out of scope: admin-spa migration, a connected-apps management screen, per-model grants (see Expansions).

Open risks:
- Apps that already set `scopesSupported` and call `requireOAuthScope` by hand are unaffected until they switch to `grants`. Switching ends their live `mcp`-scoped tokens (Q2).
- Turning on `MCP_OAUTH_ENABLED` in the example-frontend e2e backend changes how `/mcp` answers when a request has no credentials. T7 checks `mcp-tokens.spec.ts`.
- **Bearer-mode apps.** Social sign-in only returns to paths listed in `oauthHandoff.callbackPaths`. A bearer-mode app must add its consent path to that list, or social sign-in on the consent screen fails with a 400. T9 proves this, and T8 documents it.
- **Switching to `grants`.** Confidential clients stored with `scope: "mcp"` get `invalid_scope` at the token endpoint once an app switches to `grants`. Today they would silently get a token with no tools, so T3 changes this. The upgrade note says so (T8).

Elephant: `registerMCPTool` tools default to `write`, so an app that adopts `"readOnly"` silently hides its custom read-only lookups from every read-only connector until each one declares `access: "read"`.

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `example-frontend/e2e/mcpOAuthConsent.spec.ts` | browser | Steps: a signed-out user opens `/oauth/consent?request=<id>`, signs in with email on that same screen, sees the "Read your data" and "Change your data" grants checked, unchecks write, and approves. Then: the browser lands on the client redirect with `code`. The exchanged token has scope `mcp:read`. `tools/list` with it has no `todos_create`, and calling `todos_create` fails and creates no todo. | T7 |
| E2 | `example-frontend/e2e/mcpOAuthConsent.spec.ts` | browser | A signed-in user who taps Deny lands on the redirect with `error=access_denied`, and no token can be exchanged | T7 |
| E3 | `example-frontend/e2e/crossSiteMcpOAuthConsent.spec.ts` (in `CROSS_SITE_SPEC_FILES`) | browser | A signed-out user on the bearer-mode cross-site web build signs in with the mock-oidc provider from the consent screen, returns to `/oauth/consent` for the same request, and approves | T9 |

The provider allowlist (`methods`) and the consent error states are proven in syncdb isolated
tests (T4, T6), because the e2e backend's provider set is fixed per run.

## Regression cases

Destination: AUTH → docs/regression/auth.md

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| AUTH-new-1 | A Claude.ai connector granted read-only cannot write | Start with a deployed example-backend that has `MCP_OAUTH_ENABLED=true`, `MCP_OAUTH_CONSENT_URL` set to the example-frontend `/oauth/consent`, and a signed-out browser. In Claude.ai add a custom connector with the MCP URL and connect. Sign in on the consent screen with Google, uncheck "Change your data", and approve. Then ask Claude to list your todos, and then to create one | Claude lists your todos. Claude's tool list has no create tool, and no new todo appears in the app | Web | E1 (scope enforcement), manual (the real Claude.ai round trip) | mcp-oauth-consent-screen |

## User guide

| ID | Page | Change | Audience | Written in |
| --- | --- | --- | --- | --- |
| G1 | docs/user-guide/account/connect-ai-assistant.md | new | user | T8 |

## Design

None. There is no canvas. The signed-out state is `TerrenoLoginScreen` unchanged. The
signed-in state follows admin-spa's shipped consent layout (`admin-spa/app/oauth/consent.tsx`):
client name, redirect-host warning, and signed-in email. The one addition is a checkbox per
grant in place of the plain scope list. T7 captures screenshots of both states for the PR
(Q6).

## Tasks

- [ ] **T1** — Resolve mcpOAuth.grants presets and custom grants
  - Depends on: none
  - Files: api/src/mcp/oauthMetadata.ts (`McpOAuthOptions`, `ResolvedMcpOAuthOptions`, `McpOAuthGrant`, and the presets live here), api/src/mcp/oauthMetadata.test.ts, api/src/index.ts (export `McpOAuthGrant`)
  - Criteria: A consumer sets `grants: "readOnly" | "readWrite" | McpOAuthGrant[]`. The
    resolved option carries `grants` and a matching `scopesSupported`. Bad config throws at
    boot. When `grants` is unset, behaviour is identical to today.
  - Seam: exported `resolveMcpOAuthOption` and the `/.well-known/oauth-authorization-server` document
  - Interface: `McpOAuthGrant = {scope: string; label: string; description?: string; access: "read" | "write"}`, exported from `@terreno/api`.
    - `McpOAuthOptions.grants?: "readOnly" | "readWrite" | McpOAuthGrant[]`.
    - Resolved: `{…, grants: McpOAuthGrant[] | undefined, scopesSupported: string[]}`.
    - Preset `readOnly` = `[{scope: "mcp:read", label: "Read your data", description: "See your records. It cannot change anything.", access: "read"}]`.
    - Preset `readWrite` = the readOnly grant plus `{scope: "mcp:write", label: "Change your data", description: "Create, update, and delete records for you.", access: "write"}`.
  - Cases:
    - `grants: "readOnly"` → `scopesSupported` `["mcp:read"]`; metadata `scopes_supported` `["mcp:read"]`
    - `grants: "readWrite"` → `["mcp:read", "mcp:write"]`, in that order
    - custom `[{scope: "todos", label: "Todos", access: "write"}]` → `scopesSupported` `["todos"]`, grant kept as given
    - unset `grants` and unset `scopesSupported` → `grants` undefined, `scopesSupported` `["mcp"]` (today's default)
    - both `grants` and `scopesSupported` set → throws `mcpOAuth: set grants or scopesSupported, not both`
    - `grants: []` → throws; duplicate scope → throws; a scope containing a space → throws; unknown preset string `"admin"` → throws
  - Blast radius: `parseScope` in oauth.ts reads `scopesSupported`. A backend case: `/oauth/authorize` with `scope=mcp:write` under `readOnly` → redirect with `invalid_scope`.
  - Test skills: terreno-backend-tests
  - Docs: T8

- [ ] **T2** — Enforce grants on MCP tools
  - Depends on: T1
  - Files: api/src/mcp/types.ts, api/src/mcp/toolGenerator.ts, api/src/mcp/actionTools.ts, api/src/mcp/registry.ts, api/src/mcp/server.ts, api/src/mcp/grantAccess.ts, api/src/mcp/grantAccess.test.ts, api/src/mcp/server.test.ts
  - Criteria: With `grants` set, an OAuth token (`mcpat_`) sees in `tools/list`, and can call,
    only the tools its scopes allow. Write implies read. Other credentials (Better Auth
    session, JWT, `mcp_` service token) and apps without `grants` see every tool, as today.
  - Seam: `POST /mcp` (`tools/list`, `tools/call`) and an exported `canUseMcpTool`
  - Interface:
    - `MCPToolDefinition` gains `access: "read" | "write"` and `scope?: string`.
    - CRUD tools: `list` and `read` are `read`; `create`, `update`, and `delete` are `write`.
      `MCPConfig.scopes?: Partial<Record<MCPMethod, string>>` sets an explicit scope per method.
    - Action tools: `method: "GET"` is `read`, anything else is `write`. The action's
      `mcp.scope?: string` sets an explicit scope.
    - `registerMCPTool({…, access?: "read" | "write", scope?: string})`, where `access`
      defaults to `"write"`.
    - `canUseMcpTool({tool, credential, tokenScopes, grants}): boolean`:
      - true when `credential !== "oauth"` or `grants` is undefined
      - else when `tool.scope` is set, true only if `tokenScopes` contains it
      - else for a `read` tool, true if any granted scope maps to a grant with access `read` or `write`
      - else for a `write` tool, true if any granted scope maps to a grant with access `write`
    - Tools that are not allowed are not registered on that request's MCP server instance.
  - Cases:
    - Setup: `readWrite`; Todo with mcp methods list, read, create; instance action
      `markComplete` (POST); custom tools `lookup` (`access: "read"`) and `notify` (no access).
    - token `mcp:read` → tools/list exactly `todos_list`, `todos_read`, `lookup`.
      tools/call `todos_create` → error result, no Todo created.
    - token `mcp:read mcp:write` → all 6 tools
    - token `mcp:write` alone → all 6 tools (write implies read)
    - Better Auth session cookie, JWT bearer, `mcp_` service token → all 6 tools
    - `grants` unset, token scope `mcp` → all 6 tools
    - `readWrite`, legacy token scope `mcp` → no tools (Q2)
    - Todo `scopes: {delete: "todos:admin"}` with custom grant `todos:admin`; token
      `mcp:read mcp:write` → `todos_delete` absent
  - Blast radius:
    - `mcpToolSettings` admin sync reads the tool list (`adminTracking.ts`). Case: the sync
      still records every tool regardless of grants.
    - `mcpRequestLog` records tool calls. Case: a refused call logs no `ok` outcome.
  - Test skills: terreno-backend-tests
  - Docs: T8

- [ ] **T3** — Narrow scope on approve and return grant metadata
  - Depends on: T1
  - Files: api/src/mcp/oauth.ts, api/src/mcp/oauth.test.ts, example-frontend/store/apiSdk.ts (regenerated with `bun run sdk`, never hand-edited)
  - Criteria: The consent request lists each requested grant with its label. Approve may send
    a subset of the requested scope. The issued token and every refresh carry exactly that
    subset. Approve with no body still grants the full requested scope, so admin-spa is
    unchanged. For `client_credentials`, the client's stored scope is intersected with
    `scopesSupported`, and an empty intersection returns `invalid_scope`. Today
    `oauth.ts:855-859` skips that check.
  - Seam: `GET /oauth/authorize/:request`, `POST /oauth/authorize/:request/approve`, `POST /oauth/token`
  - Interface:
    - GET adds `grants: Array<{scope: string; label: string; description: string | null; access: "read" | "write"}>`.
      It covers the requested scopes in requested order. When `grants` is unset, each is
      synthesized as `{scope, label: scope, description: null, access: "write"}`.
    - Approve takes an optional JSON body `{scope?: string}` (space-separated). The response
      is unchanged: `{data: {redirectUrl}}`. The OpenAPI body schema is added to
      `approveMcpOAuthRequest`.
  - Cases:
    - request scope `mcp:read mcp:write` → GET `grants` has 2 entries with preset labels, in order
    - approve `{scope: "mcp:read"}` → code exchanges to a token with `scope: "mcp:read"`;
      a refresh returns `scope: "mcp:read"`
    - approve with no body → token scope `mcp:read mcp:write`
    - approve `{scope: ""}` → 400 `{title: "Choose at least one permission"}`, request stays pending
    - approve `{scope: "mcp:write admin"}` → 400 `{title: "Scope was not requested"}`
    - request scope `mcp:read` only; approve `{scope: "mcp:write"}` → 400 (no widening)
    - no session → 401. `mcp_` and `mcpat_` bearers are rejected as they are today. A decided
      request → 409, and an expired one → 400, both unchanged.
    - `client_credentials` under `readWrite`, client stored with no `scope`, no `scope` param
      → token scope `mcp:read mcp:write` (today's "all supported" rule)
    - `client_credentials` under `readWrite`, client stored with `scope: "mcp"` → 400
      `invalid_scope` (documented break, T8)
  - Blast radius:
    - admin-spa consent posts approve with no body. Case: that path is covered above, and
      `admin-spa/e2e/integration/oauthConsent.integration.spec.ts` stays green in T7.
    - The `client_credentials` grant reads `scopesSupported` (`oauth.ts:858-861`), so the two
      cases above cover it.
  - Test skills: terreno-backend-tests
  - Docs: T8

- [ ] **T4** — Login methods allowlist on TerrenoLoginScreen
  - Depends on: none
  - Files: syncdb/src/auth/useLoginController.ts, syncdb/src/auth/TerrenoLoginScreen.tsx, syncdb/src/isolated/TerrenoLoginScreen.isolated.tsx, syncdb/src/isolated/useLoginController.isolated.ts
  - Criteria: An app can pass `methods` to show only some of the sign-in methods the server
    offers. It can hide methods but never show one the server does not offer.
  - Seam: rendered `TerrenoLoginScreen` and the `useLoginController` options
  - Interface: `methods?: {providers?: string[]; emailPassword?: boolean; passkey?: boolean}` on both.
    - Providers shown = the server's `providers` filtered to `methods.providers`, in the
      server's order. Undefined means all.
    - `emailPassword: false` hides the form, and `passkey: false` hides the passkey button.
    - `true` never shows a method the server disables.
  - Cases:
    - server offers google, github, apple; `methods.providers: ["google"]` → only the Google button
    - server offers google, `mock-oidc`; `providers: ["mock-oidc", "apple"]` → only the
      mock-oidc generic button (apple ignored)
    - `providers: []` → no social buttons, email form still shown
    - `emailPassword: false` with server `emailPassword: true` → no email form
    - `emailPassword: true` with server `emailPassword: false` → no email form
    - `methods` undefined → identical to today's render (existing isolated snapshot cases pass)
  - Blast radius: none (no state change)
  - Test skills: terreno-frontend-tests
  - Docs: T8

- [ ] **T5** — useMcpOAuthConsent hook
  - Depends on: T3
  - Files: syncdb/src/auth/useMcpOAuthConsent.ts, syncdb/src/isolated/useMcpOAuthConsent.isolated.ts, syncdb/src/auth/auth.ts
  - Criteria: One hook loads a consent request, tracks which grants are selected, and approves
    or denies through the app's API client. It hands back the redirect URL and a typed error kind.
  - Seam: exported `useMcpOAuthConsent` from `@terreno/syncdb/auth`
  - Interface: `useMcpOAuthConsent({requestId: string | undefined, onRedirect?: (url: string) => void}): {state: "loading" | "ready" | "submitting" | "error"; request?: {clientName: string | null; redirectHost: string; grants: Grant[]}; selectedScopes: string[]; toggleScope(scope): void; approve(): Promise<void>; deny(): Promise<void>; errorKind?: "missingRequest" | "notFound" | "decided" | "expired" | "signedOut" | "unknown"}`.
    - Uses the `ApiClientProvider` client: `GET /oauth/authorize/:id`, `POST …/approve` with
      `{scope: selectedScopes.join(" ")}`, and `POST …/deny`.
    - `onRedirect` defaults to `window.location.assign` on web and `Linking.openURL` on native.
  - Cases:
    - `requestId` undefined → `state "error"`, `errorKind "missingRequest"`, no fetch
    - GET 200 with 2 grants → `ready`, `selectedScopes` both, in order
    - `toggleScope("mcp:write")` → `["mcp:read"]`; `approve()` posts `{scope: "mcp:read"}` and
      calls `onRedirect` with the returned URL
    - toggling off every scope, then `approve()` → no request sent, `state` stays `ready`
    - `deny()` posts deny and calls `onRedirect` with the URL
    - GET 404 → `notFound`; 409 → `decided`; 400 → `expired`; 401 → `signedOut`; 500 → `unknown`
    - approve answering 409 → `errorKind "decided"`, `onRedirect` not called
  - Blast radius: none in this repo. The approve call changes server state, which T3 covers.
  - Test skills: terreno-frontend-tests
  - Docs: T8

- [ ] **T6** — TerrenoOAuthConsentScreen
  - Depends on: T4, T5
  - Files: syncdb/src/auth/TerrenoOAuthConsentScreen.tsx, syncdb/src/isolated/TerrenoOAuthConsentScreen.isolated.tsx, syncdb/src/auth/auth.ts
  - Criteria: One screen covers the whole consent route.
    - Signed out, it renders `TerrenoLoginScreen` with every option the app passed in
      `loginProps`. Social sign-in returns to the current URL.
    - Signed in, it shows the client name (or "An unnamed MCP client"), the redirect-host
      warning, a checkbox per grant, the signed-in email, and Approve and Deny buttons.
      Approve is disabled while no grant is checked.
    - Each error kind shows its copy.
  - Seam: rendered `TerrenoOAuthConsentScreen`
  - Interface: `TerrenoOAuthConsentScreen` props:
    - `requestId?: string`, default `?request=` from the web URL
    - `loginProps: Omit<TerrenoLoginScreenProps, "onSignedIn">` (required, because it carries
      the required `client` and `rememberedAccounts`), including `methods`, `title`, `logo`,
      and `providerLabels`
    - The screen's own `onSignedIn` calls `useSession().refresh()`. The consent card then
      renders from the refreshed session with no navigation.
    - `title?: string`
    - `logo?: ReactNode`
    - `grantLabels?: Record<string, {label: string; description?: string}>`, which overrides
      the server copy per scope
    - `onRedirect?: (url: string) => void`
    - `testID?: string`, default `"oauth-consent"`
    - Test ids: `${testID}-screen`, `${testID}-client-name`, `${testID}-grant-${scope}`,
      `${testID}-approve-button`, `${testID}-deny-button`, `${testID}-error`, `${testID}-signed-in-as`.
    - `callbackURL` defaults to `window.location.href` on web (including `?request=`), in
      cookie and bearer mode alike, unless `loginProps` sets one. The bearer handoff checks
      only the pathname, and lets the query through (`betterAuthOAuthHandoff.ts:316`).
    - Exported `MCP_OAUTH_CONSENT_ERROR_COPY: Record<ErrorKind, {title: string; message: string}>`:
      - `missingRequest`: "Missing authorization request" / "This link has no authorization request. Start the connection again from your app."
      - `notFound`: "Request not found" / "This authorization request does not exist. Check the link or start again."
      - `decided`: "Request already decided" / "This request was already approved or denied. Start the connection again from your app."
      - `expired`: "Request expired" / "Authorization requests expire after a few minutes. Start the connection again."
      - `signedOut`: "Sign in required" / "Your session ended, or this browser cannot decide this request. Sign in again."
      - `unknown`: "Could not complete the request" / "Something went wrong loading or deciding this request. Try again."
  - Cases:
    - session signed out → the login screen renders with `loginProps.methods` applied
      (`providers: ["google"]` → only Google), and the consent card is absent
    - successful inline email sign-in → `useSession().refresh` called once, then the consent
      card renders
    - signed-out web sign-in → `callbackURL` equals the current href, including `?request=abc`
    - bearer mode with no `callbackURL` override → the callbackURL is the href, including
      `?request=abc`
    - `loginProps.callbackURL` set → that value is passed through unchanged
    - signed in, 2 grants → 2 checked checkboxes with server labels;
      `grantLabels: {"mcp:read": {label: "View todos"}}` → that label shown
    - uncheck both → Approve disabled
    - Approve → `onRedirect` called with the URL
    - `clientName: null` → "An unnamed MCP client"
    - each `errorKind` → `${testID}-error` shows exactly the title and message listed in
      `MCP_OAUTH_CONSENT_ERROR_COPY` above
    - two-factor challenge during inline sign-in → the challenge renders inline, then the
      consent card appears with no navigation
  - Blast radius: none (no state of its own)
  - Test skills: terreno-frontend-tests
  - Docs: T8

- [ ] **T7** — Example apps: consent route, readWrite preset, e2e
  - Depends on: T2, T6
  - Files: example-backend/src/server.ts, example-frontend/app/oauth/consent.tsx, example-frontend/app/_layout.tsx, example-frontend/playwright.config.ts, example-frontend/e2e/mcpOAuthConsent.spec.ts, .circleci/continue-config.yml, docs/testing/e2e/example-frontend.md
  - Criteria:
    - example-backend uses `grants: "readWrite"`. `consentUrl` reads `MCP_OAUTH_CONSENT_URL`,
      defaulting to today's admin-spa `/console/oauth/consent`.
    - example-frontend serves `/oauth/consent` using `TerrenoOAuthConsentScreen`, reachable
      while signed out (the layout's auth redirect skips it). It passes the app's `methods`
      and branding.
    - Two places set `MCP_OAUTH_ENABLED=true`, `PUBLIC_API_URL=http://localhost:4000`, and
      `MCP_OAUTH_CONSENT_URL=http://localhost:8082/oauth/consent` on the backend:
      - the local Playwright backend (`playwright.config.ts`)
      - the CircleCI "Start example-backend" step (`continue-config.yml`, about `:401`), since
        CI starts the backend itself and Playwright reuses it
    - `mcpOAuthConsent` joins the `app` shard list (`continue-config.yml`, about `:483`).
    - Legal consents (Q7): a signed-in user who has not accepted the app's Terms, Privacy, and
      Consent forms sees `ConsentNavigator` before the OAuth consent card, as on every other
      route. E1's user accepts them in its setup, the way the existing auth specs do.
      Case: a fresh user who signs in on `/oauth/consent` sees the legal consent modal first,
      and after accepting it sees the OAuth consent card for the same request.
    - Screenshots of the signed-out and signed-in states go to `/opt/cursor/artifacts/`.
  - Seam: the running example stack (browser)
  - Interface: E1 and E2
  - Cases: E1 and E2 as written in `## E2E tests`
  - Blast radius:
    - `example-frontend/e2e/mcp-tokens.spec.ts` calls `/mcp`. With OAuth on, a request with
      no credentials now gets the RFC 9728 challenge. Re-run it and fix any assertion on the
      old body.
    - `admin-spa/e2e/integration/oauthConsent.integration.spec.ts` now sees `mcp:read mcp:write`
      scopes. Re-run it.
  - Test skills: terreno-frontend-tests, verify-ui-changes
  - Docs: `docs/testing/e2e/example-frontend.md` lists the new spec

- [ ] **T8** — Docs, user guide, and upgrade note for MCP OAuth grants
  - Depends on: T2, T3, T6, T9
  - Files: docs/how-to/enable-mcp-oauth.md, docs/reference/api.md, docs/reference/syncdb.md, docs/explanation/authentication.md, docs/user-guide/account/connect-ai-assistant.md, docs/user-guide/README.md (index row), docs/regression/auth.md, changelog/unreleased/mcp-oauth-grants.md
  - Criteria:
    - The how-to replaces "Scopes are not enforced for you" with the `grants` presets, custom
      grants, tool `access`/`scope`, and "write implies read".
    - Step 2 of the how-to shows `TerrenoOAuthConsentScreen` as the default consent page.
    - api.md documents `grants`, `McpOAuthGrant`, approve `{scope}`, and GET `grants`.
    - syncdb.md documents `TerrenoOAuthConsentScreen`, `useMcpOAuthConsent`, and login `methods`.
    - The upgrade note says what switching to `grants` breaks:
      - live `mcp`-scoped tokens stop working
      - confidential clients stored with `scope: "mcp"` get `invalid_scope`
      - custom tools default to `write`
    - The how-to says that turning on a provider (Google, Apple, GitHub) is server config
      (`googleOAuth`, `appleOAuth`, `githubOAuth`), and that `methods` only narrows the list
      on a screen (Q3).
    - The how-to says bearer-mode apps add the consent route's path to
      `oauthHandoff.callbackPaths`. The query (`?request=`) passes through on its own.
    - G1 is written in the user-guide page format and added to the README index. AUTH-new-1
      is added to the auth suite.
  - Cases: none (untestable: prose). Roast checks each documented signature against the code.
  - Test skills: none

- [ ] **T9** — Social sign-in returns to the consent screen in bearer mode
  - Depends on: T7
  - Files: example-backend/src/utils/betterAuthConfig.ts, example-backend/src/utils/betterAuthConfig.test.ts, example-frontend/lib/oauthHandoff.ts (comment only), example-frontend/playwright.config.ts, example-frontend/e2e/crossSiteMcpOAuthConsent.spec.ts
  - Criteria:
    - In the cross-site bearer build, a social sign-in started on `/oauth/consent?request=<id>`
      returns to `/oauth/consent` with the same request id, signed in.
    - `OAUTH_HANDOFF_CALLBACK_PATHS` is `["/login", "/oauth/consent"]`.
    - Token pickup already reads any path (`lib/oauthHandoff.ts`). E3 proves it on the
      consent path, and no logic changes.
  - Seam: the cross-site bearer stack (browser), plus the handoff start route
  - Interface:
    - E3.
    - The spec joins `CROSS_SITE_SPEC_FILES`. CI's `e2e-cross-site` job runs that list with
      the backend Playwright starts, so no CircleCI change is needed.
    - The `isCrossSiteBearerRun` backend env in `playwright.config.ts` adds
      `MCP_OAUTH_ENABLED=true`, `PUBLIC_API_URL=http://127.0.0.1:4000`, and
      `MCP_OAUTH_CONSENT_URL=http://localhost:8082/oauth/consent`.
  - Cases:
    - E3
    - `GET {basePath}/oauth-handoff/start` with
      `callbackURL=http://localhost:8082/oauth/consent?request=abc` on an allowed web origin →
      302 (today it returns 400)
    - with `callbackURL=http://localhost:8082/elsewhere` → still 400
    - `betterAuthConfig.test.ts` expects `["/login", "/oauth/consent"]`
  - Blast radius: the existing cross-site specs (`crossSiteOAuth`, `crossSiteLogin`) share
    the handoff config. Re-run them.
  - Test skills: terreno-frontend-tests, terreno-backend-tests

## Assumptions

- **Write implies read.** A token holding a `write`-access grant can call `read` tools. This
  keeps every non-empty checkbox subset coherent, which is what lets the user narrow (D2).
- The consent hook calls the consent endpoints through the syncdb `ApiClientProvider` client.
  It does not use generated hooks, because syncdb is a library and cannot import an app's
  `apiSdk.ts`. admin-spa's `store/mcpOAuthConsentApi.ts` does the same.
- Refused tools are left off the per-request MCP server instance. A call to one fails the way
  the MCP SDK fails an unknown tool, so no new error code is needed.
- Consent stays a web-first flow, since OAuth clients open a browser. On native the screen
  renders and redirects with `Linking.openURL` (Q4).

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q1 | How do custom grants map to tools? | A grant's `access` level applies to every untagged tool. A tool that declares `scope` requires exactly that scope. | Covers per-area grants ("todos") without per-tool lists on every grant | Per-grant tool allowlists add a `tools` field to `McpOAuthGrant` and a different `canUseMcpTool` | T1, T2, T8 |
| Q2 | When an app switches from the default `mcp` scope to `grants`, what happens to live `mcp`-scoped tokens? | They get no tools, and the user reconnects. This is documented in the upgrade note. | Mapping `mcp` to full access would hand write to tokens the user never saw a grant for | Treat legacy `mcp` as read/write: one case and one doc line change | T2, T8 |
| Q3 | You asked to "pass in enabling google/apple/etc." Should the screen prop be able to turn on a provider the server does not offer? | No. Turning a provider on stays in server config (`googleOAuth`, `appleOAuth`). The screen's `methods` prop picks which of those to show, and the docs say so. | A button for a provider without server credentials fails at sign-in | An override would need the screen to ignore `/terreno/methods`. The T4 cases flip, and T8 changes. | T4, T8 |
| Q4 | Must consent work natively, not just render? | Render on native and redirect with `Linking.openURL`. Only the web path gets e2e coverage. | MCP clients run the flow in a browser | A Maestro device flow and native return handling add a task | T5, T6 |
| Q5 | With `grants` unset, keep today's unenforced `mcp` scope, or default new apps to `readWrite`? | Keep it unenforced (no breaking change). The example app and create-terreno-app docs show `readWrite`. | Existing deployments keep working untouched | A default flip is a breaking change and needs a major-version note | T1, T8 |
| Q7 | Should the app's legal consent forms (Terms, Privacy, Consent) gate the OAuth consent screen for a user who has not accepted them? | Yes. `/oauth/consent` behaves like every other signed-in route, so the legal modals come first, then the grant. | A user should not hand an agent their data before accepting the terms that cover it. This matters for a PHI app. | Exempting `/oauth/consent` from `ConsentNavigator` changes one layout branch and the T7 case | T7 |
| Q6 | Is a design canvas or a screenshot proposal needed before the build? | No. The screen reuses the shipped login screen and admin-spa's consent layout plus checkboxes, and T7 attaches screenshots to the PR. | The look is not the point of the request | Add a canvas pass before T6 | T6 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Switch admin-spa's consent page and login to `TerrenoOAuthConsentScreen` and `TerrenoLoginScreen` | admin-spa has a hand-written login and consent page (D3) | M | T6 |
| X2 | "Connected apps" screen: list and revoke a user's MCP OAuth grants | Users can grant but only revoke by password reset | M | T3 |
| X3 | Per-model grants (for example "todos read") generated from `modelRouter` | Custom grants make it possible; presets do not offer it | M | T2 |
| X4 | "Use a different account" link on the consent screen | A signed-in user approving for the wrong account must sign out elsewhere | S | T6 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 (durable) | Should a read-only MCP OAuth grant be enforced by the server? | Yes, the server enforces it. Tools are tagged read/write. tools/list hides and tools/call refuses what the token's grants do not allow. Apps without `grants` keep today's behaviour. | T2 exists. The how-to drops "not enforced". |
| D2 | Who decides which grant a client gets? | The user can narrow it on the consent screen to a non-empty subset of what was requested | T3 approve `{scope}`; T5/T6 checkboxes |
| D3 | Where does the reusable screen ship? | `@terreno/syncdb/auth` plus an example-frontend route. admin-spa is unchanged. | X1 parked; T6, T7 |

## Sign-off

Status: approved 2026-11-16
Cut: 2 rounds, 16 findings (4 blocking).
- Round 1: 8 findings, all fixed. CI wiring went into T7, and the bearer handoff became T9. The filter-vs-enable providers finding is also surfaced as Q3.
- Round 2: 8 findings. 7 were fixed, among them the cross-site env moving into `playwright.config.ts`, the bearer `callbackURL` keeping the full href, and the `client_credentials` intersection. One moved to questions as Q7 (legal consents gate).
- 0 rebutted.
- The one item cut couldn't check, whether a Better Auth bearer session reaches the consent endpoints, was checked by hand. `bearer()` is always registered (`api/src/betterAuthSetup.ts:349`), and `authenticateMiddleware()` passes when `req.user` is already set. E3 proves it end to end.
