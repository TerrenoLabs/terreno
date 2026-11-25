# Make the repository read like an open source project, and cheap for agents to work in

Terreno is public, but the repository still reads like one company's internal monorepo. An outside contributor's agent loads about 148 KB of instructions on its first file touch, including the maintainer's private cloud setup and a personal output style. Every agent stop runs the full repository gate, even after a question that changed nothing. Search returns each hit five to ten times because generated copies and four docs snapshots sit beside the sources, and the hosted MCP docs search indexes internal planning files. The contributor guide points at a script that does not exist and a DCO check that, by the repository's own CI config, never runs on the pull requests it targets. This plan fixes the reversible parts first (scoped rules, a cheap stop hook, no private-infrastructure references, a contributor on-ramp that works for a stranger, a DCO check that runs, honest package metadata), adds a check behind each so it stays fixed, and ends with the one destructive step: dropping two of the four committed docs snapshots.

## The idea

Nothing in a published package's runtime changes. What changes is the repository's public face and its guard rails:

- **Agent instructions.** The 11 package rules that say `globs: ["**/*"]` are scoped to their package. `CLAUDE.local.md` stops being generated and tracked. The root rule loses the "Short Attention Span" and private "Cursor Cloud" material. A new `check-agent-rules` script fails when a package rule is unscoped or the always-loaded set grows past a byte budget.
- **Stop hook.** `.rulesync/hooks/quality-check.sh` exits at once on a clean tree or a docs-only change, and otherwise lints and typechecks only the changed workspaces. The full gate stays behind `QUALITY_CHECK_FULL=1`.
- **Internal references.** A `check-internal-references` script denies a short list of private tokens (private script paths, sibling-app names, personal emails, the legacy MCP hostname) outside an allowlist with a reason per entry. The copyright holder, the GCP project id and `infra/flourish/` are not denied (see D1, D2).
- **Contributors.** `CONTRIBUTING.md` gets a setup that needs no inline env vars and a "first pull request" section. A tokenless DCO check replaces one that needs a secret CircleCI withholds from forks. A fork-safety report says, from the CI config alone, which jobs run on a fork pull request.
- **Package metadata.** Every published manifest gets an `https` repository URL with `directory`, a `files` allowlist and a `LICENSE` file, guarded by `check-package-metadata`.
- **Planning files.** `docs/plans/` and `docs/audits/` stay tracked and public: the lifecycle plugin writes plans there by design, and this plan and the audit it came from are two of them. They leave the docs site and the hosted MCP docs index, and a short policy page says what may be written in them.

Rejected: a blanket ban on the word "flourish". Flourish Health is the copyright holder (launch decision P2), `flourish-terreno` is the real GCP project id, and `infra/flourish/` is a recorded decision (P5). A blanket ban would need a 300-file allowlist and would catch nothing the short list misses.

Rejected for this plan, parked as follow-up plans (see Expansions): deleting the 34 disabled GitHub workflow twins and collapsing the 18 publish jobs (X1), building docs snapshots from tags instead of committing them (X2), and cutting the generated skill roots (X3). Each is a multi-day change with its own compatibility question, and X1 edits the file a neighbouring plan is fixing.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Tracer: scope the 11 package rules and add `check-agent-rules` | none | `.rulesync/rules/`, generated rules, `scripts/check-agent-rules/` | Unit tests; check exits 0; no generated package rule has `**/*` |
| T2 | Stop generating and tracking `CLAUDE.local.md` | T1 | `.rulesync/rules/`, `.gitignore`, `CONTRIBUTING.md` is not touched | Check fails on a `localRoot` rule; `git ls-files CLAUDE.local.md` is empty |
| T3 | Stop hook: skip clean and docs-only trees, scope to changed workspaces | none | `.rulesync/hooks/quality-check.sh`, its test | Hook tests: zero `bun` calls on a clean tree; per-workspace commands otherwise |
| T4 | Remove maintainer-only sections from the root rule | T2 | `.rulesync/rules/00-root.md`, generated roots, `docs/maintainers/` | Check fails on the two headings; generated `AGENTS.md` has neither |
| T5 | `check-internal-references`: deny list and allowlist | none | `scripts/check-internal-references/` | Unit tests on literal strings |
| T6 | Remove the internal references the check finds | T4, T5 | CI config, `ui/package.json`, example-backend, docs, skill sources | Check exits 0 on the tree |
| T7 | Contributor on-ramp in `CONTRIBUTING.md` | none | `CONTRIBUTING.md`, `scripts/docs/` | Test: every `bun run <script>` and relative link in the file resolves |
| T8 | Tokenless DCO check that runs on fork pull requests | T6 | `scripts/ci/dco/`, `.circleci/continue-config.yml` | Unit tests; config test: the job no longer halts on a missing token |
| T9 | Fork-safety report for the CircleCI config, the fork section of the CI guide, and a workflows README | T8 | `scripts/ci/forkSafety/`, `docs/how-to/circleci.md`, `.github/workflows/README.md` | Unit tests; check exits 0; doc table matches `--report` |
| T10 | Normalise published package metadata and add `check-package-metadata` | T6 | 17 manifests, `syncdb/LICENSE`, `scripts/check-package-metadata/`, `scripts/check-license-coverage/lib.ts` | Unit tests; check exits 0; `npm pack --dry-run` file lists recorded |
| T11 | Keep generated copies and frozen history out of search and PR diffs | T1 | `.ignore`, `.gitattributes`, `scripts/repoHygiene/` | Test: every generated root is ignored and marked generated; no source root is |
| T12 | Keep planning and audit files out of the docs site and MCP docs; write the planning-files policy | none | `website/docusaurus.config.ts`, `mcp-server/scripts/sync-versioned-docs.ts`, `docs/plans/README.md` | Unit test on the shared exclude list; synced `next` tree has no planning directory |
| T13 | Wire the four checks into scripts, CI and prepush; docs and changelog | T3, T6, T7, T9, T10, T11, T12 | `package.json`, CircleCI `repo-policies`, prepush plan, docs, changelog | `bun run prepush --all --dry-run` lists the four checks; prepush coverage test passes |
| T14 | **Destructive:** keep two docs snapshots (newest of the current and previous major) | T12 | `website/versioned_docs/`, `website/scripts/prune-doc-versions.ts` | Unit tests on the selection rule; `versions.json` is `["58.0.0","57.22.0"]` |

Tracer: a rule's `globs` in `.rulesync/rules/` → `bun run rules` → the `paths:` of the generated `.claude/rules/` file → a check that fails the build when it regresses.
Chains: T5→T6→T8→T9 exists because T6 and T8 edit the same CircleCI config, T6 needs T5's check, and T9 documents the job T8 writes. T10 follows T6 only because both edit `ui/package.json`. T13 is the join.
Order: T1–T13 are reversible by a revert. T2 and T6 delete or rename tracked content that a revert restores. T14 deletes 3,300 tracked files and changes what the docs site serves; it is last and stands alone so it can be dropped at sign-off.
E2E: None — no UI or cross-process behaviour changes; every criterion is a script, a config file or prose.
Regression: CI-new-1 → `docs/regression/ci.md` (a real fork pull request cannot be driven by a test).
User guide: None — no end-user-visible change in the example app.
Design: None — no canvas.
Out of scope: workflow-twin deletion and publish-job collapse, docs snapshots built from tags, generated skill roots, removing legacy planning history, `exports` maps, the docs domain (see Expansions).
Open risks: the stop hook no longer runs when an agent has committed everything (pre-commit and CI still do), and it no longer typechecks the packages that depend on a changed one (`bun run prepush` and the CircleCI typecheck job do); `.ignore` hides generated copies from every ripgrep-based tool, including ones that want them; a wrong `files` allowlist would ship a broken tarball (T10 diffs the pack list to prevent it); two neighbouring plans edit the same rule and workflow files.
Elephant: the owner's own cloud agents read the "Cursor Cloud" and "Short Attention Span" sections this plan removes from the tracked rules. Unless the owner puts that text into private agent configuration before this merges, those agents lose it the same day.

## E2E tests

None — no UI or cross-process acceptance criterion. The changes are rule files, a shell hook, CI config, manifests and prose. Each is proven by a `bun test` unit suite or a check script named in its task.

## Regression cases

Destination: CI → docs/regression/ci.md

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| CI-new-1 | DCO runs on fork pull requests only | Starting state: CircleCI "Build forked pull requests" is on. From a fork, open a pull request to `master` with one commit that has no `Signed-off-by` line. Then amend it with `git commit --amend -s` and force-push. Separately, open a same-repository pull request with an unsigned commit, and look at the latest `master` pipeline. | Fork pull request: the `dco` job is red and names the commit, then green after the amend. Same-repository pull request and the `master` pipeline: `dco` is green and its log says it was skipped. | CircleCI | manual | oss-repo-hygiene |

Everything else is automated by the unit suites in the tasks. T11's one-time check that project skills still list is a build-time verification, not a standing case.

## User guide

None — no user-visible change. `docs/user-guide/` describes the example app, which behaves the same.

## Design

None — no canvas.

## Findings re-verified against the code

