---
name: test-expo-release-locally
description: Build and test a major Expo SDK release (or a Terreno release branch) end to end on a Mac — EAS dev builds, iOS simulator, Android emulator, Maestro, dark mode, logout and auth, then fix what breaks. Use when asked to "test release-NN", "create builds on eas and test on ios and android", or to verify a branch after merging master into it.
---
# Test a major Expo release locally on a Mac

Goal: do everything that can be done unattended. Ask the human only for what needs their hands (an `eas login` approval, a native permission prompt). Report with evidence (screenshots, HTTP codes), not "looks fine".

Order matters. Each phase has a gate; do not start the next one until it passes.

## Phase 0: Preflight (5 min)

1. `git status` clean, on the release branch, `git fetch` and note commits behind `origin/master`.
2. **EAS account.** `cd <app> && bunx eas-cli whoami` must match the `owner` in `app.json`. Wrong account: tell the user to run `! bunx eas-cli login --device` (interactive login fails in this shell; `--non-interactive` prints a URL, the user approves it, then rerun with `--resume <id>`).
3. **Untracked junk blocks the stop hook** (Knip scans it). Ask before deleting; if the user says delete, delete.
4. **Tooling present:** `xcrun simctl list devices booted`, `adb devices`, `maestro --version`. Maestro needs a JDK: `export JAVA_HOME=$(ls -d ~/.gradle/jdks/eclipse_adoptium-17-*/jdk-*/Contents/Home | head -1)`.
5. **Disk:** the Android emulator is often ~92% full. Uninstall the old app (`adb uninstall <package>`) before installing a 150MB+ APK.
6. `bun run bootstrap:update` (reinstall and recompile). Stale `dist/` hides ordering bugs, so for a fresh-clone check also run `compile-workspace-deps.js` from empty `dist/` (see Build fixes).

## Phase 1: EAS builds (iOS simulator + Android dev, in parallel)

```bash
cd <app>
bunx eas-cli build --profile development:simulator --platform ios --non-interactive --no-wait --json
bunx eas-cli build --profile development --platform android --non-interactive --no-wait --json
```

Poll with `eas build:view <id> --json`. Logs: `logFiles[0]` is brotli JSON lines: `curl -s URL | brotli -d -c`. Read the log tail before guessing.

Known failures on a clean EAS checkout and their fixes (check these first):

| Symptom | Fix |
|---|---|
| iOS `pod install` fails on `stripe-react-native` (SPM needs a dynamic framework; Expo precompiled modules make it static) | `"disableSPM": true` on the Stripe plugin in `app.json`. `useFrameworks: dynamic` does NOT help |
| Android post-install hook fails: `@terreno/test` compiles before `@terreno/ui` | `eas-build-post-install` runs `node .github/scripts/compile-workspace-deps.js <app>` (plus any type step), not `bun run compile`. `--filter '*'` does not order dev/peer deps |
| Android Gradle daemon killed (container OOM, not Java OOM) | `eas.json` android profile: `"resourceClass": "large"` and `"gradleCommand": ":app:assembleDebug -PreactNativeArchitectures=arm64-v8a"` |
| Fresh compile fails: a package imports `@terreno/ui` without declaring it | Declare it as a workspace peer and devDependency |
| `react-native-skia` has no prebuilt libs, or fingerprint mismatch on CONFIGURE_EXPO_UPDATES | See memory notes `skia-trusted-dependencies-eas`, `eas-fingerprint-linker-mismatch` (clean reinstall) |

Change one thing per retry. Second identical failure: consult the advisor.

## Phase 2: Pull builds and install

```bash
# iOS: download the .tar.gz, extract into its OWN new dir, never run tools from inside it
xcrun simctl boot "<device>" ; xcrun simctl install booted <App.app>
# Android
adb install -r <app>.apk
```

