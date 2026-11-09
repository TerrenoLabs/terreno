---
name: store-assets
description: >-
  Produce App Store and Google Play listing assets for an Expo app: store-sized
  screenshots (6.5-inch iPhone, 13-inch iPad, 1080x1920 Android phone) captured
  by Maestro flows that log in with test accounts, the Play feature graphic
  (1024x500 banner), and the Play high-res icon (512x512). Also keeps a
  simulator/emulator Expo dev client in sync with the native fingerprint
  (checks EAS, downloads a matching build, or starts one). Use when the user
  asks for "store screenshots", "App Store / Play Store screenshots", "store
  listing assets", "feature graphic", "store banner", "Play Store icon", "512
  icon", or to launch an app in the simulator/emulator with an up-to-date dev
  client.
---
# Store Assets

One pipeline for store listing assets in a Terreno/Expo repo. Each step is a `bun run` script
backed by the files in this skill's `scripts/` folder. Every repo-specific value lives in
`storeAssets.config.json`.

| Asset | Command | Output |
|---|---|---|
| Dev client on a simulator/emulator | `bun run devclient:ensure <app> <ios\|android>` | Installed app; `devclient:open` launches it into Metro |
| Store screenshots | `bun run screenshots <app>` | `<appDir>/storeScreenshots/<device>/NN-name.png` |
| Play feature graphic | `bun run store:banner <app>` | `<appDir>/storeScreenshots/playFeatureGraphic.png` (1024×500, no alpha) |
| Play high-res icon | `bun run store:icon <app>` | `<appDir>/storeScreenshots/playIcon.png` (512×512) |

**Requirements:**
- **macOS:** the scripts use Xcode simulators and `sips` to check and convert images (Android screenshots included).
- **Android:** the Android SDK, with at least one existing AVD to clone.
- **Tools:** Java 17, Bun, and an Expo login (`bunx eas-cli login`, or `EXPO_TOKEN`).
- **App:** the app must read its API base URL from `EXPO_PUBLIC_API_URL`. The screenshot run sets it to the local backend.

## One-time setup in a repo

Skip any step that is already done. `package.json` already having the `devclient:*` scripts means the repo is set up.

### 1. Copy the scripts

Copy `scripts/` from this skill into the repo as `scripts/storeAssets/` (keep `maestro/` inside it).

### 2. Add the scripts and dev dependency

Add these to the root `package.json`:

```json
"devclient:status": "bun scripts/storeAssets/devClient.ts status",
"devclient:download": "bun scripts/storeAssets/devClient.ts download",
"devclient:build": "bun scripts/storeAssets/devClient.ts build",
"devclient:install": "bun scripts/storeAssets/devClient.ts install",
"devclient:ensure": "bun scripts/storeAssets/devClient.ts ensure",
"devclient:open": "bun scripts/storeAssets/devClient.ts open",
"screenshots": "bun scripts/storeAssets/screenshots.ts run",
"screenshots:setup": "bun scripts/storeAssets/screenshots.ts setup",
"screenshots:devices": "bun scripts/storeAssets/screenshots.ts devices",
"screenshots:capture": "bun scripts/storeAssets/screenshots.ts capture",
"store:banner": "bun scripts/storeAssets/banner.ts",
"store:icon": "bun scripts/storeAssets/icon.ts"
```

Also add `@playwright/test` as a root devDependency; the banner and icon render HTML with headless Chromium. Use the workspace catalog version if there is one, then run `bunx playwright install chromium --only-shell`.

### 3. Git-ignore the work folder

Add `/.storeAssets/` to `.gitignore`. It holds Maestro artifacts and Metro logs. Keep `storeScreenshots/` tracked so the current store set lives with each app.

### 4. Write `storeAssets.config.json`

Write it at the repo root, starting from `examples/storeAssets.config.json`. Every `<...>` value is a placeholder. Fill each one from the repo (design tokens, `app.json`, `package.json`, seed data); ask the user only for what you can't find. Never invent brand colors, fonts or copy.

