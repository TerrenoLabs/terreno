# @terreno/syncdb e2e tests

Run the syncdb smoke after a compile:

```bash
bun run compile && bun run --cwd syncdb smoke   # or, from the root: bun run smoke syncdb
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | The TinyBase store, outbox, replay, conflicts, delta applier, snapshot bootstrap, query windows, persisters, encryption codecs, the Better Auth adapter, and the React hooks, against `createFakeTransport` and fake IndexedDB (`src/**/*.test.ts`). The real socket and HTTP protocol against an in-process server is covered by `api/src/sync/integration.test.ts` | `bun run --cwd syncdb test` |
| Smoke | Two clients built from the compiled package sync one todo through a real example-backend child process | `bun run --cwd syncdb smoke` |
| E2E | The synced todos screens in Chromium (offline outbox, conflicts, storage, chaos, load) through example-frontend's `syncdb-*.spec.ts` Playwright suite against example-backend | `bun run frontend:e2e` |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`syncdb/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/syncdb/e2e/smoke.ts)
runs at the `http` and websocket layer. It starts example-backend with `spawnExampleBackend()`
against `smokeMongoUri()`, so it never imports `@terreno/api`. It imports `@terreno/syncdb` by
package name, which resolves to `dist/`. Then it:

1. Signs a new user up through `POST /api/auth/sign-up/email`, then signs the same user in
   again through `POST /api/auth/sign-in/email`, giving two Better Auth sessions, as two devices
   would have.
2. Builds client A and client B with `createSyncDb` for the `todos` collection. Each uses the
   default socket transport and HTTP channel, the memory persister, `debug: true`, and
   `betterAuthAdapter` over a small client that reads `GET /api/auth/get-session` with its own
   bearer token.
3. Starts both clients and waits until each one settles: its debug log has a
   `subscribe catch-up` pass for its `todos|owner:{userId}` stream, and `isSyncing` is false.
4. Client A calls `mutate()` to create a todo, and the smoke waits until the server acks it: the
   local row has a server `seq` and no pending mutation.
5. Within 5 s of client A's write, client B's debug log has a `delta` event for that todo, and
   B's local store holds it with its title and a server `seq`.

It prints one `✅` line per check and exits 1 on the first failure, after printing the backend's
output. Settling first means B's startup reconcile and subscribe catch-up are done before the
write, and the periodic reconcile is off (`reconcileIntervalMs: 0`). The `delta` event is
recorded only when a socket delta is applied, so step 5 fails if B gets the todo from an HTTP
snapshot page instead. A client B signed in as a different user never receives the todo and
also fails at step 5; that case proves owner scoping, not the socket path. Each run uses a new
email and todo title, so reruns against a shared `TERRENO_TEST_MONGODB_URI` never collide.

**Measured time:** 14–16 s against an external replica set on an idle container (passing runs
took 13.8, 14.5 and 15.9 s), excluding the compile. Booting example-backend takes most of it.
Settling takes about 0.5 s, and delivery from A to B took 110–720 ms. On a 4-core container
shared with other builds and type checks, passing runs took 38–60 s, and two runs missed
`spawnExampleBackend()`'s 60 s readiness timeout before the backend answered `/health`. The
in-memory replica set did not start within 60 s on that container. Budget: 30 s.

If the in-memory replica set times out waiting for a primary, point the smoke at a running
replica set the way CI does:

```bash
TERRENO_TEST_MONGODB_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0" bun run --cwd syncdb smoke
```

A mongod with less than 500 MB of free disk refuses example-backend's index builds
(`available disk space ... is less than required minimum`). Free disk space, or lower
`indexBuildMinAvailableDiskSpaceMB` on a scratch mongod.

## Add an e2e test

- **New store, outbox, conflict, or query behavior:** add a test in `syncdb/src/` against
  `createFakeTransport`. The smoke stays one happy path; do not add edge cases to it.
- **The sync protocol changed** (socket events, `/sync/snapshot`, ack shape, or stream keys):
  add a case to `api/src/sync/integration.test.ts`, and update the checks in
  `syncdb/e2e/smoke.ts` if the two-client path changed. Keep it within 30 s.
- **A user-visible sync flow:** add a Playwright spec next to the `syncdb-*.spec.ts` files in
  `example-frontend/e2e/`, following [Write a Playwright spec](../e2e.md#write-a-playwright-spec).
  Open the screen with `openSyncTodos(page)` and call `allowSyncDbNoise(consoleGuard)` from
  `e2e/helpers/syncdbSuite.ts`.

See [the syncdb reference](../../reference/syncdb.md) for the client API,
[Local-first data](../../explanation/local-first-data.md) for the design, and
[the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the smoke helpers.
