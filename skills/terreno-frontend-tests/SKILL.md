---
name: terreno-frontend-tests
description: >-
  Write and fix frontend tests for a Terreno Expo app: Bun + React Native Testing Library unit
  tests for components, screens, hooks, Redux/RTK and syncdb data, and Playwright web E2E for
  flows across screens and the backend. Covers renderWithTerreno, testID selectors, mocking
  data hooks without leaking module mocks, async waiting, and Playwright login/fixtures. Use
  when adding or changing frontend behavior or when a frontend test fails. If the app has no
  test preload or Playwright config, run terreno-test-setup first.
---

# Writing Terreno frontend tests

## 1. Pick the layer

| Behavior | Layer |
|----------|-------|
| Pure function, reducer, selector, formatter | Bun unit test, no rendering |
| Component or screen renders states and reacts to input | Bun + React Native Testing Library |
| Custom hook | `renderHook` with `createTerrenoWrapper` |
| Flow across screens, real backend, auth, navigation, persistence | Playwright web E2E |
| Native-only behavior (gestures, push, camera, deep links on device) | `terreno-mobile-tests` |

Prefer the lowest layer that proves the behavior; add one E2E per user-visible flow, not per
edge case.

Done when: the test sits next to the code (`TodoList.tsx` → `TodoList.test.tsx`; E2E in
`e2e/<feature>.spec.ts`).

## 2. testIDs first

Every element a test touches gets a `testID` in the component, named
`{screen}-{element}-{qualifier}`: `todos-screen`, `todos-create-button`,
`todo-item-${id}`, `login-screen-email-input`. Add missing IDs to the component before writing
the test. Select by `testID` in both layers; fall back to role, then text.

Always give testIDs to: each screen's root `Box`/`Page`, buttons and pressables, inputs, error
and validation text, loading indicators, list containers, and list items (dynamic IDs).

## 3. Component tests (Bun + RNTL)

```tsx
import {describe, expect, it, mock} from "bun:test";
import {renderWithTerreno} from "@terreno/test/expo/renderWithTerreno";
import {fireEvent} from "@testing-library/react-native";
import {TodoForm} from "./TodoForm";

describe("TodoForm", () => {
  it("submits the trimmed title", async () => {
    const onSubmit = mock((_title: string) => undefined);
    const {findByTestId, getByTestId} = renderWithTerreno(<TodoForm onSubmit={onSubmit} />);
    await findByTestId("todo-form");

    fireEvent.changeText(getByTestId("todo-form-title-input"), "  Buy milk ");
    fireEvent.press(getByTestId("todo-form-submit-button"));

    expect(onSubmit).toHaveBeenCalledWith("Buy milk");
  });

  it("shows a validation error for an empty title", async () => {
    const {findByTestId, getByTestId} = renderWithTerreno(<TodoForm onSubmit={mock()} />);
    await findByTestId("todo-form");
    fireEvent.press(getByTestId("todo-form-submit-button"));
    expect(await findByTestId("todo-form-title-error")).toBeTruthy();
  });
});
```

- `renderWithTerreno(ui, {store?, theme?})` wraps in `TerrenoProvider` (and Redux `Provider`
  with `store`). Use it instead of hand-wrapping.
- Start every test with `await findByTestId("<root testID>")`: `TerrenoProvider` loads fonts
  asynchronously, and querying synchronously before that settles logs
  `not wrapped in act(...)` warnings.
- Then `getBy*` for what is rendered, `findBy*` for what appears after an effect or promise,
  `queryBy*` to assert absence.
- Assert with `bun:test`'s `expect`: `expect(getByText("Buy milk")).toBeTruthy()`,
  `within(getByTestId("todos-list")).getByText(...)`, `expect(queryByTestId(...)).toBeNull()`.
  RNTL's extra matchers (`toHaveTextContent`, `toBeVisible`) run but do not type-check
  against `bun:test`, so `tsc` fails on them.
