# Mobile test setup (iOS / Android)

Two layers:

- **Platform unit tests** — the same Bun suite with `Platform.OS` set to `ios` or `android`.
  Fast; no device.
- **Maestro flows** — drive the real native app on a simulator or emulator.

## Platform unit tests

`registerExpoTestEnvironment` fixes `Platform.OS` for the whole run, so pick it from an env var
in the preload and run the suite once per platform:

```typescript
// frontend/tests/testPreload.ts
import {registerExpoTestEnvironment} from "@terreno/test/expo/registerExpoTestEnvironment";

const platform = (process.env.TEST_PLATFORM ?? "ios") as "android" | "ios" | "web";
registerExpoTestEnvironment({expoConfig: {extra: {}, scheme: "<scheme>"}, platform});
```

```json
"scripts": {
  "test": "bun test",
  "test:android": "TEST_PLATFORM=android bun test",
  "test:web": "TEST_PLATFORM=web bun test"
}
```

Run the extra platforms in CI only when the app has `Platform.OS` / `Platform.select` branches.

## Maestro

### 1. Native identifiers

Maestro targets the app by bundle ID. Set both in `frontend/app.json` if missing
(`create-terreno-app` only sets `scheme`):

```json
"ios": {"bundleIdentifier": "com.<org>.<app>"},
"android": {"package": "com.<org>.<app>"}
```

### 2. A build on a device

Use a **development build**, not Expo Go (Expo Go's app ID is Expo's, not yours):

| Platform | Command |
|----------|---------|
| iOS simulator (macOS + Xcode) | `bunx expo run:ios` |
| Android emulator | `bunx expo run:android` |
| Either, prebuilt in the cloud | `bunx eas-cli build --profile development --platform <ios\|android>` then `bunx eas-cli build:run -p <platform> --latest` |

The `store-assets` skill's `devclient:ensure` script keeps a dev client in sync with the
native fingerprint if the app already uses it.

Reach the local backend from the device:

- iOS simulator shares the Mac's `localhost`; nothing to do.
- Android emulator: `adb reverse tcp:8081 tcp:8081 && adb reverse tcp:4000 tcp:4000` (Metro and
  the API). Repeat after every emulator restart.

### 3. Install Maestro

```bash
curl -fsSL "https://get.maestro.mobile.dev" | bash   # needs Java 17
maestro --version
```

### 4. Flows

```
frontend/maestro/
  config.yaml          # flow list and order
  subflows/login.yaml  # reused by other flows
  login.yaml
```

`frontend/maestro/subflows/login.yaml`:

```yaml
appId: ${APP_ID}
---
- extendedWaitUntil:
    visible:
      id: "login-screen-email-input"
    timeout: 60000
- tapOn:
    id: "login-screen-email-input"
- inputText: ${EMAIL}
- tapOn:
    id: "login-screen-password-input"
- inputText: ${PASSWORD}
- hideKeyboard
- tapOn:
    id: "login-screen-submit-button"
```

`frontend/maestro/login.yaml`:

```yaml
appId: ${APP_ID}
---
- launchApp:
    clearState: true
- runFlow: subflows/login.yaml
- extendedWaitUntil:
    visible:
      id: "home-screen"
    timeout: 30000
```

React Native `testID` becomes the iOS accessibility identifier and the Android resource ID, so
Maestro's `id:` selector works on both. `@terreno/ui` components accept a `testID` prop; check a custom component passes it to the underlying native view.

### 5. Run

```bash
maestro test -e APP_ID=com.<org>.<app> -e EMAIL=test@example.com -e PASSWORD=<password> maestro/
maestro --device <udid|emulator-serial> test ...   # when several devices are booted
maestro hierarchy                                  # list the testIDs on screen
```

Seed the user first (`bun run seed` in the backend, or the E2E auth setup).

Add `"test:maestro": "maestro test maestro/"` to the scripts.

### CI

- Android: a Linux runner with an emulator (e.g. `reactivecircus/android-emulator-runner`),
  then build, install, `adb reverse`, and `maestro test`.
- iOS: needs a macOS runner and a simulator build (`eas build --profile development:simulator`
  or `expo run:ios`).
- Maestro Cloud runs both from an uploaded build if the project has an account.
