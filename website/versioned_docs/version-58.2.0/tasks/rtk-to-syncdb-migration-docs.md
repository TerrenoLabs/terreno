# Task List: RTK Deprecation and SyncDB Migration Docs

See: [`docs/implementationPlans/rtk-to-syncdb-migration-docs.md`](../implementationPlans/rtk-to-syncdb-migration-docs.md)

**RTK deprecation flag:** **Unblocked on `release-56.0.0`.** `@terreno/syncdb` lives on the `release-56.0.0` launch branch (`syncdb/`), not `master` and not PR #869 (closed). This work is authored on and targets `release-56.0.0`. Verify with `git ls-tree origin/release-56.0.0 --name-only | rg -i syncdb`.

**Migration strategy (decision M6, reaffirmed 2026-08-09):** ship *context for an AI agent to perform the migration* (syncdb reference + verified before/after pairs + the `upgrading-terreno` skill), not a codemod. See the "Migration strategy: AI-context-first" section in the IP.

## Instructions for the implementing agent

- **Phase 1 is mandatory and gates everything else.** Do not write a single line of documentation before completing Task 1.1 and Task 1.2. The surface map in the IP was written before #869 merged and is a hypothesis, not a fact.
- Never document an API you have not seen in `syncdb/src/index.ts` (or wherever the merged package exports from). If the IP describes something that does not exist, correct the IP in the same PR and note the correction.
- Every code sample must be copied from working code (`example-frontend`, `syncdb/src/**/*.test.ts`, or a snippet you compiled) — never invented.
- Do not change `@terreno/syncdb` or `@terreno/rtk` source behavior. Adding a deprecation notice to `rtk/README.md` is allowed; changing `rtk/src/` is not.
- Run `bun run lint`, `bun run compile`, and `bun run website:build` before each commit. Run `bun run rules:check` after touching `.rulesync/`.

## Phase 1: Reconcile with merged #869

- [x] **Task 1.1**: Inventory the merged syncdb public API
  - Description: Read the merged `syncdb/src/index.ts` and every module it re-exports. Produce `docs/implementationPlans/syncdb-api-inventory.md` (a temporary working document, deleted in Task 6.6) listing every exported symbol with its signature, a one-line description, and the source file. Separately list: the client config options, every React hook, every client method, the conflict-resolution API, the sync-status API, and the codegen CLI surface. Also record whether local-first is the only mode or an opt-in (IP blocking question M7) and whether `bun run sdk` still works (M5).
  - Files: `docs/implementationPlans/syncdb-api-inventory.md` (new, temporary)
  - Depends on: PR #869 merged
  - Acceptance: every symbol in the inventory is greppable in `syncdb/src/`; M5 and M7 are answered with a file-and-line citation.

- [x] **Task 1.2**: Correct the IP surface map against reality
  - Description: Compare the inventory from Task 1.1 to the "Documentation surface map" and "Known RTK-shaped surfaces" tables in the IP and in `docs/implementationPlans/oss-launch-program.md`. Update both files where reality differs. Add rows for any surface #869 introduced that neither table anticipated (for example new socket events, new backend routes under `api/src/sync/`, `excludeArchivedPlugin`, tenant/organization permission helpers). Report the deltas in the PR body.
  - Files: `docs/implementationPlans/rtk-to-syncdb-migration-docs.md`, `docs/implementationPlans/oss-launch-program.md`
  - Depends on: Task 1.1
  - Acceptance: both surface maps match the merged code; every added row cites a file path; the PR body lists what changed from the pre-merge hypothesis.

- [x] **Task 1.3**: Capture the reference migration from #869
  - Description: `git log` the #869 merge and extract the diff for `example-frontend` — the actual RTK → syncdb migration of the todos flow. Save the before/after pairs (store setup, one read hook, one write hook, conflict UI, sync status UI) into the working inventory doc. These become the code samples for the migration guide. Note anything the reference migration did *not* cover (auth, feature flags, other screens).
  - Files: `docs/implementationPlans/syncdb-api-inventory.md`
  - Depends on: Task 1.1
  - Acceptance: at least five before/after pairs captured with file paths and commit SHA; gaps in the reference migration are listed explicitly.

## Phase 2: Reference documentation