| Key | Meaning |
|---|---|
| `api.port` | Where the local backend listens. Override per run with `STORE_ASSETS_API_PORT` |
| `api.probe` | `{method, path, body?}` for a route only this backend serves. A 404 means "another project's server". A POST login route with body `{}` (expect 400) works well |
| `api.startCommand` | Shown when the backend is down |
| `homeScreenTestId` | testID on the post-login landing screen's root (default `home-screen`) |
| `devClientProfiles` | `{ios, android}` eas.json profiles. Defaults: `development:simulator` (needs `"ios": {"simulator": true}` and `developmentClient: true`) and `development` (internal `developmentClient`, builds an APK). Add the profiles to each app's `eas.json` if missing |
| `apps.<key>.appDir` | App directory (`app.json` needs `expo.owner`, `expo.slug`, `ios.bundleIdentifier` and `android.package`) |
| `apps.<key>.metroPort` | Port from the app's `expo start --port` script |
| `apps.<key>.devices` | Any of `iphone`, `ipad`, `android` |
| `apps.<key>.account` | Seeded test login `{email, password}`. Override with `SCREENSHOT_EMAIL` / `SCREENSHOT_PASSWORD`, which you should prefer for any non-throwaway account |
| `apps.<key>.preferredIosSimulator` | Simulator `devclient:*` boots when none of that family is running, e.g. `"iPad (A16)"` for a tablet-first app |
| `apps.<key>.banner` | `{headline, body, capsules?, screenshots}`. `screenshots` holds two names from `storeScreenshots/android/`, front one first, so the app must list `android` in `devices` |
| `brand.surface`, `onSurface` | Banner/icon background and the color drawn on it |
| `brand.capsuleBackground`, `capsuleText`, `border` | Capsule chip colors and the screenshot border |
| `brand.headingFont`, `bodyFont`, `googleFontsQuery?` | Font families and the Google Fonts css2 query that loads them |
| `brand.logoSvg`, `logoRecolor?`, `logoHeight?` | Vector lockup, a `{fromColor: toColor}` map onto the surface, and its height in px (default 30) |
| `brand.iconSvg`, `iconPathCount?`, `iconViewBox?`, `iconRecolor?` | Either a mark-only SVG, or a logo SVG plus the count and viewBox of the leading `<path>`s that form the mark. `iconRecolor` lists colors to paint as `onSurface` |
| `brand.bannerDecorations?` | `[{src, style}]`: repo-relative images positioned with CSS |

### 5. Write a screenshot flow per app

Write `<appDir>/maestro/screenshots.yaml`, starting from `examples/screenshots.yaml`. See *Writing flows* below.

### 6. Install tools

```bash
bun run screenshots:setup
```

This installs the pinned, checksum-verified Maestro release into `~/.maestro`. It needs Java 17: if Java is missing, tell the user to run `brew install openjdk@17`.

## Dev client

The dev client only needs rebuilding when native code changes. The script computes the native fingerprint with `eas fingerprint:generate`, which is the same hash EAS stamps on builds. It then checks for a dev client with that fingerprint, in this order:

1. **`install`:** a complete download is cached in `~/.cache/store-assets/<repo>/devClients/`. Override the location with `DEV_CLIENT_CACHE_DIR`. Interrupted downloads are never reused.
2. **`download`:** a finished EAS build matches. curl aborts stalled transfers and resumes; Android dev APKs run several hundred MB.
3. **`wait`:** a matching EAS build is in progress.
4. **`build`:** nothing matches, so a new EAS build is needed.

```bash
bun run devclient:status <app> <ios|android>             # prints the fingerprint and the next action
bun run devclient:ensure <app> <ios|android> [--wait] [--no-build] [--device <udid|avd>]
bun run devclient:build <app> <ios|android> [--wait] [--force]
cd <appDir> && bun run start                             # Metro, run_in_background
bun run devclient:open <app> <ios|android> [--device <udid|avd>]
```

- **Exit codes:** `ensure` exits `3` while an EAS build is still running; re-run with `--wait` in the background (builds take 10–25 min). With `--no-build`, it exits `4` instead of starting a build.
- **Credits:** starting an EAS build uses Expo credits. When `action` is `build`, confirm with the user first unless they asked for a build.
- **Use `devclient:open`, not `expo start --ios`:** `expo start --ios` picks whichever simulator is booted, which may not have the client installed.
- **How `devclient:open` launches:** on iOS it passes the launcher's `--initialUrl` argument, which avoids the "Open in …?" prompt `simctl openurl` triggers. On Android it sets up `adb reverse` for Metro and the API.

## Screenshots

```bash
bun run screenshots <app>                   # every device the app lists
bun run screenshots <app> --device android  # one device
bun run screenshots <app> --build           # also start EAS builds for stale dev clients
```

Run it with `run_in_background: true`. The backend must be up and seeded first.

- **Builds:** without `--build`, a device whose dev client needs a new EAS build is skipped and reported, so no Expo credits are spent. Pass `--build` only once the user has agreed to the cost.
- **Metro:** `--keep-metro` leaves the screenshot Metro running afterwards. Otherwise it stops on exit, error or Ctrl-C.

