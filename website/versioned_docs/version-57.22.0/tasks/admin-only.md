# Task List: Admin-Only — Serve Admin SPA From a Terreno Backend

**Status:** Closed (2026-08-20) — IP complete. Shipped as `@terreno/admin-spa`. Open tasks below were not executed; see shipped code in `admin-spa/`.

*Structured task breakdown for automated implementation. Each task should be independently implementable and testable.*

See: `docs/implementationPlans/admin-only.md` for full plan.

## Phase 0: admin-frontend prop split (prerequisite — verified blocker)

- [ ] **Task 0.1**: Split `baseUrl` → `apiBase` + `routeBase` across admin-frontend
  - Description: Add optional `apiBase` and `routeBase` props alongside the existing `baseUrl` to every exported admin-frontend component. Internally resolve `const apiBase = props.apiBase ?? props.baseUrl; const routeBase = props.routeBase ?? props.baseUrl;`. Replace each occurrence: `useAdminConfig(api, baseUrl)` → `useAdminConfig(api, apiBase)`; `useAdminApi(api, baseUrl, modelName)` → `useAdminApi(api, apiBase, modelName)`; every `router.push(\`${baseUrl}/...\`)` and `href: \`${baseUrl}/...\`` → use `routeBase` instead.
  - Files: `admin-frontend/src/AdminModelList.tsx`, `AdminModelTable.tsx`, `AdminModelForm.tsx`, `AdminRefField.tsx`, `AdminScriptList.tsx`, `AdminVersionConfig.tsx`, `ConfigurationScreen.tsx`, `useAdminConfig.tsx`, `useAdminApi.ts`, `AdminScriptRunModal.tsx` (if it references baseUrl)
  - Depends on: none
  - Acceptance: `bun run admin-frontend:lint` + `bun run admin-frontend:compile` pass. Type-check passes.

- [ ] **Task 0.2**: Tests for prop split
  - Description: Add a focused test asserting that when `apiBase="/admin"` + `routeBase="/console"` are passed, `useAdminConfig` is called with `/admin` and `router.push` is invoked with `/console/${modelName}`. Also assert backward-compat: `baseUrl="/admin"` alone still works (both internally default to `/admin`).
  - Files: `admin-frontend/src/AdminModelList.test.tsx`, `AdminModelTable.test.tsx`
  - Depends on: 0.1
  - Acceptance: `bun run admin-frontend:test` passes with new assertions.

- [ ] **Task 0.3**: Verify embedded admin still works
  - Description: Run `example-frontend` against `example-backend`. Log in as admin, navigate to `/admin`, click through a model. Verify no regression. No code change expected — this is a verification step.
  - Files: (manual)
  - Depends on: 0.1
  - Acceptance: All embedded admin flows in example-frontend render and function identically to pre-Phase 0.

## Phase 1: Package scaffolding

- [ ] **Task 1.1**: Create `admin-spa/` workspace package files
  - Description: Create `package.json` (`@terreno/admin-spa`, version 0.13.0, deps mirror needed runtime: `@terreno/admin-frontend`, `@terreno/rtk`, `@terreno/ui`, `expo`, `expo-router`, `react`, `react-native-web`, `redux-persist`, `better-auth`; peer dep `@terreno/api`; dev deps mirror `example-frontend`). Add `tsconfig.json` (extends Expo preset, covers `app/`, `store/`, `components/`), `tsconfig.server.json` (covers `src/`, outputs `src/dist/`), `biome.jsonc` and `bunfig.toml` copied from `admin-frontend`, `babel.config.js` and `metro.config.js` copied from `example-frontend` (with workspace path adjustments), `app.json` with `web.output: "static"` and `extra.BASE_URL: "__SAME_ORIGIN__"`.
  - Files: `admin-spa/package.json`, `admin-spa/tsconfig.json`, `admin-spa/tsconfig.server.json`, `admin-spa/biome.jsonc`, `admin-spa/bunfig.toml`, `admin-spa/babel.config.js`, `admin-spa/metro.config.js`, `admin-spa/app.json`, `admin-spa/.gitignore` (must include `dist/`, `store/openApiSdk.ts`, `src/dist/`)
  - Depends on: none
  - Acceptance: `bun install` from root succeeds; `bun run --filter '@terreno/admin-spa' compile` is a no-op (succeeds with no source yet).

