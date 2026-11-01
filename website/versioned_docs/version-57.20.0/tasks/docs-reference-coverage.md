# Task List: Reference Documentation Coverage

See: [`docs/implementationPlans/docs-reference-coverage.md`](../implementationPlans/docs-reference-coverage.md)

**RTK deprecation flag:** **Blocked.** Do not start until PR #869 merges. `docs/reference/syncdb.md` is owned by [`rtk-to-syncdb-migration-docs`](rtk-to-syncdb-migration-docs.md) — do not write it here. Tasks below marked `[RTK]` reference the frontend data layer.

## Instructions for the implementing agent

- **Do not write documentation from scratch.** The content already exists in `.cursor/rules/*/00-*.mdc` files. Your job is to convert prescriptive agent rules into descriptive public reference prose, verify every claim against source, and remove anything internal.
- Verify every exported symbol you document by grepping the package's `src/index.ts`. If a rule file documents something that no longer exists, drop it and note the drift in the PR body.
- READMEs are rendered on npmjs.com where relative links break. Use absolute `https://github.com/TerrenoLabs/terreno/...` or docs-site URLs in every README.
- Match the section ordering of `docs/reference/api.md` for new reference pages. Read it first.
- Run `bun run website:build` before each commit that adds or moves a docs page.

## Phase 1: Missing reference pages

- [x] **Task 1.1**: Write `docs/reference/ai.md`
  - Description: Convert `.cursor/rules/ai/00-ai.mdc` into a public reference page. Sections, following `docs/reference/api.md`'s shape: Install; Commands; Architecture (file structure); `AIService` setup and full method table; structured-output helpers (`generateJsonValue`, `generateJsonObject`, `generateJsonArray`) including the JSON-normalization behavior and error logging; temperature presets; the `AIRequest` and `GptHistory` models with field tables; route registrars (`addGptRoutes`, `addGptHistoryRoutes`, `addAiRequestsExplorerRoutes`) with endpoints, methods, and permissions; Langfuse integration; integration example with `setupServer`/`TerrenoApp`; environment variables; conventions; testing (including the mock-model pattern). Verify every symbol against `ai/src/index.ts`. Remove the internal-only conventions that make no sense to a consumer (for example instructions about not mocking `@terreno/api` belong in agent rules, not reference docs — use judgment).
  - Files: `docs/reference/ai.md` (new)
  - Depends on: none
  - Acceptance: every documented symbol appears in `ai/src/index.ts`; the method table lists all `AIService` methods; all three route registrars documented with their permissions; no `.claude/` or `.cursor/` path referenced.

- [x] **Task 1.2**: Write `docs/reference/admin-spa.md`
  - Description: New reference page for `@terreno/admin-spa`, sourced from `admin-spa/README.md` and `admin-spa/src/`. Cover: what the package is (standalone Expo Router web admin SPA plus an Express plugin that serves it), install, the `AdminSpaServeApp` plugin registration with its options, building the SPA, configuring `apiBase`/`routeBase`, how it relates to the embedded `@terreno/admin-frontend` approach and when to choose each, and environment variables. Verify the plugin options against the source and against how `example-backend/src/server.ts` registers it.
  - Files: `docs/reference/admin-spa.md` (new)
  - Depends on: none
  - Acceptance: every option documented exists in the source; includes a "standalone SPA vs embedded screens" decision paragraph; the registration example matches `example-backend/src/server.ts`.

- [x] **Task 1.3**: Write `docs/reference/test.md`
  - Description: New reference page for `@terreno/test`. Cover: what it provides (in-memory MongoDB management for bun test suites), install as a dev dependency, the `bunfig.toml` preload pattern, `setupEnvironment()`, the `TERRENO_TEST_USE_MEMORY_MONGO` / `TERRENO_TEST_MONGODB_URI` / `BUN_TEST_DISABLE_DB` environment variables, and the test-helper exports. Source the preload contract from `admin-backend/AGENTS.md`, `api/src/tests/bunSetup.ts`, and the `backend-test-env` skill. Keep it short — one page.
  - Files: `docs/reference/test.md` (new)
  - Depends on: none
  - Acceptance: all three environment variables documented with their effects; the preload example matches an actual `bunfig.toml` in the repo; under 150 lines.

