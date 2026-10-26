---
name: terreno-backend-tests
description: >-
  Write and fix Bun tests for a Terreno backend: modelRouter routes and actions, permissions,
  Mongoose models and hooks, services that call SendGrid / Twilio / Expo push / Cloud Tasks /
  GCS / AI models, env-dependent code, time, and async side effects. Covers supertest +
  @terreno/test helpers, auth tokens, test data, service mocks, and flake-free waiting. Use
  when adding or changing backend behavior or when a backend test fails. If the app has no
  test preload yet, run terreno-test-setup first.
---

# Writing Terreno backend tests

Tests use `bun:test`, run against a real in-memory MongoDB, and call the app through HTTP with
supertest. Never mock `@terreno/api` internals or your own models — exercise the real stack.

## 1. Pick the seam

| Behavior | Test through |
|----------|--------------|
| CRUD, actions, permissions, query filters, response shape | HTTP route (`supertest`) — default |
| Model statics, methods, hooks, validation | the model directly |
| A service with no route | its exported function |
| Third-party side effect (email, SMS, task, upload, AI call) | the route or service, asserting on the preload's mock handle |

Done when: the test file sits next to the code (`todos.ts` → `todos.test.ts`) and names the
seam in its `describe`.

## 2. Build the app per file

```typescript
import {beforeEach, describe, expect, it} from "bun:test";
import {generateTokens, TerrenoApp} from "@terreno/api";
import {authWithToken, expectAPIError} from "@terreno/test";
import supertest from "supertest";
import {Todo} from "../models/todo";
import {User} from "../models/user";
import {todoRouter} from "./todos";

const app = new TerrenoApp({skipListen: true, userModel: User as never})
  .register(todoRouter)
  .build();
```

Register only the routers and plugins under test. Do not call the app's `start()`: it connects
to the dev database and registers everything.

## 3. Authenticate

```typescript
const createUser = async (email: string, admin = false) =>
  User.register({admin, email, name: email} as never, "password12345");

const agentFor = async (user: unknown) =>
  authWithToken(app, {token: (await generateTokens(user)).token});
```

- `authWithToken` + `generateTokens` mints the same JWT `/auth/login` issues, without the
  ~200ms password hash. Use it everywhere except tests of the login flow itself.
- `authAsUser(app, {email, password})` really logs in; keep it for login, lockout, and
  password tests.
- `supertest(app)` with no token is the anonymous client.

Permission failures by layer — assert the exact status:

| Case | Status |
|------|--------|
| No or invalid token on a protected route | 401 |
| Method-level permission fails (`list`, `create`, or a disabled `[]` method) | 405 |
| Object-level permission fails (`read`, `update`, `delete` on a loaded document, e.g. `IsOwner`) | 403 |
| `list` where `queryFilter` excludes another user's documents | 200, those documents absent |
| Id that does not exist | 404 |

Write one test per role that matters: owner, other user, admin, anonymous.

## 4. Create and clean data

- Create exactly what the test needs, in the test or a `beforeEach`, with small factory
  functions (`createUser`, `createTodo({ownerId, ...overrides})`) local to the file or in
  `src/tests/factories.ts`.
- The default preload does not wipe the database. Start each test clean for the collections
  it reads: `beforeEach(async () => { await Todo.deleteMany({}); await User.deleteMany({}); })`.
  (Apps on `registerBackendPreload({useTransactions: true})` roll back automatically; skip
  the deletes there.)
- Dates are Luxon: `DateTime.fromISO("2024-06-01T10:00:00Z")`, compared with `.toISO()` or
  `.toMillis()`.
- Expected values are literals from the example, never recomputed with production code.

## 5. Assert

