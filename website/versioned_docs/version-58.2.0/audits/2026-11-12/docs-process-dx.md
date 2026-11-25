# Terreno audit: documentation, process/automation, engineering productivity (DX)

Scope: read-only audit of `/workspace` at `6cf1f06c` (58.0.4). Lens: best-in-class open source DX for (a) an outside developer or their agent who wants a running app, (b) a first-time outside contributor. Severity S0–S3 and effort (hours/days/weeks) follow the audit skills' scales. Everything is verified against files unless marked SUSPECTED. The scaffold was generated for real (`node create-terreno-app/dist/cli.js my-app --yes`, 55 files, 0.2 s); nothing was installed or booted.

## Zero to running app today

Path walked: README Quickstart → `docs/tutorials/getting-started.md` → `docs/how-to/create-a-terreno-app.md`.

**Count: 3 prerequisites, 10 commands, 3 long-running processes, 1 command that fails as written.**

| # | Step | Blocker |
| --- | --- | --- |
| P1 | Install Bun | Tutorial says "Bun installed"; the required version (1.4.4+) appears only in `CONTRIBUTING.md:21`. No `packageManager` field in root `package.json`. |
| P2 | Install a `mongod` binary | Never explained. Docs say "after `mongod` is available" (`docs/how-to/create-a-terreno-app.md:96`). No Docker Compose file, no Atlas walkthrough, no bundled dev database. |
| P3 | Node | Needed for the replica-set init one-liner; not listed as a prerequisite. |
| 1 | `bunx create-terreno-app my-app --display-name "My App"` | Works. Writes files only (`create-a-terreno-app.md:5`). |
| 2–3 | `bun install` in `backend/`, then in `frontend/` | Two installs; the scaffold has no root `package.json`. |
| 4–5 | `mkdir -p .devdata/mongo`; `mongod --replSet rs0 … &` | Manual, backgrounded in the user's shell. |
| 6 | `node -e 'import("mongodb")…replSetInitiate…'` | **Fails as documented.** The doc says to run it "from the generated app root" (`create-a-terreno-app.md:96-102`), but `mongodb` is only in `backend/node_modules`. Reproduced the resolution failure (`ERR_MODULE_NOT_FOUND` from the root, fine from `backend/`). |
| 7 | `(cd backend && bun run seed)` | Works once Mongo is up. |
| 8 | `(cd backend && bun run dev)` | Terminal 1. |
| 9 | `(cd frontend && bun run sdk)` | Needs the backend running. |
| 10 | `(cd frontend && bun run web)` | Terminal 2. Then open `http://localhost:8082` and log in. |

What the user has at the end: login, profile, admin. No domain model, no synced collection (`SYNC_COLLECTIONS: string[] = []`), no todo. The scaffold is an authenticated shell.