- [ ] **Task 1.2**: Register workspace in root and add scripts
  - Description: Add `"admin-spa"` to `workspaces` array in root `package.json`. Add `admin-spa:compile`, `admin-spa:lint`, `admin-spa:test`, `admin-spa:build`, `admin-spa:sdk` scripts mirroring the admin-backend/admin-frontend convention.
  - Files: `package.json` (root)
  - Depends on: 1.1
  - Acceptance: `bun install` resolves admin-spa; `bun run admin-spa:lint` runs (even with no source).

- [ ] **Task 1.3**: Stub server-side plugin entry
  - Description: Create `src/index.ts` exporting `AdminSpaServeApp` (stub class implementing `TerrenoPlugin` with empty `register()`). Create `src/appConfig.ts` with `AdminSpaAppConfig` interface and `DEFAULT_APP_CONFIG`. Run `tsc -p tsconfig.server.json` and verify `src/dist/` is produced.
  - Files: `admin-spa/src/index.ts`, `admin-spa/src/appConfig.ts`
  - Depends on: 1.1
  - Acceptance: `bun run --filter '@terreno/admin-spa' compile` outputs `src/dist/index.js` and `src/dist/appConfig.js`.

- [ ] **Task 1.4**: Stub Expo Router app entry
  - Description: Create minimal `app/_layout.tsx` (just `<Stack/>`) and `app/index.tsx` rendering a `<Box>Hello admin</Box>` from `@terreno/ui`. Goal: verify the static export pipeline works end-to-end before adding real logic.
  - Files: `admin-spa/app/_layout.tsx`, `admin-spa/app/index.tsx`
  - Depends on: 1.1
  - Acceptance: `bun run --filter '@terreno/admin-spa' build:web` produces `dist/index.html`, `dist/_expo/...`, no errors. Open `dist/index.html` in a browser → "Hello admin" renders.

## Phase 2: Same-origin BASE_URL support

- [ ] **Task 2.1**: Add `__SAME_ORIGIN__` sentinel to `@terreno/rtk`
  - Description: Add `export const SAME_ORIGIN_SENTINEL = "__SAME_ORIGIN__";` to `rtk/src/constants.ts`. Modify `resolveBaseUrls` signature to accept optional `windowOrigin?: string`. When `baseFromExtra === SAME_ORIGIN_SENTINEL` and `windowOrigin` (or `globalThis.location?.origin`) is set, return `{baseUrl: origin, baseTasksUrl: `${origin}/tasks`, baseWebsocketsUrl: `${origin.replace(/^http/, "ws")}/`}`. Module-level call passes `globalThis.location?.origin` (with safe `typeof` check).
  - Files: `rtk/src/constants.ts`
  - Depends on: none
  - Acceptance: Existing tests pass; new sentinel-aware path returns expected URLs.

- [ ] **Task 2.2**: Tests for same-origin sentinel
  - Description: Add tests to `rtk/src/constants.test.ts` covering: (a) sentinel + `windowOrigin: "https://api.example.com"` → `https://...` + `wss://...`; (b) sentinel + `windowOrigin: "http://localhost:4000"` → `http://...` + `ws://...`; (c) sentinel + no window origin → falls back to existing resolution; (d) non-sentinel BASE_URL is unchanged; (e) sentinel + isDev=true behaves the same as production for the sentinel path.
  - Files: `rtk/src/constants.test.ts`
  - Depends on: 2.1
  - Acceptance: `bun run rtk:test` passes including new cases.

## Phase 3: Express plugin