| Finding | Verdict | What the code shows |
| --- | --- | --- |
| 2.6 | Confirmed | 11 files under `.rulesync/rules/<pkg>/` have `globs: ["**/*"]` (`admin-backend`, `admin-frontend`, `ai`, `api/00`, `api/01`, `demo`, `example-backend`, `example-frontend`, `mcp-server`, `syncdb`, `ui/00`). `CLAUDE.local.md` is tracked (12,200 bytes) and generated from `.rulesync/rules/01-claudecode-root.md` (`localRoot: true`). |
| 2.7 | Corrected | 360 tracked `SKILL.md`, 206 distinct (the audit said 374 and 213). Roots: `.rulesync/skills` (source, 33), five rulesync host copies of 33 each, `skills/` (83), `plugins/terreno-planning` 35 and `terreno-loop` 7 (sources), `plugins/terreno-claude` 35 and `terreno-loop-claude` 7 (generated). |
| 2.8 | Confirmed | `quality-check.sh` runs `bun run lint` (which ends in `typecheck`), `bun run compile`, `bun run analyze:full` on every stop, for seven hosts, 300 s timeout. |
| 7.1 | Narrowed | 324 tracked files mention "flourish"; most are licence headers, the GCP project id, frozen docs snapshots and planning history. The private items are a short list (see T5). The "default theme name" is prose in `docs/reference/ui.md:68` and one skill reference; there is no code identifier to rename. The hosted MCP hostname already moved to `mcp.terreno.app` in 57.20.0; only a fallback sentence in `README.md:202-203` remains. |
| 7.1 | Added | CircleCI release commits use the committer email `josh@nang.io` (`.circleci/continue-config.yml:2571,2667`); the audit only named `josh@flourish.health` in the GitHub fallback workflow. |
| 7.2 | Confirmed, extended | 6,677 of 12,102 tracked files are `website/versioned_docs/` (four versions). The docs site excludes only `implementationPlans` and `tasks`, so `docs/plans`, `docs/audits`, `docs/superpowers`, `docs/scans` are built into the site. `mcp-server/scripts/sync-versioned-docs.ts` copies all of `docs/` with no exclude, so the hosted MCP docs search indexes every planning file. |
| 7.3 | Confirmed | `CONTRIBUTING.md:38-42` (inline env), `:65` (Cloud VM pointer), `:134` (`api:dev` is not a root script), `:178` (says a GitHub Action publishes and notifies Zoom Chat; CircleCI `publish-release` publishes), `:188` ("rulesync 17", `package.json` has `^43.8.0`), `:252` (points at the disabled `dco.yml`). |
| 7.4 | Corrected, stronger | `check:changelog` validates fragment format only; nothing fails a pull request for a missing fragment. The DCO job is worse than "likely skips": its first step, `skip_if_not_fork_pull_request`, halts unless `CIRCLE_PR_REPONAME` or `CIRCLE_PR_USERNAME` is set, and the repository's own config says GitHub App pipelines leave both unset (`continue-config.yml:553`, `scripts/ci/pull-request-fork.sh:3`). If that comment is right, DCO runs on no pull request. Its second gate halts when `GITHUB_TOKEN` is absent, and the token comes from a context. |
| 7.5 | Corrected | Tag publishing runs in CircleCI `publish-release`, which already loops over a package list calling `scripts/ci/publish-package.sh`. The 18 duplicated jobs are in `publish-on-tag.yml`, a dispatch-only fallback. 34 of 53 workflows are disabled twins. Eight scripts and tests read those workflow files, so deleting them is not a one-line change (X1). |
| 7.5 | Passed on | The CircleCI package list and the version-bump loop both omit `cli`, which is the likely reason `@terreno/cli` is stuck at 57.3.0. Owned by `one-command-dev`. |
| 7.6 | Confirmed, extended | All 17 manifests use `git+ssh://` with no `directory`. `ai`, `comms`, `feature-flags`, `announcements` have no `files`. `syncdb` has no `LICENSE`, is missing from `PUBLISHED_PACKAGES` in the licence check, and its manifest says `"license": "Apache-2.0"` while its README and the root `LICENSE` say MIT (Q1). |

## Tasks

- [ ] **T1** — Scope the 11 package rules to their packages and check that they stay scoped
  - Depends on: none
  - Files: `.rulesync/rules/admin-backend/00-admin-backend.md`, `.rulesync/rules/admin-frontend/00-admin-frontend.md`, `.rulesync/rules/ai/00-ai.md`, `.rulesync/rules/api/00-api.md`, `.rulesync/rules/api/01-model-field-descriptions.md`, `.rulesync/rules/demo/00-demo.md`, `.rulesync/rules/example-backend/00-example-backend.md`, `.rulesync/rules/example-frontend/00-example-frontend.md`, `.rulesync/rules/mcp-server/00-mcp-server.md`, `.rulesync/rules/syncdb/00-syncdb.md`, `.rulesync/rules/ui/00-ui.md`, the generated copies `bun run rules` rewrites (`.claude/rules/`, `.cursor/rules/`, `.github/instructions/`, `.devin/`, per-package `AGENTS.md`), `scripts/check-agent-rules/lib.ts`, `scripts/check-agent-rules/check.ts`, `scripts/check-agent-rules/lib.test.ts`, `docs/explanation/agent-guidelines.md`
  - Change: set `globs` per the table, run `bun run rules`, commit the regenerated files. Do not edit generated files by hand.

    | Rule | New `globs` |
    | --- | --- |
    | `admin-backend/00` | `["admin-backend/**"]` |
    | `admin-frontend/00` | `["admin-frontend/**", "admin-spa/**"]` |
    | `ai/00` | `["ai/**"]` |
    | `api/00` | `["api/**", "example-backend/**"]` |
    | `api/01-model-field-descriptions` | `["**/models/**", "**/*Model.ts"]` |
    | `demo/00` | `["demo/**"]` |
    | `example-backend/00` | `["example-backend/**"]` |
    | `example-frontend/00` | `["example-frontend/**"]` |
    | `mcp-server/00` | `["mcp-server/**"]` |
    | `syncdb/00` | `["syncdb/**"]` |
    | `ui/00` | `["ui/**", "demo/**"]` |
  - Seam: exported function `collectRuleFindings` and the CLI `bun run scripts/check-agent-rules/check.ts`
  - Interface: `collectRuleFindings({repoRoot}: {repoRoot: string}): RuleFinding[]` where `RuleFinding` is `{file: string; kind: "unscoped-package-rule" | "over-budget" | "tracked-local-root" | "forbidden-root-heading"; message: string}`. It reads every `.rulesync/rules/**/*.md` frontmatter. `ALWAYS_LOADED_BUDGET_BYTES = 32000` is exported. `unscoped-package-rule` applies to a rule file inside a subdirectory of `.rulesync/rules/` whose `globs` contains `"**/*"`; top-level files are not checked by it. The budget counts the bytes of every rule with `root: true` (a `localRoot` rule is not counted; T2 removes it). The CLI prints one line per finding and exits 1 when there is any, else prints `check-agent-rules: OK` and exits 0. T1 implements the first two kinds; T2 and T4 add the others.
  - Cases (each builds a temp directory with `.rulesync/rules/` files):
    - `api/00-api.md` with `globs: ["**/*"]` → one finding, kind `unscoped-package-rule`, file `.rulesync/rules/api/00-api.md`
    - `api/00-api.md` with `globs: ["api/**", "**/*"]` → same finding
    - `comms/00-comms.md` with `globs: ["comms/**/*.ts"]` → no finding
    - top-level `00-root.md` with `root: true`, `globs: ["**/*"]`, 100 bytes → no finding (root rules may be global)
    - top-level `00-root.md` with `root: true` and a 33,000-byte body → one finding, kind `over-budget`, message contains `33` and `32000`
    - a rule file with no frontmatter → no finding, no throw
    - empty `.rulesync/rules/` → `[]`
    - top-level `01-x.md` with `localRoot: true`, `globs: ["**/*"]`, 40,000 bytes → no `unscoped-package-rule` and no `over-budget` finding
    - the real repository after this task → `[]` for kinds `unscoped-package-rule` and `over-budget` (the root rule is 29,106 bytes today)
  - Acceptance: `bun test scripts/check-agent-rules/` passes. `grep -rA2 "^paths:" .claude/rules/*/ | grep -c "'\*\*/\*'"` prints `0` (it prints 11 today; the generated frontmatter is `paths:` followed by list lines). After committing the regenerated files, `bun run rules:check` exits 0 (it runs `git diff --exit-code`, so it fails on any uncommitted change). `docs/explanation/agent-guidelines.md` states that package rules load only for their package paths and names the check.
  - Blast radius: none — rule text is unchanged; only when each host loads it changes.
  - Test skills: none (plain `bun test` script suite; follow `scripts/check-circleci-parity/lib.test.ts` for the temp-directory pattern)

