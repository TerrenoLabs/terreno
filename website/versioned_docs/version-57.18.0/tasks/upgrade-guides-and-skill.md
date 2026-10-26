# Task List: Upgrade Guides and the `upgrading-terreno` Skill

See: [`docs/implementationPlans/upgrade-guides-and-skill.md`](../implementationPlans/upgrade-guides-and-skill.md)

**RTK deprecation flag:** **Blocked.** The RTK → syncdb upgrade is the primary use case for this skill. Do not start until PR #869 merges and [`rtk-to-syncdb-migration-docs`](rtk-to-syncdb-migration-docs.md) Phase 3 has produced the migration guide the skill will delegate to. Tasks marked `[RTK]` specifically handle that migration.

## Instructions for the implementing agent

- Derive upgrade-note content from evidence: `gh release view <tag>`, `git log <prev>..<tag>`, and diffs of public API surfaces (`*/src/index.ts`). Do not write "possibly breaking" — determine whether it breaks by reading the diff.
- Read `.rulesync/skills/upgrading-expo/SKILL.md` before writing the new skill. Do not duplicate its content; invoke it.
- The skill must never leave a consumer's repo in a half-upgraded state without saying so. Every failure path must report what succeeded, what failed, and how to roll back.
- Run `bun run mcp:build` after changing anything under `mcp-server/`. Run `bun run rules:check` after touching `.rulesync/`.

## Phase 1: Note format and backfill

- [x] **Task 1.1**: Define the upgrade note format
  - Description: Create `mcp-server/src/docs/upgrades/README.md` documenting the required note format from the IP: frontmatter-style header (`Action required`, `Affected packages`) then `Summary`, `Breaking changes` (each with What changed / Why / Migration with before-and-after code), `Deprecations`, `New capabilities`, `Verification`. Explain that notes are concatenated by `terreno_get_upgrade_guide` across a version range, so each must be self-contained and must not assume the reader read an adjacent note. Include a copy-paste template. Read the existing `0.20.0.md` and `0.21.0.md` first and keep the format compatible with them.
  - Files: `mcp-server/src/docs/upgrades/README.md` (new)
  - Depends on: none
  - Acceptance: the format is compatible with the two existing notes; the template includes every required section; the self-contained requirement is stated with its reason.

- [x] **Task 1.2**: Research what changed between 0.21.0 and the current version
  - Description: For each release from 0.22.0 through the current version, run `gh release view <tag>` and `git log --oneline <prev>..<tag>`, and diff the public surface of each published package (`git diff <prev>..<tag> -- '*/src/index.ts'`). Identify actual breaking changes, deprecations, and notable additions. Record findings per version in the PR body. Pay particular attention to the OpenFeature feature-flag migration, which the README documents as requiring consumer action — that is a breaking change with no upgrade note.
  - Files: none (findings in the PR body)
  - Depends on: Task 1.1
  - Acceptance: every version from 0.22.0 to current is covered; each finding cites a commit or diff; the feature-flag migration is captured.

- [x] **Task 1.3**: Write the consolidated backfill note
  - Description: Per IP question U1, write a single consolidated note covering 0.21.0 → current (name it for the current version). Include everything from Task 1.2 that requires consumer action, organized by concern rather than by version. Open with an honest note that per-release notes were not maintained for this range and that this note consolidates them. Move the OpenFeature feature-flag migration content out of `README.md` into this note (or into `docs/how-to/add-feature-flags.md`) and link it, rather than leaving a migration guide in the README.
  - Files: `mcp-server/src/docs/upgrades/<current-version>.md` (new), `README.md`, `docs/how-to/add-feature-flags.md`
  - Depends on: Task 1.2
  - Acceptance: every action-requiring change from Task 1.2 appears; the feature-flag migration is no longer in `README.md`; `terreno_get_upgrade_guide` with the range 0.21.0 → current returns this note's content.

- [x] **Task 1.4**: Improve the empty-range response
  - Description: Update `terreno_get_upgrade_guide` in `mcp-server/src/tools.ts` so that a range with no recorded notes returns an explicit message naming the versions with no notes, rather than empty output — an agent seeing empty output concludes nothing changed, which is the opposite of the truth. Also have it list which versions in the range *did* have notes. Add tests for: range fully covered, range partially covered, range with no notes, and an invalid range.
  - Files: `mcp-server/src/tools.ts`, tests under `mcp-server/src/`
  - Depends on: Task 1.3
  - Acceptance: all four test cases pass; the no-notes response names the specific versions; `bun run mcp:build` succeeds.

## Phase 2: Versioning policy

