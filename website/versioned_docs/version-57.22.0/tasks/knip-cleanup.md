# Task List: Remove the Knip baseline

See: [`docs/implementationPlans/knip-cleanup.md`](../implementationPlans/knip-cleanup.md)

**Status:** Complete  
**RTK deprecation flag:** None

## Instructions for the implementing agent

- Re-run Knip (JSON reporter, default + production, same as `scripts/static-analysis/full.ts`) at the start of every task. The IP inventory is a snapshot, not the live list.
- Disposition order: **entry → ignore (with comment) → unexport → delete**. Never `knip --fix`.
- Do not delete the old Knip baseline until Task 6.1. Earlier tasks must keep `bun run analyze:full` green while the live finding count falls.
- Do not remove symbols from published package public entries (`src/index.ts` / `src/index.tsx` / `package.json` `exports`).
- Do not remove Expo autolink, native, or Metro packages from `demo`, `admin-spa`, `example-frontend`, or `ui` `package.json` because Knip cannot see them.
- Tests: `bun test --only-failures` on the closest package; after config edits, `bun test scripts/static-analysis/lib.test.ts`.
- Supporting skills: `update-docs`. UI deletes also use `verify-ui-changes`.

### Phase 1: Entry graph

- [x] **Task 1.1**: Register isolated suites and repo script tests as Knip entries
  - Delivers: `*.isolated.ts(x)` and `scripts/**/*.test.ts` (plus `scripts/static-analysis/lib.test.ts`, `.github/scripts/*.test.ts`) stop reporting as unused files
  - Files: `knip.jsonc`, `docs/explanation/static-analysis.md` (entry-graph section: isolated files and `scripts/` tests are first-class entries)
  - Blocked by: none
  - Docs: `docs/explanation/static-analysis.md`
  - Skills: `update-docs`
  - Acceptance: live default Knip report has no `files` finding whose path contains `.isolated.` or `scripts/` + `.test.`; `bun run analyze:full` exits 0; docs name this entry rule

- [x] **Task 1.2**: Put mcp-server tests back on the Bun plugin
  - Delivers: `mcp-server/src/__tests__/**` are in the graph (today `workspaces.mcp-server.bun: false` because Knip 6.34 wants `test.preload` as an array)
  - Files: `knip.jsonc` and/or `mcp-server/package.json` (`test.preload` array form if required)
  - Blocked by: none
  - Docs: none beyond a comment in `knip.jsonc`
  - Acceptance: no default `files` findings under `mcp-server/src/__tests__/`; mcp `bun test` still runs; `analyze:full` exits 0

- [x] **Task 1.3**: Register codegen, Metro stubs, Playwright, fingerprint, and Docusaurus theme entries
  - Delivers: tool-owned files are entries instead of “unused files”: `openapi-config.ts`, `comms-openapi-config.ts`, `jspdf-native-stub.js`, `fingerprint.config.js`, `playwright.circleci.config.ts`, `ui/babel.config.js`, `website/src/theme/**`, `scripts/ci/prepare-package-publish.mjs`, `scripts/planning/fingerprintRisk.ts`, `scripts/planning/updateDependenciesPr.ts` if they are invoked from `package.json` / CI
  - Files: `knip.jsonc`; `package.json` scripts only if an entry name is wrong
  - Blocked by: none
  - Docs: `docs/explanation/static-analysis.md` — table row for Metro stubs / codegen configs
  - Skills: `update-docs`
  - Acceptance: those paths are absent from live `files` findings or listed as `entry`; comments explain each ignore glob if an ignore is used instead; `analyze:full` exits 0

- [x] **Task 1.4**: Ignore generated Expo skill script copies; keep the canonical copy in graph if it is real
  - Delivers: duplicate `expo-cicd-workflows/scripts/{fetch,validate}.js` under `.agents/`, `.claude/`, `.cursor/`, `.devin/`, `.github/`, `.rulesync/`, `skills/` do not appear as unused files
  - Files: `knip.jsonc` ignore globs; confirm canonical path (`.rulesync/skills/...` or `skills/...`)
  - Blocked by: none
  - Docs: one sentence in `docs/explanation/static-analysis.md` that generated skill copies are ignored
  - Skills: `update-docs`
  - Acceptance: no `files` findings whose path contains `expo-cicd-workflows/scripts/`; `analyze:full` exits 0

### Phase 2: Documented ignores (cannot fix)