- [ ] **T2** — Stop generating and tracking `CLAUDE.local.md`
  - Depends on: T1
  - Files: `.rulesync/rules/01-claudecode-root.md` (delete), `CLAUDE.local.md` (delete from git), `.gitignore`, `scripts/check-agent-rules/lib.ts`, `scripts/check-agent-rules/lib.test.ts`, `docs/explanation/agent-guidelines.md`
  - Change: delete the source rule, `git rm CLAUDE.local.md`, add `CLAUDE.local.md` to `.gitignore`, add the `tracked-local-root` finding. `CONTRIBUTING.md:194` still names the deleted rule; T7 owns that file and removes the sentence. Reversible by revert (restores both files).
  - Seam: `collectRuleFindings`
  - Interface: as T1; a rule whose frontmatter has `localRoot: true` yields kind `tracked-local-root`.
  - Cases:
    - `01-claudecode-root.md` with `localRoot: true` → one finding, kind `tracked-local-root`
    - `00-root.md` with `root: true` and no `localRoot` → no such finding
    - the real repository after this task → no `tracked-local-root` finding
  - Acceptance: `git ls-files CLAUDE.local.md` prints nothing. `git check-ignore CLAUDE.local.md` exits 0. With an untracked `CLAUDE.local.md` present, `bun run rules` leaves it in place (run it and check the file still exists; if rulesync's `delete: true` removes it, stop and report `FAIL` with the output, because a maintainer's private file must survive regeneration). After committing, `bun run rules:check` exits 0.
  - Blast radius: Claude Code sessions in this repository lose the 12 KB duplicate; everything in it is already in `CLAUDE.md`.
  - Test skills: none

- [ ] **T3** — Make the agent stop hook skip clean and docs-only trees and check only changed workspaces
  - Depends on: none
  - Files: `.rulesync/hooks/quality-check.sh`, `scripts/planning/qualityCheckHook.test.ts`, `docs/explanation/static-analysis.md`, `docs/explanation/ai-workflows.md`
  - Change: after the existing `stop_hook_active` exit and before the dependency check, list changed files: the value of `QUALITY_CHECK_CHANGED_FILES` when that variable is set (newline-separated, may be empty), otherwise `git status --porcelain -uall` paths (staged, unstaged, untracked). Then pick a plan:

    | Changed files | Commands, in order |
    | --- | --- |
    | none | none; print `{}` and exit 0 |
    | only `*.md`, `*.mdx`, or paths under `docs/`, `changelog/` | none; print `{}` and exit 0 |
    | every code file is inside a workspace directory from root `package.json` `workspaces` | per changed workspace `<dir>`: `bun run --filter "./<dir>" lint`, then `bun run --filter "./<dir>" typecheck`; then `bun run analyze:full` once |
    | any other file (root `scripts/`, root config, `.rulesync/`, `.circleci/`) | `bun run lint`, then `bun run analyze:full` |
    | `QUALITY_CHECK_FULL=1`, whatever changed | `bun run lint`, then `bun run analyze:full` |

    `bun run compile` is removed from every plan (root `lint` already ends in `typecheck`; the old `compile` only duplicated work). A workspace with no `lint` or `typecheck` script is skipped by `--filter` and is not a failure. When a typecheck fails and any workspace directory lacks `dist/`, append `Run bun run compile first.` to the reason. The hook does not typecheck workspaces that depend on a changed one; `bun run prepush` and the CircleCI typecheck job cover that, and both docs pages say so. The block and follow-up JSON shapes and the `lint=`, `typecheck=`, `analysis=` status triple stay as they are.
  - Seam: the hook script as a child process, through the existing harness in `scripts/planning/qualityCheckHook.test.ts` (stubbed `bun` on `PATH`). Extend the stub to append each invocation's arguments, one line each, to a log file the test reads.
  - Interface: `echo '<hook json>' | QUALITY_CHECK_CHANGED_FILES=$'<paths>' .rulesync/hooks/quality-check.sh <host>` → stdout is `{}` on success or a skip; otherwise `{"decision":"block","reason":"Quality checks failed (lint=<n>, typecheck=<n>, analysis=<n>). Fix the reported errors before stopping."}` (for `cursor`: `{"followup_message": "<same sentence>"}`); exit code 0 in every case.
  - Cases (host `claudecode` unless stated; the `bun` log is the list of stub invocations):
    - `QUALITY_CHECK_CHANGED_FILES=""` → stdout `{}`; `bun` log empty (no install either)
    - `docs/how-to/x.md` and `README.md` → stdout `{}`; `bun` log empty
    - `api/src/a.ts` → log is exactly `run --filter ./api lint`, `run --filter ./api typecheck`, `run analyze:full`
    - `api/src/a.ts` and `ui/src/b.tsx` → log has the `./api` pair, the `./ui` pair, then one `run analyze:full`; no `run lint`, no `run compile`
    - `api/src/a.ts` and `docs/x.md` → same as the `api/src/a.ts` case
    - `scripts/ci/x.ts` → log is exactly `run lint`, `run analyze:full`
    - `QUALITY_CHECK_FULL=1` with `QUALITY_CHECK_CHANGED_FILES=""` → log is exactly `run lint`, `run analyze:full`
    - `api/src/a.ts`, stub exits 1 for the `./api lint` call → stdout is the block JSON with `lint=1, typecheck=0, analysis=0`
    - same, host `cursor` → stdout has `followup_message` with `lint=1`
    - `api/src/a.ts`, hook input `{"stop_hook_active": true}` → stdout `{}`; `bun` log empty
    - every existing case in the file keeps passing with `QUALITY_CHECK_FULL=1` set by the harness default
  - Acceptance: `bun test scripts/planning/qualityCheckHook.test.ts` passes. Both docs pages describe the skip rule, the per-workspace scope and `QUALITY_CHECK_FULL=1`, and say that committed work is covered by the pre-commit hook and CI, not the stop hook.
  - Blast radius: seven hosts' generated hook configs call the same script path with the same arguments, so none of them changes. `bun run rules:check` must still exit 0.
  - Test skills: none

- [ ] **T4** — Remove maintainer-only sections from the root rule
  - Depends on: T2
  - Files: `.rulesync/rules/00-root.md`, generated `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/00-root.mdc`, `.github/copilot-instructions.md`, `docs/maintainers/cloud-agents.md` (new), `scripts/check-agent-rules/lib.ts`, `scripts/check-agent-rules/lib.test.ts`
  - Change, in `.rulesync/rules/00-root.md`:
    1. Delete the whole `## Short Attention Span (always on)` section (see Q3).
    2. Rename `## Cursor Cloud specific instructions` to `## Local development`. Keep `### Bootstrap`, `### Example full stack`, `### Tests and lint`, and the `demo:start` and `$HOME/.bun/bin/bun` gotchas.
    3. Delete `### Cloud VM toolchain`, `### GCP service account secrets`, `### Sentry API access`, `### CircleCI API access`, and the gitsight port gotcha.
    4. Add one line under `## Local development`: `Maintainers' cloud agents: see docs/maintainers/cloud-agents.md.`
    5. Create `docs/maintainers/cloud-agents.md`, titled "Maintainer cloud agents", opening with "For Terreno maintainers only. Outside contributors need none of this." It keeps the `GCP_SA_TERRENO`, `SENTRY_CLIENT_SECRET` and `CIRCLECI_TOKEN` paragraphs and the CircleCI project slug. It does not name sibling applications, their service accounts, or any path outside this repository.
    6. Run `bun run rules`.
  - Seam: `collectRuleFindings`
  - Interface: as T1; kind `forbidden-root-heading` for a `root: true` rule whose body has a heading line (`#`–`####`) containing `Short Attention Span` or `Cursor Cloud`, case-insensitive.
  - Cases:
    - root rule body `## Short Attention Span (always on)` → one finding, kind `forbidden-root-heading`
    - root rule body `### cursor cloud specific instructions` → one finding
    - root rule body with the sentence `Cursor Cloud agents may run this` and no such heading → no finding
    - the same heading in a non-root rule → no finding
    - the real repository after this task → `[]` for every kind
  - Acceptance: `bun test scripts/check-agent-rules/` passes and `bun run scripts/check-agent-rules/check.ts` exits 0. `grep -c "Short Attention Span\|Cursor Cloud\|/agent/repos\|GCP_SA_PRD\|GCP_SA_STG\|ZAPLING\|gitsight" AGENTS.md CLAUDE.md` prints `0` for both files. `AGENTS.md` is under 24,000 bytes (it is 28,940 today). After committing, `bun run rules:check` exits 0. The task result quotes the commit hash and line ranges of the removed text, so the owner can copy it (see "Before merge").
  - Blast radius: every agent host reads the generated root. The neighbouring plan `docs-match-the-code` edits the same source rule; rebase onto whichever lands first and re-run `bun run rules` instead of resolving generated files by hand.
  - Test skills: none