- [x] **Task 2.1**: Write `docs/reference/syncdb.md`
  - Description: New reference page following the structure of `docs/reference/rtk.md` (read it first for tone and section ordering). Sections: installation and peer dependencies; `createSyncDbClient` config table (every option, type, default, description); provider setup; read hooks; mutation hooks; conflict API; sync-status API; the Redux bridge if it shipped; codegen; environment variables. Every option in the config table must come from the inventory. Include a runnable example per hook.
  - Files: `docs/reference/syncdb.md` (new)
  - Depends on: Task 1.1
  - Acceptance: every documented symbol exists in the inventory; every config option lists a type and default; no `TODO` or placeholder text remains.

- [x] **Task 2.2**: Remove `rtk.md` from the public reference index
  - Description: Per IP decision M4 (P7 A), remove `docs/reference/rtk.md` from the public reference tree — do **not** maintain a parallel RTK reference page at launch. Add a Docusaurus redirect from the old URL to `docs/how-to/migrate-rtk-to-syncdb.md`. Archive the pre-launch `rtk.md` content only if inbound links require it (e.g. under `docs/reference/legacy/` with a deprecation banner), but do not list it in `docs/reference/README.md`.
  - Files: `docs/reference/rtk.md` (removed or archived), `website/docusaurus.config.ts`, `docs/reference/README.md`
  - Depends on: Task 2.1
  - Acceptance: `docs/reference/README.md` has no RTK entry; the old URL redirects to the migration guide; no launch doc presents RTK as a supported reference path.

- [x] **Task 2.3**: Update the reference and docs indexes
  - Description: Update `docs/reference/README.md` and `docs/README.md`: add `@terreno/syncdb` and `@terreno/ai` to the package table (`ai` is currently missing entirely), add `@terreno/admin-spa` and `@terreno/feature-flags` if absent. Do **not** list `rtk` in the public reference index per M4 — link the migration guide from a "Migrating from RTK" note instead. Confirm every shipped package in `publish-on-tag.yml` appears exactly once in the appropriate section.
  - Files: `docs/reference/README.md`, `docs/README.md`
  - Depends on: Task 2.2
  - Acceptance: the package table contains one row per published package; `rtk` appears only under Legacy; every link resolves.

## Phase 3: Migration guide

- [x] **Task 3.1**: Draft the migration guide skeleton with verified samples
  - Description: Create `docs/how-to/migrate-rtk-to-syncdb.md` with the eleven sections from the IP. Populate sections 2–4 (install/configure, reads, writes) using the before/after pairs captured in Task 1.3. For section 4, explicitly list the RTK-era code that should be **deleted** after migrating (manual optimistic updates, `isLoading` spinners on writes, refetch-after-mutate patterns) — this is the part consumers get wrong.
  - Files: `docs/how-to/migrate-rtk-to-syncdb.md` (new)
  - Depends on: Task 1.3, Task 2.1
  - Acceptance: sections 1–4 complete; every code block traceable to a real file; section 4 has a "delete this" list.

- [x] **Task 3.2**: Document conflicts and sync status
  - Description: Complete sections 5 and 6. Explain what a conflict is in this system, exactly when one is produced (cite the server-side 409/nack path in `api/src/sync/`), the two v1 resolution strategies, and the minimum UI a consumer must build. For sync status, show how to replace request-level loading UX with sync-state UX. Use the `example-frontend` implementation as the reference; if it has no conflict UI, say so and link a follow-up issue rather than inventing one.
  - Files: `docs/how-to/migrate-rtk-to-syncdb.md`
  - Depends on: Task 3.1
  - Acceptance: the conflict trigger is cited to a source file; both strategies documented; the minimum-UI requirement is concrete (named components or hooks).

- [x] **Task 3.3**: Document the auth migration
  - Description: Complete section 7. Cover: `generateAuthSlice` → Better Auth session, token storage differences on native versus web, the socket auth handshake changes from #869 (pluggable socket auth, Better Auth bearer sessions, session revalidation, `sync:auth-expired`), required backend config (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `trustedOrigins`), and the cross-domain cookie requirements. State clearly that auth can be migrated *before* the data layer (IP question M3) and give the two-step order.
  - Files: `docs/how-to/migrate-rtk-to-syncdb.md`
  - Depends on: Task 3.2
  - Acceptance: every env var named exists in `docs/reference/environment-variables.md` after this IP; the `sync:auth-expired` event is cited to source; the two-step order is stated in the first paragraph of the section.

