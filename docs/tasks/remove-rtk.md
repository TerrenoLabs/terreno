# Task List: Remove @terreno/rtk and Redux in Terreno 58

See: [`docs/implementationPlans/remove-rtk.md`](../implementationPlans/remove-rtk.md)

**Target:** Terreno **58.0.0**, branch `remove-rtk-58`, one PR into `release-58.0.0`.

Wide refactor: **expand → migrate → contract**. Every task leaves the branch compiling and
green. Phase 4.1 (delete `rtk/`) is blocked by every migration task.

**Supporting skills:** `terreno-data-fetching`, `terreno-backend-api`,
`mongoose-schema-safety`, `building-terreno-apps`, `building-admin-interfaces`, `terreno-ui`,
`backend-test-env`, `verify-ui-changes`, `update-docs`, `generate-sdk` (rewrite in 4.2).

## Phase 1: Expand syncdb

- [x] **Task 1.1** (tracer): Request client + query/mutation hooks + `/config`
  - Delivers: `createApiClient({baseUrl, authProvider, credentials?, headers?})` and `useApiQuery` / `useLazyApiQuery` / `useApiMutation` / `ApiClientProvider`, with a shared per-client cache keyed by URL+args, tag invalidation, `{data}` / list-envelope unwrap matching RTK, 401 → `authProvider.refresh` → retry, `App-Version` / `App-Platform` headers. `@terreno/syncdb/config` exports `baseUrl`, `baseWebsocketsUrl`, `resolveBaseUrls`, `resolveDevApiPort` (moved from `rtk/src/constants.ts` with their tests). example-frontend profile screen reads `GET /auth/me` through `useApiQuery`; `store/syncdb.ts` imports `baseUrl` from `@terreno/syncdb/config`.
  - Files: `syncdb/src/api/{client,cache,hooks}.ts` + tests, `syncdb/src/config/baseUrl.ts` + tests, `syncdb/package.json` exports, `admin-frontend/src/{adminRequest,useAdminRpc}.ts` (wrap the syncdb client), `example-frontend/app/(tabs)/profile.tsx`, `example-frontend/store/syncdb.ts`
  - Blocked by: none
  - Acceptance: bun tests for dedupe, tag invalidation, envelope unwrap, refresh-retry, abort/timeout; admin-frontend tests still pass unchanged; profile e2e passes
  - Docs: `docs/reference/syncdb.md` (API client, config sections)

- [x] **Task 1.2**: Codegen for every non-synced OpenAPI operation
  - Delivers: `terreno-syncdb generate` also emits typed request/response types and `useXQuery` / `useXMutation` hooks for every operation without `x-terreno-sync`, including plain routes (`/auth/me`, `/consents/pending`, `/files/upload` multipart, `/version-check`). Tags inferred per path. example-frontend `bun run sdk` runs it and writes `store/apiSdk.ts`; profile screen switches to the generated `useGetAuthMeQuery`.
  - Also: add OpenAPI docs for the 13 frontend-called routes the spec omits — `GET/PATCH /auth/me`, `POST /auth/{sendVerification,forgotPassword,verifyEmail}`, `POST /resetPassword` (`api`); `GET /feature-flags/flagConfiguration` (`feature-flags`); `GET /version-check` (`api`); `GET /consents/pending`, `POST /consents/respond` (`api`); `GET /announcements/{pending,feed}`, `POST /announcements/{id}/{acknowledge,click,impression}` (`announcements`); `POST /files/upload` multipart (`ai`).
  - Files: `syncdb/src/codegen/{emitApi,discoverOperations}.ts` + fixtures/tests, `syncdb/src/codegen/{cli,generate}.ts`, `example-frontend/scripts/generate-sdk.ts`, `example-frontend/store/apiSdk.ts` (generated), OpenAPI registrations in the owning packages + their route tests
  - Blocked by: 1.1
  - Acceptance: codegen tests against fixture spec cover query, mutation, path params, multipart, synced ops excluded; generated file compiles in example-frontend; live `/openapi.json` lists all 13 previously missing routes
  - Docs: `docs/reference/syncdb.md` (codegen), `docs/how-to/` page for regenerating the SDK