- [ ] **T5** — Add `check-internal-references` with a deny list and a reasoned allowlist
  - Depends on: none
  - Files: `scripts/check-internal-references/lib.ts`, `scripts/check-internal-references/check.ts`, `scripts/check-internal-references/lib.test.ts`
  - Seam: exported functions `findInternalReferences` and `isAllowlisted`, and the CLI
  - Interface: `findInternalReferences({path, text}: {path: string; text: string}): InternalReferenceHit[]` with `InternalReferenceHit = {path: string; line: number; pattern: string; match: string}`; returns `[]` when `isAllowlisted(path)` is true. `DENY_PATTERNS` and `ALLOWLIST` (`{glob: string; reason: string}[]`, every reason non-empty) are exported. The CLI reads `git ls-files`, skips binary files, prints `path:line pattern match` per hit and exits 1, or prints `check-internal-references: OK` and exits 0.

    Deny patterns (case-insensitive): `/agent/repos/`, `GCP_SA_(PRD|STG|ZAPLING)`, `\bgitsight\b`, `\bzapling\b`, `\.\./flourish/`, `flourish\.health`, `flourish-backend`, `FLOURISH_SERVICE`, `Flourish Health (light|dark) mode`. Personal-domain sample emails in tests and docs (`@nang.io`) and the Zoom notifier are public code, not private infrastructure, and are not denied (X10).

    Allowlist globs: `CHANGELOG.md`, `**/upgrades/**`, `website/versioned_docs/**`, `docs/implementationPlans/**`, `docs/tasks/**`, `docs/superpowers/**`, `docs/plans/**`, `docs/audits/**`, `docs/scans/**`, `infra/flourish/**`, `docs/how-to/set-up-terreno-mcp.md` (the legacy-hostname migration section), `website/scripts/docs-audit.ts`, `website/scripts/docs-audit.test.ts`, `scripts/check-internal-references/**`, `.github/workflows/cd.yml` (disabled twin, removed by X1), `**/plugin.json` and `**/marketplace.json` (the published plugin contact address `terreno@flourish.health`; Q4 decides its replacement).
  - Cases:
    - path `AGENTS.md`, text `bash /agent/repos/flourish/scripts/x.sh` → one hit, line 1, pattern `/agent/repos/`
    - path `README.md`, text `line one\nuse https://mcp.terreno.flourish.health/mcp` → one hit, line 2, pattern `flourish\.health`
    - path `ui/package.json`, text `cp -a dist/* ../flourish/node_modules` → one hit
    - path `a.yml`, text `git config user.email "josh@flourish.health"` → one hit, pattern `flourish\.health`
    - path `ui/src/x.test.tsx`, text `email: "test@nang.io"` → `[]` (not a denied token)
    - path `plugins/terreno-claude/.claude-plugin/plugin.json`, text `"email": "terreno@flourish.health"` → `[]` (allowlisted)
    - path `LICENSE`, text `Copyright (c) 2026 Flourish Health, Inc.` → `[]`
    - path `scripts/ci/gcp-deploy.sh`, text `GCP_PROJECT_ID:-flourish-terreno` → `[]`
    - path `CONTRIBUTING.md`, text `see infra/flourish/README.md` → `[]`
    - path `CHANGELOG.md`, text `mcp.terreno.flourish.health` → `[]` (allowlisted)
    - path `docs/plans/2026-11-13-oss-repo-hygiene.md`, text `GCP_SA_PRD` → `[]` (allowlisted)
    - path `docs/how-to/other.md`, text `GCP_SA_PRD` → one hit
    - empty text → `[]`
    - every `ALLOWLIST` entry has a `reason` of at least 10 characters
  - Acceptance: `bun test scripts/check-internal-references/` passes. The CLI may still exit 1 on the real tree; T6 makes it pass.
  - Blast radius: none — new files only.
  - Test skills: none

- [ ] **T6** — Remove the internal references the check finds
  - Depends on: T4, T5
  - Files: `.circleci/continue-config.yml`, `.github/workflows/publish-on-tag.yml`, `ui/package.json`, `example-backend/src/instrument.ts`, `example-backend/src/websockets.ts`, `scripts/ci/gcp-deploy.sh`, `README.md`, `docs/reference/ui.md`, `plugins/terreno-planning/skills/terreno-ui/references/theming.md` and its generated copies under `plugins/terreno-claude/` and `skills/`, `syncdb/src/auth/rememberedAccounts.ts`, `syncdb/src/auth/rememberedAccounts.test.ts`, `demo/stories/MarkdownView.stories.tsx`, `demo/stories/Field.stories.tsx`, `docs/reference/syncdb.md`, `example-backend/.env` and `example-backend/.env.example` (whichever is tracked and has the line), `scripts/check-internal-references/lib.ts`, `scripts/ci/release/committerIdentity.test.ts` (new), `example-backend/src/serviceName.ts` (new), `example-backend/src/serviceName.test.ts` (new), any test that asserts the old strings
  - Change:
    1. Release committer (`continue-config.yml:2570-2571,2666-2667`; `publish-on-tag.yml:1695,1813` and the `user.name` lines beside them): `user.name "terreno-release-bot"`, `user.email "release-bot@terreno.app"` (D3, Q4). Change only those lines in `publish-on-tag.yml`; `one-command-dev` owns the rest of that file.
    2. `ui/package.json`: delete the `local` script.
    3. Service name: add `resolveServiceName` and use it in `instrument.ts` and `websockets.ts`. `scripts/ci/gcp-deploy.sh:181` sets `TERRENO_SERVICE=${GCP_TASKS_SERVICE}` and keeps setting the old variable for one release (D4).
    4. `README.md:202-203`: delete the fallback sentence. The troubleshooting section of `docs/how-to/set-up-terreno-mcp.md` keeps it (D5).
    5. `docs/reference/ui.md:68` and the `theming.md` source: say "the default light theme" instead of naming a company. Run `bun run skills:sync`.
    6. `rememberedAccounts.ts` comment and test: use `josh@mail.example.health` (expected mask stays `j***@m***.health`). `MarkdownView.stories.tsx:17`: link `[Terreno](https://terreno.app)`. `Field.stories.tsx:180`: `https://www.example.com`. `docs/reference/syncdb.md:695`: the same `example.health` sample. `example-backend/.env:188`: the commented `FLOURISH_SERVICE` line becomes `TERRENO_SERVICE`.
    7. The generated root rules (`.cursor/rules/00-root.mdc`, `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`) are already clean after T4; do not edit them here.
    8. Before fixing, run the check and compare its hit list with this list. A hit in a file not named here is fixed the same way when it is a sample value or comment; anything else stops the task with the list.
  - Seam: exported function `resolveServiceName` (new behaviour); the CLI `bun run scripts/check-internal-references/check.ts` on the real tree
  - Interface: `resolveServiceName({env}: {env: Record<string, string | undefined>}): string` in `example-backend/src/serviceName.ts` → `env.TERRENO_SERVICE`, else `env.FLOURISH_SERVICE`, else `"terreno-example-backend"`; empty strings count as unset.
  - Cases:
    - `{TERRENO_SERVICE: "tasks"}` → `"tasks"`
    - `{FLOURISH_SERVICE: "legacy"}` → `"legacy"`
    - `{TERRENO_SERVICE: "new", FLOURISH_SERVICE: "legacy"}` → `"new"`
    - `{TERRENO_SERVICE: "", FLOURISH_SERVICE: "legacy"}` → `"legacy"`
    - `{}` → `"terreno-example-backend"`
    - `maskEmail("josh@mail.example.health")` → `"j***@m***.health"`
    - `committerIdentity.test.ts`: every `git config … user.email` value in `.circleci/continue-config.yml` and `.github/workflows/publish-on-tag.yml` equals `release-bot@terreno.app`, and every `user.name` value beside one equals `terreno-release-bot`
  - Acceptance: `bun run scripts/check-internal-references/check.ts` exits 0. `bun test example-backend/src/serviceName.test.ts` and the syncdb `rememberedAccounts` test pass. `bun run skills:check` and `bun run rules:check` exit 0. `bun test scripts/ci/release/committerIdentity.test.ts` passes. The allowlist in `lib.ts` gains `example-backend/src/serviceName.ts`, `example-backend/src/serviceName.test.ts` and `scripts/ci/gcp-deploy.sh` with the reason "reads the legacy env name for one release".
  - Blast radius: the Sentry service name of a deployment that sets neither variable changes from `flourish-backend` to `terreno-example-backend`; the maintainers' deploy script sets the variable, so their dashboards keep their names. `scripts/ci/cloud-run-preview.test.ts` and `scripts/ci/publish-lockstep-packages.test.ts` read the edited CI files: run both.
  - Test skills: terreno-backend-tests (for the example-backend unit test)