Adding one synced model end to end after that: about 11 touches. Types file, two type barrels, model file, model barrel, route file, register in `server.ts`, add `syncPlugin` and a `sync` config (the scaffold's `addDefaultPlugins` omits `syncPlugin`), add a `sync-sdk` script to `frontend/package.json` (the scaffold does not ship one), add the name to `SYNC_COLLECTIONS`, run two codegens against a running backend, write the screen. `terreno generate model|route|screen` exists in `cli/` but the scaffold neither depends on `@terreno/cli` nor mentions it.

Contributor path (monorepo example app): clone → `bun run bootstrap` → find a `mongod` → start it → init the replica set → pass five env vars inline → seed → backend → frontend. 9 steps. The Mongo instructions live in the "Cursor Cloud" section of `AGENTS.md`, which assumes a `mongod` left in `~/.cache/mongodb-binaries` by an earlier test run.

## Findings (ranked by impact)

### 1. No one-command local stack; MongoDB replica set is a manual, partly broken prerequisite — S1
- **Evidence:** `docs/how-to/create-a-terreno-app.md:5,96-102` (manual `mongod`, init command fails from the documented directory); `docs/tutorials/getting-started.md:8,77` (contributors sent to the AGENTS.md Cursor Cloud section); no compose file, devcontainer, or `dev` script (`git ls-files` shows only `example-*/.env.example`). `test/src/mongo/mongoServer.ts` already starts an in-memory replica set for tests, so the machinery exists.
- **Persona:** both; this is the largest drop-off point for (a).
- **Change:** ship a `dev` command in the scaffold (root `package.json` with `bun run dev`) that starts a `mongodb-memory-server` replica set with a persistent `dbPath` when `MONGO_URI` is unset or unreachable, seeds on first run, then starts backend and web together. Add the same as `bun run dev` at the monorepo root. Offer a `docker-compose.yml` as the alternative. Have `create-terreno-app` run install by default (`--no-install` to skip). Target: 2 commands, 1 terminal, Bun as the only prerequisite.
- **Effort:** 3–5 days.

### 2. Agent rules and package README teach APIs that no longer exist — S1
- **Evidence:** `setupServer` was removed in #795 (`CHANGELOG.md:2356`; no export in `api/src/expressServer.ts`), yet it is a "key import" in `AGENTS.md:200,270,278` / `CLAUDE.md` / `.rulesync/rules/00-root.md`, appears 15 times in `.rulesync/rules/api/00-api.md` (lines 96-120, 578-646), in `api/README.md:132-160` (the npm page), and `docs/reference/api.md:27,206-213`. Also in `AGENTS.md`: `modelRouterOptions` (line 291, no such export), `Model.findOneOrThrow` (348, plugins are `findExactlyOne`/`findOneOrNone`), `src/modelInterfaces.ts` (350, example-backend uses `src/types/`), Modal `onPrimaryAction` (418, real prop is `primaryButtonOnClick`, `ui/src/Common.ts:2828`). The same file shows two incompatible `modelRouter` call shapes with no explanation.
- **Persona:** (a), especially agents: Terreno's pitch is "AI-native", and the first file an agent reads produces code that does not compile.
- **Change:** fix the five items in `.rulesync/rules/` and `api/README.md`, delete the "setupServer (Legacy)" sections. Then add a CI check that typechecks fenced `ts` blocks in rules, READMEs and reference docs against the compiled packages (or at least verifies every named import from `@terreno/*` exists in `dist/index.d.ts`).
- **Effort:** 3 hours for the fixes; 2 days for the check.

### 3. `@terreno/cli` is stuck at 57.3.0 while the other 16 packages are at 58.0.4 — S1
- **Evidence:** `cli/package.json` version `57.3.0`; release commit `6cf1f06c` bumps 16 packages and not `cli`. `publish-on-tag.yml:1700-1730` only bumps a package when its publish job succeeded, so `publish-cli` has not succeeded since 57.3.0 (cause SUSPECTED; registry was unreachable from the sandbox). Separate verified bug in the same job: the `workspace:*` rewrite at `publish-on-tag.yml:~1585` only handles keys starting with `@terreno/`, so `cli`'s `"create-terreno-app": "workspace:*"` would be published unresolved. `cli/` has no README, is missing from the root README package list, and `docs/reference/cli.md:3` tells users to `bun add -g @terreno/cli`.
- **Persona:** (a).
- **Change:** read the last tag run's `publish-cli` log, fix the cause, extend the rewrite to any `workspace:*` key, add `cli/README.md`, and make the release fail (not silently skip) when any lockstep package does not publish.
- **Effort:** 1 day.

### 4. The scaffold does not demonstrate Terreno's core loop and contradicts the framework's own rules — S1
- **Evidence (generated app):** no domain model; `frontend/store/syncdb.ts:13` `SYNC_COLLECTIONS = []`; no `sync-sdk` script in `frontend/package.json` although the root rules make it step 3 of the integration flow; `backend/src/models/modelPlugins.ts` omits `syncPlugin`; scaffold `CLAUDE.md` "Adding Features" lists model → route → register → `bun run sdk` → screen and never mentions sync. Barrel files `models/index.ts`, `types/index.ts` ship despite the no-barrel rule; `function` and `as any` ship despite source rules. Dependency drift: `@types/express ^4.17.21` (`create-terreno-app/src/generate.ts:382`) against Express 5; `better-auth ^1.6.25` against the catalog's pinned 1.7.7.
- **Persona:** (a).
- **Change:** ship one synced example model (`Todo`) wired end to end, including the `sync-sdk` script and a list screen using `useQuery`/`useMutate`; add `--minimal` for the bare shell. Add `@terreno/cli` as a dev dependency and document `terreno generate model` in the scaffold README and CLAUDE.md. Derive scaffold dependency versions from the root catalog at build time. Run the monorepo's lint policies over the generated app in `create-terreno-app-ci`.
- **Effort:** 3–4 days.

### 5. Internal company and private-infra references in public files — S2
- **Evidence:** `AGENTS.md:550` (`/agent/repos/flourish/scripts/install-cloud-dev-tools.sh`), `AGENTS.md:604-605` (`GCP_SA_PRD` "flourish production", `GCP_SA_STG`, `GCP_SA_ZAPLING`), `AGENTS.md:609-613` (internal Sentry and CircleCI token names), `AGENTS.md:620` (the "gitsight" app). `README.md:203` and `docs/how-to/set-up-terreno-mcp.md:133-152` (`mcp.terreno.flourish.health`). `CONTRIBUTING.md:178-184` (Zoom Chat webhook, `infra/flourish/`). `.github/workflows/cd.yml:26-34` (project `flourish-terreno`, service-account emails). `publish-on-tag.yml:1695` (personal email as committer). `docs/reference/ui.md:68` ("Flourish Health light mode" as the default theme). 291 tracked files mention "flourish". No secret values found; these are names and hostnames.
- **Persona:** both. It reads as a company's internal repo, and every contributor's agent loads instructions for infrastructure they cannot reach.
- **Change:** move the "Cursor Cloud specific instructions" section into an untracked, maintainer-only rule; rename `infra/flourish` to `infra/terreno-hosted` and label it "maintainers only"; drop the `flourish.health` MCP fallback once `mcp.terreno.app` resolves; use a bot identity for release commits; rename the default theme.
- **Effort:** 1–2 days.

### 6. The repo is dominated by generated and archival files — S2
- **Evidence:** 12,096 tracked files; 6,677 (55%, 25 MB) are `website/versioned_docs/` snapshots of four versions. 90 generated agent-instruction files (AGENTS.md per package, `.cursor`, `.devin`, `.claude/rules`, `.github/instructions`) and about 350 `SKILL.md` copies across `skills/`, `.rulesync/skills`, `.claude`, `.cursor`, `.devin`, `.agents`, `.github`, and four `plugins/*` trees. `CLAUDE.local.md` is tracked and is a shorter, staler copy of `CLAUDE.md` ("`bun run test` — Run tests in api and ui"). 210 internal planning files under `docs/implementationPlans`, `docs/tasks`, `docs/plans`, `docs/superpowers`. Stale text is multiplied: `modelInterfaces` appears in 20+ generated files.
- **Persona:** both. `grep` and agent search return each hit 5–10 times; clones and PR diffs are noisy; a rules edit forces a regenerate-and-commit cycle on contributors.
- **Change:** build versioned docs from git tags at deploy time instead of committing them; commit only `.rulesync/` plus `AGENTS.md`, and generate tool-specific copies on `bun install` (`prepare`) or publish them from CI; stop tracking `CLAUDE.local.md`; move planning history to a `docs/internal/` tree excluded from search and the site.
- **Effort:** 1–2 weeks.

### 7. Misconfiguration errors do not tell the user what to do — S2
- **Evidence:** a standalone `mongod` (what `example-backend/README.md:33` tells users to run: `docker run -d -p 27017:27017 mongo`) combined with the default `?replicaSet=rs0` URI ends in a generic `MongoDB connection error: …` after driver server selection times out (`example-backend/src/utils/database.ts:17-34`, same code in the scaffold) — timing SUSPECTED, not run. `api/src/realtime/changeStreamWatcher.ts:671-686` logs the raw driver error and schedules restarts with no hint. `feature-flags/src/featureFlagsApp.ts:244` shows the right pattern ("live updates require MongoDB as a replica set (even single-node)"). Env errors are short but clear (`api/src/expressServer.ts:116-122`: "TOKEN_SECRET must be set."), and surface one at a time.
- **Persona:** (a).
- **Change:** add a startup preflight in `TerrenoApp` that checks all required env at once and runs `hello` to detect a non-replica-set server, then prints one message with the fix command and a docs link. Fix `example-backend/README.md:33`.
- **Effort:** 1–2 days.

### 8. Removed `@terreno/rtk` is still documented as current in live docs — S2
- **Evidence:** `docs/reference/ui.md:2243-2255` ("`@terreno/rtk` ships the connected version… `import {useAuthMethods} from "@terreno/rtk"`"; it now lives in `syncdb/src/auth/`); `docs/how-to/vercel-function-websockets.md:55,77`; `docs/testing/e2e/rtk.md` (whole page, `rtk/` no longer exists) and `docs/testing/e2e.md:226`; `docs/reference/api.md:2085`; `docs/reference/environment-variables.md:111`; `CHANGELOG.md:5` lists `rtk` in the lockstep set and line 17 calls 58.0.0 "the next major".
- **Persona:** (a).
- **Change:** fix the six places; add a docs lint that fails on `@terreno/rtk` outside `legacy/`, `migrate-rtk-to-syncdb.md`, upgrade notes and the changelog body.
- **Effort:** 3 hours.

### 9. Version, support and package-list statements disagree — S2
- **Evidence:** `SECURITY.md:10-12` supports "0.30.x (current minor)"; current is 58.0.4. `README.md:213` references a "0.30.0 upgrade note". `docs/explanation/versioning-policy.md` has a "Pre-1.0" section stating minors may break, while `CHANGELOG.md:12` claims Semantic Versioning. Four different lockstep package lists: `README.md` (15, no `cli`/`announcements`), `CHANGELOG.md:5` (includes `rtk`), `versioning-policy.md` (13, no `jobs`/`announcements`/`create-terreno-app`/`cli`), `AGENTS.md` (14 directories, no `ai`/`api-health`/`feature-flags`/`test`/`create-terreno-app`). `ROADMAP.md` lists the shipped RTK removal under "Target: 58 … Planned".
- **Persona:** both; a security reporter or an upgrader cannot tell what is supported.
- **Change:** generate the package list from workspace manifests into all four files; rewrite SECURITY.md as "current major and previous major"; state one rule ("major = Expo SDK; minors may break only with an upgrade note") and stop citing SemVer.
- **Effort:** 4 hours.

### 10. One tutorial, and the model how-to stops before sync — S2
- **Evidence:** `docs/tutorials/` holds only `getting-started.md` against 71 how-to guides. `docs/how-to/create-a-model.md` ends at REST routes: no `syncPlugin`, no `sync` config, no SDK regeneration, no frontend hook. It mounts routes with `router.use("/todos", modelRouter(Todo, …))`, while the root rules teach `modelRouter("/todos", Todo, …)` and ban `router.*`. Its "good example" uses `Date` and `Date.now`, which source rules ban.
- **Persona:** (a).
- **Change:** write "Build a todo app in 15 minutes" (model → synced collection → screen → admin → deploy), executed in CI by the existing `build-terreno-app` harness. Bring `create-a-model.md` in line with the path-first signature and extend it through the frontend hook.
- **Effort:** 2–3 days.

### 11. Contributor on-ramp is written for the maintainer's cloud agents — S2
- **Evidence:** `CONTRIBUTING.md:38-42` passes five env vars inline although `example-backend/.env.example` exists and Bun loads `.env`. Mongo setup is delegated to the AGENTS.md "Cloud VM" section (`CONTRIBUTING.md:64`). `bun run prepush` (the best local tool in the repo) is absent from the "Common commands" table. `CONTRIBUTING.md:134` cites `bun run api:dev`, which is not a root script (`ui:dev` and `syncdb:dev` are). Line 188 says "rulesync 17"; `package.json:142` has `^43.8.0`. Line 252 points DCO enforcement at `.github/workflows/dco.yml`, which is disabled. `AGENTS.md:491-534` imposes a "Short Attention Span (always on)" output style on every contributor's agent.
- **Persona:** (b).
- **Change:** rewrite "Development setup" as `bun run bootstrap` → `cp example-backend/.env.example example-backend/.env` → `bun run dev` (finding 1) → `bun run prepush` before pushing. Fix the four stale facts. Move the output-style section to a maintainer-local rule.
- **Effort:** 4 hours (after finding 1).

### 12. Fork pull requests: gates are heavy and CI behaviour for outsiders is unclear — S2
- **Evidence:** a small fix must satisfy a changelog fragment, DCO sign-off, 95% package coverage plus a 90% new-file gate, zero knip findings, rulesync drift, skills sync and CircleCI parity (`bun run prepush --all --dry-run` lists 45+ steps). The CircleCI `dco` job halts when `GITHUB_TOKEN` is absent (`.circleci/continue-config.yml:1548-1553`), and `docs/how-to/circleci.md:208` states CircleCI withholds contexts on fork PRs, so DCO is likely skipped on exactly the PRs it targets (SUSPECTED; depends on project settings). Building fork PRs at all is an optional setting (`circleci.md:33`). A `good first issue` label exists (`.github/labels.yml:73`) but CONTRIBUTING never mentions it.
- **Persona:** (b).
- **Change:** confirm fork PRs get the secret-free jobs (lint, typecheck, unit tests) and document it; use the GitHub DCO app instead of a token-gated job; let maintainers add the changelog fragment for first-time contributors; add a "first PR" section naming the three commands that matter.
- **Effort:** 1–2 days.

### 13. Release and CI configuration carries heavy duplication — S3
- **Evidence:** `publish-on-tag.yml` is 2,060 lines with 18 near-identical publish jobs, each inlining the same catalog/workspace rewrite script. 34 of 53 GitHub workflows (4,660 lines) are disabled "retained for rollback" twins of CircleCI jobs, last touched 2026-09-22, with a `check:circleci-parity` script to keep them aligned. `.circleci/continue-config.yml` is 3,219 lines. Four `*.lock.yml` agent workflows add 4,687 generated lines.
- **Persona:** (b) and maintainers; nobody can tell which CI is authoritative from the file listing.
- **Change:** collapse the publish jobs into one matrix job calling a shared script (this also fixes finding 3's rewrite bug in one place); delete the disabled twins (git history is the rollback); add a short `.github/workflows/README.md` saying CircleCI runs CI and GitHub Actions runs release, CodeQL and bots.
- **Effort:** 2–3 days.

### 14. Published package metadata gaps — S3
- **Evidence:** every `repository.url` is `git+ssh://git@github.com/…` with no `directory` field, so npm cannot link to the package folder. `syncdb/` has no `LICENSE` file while the other 16 do. `ai`, `comms`, `feature-flags`, `announcements` have no `files` allowlist. `admin-backend`, `admin-frontend`, `api-health`, `feature-flags`, `announcements` have no `exports` map. Only `cli` and `mcp-server` declare `engines`. README, docs and the live examples use `*.netlify.app` hostnames although `terreno.app` is owned.
- **Persona:** (a).
- **Change:** normalise manifests with a script (https URL plus `directory`, `files`, `exports`, `engines.bun`); extend `check:licenses` to cover `syncdb`; move docs to `docs.terreno.app`.
- **Effort:** 1 day.

### 15. Agent stop hook runs repository-wide lint and typecheck on every stop — S3
- **Evidence:** `.rulesync/hooks.json` registers `.rulesync/hooks/quality-check.sh` as a stop hook with a 300 s timeout for seven agent hosts; it runs lint, typecheck and full static analysis. The per-edit hook is cheap (`bun run analyze:fast` measured at 2.7 s). Root `lint` chains into `typecheck`, which needs `compile` first (`docs/how-to/run-tests-locally.md:40`); the "run compile first" note is in AGENTS.md but not in CONTRIBUTING's command table.
- **Persona:** (b) using an agent; a docs-only question costs minutes at stop. Cold-run duration not measured.
- **Change:** scope the stop hook to packages with changed files and skip it when the working tree is clean; have `typecheck` fail fast with "run `bun run compile`" when `dist` is missing.
- **Effort:** 1 day.

## Strengths to preserve

1. **`bun run prepush`**: path-aware local mirror of CI with `--dry-run` and `--all`, plans in about 3 s, and a test that fails when CI gains a job it does not cover.
2. **Unit tests need no private services**: package suites use in-memory Mongo from `@terreno/test`; `bun run test:agent` suppresses passing output.
3. **Docs structure and link health**: Diátaxis layout, 71 how-to guides, per-package reference and e2e pages; 1,188 relative links checked across 213 files with 3 broken. Upgrade notes per version, a breaking-change gate (`check:upgrade-docs`), and changelog fragments that avoid merge conflicts.
4. **OSS governance files are all present**: MIT LICENSE plus NOTICE, CONTRIBUTING, Code of Conduct, SECURITY with private reporting, issue forms, discussion templates, PR template, CODEOWNERS, generated ROADMAP, badges.
5. **Scaffold quality where it exists**: `create-terreno-app` is non-interactive and instant, writes working `.env` defaults, Dockerfile, CI and MCP config, and is exercised weekly and on every tag by `bootstrap-app-check.yml`. The `terreno` CLI and the two MCP servers (hosted docs, local logs/state/db) are real differentiators.

## Not covered

- Nothing was installed, booted or built: the scaffolded app, the docs site build, `bun run test`, and `smoke:local` were not run. Wall-clock for bootstrap, compile, lint and the stop hook is unmeasured.
- npm registry and hosted sites were unreachable from the sandbox: published versions, npm page rendering, `terreno-docs.netlify.app`, `mcp.terreno.app`, and GitHub repo settings (branch protection, Discussions, fork-PR CI) are unverified.
- CI flakiness and duration: no CircleCI run history was pulled.
- Reference completeness per public export (only root-rule imports and about 45 named exports were spot-checked), TypeDoc coverage, and the content of the 74 skills.
- Native (iOS/Android) first-run path, EAS, and deployment guides (GCP, Vercel).
- Architecture, security, performance, feature gaps and UI component UX belong to the other auditors.