- [x] **Task 1.3**: `@terreno/syncdb/auth` — Better Auth client + session without Redux
  - Delivers: `createBetterAuthClient`, `createStorageAdapter`, cookie-jar repair (moved with tests), `SessionProvider` + `useSession()` → `{userId, user, isLoading, isAuthenticated, error, logout}`; `logout` signs out, stops syncdb, wipes local data. example-frontend `lib/betterAuth.ts` imports from syncdb.
  - Files: `syncdb/src/auth/{betterAuthClient,session,SessionProvider}.ts(x)` + tests, `syncdb/package.json` (move `better-auth`, `@better-auth/expo`, `expo-secure-store`, async-storage deps/peers), `example-frontend/lib/betterAuth.ts`
  - Blocked by: 1.1
  - Acceptance: ported `betterAuthClient` / `betterAuthSlice` behaviours as hook tests (session sync on start, after login, logout side effects)
  - Docs: `docs/reference/syncdb.md` (auth), `docs/explanation/authentication.md`, `docs/how-to/configure-better-auth.md`

- [x] **Task 1.4**: Port legacy JWT frontend auth
  - Delivers: `jwtAuthAdapter` (token storage on SecureStore/AsyncStorage, refresh when < 2 min to expiry, mutex, 401 → refresh → retry, logout on refresh failure) and `useJwtAuth()` (`login`, `signup`, `googleLogin`, `resetPassword`, `logout`) feeding `SessionProvider`; token-expiry helpers (`getTokenExpirationTimes`, `shouldShowStillThereModal`).
  - Files: `syncdb/src/auth/{jwtAuthAdapter,useJwtAuth,tokenExpiry}.ts` + tests (ported from `rtk/src/authSlice*.test.ts`, `rtk/src/isolated/emptyApi*.isolated.ts`)
  - Blocked by: 1.3
  - Acceptance: AC9 — ported tests pass against an `api` test server using JWT auth
  - Docs: `docs/explanation/authentication.md`, `docs/reference/syncdb.md`

- [x] **Task 1.5**: Socket event API + `@terreno/syncdb/flags`
  - Delivers: `client.onSocketEvent` / `useSocketEvent`; `useFeatureFlags(client)` / `useTerrenoFeatureFlags` (OpenFeature provider) fetching via the request client and refetching on the flags push event. example-frontend `_layout.tsx` drops `useSocketConnection` / `useRealtimeDebug`. Server deprecation message updated.
  - Files: `syncdb/src/sync/socketTransport.ts`, `syncdb/src/react/useSocketEvent.ts`, `syncdb/src/flags/*` + tests (ported from `rtk/src/useFeatureFlags.test.ts`, `useTerrenoFeatureFlags.test.ts`), `feature-flags/src/featureFlagsApp.ts`, `example-frontend/app/_layout.tsx`, `(tabs)/{ai,documents,profile}.tsx`
  - Blocked by: 1.1
  - Acceptance: AC7 — Playwright spec asserts one socket.io connection and a pushed flag change updates the UI
  - Docs: `docs/reference/feature-flags.md`, `docs/how-to/add-feature-flags.md`, `docs/how-to/websocket-integration.md`

- [x] **Task 1.6**: `@terreno/syncdb/app` and `/buildNumber`
  - Delivers: `useUpgradeCheck` (on the request client), `hasPermission` / `canOpenAdminPage`, `installDevConsoleLogger`, `useMCPTools` (token from the shared AuthProvider, fixing the Better Auth gap), `buildNumber` node subpath — all moved with tests. example-frontend uses them.
  - Files: `syncdb/src/app/*`, `syncdb/src/buildNumber.ts` + tests, `example-frontend/app/_layout.tsx`, `app/admin/_layout.tsx`, `(tabs)/{ai,profile}.tsx`
  - Blocked by: 1.1
  - Acceptance: ported `useUpgradeCheck*`, `usePermissions`, `devConsoleLogger`, `useMCPTools`, `buildNumber` tests pass
  - Docs: `docs/how-to/upgrade-banner.md`, `docs/how-to/expose-mcp-tools.md`, `docs/reference/syncdb.md`

