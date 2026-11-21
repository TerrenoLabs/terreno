# Implementation Plan: Upgrade Banner

**Status:** Complete
**Closed:** 2026-08-20 — Shipped via `VersionConfig` model, `VersionCheckPlugin` (`GET /version-check`), `AdminVersionConfig`, `useUpgradeCheck` (`@terreno/rtk`), and `UpgradeRequiredScreen` (`@terreno/ui`).
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1079

*When an engineer is assigned to a project but before you begin coding, you should fill in the implementation plan and get feedback from the engineering team. Once you have finished or you make any changes, tag Josh with the @ symbol so he can review. Also tag anyone else that needs to be notified, has conflicting work, etc.*

## Models

### VersionConfig (new, singleton)

```typescript
// api/src/models/versionConfig.ts

import {createdUpdatedPlugin} from "../plugins";
import mongoose from "mongoose";

const versionConfigSchema = new mongoose.Schema<VersionConfigDocument>(
  {
    webWarningVersion: {
      type: Number,
      default: 0,
      description: "Build number at which web users see a warning toast",
    },
    webRequiredVersion: {
      type: Number,
      default: 0,
      description: "Build number at which web users are blocked from using the app",
    },
    mobileWarningVersion: {
      type: Number,
      default: 0,
      description: "Build number at which mobile users see a warning toast",
    },
    mobileRequiredVersion: {
      type: Number,
      default: 0,
      description: "Build number at which mobile users are blocked from using the app",
    },
    warningMessage: {
      type: String,
      default: "A new version is available. Please update for the best experience.",
      description: "Message shown in the warning toast",
    },
    requiredMessage: {
      type: String,
      default: "This version is no longer supported. Please update to continue.",
      description: "Message shown on the blocking screen",
    },
    updateUrl: {
      type: String,
      description: "App store or download URL for mobile updates (optional, falls back to expo-updates)",
    },
  },
  { strict: "throw", toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

versionConfigSchema.plugin(createdUpdatedPlugin);
```

**Key design points:**
- Singleton — only one document in the collection
- All version fields default to `0` (meaning "no constraint"), so the check returns "ok" until an admin configures thresholds
- Per-platform version thresholds (web vs mobile), shared messages
- `updateUrl` is optional — mobile falls back to expo-updates OTA

## APIs

### 1. Version Check (public, built-in)

| | |
|---|---|
| Method | `GET /version-check` |
| Auth | None (public) |
| Query Params | `version` (integer build number), `platform` ("web" \| "mobile") |
| Response | `{status: "ok" \| "warning" \| "required", message?: string, updateUrl?: string}` |
| Notes | Requires explicit registration via `VersionCheckPlugin` (e.g., `app.register(new VersionCheckPlugin())`). Returns `{status: "ok"}` if no VersionConfig document exists. |

**Logic:**
```
if platform version < requiredVersion → status: "required", message: requiredMessage, updateUrl
else if platform version < warningVersion → status: "warning", message: warningMessage, updateUrl
else → status: "ok"
```

### 2. Admin: Get Version Config

| | |
|---|---|
| Method | `GET /admin/version-config` |
| Auth | `Permissions.IsAdmin` |
| Response | The singleton VersionConfig document (or defaults if none exists) |

### 3. Admin: Update Version Config

| | |
|---|---|
| Method | `PUT /admin/version-config` |
| Auth | `Permissions.IsAdmin` |
| Body | All VersionConfig fields |
| Response | Updated VersionConfig document |
| Notes | Upsert — creates if doesn't exist, updates if it does. |

Custom routes (not modelRouter) since it's a singleton — no list, no delete, no `:id` params.

## Notifications

No notifications required for this feature. The upgrade system is passive — it checks on app mount and shows in-app UI only.

## UI

### Component 1: `UpgradeRequiredScreen` (new, `@terreno/ui`)

