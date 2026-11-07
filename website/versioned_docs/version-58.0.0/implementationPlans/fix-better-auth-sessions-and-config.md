# Fix Better Auth: disabled users, socket sessions, and config passthrough

Three Better Auth gaps that apps migrating from JWT hit right away. Disabling an account
does not lock out its live Better Auth sessions on REST or sockets. Sockets only accept
Better Auth sessions when each app wires the instance in by hand, and they refuse a user
who has not made an HTTP request yet. `BetterAuthConfig` cannot pass any Better Auth
option or plugin Terreno does not set itself.

Selected: "the better-auth issues from the last day", resolved 2026-10-18T10:52:18Z
(window 2026-10-17T10:52:18Z to 2026-10-18T10:52:18Z), GitHub TerrenoLabs/terreno.

## Issues

| Issue | Title | Disposition | Root cause | Task |
| --- | --- | --- | --- | --- |
| #1577 | Better Auth session middleware does not reject disabled users | fix | `api/src/betterAuthSetup.ts:410` sets `req.user` without checking `disabled` | T1 |
| #1576 | Better Auth: wire RealtimeApp automatically and lazily sync users at socket handshake | fix | `api/src/realtime/socketAuth.ts:161` refuses unsynced users and skips `disabled`; `api/src/realtime/realtimeApp.ts:398` reads only `config.betterAuth` | T2, T3 |
| #1578 | BetterAuthConfig: pass through Better Auth options and plugins | fix | `api/src/betterAuthSetup.ts:189` builds options only from fixed fields; `plugins: [bearer()]` is hard-coded | T4 |

## Tasks

- [x] **T1** — Reject disabled users' Better Auth sessions on REST (#1577)
  - Depends on: none
  - Files: api/src/betterAuthSetup.ts, api/src/betterAuthSetup.test.ts, docs/explanation/authentication.md, docs/how-to/configure-better-auth.md
  - Root cause: `createBetterAuthSessionMiddleware` assigns the app user without the `disabled` check JWT (`auth.ts:565`) and MCP (`mcp/auth.ts:21`) make.
  - Fix: add an exported `resolveBetterAuthAppUser({userModel, betterAuthUser})` that finds the user by `betterAuthId`, falls back to `syncBetterAuthUser`, and reports disabled users. The middleware leaves `req.user` unset for a disabled user, as MCP's `rejectIfDisabled` does, so protected routes answer 401 and Better Auth's own routes (sign-out) stay reachable.
  - Proof: `api/src/betterAuthSetup.test.ts` tests for a disabled user and a user disabled while the session is live fail on the base (`req.user` is set) and pass on the branch.
  - Closes: #1577
- [x] **T2** — Sync and check disabled users at the Better Auth socket handshake (#1576)
  - Depends on: T1
  - Files: api/src/realtime/socketAuth.ts, api/src/realtime/socketAuth.test.ts
  - Root cause: the Better Auth socket check looks up the app user by `betterAuthId` and throws when none exists; it never checks `disabled`.
  - Fix: use `resolveBetterAuthAppUser` from T1, so a fresh user is created at handshake and a disabled one is refused.
  - Proof: `api/src/realtime/socketAuth.test.ts` tests "creates the app user" and "rejects a disabled user" fail on the base and pass on the branch.
  - Closes: #1576 (with T3)
- [x] **T3** — Find the Better Auth instance for RealtimeApp from the registered plugins (#1576)
  - Depends on: T2
  - Files: api/src/realtime/realtimeApp.ts, api/src/realtime/types.ts, api/src/realtime/realtimeAppSetup.test.ts, example-backend/src/server.ts, docs/how-to/configure-better-auth.md, docs/how-to/migrate-rtk-to-syncdb.md, docs/reference/syncdb.md, docs/explanation/authentication.md
  - Root cause: `RealtimeApp` reads only `config.betterAuth` at startup, in the handshake middleware, and in the revalidation sweep, and ignores the `terrenoApp` passed to `register`.
  - Fix: store `terrenoApp` in `register`; in `onServerCreated`, resolve `config.betterAuth ?? {auth: ensureAuth(), userModel}` from the registered Better Auth plugin and use it in all three places. Explicit `config.betterAuth` still wins.
  - Proof: `api/src/realtime/realtimeAppSetup.test.ts` tests with `BetterAuthApp` registered and no `betterAuth` option — handshake with a Better Auth bearer authenticates, and the sweep reports `disabled` rather than `invalid-session` — fail on the base and pass on the branch.
  - Closes: #1576 (with T2)
- [x] **T4** — Pass Better Auth options and plugins through BetterAuthConfig (#1578)
  - Depends on: T3
  - Files: api/src/betterAuth.ts, api/src/betterAuthSetup.ts, api/src/betterAuthSetup.test.ts, api/src/betterAuthApp.test.ts, docs/how-to/configure-better-auth.md
  - Root cause: `createBetterAuth` builds a fixed options literal and hard-codes `plugins: [bearer()]`.
  - Fix: add `options?: Omit<Partial<BetterAuthOptions>, "plugins" | "basePath">` and `plugins?: BetterAuthPlugin[]`; deep-merge `options` over Terreno's defaults with arrays replaced, and append `plugins` after `bearer()`.
  - Proof: `api/src/betterAuthSetup.test.ts` "requireEmailVerification blocks sign-in" and "plugin endpoints mount under the base path" fail on the base and pass on the branch; existing defaults tests stay green.
  - Closes: #1578
- [x] **T5** — Resolve a Better Auth user created concurrently on first contact (#1576)
  - Depends on: T4
  - Files: api/src/betterAuthSetup.ts, api/src/betterAuthSetup.test.ts
  - Root cause: found in branch review. The socket handshake (T2) and the first REST calls race to create a new user; the loser's insert hits the unique `_id` index, and the socket reports it as Unauthorized.
  - Fix: `resolveBetterAuthAppUser` looks the user up again after a duplicate-key error.
  - Proof: `api/src/betterAuthSetup.test.ts` describe "resolveBetterAuthAppUser" fails on T4's head (8 of 13 runs for the concurrent test, 5 of 5 for the stub test) and passes on the branch.
  - Closes: #1576 (with T2 and T3)

T2 depends on T1 for the helper. T3 and T4 depend on the previous task only because they edit the same docs page.

## Assumptions

- A disabled user's session falls through as anonymous instead of answering 401 directly, because `TerrenoApp` mounts the session middleware before Better Auth's routes and a direct 401 blocked sign-out (Roast T1 attempt 1).
- Auto-wiring has no opt-out: it only adds one more accepted credential, after the JWT check.
- `options` overrides win, including over the adapter and security defaults, as #1578 says; docs list what an override drops.
- Plugin endpoints added through `plugins` are not typed on `auth.api`; docs say so.

## Open questions (recommendation assumed)

None.

## Not fixed in this run

| Issue | Disposition | Next action |
| --- | --- | --- |
| #1579 | decide | New rtk public API with four design choices (token-source shape, #1217 composition, web storage, bearer default), about three PRs. Run `/brewery:distill #1579`. |
| #1574 | skipped | Open PR #1581 already covers it. |

## Sign-off

Status: approved 2026-10-18 (tap: #1576, #1577, #1578)
