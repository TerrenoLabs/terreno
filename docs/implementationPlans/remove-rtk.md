# Implementation Plan: Remove @terreno/rtk and Redux in Terreno 58

**Status:** Approved  
**Roadmap:** Area=`syncdb`, Target=`58`, Impact=`Breaking`  
**Branch:** `remove-rtk-58` (one PR into `release-58.0.0`)  
**Owner:** Josh Gachnang  
**Created:** 2026-10-20  
**Target:** Terreno **58.0.0** (breaking)

## Goal

Delete the `@terreno/rtk` package and every Redux dependency from the monorepo. After this
change `@terreno/syncdb` is the only frontend data and session layer:

- Synced collections use `useQuery` / `useMutate` (unchanged).
- Every other HTTP call (`/auth/me`, modelRouter actions, AI, consents, announcements,
  version check) goes through a new syncdb request client with generated, typed hooks.
- Session state comes from `@terreno/syncdb/auth` (Better Auth, plus a ported JWT adapter).
- Feature flags and server pushes ride syncdb's existing socket.
- GptHistory and McpServiceToken become synced collections.
- All unit and e2e tests exercise these syncdb paths. No test imports RTK or Redux.

This fulfils the promise in `rtk/README.md`: rtk is not published in the next major.

## Non-Goals

- Backend JWT/Passport auth (`api/src/auth.ts`) stays. Only the frontend RTK slice is replaced.
- Frozen `website/versioned_docs/**` snapshots are not edited.
- Syncing any ObjectId model other than GptHistory and McpServiceToken (e.g. User, PushToken,
  AIRequest, AIDataset).
- Replacing SSE streaming for `/gpt/prompt` and `/gpt/histories/:id/stream`. They stay
  `fetch`-based, authenticated through the new client's auth provider.
- Converting `api/src/auth.ts` / `authRecovery.ts` `router.*` routes to modelRouter actions.
  Codegen reads them from OpenAPI as-is.

## Decisions

| Question | Decision |
|----------|----------|
| How far does removal go? | Delete the whole `@terreno/rtk` package. |
| Which release? | Terreno 58.0.0, on the `release-58.0.0` line. |
| Does Redux go too? | Yes. Remove `@reduxjs/toolkit`, `react-redux`, `redux-persist`, `@rtk-query/codegen-openapi` from both apps, the generators, and the catalog. App state moves to React context / `useStoredState`. |
| Where do non-collection calls go? | Inside `@terreno/syncdb`: a request client + `useApiQuery` / `useApiMutation`, generalized from admin-frontend's `adminRequest` / `useAdminRpc`. |
| GptHistory / McpServiceToken (ObjectId)? | Make both synced collections. |
| GptHistory data migration | Migration shipped in `@terreno/ai` re-inserts each history with `_id` = its ObjectId hex string, rewrites `AIDataset.historyId`, deletes originals. New rows get UUIDs. |
| McpServiceToken shape | Synced read-only (sync `responseHandler` strips `tokenHash`; client create/update/delete disabled). Create and revoke stay modelRouter actions called through the request client. Same hex-string `_id` migration. |
| Home for non-data leftovers | syncdb subpaths: `/auth`, `/config`, `/flags`, `/app`. |
| Replacement for `useSocketConnection` | An event-subscription API on syncdb's existing socket. Flags refetch on push. One socket per app. |
| Codegen scope | Typed hooks for **every** non-synced OpenAPI operation (anything without `x-terreno-sync`). Replaces `@rtk-query/codegen-openapi` and the RTK `bun run sdk`. |
| `@terreno/ui` consent / announcement hooks | Take a structural `client` prop (minimal request-client interface declared in ui). ui gains no dependency on syncdb. |
| rtk features with no consumers | Delete offline middleware, `sessionApi`, `useServerStatus`, `useCan`, `useTerrenoChat`, `generateTags`, `mongooseSlice`, dev store. **Port** legacy JWT frontend auth into `@terreno/syncdb/auth`. Replace MCP `get_rtk_state` and `terreno state --slice rtk` with the existing syncdb state tools. |
| PR shape | One PR. Tasks still land expand → migrate → contract on the branch, each leaving the branch green. |
| 13 frontend-called routes are missing from OpenAPI (`/auth/me` + auth recovery, flags, version check, consents, announcements, `/files/upload`) — how does codegen cover them? | Document them in OpenAPI in their owning packages (`api`, `feature-flags`, `announcements`, `ai`) so codegen covers every call and `/auth/me` gets the app's own User type. |

## Architecture

### Before

