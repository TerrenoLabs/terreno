# Implementation Plan: RTK Deprecation and SyncDB Migration Docs

**Status:** Complete — syncdb reference, migration guide, agent surfaces, and deprecation signalling shipped on `master`
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1007
**Priority:** Critical (gates most of Wave 1)
**Effort:** Big batch
**Owner:** unassigned
**Created:** 2026-07-27
**Program:** [OSS launch](oss-launch-program.md)
**Depends on:** a merged `@terreno/syncdb` package. It was **not** delivered by PR #869 (closed); it lives on the **`release-56.0.0`** launch branch (`syncdb/`), so this IP is authored on and targets `release-56.0.0`, not `master`.
**RTK deprecation flag:** **Unblocked on `release-56.0.0`** — this IP *is* the RTK deprecation. The `@terreno/syncdb` public surface is now final on `release-56.0.0` (`syncdb/src/index.ts`, `syncdb/src/react/index.ts`, `syncdb/src/testing/index.ts`); docs are written against that source.

## Goal

Make **Better Auth + `@terreno/syncdb`** the documented, blessed frontend platform, and give every existing `@terreno/rtk` consumer a correct, tested migration path. This is the gating IP for the launch documentation: publishing tutorials, reference docs, or a positioning rewrite against RTK Query would guarantee an immediate rewrite.