## Phase 2: Backend sync for GptHistory and McpServiceToken

- [x] **Task 2.1**: GptHistory synced with string ids + migration
  - Delivers: String `_id` (UUID default), `syncPlugin` + `isDeletedPlugin`, `sync: {scope: owner}` on `/gpt/histories`; `AIDataset.historyId` String; `gpt-history-string-ids` migration; SSE / turn / actions routes accept string ids. Backend example registers the stream.
  - Files: `ai/src/models/{gptHistory,aiDataset}.ts`, `ai/src/routes/{gptHistories,gpt,gptActions}.ts`, `ai/src/migrations/gptHistoryStringIds.ts` + tests, `example-backend/src/server.ts`
  - Blocked by: none
  - Acceptance: AC5; existing `ai` route tests pass with string ids; sync snapshot test returns only the owner's histories
  - Docs: `docs/reference/ai.md`, `.rulesync/rules/ai/00-ai.md`, 58.0.0 upgrade notes (run migration first)
  - Skills: `mongoose-schema-safety`

- [x] **Task 2.2**: McpServiceToken synced read-only + actions + migration
  - Delivers: `modelRouter("/mcp/service-tokens", McpServiceToken, {sync})` with client writes disabled, sync `responseHandler` stripping `tokenHash`; `collectionActions.create` (plaintext once), `instanceActions.revoke`; `mcp-service-token-string-ids` migration; `verify` unchanged.
  - Files: `api/src/models/mcpServiceToken.ts`, `api/src/mcp/serviceTokens.ts`, `api/src/migrations/` (built-in migration), tests
  - Blocked by: none
  - Acceptance: AC6; migration idempotence test; existing MCP auth tests pass
  - Docs: `docs/reference/mcp-server.md` / service-token how-to, upgrade notes

## Phase 3: Migrate consumers

- [x] **Task 3.1**: `@terreno/ui` consents and announcements take `client`
  - Delivers: `TerrenoRequestClient` structural interface; `ConsentNavigator`, `AnnouncementNavigator`, `useConsentForms`, `useSubmitConsent`, `useAnnouncements`, `useAcknowledgeAnnouncement` take `client`; no `injectEndpoints`. Tests use a fake client.
  - Files: `ui/src/requestClient.ts`, the six source files above and their tests, `ui/src/OfflineBanner.tsx` (JSDoc)
  - Blocked by: 1.1
  - Acceptance: ui suite green; `rg injectEndpoints ui/src` → none
  - Docs: `docs/reference/ui.md` (consent / announcement props)

- [x] **Task 3.2**: example-frontend — remove Redux store, session, auth screens
  - Delivers: delete `store/index.ts`, `store/appState.ts` Redux slice (→ context + `useStoredState`), `store/errors.ts` middleware (→ client `onError` reporting to Sentry), `store/betterAuthApi.ts`; root layout uses `SessionProvider` + `ApiClientProvider`; login, signup, forgot / reset password, verify email use generated hooks / `useSession`.
  - Files: `example-frontend/store/*`, `app/_layout.tsx`, `app/{login,signup,forgotPassword,resetPassword,verifyEmail}.tsx`, `lib/authRecoveryActions.ts`, related tests
  - Blocked by: 1.2, 1.3, 1.5, 1.6, 3.1
  - Acceptance: auth e2e shard green; unit suite green
  - Docs: `example-frontend/README.md`, `.rulesync/rules/example-frontend/00-example-frontend.md`