- [x] **Task 1.4**: `[RTK]` Fix the reference index
  - Description: Update `docs/reference/README.md` to list every reference page that exists, including `ai.md`, `admin-spa.md`, `test.md`, `api-health.md`, `feature-flags.md`, `environment-variables.md`, and `syncdb.md`, with `rtk.md` under a Legacy heading. Cross-check against `ls docs/reference/` so nothing is orphaned and nothing listed is missing.
  - Files: `docs/reference/README.md`
  - Depends on: Task 1.1, Task 1.2, Task 1.3
  - Acceptance: `ls docs/reference/*.md` and the index agree exactly; every link resolves; `bun run website:build` reports no new broken links.

## Phase 2: Package READMEs

- [x] **Task 2.1**: Define and apply the README template to the four stubs
  - Description: Write the six-section template from the IP (Title/description, Install, Quick start, What's included, Documentation, License/Contributing) and apply it to the four stub READMEs: `ai/README.md` (source: the new `docs/reference/ai.md`), `admin-backend/README.md` (source: `.cursor/rules/admin-backend/00-admin-backend.mdc` + `docs/reference/admin-backend.md`), `admin-frontend/README.md` (same pattern), `api-health/README.md` (source: `api-health/src/`). Each Quick start must be a complete, runnable snippet — not a fragment. Every link absolute.
  - Files: `ai/README.md`, `admin-backend/README.md`, `admin-frontend/README.md`, `api-health/README.md`
  - Depends on: Task 1.1
  - Acceptance: all four follow the six sections in order; `rg -n "\.claude/|\.cursor/" ai/README.md admin-backend/README.md admin-frontend/README.md api-health/README.md` returns nothing; every relative link replaced with an absolute URL; each Quick start compiles if pasted into a matching file.

- [x] **Task 2.2**: Add the missing READMEs
  - Description: Create `feature-flags/README.md` (source: `docs/reference/feature-flags.md`; cover `FeatureFlagsApp` registration, the `/flagConfiguration` endpoint, `liveUpdates` and its replica-set requirement, and the deprecated `/evaluate` endpoint), `test/README.md` (source: the new `docs/reference/test.md`), `demo/README.md` (how to run the component demo on port 8085, how stories are organized under `stories/`, how to add a story and register it in `demoConfig.tsx`, and the demo-vs-dev mode split), and `website/README.md` (how to run the docs site locally, where content comes from — `../docs` — how versioning works, and how deploys happen via Netlify).
  - Files: `feature-flags/README.md`, `test/README.md`, `demo/README.md`, `website/README.md` (all new)
  - Depends on: Task 1.3
  - Acceptance: every command shown exists in the corresponding `package.json` scripts or the root `package.json`; `demo/README.md` correctly names port 8085; `website/README.md` correctly states that docs content lives in `../docs`.

- [x] **Task 2.3**: Normalize the four good READMEs
  - Description: Apply the template's link discipline (not a rewrite) to `api/README.md`, `ui/README.md`, `mcp-server/README.md`, and `admin-spa/README.md`: convert relative repo links to absolute URLs, add the Documentation / License / Contributing sections if missing, and ensure the description line matches the standardized `package.json` description. Additionally, reconcile `mcp-server/README.md`'s tool list with `docs/reference/mcp-server.md` and the live hosted server — the README is known to omit `terreno_search_docs`, `terreno_get_component_docs`, and `terreno_get_upgrade_guide`.
  - Files: `api/README.md`, `ui/README.md`, `mcp-server/README.md`, `admin-spa/README.md`
  - Depends on: Task 2.1
  - Acceptance: no relative link escapes the package directory in any of the four; `mcp-server/README.md` and `docs/reference/mcp-server.md` list identical tool sets; each README's opening line matches its `package.json` description.

- [x] **Task 2.4**: Add `docs/tasks/README.md`
  - Description: Create a short README in `docs/tasks/` explaining that files there are structured task breakdowns for automated implementation of the IPs in `docs/implementationPlans/`, that they are internal planning artifacts rather than user documentation, and that they are excluded from the docs site. Do the same check for `docs/implementationPlans/README.md` — it exists; verify it says something similar and update if not.
  - Files: `docs/tasks/README.md` (new), `docs/implementationPlans/README.md`
  - Depends on: none
  - Acceptance: `docs/tasks/README.md` exists and states the directory's purpose in under 15 lines; both directories are confirmed excluded in `website/docusaurus.config.ts`.

## Phase 3: Sanitization

- [x] **Task 3.1**: Sweep public docs for internal leakage
  - Description: Run `rg -ni "flourish|a\.run\.app|netlify\.app|PRO-[0-9]|FH-[0-9]|slack|\.claude/|\.cursor/" docs/ */README.md README.md` excluding `infra/flourish/` and `docs/implementationPlans/`. For each hit decide: remove, replace with a placeholder, or relocate to `infra/flourish/`. Live example URLs (the Netlify frontend, the Cloud Run backend) may stay in a clearly-labeled "Live examples" list but must not appear in instructional steps as if the reader owns them. Record the total number of fixes in the PR body.
  - Files: various under `docs/` and package READMEs
  - Depends on: Task 2.3
  - Acceptance: the grep returns only permitted hits (live-example URLs in labeled lists, and `docs/implementationPlans/` planning content); the PR body reports the count and lists each judgment call.

- [x] **Task 3.2**: Fix the how-to index and stale "Coming Soon" entries
  - Description: `docs/how-to/README.md` lists feature flags under "Coming Soon" even though `docs/how-to/add-feature-flags.md` exists. Audit the whole index against `ls docs/how-to/*.md`, remove stale "Coming Soon" markers for anything that shipped, and add entries for guides that exist but are unlisted. Do the same audit for `docs/explanation/` and `docs/tutorials/` indexes if they exist.
  - Files: `docs/how-to/README.md`, `docs/explanation/README.md` and `docs/tutorials/README.md` if present
  - Depends on: none
  - Acceptance: every `.md` file in each directory appears in its index exactly once; no "Coming Soon" marker refers to a file that exists.

## Phase 4: Drift protection

- [x] **Task 4.1**: Extend the docs-audit check
  - Description: Update `.rulesync/skills/docs-audit/SKILL.md` and the script it drives (find it via `.github/workflows/docs-audit.yml`) to add two checks: (1) every package published by `publish-on-tag.yml` has a non-stub `README.md` (heuristic: at least 30 lines and containing an `## Install` heading) and a `docs/reference/<pkg>.md` page; (2) no file under `docs/` or any published package README matches the internal-leakage pattern from Task 3.1. Make both failures fatal in CI. Regenerate skill mirrors with `bun run rules`.
  - Files: `.rulesync/skills/docs-audit/SKILL.md`, the docs-audit script, `.github/workflows/docs-audit.yml`, generated mirrors
  - Depends on: Task 3.1
  - Acceptance: deleting `feature-flags/README.md` makes the audit fail with a message naming the package; adding the string `flourish-terreno` to a docs page makes it fail; `bun run rules:check` exits 0.

- [x] **Task 4.2**: Document the reference/rule duplication policy
  - Description: Add a short section to `docs/explanation/ai-workflows.md` (or `CONTRIBUTING.md` if that reads better) explaining the deliberate split from IP question RF2: `docs/reference/` is descriptive documentation for humans, `.rulesync/rules/` is prescriptive guidance for agents, both are maintained, and a change to a package's public API requires updating both. Note that the docs-audit workflow flags drift but cannot fully verify it.
  - Files: `docs/explanation/ai-workflows.md` or `CONTRIBUTING.md`
  - Depends on: Task 4.1
  - Acceptance: the policy states which file type serves which reader and that both must be updated on public API changes.