- [x] **Task 2.1**: Ignore Expo autolink / Metro / font / native `dependencies` Knip cannot see
  - Delivers: `ignoreDependencies` (or workspace-scoped equivalent) for the live unused-deps list on `demo`, `admin-spa`, `example-frontend`, `ui` that exist for autolinking or Metro, including `jspdf` unlisted from metro stubs and `expo-system-ui` / `expo-updates` unlisted from `app.json`
  - Files: `knip.jsonc`, `docs/explanation/static-analysis.md` (why these stay in `package.json`)
  - Blocked by: Task 1.3
  - Docs: `docs/explanation/static-analysis.md`
  - Skills: `update-docs`
  - Acceptance: those packages are gone from live `dependencies` / `unlisted` findings; each ignore has a comment; no app/`ui` `package.json` lost an Expo native dep; `analyze:full` exits 0

- [x] **Task 2.2**: Ignore binaries, catalog-only, and optional peers that are real
  - Delivers: `eas`, `maestro`, catalog `@sentry/react-native` if unused in this repo but required by the catalog contract, `admin-frontend` optional `react-native-webview`
  - Files: `knip.jsonc`
  - Blocked by: none
  - Docs: comment in `knip.jsonc`; mention binaries in `docs/explanation/static-analysis.md` if not already there
  - Skills: `update-docs`
  - Acceptance: live report has no `binaries` / `catalog` / `optionalPeerDependencies` findings except any still destined for Task 3.1 deletion; `analyze:full` exits 0

- [x] **Task 2.3**: Ignore remaining unlisted modules that are optional or type-only
  - Delivers: honest ignores or `optionalDependencies` for `ioredis` (rate-limit redis store), `@ai-sdk/google-vertex`, `@docusaurus/plugin-content-docs`, `express` in ai tests, `@terreno/api` from `@terreno/test` if the graph cannot see the workspace package
  - Files: `knip.jsonc` and/or the declaring `package.json` if the package should be listed instead of ignored
  - Blocked by: Task 1.2
  - Acceptance: Pick records in the task log each remaining unlisted name as either added to `package.json` or ignored with reason; live `unlisted` count is 0 or only items Task 3 will delete; `analyze:full` exits 0

### Phase 3: Remove true unused packages

- [x] **Task 3.1**: Delete unused `devDependencies` after the graph is honest
  - Delivers: remove packages that still appear as unused `devDependencies` and are not CLIs invoked from scripts (`sinon`, `@types/sinon`, `@types/bcrypt`, `@types/cron`, leftover `typedoc`/`prettier`/`ts-node`/`tsx` only if no script references them). Keep `@rtk-query/codegen-openapi`, `@biomejs/biome`, `mongodb` as a driver for example-backend tests, etc., when a script or plugin uses them — those become entries or ignores in Phase 1–2, not deletions
  - Files: affected `package.json` files, lockfile via `bun install`
  - Blocked by: Task 1.1, Task 1.2, Task 1.3, Task 2.2
  - Docs: none unless a documented install step named a removed tool
  - Acceptance: `rg` of the repo and `package.json` scripts show no remaining reference; `bun run compile` (or package `compile`) and the package test script still pass for each touched package; live unused-devDep list for those names is empty; `analyze:full` exits 0

- [x] **Task 3.2**: Remove unused runtime deps that are not Expo/autolink
  - Delivers: example-backend / website / test / api leftovers (`clsx`, unused `lodash` in `@terreno/test`, `generaterr` / `scmp` / `@sentry/profiling-node` **only if** nothing loads them including Sentry init). If a dep is loaded via string/dynamic import, ignore it instead
  - Files: affected `package.json`, source if an import must move
  - Blocked by: Task 2.1, Task 3.1
  - Acceptance: each removed name has no remaining import; package tests pass; `analyze:full` exits 0

### Phase 4: Dead files

- [x] **Task 4.1**: Delete in-repo-dead example-frontend modules
  - Delivers: remove unused files Knip still reports after Phase 1 (candidates from snapshot: `hooks/useLogoutUser.ts`, `useSentryUserSetup.ts`, `useUpdateProfile.ts`, `constants/Colors.ts`, and any unused store helpers). Keep files that routes, tests, or docs still import — those need an entry or a real import
  - Files: `example-frontend/**` listed by live Knip `files`
  - Blocked by: Task 1.3
  - Docs: update example-frontend docs/README only if a named file was documented
  - Skills: `update-docs`, `verify-ui-changes` if a routed screen changes
  - Acceptance: those paths absent from live `files` findings; `cd example-frontend && bun test` passes; if UI was unwired, login + related screen still work with artifacts under `/opt/cursor/artifacts/`