```typescript
it("lets an owner list only their todos", async () => {
  const owner = await createUser("owner@example.com");
  const other = await createUser("other@example.com");
  await Todo.create({ownerId: owner._id, title: "Mine"});
  await Todo.create({ownerId: other._id, title: "Theirs"});

  const res = await (await agentFor(owner)).get("/todos").expect(200);

  expect(res.body.data.map((todo: {title: string}) => todo.title)).toEqual(["Mine"]);
  expect(res.body.total).toBe(1);
});

it("rejects a todo without a title", async () => {
  const res = await (await agentFor(await createUser("a@example.com"))).post("/todos").send({});
  expectAPIError(res, {status: 400, title: /validation/i});
});
```

- List responses are `{data, limit, more, page, total}`; single documents are `{data}`.
- `expectAPIError(res, {status, title?, detail?, code?, fields?})` matches the JSONAPI error
  body; `fields` partially matches `meta.fields`.
- On routes that return user or PHI data, pin the response shape so a new model field cannot
  leak: `assertStrictResponseProperties(res.body, ["data._id", "data.name", "limit", "more",
  "page", "total"])`.
- After a write, re-read through the API (or `Model.findById`) to prove persistence.

## 6. Services and side effects

Mocks are registered once in `src/tests/bunSetup.ts` and exported (see `terreno-test-setup`).
Import the handle and assert what the app sent:

```typescript
import {cloudTasks, gcs, sendGrid} from "../tests/bunSetup";

expect(sendGrid.getSentMessages()).toEqual([
  expect.objectContaining({subject: "Welcome", to: "new@example.com"}),
]);

await cloudTasks.drainTasks({app, headers: {authorization: "Bearer task-secret"}});

gcs.putObject({bucket: "uploads", contents: "hi", name: "a.txt"});
```

- Cloud Tasks: assert `getEnqueuedTasks()` (decoded bodies), then `drainTasks({app})` to run
  the task handlers through HTTP; it also drains tasks the handlers enqueue.
- Make a provider fail with the mock's standard API, e.g.
  `sendGrid.send.mockRejectedValueOnce(new Error("503"))`, and assert the app's handling.
- AI: `new AIService({model: createMockLanguageModel({responses: [{text: "Hi"}, {toolCalls:
  [...]}]})})`; assert prompts via `model.doGenerate.mock.calls` / `doStream.mock.calls`.
- Never `mock.module` inside a test file: it replaces the module for every later file in the
  run. Use the preload, dependency injection, or `spyOn(object, "method")` (restored
  automatically after each test).

## 7. Env, time, and async

- Env: set only the keys the test needs (`process.env.FEATURE_X = "true"`); express "unset" as
  `Reflect.deleteProperty(process.env, "KEY")`. The preload re-applies the canonical env after
  every test. Never snapshot and restore all of `process.env`.
- Time: `freezeTime("2024-06-01T10:30:00Z")` from `@terreno/test` freezes `Date.now()`,
  `new Date()`, and Luxon for the current test and restores afterwards.
- Async side effects (post-save hooks, fire-and-forget writes, jobs): wait for the outcome, not
  a duration — `await waitForDocuments(AuditEvent, {action: "create"}, 1)`,
  `await waitUntil(() => sendGrid.send.mock.calls.length > 0, {label: "welcome email"})`, or
  `await waitForCalls(mockFn, 2)`. Never `await new Promise((r) => setTimeout(r, n))`.

## 8. Run

```bash
bun test src/api/todos.test.ts          # one file
bun test -t "lists only their todos"    # by name
bun test --only-failures                # rerun what failed last time
bun test --coverage                     # coverage report
```

A test that passes alone and fails in the full run is leaking state: a module mock in a test
file, a collection not cleaned, or an env key not reset. Fix the leak; do not reorder files.

## Checklist

- [ ] Happy path plus each rejected role/case asserts an exact status
- [ ] Data created in the test; collections it reads cleaned in `beforeEach`
- [ ] Third-party calls asserted on the preload mock handles; no `mock.module` in the file
- [ ] No sleeps; async outcomes awaited with `waitUntil` / `waitForDocuments`
- [ ] Time-dependent behavior uses `freezeTime`; env changes are targeted
- [ ] `bun test` passes for the whole backend, not just the file
