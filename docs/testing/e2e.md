# E2E guide

How this repository builds and writes end-to-end tests. Implementation plans name specs by
the paths and layers below. To run any CI job locally, see
[Run tests locally](../how-to/run-tests-locally.md).

| Layer | Where specs live | Runner |
| --- | --- | --- |
| `browser` | `example-frontend/e2e/*.spec.ts` | Playwright (`example-frontend/playwright.config.ts`) |
| `http` | `<package>/src/**/*.test.ts` | `bun test`, `supertest` on a `TerrenoApp` |

## `browser`

A real Chromium drives the example web app at `http://localhost:8082`, which talks to a real
example-backend on port 4000. `playwright.config.ts` starts both when they are not already
running.

### Where specs live

- One file per feature: `example-frontend/e2e/<feature>.spec.ts`, kebab-case.
- Shared helpers: `example-frontend/e2e/helpers/`. Shared data:
  `example-frontend/e2e/fixtures/`.
- Import `test` and `expect` from `./fixtures/test`. It fails a test on an unexpected
  console warning or error. Allow a known message with the `consoleGuard` fixture.
- `e2e/auth.setup.ts` creates the users in `fixtures/testUsers.ts` before any spec runs.

### Signing in

- `loginAs(page, user?)` from `e2e/helpers/login.ts` signs in through the login screen.
  The default user is `TEST_USER`. It returns once the signed-in app is visible.
- `loginAsAdmin(page)` from `e2e/helpers/adminAuth.ts` makes `ADMIN_USER` an admin and
  signs in as that user.
- Call either one in `test.beforeEach`, never inside a single test.
- A spec that changes a user's data uses its own user from `fixtures/testUsers.ts`, so
  files that run in parallel do not share state.

### Finding elements

1. `page.getByTestId(...)` first. Every screen root, button, input, error message, loading
   indicator, list, and list item the spec touches gets a `testID`, named
   `{screen}-{element}-{qualifier}` (for example `login-screen-submit-button`). Add a
   missing `testID` to the component before writing the spec.
2. `getByRole(...)` when there is no `testID`, such as in a third-party component.
3. `getByText(...)` sparingly. React Native Web wraps text in extra elements.

Never select by class name or by deep structural selectors. React Native Web generates
hashed class names and changes its DOM between versions.

### Waiting

- Wait for the element that proves the state:
  `await page.getByTestId("todos-screen").waitFor({state: "visible"})` after each
  navigation, and the content element (or a hidden loading indicator) after a fetch.
- Use `expect(locator).toBeVisible()`, `toHaveText()`, and similar web-first assertions,
  which retry until their timeout.
- Never use `page.waitForTimeout()`. A fixed sleep is flaky. New specs must not add one.

### Mocking the AI model

The e2e suite never calls a real model. Route `/gpt/prompt` with the helpers in
`e2e/helpers/mockGpt.ts`:

| Helper | Use |
| --- | --- |
| `mockGptStream(page, text)` | One streamed text reply |
| `mockGptTurns(page, turns)` | A scripted SSE event list per request; returns each request body |
| `mockGptAskStream`, `mockGptBlocks`, `mockGptDocument` | Ask, blocks, and document turns |
| `mockSavedHistory`, `savedHistory`, `userRow`, `assistantRow` | A saved conversation for reload checks |
| `unmockGptStream(page)` | Remove the route |

To seed real history rows in the database, use `seedGptHistory` from
`e2e/helpers/seedGptHistory.ts`. Whether the prompt and tools reach the model is an `http`
concern, not a `browser` one.

### Running

Prerequisite: a replica-set `mongod` on `127.0.0.1:27017`. The backend's change streams
need it. Setup steps are in [Run tests locally](../how-to/run-tests-locally.md#playwright-example-frontend-e2e).

```bash
cd example-frontend && bunx playwright test e2e/<spec>.spec.ts
```

Locally, `playwright.config.ts` phases the specs that share backend state (consents,
syncdb) behind the others. Pass `--no-deps` to run one of those alone. The cross-site specs
listed in `CROSS_SITE_SPEC_FILES` run in their own mode. See the how-to for both.

## `http`

A route test builds the real Express app with `TerrenoApp` (`skipListen: true`) and sends
requests through `supertest`. It runs with `bun test` against the in-memory MongoDB from
`@terreno/test`, so it needs no running server.

- Specs live beside the code: `<package>/src/**/*.test.ts`. For example,
  `ai/src/routes/*.test.ts`.
- Sign in with `authAsUser` from `@terreno/test`. It returns a signed-in `supertest` agent.
  AI tests use the wrapper in `ai/src/tests/helpers.ts`, which takes a role name.
- AI routes use `ai/src/tests/chatHarness.ts`: `buildApp({model, ...options})` builds the
  chat and history routes, and `createScriptedModel` returns a model whose calls a test reads
  with `modelCall` and `systemPromptOf`.
- Prefer real models, routes, and the database. Fake only true external boundaries, such as
  the LLM provider or cloud storage.

Run one file:

```bash
bun test --only-failures ai/src/routes/<name>.test.ts
```