- [x] **Task 4.2**: Delete or wire dead demo / example-backend / api example files
  - Delivers: `demo/stories/PasswordField.stories.tsx` if unregistered; `demo/.eslintrc.js` if unused; `example-backend` unused scripts (`configuration-example.ts`, `seed-admin-spa-admin.ts`, `seedConsents.ts`) unless `package.json` / AdminApp should call them — then add entries; `example-backend/src/constants/index.ts` if a banned barrel leftover; `api/src/example.ts`; unused vendor `convert-yaml.js` only if nothing requires it
  - Files: paths from live Knip `files` in those packages
  - Blocked by: Task 1.3
  - Docs: example-backend README / how-to if a seed script is removed or registered
  - Skills: `update-docs`
  - Acceptance: live `files` findings for those packages are 0 or only ignored globs; relevant `bun test` passes; `analyze:full` exits 0

- [x] **Task 4.3**: Delete or keep-with-entry remaining unused files (`ui/checkDeps.js`, `processCounties.js`, `compileAuthEntry.ts`, leftover demo tests already covered)
  - Delivers: every remaining default `files` finding is either an entry, an ignore glob with comment, or deleted
  - Files: leftover paths from live Knip
  - Blocked by: Task 1.1, Task 1.4, Task 4.1, Task 4.2
  - Acceptance: live default+production `files` count is 0; `analyze:full` exits 0

### Phase 5: Exports and types

- [x] **Task 5.1**: Unexport unused **internal** symbols in `scripts/` and examples
  - Delivers: after tests are in the graph, remaining unused exports/types in `scripts/`, `example-frontend/`, `example-backend/`, `demo/` that are not a public package entry become non-exported (or deleted if the whole helper is dead)
  - Files: modules named by live `exports` / `types` findings in those trees
  - Blocked by: Task 1.1, Task 4.1, Task 4.2
  - Acceptance: those packages have no unused **internal** export/type findings; tests that imported the symbol still compile (they use the same module, not the export); `analyze:full` exits 0

- [x] **Task 5.2**: Unexport unused **internal** symbols in published packages
  - Delivers: same as 5.1 for `api`, `admin-frontend`, `comms`, `syncdb`, `mcp-server`, `ai`. Do **not** remove re-exports from `src/index.ts(x)`
  - Files: internal modules named by live findings
  - Blocked by: Task 1.2
  - Docs: none unless a documented “internal helper” was publicized in explanation/reference — then update that page
  - Skills: `update-docs`
  - Acceptance: each remaining unused export/type is classified public (re-exported from the package entry) or is gone; package `bun test` / `compile` passes; `analyze:full` exits 0

- [x] **Task 5.3**: Ignore leftover **public** unused exports and types
  - Delivers: `ignoreIssues` (path-scoped `exports`/`types`) for public API unused inside this monorepo, with comments
  - Files: `knip.jsonc`, `docs/explanation/static-analysis.md` (public API ignore rule)
  - Blocked by: Task 5.1, Task 5.2
  - Docs: `docs/explanation/static-analysis.md`
  - Skills: `update-docs`
  - Acceptance: live `exports` and `types` counts are 0; no public `index` export removed; `analyze:full` exits 0

### Phase 6: Remove baseline

- [x] **Task 6.1**: Delete the Knip baseline and enforce zero findings directly
  - Delivers: live default+production fingerprint set is `[]`; no Knip baseline exists; docs state that new findings are fixed or added to `knip.jsonc` with a reason
  - Files: delete `scripts/static-analysis/knip-baseline.json`; update `docs/explanation/static-analysis.md`, `scripts/static-analysis/full.ts`, and tests
  - Blocked by: Task 2.1, Task 2.2, Task 2.3, Task 3.2, Task 4.3, Task 5.3
  - Docs: `docs/explanation/static-analysis.md`
  - Skills: `update-docs`
  - Acceptance: `test ! -e scripts/static-analysis/knip-baseline.json`; `bun run check:knip` prints no findings and exits 0; `bun run analyze:full` exits 0; static-analysis tests pass