- [x] **Task 3.4**: Document codegen, feature flags, rollback, and the checklist
  - Description: Complete sections 8–11. Codegen: whether `bun run sdk` is unchanged (answer from Task 1.1), what the generated file looks like now, and the update to `openapi-config.ts`. Feature flags: how the OpenFeature provider is fed post-migration. Rollback: per-screen rollback via `USE_SYNCDB` and what state is left behind (IndexedDB contents, outbox entries) when rolling back. Checklist: a copy-pasteable ordered checklist covering everything in sections 1–10.
  - Files: `docs/how-to/migrate-rtk-to-syncdb.md`, `docs/how-to/README.md`
  - Depends on: Task 3.3
  - Acceptance: all eleven sections complete; the rollback section states what local data survives; the checklist has no step absent from the body; the guide is listed in `docs/how-to/README.md`.

- [x] **Task 3.5**: Validate the guide by performing the migration
  - Description: On a scratch branch, take a screen in `example-frontend` that #869 did **not** migrate and migrate it following only the guide. Record every point where the guide was insufficient. Fix the guide. Then revert the scratch branch — the migration itself is not part of this IP's deliverable, only the guide corrections are.
  - Files: `docs/how-to/migrate-rtk-to-syncdb.md`
  - Depends on: Task 3.4
  - Acceptance: the migrated screen compiles and works locally; every gap found is fixed in the guide; the scratch migration is not committed to this branch.

## Phase 4: Explainers and auth repositioning

- [x] **Task 4.1**: Write `docs/explanation/local-first-data.md`
  - Description: Conceptual explainer, no step-by-step. Cover: what local-first means here (local DB is the UI source of truth, server is the authority), the mental-model shift from request/response to apply-locally-then-reconcile, what the developer stops having to think about (loading states on writes, manual optimistic updates, refetch orchestration), what they must newly think about (conflicts, sync status, encryption at rest, key lifecycle on logout), and the tradeoffs versus server-first fetching. Link the migration guide and the syncdb reference.
  - Files: `docs/explanation/local-first-data.md` (new)
  - Depends on: Task 2.1
  - Acceptance: no shell commands or step lists; names at least three things developers stop doing and three they start doing; linked from `docs/explanation/README.md` if one exists.

- [x] **Task 4.2**: Reposition authentication documentation
  - Description: Rewrite `docs/explanation/authentication.md` so Better Auth is the primary path and JWT/Passport is described as legacy with its support status. Update `docs/how-to/configure-better-auth.md` to drop "optional"/"alternative" framing and present it as the default setup. Add a short decision section: when a consumer would still choose JWT (existing deployment, custom token requirements). Verify every claim against `api/src/betterAuth*.ts` and the #869 socket auth changes.
  - Files: `docs/explanation/authentication.md`, `docs/how-to/configure-better-auth.md`
  - Depends on: Task 3.3
  - Acceptance: Better Auth appears before JWT in both documents; the JWT section states its support status; every config option cited exists in `api/src/betterAuth.ts`.

## Phase 5: Agent surfaces

- [x] **Task 5.1**: Add syncdb agent rules and mark RTK rules legacy
  - Description: Create `.rulesync/rules/syncdb/00-syncdb.md` following the structure of `.rulesync/rules/rtk/00-rtk.md` (commands, architecture, key exports, usage patterns, conventions, testing). Add a legacy banner to the top of the RTK rule file stating that new code must use syncdb and that the RTK rules exist only for maintaining existing consumers. Run `bun run rules` and commit all mirrors.
  - Files: `.rulesync/rules/syncdb/00-syncdb.md` (new), `.rulesync/rules/rtk/00-rtk.md`, generated mirrors
  - Depends on: Task 2.1
  - Acceptance: `bun run rules:check` exits 0; the syncdb rule documents only APIs from the inventory; the RTK rule's first line marks it legacy.

- [x] **Task 5.2**: Update the SDK codegen skill
  - Description: Rewrite `.rulesync/skills/generate-sdk/SKILL.md` for the syncdb codegen path. Keep an explicitly-labeled legacy branch for consumers still on RTK during the support window. Update the trigger description, the prerequisite list, the command, the output file path, and the "never edit the generated file" warning to name the correct file. Regenerate mirrors.
  - Files: `.rulesync/skills/generate-sdk/SKILL.md`, generated mirrors
  - Depends on: Task 3.4
  - Acceptance: the skill's primary path produces a working generated file when run against `example-backend`; the legacy branch is clearly labeled; `bun run rules:check` exits 0.

- [x] **Task 5.3**: Update root agent context files
  - Description: Update `AGENTS.md`, `CLAUDE.md`, and `CLAUDE-consumer.md`: replace the `@terreno/rtk` package description and the "always use generated SDK hooks" guidance with the syncdb equivalent, update the architecture diagram, and add a short legacy note pointing at the migration guide. Do not change unrelated sections. Note that `CLAUDE.local.md` also contains a stale copy — either update or delete it (it appears to be an outdated duplicate; confirm before deleting).
  - Files: `AGENTS.md`, `CLAUDE.md`, `CLAUDE-consumer.md`, possibly `CLAUDE.local.md`
  - Depends on: Task 5.1
  - Acceptance: no root agent file instructs writing RTK Query code for new work; the architecture diagram names syncdb; `bun run rules:check` exits 0.