- [x] **Task 3.3**: example-frontend — profile, admin layout, notifications, documents, push tokens
  - Delivers: all remaining non-AI screens on generated hooks; `store/sdk.ts`, `store/openApiSdk.ts`, `store/commsOpenApiSdk.ts`, `openapi-config.ts`, `comms-openapi-config.ts` deleted.
  - Files: `app/(tabs)/{profile,documents}.tsx`, `app/admin/**`, `components/NotificationCenter.tsx`, `components/TodoSummaryCard.tsx`, `app/gcs-settings.tsx`, `hooks/useSyncLabEngines.ts`, `app/admin/SyncLabScreen.tsx`
  - Blocked by: 3.2
  - Acceptance: app + admin-core + admin-table e2e shards green
  - Docs: none beyond 3.2 (record skip)

- [x] **Task 3.4**: example-frontend — AI screen and MCP settings on syncdb
  - Delivers: `ai.tsx` histories via `useQuery("gptHistories")` / `useMutate` (rename, delete), no `updateQueryData` / `invalidateTags`; SSE uses the shared auth provider; MCP settings list via `useQuery("mcpServiceTokens")`, create/revoke via generated action hooks; `useMCPTools` from `/app`.
  - Files: `app/(tabs)/ai.tsx`, `app/settings/mcp/index.tsx`, `store/syncdb.ts` (collections), `lib/gptAsks.ts`
  - Blocked by: 2.1, 2.2, 3.2
  - Acceptance: `ai-chat` e2e green incl. list / rename / delete across reload; new MCP tokens spec green
  - Docs: `docs/how-to/` AI chat page if it names RTK hooks

- [x] **Task 3.5**: example-frontend tests off RTK
  - Delivers: `tests/bunSetup.ts` / `testPreload.ts` no longer import or mock `@/store/sdk`; `documents.test.tsx`, `NotificationCenter.test.tsx`, `orgMembersRoute.test.tsx`, `errors.test.ts`, `gptAsks.test.ts`, `TodoSummaryCard.test.tsx` use the syncdb client / fake transport; e2e allowlists and comments drop RTK entries (`consoleAllowlist.ts`, `syncdbSuite.ts`, `offlineHelpers.ts`, `adminAuth.ts`, `login` / `signup` / `admin-todo-crud` specs).
  - Files: listed above
  - Blocked by: 3.3, 3.4
  - Acceptance: AC3 and AC4 for example-frontend
  - Docs: none (record skip)

- [x] **Task 3.6**: admin-spa off Redux
  - Delivers: `StoreProvider` / `AdminGate` use `SessionProvider` (cookie mode); profile via the request client with `credentials: "same-origin"`; `store/sdk.ts` deleted; Redux deps removed.
  - Files: `admin-spa/components/{StoreProvider,AdminGate,AdminSpaShell}.tsx`, `admin-spa/app/orgs/index.tsx`, `admin-spa/store/*`, `admin-spa/src/adminSpaUiCoverage.test.tsx`, `admin-spa/package.json`, `admin-spa/metro.config.js`
  - Blocked by: 1.1, 1.3
  - Acceptance: `bun run admin-spa:test` + admin-spa e2e and integration specs green
  - Docs: `docs/reference/admin-spa*` / `docs/reference/admin-frontend.md` references

- [x] **Task 3.7**: admin-frontend RTK-shaped test doubles
  - Delivers: observability / prompts isolated tests use fake request clients instead of `injectEndpoints` APIs; RTK wording in assertions removed.
  - Files: `admin-frontend/src/isolated/{observabilityFakeApi,aiObservabilityScreens,AiPromptsListScreen,AiPromptEditorScreen,adminRpcHooks}.isolated.tsx`, the other test files named in the IP research
  - Blocked by: 1.1
  - Acceptance: admin-frontend suite green; `rg -i "rtk|injectEndpoints" admin-frontend/src` → none
  - Docs: `.rulesync/rules/admin-frontend/00-admin-frontend.md` (layout example imports `baseUrl` from `/config`)