- Full-screen page with centered content
- Warning icon, the `requiredMessage` text, and an "Update" button
- Update button behavior controlled by `onUpdate` callback prop:
  - **Web:** calls `window.location.reload()`
  - **Mobile:** attempts `expo-updates` OTA → falls back to opening `updateUrl` via `Linking`
- No back button, no navigation, no dismiss — user is stuck here
- Props: `message: string`, `onUpdate: () => void`

### Component 2: `useUpgradeCheck` hook (new, `@terreno/rtk`)

- Called in consuming app's root layout
- On mount: `GET /version-check?version={buildNumber}&platform={web|mobile}`
- If `"warning"`: shows persistent toast with message + "Update" action button
- If `"required"`: returns a flag for the consuming app to render `UpgradeRequiredScreen`
- Returns: `{isRequired: boolean, requiredMessage?: string, onUpdate: () => void}`
- Skips check if build number is missing/unknown (dev environment)
- `onUpdate` handles platform logic: web refresh, mobile expo-updates or Linking to updateUrl

### Component 3: Admin Version Config Screen (new, `@terreno/admin-frontend`)

- Form with fields: webWarningVersion, webRequiredVersion, mobileWarningVersion, mobileRequiredVersion, warningMessage, requiredMessage, updateUrl
- Single "Save" button that PUTs the singleton
- Accessible from the admin model list as a special entry

### Navigation Flow

```
App mounts → useUpgradeCheck() fires
  → "ok"       → normal app
  → "warning"  → normal app + persistent toast with "Update" button + dismiss X
  → "required" → UpgradeRequiredScreen (blocks everything)
```

## Phases

### Phase 1: Backend + Admin

- VersionConfig Mongoose model in `@terreno/api`
- `GET /version-check` public endpoint via `VersionCheckPlugin`
- `GET/PUT /admin/version-config` admin routes
- Admin frontend screen for version config
- Unit tests for the version check logic
- Example backend wired up

**Deliverable:** Admin can configure version thresholds and the public endpoint responds correctly.

### Phase 2: Client + CI

- `UpgradeRequiredScreen` component in `@terreno/ui`
- `useUpgradeCheck` hook in `@terreno/rtk`
- `app.config.ts` helper for build number injection via `expo.extra.buildNumber`
- Example frontend wired up with the hook
- GitHub Actions snippet for `git rev-list --count HEAD`

**Deliverable:** Client apps can check version on mount and show warning toast or blocking screen.

## Feature Flags & Migrations

- **No feature flag needed.** The system is inert by default — the endpoint returns `"ok"` until an admin creates a VersionConfig document with non-zero thresholds.
- **No data migration needed.** New model, new collection, starts empty.
- **Rollout:** Ship it. Apps that don't call `useUpgradeCheck()` are unaffected.

## Activity Log & User Updates

No activity logging needed for this feature. Version config changes are admin-only and low-frequency.

## Not Included / Future Work

- Per-user or per-role version targeting
- Gradual rollout / percentage-based enforcement
- Push notifications for version updates
- Automatic semver bumping (stays manual via git tags)
- Periodic polling (only checks on mount for now)
- Per-app configs for multi-frontend backends
- Version check middleware on every API response
- Analytics on how many users are on which versions


# Research: Terreno Upgrade Banner System

## Summary

The Terreno codebase already sends `App-Version` and `App-Platform` headers with every API request via RTK's base query. Building an upgrade banner system requires: (1) a backend model + built-in endpoint for version config, (2) admin screens to manage it, (3) a client hook + prebuilt UI, and (4) CI automation for commit-count-based versioning. The existing `AdminApp` plugin pattern, `Banner` component, toast system, and `Page` component provide strong foundations to build on.

## Context

- **Problem:** No mechanism to notify users their app is outdated. Stale clients can hit deprecated APIs or miss critical fixes.
- **Current state:** RTK already sends `App-Version` (from `Constants.expoConfig?.version`) and `App-Platform` ("web"/"mobile") on every request (`rtk/src/emptyApi.ts:164-177`). But nothing consumes these headers or enforces version constraints.
- **Goal:** Two-tier system — soft warning (dismissible toast/banner) and hard block (full-screen, no dismiss). Admin-configurable. Auto-versioned via CI.

