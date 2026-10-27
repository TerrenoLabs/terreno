# Frontend test setup

Two layers: **unit/component tests** run in Bun with React Native mocked (fast, no device), and
**web E2E** runs the real app in Chromium with Playwright.

## Unit tests (Bun + React Native Testing Library)

### 1. Install

```bash
cd frontend
bun add -d @terreno/test@<same version as @terreno/ui> @testing-library/react-native@^13 \
  react-test-renderer@<exact react version>
```

- Pin React Native Testing Library to **13**. Version 14 makes `render` async and drops
  `react-test-renderer`; `renderWithTerreno` targets 13, and unpinned installs get 14 (tests
  then fail with `findByText is not a function`).
- `react-test-renderer` must match `react` exactly (both `19.2.3` today). Each run prints
  `react-test-renderer is deprecated`; that warning is expected with RNTL 13.
- `@terreno/test` also brings its backend dependencies (`mongodb-memory-server`, `express`);
  they are only loaded by backend tests.

### 2. Preload

`frontend/bunfig.toml`:

```toml
[test]
preload = ["./tests/testPreload.ts"]
coveragePathIgnorePatterns = ["**/*.test.ts", "**/*.test.tsx", "tests/**", "store/openApiSdk.ts"]
```

`frontend/tests/testPreload.ts`:

```typescript
import {registerExpoTestEnvironment} from "@terreno/test/expo/registerExpoTestEnvironment";

registerExpoTestEnvironment({
  expoConfig: {extra: {}, scheme: "<app scheme from app.json>"},
});
```

It mocks `react-native` (Bun cannot parse its Flow sources), the common `expo-*` modules,
`expo-router`, `@expo/vector-icons`, reanimated, gesture handler, SVG, AsyncStorage, NetInfo,
and SecureStore; serves images and fonts as asset stubs; sets `__DEV__`,
`IS_REACT_ACT_ENVIRONMENT`, `TZ`, and `EXPO_OS`. After each test it restores spies, empties
stored tokens, and resets `__DEV__`.

Options when the defaults do not fit:

| Need | Option |
|------|--------|
| A module should load for real | `skip: ["expo-sqlite"]` |
| App-specific native module | `overrides: {"react-native-maps": () => ({MapView: () => null})}` |
| Android / web `Platform.OS` | `platform: "android"` (default `"ios"`) |
| Fixed clock in every test | `fixedNow: "2024-06-01T10:30:00.000Z"` |
| A package ships its own nested `react-native` | `nestedPackagePrefixes: ["some-lib/node_modules/"]` |

Put any further app-wide `mock.module` calls (e.g. a partial `@/store/sdk` mock) in a second
preload file listed **after** `testPreload.ts`, and load the real module there with
`await import(...)` — a static import would evaluate before React Native is mocked.

### 3. First test

`frontend/components/Greeting.test.tsx`:

```tsx
import {describe, expect, it} from "bun:test";
import {renderWithTerreno} from "@terreno/test/expo/renderWithTerreno";
import {Greeting} from "./Greeting";

describe("Greeting", () => {
  it("shows the user's name", async () => {
    const {findByText} = renderWithTerreno(<Greeting name="Ada" />);
    expect(await findByText("Hello, Ada")).toBeTruthy();
  });
});
```

`renderWithTerreno(ui, {store?, theme?})` wraps the tree in `TerrenoProvider` (and a Redux
`Provider` when `store` is passed; needs `react-redux`).

Done when `cd frontend && bun test` passes.

## Playwright web E2E

### 1. Install

```bash
cd frontend
bun add -d @playwright/test
bunx playwright install --with-deps chromium
```

E2E needs a **replica-set** `mongod` (the backend's sync and realtime use change streams):

```bash
mongod --replSet rs0 --port 27017 --bind_ip 127.0.0.1 --dbpath ./.devdata/mongo &
mongosh --quiet --eval 'try { rs.status() } catch { rs.initiate({_id: "rs0", members: [{_id: 0, host: "127.0.0.1:27017"}]}) }'
```

### 2. Config

`frontend/playwright.config.ts`:

```typescript
import {defineConfig, devices} from "@playwright/test";

export default defineConfig({
  projects: [
    {name: "setup", testMatch: /auth\.setup\.ts/},
    {dependencies: ["setup"], name: "chromium", use: {...devices["Desktop Chrome"]}},
  ],
  testDir: "./e2e",
  use: {baseURL: "http://localhost:8082", trace: "retain-on-failure"},
  webServer: [
    {
      command: "bun run --cwd ../backend src/index.ts",
      env: {MONGO_URI: process.env.MONGO_URI ?? "mongodb://127.0.0.1/<app>-e2e?replicaSet=rs0", PORT: "4000"},
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: "http://localhost:4000/health",
    },
    {
      command: "bunx expo start --web --port 8082",
      env: {EXPO_PUBLIC_API_URL: "http://localhost:4000"},
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      url: "http://localhost:8082",
    },
  ],
});
```

### 3. Layout

```
e2e/
  fixtures/testUsers.ts   # TEST_USER, ADMIN_USER: {email, name, password}
  helpers/login.ts        # loginAs(page, user = TEST_USER)
  auth.setup.ts           # creates the users through the API before any spec runs
  <feature>.spec.ts
```

`e2e/helpers/login.ts`:

```typescript
import type {Page} from "@playwright/test";
import {TEST_USER} from "../fixtures/testUsers";

export const loginAs = async (page: Page, user = TEST_USER): Promise<void> => {
  await page.goto("/login");
  await page.getByTestId("login-screen").waitFor({state: "visible"});
  await page.getByTestId("login-screen-email-input").fill(user.email);
  await page.getByTestId("login-screen-password-input").fill(user.password);
  await page.getByTestId("login-screen-submit-button").click();
  await page.getByTestId("login-screen").waitFor({state: "hidden"});
};
```

`e2e/auth.setup.ts` signs each fixture user up through the backend's auth API and ignores
"already exists", so reruns are idempotent. With Better Auth (the `create-terreno-app`
default) that is `request.post("http://localhost:4000/api/auth/sign-up/email", {data: {email,
name, password}})`; with JWT auth it is `POST /auth/signup`. `bun run --cwd ../backend` loads
`backend/.env`, so the backend gets its auth secrets. The `@terreno/ui` login screen already
carries the `login-screen*` testIDs; give a custom form the same IDs.

Done when `bunx playwright test` passes. Add `"test:e2e": "playwright test"` to the scripts.