```
example-frontend / admin-spa
  Redux store ── betterAuth slice (@terreno/rtk) ── appState slice ── redux-persist
             └── RTK Query api (store/betterAuthApi.ts + generated openApiSdk.ts)
  @terreno/rtk: useSocketConnection, useFeatureFlags, useUpgradeCheck, baseUrl, ...
  @terreno/syncdb: synced collections only (baseUrl passed in from rtk)
```

### After

```
@terreno/syncdb
  .              createSyncDb, collections, sync socket (+ new socket event API)
  /react         useQuery, useMutate, ... + useApiQuery, useApiMutation, ApiClientProvider
  /api           createApiClient (fetch; auth from AuthProvider; envelope unwrap; tags)
  /auth          createBetterAuthClient, betterAuthAdapter, SessionProvider/useSession,
                 jwtAuthAdapter + useJwtAuth (ported JWT login/refresh/logout)
  /config        baseUrl, baseWebsocketsUrl, resolveBaseUrls, resolveDevApiPort
  /flags         useFeatureFlags, useTerrenoFeatureFlags (client + socket push, OpenFeature)
  /app           useUpgradeCheck, canOpenAdminPage/hasPermission, installDevConsoleLogger,
                 useMCPTools
  /buildNumber   coerceBuildNumber, resolveBuildNumber (node-only)
  codegen        `terreno-syncdb generate` emits collection hooks (today) AND typed hooks
                 for every non-synced operation (new)
```

The request client and syncdb share one `AuthProvider` (`getToken`, `refresh`, `onAuthChange`),
so 401 → refresh → retry behaves the same for sync and RPC. The client keeps
`useAdminRpc`'s call shape (`{data, error, isLoading, isFetching, refetch}`,
`[trigger, {isLoading}]` with `.unwrap()`), plus what the app needs that admin did not: a
shared per-client cache keyed by URL+args (dedupes identical queries), lazy queries,
imperative `client.request`, tag invalidation, `App-Version` / `App-Platform` headers,
and `credentials` for cookie SPAs.

admin-frontend's `adminRequest` / `useAdminRpc` become thin wrappers over the syncdb client so
there is one implementation.

### Session without Redux

`SessionProvider` subscribes to the Better Auth session atom (already bridged by
`bridgeBetterAuthReactClient`) and exposes `useSession()` → `{userId, user, isLoading,
isAuthenticated, error, logout}`. `logout` signs out, stops syncdb, and wipes local data.
JWT apps use `jwtAuthAdapter` (SecureStore / AsyncStorage tokens, mutex refresh, refresh
when < 2 min to expiry, 401 → refresh → retry) and `useJwtAuth()` (`login`, `signup`,
`googleLogin`, `resetPassword`, `logout`), feeding the same `SessionProvider`.

### Socket events

syncdb's socket transport gains `client.onSocketEvent(name, handler) → unsubscribe` and
`useSocketEvent(name, handler)`. The RealtimeApp server already hosts that socket; feature
flags subscribe to their existing push event and refetch `/feature-flags/flagConfiguration`.

## Models

| Model | Change |
|-------|--------|
| `GptHistory` (`ai/src/models/gptHistory.ts`) | `_id: String` (UUID default), `isDeletedPlugin` + `syncPlugin`. |
| `AIDataset.historyId` (`ai/src/models/aiDataset.ts`) | Ref type `String`. |
| `McpServiceToken` (`api/src/models/mcpServiceToken.ts`) | `_id: String`, `isDeletedPlugin` + `syncPlugin`. |

Migrations (`api/src/migrations` framework):

- `@terreno/ai` migration `gpt-history-string-ids`: for each ObjectId `_id` row, insert a copy with
  `_id = oid.toHexString()`, update `AIDataset.historyId` refs to the hex string, delete the
  original. Idempotent (skips rows whose `_id` is already a string). Runs in batches.
- `@terreno/api` migration `mcp-service-token-string-ids`: same approach for McpServiceToken.

## APIs

| Route | Change |
|-------|--------|
| `/gpt/histories` | `modelRouter` gains `sync: {scope: owner}`. Existing REST CRUD stays for headless clients. |
| `/gpt/prompt`, `/gpt/histories/:id/stream`, `/gpt/histories/:id/turn`, `/gpt/actions` | Accept string history ids. |
| `/mcp/service-tokens` | Becomes `modelRouter("/mcp/service-tokens", McpServiceToken, {sync, ...})` with client writes disabled; `collectionActions.create` returns the plaintext once; `instanceActions.revoke`. |
| Feature-flags deprecation message (`feature-flags/src/featureFlagsApp.ts:150`) | Names `@terreno/syncdb/flags`. |