- [x] **Task 3.8**: Generators, MCP tools, cli
  - Delivers: `create-terreno-app` scaffolds syncdb client, `SessionProvider`, generated `apiSdk.ts`, no Redux / rtk; `mcp-server` bootstrap templates, prompts, `tools.ts` (`generateInstallAdmin`), `resources.ts` (drop `terreno://docs/rtk`) updated; `get_rtk_state` and `terreno state --slice rtk` removed in favour of syncdb state tools.
  - Files: `create-terreno-app/src/generate.ts` + tests, `mcp-server/src/{tools,prompts,bootstrap,resources}.ts`, `mcp-server/src/docs/templates/**`, `mcp-server/src/local/**`, `cli/src/commands/project.ts`, `cli/src/help.ts` + tests
  - Blocked by: 1.2, 1.3, 1.5, 1.6
  - Acceptance: AC10; generated app compiles in a temp dir
  - Docs: `docs/how-to/create-a-terreno-app.md`, `docs/reference/mcp-server.md`, `docs/reference/cli.md`

## Phase 4: Contract

- [x] **Task 4.1**: Delete `rtk/` and its wiring
  - Delivers: `rtk/` removed; root workspaces, `rtk:*` scripts, catalog entries (`@reduxjs/toolkit`, `@rtk-query/codegen-openapi`, `redux-persist`, `react-redux`, `axios-retry`, `async-mutex`, `jwt-decode` if unused); metro aliases; `example-backend/Dockerfile`; `knip.jsonc`; `biome.jsonc`; `codecov.yml`; CircleCI (`config.yml`, `continue-config.yml`); GitHub workflows (`rtk-ci.yml` deleted; `publish-on-tag`, `cd`, `docs-deploy`, `eas-pr`, `frontend-example-deploy`, `admin-spa-ci`, `dependabot`, issue templates, `architectural-pr-review.ts`); `scripts/**` maps and their tests; `website/scripts` + docusaurus redirect; `mcp-server/scripts/sync-package-guidelines.ts`. Apps declare native deps rtk used to pull in (`expo-secure-store`, `@better-auth/expo`, `better-auth`, `socket.io-client`, `expo-network` if still used); Expo fingerprint change recorded.
  - Files: listed above, `bun.lock`
  - Blocked by: 3.1–3.8
  - Acceptance: AC1, AC2; `bun install && bun run compile`; `bun run check:knip`; `bun run analyze:full`
  - Docs: none beyond 4.2

- [x] **Task 4.2**: Docs, rules, skills, upgrade notes
  - Delivers: `docs/how-to/migrate-rtk-to-syncdb.md` rewritten as the 58 upgrade path (every removed export → replacement table); `docs/reference/legacy/rtk.md` and `docs/explanation/announcements/rtk-deprecation.md` updated to "removed in 58"; `docs/explanation/local-first-data.md`, `docs/reference/environment-variables.md`, remaining single mentions; `mcp-server/src/docs/upgrades/58.0.0.md`; `changelog/unreleased/remove-rtk.md`; `.rulesync/rules/rtk/00-rtk.md` deleted, root / syncdb / example-frontend / mcp-server rules updated; plugin skills (`terreno-data-fetching`, `building-terreno-apps`, `generate-sdk`, `upgrading-terreno`, `building-admin-interfaces`); `README.md`, `AGENTS.md`, `CLAUDE.md`, `CLAUDE-consumer.md`, `CONTRIBUTING.md`; regenerate rulesync outputs and `bun run skills:sync`.
  - Files: listed above
  - Blocked by: 4.1
  - Acceptance: AC12
  - Skills: `update-docs`, `update-agent-docs`

- [ ] **Task 4.3**: Full verification and UI evidence
  - Delivers: `bun run prepush`; full `frontend:e2e`; admin-spa e2e; `maestro:test`; screenshots / videos for AC11 under `/opt/cursor/artifacts/`.
  - Files: none (evidence only)
  - Blocked by: 4.2
  - Acceptance: AC3, AC4, AC11 with commands and artifact paths recorded in the PR Verification table
  - Skills: `verify-ui-changes`
