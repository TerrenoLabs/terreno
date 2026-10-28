# @terreno/rtk e2e tests

Run the rtk smoke after a compile:

```bash
bun run compile && bun run --cwd rtk smoke   # or, from the root: bun run smoke rtk
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | The JWT and Better Auth slices, the Better Auth client factory (cookie and web bearer modes, cookie-jar repair, OAuth handoff), the base query's token-source and refresh paths, sockets, offline middleware, feature-flag and upgrade hooks, with `@better-auth/expo/client` and other modules mocked per file (`src/**/*.test.ts`) | `bun run --cwd rtk test` |
| Smoke | The compiled package's Better Auth client, slice, and base query against a real example-backend | `bun run --cwd rtk smoke` |
| E2E | Sign-in, session, and SDK queries seen by a user, through example-frontend's Playwright suite against example-backend | `bun run frontend:e2e` |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`rtk/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/rtk/e2e/smoke.ts)
runs at the `http` layer. It starts example-backend with `spawnExampleBackend()` against
`smokeMongoUri()` (Better Auth is the backend's default provider), sets `EXPO_PUBLIC_API_URL` to
the backend's URL, and then imports the compiled `@terreno/rtk` in the smoke's own Bun process.
It builds a store the way a web app in bearer mode does:

- `createBetterAuthClient({webAuth: "bearer"})` with an in-memory `bearerStorage`, because Bun
  has no `window.localStorage`.
- `setTokenSource(betterAuthAdapter(bridgeBetterAuthReactClient(client), {getBearerToken}))`,
  the adapter from example-frontend's `store/syncdb.ts`, registered as in its `store/index.ts`.
- `generateBetterAuthSlice` and `emptySplitApi` with one injected `getMe` query on `/auth/me`.

Then it checks:

1. A new user signs up and signs in through the Better Auth client, and the client stores the
   bearer token from the sign-in response.
2. `syncSession` puts that user in the `betterAuth` slice (`isAuthenticated`, matching email).
3. The `getMe` query, sent by rtk's base query with the registered token source, returns the
   signed-in user's email from `/auth/me`. Without `setTokenSource` this check fails.

Each check prints one `✅` line. The smoke exits 1 on the first failure, after printing the
backend's output. The email carries the run's timestamp, so runs against the shared CI Mongo do
not collide.

### Native-module shims

rtk targets React Native, and its package root loads modules that cannot run in Bun. The smoke
runs in Bun anyway, with `mock.module` shims installed before it imports the package:

- [`rtk/test-preload.ts`](https://github.com/TerrenoLabs/terreno/blob/master/rtk/test-preload.ts),
  the shims rtk's unit tests already use: `react-native` (`Platform.OS` is `"web"`, plus
  `AppState`, `Linking`, `StyleSheet`), `expo-secure-store`,
  `@react-native-async-storage/async-storage`, `expo-constants`, and `expo-network`.
- `@terreno/ui`, a `useToast` stub: `socket.ts` imports it, and the smoke never calls it.
- `expo-linking`, a `createURL` stub: the real `@better-auth/expo/client` plugin imports it for
  social sign-in deep links. The unit tests mock that plugin whole; the smoke runs it.

Because `Platform.OS` is `"web"`, the smoke proves the web bearer path, not the native
SecureStore cookie-jar path. Native sign-in stays covered by the unit tests and example-frontend
on a device.

**Measured time:** 15–18 s in three root `bun run smoke` runs (the [guide's](../e2e.md#package-pages) figure), against a running replica-set Mongo
(`TERRENO_TEST_MONGODB_URI`), excluding the compile. Single runs on a loaded container took up
to 50 s. Almost all of it is example-backend booting until `/health` answers 200;
the rtk checks take under a second. The first boot against a fresh database also runs
example-backend's startup work and took about 70 s in a slow-I/O sandbox, so the smoke allows
120 s for readiness. Budget: 30 s. A warm boot fits it; a slow or cold boot goes over, and the
overage is `spawnExampleBackend()` readiness, which the other client smokes (syncdb,
admin-frontend) share. The rtk checks themselves are not the cost.

## Add an e2e test

- **New rtk behavior** (a slice action, a base-query rule, a client option): add a unit test in
  `rtk/src/`. The smoke stays one happy path; do not add edge cases to it.
- **The smoke's happy path changed** (for example, `createBetterAuthClient`, `setTokenSource`, or
  the base query's token-source path): update the checks in `rtk/e2e/smoke.ts` and keep it
  within 30 s.
- **The package root loads a new native module:** add its shim to the smoke's `loadRtk`, or to
  `test-preload.ts` when the unit tests need it too, and list it above.
- **A user-visible auth or SDK flow:** add a Playwright spec in `example-frontend/e2e/`, following
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec).