- [ ] **T7** — Rewrite the contributor on-ramp in `CONTRIBUTING.md`
  - Depends on: none
  - Files: `CONTRIBUTING.md`, `scripts/docs/contributingCommands.ts` (new), `scripts/docs/contributingCommands.test.ts` (new)
  - Change:
    1. "Development setup" becomes numbered steps: install Bun 1.4.4 or newer; `bun run bootstrap`; `cp example-backend/.env.example example-backend/.env` (skip when the file exists); start MongoDB as a single-node replica set (copy the three-step `mongod` block from the root rule's "Example full stack" section, which stays where it is, and delete the `:65` pointer to "Cloud VM"); `bun run backend:seed`; `bun run backend:dev`; `bun run frontend:web`. No inline env vars. When `one-command-dev` has landed `bun run dev`, replace the MongoDB and start steps with it; otherwise leave them.
    2. Add "Your first pull request": find an issue labelled `good first issue`; the three commands that matter (`bun run lint`, the closest `bun test <path>`, `bun run prepush`); sign commits with `git commit -s`; add a `changelog/unreleased/<name>.md` fragment for a user-facing change (say plainly that CI checks the fragment's format, not its presence, and a maintainer may add one); link to the "Fork pull requests" section of `docs/how-to/circleci.md`.
    3. Add `bun run prepush` to the "Common commands" table with the note "run `bun run compile` once before `bun run typecheck`".
    4. Fix the stale facts: `:134` drop `bun run api:dev`; `:178` say CircleCI `publish-release` publishes on a tag and drop "notifies Zoom Chat"; `:184` prefix the infra link with "Maintainers only:"; `:188` drop the rulesync version number; `:194` drop the sentence about `01-claudecode-root.md` and `CLAUDE.local.md`; `:252` say the CircleCI `dco` job checks sign-off on pull requests from forks, and that a maintainer will ask for a sign-off if CI did not run on the fork (Q5).
  - Seam: exported function `findContributingProblems`
  - Interface: `findContributingProblems({markdown, scripts, pathExists}: {markdown: string; scripts: string[]; pathExists: (relativePath: string) => boolean}): string[]` → one message per `bun run <name>` whose `<name>` (up to the first space or backtick) is not in `scripts`, and one per relative Markdown link target (no scheme, `#fragment` stripped) for which `pathExists` is false. The test file also runs it on the real `CONTRIBUTING.md` and root `package.json`.
  - Cases:
    - markdown `` `bun run api:dev` ``, scripts `["api:compile"]` → `["CONTRIBUTING.md: unknown script api:dev"]`
    - markdown `` `bun run prepush --all` ``, scripts `["prepush"]` → `[]`
    - markdown `` `cd ui && bun run test:coverage` `` (a package-directory command) → `[]` when the line contains `cd `
    - markdown `[x](docs/missing.md)`, `pathExists` false → `["CONTRIBUTING.md: broken link docs/missing.md"]`
    - markdown `[x](https://example.com)` → `[]`
    - markdown `[x](AGENTS.md#testing)`, `pathExists("AGENTS.md")` true → `[]`
    - the real files after this task → `[]`
    - the real `CONTRIBUTING.md` contains none of: `TOKEN_SECRET=dev-token-secret`, `Cloud VM`, `rulesync) 17`, `Zoom Chat`, `.github/workflows/dco.yml`, `CLAUDE.local.md`
    - the real `CONTRIBUTING.md` contains each of: `good first issue`, `bun run prepush`, `git commit -s`, `example-backend/.env.example`
  - Acceptance: `bun test scripts/docs/contributingCommands.test.ts` passes.
  - Blast radius: none — prose and a new test.
  - Test skills: none

- [ ] **T8** — Replace the token-gated DCO job with a tokenless check that runs on fork pull requests
  - Depends on: T6 (both edit `.circleci/continue-config.yml`)
  - Files: `scripts/ci/dco/lib.ts`, `scripts/ci/dco/check.ts`, `scripts/ci/dco/lib.test.ts`, `scripts/ci/dco/config.test.ts`, `.circleci/continue-config.yml`, `docs/regression/ci.md` (new, holding CI-new-1 in the format of the other suites), `docs/regression/README.md` (index entry)
  - Change: the `dco` job drops its `terreno-github-api` context (it needs no secret any more) and becomes: checkout with full history, `git fetch origin '+refs/heads/*:refs/remotes/origin/*'`, then `bun run scripts/ci/dco/check.ts --base origin/master`. The script decides from git alone, with no API call and no secret: a tag build → skip; `HEAD` contained in any `origin/*` branch (`git branch -r --contains HEAD` is non-empty) → skip, because the commit is on a branch of the base repository, so a maintainer pushed it; otherwise → enforce, because the commit exists only on a fork. This fails closed: any build whose head is not on a base-repository branch is checked. The earlier design (classify through the GitHub API or `scripts/ci/resolve-preview-pr.sh`) is rejected: the resolver looks up `head=TerrenoLabs:<branch>`, which never matches a fork, and an unauthenticated lookup that fails would skip the check. Delete the `skip_if_not_fork_pull_request` command (its only caller is this job) and the `GITHUB_TOKEN missing … circleci step halt` block. No step needs a secret to run the check itself.
  - Seam: exported function `findUnsignedCommits`; the CLI; the `dco` job text in the CircleCI config
  - Interface: `decideDco({isTagBuild, originBranchesContainingHead}: {isTagBuild: boolean; originBranchesContainingHead: string[]}): "skip" | "enforce"`. `findUnsignedCommits({commits}: {commits: DcoCommit[]}): DcoCommit[]` with `DcoCommit = {sha: string; authorName: string; authorEmail: string; parentCount: number; message: string}`. A commit passes when its message has a line `Signed-off-by: <any name> <email>` whose email equals `authorEmail` case-insensitively, or `parentCount >= 2`. There is no author-based exemption: an author email is set by the committer and cannot be trusted on a fork, and bot commits arrive on same-repository branches, which are skipped. CLI: `bun run scripts/ci/dco/check.ts --base <ref>` (reads `CIRCLE_TAG` and runs the `git branch -r --contains HEAD` query itself); on `skip` prints `dco: skipped (<reason>)` and exits 0; otherwise checks `merge-base(<ref>, HEAD)..HEAD` and prints `dco: OK — <n> commit(s)` and exits 0, or lists each unsigned `sha subject`, prints `Fix: git rebase --signoff <ref> && git push --force-with-lease`, and exits 1.
  - Cases:
    - author `a@x.com`, message `Fix\n\nSigned-off-by: A <a@x.com>` → `[]`
    - author `A@X.com`, trailer email `a@x.com` → `[]`
    - author `a@x.com`, trailer `Signed-off-by: B <b@x.com>` → that commit returned
    - message `Fix` with no trailer → returned
    - message `Signed-off-by: A <a@x.com> trailing words` on the subject line only, author `a@x.com` → `[]` (any line counts)
    - no trailer, `parentCount: 2` → `[]`
    - no trailer, author `49699333+dependabot[bot]@users.noreply.github.com`, `parentCount: 1` → returned (no author exemption)
    - `decideDco({isTagBuild: true, originBranchesContainingHead: []})` → `"skip"`; `{isTagBuild: false, originBranchesContainingHead: ["origin/fix-login"]}` → `"skip"`; `{isTagBuild: false, originBranchesContainingHead: ["origin/master", "origin/x"]}` → `"skip"`; `{isTagBuild: false, originBranchesContainingHead: []}` → `"enforce"`
    - `commits: []` → `[]`
    - two commits, second unsigned → only the second returned
    - config test: the `dco` job's serialized steps contain `scripts/ci/dco/check.ts` and `git fetch origin`, and contain neither `pull-request-fork.sh`, `resolve-preview-pr.sh`, `skip_if_not_fork_pull_request` nor `GITHUB_TOKEN missing`
    - config test: the string `skip_if_not_fork_pull_request` appears nowhere in `.circleci/continue-config.yml`
  - Acceptance: `bun test scripts/ci/dco/` passes. `circleci config validate` is not required; the config test parses the file with `Bun.YAML.parse` and must not throw.
  - Needs the owner (cannot be read from the repository): whether the CircleCI project has "Build forked pull requests" on, and "Pass secrets to builds from forked pull requests" off. With the first off, no job runs on a fork and this check never starts. Recorded as Q5.
  - Blast radius: a fork pull request with an unsigned commit turns red where it was silently green. Same-repository branches, `master` and tag builds are skipped as today. Assumption to prove once: in a fork build, `origin` is the base repository and the fork's head commit is not on any of its branches. Regression case CI-new-1 is run once after merge; record it in `docs/regression/ci.md` in this task. If it shows fork builds are checked out differently, switch to the GitHub DCO app (Q6).
  - Test skills: none

- [ ] **T9** — Report which CircleCI jobs run on a fork pull request, and document it
  - Depends on: T8 (documents and asserts the `dco` job T8 writes; both read the same config)
  - Files: `scripts/ci/forkSafety/lib.ts`, `scripts/ci/forkSafety/check.ts`, `scripts/ci/forkSafety/lib.test.ts`, `.circleci/continue-config.yml` (guards only), `docs/how-to/circleci.md`, `.github/workflows/README.md` (new)
  - Seam: exported function `classifyForkBehaviour`; the CLI
  - Interface: `classifyForkBehaviour({config}: {config: unknown}): ForkJobReport[]` where `config` is the parsed `.circleci/continue-config.yml` and `ForkJobReport = {workflow: string; job: string; contexts: string[]; behaviour: "runs" | "skips-on-fork" | "not-on-pull-requests" | "needs-secret-unguarded"; reason: string}`. Rules, first match wins: a workflow job entry whose `filters` only match tags or only the `master` branch → `not-on-pull-requests`; no `context` → `runs`; a `context` and the job name is in the exported `FORK_SAFE_WITH_CONTEXT` map (`job → reason`, for jobs that run correctly with the secret absent) → `runs`; a `context`, and the job definition's steps include the guard command `skip_if_fork_deploy` or `resolve_preview_pr_number` (both halt on forks) → `skips-on-fork`; otherwise `needs-secret-unguarded`. CLI: `bun run scripts/ci/forkSafety/check.ts` exits 1 listing every `needs-secret-unguarded` job, else prints `check-fork-safety: OK`; with `--report` it prints a Markdown table `| Workflow | Job | On a fork pull request | Why |` and exits 0.
  - Cases (inline config objects):
    - job `lint`, no context → `runs`
    - job `deploy-web`, `context: ["terreno-netlify"]`, steps `["skip_if_fork_deploy", "checkout"]` → `skips-on-fork`
    - job `publish-release`, `context: ["npm"]`, `filters: {tags: {only: "/.*/"}, branches: {ignore: "/.*/"}}` → `not-on-pull-requests`
    - job `review`, `context: ["terreno-agentic"]`, steps `["checkout"]`, not in the map → `needs-secret-unguarded`
    - job `lint-docs`, `context: ["terreno-github-api"]`, steps `["skip_if_fork_deploy"]`, listed in `FORK_SAFE_WITH_CONTEXT` → `runs`, reason equals the map's text (the map wins over the guard)
    - the real config after T8: job `dco` has no context → `runs`
    - a job entry written as a bare string (`- lint`) → `runs`
    - a workflow with no `jobs` → `[]`
    - `--report` on a two-job config → a table with exactly two data rows
  - Acceptance: `bun test scripts/ci/forkSafety/` passes. `bun run scripts/ci/forkSafety/check.ts` exits 0 on the real config: for each job it first reports as `needs-secret-unguarded`, either add the existing `skip_if_fork_deploy` guard as the job's first step or add the job to `FORK_SAFE_WITH_CONTEXT` with a reason that names the step that tolerates the missing secret. If more than five jobs need a guard, stop and report the list instead of editing them all (X6). `docs/how-to/circleci.md` gains a `## Fork pull requests` section holding: the `--report` table; the gates a fork pull request meets (95% package coverage, 90% new-file coverage, zero Knip findings, rulesync and skills drift, DCO) with the local command for each; one sentence that `check:changelog` validates fragment format only; and an "Owner settings" list with the two CircleCI project settings from T8, marked "not verifiable from this repository". `.github/workflows/README.md` says in under 30 lines: CircleCI runs CI, deploys and tag publishing; GitHub Actions runs CodeQL, triage, roadmap and bot workflows; `publish-on-tag.yml` is a manual fallback; files whose trigger is `branches-ignore: "**"` are disabled twins kept for rollback and must not be re-enabled beside CircleCI.
  - Blast radius: none for same-repository builds; a guard added to a job only changes fork builds.
  - Test skills: none

- [ ] **T10** — Normalise published package metadata and check it
  - Depends on: T6 (both edit `ui/package.json`)
  - Files: `package.json` in `api`, `ui`, `syncdb`, `admin-backend`, `admin-frontend`, `admin-spa`, `blocks`, `comms`, `cli`, `jobs`, `mcp-server`, `ai`, `api-health`, `feature-flags`, `announcements`, `test`, `create-terreno-app`; `syncdb/LICENSE` (new, a copy of the root `LICENSE`); `scripts/check-license-coverage/lib.ts`; `scripts/check-package-metadata/lib.ts`, `check.ts`, `lib.test.ts`
  - Change:
    1. Every manifest: `"repository": {"type": "git", "url": "git+https://github.com/TerrenoLabs/terreno.git", "directory": "<package directory>"}`.
    2. `syncdb`: add `LICENSE`; set `"license": "MIT"` (Q1); add `"syncdb"` to `PUBLISHED_PACKAGES`.
    3. `ai`, `comms`, `feature-flags`, `announcements`: add a `files` allowlist. Before editing, run `npm pack --dry-run --json` in each and save the file list. Choose `files` so the list after the edit contains every `dist/**` entry, `README.md`, `LICENSE` and `package.json` from the list before. Put both counts and the names of dropped files in the task result. Dropped files may only be tests, sources outside `dist`, coverage and config.
    4. Do not add `exports` or `engines` (D6, X4).
  - Seam: exported function `findMetadataProblems`; the CLI
  - Interface: `findMetadataProblems({directory, manifest, hasLicenseFile}: {directory: string; manifest: Record<string, unknown>; hasLicenseFile: boolean}): string[]`. Problems: `repository.url` is not exactly `git+https://github.com/TerrenoLabs/terreno.git`; `repository.directory` differs from `directory`; `files` missing or empty; `license` is not `"MIT"`; `hasLicenseFile` false; `homepage` or `bugs` missing. CLI: checks every workspace manifest without `"private": true`; prints `<directory>: <problem>` per problem and exits 1, or `check-package-metadata: OK — <n> packages` and exits 0.
  - Cases:
    - a complete manifest for `api` → `[]`
    - `repository.url` `git+ssh://git@github.com/TerrenoLabs/terreno.git` → one problem containing `repository.url`
    - `repository` as a bare string → one problem containing `repository.url`
    - `repository.directory` `"ui"` with `directory` `"api"` → one problem containing `repository.directory`
    - no `files` → one problem containing `files`; `files: []` → the same
    - `license` `"Apache-2.0"` → one problem containing `license`
    - `hasLicenseFile: false` → one problem containing `LICENSE`
    - a manifest with three defects → three problems
    - the real repository after this task → CLI exits 0 and reports 17 packages
  - Acceptance: `bun test scripts/check-package-metadata/` passes; `bun run scripts/check-package-metadata/check.ts` and `bun run check:licenses` exit 0. The task result lists the pack file counts before and after for the four packages.
  - Blast radius: the published tarballs of `ai`, `comms`, `feature-flags`, `announcements` shrink. A consumer importing a non-`dist` file from one of them would break; step 3's rule (keep every `dist/**` entry) prevents losing compiled output. `one-command-dev` also touches `cli/package.json` and may touch `PUBLISHED_PACKAGES`; rebase, do not overwrite.
  - Test skills: none

- [ ] **T11** — Keep generated copies and frozen history out of search and pull-request diffs
  - Depends on: T1 (both edit `docs/explanation/agent-guidelines.md`)
  - Files: `.ignore` (new), `.gitattributes`, `scripts/repoHygiene/generatedRoots.ts` (new), `scripts/repoHygiene/generatedRoots.test.ts` (new), `docs/explanation/agent-guidelines.md`
  - Change: export `GENERATED_ROOTS` and `SOURCE_ROOTS`. Write each generated root as a root-anchored line in `.ignore`, `/<root>/` (an unanchored `skills` would also hide `.rulesync/skills` and `plugins/terreno-planning/skills`). `.ignore` is read by ripgrep and the editors and agents built on it) and as `<root>/** linguist-generated=true` in `.gitattributes` (collapses the files in GitHub diffs). Nothing is deleted.

    `GENERATED_ROOTS`: `website/versioned_docs`, `website/versioned_sidebars`, `docs/implementationPlans`, `docs/tasks`, `docs/superpowers`, `.agents/skills`, `.claude/skills`, `.cursor/skills`, `.devin/skills`, `.github/skills`, `.claude/rules`, `.cursor/rules`, `.github/instructions`, `skills`, `plugins/terreno-claude`, `plugins/terreno-loop-claude`.

    `SOURCE_ROOTS` (must never be ignored): `.rulesync`, `plugins/terreno-planning`, `plugins/terreno-loop`, `docs/plans`, `docs/audits`, `docs/how-to`, `docs/reference`, `docs/explanation`.
  - Seam: exported function `findHygieneGaps`
  - Interface: `findHygieneGaps({ignoreText, gitattributesText}: {ignoreText: string; gitattributesText: string}): string[]` → `missing from .ignore: <root>` for each generated root with no line exactly `/<root>/`; `unanchored line: <line>` for any non-comment line that does not start with `/`; `not marked generated: <root>` for each with no `<root>/** linguist-generated=true` line; `source root ignored: <root>` for each source root that an `.ignore` line equals or is a parent of.
  - Cases:
    - both texts list every generated root → `[]`
    - `.ignore` lacks `skills/` → `["missing from .ignore: skills"]`
    - `.gitattributes` lacks the `plugins/terreno-claude/**` line → `["not marked generated: plugins/terreno-claude"]`
    - `.ignore` has `skills/` instead of `/skills/` → includes `unanchored line: skills/` and `missing from .ignore: skills`
    - `.ignore` has a line `/plugins/` → includes `source root ignored: plugins/terreno-planning`
    - `.ignore` has a line `/.rulesync/` → includes `source root ignored: .rulesync`
    - comment lines (`# …`) and blank lines are ignored
    - the real files after this task → `[]`
  - Acceptance: `bun test scripts/repoHygiene/` passes. `rg --files | wc -l` at the repository root prints under 5,500 (it is about 12,000 with hidden files today; record both numbers in the task result). `rg --files --hidden .rulesync/skills plugins/terreno-planning/skills | wc -l` prints the same number before and after. `rg -l modelInterfaces | wc -l` is recorded before and after. `bun run lint` and `bun run rules:check` still pass. The existing `.github/workflows/*.lock.yml` line in `.gitattributes` is kept.
  - Blast radius: any ripgrep-based tool stops listing the generated roots, including an agent host that might discover skills through ripgrep. Check by starting one Claude Code session in the repository after the change and confirming the project skills still list; if they do not, remove `.claude/skills` from `GENERATED_ROOTS` and say so in the result.
  - Test skills: none

- [ ] **T12** — Keep planning and audit files out of the docs site and MCP docs, and write the planning-files policy
  - Depends on: none
  - Files: `scripts/docs/internalDocsDirectories.ts` (new), `scripts/docs/internalDocsDirectories.test.ts` (new), `website/docusaurus.config.ts`, `mcp-server/scripts/sync-versioned-docs.ts`, `docs/plans/README.md` (new), `docs/reference/mcp-server.md`, `website/README.md`
  - Change: export `INTERNAL_DOCS_DIRECTORIES = ["implementationPlans", "tasks", "plans", "audits", "superpowers", "scans", "specs", "maintainers"]` and `isInternalDocsPath`. The docs site's `exclude` is built from the list (`**/<name>/**`). The MCP sync copies `docs/` to `next`, and each versioned snapshot to its version directory, through the same filter that skips internal paths. The snapshots on disk are not edited; the filter applies at copy time (58.0.0 alone carries 209 planning files). `docs/plans/README.md` states the policy (D7): plans and audits are public and stay tracked; never write secrets, credentials, PHI, customer or patient names, or private hostnames; `docs/implementationPlans`, `docs/tasks` and `docs/superpowers` are frozen history, read-only; new plans go to `docs/plans/YYYY-MM-DD-<slug>.md`.
  - Seam: exported function `isInternalDocsPath`; the sync script run against a temp directory (add `--docs <dir> --versioned <dir> --out <dir>` flags, defaults unchanged)
  - Interface: `isInternalDocsPath(relativePath: string): boolean` → true when the path's first segment, relative to `docs/`, is in the list.
  - Cases:
    - `plans/2026-11-13-x.md` → true; `audits/2026-11-12/REPORT.md` → true; `implementationPlans/a.md` → true; `maintainers/cloud-agents.md` → true
    - `how-to/plans/x.md` → false (only the first segment counts); `how-to/create-a-model.md` → false; `README.md` → false; `` (empty) → false
    - sync with `--docs` holding `how-to/a.md`, `plans/b.md`, `audits/x/c.md` → `<out>/next/how-to/a.md` exists; `<out>/next/plans` and `<out>/next/audits` do not
    - sync with a versioned tree holding `version-58.0.0/plans/x.md` and `version-58.0.0/how-to/a.md` → `<out>/58.0.0/how-to/a.md` exists; `<out>/58.0.0/plans` does not
    - sync with no versioned directory → exits 0 (existing behaviour)
    - the `exclude` array exported from the docs site config equals the list mapped to `**/<name>/**`
  - Acceptance: `bun test scripts/docs/internalDocsDirectories.test.ts` passes; `bun run mcp:build` succeeds; `docs/reference/mcp-server.md` says which directories the docs search leaves out. Check `website/sidebars.ts` and `docs/README.md` for links into an excluded directory and remove them, so the site build has no broken link.
  - Blast radius: the hosted MCP `terreno_search_docs` and the docs site stop returning planning files on the next deploy. Anything that linked to a published plan page gets a 404; no sidebar entry points there today (verify in the task).
  - Test skills: none

- [ ] **T13** — Wire the four checks into scripts, CI and prepush, and document them
  - Depends on: T3, T6, T7, T9, T10, T11, T12 (T1, T2, T4, T5 and T8 arrive through them; T3 shares `docs/explanation/static-analysis.md`; T7, T11 and T12 add the test directories this task wires)
  - Files: `package.json`, `.circleci/continue-config.yml`, `scripts/ci/prepush/plan.ts`, `scripts/ci/prepush/plan.test.ts`, `docs/explanation/static-analysis.md`, `docs/how-to/run-tests-locally.md`, `changelog/unreleased/oss-repo-hygiene.md` (new)
  - Change: add root scripts `check:agent-rules`, `check:internal-references`, `check:package-metadata`, `check:fork-safety`, each `bun run scripts/<dir>/check.ts`. Add one step per check to the existing CircleCI `repo-policies` job (no new job), each followed by its `bun test scripts/<dir>/`. Add the same four to the repo-policies group in `scripts/ci/prepush/plan.ts`. Add the test directories `scripts/ci/dco/`, `scripts/docs/`, `scripts/repoHygiene/` to whichever step already runs `bun test scripts/…` suites, or as steps beside it. Changelog fragment, category `Changed`: package manifests now carry an `https` repository URL with `directory`; `@terreno/syncdb` ships a `LICENSE` and declares MIT; `ai`, `comms`, `feature-flags` and `announcements` publish only their built output; the example backend reads `TERRENO_SERVICE` (the old name still works).
  - Seam: exported `planPrepush` in `scripts/ci/prepush/plan.ts`
  - Interface: the existing `planPrepush` signature (read it in `plan.ts`); assert on the returned steps' `command` strings.
  - Cases:
    - plan for a change to `scripts/check-agent-rules/lib.ts` → steps include commands containing `check:agent-rules`, `check:internal-references`, `check:package-metadata`, `check:fork-safety`
    - plan with `all: true` → includes all four
    - root `package.json` `scripts` has the four names, each value starting `bun run scripts/`
    - the `repo-policies` job in the parsed CircleCI config has a step whose command contains each of the four script names
    - the existing prepush coverage test (the one that fails when CI gains a step prepush does not mirror) passes
  - Acceptance: `bun test scripts/ci/prepush/` passes. `bun run prepush --all --dry-run` output contains the four check names. `bun run check:changelog` exits 0. Both docs pages list the four checks with what each guards.
  - Blast radius: every pull request now runs four more checks (each under a second of pure file reading; `check:internal-references` reads every tracked text file, so measure it and record the time).
  - Test skills: none

- [ ] **T14** — Destructive: keep only the newest docs snapshot of the current and the previous major
  - Depends on: T12 (both edit `website/README.md` and `docs/reference/mcp-server.md`)
  - Files: `website/scripts/prune-doc-versions.ts`, `website/scripts/prune-doc-versions.test.ts`, `website/versions.json`, `website/versioned_docs/version-57.20.0/` (delete), `website/versioned_docs/version-57.21.0/` (delete), `website/versioned_sidebars/version-57.20.0-sidebars.json` (delete), `website/versioned_sidebars/version-57.21.0-sidebars.json` (delete), `website/README.md`, `docs/reference/mcp-server.md`
  - Destructive: deletes about 3,300 tracked files. A revert restores them. The archived sites for 57.20.0 and 57.21.0 stay attached to their GitHub releases, but the version dropdown and the MCP versioned search stop offering them (MCP falls back to the nearest kept snapshot). Read `scripts/ci/docs-archive.sh` and the docs deploy job first: if the deploy unpacks an archive for every release rather than for every `versions.json` entry, say so in the result; do not change deploy behaviour in this task.
  - Change: replace the count rule (`KEEP_VERSION_COUNT = 4`) with `selectVersionsToKeep`, run the prune, commit the deletions. This matches launch decision P8, "latest plus one previous major".
  - Seam: exported function `selectVersionsToKeep` and the existing `pruneDocVersions` against a temp website root
  - Interface: `selectVersionsToKeep({versions}: {versions: string[]}): string[]` → the newest version of the highest major and the newest version of the next-highest major present, newest first.
  - Cases:
    - `["58.0.0","57.22.0","57.21.0","57.20.0"]` → `["58.0.0","57.22.0"]`
    - `["58.1.0","58.0.0","57.22.0"]` → `["58.1.0","57.22.0"]`
    - `["58.0.0"]` → `["58.0.0"]`
    - `["58.0.0","56.3.0","55.1.0"]` → `["58.0.0","56.3.0"]`
    - unsorted `["57.20.0","58.0.0","57.22.0"]` → `["58.0.0","57.22.0"]`
    - `[]` → `[]`
    - `pruneDocVersions` on a temp root holding four version directories → two directories and two sidebar files remain; `versions.json` is `["58.0.0","57.22.0"]`
  - Acceptance: `bun test website/scripts/prune-doc-versions.test.ts` passes. `git ls-files website/versioned_docs | wc -l` prints under 3,500 (6,677 today). `website/versions.json` is `["58.0.0","57.22.0"]`. `bun run mcp:build` succeeds.
  - Blast radius: readers pinned to 57.20 or 57.21 docs; the release job's `docs:version` step keeps working and now prunes to two.
  - Test skills: none

## Assumptions

- rulesync maps a rule's `globs` to Claude Code `paths:` and to the other hosts' scoping fields; `comms`, `jobs` and `blocks` already rely on this.
- Mongoose schemas live under a `models/` directory or in a file named `*Model.ts` (for example `api/src/orgs/organizationModel.ts`, `feature-flags/src/featureFlagModel.ts`). T1 lists schema files with `git grep -l "new mongoose.Schema\|new Schema("` and widens the glob for any file neither pattern matches.
- `bun run --filter "./<dir>" <script>` selects one workspace by path and skips a workspace that lacks the script.
- Nothing lints or builds through `.ignore`. If Biome reads it, the generated Markdown and JSON it would skip are not linted today in a way that matters (T11 runs `bun run lint` to confirm).
- `release-bot@terreno.app` need not be a deliverable mailbox for a commit identity. Pushes authenticate with a token, not the email.
- Bun reads `example-backend/.env` when the backend scripts run from that workspace, so the setup needs no inline variables. T7 confirms by reading the `backend:dev` script before rewriting the steps, and keeps the inline form for any variable `.env.example` lacks.
- The CircleCI comment that GitHub App pipelines leave `CIRCLE_PR_*` unset is true. T8 removes the dependency on it either way.

## Dependencies on neighbouring plans

| Plan | Overlap | Rule |
| --- | --- | --- |
| `docs-match-the-code` | `.rulesync/rules/00-root.md`, `.rulesync/rules/api/00-api.md` and their generated copies (T1, T4) | Whichever lands second rebases and re-runs `bun run rules`; never hand-merge generated files. |
| `one-command-dev` | `.github/workflows/publish-on-tag.yml` (T6 changes four identity lines), `cli/package.json` and `PUBLISHED_PACKAGES` (T10), the setup steps in `CONTRIBUTING.md` (T7) | T6 and T10 touch only the lines named. T7 uses `bun run dev` only if it exists at build time. X1 waits for that plan. |
| `secure-defaults` | untracks `example-backend/.env` | T7's `cp … .env.example .env` step is correct before and after. |

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q5 (fundamental) | Are "Build forked pull requests" on and "Pass secrets to builds from forked pull requests" off in the CircleCI project? | Turn the first on, keep the second off | Without the first, outside pull requests get no CI at all and DCO cannot run; the second must stay off because jobs hold deploy credentials. Not readable from the repository. | If fork builds stay off, T8 and T9 still land but are inert, and CONTRIBUTING must say a maintainer pushes the branch to run CI. | T8, T9, T7 |
| Q2 | Drop the 57.20.0 and 57.21.0 docs snapshots now (T14)? | Yes | P8 says latest plus one previous major; removes 3,300 files. | Drop T14; nothing else depends on it. | T14 |
| Q3 | Remove "Short Attention Span (always on)" from the public root rule? It shapes every contributor's agent output. | Remove; the owner adds it to private user-level instructions | It is one person's reading preference, 4 KB loaded by every agent. The text is recoverable from `git show 4f1c5370:.rulesync/rules/00-root.md` lines 500–544. | Keep the section: T4 leaves it, drops the heading from the check, and the size target becomes 28,000 bytes. | T4 |
| Q4 | Release commits: which identity replaces `josh@nang.io` and `josh@flourish.health`? And which contact address replaces `terreno@flourish.health` in the nine plugin and marketplace manifests? | `terreno-release-bot <release-bot@terreno.app>` for commits; leave the plugin contact as it is until a `@terreno.app` mailbox exists | Launch decision: public contacts use `@terreno.app`. | Swap the two strings in T6; if a GitHub machine account exists, use its `noreply` address so commits link to it. | T6 |
| Q6 | Use the GitHub DCO app instead of the in-repository check? | In-repository check, decided from git alone | It needs no installation, token or API call and fails closed; its one unproven assumption (how CircleCI checks out a fork build) is tested once by CI-new-1. | Delete the `dco` job and `scripts/ci/dco/`; CONTRIBUTING names the app. | T8 |
| Q7 | Keep `docs/plans/` and `docs/audits/` tracked and public? | Yes, with the policy in T12 | The public lifecycle plugin writes plans there; hiding the maintainers' own plans would contradict the workflow the project ships. They leave the site and MCP index. | Move both to a private repository: T12 changes to a `.gitignore` entry plus a removal, and this plan and the audit move with them. | T12, T5 |
| Q8 | Do the owner's cloud agents still need the sibling-application lines (`GCP_SA_PRD`, `GCP_SA_STG`, `GCP_SA_ZAPLING`, the private install-script path, the shared port note)? | Drop them from this repository; keep them in the private agent environment configuration | They describe other products' infrastructure. | Nothing in the plan changes; the owner copies the lines from `git show 4f1c5370:AGENTS.md` lines 550 and 604–620 before merge. | T4 |
| Q9 | Should package rules also load for the example apps (for instance `ui` and `syncdb` rules when editing `example-frontend/`)? | No; only the pairs in T1's table | Each added path re-inflates the always-loaded set; skills cover cross-package guidance. | Add the globs in T1's table; no other task changes. | T1 |
| Q11 | Findings 7.5 (34 disabled workflow twins, 18 duplicated publish jobs), most of 2.7 (generated skill copies) and the `exports` half of 7.6 are follow-up plans X1, X3, X4, not tasks here. Accept? | Yes | X1 collides with `one-command-dev` and removes the documented rollback; X3 is a decision about which agent hosts are supported; X4 can break deep imports. This plan removes their symptoms (search noise, a workflows README) without deleting anything. | Each becomes its own plan now; this plan does not change. | none |
| Q10 | Demo story configs link to a Figma file named "Flourish-Health-Design-System" (7 files). Are those links public? | Leave as they are | The check does not deny them; a private link is a dead link for outsiders, but only the owner can tell. | Remove the links or point them at a public file. | none |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | `ci-config-consolidation`: turn `publish-on-tag.yml`'s 18 jobs into one job that loops over `scripts/ci/publish-package.sh`, delete the 34 disabled workflow twins, retire or re-base `check:circleci-parity`, `check-package-coverage-ci`, and the six tests that read the twins, and add `.github/workflows/README.md` | Finding 7.5. Eight scripts and tests read these files, and `one-command-dev` is editing the publish workflow. Deleting the twins also removes the documented rollback path. | L | `one-command-dev` landed; owner agrees git history is the rollback |
| X2 | `docs-snapshots-from-tags`: stop committing `website/versioned_docs/`; build each archive and the MCP versioned index from the release tag's `docs/` | Finding 7.2. After T14 the snapshots are still 3,300 files. Needs tag-fetching in three CI jobs and a change to the MCP build. | L | T14 |
| X3 | `agent-skill-roots`: decide which agent hosts are supported and stop committing the rulesync copies for the rest, or generate them on install | Finding 2.7. Removing a host's copy breaks zero-setup use for that host's users and for cloud agents that clone and start; it is a support decision. T11 removes the search noise without deleting anything. | M | owner decision on hosts |
| X4 | Add `exports` maps to `admin-backend`, `admin-frontend`, `api-health`, `feature-flags`, `announcements`, and `engines` | Finding 7.6. An `exports` map blocks deep imports that work today and changes Metro resolution; needs an upgrade note and a consumer test. | M | none |
| X5 | Remove the frozen planning history (`docs/implementationPlans`, `docs/tasks`, `docs/superpowers`, 206 files) from `master`, kept on an archive tag | Finding 7.2. The roadmap generator and `roadmap:reconcile` read `docs/implementationPlans`, so removal needs their rework. | M | T12 |
| X6 | Guard every context-using CircleCI job against forks | Only if T9 finds more than five unguarded jobs | S–M | T9 |
| X7 | Move `infra/flourish/` to a private repository | Launch decision P5 already records this as the post-launch step | M | owner |
| X8 | Serve docs from `docs.terreno.app` instead of `*.netlify.app` | Finding 7.6; needs DNS | S | owner DNS |
| X10 | Replace personal-domain sample emails (`josh@nang.io` in `syncdb` and `ui` tests and two docs pages) and review `isTestUser` in `@terreno/ui`, whose tests treat `@nang.io` addresses as test users | Found while listing deny-pattern hits; `isTestUser` is behaviour in a published package, so changing it needs its own decision | S | none |
| X9 | Make `bun run typecheck` fail fast with "run `bun run compile`" when `dist` is missing | Finding 2.8's second half; T3 adds the hint to the hook only | S | none |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | Is "Flourish Health" in licence files and the docs footer an internal reference to remove? | No. Recorded launch decision P2: Flourish holds the copyright, contributors sign off with DCO. | The deny list is a short list of private tokens, not the company name. |
| D2 | Rename `infra/flourish/`? | No. Recorded launch decision P5: keep it under `infra/flourish/` now, move to a private repository after launch (X7). | T7 labels it "Maintainers only"; nothing moves. |
| D3 | Whose name goes on release commits? | A bot identity, not a person (Q4 holds the exact strings). | T6. |
| D4 | Compatibility for the example backend's `FLOURISH_SERVICE` variable | `TERRENO_SERVICE` wins; the old name is still read; the deploy script sets both for one release. No adopter is affected: the variable exists only in the example backend, not in a published package or the scaffold. | T6. |
| D5 | Compatibility for the hosted MCP hostname | Nothing is renamed. `mcp.terreno.app` has been the documented URL since 57.20.0 and the legacy `mcp.terreno.flourish.health` mapping keeps serving (`infra/flourish/README.md`). Only the README's fallback sentence goes; the how-to keeps the troubleshooting and migration text. | T6. |
| D6 | Compatibility for the default theme name | Nothing in code is renamed. "Flourish Health light mode" is a phrase in one reference page and one skill reference; `lightThemeConfig` and `darkThemeConfig` keep their names. | T6. |
| D7 | Stance on planning files in a public repository, including this plan and the audit | Tracked and public by design; excluded from the docs site, MCP docs and the internal-reference check; governed by the policy page in T12. | T5 allowlist, T11, T12. |
| D8 | Are the changelog fragment, coverage and Knip gates relaxed for forks? | No gate is relaxed. The fragment was never a gate (`check:changelog` validates format only). The fix is to document the gates and the local command for each. | T7, T9. |
| D9 | Q1: is `@terreno/syncdb` MIT or Apache-2.0? | Owner, 2026-11-13: MIT. | Nothing; T10 was built on this (adds `LICENSE`, sets `"license": "MIT"`). |

## Before merge (owner)

These cannot be done by the build and are not optional:

1. Copy the "Short Attention Span" section and the private "Cursor Cloud" lines into private agent configuration (user-level instructions or the cloud agent environment), from `git show 4f1c5370:.rulesync/rules/00-root.md` (the sections starting at lines 500 and 545). T2 and T4 remove them, and `CLAUDE.local.md`, from every fresh clone.
2. Answer Q5 (the two CircleCI fork settings). Q1 (the `syncdb` licence) is answered: MIT (D9).

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds, fresh subagent. Round 1: 12 findings (2 blocking): 11 fixed, 1 moved to questions (Q11), 0 rebutted. Round 2: 7 findings (1 blocking): 6 fixed (DCO decision rebuilt on git alone so it fails closed, fork classifier order, a missing dependency, MCP versioned filter, regression suite file, this line), 1 rebutted (Q3 and Q8 stay deferrable: T4 is undone by reverting one commit, and the owner action is the Elephant and the first "Before merge" step). No third round was run; the round 2 rewrite of T8 is unreviewed.
