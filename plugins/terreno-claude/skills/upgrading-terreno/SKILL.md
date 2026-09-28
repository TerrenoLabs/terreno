---
name: upgrading-terreno
description: >-
  Upgrade Terreno lockstep @terreno/* packages. Trigger with "upgrade Terreno",
  "bump @terreno packages", "update to the latest Terreno", or "upgrade terreno version".
targets: ['*']
---

# Upgrade Terreno

Perform a lockstep `@terreno/*` upgrade. Human-facing twin: `docs/how-to/upgrade-terreno.md`. Ordering detail: [references/ordering.md](references/ordering.md).

Do **not** duplicate Expo SDK steps. At step 6 invoke the `upgrading-expo` skill by name.

## Preconditions (refuse, do not warn)

Stop immediately and do not mutate the tree if any of these fail:

1. `git status --short` is **not empty** — refuse. Ask the user to commit or stash. A dirty tree has no safe rollback.
2. The current branch is the default branch (`master` or `main`) — refuse. Create or switch to a feature branch first.
3. Tests on this HEAD have not been shown passing — refuse. Run the app’s usual test command once so later failures are attributable to the upgrade.

## Determine versions

1. Prefer MCP `application_info` from `terreno-mcp-local`.
2. Else read every `package.json` that lists `@terreno/*`.
3. `fromVersion` = lowest installed `@terreno/*` semver. `toVersion` = user target or latest GitHub release.

## Fetch notes

Call hosted MCP `terreno_get_upgrade_guide` with `fromVersion` and `toVersion`. Read every concatenated note. A “no bundled notes” line means **unknown**, not no-op.

## Syncdb / RTK platform migration

If `fromVersion` is before `56.0.0-beta.2` and `toVersion` is `56.0.0-beta.2` or later, **stop**. This range crosses `@terreno/syncdb` and the RTK collection-CRUD deprecation. It is a platform migration, not a routine bump.

Offer exactly two options; do not automate the data-layer migration inside this flow:

1. Routine lockstep bump only (stay on RTK collection hooks for now).
2. Separate follow-up: `docs/how-to/migrate-rtk-to-syncdb.md`.

Wait for the user to pick.

## Plan and confirm (no mutations yet)

Print, then **stop until the user confirms**:

- `fromVersion` and `toVersion`
- Notes returned (or the gap warning)
- Packages affected
- Ordered steps 1–10 below

Do not install, edit lockfiles, or regenerate the client before confirmation.

If the caller is an unattended agent whose **invoking task already names** `fromVersion`, `toVersion`, and authorizes the bump (for example Pick Task 5.1), print the same plan into the transcript and treat that task as confirmation. Do not skip the printed plan. Do not skip the stop when a human is in the loop.

## Ordered steps (verification gate after each phase)

Match `docs/how-to/upgrade-terreno.md`. After each phase, run its gate. **If compile or tests fail, stop. Do not continue.**

Compile means a **typecheck** (`tsc --noEmit` or `bun run compile` when that script typechecks). `bun build` / bundlers that ignore TypeScript errors are not a passing gate.

1. Clean git tree + branch (already enforced).
2. Record current `@terreno/*` versions (`application_info` / `package.json`).
3. `terreno_get_upgrade_guide` for the range (already fetched). Apply note migrations that are code edits **after** confirmation, in this same order.
4. Bump **backend** packages: `@terreno/api`, `@terreno/test`, `@terreno/admin-backend`, `@terreno/blocks` (when the app lists it; `ai` and `ui` depend on it), `@terreno/ai`, `@terreno/api-health`, `@terreno/comms`, `@terreno/feature-flags`, `@terreno/mcp`. `bun install`.
5. Backend `bun run compile` and backend tests. Gate: both pass.
6. Expo SDK — invoke **`upgrading-expo`**. Skip only when Terreno majors do not require a new Expo (same Expo line). Gate: `npx expo-doctor` / install --fix as that skill requires; native rebuild if peers moved.
7. Bump **frontend** packages: `@terreno/ui`, `@terreno/rtk`, `@terreno/syncdb`, `@terreno/admin-frontend`, `@terreno/admin-spa`. `bun install`.
8. Start the **upgraded** backend. Regenerate the typed client (`bun run sdk` in the frontend).
9. `bun run compile`, `bun run lint`, and the app tests. Gate: all pass.
10. Run the app, log in, exercise changed screens.

## Failure handling

Report all three:

1. What succeeded (last passing step number).
2. What failed (command and first error line).
3. Rollback: `git reset --hard` on this branch, or `git checkout <pre-upgrade-sha> -- package.json bun.lock && bun install`.

On a **multi-version** jump failure: retry **version by version** (`from` → next recorded note version → …) to isolate the breaking version. Keep the failing consumer file. The first version whose typecheck fails is the isolate. Do not continue past a failed compile or test run.

## Final report

Print `fromVersion` → `toVersion`, notes applied, packages bumped, gates that passed, and remaining human follow-ups (native store binaries, RTK migration if deferred).
