# Backend test setup

Bun's test runner plus `@terreno/test`: in-memory MongoDB, canonical auth env, quiet logs, a
Sentry mock, and supertest helpers.

## 1. Install

```bash
cd backend
bun add -d @terreno/test@<same version as @terreno/api> supertest @types/supertest
```

`mongoose` is a peer dependency and is already in a Terreno backend. `mongodb-memory-server`
downloads a `mongod` binary on first use (Bun blocks its postinstall by default; the first test
run downloads it instead, which can take a minute).

## 2. Preload

`backend/bunfig.toml`:

```toml
[test]
preload = ["./src/tests/bunSetup.ts"]
root = "./src"
```

`backend/src/tests/bunSetup.ts` — one file: SDK mocks first (if any), then the Mongo preload:

```typescript
import {registerBackendPreload, registerSendGridMock} from "@terreno/test";

// Only for SDKs the app imports (a fresh create-terreno-app backend imports none; skip these).
export const sendGrid = registerSendGridMock();

registerBackendPreload({
  onBeforeEach: () => {
    sendGrid.reset();
    // Keys the app reads that must start every test unset.
    Reflect.deleteProperty(process.env, "SENDGRID_API_KEY");
  },
  testEnv: {
    extra: {APP_URL: "http://localhost:8082"},
    tokenIssuer: "<app>.test",
  },
});
```

What the preload does:

| When | Effect |
|------|--------|
| once per run | starts one `mongodb-memory-server` `mongod` (or connects to `TERRENO_TEST_MONGODB_URI`), mocks `@sentry/bun`, silences Winston/console |
| `beforeEach` | resets `TOKEN_SECRET`, `TOKEN_ISSUER`, `REFRESH_TOKEN_SECRET`, `SESSION_SECRET`, `NODE_ENV=test`, `TZ=UTC`, plus `testEnv.extra`; runs `onBeforeEach` |
| `afterEach` | resets the system clock, clears mock calls, restores `spyOn` spies, re-applies the env |

- It does **not** wipe collections. Tests delete what they read (see `terreno-backend-tests`).
- A cold `mongod` start can take 20s+; the launch timeout defaults to 60s
  (`TERRENO_TEST_MONGO_LAUNCH_TIMEOUT_MS` to change it). The first run also downloads the
  `mongod` binary.
- Some lines still print (`debug: No options.openApi provided...` when a test builds a
  `TerrenoApp`, request logs). They are harmless.
- Change streams, transactions, or `SyncApp` under test need a replica set: set
  `process.env.TERRENO_TEST_USE_REPLSET = "true"` at the top of the preload.
  `registerBackendPreload({useTransactions: true})` also wraps each test in a transaction
  that is aborted afterwards (no cleanup code, but every DB call is serialized through one
  session); use it only when cleanup cost dominates the suite.
- `registerSimpleMongoPreload` is the lighter variant the Terreno packages use; prefer
  `registerBackendPreload` in apps.

## 3. Third-party services

`mock.module` replaces a module for the whole `bun test` process, so a mock registered inside
one test file leaks into every later file. Register SDK mocks **only in the preload**, export
the handles so tests can assert on them, and `reset()` each in `onBeforeEach` (the preload's
`afterEach` clears call history but not stored state such as GCS objects or queued tasks).

| Registrar | Module |
|-----------|--------|
| `registerSendGridMock` | `@sendgrid/mail` |
| `registerTwilioMock` | `twilio` |
| `registerExpoPushMock` | `expo-server-sdk` |
| `registerCloudTasksMock` | `@google-cloud/tasks` |
| `registerGcsMock` | `@google-cloud/storage` |
| `registerGoogleAuthMock` | `google-auth-library` |
| `registerTerrenoNotifierMocks` | `sendToSlack` / `sendToZoom` / `sendToGoogleChat` from `@terreno/api` |

The AI SDK needs no module mock: pass `createMockLanguageModel()` to `AIService` (see
`terreno-backend-tests`). Prefer constructor injection over a module mock when the app already
accepts a client (for example `@terreno/comms` providers).

## 4. First test

`backend/src/api/users.test.ts` — proves the preload, Mongo, and supertest work:

```typescript
import {describe, expect, it} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import supertest from "supertest";
import {User} from "../models/user";
import {userRouter} from "./users";

const buildApp = () =>
  new TerrenoApp({skipListen: true, userModel: User as never}).register(userRouter).build();

describe("users", () => {
  it("rejects anonymous list requests", async () => {
    const res = await supertest(buildApp()).get("/users");
    expect(res.status).toBe(401);
  });
});
```

Build a `TerrenoApp` with only the routers under test instead of calling the app's `start()`:
`start()` connects to the dev database and registers every plugin.

## CI

```json
"scripts": {
  "test": "bun test",
  "test:ci": "bun test",
  "test:shard": "terreno-test-shard",
  "test:hygiene": "terreno-test-hygiene --root src"
}
```

- Sharding: `bun run test:shard --shard $INDEX/$TOTAL` in a CI matrix; `--list` prints a
  shard's files; flags after `--` go to `bun test` (e.g. `-- --timeout 30000`).
- Hygiene: run `bun run test:hygiene --update-baseline` once to record existing violations,
  commit the baseline, then run `bun run test:hygiene` in CI so only new ones fail.
- Unit jobs need no services: the in-memory `mongod` runs inside the job.