- [x] **Task 5.4**: Update MCP resources and bootstrap templates
  - Description: Update `mcp-server/src/docs/resources/*.md` (the `terreno://docs/rtk` resource and the patterns/overview bundles) and every file under `mcp-server/src/docs/templates/bootstrap/` that wires the Redux store, auth slice, or RTK hooks. A bootstrapped app must run on syncdb + Better Auth. Also check `mcp-server/src/prompts.ts` for RTK-specific prompt text.
  - Files: `mcp-server/src/docs/resources/*.md`, `mcp-server/src/docs/templates/bootstrap/**`, `mcp-server/src/prompts.ts`
  - Depends on: Task 5.1
  - Acceptance: `terreno_bootstrap_app` output contains no RTK Query wiring; a bootstrapped app installs, compiles, and boots; `bun run mcp:build` succeeds.

## Phase 6: Deprecation signalling

- [x] **Task 6.1**: Add the deprecation notice to `rtk/README.md`
  - Description: Add a notice block at the very top of `rtk/README.md`: deprecated as of version X, supported through version Y, superseded by `@terreno/syncdb`, link the migration guide. Do not remove existing content.
  - Files: `rtk/README.md`
  - Depends on: Task 2.2
  - Acceptance: the notice is the first content after the title; versions are concrete, not placeholders.

- [x] **Task 6.2**: Add the changelog entry
  - Description: Add a `Deprecated` entry to the root `CHANGELOG.md` under the release that includes #869, naming `@terreno/rtk`, the support window, and the migration guide link. Add the corresponding `Added` entry for `@terreno/syncdb`.
  - Files: `CHANGELOG.md`
  - Depends on: Task 6.1
  - Acceptance: both entries exist under the correct version heading; the migration guide link resolves.

- [x] **Task 6.3**: Write the upgrade note
  - Description: Create `mcp-server/src/docs/upgrades/<version>.md` for the release containing #869, following the format of the existing `0.20.0.md` and `0.21.0.md` notes. Include: what changed, whether action is required, the auth-then-data migration order, links to the migration guide, and before/after snippets for the two most common changes (a read hook and a write hook).
  - Files: `mcp-server/src/docs/upgrades/<version>.md` (new)
  - Depends on: Task 3.4
  - Acceptance: `terreno_get_upgrade_guide` with a range spanning this version returns the note; the format matches the existing notes.

- [x] **Task 6.4**: Draft the announcement post
  - Description: Add the announcement body to `docs/explanation/roadmap-process.md` under a "Drafted announcements" heading (or to a new `docs/explanation/announcements/rtk-deprecation.md` if that file does not exist yet). It should explain to outside users what changed, why local-first, what they must do and by when, and where to ask questions. Under 400 words. Do not post it — posting is a maintainer action.
  - Files: `docs/explanation/roadmap-process.md` or `docs/explanation/announcements/rtk-deprecation.md`
  - Depends on: Task 6.2
  - Acceptance: under 400 words; names the support window; links the migration guide and the Q&A discussion category.

- [x] **Task 6.5**: Update the README architecture and package list
  - Description: Update `README.md`: replace `@terreno/rtk` with `@terreno/syncdb` in the architecture diagram and the published-packages list, keeping `rtk` listed with a `(deprecated)` marker. Update the "Integration Flow" numbered list to describe the syncdb loop. Do not make positioning changes here — those belong to [`positioning-django-rails-universal`](../implementationPlans/positioning-django-rails-universal.md).
  - Files: `README.md`
  - Depends on: Task 6.1
  - Acceptance: the diagram names syncdb; `rtk` is marked deprecated; the integration flow describes local-first reads and writes; no positioning prose changed.

- [x] **Task 6.6**: Delete the working inventory document
  - Description: Confirm every fact from `docs/implementationPlans/syncdb-api-inventory.md` has landed in `docs/reference/syncdb.md` or the migration guide, then delete the working file. It is scaffolding, not a deliverable.
  - Files: `docs/implementationPlans/syncdb-api-inventory.md` (deleted)
  - Depends on: all Phase 2–5 tasks
  - Acceptance: the file no longer exists; no other document links to it.
