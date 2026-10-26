---
name: terreno-mobile-tests
description: >-
  Write and fix mobile tests for a Terreno Expo app on iOS and Android: Maestro flows that
  drive the native app on a simulator or emulator, and Bun unit tests for Platform.OS-specific
  code. Covers testID selectors on native, login subflows, waiting, platform branches,
  keyboards and system dialogs, reaching the local backend from a device, and debugging flaky
  flows. Use when a change affects native-only behavior (navigation gestures, push, deep
  links, permissions, keyboard, platform branches) or a Maestro flow fails. If the app has no
  Maestro setup, run terreno-test-setup first.
---

# Writing Terreno mobile tests

## 1. Pick the layer

| Behavior | Layer |
|----------|-------|
| Logic that branches on `Platform.OS` / `Platform.select` | Bun unit test run per platform (`TEST_PLATFORM=android bun test`) |
| Component behavior identical on every platform | `terreno-frontend-tests` (Bun + RNTL), once |
| Flow on a real device: navigation, keyboard, deep link, permission prompt, push tap, app restart | Maestro flow |
| Same flow in a browser | Playwright (`terreno-frontend-tests`) |

Done when: you named the layer and, for Maestro, which platforms (iOS, Android, or both) the
flow must pass on.

## 2. Platform unit tests

The preload fixes `Platform.OS` per run (see `terreno-test-setup`). Write the test once and
assert the branch for the current platform:

```typescript
import {describe, expect, it} from "bun:test";
import {Platform} from "react-native";
import {keyboardOffset} from "./layout";

describe("keyboardOffset", () => {
  it("uses the platform's offset", () => {
    expect(keyboardOffset()).toBe(Platform.OS === "ios" ? 64 : 0);
  });
});
```

Run `bun test` and `bun run test:android` (and `test:web` if the code has a web branch).

## 3. Maestro flows

Write a flow per user goal, under `maestro/`, reusing subflows for login and navigation:

```yaml
appId: ${APP_ID}
---
# Creates a todo and sees it in the list after an app restart.
- launchApp:
    clearState: true
- runFlow: subflows/login.yaml
- extendedWaitUntil:
    visible:
      id: "todos-screen"
    timeout: 30000
- tapOn:
    id: "todos-title-input"
- inputText: "Buy milk"
- hideKeyboard
- tapOn:
    id: "todos-create-button"
- assertVisible: "Buy milk"
- stopApp
- launchApp
- extendedWaitUntil:
    visible: "Buy milk"
    timeout: 30000
```

Rules:

- **Select by `id:`** (the React Native `testID`). Fall back to visible text only for system
  UI and text you are asserting. Never select by coordinates or index.
- **Wait for screens** with `extendedWaitUntil: {visible: {id: "<screen>-screen"}, timeout}`
  after launch and every navigation. Never use fixed `waitForAnimationToEnd` chains or sleeps
  as the main wait.
- **Keyboards**: `hideKeyboard` after `inputText` before tapping something the keyboard may
  cover.
- **Fresh state**: `launchApp: {clearState: true}` at the start of a flow that must not depend
  on a previous run; seed data through the backend (seed script or API) rather than the UI.
- **Per-platform steps** with `runFlow: {when: {platform: Android}, commands: [...]}`: Android
  has a system `back`; iOS does not (navigate with the app's back button testID instead).
- **System dialogs** (permissions, iOS "Save Password?") are optional and platform-specific:
  ```yaml
  - runFlow:
      when:
        visible: "Not Now"
      commands:
        - tapOn: "Not Now"
  ```
- **Secrets and IDs** come from `-e` env vars (`${APP_ID}`, `${EMAIL}`, `${PASSWORD}`), never
  hard-coded.
- One goal per flow; `maestro/config.yaml` lists them in order for CI.

## 4. Run and debug

```bash
maestro test -e APP_ID=com.<org>.<app> -e EMAIL=... -e PASSWORD=... maestro/todos.yaml
maestro --device <udid|emulator-serial> test ...   # pick a device when several are booted
maestro hierarchy                                  # dump the screen: confirm a testID exists
maestro studio                                     # build steps interactively
```

| Symptom | Cause and fix |
|---------|---------------|
| `Element not found` for an `id:` | The component does not forward `testID`, or the element is off-screen: check `maestro hierarchy`, add `testID`, or `scrollUntilVisible` |
| App shows a network error | Backend unreachable: Android needs `adb reverse tcp:4000 tcp:4000` (and `tcp:8081` for Metro) after every emulator start |
| Passes on iOS, fails on Android | Keyboard covering the target (`hideKeyboard`), or a step that relies on iOS-only UI |
| First run on a fresh emulator times out | Maestro's driver install is slow the first time; rerun once |
| Red screen / stale bundle | Metro not running or serving another app: restart `expo start` for this app |

Save a screenshot on failure for the PR with `takeScreenshot: <name>` before the failing step,
or capture with `xcrun simctl io booted screenshot` / `adb exec-out screencap -p > shot.png`.

## Checklist

- [ ] Platform branches have unit tests that run under each platform they branch on
- [ ] Each Maestro flow targets one user goal, starts from `clearState`, and seeds data via the
      backend
- [ ] Every step selects by `id:` (testID) except system dialogs and asserted text
- [ ] Screens are awaited with `extendedWaitUntil`; no sleeps
- [ ] The flow passed on each platform the change affects, and you reported which devices ran