- [ ] **Task 3.1**: Implement `AdminSpaServeApp.register()`
  - Description: Implement `src/serve.ts`: resolve `basePath` (default `/console`), `distDir` (default `path.resolve(__dirname, "../../dist")` so it works from `src/dist/serve.js`), merged `appConfig`. Register three Express handlers: `express.static` for `_expo/` and `assets/` with `{immutable: true, maxAge: "365d"}`, `GET ${basePath}/app-config.json` returning JSON with `Cache-Control: no-store`, `GET ${basePath}{/*splat}` returning `index.html` with `Cache-Control: no-store`. Log at info level on mount.
  - Files: `admin-spa/src/serve.ts`, `admin-spa/src/index.ts` (export)
  - Depends on: 1.3
  - Acceptance: `bun run admin-spa:compile` produces `src/dist/serve.js`; manual import from Node ESM works.

- [ ] **Task 3.2**: Plugin unit tests
  - Description: Add `src/serve.test.ts` using `supertest`. Create a tmpdir with stub `index.html` ("STUB-SPA"), `_expo/static/js/web/foo.abc123.js` ("CONTENT"), and `assets/foo.png` (any bytes). Construct an Express app and register the plugin with `distDir` pointing at the tmpdir. Cases: `GET /console/` → 200 + STUB-SPA + `Cache-Control: no-store`; `GET /console/users` → 200 + STUB-SPA (fallback); `GET /console/users/abc123` → 200 + STUB-SPA; `GET /console/_expo/static/js/web/foo.abc123.js` → 200 + CONTENT + cache headers; `GET /console/app-config.json` → 200 + JSON with `brandName: "Terreno Admin"` (default) + `Cache-Control: no-store`; `GET /console/app-config.json` with custom appConfig → returns merged config; `GET /unrelated` → 404 (plugin doesn't catch outside `basePath`); custom `basePath: "/admin-ui"` works.
  - Files: `admin-spa/src/serve.test.ts`
  - Depends on: 3.1
  - Acceptance: `bun run admin-spa:test` passes all cases.

## Phase 4: SPA — gates and auth

- [ ] **Task 4.1**: AppConfigGate component
  - Description: Create `components/AppConfigGate.tsx`. Uses React context to expose `AdminSpaAppConfig`. On mount, fetches `./app-config.json` (relative to current URL — so `/console/app-config.json` when mounted at `/console`). Defines defaults to merge with response. Renders a centered `<Spinner>` with `testID="admin-spa-app-config-loading"` while loading. Errors → renders a `<Text>` with retry button. Exposes `useAppConfig()` hook.
  - Files: `admin-spa/components/AppConfigGate.tsx`
  - Depends on: 1.4, 3.1
  - Acceptance: Build succeeds; importing `useAppConfig` outside the gate throws a clear error.

- [ ] **Task 4.2**: StoreProvider component (replaces "factory function" pattern)
  - Description: Create `components/StoreProvider.tsx`. Reads `useAppConfig()`. Inside the component body, memo-builds `authClient = createAuthClient({baseURL: window.location.origin, basePath: appConfig.authBasePath ?? "/api/auth"})` using `better-auth/react` **directly** (NOT `@terreno/rtk`'s factory — that one is RN-targeted with the expo plugin). Builds `{betterAuthReducer, middleware, selectors} = generateBetterAuthSlice(authClient)`, then `store = configureStore({reducer: {betterAuth: betterAuthReducer, [openapi.reducerPath]: openapi.reducer}, middleware: (gdm) => gdm().concat(openapi.middleware, ...middleware)})`, then `persistor = persistStore(store)`. Wraps children: `<Provider store={store}><PersistGate loading={<Spinner testID="admin-spa-persist-loading"/>} persistor={persistor}>{children}</PersistGate></Provider>`. The `loading` prop is **required** — without it, AdminGate flashes the login screen during rehydration.
  - Files: `admin-spa/components/StoreProvider.tsx`, `admin-spa/store/sdk.ts` (re-exports `emptySplitApi as openapi` from `@terreno/rtk` with tag types)
  - Depends on: 4.1, 6.1
  - Acceptance: Build succeeds; type-check passes; no `expo-secure-store` import surfaces in the bundle (since this is web-only).

- [ ] **Task 4.3**: AdminGate component
  - Description: Create `components/AdminGate.tsx`. Wraps children. On mount, calls `authClient.getSession()`. Uses `useSelectIsAuthenticated`. Renders spinner with `testID="admin-spa-admin-gate-loading"` while loading. If unauth and not on `/login`, `router.replace("/login")`. If auth + `user.admin !== true` and not on `/forbidden`, `router.replace("/forbidden")`. If auth + admin and on `/login` or `/forbidden`, `router.replace("/")`. Otherwise pass through.
  - Files: `admin-spa/components/AdminGate.tsx`
  - Depends on: 4.2
  - Acceptance: Build succeeds; gate logic verifiable via unit test of selector behavior (`bun test`).

- [ ] **Task 4.4**: Login screen
  - Description: Create `app/login.tsx`. Reads `useAppConfig().providers`. Renders form with `TextField` (email) + `TextField` (password, type="password") + `Button` ("Sign in") calling `authClient.signIn.email({email, password})`. For each provider in `providers` that isn't `"email"`, renders a `SocialLoginButton`. Handles loading, error display. On success, `router.replace("/")`. testIDs as listed in IP.
  - Files: `admin-spa/app/login.tsx`
  - Depends on: 4.3
  - Acceptance: Rendering the SPA logged-out shows the login form; clicking submit attempts the better-auth signIn (verifiable by mock in unit test).

- [ ] **Task 4.5**: Forbidden screen + signout
  - Description: Create `app/forbidden.tsx`. Renders `<Page>` with heading "Admins only" and explanation text. Includes a "Sign out" button calling `authClient.signOut()` then `router.replace("/login")`.
  - Files: `admin-spa/app/forbidden.tsx`
  - Depends on: 4.3
  - Acceptance: Build succeeds; testID on screen root.

- [ ] **Task 4.6**: Root layout assembly (correct provider order)
  - Description: Update `app/_layout.tsx`. Order: `<AppConfigGate><StoreProvider><TerrenoProvider><AdminGate><Stack screenOptions={{headerShown: false}}>...</Stack></AdminGate></TerrenoProvider></StoreProvider></AppConfigGate>`. AppConfigGate is outermost because it has no Redux dependency and its result is needed to build the store. StoreProvider includes Provider + PersistGate. TerrenoProvider is inside Provider so theme hooks can read store state. AdminGate is innermost so it sees fully-hydrated state.
  - Files: `admin-spa/app/_layout.tsx`
  - Depends on: 4.1, 4.2, 4.3, 4.4, 4.5
  - Acceptance: `bun run admin-spa:build` succeeds with no Metro errors. Sequential render: loading splash → (rehydrating) spinner → (unauth) login OR (admin) model list. No login flash for authenticated admins.

## Phase 5: Wire admin screens

All screens pass `apiBase={appConfig.adminApiBasePath ?? "/admin"}` AND `routeBase=""` so navigation stays inside the SPA's `/console` root. Depends on Phase 0.

- [ ] **Task 5.1**: Model list screen
  - Description: `app/index.tsx` renders `<AdminModelList api={terrenoApi} apiBase={apiBase} routeBase={routeBase} />`. Get values from `useAppConfig()`: `const apiBase = appConfig.adminApiBasePath ?? "/admin"; const routeBase = "";`.
  - Files: `admin-spa/app/index.tsx`
  - Depends on: 4.6, 0.1
  - Acceptance: After login, model list renders models from `${apiBase}/config`. Clicking a model card calls `router.push("/${modelName}")` (relative to SPA root), NOT `/admin/${modelName}`.

- [ ] **Task 5.2**: Model table + form routes
  - Description: Create `app/[model]/_layout.tsx` (`<Stack/>`), `app/[model]/index.tsx` (renders `<AdminModelTable>`), `app/[model]/[id].tsx` (renders `<AdminModelForm id={id}>`), `app/[model]/create.tsx` (renders `<AdminModelForm>`). Use `useLocalSearchParams()` for params. Handle the `__scripts` and `version-config` sentinels like example-frontend does.
  - Files: `admin-spa/app/[model]/_layout.tsx`, `admin-spa/app/[model]/index.tsx`, `admin-spa/app/[model]/[id].tsx`, `admin-spa/app/[model]/create.tsx`
  - Depends on: 5.1
  - Acceptance: Navigating to `/console/Users` shows the table; clicking a row opens the form.

- [ ] **Task 5.3**: Configuration + scripts + version-config screens
  - Description: Create `app/configuration.tsx`, `app/scripts.tsx`, `app/version-config.tsx` wrapping the corresponding `@terreno/admin-frontend` screens (`ConfigurationScreen`, `AdminScriptList`, `AdminVersionConfig`).
  - Files: `admin-spa/app/configuration.tsx`, `admin-spa/app/scripts.tsx`, `admin-spa/app/version-config.tsx`
  - Depends on: 5.1
  - Acceptance: Each screen renders without errors.

- [ ] **Task 5.4**: Not-found + Expo Router conventions
  - Description: Create `app/+not-found.tsx` rendering a friendly 404 with link back to `/`. Add `app/+html.tsx` if needed for static export head config (favicon, viewport).
  - Files: `admin-spa/app/+not-found.tsx`, `admin-spa/app/+html.tsx`
  - Depends on: 4.6
  - Acceptance: Visiting `/console/nonexistent` shows the 404 screen.

## Phase 6: SDK glue (no codegen by default)

Admin endpoints are runtime-injected by `admin-frontend/src/useAdminApi.ts` — codegen is unnecessary for the admin flow itself.

- [ ] **Task 6.1**: Hand-written `store/sdk.ts`
  - Description: Create `store/sdk.ts` that re-exports `emptySplitApi as openapi` from `@terreno/rtk` and uses `.enhanceEndpoints({addTagTypes: ["admin-models", "admin-version-config", "admin-scripts", "profile"]})`. Export `const terrenoApi = openapi` for consumers.
  - Files: `admin-spa/store/sdk.ts`
  - Depends on: 1.1
  - Acceptance: `bun run --filter '@terreno/admin-spa' compile` passes; importing `terrenoApi` from `store/sdk` works in app code.

- [ ] **Task 6.2 (optional)**: Codegen config for consumers wanting extended SDKs
  - Description: Create `openapi-config.ts` pointing at `http://localhost:4000/openapi.json`. Document in README as optional — not part of the standard build.
  - Files: `admin-spa/openapi-config.ts`, `admin-spa/README.md` section
  - Depends on: 6.1
  - Acceptance: Running `bun run --filter '@terreno/admin-spa' sdk` against a live backend regenerates `store/openApiSdk.ts` with all endpoints.

## Phase 7: Example backend integration

- [ ] **Task 7.1**: Add admin-spa dep to example-backend
  - Description: Add `"@terreno/admin-spa": "workspace:*"` to `example-backend/package.json` dependencies.
  - Files: `example-backend/package.json`
  - Depends on: 1.2
  - Acceptance: `bun install` resolves.

- [ ] **Task 7.2**: Register plugin in example-backend
  - Description: In `example-backend/src/server.ts`, import `AdminSpaServeApp`. Register it (gated on `process.env.ADMIN_SPA_ENABLED === "true"`) with `basePath: "/console"`, `appConfig: {brandName: "Terreno Example", primaryColor: "#7C3AED", providers: ["email", "google"]}`.
  - Files: `example-backend/src/server.ts`
  - Depends on: 7.1, 3.1
  - Acceptance: With `ADMIN_SPA_ENABLED=true AUTH_PROVIDER=better-auth bun run backend:dev`, server starts and logs "Admin SPA mounted at /console/".

- [ ] **Task 7.3**: Manual smoke test
  - Description: Start the backend with the env flags above. Open `http://localhost:4000/console/`. Confirm: (a) login screen renders with brand name "Terreno Example"; (b) sign in with an admin user → redirects to admin list; (c) clicking a model opens the table; (d) editing a row works; (e) `app-config.json` GET returns the configured shape; (f) non-admin user → forbidden screen. Document any gaps found.
  - Files: (manual)
  - Depends on: 7.2, 5.x complete
  - Acceptance: All six checks pass.

## Phase 8: Docs and rules

- [ ] **Task 8.1**: README for admin-spa
  - Description: Write `admin-spa/README.md`. Sections: overview, install, register with backend, customizing app-config, regenerating SDK, comparison with embedded admin-frontend usage.
  - Files: `admin-spa/README.md`
  - Depends on: 7.3
  - Acceptance: Reading the README is sufficient for a new consumer to add admin to their backend.

- [ ] **Task 8.2**: rulesync rule file
  - Description: Author `.claude/rules/admin-spa/00-admin-spa.md` matching the shape of `.claude/rules/admin-frontend/00-admin-frontend.md`. Run `bun run rules` to regenerate `rulesync.jsonc` artifacts. Verify the rule appears in any AI consumer config files generated.
  - Files: `.claude/rules/admin-spa/00-admin-spa.md`, plus regenerated rulesync artifacts
  - Depends on: 8.1
  - Acceptance: `bun run rules:check` passes (no diff after a clean regen).

- [ ] **Task 8.3**: Update CLAUDE.local.md and admin-backend README
  - Description: Add admin-spa to the packages list in `CLAUDE.local.md`. Add a "Standalone admin SPA" pointer to `admin-backend/README.md`.
  - Files: `CLAUDE.local.md`, `admin-backend/README.md`
  - Depends on: 8.1
  - Acceptance: Both files mention admin-spa and reference the IP.

- [ ] **Task 8.5**: Publish CI job
  - Description: Add an `admin-spa` publish job to `.github/workflows/publish-on-tag.yml` mirroring the existing 8 publish jobs. Job must: `bun install` → `bun run admin-spa:build` → `bun run admin-spa:compile` → `bun publish --filter '@terreno/admin-spa'`. Without this, tagged releases publish an empty `dist/`.
  - Files: `.github/workflows/publish-on-tag.yml`
  - Depends on: 8.1
  - Acceptance: Dry-run the workflow on a feature branch; verify the tarball contains `src/dist/`, `dist/index.html`, and at least one file in `dist/_expo/`.

- [ ] **Task 8.6**: CI smoke test
  - Description: New job (or extension of existing E2E workflow). Boots example-backend with `ADMIN_SPA_ENABLED=true AUTH_PROVIDER=better-auth` after running `bun run --filter '@terreno/admin-spa' build:web`. curl `/console/`, `/console/app-config.json`, and one `/console/_expo/static/js/web/*.js` asset. Assert 200s + correct cache headers. Catches path-rewrite regressions in CI.
  - Files: `.github/workflows/admin-spa-smoke.yml` (new) or update an existing test workflow
  - Depends on: 7.2, 3.1
  - Acceptance: Workflow passes on a clean run; mutating the rewrite list in `serve.ts` to omit `_expo` causes a CI failure.

## Optional Phases

- [ ] **Task 9.1 (optional)**: Playwright E2E
  - Description: Add `e2e/admin-spa.spec.ts` to example-frontend with three tests: anonymous user sees login screen, admin can log in and view model list, non-admin gets forbidden screen.
  - Files: `example-frontend/e2e/admin-spa.spec.ts`, plus testIDs already added in Phase 4
  - Depends on: 7.3
  - Acceptance: `bun run --filter '@terreno/example-frontend' e2e -- admin-spa.spec.ts` passes locally with backend running.