Backend for the app: replica-set mongod (change streams) plus `bun run backend:dev` and `bun run backend:seed` (users `test@example.com` / `admin@example.com`, password `testpassword123`). Metro: `bun run frontend:start` (or `expo start --dev-client`). Android reaches the host via `adb reverse tcp:4000 tcp:4000 tcp:8082 tcp:8082` (an emulator's `localhost` is itself). Open with the dev-client deep link: `xcrun simctl openurl booted "<scheme>://expo-development-client/?url=<metro-url>"`; Android `adb shell am start -a android.intent.action.VIEW -d ...`.

**Metro staleness:** Metro does not see edits to gitignored `dist/` and often misses source edits. After changing a workspace package or app file, restart `expo start --clear` before judging a device result. Never judge a fix on a stale bundle.

Gate: the app renders past the splash screen on both platforms. A red box or white screen means stale workspace `dist/` (run `bootstrap:update`) or a missing native module (the dev client must be rebuilt, not just reloaded).

## Phase 3: Smoke test, then thorough test

Capture evidence per screen:
- iOS: `xcrun simctl io booted screenshot <file>.png`
- Android: `adb exec-out screencap -p > <file>.png`
- Logs: `xcrun simctl spawn booted log stream --predicate 'process == "<App>"'` and `adb logcat -s ReactNativeJS`

Cover: sign in, every tab, create/edit/delete a record, offline then online (sync), profile, settings, the AI/chat screen, admin screens, consent modals, push-token registration, sign out, sign in as a second user.

Maestro rules learned the hard way:
- `point:` percentages must be **integers** (`"37%,94%"`), not decimals.
- Tab bar taps by text fail; tap by point. A "Sign in" text tap can hit the heading; target the button's testID.
- `takeScreenshot` rejects absolute paths; use simctl/adb for screenshots.
- `scrollUntilVisible` needs `centerElement: true` to land on a toggle.
- Android Back at the root exits the dev client and may reveal another app. Relaunch via deep link and do not touch the other app.

Things web e2e cannot see, test them natively every time:
1. **Sign-out and sign-in again**, then check the server response (`POST /auth/sign-out` must be 200; 403 "Missing or null Origin" means the server lacks `nativeApps: true`).
2. **Logout must not unmount data providers** (error screen on logout).
3. **Auth storage**: `undefined is not a function` on every auth request means the native storage lacks `getItemAsync`/`setItemAsync` (Better Auth Expo plugin 1.7).
4. **Phone-width layouts**: sidebars and rows built for desktop (AI chat sidebar, headers with two buttons squeezing a title into a one-character column). Breakpoints on native are sm 320 / md 375 / lg 600 / xl 1024, so every phone is at least `md`; stack with `lg`, not `md`.
5. Safe-area insets and keyboard overlap on the login form.

## Phase 4: Dark mode

On both platforms: iOS `xcrun simctl ui booted appearance dark`; Android `adb shell cmd uimode night yes`. Screenshot Todos, AI, Profile, Settings, and the login screen. Check the persisted theme survives sign-out onto the login screen. Look for invisible text, white cards, and hard-coded colors. Reset with `light` / `night no`.

## Phase 5: Merge master into the release branch (when asked)

- Expect conflicts in the removed-layer files: when the release deletes a package (e.g. `@terreno/rtk`), master's feature work against it must be **ported**, not dropped. Port to the replacement layer, then regenerate snapshots (OpenAPI) and generated SDKs rather than hand-merging them.
- Dependency bumps that master's features need (e.g. `better-auth` 1.7.4 for passkey) go in the root catalog; check `better-auth`, `@better-auth/expo`, `@better-auth/passkey` are all the same version.
- Commit the merge locally; do not push unless asked.

## Phase 6: Verify the gate

```bash
bun run compile && bun run lint && bun run analyze:full
bun run test:agent           # or per-package: bun test --only-failures <path>
bun run e2e                  # Playwright web (profile, login specs touch auth paths)
```

Baseline: before blaming your change for a failing suite, run it in a throwaway `git worktree` of the unmerged release branch. Record suites that fail there ("pre-existing") and report them separately. Remove the worktree after.

Run isolated suites by explicit paths (`./src/isolated/*.isolated.ts`). A test that sets `window` width must restore it (a leak breaks later suites).

## Phase 7: Update upgrade notes (consumers hit these too)

Everything you had to change in the example app is something consumers will have to change. Add it to the release's upgrade note (`mcp-server/src/docs/upgrades/<version>.md`) and the migration how-to: build config, dependency pins, server config, behavior changes, and a table of example-app files. Fix stale changelog fragments that name removed packages. Run `check:changelog` and `check:whats-new`.

## Phase 8: Clean up and report

Stop Metro, the backend, mongod; remove baseline worktrees; update the project memory file with new gotchas.

Report (short, lead with the result): what is committed and where, fixes made, what was verified on which platform, what was NOT tested (passkeys/2FA on device, web e2e, push), pre-existing failures. Say plainly what you could not verify. End with the next single action (usually "run e2e, then push?").

## Do without asking vs ask first

Do: builds, installs, emulator/simulator control, Maestro, restarting Metro/backend, fixing code, local commits, regenerating snapshots/SDKs.
Ask: `eas login`, pushing, deleting untracked files, anything touching another app on the device, store submissions.
