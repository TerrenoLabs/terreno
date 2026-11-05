# Fix create-terreno-app: generated backend builds a second Better Auth instance

Generated backends build their own Better Auth instance for `RealtimeApp` next to the
registered `BetterAuthApp`. Since #1592, `RealtimeApp` finds the registered instance
itself, so the extra one only drifts from the docs and drops `BetterAuthConfig`
`options` and `plugins` on sockets.

Selected: https://github.com/TerrenoLabs/terreno/issues/1594, resolved 2026-10-19
(no time window), GitHub TerrenoLabs/terreno.

## Issues

| Issue | Title | Disposition | Root cause | Task |
| --- | --- | --- | --- | --- |
| #1594 | create-terreno-app: use the registered BetterAuthApp for RealtimeApp | fix | `create-terreno-app/src/generate.ts:540` builds `betterAuthInstance` and passes it to `RealtimeApp` | T1 |

## Tasks

- [x] **T1** — Use the registered BetterAuthApp for the generated RealtimeApp (#1594)
  - Depends on: none
  - Files: create-terreno-app/src/generate.ts, create-terreno-app/src/__tests__/generate.test.ts, changelog/unreleased/cta-realtime-better-auth.md
  - Root cause: the `server.ts` template calls `createBetterAuth` and passes the result as `RealtimeApp({betterAuth})`.
  - Fix: drop `createBetterAuth`, `getMongoClientFromMongoose`, `betterAuthInstance`, and the `betterAuth:` option from the `server.ts` template. Keep the seed script's instance.
  - Proof: `create-terreno-app/src/__tests__/generate.test.ts` "generated backend server lets RealtimeApp use the registered BetterAuthApp" fails on the base (the template contains `createBetterAuth(`) and passes on the branch.
  - Closes: #1594

## Assumptions

- Needs #1592 (merged 2026-10-19): before it, `RealtimeApp` could not find `BetterAuthApp`, so removing the wiring would have broken sockets.

## Open questions (recommendation assumed)

None.

## Not fixed in this run

None.

## Sign-off

Status: approved 2026-10-19 (tap: #1594)