| Device key | Hardware | Size | Store slot |
|---|---|---|---|
| `iphone` | Simulator "Store Screenshots iPhone 6.5" (iPhone 14 Plus) | 1284×2778 | App Store Connect 6.5" |
| `ipad` | Simulator "Store Screenshots iPad 13" (iPad Pro 12.9" 6th gen) | 2048×2732 | App Store Connect 13" iPad |
| `android` | AVD `Store_Screenshots_Phone`, cloned from any existing AVD, 4 GB RAM | 1080×1920 | Play phone. Play rejects images longer than 2:1, so modern 20:9 Pixels don't qualify |

For each device, the script:

1. Creates the device on first use and boots it.
2. Sets a clean status bar. iOS uses a 9:41 override. Android uses demo mode with the mobile icon blocklisted (demo mode's mobile icon renders as a second Wi-Fi), notifications snoozed, and autofill off.
3. Runs `devclient:ensure` for that device.
4. Starts its own production-mode Metro (`--no-dev --minify`, so no LogBox) with `EXPO_PUBLIC_API_URL` pointing at the local API. It clears Metro's cache only when that URL changes.
5. Pre-builds the bundle, because a cold build takes minutes and would trip Maestro's driver timeout.
6. Hides the dev-menu intro, auto-open and floating gear button, then launches the app straight into Metro.
7. Runs the flow, copies every `NN-*.png` into `storeScreenshots/`, and checks each size.

**Review every PNG (Read them) before reporting.** Look for:

- Empty states or spinners. Wait on a content testID, not the screen root.
- Error banners and toasts.
- Leftover system dialogs.
- Text clipped on iPad or Android.

Fix the flow and re-run rather than handing over bad shots.

### Driving the app by hand

Use this when a flow fails or a screen needs special setup:

```bash
bun run screenshots:devices <app>                                         # boot devices, install client, print IDs
~/.maestro/maestro/bin/maestro --device <udid|emulator-serial> hierarchy  # find testIDs on screen
bun run screenshots:capture <app> <iphone|ipad|android> 07-some-screen    # save the current screen
```

Fold a manual sequence that works back into the flow so the next run reproduces it.

### Writing flows

- **Opening the app:** start with `runFlow` on `scripts/storeAssets/maestro/openApp.yaml`. It waits for the app, logs in through the `@terreno/ui` LoginScreen testIDs (`login-screen-email-input`, `-password-input`, `-submit-button`) when needed, and dismisses iOS's "Save Password?" prompt. Give a custom login form the same testIDs.
- **Subflow paths:** Maestro resolves `runFlow` paths relative to the flow file. With `appDir` one level deep, use `../../scripts/storeAssets/maestro/...`. Add one `../` per extra level, e.g. `../../../` for `apps/mobile`.
- **Flow env:** the script passes `APP_ID`, `EMAIL`, `PASSWORD`, `HOME_SCREEN_ID`, `DEVICE` and `PLATFORM`.
- **Selectors:** select by `id:` (testID). Add missing testIDs to the components first, e.g. `tabBarButtonTestID: "tab-<name>"` on Expo Router tabs.
- **Waits:** after each navigation, use `extendedWaitUntil` on the destination, then `waitForAnimationToEnd`, then `takeScreenshot: NN-name`. Use only the bare name: Maestro 2.x rejects paths outside its output folder.
- **Going back:** from a stack screen, use `runFlow` on `goHome.yaml`. It presses back on Android and restarts the app on iOS. A cold relaunch on Android leaves the dev client blank.

## Play feature graphic and icon

```bash
bun run store:banner <app>   # needs the app's android screenshots
bun run store:icon <app>
```

- **Banner layout:** a flat brand surface, the recolored logo, the headline (heading font), the body (body font), capsule chips, `bannerDecorations`, and two Android screenshots on the right.
- **Banner format:** rendered to JPEG and converted, so the PNG has no alpha channel. Play rejects alpha on feature graphics.
- **Icon:** the brand mark at about 62% width on the surface color. The image is full-bleed with square corners and no shadow, because Play applies its own mask.

Read both images before reporting. If the copy or decorations need changing, edit `storeAssets.config.json`.

## Environment variables

| Variable | Effect |
|---|---|
| `STORE_ASSETS_CONFIG` | Config path (default `storeAssets.config.json`) |
| `STORE_ASSETS_ROOT` | Repo root (default: current directory) |
| `STORE_ASSETS_API_PORT` | Overrides `api.port`, e.g. when another project owns it |
| `SCREENSHOT_EMAIL`, `SCREENSHOT_PASSWORD` | Override the app's test account |
| `DEV_CLIENT_CACHE_DIR` | Dev client download cache |

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `... does not serve <probe>` | Another project owns the API port | Run this backend on a free port and set `STORE_ASSETS_API_PORT`. Never stop the other project's server |
| Login fails with invalid credentials | Stale seed data | Re-seed the backend |
| `needs a new dev client build; skipping` | Native code changed since the last build | Confirm the cost, then re-run with `--build` (or `devclient:build`) |
| `Request for viewHierarchy failed, code: 500` | App still loading, or a stale Maestro driver | Kill leftover `maestro` processes and re-run |
| `Maestro Android driver did not start up in time` | First run on a fresh emulator | Already given 180s; re-run once |
| Emulator freezes or `adb` hangs | Host out of memory | Shut down unused simulators (`xcrun simctl shutdown all`) and re-run |
| `Reusing Metro already running` warning | A dev-mode Metro is on the app's port | Stop it; dev mode shows LogBox in shots |
| Blank screen after relaunch on Android | Dev client doesn't reload the last bundle on a cold start | Use `goHome.yaml`, not `launchApp` |
| `INSTALL_PARSE_FAILED_NOT_APK` | Corrupt cached APK from an older script | Delete `~/.cache/store-assets/<repo>/devClients/<app>/android` |
| `Executable doesn't exist ... chrome-headless-shell` | Playwright browser not installed for this version | `bunx playwright install chromium --only-shell` |
| `Simulator.app not found` warning | Xcode installed without Simulator.app | Harmless: simulators run headless |
