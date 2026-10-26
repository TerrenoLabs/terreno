# Upgrade Banner

Two-tier system for notifying users about app updates: a soft warning (dismissible toast) and a hard block (full-screen, no dismiss). Admin-configurable thresholds per platform.

## How It Works

1. **Backend** exposes `GET /version-check?version=N&platform=web|mobile` (public, no auth)
2. **Admin** configures version thresholds via the admin panel
3. **Client** calls `useUpgradeCheck()` on mount, which compares the app's build number against the thresholds
4. Result: `ok` (no action), `warning` (persistent toast), or `required` (blocking screen)

## Setup

### 1. Backend: Register the VersionCheckPlugin

```typescript
import {TerrenoApp, VersionCheckPlugin} from "@terreno/api";

const app = new TerrenoApp({userModel: User})
  .register(new VersionCheckPlugin())
  .start();
```

This adds the public `GET /version-check` endpoint. The admin routes (`GET/PUT /admin/version-config`) are automatically available if you're using `AdminApp`.

### 2. Frontend: Add build number injection

Create or update `app.config.ts` in your Expo app root. Use the `resolveBuildNumber` helper from `@terreno/rtk/buildNumber`:

```typescript
import {resolveBuildNumber} from "@terreno/rtk/buildNumber";
import type {ConfigContext, ExpoConfig} from "expo/config";

export default ({config}: ConfigContext): ExpoConfig => ({
  ...config,
  extra: {
    ...config.extra,
    buildNumber: resolveBuildNumber({configValue: config.extra?.buildNumber}),
  },
} as ExpoConfig);
```

`resolveBuildNumber` resolves the build number in this order:

1. **`override`** option (set to a number for local testing)
2. **`configValue`** option (e.g. from `app.json` `expo.extra.buildNumber` or EAS Build)
3. **`EXPO_PUBLIC_BUILD_NUMBER`** env var (customizable via `envVar` option)
4. **`git rev-list --count HEAD`** (default)
5. **`undefined`** if git is unavailable (version check will be skipped)

This sets `Constants.expoConfig.extra.buildNumber` when Metro loads the config. By default it tracks the git commit count.

**If you change `buildNumber` and nothing updates:** restart the dev server (`bun expo start` or `expo start --clear`). `expo-constants` is filled when the bundle is built; hot reload does not always re-read `app.config.ts`.

### 3. Frontend: Wire up the hook

In your root layout:

```typescript
import {useUpgradeCheck} from "@terreno/rtk";
import {UpgradeRequiredScreen} from "@terreno/ui";

function RootLayoutNav() {
  const {isRequired, requiredMessage, onUpdate} = useUpgradeCheck();

  if (isRequired) {
    return (
      <UpgradeRequiredScreen
        message={requiredMessage ?? "Please update to continue."}
        onUpdate={onUpdate}
      />
    );
  }

  return <Stack>{/* normal routes */}</Stack>;
}
```

The hook handles:
- **ok**: Nothing happens, app runs normally
- **warning**: Shows a persistent toast with the admin-configured message
- **required**: Returns `isRequired: true` so you can render the blocking screen
- **No build number**: Skips the check entirely (dev environment)

### 4. Admin: Configure thresholds

Open the admin panel's `/version-config` route directly. The configuration screen is not included in the main sidebar. Set:

- **Web Warning Version**: Build number below which web users see a warning toast
- **Web Required Version**: Build number below which web users are blocked
- **Mobile Warning Version**: Same for mobile
- **Mobile Required Version**: Same for mobile
- **Warning Message**: Text shown in the toast
- **Required Message**: Text shown on the blocking screen
- **Update URL** (optional): App store or download link for mobile updates

All version fields default to `0`, meaning no constraint until configured.

## CI/CD: Build Number in GitHub Actions

### EAS Build

In your `eas.json`, use a pre-build hook or set the build number via environment:

```yaml
# .github/workflows/build.yml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required for git rev-list --count

      - name: Install dependencies
        run: bun install

      - name: Build with EAS
        run: eas build --platform all --non-interactive
```

Since `app.config.ts` runs `git rev-list --count HEAD` at build time, the build number is automatically set. The key requirement is `fetch-depth: 0` in the checkout step to ensure the full git history is available.

### Web Deployments

For static web builds (e.g. `expo export`):

```yaml
jobs:
  deploy-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install dependencies
        run: bun install

      - name: Export web build
        run: npx expo export --platform web

      - name: Deploy
        run: # your deployment step
```

The `app.config.ts` runs during `expo export`, so the build number is embedded in the static output.

### Verifying the Build Number

After building, you can verify the build number is set correctly:

```bash
# Check the current commit count locally
git rev-list --count HEAD
```

This number should match what `Constants.expoConfig.extra.buildNumber` returns in the running app.

## Architecture

```
App mounts → useUpgradeCheck() fires
  → GET /version-check?version=N&platform=web|mobile
  → "ok"       → normal app
  → "warning"  → normal app + persistent toast
  → "required" → UpgradeRequiredScreen (blocks everything)
```

Update behavior when user taps "Update":
- **Web**: `window.location.reload()` — picks up the latest deployment
- **Mobile**: Opens `updateUrl` via `Linking.openURL()` (e.g. App Store link)