- [x] **Task 2.1**: Write `docs/explanation/versioning-policy.md`
  - Description: Document: what lockstep versioning means (all `@terreno/*` packages share a version; you upgrade them together and mixing versions is unsupported — verify this claim against `publish-on-tag.yml` and any peer-dependency constraints before asserting it); the pre-1.0 policy (breaking changes may land in minor releases, always with an upgrade note); the deprecation window from IP question U6 (minimum three minor releases, with the RTK deprecation as the worked example); where to find upgrade notes and the changelog; and what 1.0 will mean when it happens (link program question P9). Keep it short and concrete — this document is a promise, so every sentence must be one the team will keep.
  - Files: `docs/explanation/versioning-policy.md` (new), `docs/explanation/README.md`
  - Depends on: Task 1.3
  - Acceptance: the lockstep claim is verified against the publish workflow and peer deps; the deprecation window is a specific number; the RTK deprecation is used as the example; linked from the explanation index.

- [x] **Task 2.2**: `[RTK]` Write `docs/how-to/upgrade-terreno.md`
  - Description: The human-facing upgrade guide. Cover: checking your current versions; finding the notes for your range (both via `terreno_get_upgrade_guide` and by browsing the notes directory); the correct ordering with the reasoning for each step (backend before frontend because the OpenAPI spec is the contract; Expo before Terreno frontend packages because `@terreno/ui` pins peers against Expo versions — verify both claims); the manual steps for each phase; verification; and rollback. Add a prominent section for the RTK → syncdb upgrade linking `docs/how-to/migrate-rtk-to-syncdb.md` as a larger, separate operation that should not be combined with a routine version bump.
  - Files: `docs/how-to/upgrade-terreno.md` (new), `docs/how-to/README.md`
  - Depends on: Task 2.1
  - Acceptance: both ordering claims verified against source or `package.json` peer deps and cited; the RTK migration is explicitly separated from routine upgrades; rollback steps present.

## Phase 3: The skill

- [x] **Task 3.1**: Author the `upgrading-terreno` skill
  - Description: Create `.rulesync/skills/upgrading-terreno/SKILL.md`. Frontmatter: `name: upgrading-terreno`, a `description` naming trigger phrases ("upgrade Terreno", "bump @terreno packages", "update to the latest Terreno", "upgrade terreno version"), `targets: ['*']`. Body: Preconditions (clean git tree — refuse to start otherwise; on a branch, not the default branch; tests currently passing so failures are attributable); Determine versions (`application_info` from the local MCP server, or read `package.json` files); Fetch notes (`terreno_get_upgrade_guide`); **Plan and confirm** — print current version, target version, the notes found, the packages affected, and the ordered steps, then stop for confirmation; then the ten-step ordering from the IP with a verification gate between each phase; Expo delegation (invoke the `upgrading-expo` skill at step 6 rather than duplicating it); Failure handling (report what succeeded, what failed, and the rollback command; on a multi-version jump failure, retry version by version to isolate); and a final report. Include an explicit prohibition on continuing past a failed compile or test run.
  - Files: `.rulesync/skills/upgrading-terreno/SKILL.md` (new)
  - Depends on: Task 2.2
  - Acceptance: the clean-tree precondition is a hard refusal, not a warning; the confirmation gate precedes the first mutation; step 6 invokes `upgrading-expo` by name; the failure path names a rollback command; the ordering matches the how-to guide exactly.