Scope is documentation, deprecation signalling, and migration tooling — not syncdb feature work (that is PR #869's own scope).

## Non-Goals

- Implementing or changing `@terreno/syncdb` behavior.
- Migrating internal Flourish applications (tracked separately).
- Removing `@terreno/rtk` from the repo or unpublishing it.
- Rewriting the tutorials themselves — that is [`docs-tutorials-ai-first`](docs-tutorials-ai-first.md), which depends on this IP.

## Blocking questions

**Recorded 2026-07-29** (see program [P6–P7](oss-launch-program.md#blocking-questions-program-level)).

| # | Question | Decision |
|---|----------|----------|
| M1 | RTK support window (→ P6) | **Keep publishing with deprecation notice through the current major line; stop publishing `@terreno/rtk` in the next major** |
| M2 | `npm deprecate` marker | **B** — mark at end of support window |
| M3 | Auth vs data migration | **C** — Better Auth first, then syncdb |
| M4 | `docs/reference/rtk.md` (→ P7 **A**) | **Remove from the public reference index** — no legacy reference page. Existing RTK consumers use **`docs/how-to/migrate-rtk-to-syncdb.md`** only; do not maintain a parallel RTK reference path in launch docs |
| M5 | SDK codegen command | **A** — `bun run sdk` keeps working |
| M6 | Codemod | **B (reaffirmed 2026-08-09)** — no migration script/codemod. Ship the *context* an AI agent needs (the syncdb reference, verified before/after pairs, and the `upgrading-terreno` skill), not a mechanical transform. See "Migration strategy" below |
| M7 | Local-first default | **A — confirmed local-first only.** `@terreno/syncdb` has no server-first mode and no opt-in flag: the local store is the UI source of truth (`syncdb/src/index.ts:4-7`, `syncdb/README.md:3`) and `SyncDbConfig` (`syncdb/src/client.ts`) exposes no server-first option |

## Architecture

### Documentation surface map

Every document below currently describes an RTK-shaped world and must be reconciled.

| Document | Current state | Target state |
|----------|---------------|--------------|
| `docs/reference/rtk.md` | Primary frontend reference | **Removed from launch reference** (P7 A). Redirect to migration guide; archive pre-launch content if needed for inbound links |
| `docs/reference/syncdb.md` | does not exist | New primary frontend data reference |
| `docs/how-to/migrate-rtk-to-syncdb.md` | does not exist | New step-by-step migration guide |
| `docs/explanation/local-first-data.md` | does not exist | New conceptual explainer: why local-first, what changes for the developer |
| `docs/explanation/authentication.md` | JWT-primary | Better Auth primary, JWT documented as legacy |
| `docs/how-to/configure-better-auth.md` | Exists, positioned as optional | Repositioned as the default auth path |
| `docs/README.md` | Package table omits `ai`, `syncdb` | Complete package table with syncdb as the frontend data package |
| `.rulesync/skills/generate-sdk/SKILL.md` | RTK Query codegen | syncdb descriptor codegen; RTK path kept as a legacy branch during the support window |
| `.rulesync/rules/rtk/*` | RTK conventions for agents | New `syncdb` rules; RTK rules marked legacy |
| `AGENTS.md`, `CLAUDE.md`, `CLAUDE-consumer.md` | "Always use generated SDK hooks" (RTK) | syncdb hooks; RTK guidance moved to a legacy note |
| `README.md` architecture diagram | `@terreno/rtk` box | `@terreno/syncdb` box |
| `mcp-server` resources + bootstrap templates | RTK store wiring | syncdb client wiring |

### Surface map reconciliation (Task 1.2, checked against `release-56.0.0`)

The pre-merge surface map above was a hypothesis. Reconciled against the merged
`syncdb/` on `release-56.0.0`:

- **Three entry points, not one:** `@terreno/syncdb` (client, protocol/status/conflict
  types, `betterAuthAdapter`, key providers/codecs, persister factories, transports,
  `wipeLocalData`, `generateMutationId`, `listConflicts`, `OUTBOX_TABLE`),
  `@terreno/syncdb/react` (`SyncDbProvider`, `useSyncDbClient`, `useEntity`, `useQuery`,
  `useEntityIds`, `useMutate`, `useSyncStatus`, `useConflicts`, `useSyncDebugLog`), and
  `@terreno/syncdb/testing` (`createFakeTransport`).
- **Backend surface #869's hypothesis under-specified:** `SyncApp` (`GET /sync/snapshot`,
  `POST /sync/mutate`, `POST /sync/mutate/batch`, `GET /sync/key`, `POST /sync/entities`),
  `RealtimeApp` (Socket.io `sync:subscribe`/`sync:mutate`/`sync:delta`/`sync:ack`/`sync:nack`/
  `sync:mutateBatch`), the required `syncPlugin` + `isDeletedPlugin`, the `sync` modelRouter
  config (owner/tenant/broadcast/custom scoping + `getUserScopes`/`snapshotFilter`), and
  `ensureSyncIndexes()` plus the `SyncCounter`/`SyncMutation`/`SyncScopeMove`/`SyncKey`
  bookkeeping models. All are documented in `docs/reference/syncdb.md`.
- **Encryption at rest (web) is a real public surface:** AES-GCM codec, `createServerKeyProvider`
  (default) / `createLocalKeyProvider`, `onDecryptFailure`. Documented.
- **M5 confirmed:** `bun run sdk` still generates `store/openApiSdk.ts` for non-synced routes
  (auth, profile, admin, AI, feature flags); synced collections use syncdb hooks instead.
- **M7 confirmed:** local-first only (see the blocking-questions table).

### Migration strategy: AI-context-first (not codemods)

The migration is delivered as **context for an AI coding agent (and humans) to perform
the migration in a specific app**, not as a script that mechanically transforms code.
The RTK → syncdb move is not find-and-replace: writes change semantics (local-first;
optimistic code gets *deleted*), conflicts and sync status are net-new concepts with
app-specific UI, and auth migrates on its own schedule. Those are per-screen judgment
calls, not blind transforms.

This IP therefore ships three context artifacts and no migration script:

1. **The syncdb reference** (`docs/reference/syncdb.md`) — the ground-truth API the agent
   maps RTK calls onto.
2. **The migration guide** (`docs/how-to/migrate-rtk-to-syncdb.md`) — organized by *what the
   developer changes*, with **verified before/after pairs** from the real `example-frontend`
   migration (RTK todos on `master` → `SyncTodosScreen` on `release-56.0.0`). An agent
   generalizes far better from a correct concrete example than from prose.
3. **The `upgrading-terreno` skill** (owned by [`upgrade-guides-and-skill`](upgrade-guides-and-skill.md))
   — drives an agent to migrate one screen at a time behind a flag, verify, and repeat.

Design rules that follow: every code sample is real and compiles against the merged
syncdb; the guide names what to **delete** (manual optimistic updates, write spinners,
refetch-after-mutate), not just what to add; prefer decision tables and per-step
checklists over narrative; keep the rollout unit small (per screen). A mechanical helper
may be added later for a narrow safe sub-step, but it is never the primary path.

### The migration guide's shape

The migration guide is the highest-value artifact. It must be organized by *what the developer has to change*, not by package internals:

1. **Before you start** — decision table: adopt Better Auth first (M3), confirm backend version, confirm Mongo is a replica set.
2. **Install and configure** — add `@terreno/syncdb`, create the client, wrap the app, remove the Redux store or keep it side-by-side.
3. **Reads** — `useGetTodosQuery` → syncdb query hook. Show the same screen before and after, side by side.
4. **Writes** — `usePostTodosMutation` → syncdb mutation. This is where behavior genuinely changes: writes land locally first, so loading states, error handling, and optimistic-update code all get simpler or get deleted. Show what to delete.
5. **Conflicts** — new concept with no RTK equivalent. What a conflict is, when it happens, the two v1 strategies, and the minimum UI a consumer must add.
6. **Sync status** — replacing spinner-driven UX with sync-state UX.
7. **Auth** — JWT auth slice → Better Auth session, including token storage differences and the socket auth handshake.
8. **Codegen** — regenerating typed operations, and what changes in the generated file.
9. **Feature flags** — the OpenFeature provider's new data source.
10. **Rollback** — how to go back if it goes wrong, per-screen via the `USE_SYNCDB` flag.
11. **Checklist** — a copy-pasteable checklist for a real migration.

Each step needs a working before/after code pair taken from the actual `example-frontend` migration in #869, not invented.

### Deprecation signalling

| Channel | Action |
|---------|--------|
| `docs/reference/legacy/rtk.md` | Legacy banner with the support window and end date/version |
| `rtk/README.md` | Deprecation notice at the top linking the migration guide |
| Root `CHANGELOG.md` | `Deprecated` entry in the release that lands #869 |
| GitHub Discussions | Announcement post (see [`public-roadmap-github`](public-roadmap-github.md)) |
| `mcp-server/src/docs/upgrades/<version>.md` | Upgrade note so `terreno_get_upgrade_guide` returns it |
| `ROADMAP.md` | An item with `Impact = Breaking` and the removal target |
| Agent rules | `.rulesync/rules/rtk/` marked legacy so agents stop generating RTK code |

Agent rules matter most in practice: if the MCP server and bootstrap templates keep emitting RTK code, every AI-generated Terreno app starts on the deprecated path.

## Models

None.

## APIs

None new. This IP documents the surface #869 introduces; it must not add to it.

## Notifications

One Announcements discussion post at the start of the deprecation window. No in-app notifications.

## UI

None directly. The migration guide specifies the minimum conflict-resolution and sync-status UI a consumer must build; if `example-frontend` lacks a good reference implementation after #869, file a follow-up rather than inventing one here.

## Phases

1. **Reconcile with merged #869** — read the merged code, produce a verified inventory of the actual public API, and correct the surface map above. Nothing else starts until this is done.
2. **Reference docs** — `docs/reference/syncdb.md`, move and banner `rtk.md`, update `docs/README.md`.
3. **Migration guide** — the eleven-step guide with verified before/after pairs.
4. **Explainers and auth repositioning** — `local-first-data.md`, rewrite `authentication.md`, reposition Better Auth.
5. **Agent surfaces** — rules, skills, `AGENTS.md`/`CLAUDE*.md`, MCP resources and bootstrap templates.
6. **Deprecation signalling** — READMEs, changelog, upgrade note, announcement draft, roadmap item.

## Feature Flags & Migrations

- `USE_SYNCDB` (introduced by #869) is the consumer-side rollout flag; the migration guide is organized around enabling it per screen.
- No repo-side flag needed for documentation.
- Docusaurus redirects required for every moved page (`docs/reference/rtk.md` → `docs/reference/legacy/rtk.md`).

## Not Included / Future Work

- Removing `@terreno/rtk` from the monorepo (end of support window, separate IP).
- Native (iOS/Android) local storage encryption, which #869 explicitly defers.
- Migrating Flourish's internal apps.
- A `syncdb` performance/tuning guide.

## Files to Create / Modify

**Create**

- `docs/reference/syncdb.md`
- `docs/reference/legacy/rtk.md` (moved)
- `docs/how-to/migrate-rtk-to-syncdb.md`
- `docs/explanation/local-first-data.md`
- `mcp-server/src/docs/upgrades/<syncdb-release-version>.md`
- `.rulesync/rules/syncdb/00-syncdb.md`

**Modify**

- `docs/reference/README.md`, `docs/README.md`, `docs/how-to/README.md`
- `docs/explanation/authentication.md`, `docs/how-to/configure-better-auth.md`
- `README.md` (architecture diagram and package list)
- `rtk/README.md`, `syncdb/README.md`
- `.rulesync/rules/rtk/00-rtk.md` (legacy banner), `.rulesync/skills/generate-sdk/SKILL.md`
- `AGENTS.md`, `CLAUDE.md`, `CLAUDE-consumer.md`
- `mcp-server/src/docs/resources/*.md`, `mcp-server/src/docs/templates/bootstrap/**`
- `CHANGELOG.md`
- `website/docusaurus.config.ts` (redirects)

## Task List

See [`docs/tasks/rtk-to-syncdb-migration-docs.md`](../tasks/rtk-to-syncdb-migration-docs.md).

## Acceptance Criteria

- [x] A verified inventory of `@terreno/syncdb`'s public exports exists and every documented API appears in the merged package's `src/index.ts`.
- [x] `docs/reference/syncdb.md` documents every exported hook, client method, and config option, with a runnable example for each.
- [x] `docs/how-to/migrate-rtk-to-syncdb.md` covers all eleven steps, and every before/after pair compiles against the merged code.
- [x] Following the guide, a fresh clone of `example-frontend` can be moved from the RTK path to the syncdb path with no undocumented steps.
- [x] `docs/reference/rtk.md` no longer exists at its old path; the Legacy page states the support window; a Docusaurus redirect resolves the old URL.
- [x] `docs/explanation/authentication.md` presents Better Auth first and JWT as legacy.
- [x] No agent-facing surface (`AGENTS.md`, `CLAUDE*.md`, `.rulesync/rules/`, MCP resources, bootstrap templates) instructs an agent to write RTK Query code for a new app.
- [x] `terreno_bootstrap_app` output uses syncdb, and a bootstrapped app runs.
- [x] `terreno_get_upgrade_guide` returns the syncdb upgrade note for the release range that includes #869.
- [x] `CHANGELOG.md` has a `Deprecated` entry naming `@terreno/rtk`, the support window, and the migration guide link.
- [x] `bun run lint`, `bun run compile`, `bun run rules:check`, and `bun run website:build` all pass.
