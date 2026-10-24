# Task List: Upgrade Banner

**Status:** Closed (2026-08-20) — IP complete. Shipped via `VersionCheckPlugin`, `AdminVersionConfig`, `useUpgradeCheck`, and `UpgradeRequiredScreen`. Open tasks below were not executed.

*Structured task breakdown for automated implementation. Each task should be independently implementable and testable.*

## Phase 1: Backend + Admin

- [ ] **Task 1.1**: Create VersionConfig Mongoose model
  - Description: Create the VersionConfig model with schema, interface, and TypeScript types in `@terreno/api`. Fields: webWarningVersion, webRequiredVersion, mobileWarningVersion, mobileRequiredVersion, warningMessage, requiredMessage, updateUrl. All version fields default to 0, messages have sensible defaults.
  - Files: `api/src/models/versionConfig.ts` (create), `api/src/index.ts` (export)
  - Depends on: none
  - Acceptance: Model can be imported from `@terreno/api`, compiles cleanly, schema matches spec

- [ ] **Task 1.2**: Add public `GET /version-check` endpoint
  - Description: Add a built-in public route via VersionCheckPlugin (TerrenoPlugin) that handles `GET /version-check?version=N&platform=web|mobile`. Fetches the singleton VersionConfig, compares the client's build number against the platform-specific thresholds, and returns a JSON object including status and, when a config exists, version threshold fields: `{status, message?, updateUrl?, requiredVersion?, warningVersion?}`. Returns `{status: "ok"}` if no config document exists.
  - Files: `api/src/versionCheckPlugin.ts` (create - exports VersionCheckPlugin)
  - Depends on: Task 1.1
  - Acceptance: Endpoint returns correct status for all combinations: no config → ok, version >= warning → ok, version < warning → warning, version < required → required. No auth required.

- [ ] **Task 1.3**: Add admin `GET/PUT /admin/version-config` routes
  - Description: Add admin-only routes for reading and upserting the singleton VersionConfig document. GET returns the current config (or defaults if none exists). PUT upserts the document. Both require `Permissions.IsAdmin`. Wire into AdminApp or as standalone admin routes.
  - Files: `admin-backend/src/adminApp.ts` (modify) or `api/src/routes/versionCheck.ts` (extend)
  - Depends on: Task 1.1
  - Acceptance: Authenticated admin can GET and PUT the config. Non-admin gets 403. PUT creates if not exists, updates if exists.

- [ ] **Task 1.4**: Add admin frontend Version Config screen
  - Description: Create a custom admin screen in `@terreno/admin-frontend` for editing the singleton VersionConfig. Form with all fields, "Save" button that PUTs to `/admin/version-config`. Add it as a special entry in the admin model list or as a standalone screen.
  - Files: `admin-frontend/src/AdminVersionConfig.tsx` (create), `admin-frontend/src/index.tsx` (export)
  - Depends on: Task 1.3
  - Acceptance: Admin can view and edit all version config fields. Save persists to backend. Form loads existing values on mount.

- [ ] **Task 1.5**: Write unit tests for version check logic
  - Description: Test the version check endpoint logic: no config returns ok, version comparisons for web and mobile platforms, edge cases (version = 0, version = threshold exactly, missing query params).
  - Files: `api/src/__tests__/versionCheck.test.ts` (create)
  - Depends on: Task 1.2
  - Acceptance: All test cases pass covering ok/warning/required status for both platforms.

- [ ] **Task 1.6**: Wire up example backend
  - Description: Ensure the example backend includes the VersionConfig model and version-check endpoint. Verify the admin panel shows the version config screen.
  - Files: `example-backend/src/server.ts` (modify if needed)
  - Depends on: Task 1.3, Task 1.4
  - Acceptance: Running the example backend exposes `/version-check` and `/admin/version-config`. Admin panel shows the config screen.

## Phase 2: Client + CI

- [ ] **Task 2.1**: Create `UpgradeRequiredScreen` component
  - Description: Build a full-screen blocking component in `@terreno/ui`. Centered layout with warning icon, configurable message text, and an "Update" button. The button calls an `onUpdate` callback prop. No dismiss, no navigation escape. Props: `message: string`, `onUpdate: () => void`.
  - Files: `ui/src/UpgradeRequiredScreen.tsx` (create), `ui/src/index.ts` (export)
  - Depends on: none
  - Acceptance: Component renders full-screen with message and button. Button triggers onUpdate. No way to dismiss or navigate away.

- [ ] **Task 2.2**: Create `useUpgradeCheck` hook
  - Description: Build a hook in `@terreno/rtk` that checks `GET /version-check` on mount. Gets build number from `Constants.expoConfig.extra.buildNumber`, platform from existing `IsWeb` util. On "warning": shows persistent toast with message + "Update" button + dismiss X. On "required": returns `{isRequired: true, requiredMessage, onUpdate}`. The `onUpdate` function handles platform logic: web → `window.location.reload()`, mobile → try `expo-updates` `fetchUpdateAsync()`/`reloadAsync()`, fall back to `Linking.openURL(updateUrl)`. Skips check if build number is undefined.
  - Files: `rtk/src/useUpgradeCheck.ts` (create), `rtk/src/index.ts` (export)
  - Depends on: Task 1.2
  - Acceptance: Hook returns correct state for ok/warning/required. Toast appears for warning. isRequired flag set for required. onUpdate triggers appropriate platform action.

- [ ] **Task 2.3**: Add `app.config.ts` build number injection
  - Description: Create or update `app.config.ts` in the example frontend to dynamically set `expo.extra.buildNumber` from `git rev-list --count HEAD` at build time. Document the pattern for consuming apps.
  - Files: `example-frontend/app.config.ts` (create/modify), `example-frontend/app.json` (may need adjustment)
  - Depends on: none
  - Acceptance: Running `expo start` or `expo build` sets `Constants.expoConfig.extra.buildNumber` to the current git commit count.

- [ ] **Task 2.4**: Wire up example frontend
  - Description: Add `useUpgradeCheck()` to the example frontend's root layout. When `isRequired` is true, render `UpgradeRequiredScreen` instead of normal app content.
  - Files: `example-frontend/app/_layout.tsx` (modify)
  - Depends on: Task 2.1, Task 2.2, Task 2.3
  - Acceptance: Example app checks version on mount. Warning shows toast. Required shows blocking screen. Normal operation when version is ok or build number is missing.

- [ ] **Task 2.5**: Document GitHub Actions build number pattern
  - Description: Add a CI snippet or documentation showing how to inject the build number in GitHub Actions workflows using `git rev-list --count HEAD`. Include examples for both EAS Build and web deployments.
  - Files: `docs/how-to/upgrade-banner.md` (create) or inline in example-frontend README
  - Depends on: Task 2.3
  - Acceptance: Clear instructions for consuming apps to set up automatic build numbering in CI.