- [x] **Task 3.2**: Add the ordering reference
  - Description: Create `.rulesync/skills/upgrading-terreno/references/ordering.md` containing the dependency reasoning in detail: why backend precedes frontend, why the typed client is regenerated only after the backend is upgraded and running, why Expo precedes `@terreno/ui`, which packages are backend versus frontend (enumerate them from `publish-on-tag.yml`), and what breaks if the order is violated — with the specific symptom for each violation (for example: regenerating the client against an old backend produces a client missing the new routes, which fails at compile time in the consumer's screens).
  - Files: `.rulesync/skills/upgrading-terreno/references/ordering.md` (new)
  - Depends on: Task 3.1
  - Acceptance: every package is classified backend or frontend and the list matches `publish-on-tag.yml`; each ordering rule has a concrete violation symptom.

- [x] **Task 3.3**: `[RTK]` Add the syncdb migration branch
  - Description: Add a section to the skill for the case where the upgrade range crosses the syncdb release. The skill must detect this (the range includes the syncdb version), stop, and tell the user that this is a platform migration rather than a version bump, pointing at `docs/how-to/migrate-rtk-to-syncdb.md` and offering to perform the routine version bump first and the migration as a separate operation. Do not attempt to automate the full migration inside a version-bump flow.
  - Files: `.rulesync/skills/upgrading-terreno/SKILL.md`
  - Depends on: Task 3.1, `rtk-to-syncdb-migration-docs` Phase 3
  - Acceptance: the skill detects a range crossing the syncdb version and stops with the two-option choice; it does not attempt the data-layer migration automatically.

- [x] **Task 3.4**: Wire the MCP prompt to the skill
  - Description: Update the `terreno_upgrade` prompt in `mcp-server/src/prompts.ts` so it points at the `upgrading-terreno` skill as the executor, keeping the prompt as the discovery surface for agents without skill support. Ensure the prompt's ordering matches the skill's exactly so the two cannot drift into disagreement — ideally the prompt references the ordering rather than restating it.
  - Files: `mcp-server/src/prompts.ts`
  - Depends on: Task 3.1
  - Acceptance: the prompt names the skill; the two do not state conflicting orderings; `bun run mcp:build` succeeds.

- [x] **Task 3.5**: Generate skill mirrors
  - Description: Run `bun run rules` and commit all generated files.
  - Files: generated skill mirrors
  - Depends on: Task 3.1, Task 3.2, Task 3.3
  - Acceptance: `bun run rules:check` exits 0; `upgrading-terreno` appears under every configured target directory.

## Phase 4: Enforcement

- [x] **Task 4.1**: Require upgrade notes in the release skill
  - Description: Add a required step to `.rulesync/skills/release/SKILL.md`: after assembling the changelog section for the release, if it contains a `Breaking`, `Deprecated`, `Removed`, or `Changed` entry, write `mcp-server/src/docs/upgrades/<version>.md` using the template from Task 1.1 before tagging. Reference the note from the changelog section. Regenerate mirrors.
  - Files: `.rulesync/skills/release/SKILL.md`, generated mirrors
  - Depends on: Task 1.1
  - Acceptance: the step lists the four triggering changelog headings; `bun run rules:check` exits 0.

- [x] **Task 4.2**: Add the CI enforcement check
  - Description: Add a check (script plus a job in `.github/workflows/repo-policies.yml`, or a step in `publish-on-tag.yml` that runs before publishing) that reads the changelog section for the tag being released and fails if it contains a breaking/deprecated/removed/changed entry while `mcp-server/src/docs/upgrades/<version>.md` does not exist. Write it as a Bun TypeScript script with `const` arrow functions and explicit return types, following the repo's script conventions. Include tests for: note present and required, note missing and required, note not required.
  - Files: `scripts/check-upgrade-notes.ts` (new), `package.json`, `.github/workflows/repo-policies.yml` or `.github/workflows/publish-on-tag.yml`, tests
  - Depends on: Task 4.1
  - Acceptance: all three test cases pass; the check fails a simulated release with a breaking changelog entry and no note; `bun run lint` passes.

- [x] **Task 4.3**: Link notes from the changelog
  - Description: Update `CHANGELOG.md` so each version section with an upgrade note links it. Add a line to the changelog header explaining that upgrade notes live in `mcp-server/src/docs/upgrades/` and are also available through the MCP server's `terreno_get_upgrade_guide` tool.
  - Files: `CHANGELOG.md`
  - Depends on: Task 1.3
  - Acceptance: every version with a note links it; the header explains where notes live and how to fetch them.

## Phase 5: Validation

- [x] **Task 5.1**: Perform a real multi-version upgrade with the skill
  - Description: Create a consumer app pinned to an older Terreno version (at least two minors behind current — scaffold with `terreno_bootstrap_app` from that version, or check out `example-frontend`/`example-backend` at the older tag into a scratch directory). Run the `upgrading-terreno` skill to bring it to current. Verify: the clean-tree precondition fires when the tree is dirty, the confirmation gate fires, each phase's verification runs, and the app compiles and runs afterward. Record every gap and fix the skill, the notes, or the how-to as appropriate. Capture the transcript and the running upgraded app to `/opt/cursor/artifacts/`.
  - Files: `.rulesync/skills/upgrading-terreno/SKILL.md`, `mcp-server/src/docs/upgrades/*`, `docs/how-to/upgrade-terreno.md`, generated mirrors
  - Depends on: Task 3.5, Task 1.3
  - Acceptance: the upgrade succeeds and the app runs; both gates observed firing; every gap fixed; artifacts captured; `bun run rules:check` exits 0.

- [x] **Task 5.2**: Verify the failure-isolation path
  - Description: Deliberately create a failing upgrade (for example by pinning a consumer file to an API removed in the range) and confirm the skill stops at the failing phase, names it, reports what succeeded, offers rollback, and — for a multi-version range — retries version by version to isolate the breaking version. Fix the skill if any of those behaviors is missing.
  - Files: `.rulesync/skills/upgrading-terreno/SKILL.md`, generated mirrors
  - Depends on: Task 5.1
  - Acceptance: all four failure behaviors observed in the transcript; the isolation retry correctly identifies the breaking version; `bun run rules:check` exits 0.