- Import order: `bun:test`, then `@terreno/*`, then `@testing-library/*`, then local files
  (what Biome's `organizeImports` expects).
- Interact with `fireEvent.press` / `fireEvent.changeText`; Terreno `Button` calls `onClick`
  through `onPress`.
- Cover each state the component has: loading, empty, error, populated, disabled.
- Hooks: `renderHook(() => useThing(), {wrapper: createTerrenoWrapper({store})})` from
  `@testing-library/react-native` and `@terreno/test/expo/renderWithTerreno`.

## 4. Data in component tests

Choose in this order:

1. **Props.** Split data loading (container) from rendering (presentational) and test the
   presentational component with literal props. Most screens need nothing else.
2. **syncdb collections in screens.** Wrap the app's collection hooks in one module
   (`store/syncDbSdk.ts` exporting `useTodos()` etc.) and mock that module in a preload with
   controllable rows, the same way as RTK hooks below. Test syncing behavior itself (outbox,
   conflicts, deltas) against a real client built with `createFakeTransport` from
   `@terreno/syncdb/testing`; it also needs a fake `httpChannel`, a memory
   `persisterFactory`, and an `authProvider` — copy the `makeHarness` pattern from
   `node_modules/@terreno/syncdb/src/client.test.ts`.
3. **Generated RTK hooks (`useGetXQuery`) and app modules.** Mock them **once in a preload**
   (a second preload file after `testPreload.ts`) with controllable state, never with
   `mock.module` inside a test file — module mocks last for the whole process and leak into
   every later file:
   ```typescript
   // tests/sdkMocks.ts (preloaded)
   import {mock} from "bun:test";
   export const sdkState = {todos: [] as unknown[], isLoading: false};
   const actualSdk = await import("@/store/sdk");
   mock.module("@/store/sdk", () => ({
     ...actualSdk,
     useGetTodosQuery: () => ({data: {data: sdkState.todos}, isLoading: sdkState.isLoading}),
   }));
   ```
   Tests set `sdkState` in `beforeEach`; reset it in the preload's `afterEach`.

Auth tokens: `setAuthTokens({authToken: "token"})` / `clearAuthTokenStorage()` from
`@terreno/test/expo/authTokenStorage` seed the in-memory SecureStore/AsyncStorage the preload
installs (cleared after every test).

## 5. Async, time, and isolation

- Wait for UI with `findBy*` or RNTL's `waitFor`. For non-render conditions (mock calls,
  store state, socket events) use `waitUntil` / `waitForCalls` from `@terreno/test`. Never
  sleep with `setTimeout`.
- Freeze the clock with `freezeTime("2024-06-01T10:30:00Z")` from `@terreno/test` (Date.now,
  new Date, and Luxon together).
- `spyOn` is restored after every test by the preload. `mock.module` is not — keep it in
  preload files.
- `terreno-test-hygiene` (from `@terreno/test`) flags module-scope `mock.module`, sleeps,
  barrel mocks, and component snapshots; run it before pushing if the repo uses it.
- Do not snapshot components (`toMatchSnapshot`): assert the text, testIDs, and props that
  matter.

## 6. Playwright web E2E

```typescript
import {expect, test} from "@playwright/test";
import {loginAs} from "./helpers/login";

test.describe("Todos", () => {
  test.beforeEach(async ({page}) => {
    await loginAs(page);
    await page.getByTestId("todos-screen").waitFor({state: "visible"});
  });

  test("user can create a todo", async ({page}) => {
    await page.getByTestId("todos-title-input").fill("Buy milk");
    await page.getByTestId("todos-create-button").click();
    await expect(page.getByTestId("todos-list")).toContainText("Buy milk");
  });
});
```

Rules:

- Select with `getByTestId()`; fall back to `getByRole()`; use `getByText()` sparingly (React
  Native Web wraps text in extra elements). Never select by class name (`.css-abc123` changes
  every build) or deep structure (`div > div > div`).
- React Native Web renders `View` as `div`, `Text` as `div`/`span`, `Pressable` as
  `div[role="button"]`, `TextInput` as `input`/`textarea`, `Switch` as `div[role="switch"]`
  with `aria-checked`.
- Never `page.waitForTimeout()`. After navigation, wait for the target screen's root testID to
  be visible; after a fetch, wait for the content or for the spinner to be hidden; use
  web-first assertions (`await expect(locator).toHaveText(...)`), which retry.
- Log in through `loginAs(page)` in `test.beforeEach`, never inside a test body.
- Group with `test.describe()`, navigate in `test.beforeEach()`, name tests as user behavior
  (`"user can submit a valid form"`), and keep tests independent: each creates its own data
  or uses its own fixture user from `e2e/fixtures/testUsers.ts`.
- Seed through the API (`request.post`) in `beforeEach`/`auth.setup.ts`, not through the UI,
  unless the UI path is what is under test.

Run:

```bash
bunx playwright test e2e/todos.spec.ts --reporter=list
bunx playwright test --ui                 # debug interactively
bunx playwright show-trace test-results/<test>/trace.zip
```

## Checklist

- [ ] Every touched element has a `{screen}-{element}-{qualifier}` testID
- [ ] Each component state (loading, empty, error, populated) has a test
- [ ] Data comes from props or a preload SDK/syncdb-hook mock — no `mock.module` in test
      files
- [ ] No sleeps, `waitForTimeout`, class selectors, or component snapshots
- [ ] E2E logs in with `loginAs` in `beforeEach` and waits on screen root testIDs
- [ ] `bun test` (and `bunx playwright test` for E2E changes) passes for the whole app
- [ ] UI changes also get runtime evidence via `verify-ui-changes`