## Decisions

- **Per-platform config:** Yes — separate thresholds for web vs mobile since web can force-refresh but mobile needs app store update.
- **Update mechanism:** Platform-specific — web forces page refresh, mobile triggers expo-updates OTA if available, falls back to app store link.
- **Endpoint location:** `VersionCheckPlugin` registered with `TerrenoApp` — opt-in per app.
- **Config storage:** Mongoose model (database-backed) so admins can change without redeploy.

## Findings

### Finding 1: Existing Version Infrastructure in RTK

`rtk/src/emptyApi.ts:164-177` — Every API request already includes:
```typescript
const version = Constants.expoConfig?.version ?? "Unknown";
headers.set("App-Version", version);
headers.set("App-Platform", IsWeb ? "web" : "mobile");
```

The version comes from `expo-constants` → `app.json`'s `version` field. Currently `example-frontend/app.json` has `"version": "1.0.0"`.

### Finding 2: Admin Backend Plugin Pattern

`admin-backend/src/adminApp.ts` — The `AdminApp` class provides the pattern:
- Constructor takes config, `register(app)` adds routes to Express
- Uses `modelRouter` with `Permissions.IsAdmin` for all CRUD
- Exposes a `/admin/config` metadata endpoint

### Finding 3: Admin Frontend Patterns

`admin-frontend/` uses a data-driven approach:
- `useAdminConfig(api, baseUrl)` fetches model metadata
- `useAdminApi(api, routePath, modelName)` generates CRUD hooks dynamically
- All screens accept `baseUrl` and `api` props
- For upgrade config, we need a custom admin screen (singleton config, not a collection)

### Finding 4: UI Components Available

**Banner** (`ui/src/Banner.tsx`) — status variants, persistent dismiss, action button
**Toast** (`ui/src/Toast.tsx`) — `useToast()` with warn/info/error variants, persistent mode
**Page** (`ui/src/Page.tsx`) — Full-screen layout for the blocking screen
**Modal** (`ui/src/Modal.tsx`) — Dialog, but Page is better for hard block (zero escape)

### Finding 5: GitHub Actions & Versioning

Current flow: manual git tag → `publish-on-tag.yml` → selective npm publish.
No existing build number system. `app.json` version is static.
`git rev-list --count HEAD` provides simple, monotonically increasing build numbers.

### Finding 6: RTK Store Integration

`example-frontend/store/index.ts` — store combines auth, appState, API reducers.
`_layout.tsx` checks auth state and routes conditionally — upgrade check follows same pattern.

## Recommendation

**Add to core packages** — spread across:
- `@terreno/api` — VersionConfig model + public `GET /version-check` endpoint (via `VersionCheckPlugin`)
- `@terreno/admin-frontend` — Custom admin screen for version config
- `@terreno/rtk` — `useUpgradeCheck` hook
- `@terreno/ui` — `UpgradeRequiredScreen` blocking component

**Versioning:** `git rev-list --count HEAD` as integer build number. Helper in CI to set `expo.version` at build time.

**API:** `GET /version-check?version=123&platform=web` — public, no auth. Returns `{status: "ok" | "warning" | "required", message?, updateUrl?}`.

## References

- `rtk/src/emptyApi.ts:164-177` — Existing App-Version header
- `admin-backend/src/adminApp.ts` — Plugin registration pattern
- `admin-frontend/src/useAdminApi.tsx` — Dynamic RTK hook generation
- `ui/src/Banner.tsx` — Banner component
- `ui/src/Toast.tsx` — Toast notification system
- `ui/src/Page.tsx` — Full-screen page layout
- `example-frontend/app/_layout.tsx` — Root layout with auth routing
- `.github/workflows/publish-on-tag.yml` — Current CI/CD versioning