## UI

- `ConsentNavigator`, `AnnouncementNavigator` and their hooks take `client: TerrenoRequestClient`
  (structural interface in `ui/src/requestClient.ts`) instead of `api`.
- No visual change. example-frontend's AI screen, MCP settings, profile, admin layout, auth screens,
  documents, and notifications must behave the same; verified with screenshots in the PR.

## Phases

1. **Expand (syncdb):** request client + hooks, codegen for non-synced ops, `/config`, `/auth`
   (Better Auth + JWT), socket events + `/flags`, `/app`.
2. **Backend sync:** GptHistory and McpServiceToken synced, with migrations.
3. **Migrate consumers:** ui, example-frontend, admin-spa, admin-frontend, generators, MCP/cli tools,
   tests.
4. **Contract:** delete `rtk/`, CI, scripts, configs; docs and rules; full verification.

## Feature Flags & Migrations

- No runtime flag; this is a major-version break.
- Two data migrations (above). Upgrade notes tell operators to run migrations before deploying
  58 frontends.

## Not Included / Future Work

- Syncing User/profile (`/auth/me`) or other ObjectId models.
- Moving SSE chat streaming onto sync deltas.

## Files to Create / Modify

See [`docs/tasks/remove-rtk.md`](../tasks/remove-rtk.md) for per-task files.

## Task List

[`docs/tasks/remove-rtk.md`](../tasks/remove-rtk.md)

## Acceptance Criteria

| # | Criterion | Verification |
|---|-----------|--------------|
| AC1 | `rtk/` does not exist and no workspace references it. | `test ! -d rtk`; `rg -l '@terreno/rtk' -g '!website/versioned_docs/**' -g '!CHANGELOG.md' -g '!changelog/**' -g '!docs/implementationPlans/**' -g '!docs/tasks/**' -g '!**/upgrades/**'` → no hits outside upgrade/migration prose. |
| AC2 | No Redux in the repo's packages. | `rg -l '@reduxjs/toolkit\|react-redux\|redux-persist\|@rtk-query/codegen-openapi' -g 'package.json' -g '*.ts' -g '*.tsx' -g 'bun.lock'` → no hits. |
| AC3 | Everything builds and every suite passes with no test importing or mocking RTK. | `bun install && bun run compile`; `bun run test:agent` green; `rg -l "store/sdk\|openApiSdk\|betterAuthApi\|injectEndpoints" -g '*.test.*' -g '*.isolated.*' -g '*.spec.ts'` → no hits. |
| AC4 | E2E and Maestro pass; RTK console-allowlist entries are gone and no new allowlist entries were added. | `bun run frontend:e2e` (all shards), `bun run admin-spa:test` + its e2e, `bun run maestro:test`; `rg "rejected query\|rejected mutation\|terrenoFlagConfiguration\|SocketConnection" example-frontend/e2e` → no hits. |
| AC5 | GptHistory and McpServiceToken migrations rewrite ids and refs and are idempotent. | Bun tests in `ai/` and `api/` against the in-memory replica set: seed ObjectId rows + AIDataset refs → run twice → string ids, refs match, counts equal. |
| AC6 | Synced McpServiceToken payloads never contain `tokenHash`; plaintext is returned only by the create action. | `api` sync snapshot + delta tests assert absence; action test asserts plaintext once. |
| AC7 | example-frontend opens exactly one socket.io connection when logged in, and a flag change pushed by the server updates the UI. | Playwright spec counting `socket.io` websocket connections; flags spec toggling a flag via API. |
| AC8 | Generated SDK covers every non-synced operation and is typed. | syncdb codegen tests against fixture spec; `example-frontend` `bun run sdk` then `bun run compile`. |
| AC9 | JWT frontend auth works without Better Auth. | Ported bun tests from `authSlice` / `emptyApi` (login, refresh before expiry, 401 refresh-retry, mutex, logout) pass against `jwtAuthAdapter`. |
| AC10 | Scaffolded apps build without rtk/Redux. | `create-terreno-app` generate tests + compile of a generated app; `mcp-server` tests. |
| AC11 | Changed screens verified in a running app. | Screenshots/videos under `/opt/cursor/artifacts/` attached to the PR: login, profile, AI chat (list/rename/delete history), MCP tokens, consents, announcements, admin layout, admin-spa login. |
| AC12 | Docs and rules describe the new layout; nothing tells users to install `@terreno/rtk`. | `bun run skills:sync` and rulesync regenerate cleanly; `website` docs-audit passes; 58.0.0 upgrade notes cover every removed export with its replacement. |
