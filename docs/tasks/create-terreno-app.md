# Tasks: create-terreno-app scaffolding CLI

Plan: [`docs/implementationPlans/create-terreno-app.md`](../implementationPlans/create-terreno-app.md)

**Status:** Approved — all in-scope tasks Roast PASS. **next: brew**.  
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1174

## Instructions for the implementing agent

- Load `update-docs`. Generator/CLI tests use Bun `expect` in `create-terreno-app/` and `mcp-server/`.
- TDD: failing test first per task. Public seam is the CLI bin / `generateAllFiles` / `handleBootstrapToolCall`, not private string helpers.
- Do not clone `example-*`. Do not copy `example-backend/Dockerfile`. Do not add prompts or `bun install` to the CLI.
- Hosted MCP must never write disk. Local write requires `TERRENO_MCP_WRITE_SCAFFOLD=1`.
- After moving generators, `mcp-server` tests for dump shape must stay green.

---

### Phase 1: Shared generator

- [x] **Task 1.1**: Workspace package + extracted `generateAllFiles`
  - Delivers: `create-terreno-app` workspace package exports `generateAllFiles`; generated `@terreno/*` versions are `^` + this package’s `version`; `mcp-server` imports the export instead of inlining generators
  - Files: `create-terreno-app/package.json`, `create-terreno-app/src/generate.ts` (and helpers split as needed), `create-terreno-app/src/__tests__/generate.test.ts`, `mcp-server/src/bootstrap.ts`, `mcp-server/package.json`, root `package.json` workspaces
  - Blocked by: none
  - Docs: none (package README stub only)
  - Skills: `update-docs`
  - Acceptance: `generateAllFiles({appName, appDisplayName})` returns the previous file set (backend, frontend, CI, MCP, seed); every `@terreno/*` range is `^<package.json version>`; `bun test` in `create-terreno-app` and `mcp-server` dump tests pass; no `"latest"` for `@terreno/*`

---

### Phase 2: CLI writer

- [x] **Task 2.1**: `create-terreno-app` bin writes an empty target
  - Delivers: `bunx create-terreno-app my-app --display-name "My App"` (cwd or explicit parent) writes files via `writeScaffold`; `--yes` derives display name; missing names or non-empty target (anything except `.git` / `.gitignore`) exits non-zero without writing app files; does not run install/seed
  - Files: `create-terreno-app/src/cli.ts`, `create-terreno-app/src/writeScaffold.ts`, `create-terreno-app/src/__tests__/cli.test.ts`, `create-terreno-app/package.json` `bin`
  - Blocked by: Task 1.1
  - Docs: `create-terreno-app/README.md` (command table)
  - Skills: `update-docs`
  - Acceptance: temp-dir test writes `backend/package.json` and `frontend/package.json`; stdout includes next-step commands; dirty-dir test leaves the tree unchanged and non-zero; `--yes` without `--display-name` succeeds

---

### Phase 3: Deployable scaffold

- [x] **Task 3.1**: Consumer Dockerfile, env examples, README deploy section
  - Delivers: generator adds a consumer backend `Dockerfile` (`oven/bun`, `PORT`, `0.0.0.0`, `/health`), `backend/.env.example` + `frontend/.env.example`, keeps local `.env` defaults, README links [deployment baseline](../explanation/deployment-baseline.md), [deploy backend to Cloud Run](../how-to/deploy-backend-to-cloud-run.md), [build for web](../how-to/build-for-web.md)
  - Files: generator helpers in `create-terreno-app/src/`, `create-terreno-app/src/__tests__/generate.test.ts`
  - Blocked by: Task 1.1
  - Docs: generated README in the scaffold (not repo docs yet)
  - Skills: `update-docs`
  - Acceptance: file list includes `Dockerfile` and both `.env.example` files; Dockerfile does not `COPY` Terreno monorepo packages or `example-backend`; README contains those three doc paths or their published URLs

---

### Phase 4: MCP delegate

- [ ] **Task 4.1**: Dump names the CLI; write path uses the same generator
  - Delivers: `handleBootstrapToolCall` dump leads with `bunx create-terreno-app …`; when `targetDir` is set and `TERRENO_MCP_WRITE_SCAFFOLD=1`, writes `<targetDir>/<appName>` with the same files as the CLI; without the env guard, `targetDir` is ignored and nothing is written
  - Files: `mcp-server/src/bootstrap.ts`, `mcp-server/src/local/` (set the env guard in the local entry), `mcp-server/src/__tests__/bootstrap.test.ts`, `docs/reference/mcp-server.md`
  - Blocked by: Task 1.1, Task 2.1
  - Docs: `docs/reference/mcp-server.md` (`targetDir`, write guard, CLI)
  - Skills: `update-docs`
  - Acceptance: dump test asserts CLI command present; write test with env + temp `targetDir` creates files; write test without env does not create files even with `targetDir`

---

### Phase 5: Docs, publish, dogfood skill

- [x] **Task 5.1**: Human docs + getting-started + how-to
  - Delivers: first-run path is the CLI; clone-examples stays as a secondary path
  - Files: `docs/tutorials/getting-started.md`, `docs/how-to/create-a-terreno-app.md`, `docs/how-to/README.md`, `docs/README.md` (package row)
  - Blocked by: Task 2.1, Task 3.1
  - Docs: those files
  - Skills: `update-docs`
  - Acceptance: getting-started step 1 is `bunx create-terreno-app` (or `npm create terreno-app`); how-to lists flags, refuse-non-empty, seed login, Dockerfile note; indexes link the how-to

- [x] **Task 5.2**: Publish pipeline, changelog, build-terreno-app skill
  - Delivers: unscoped package on tag publish; dogfood Phase 2 prefers the CLI and treats MCP dump as fallback
  - Files: `.github/workflows/publish-on-tag.yml`, CircleCI publish list / `scripts/ci/publish-package.sh` if it enumerates packages, `changelog/unreleased/create-terreno-app.md`, `.rulesync/skills/build-terreno-app/SKILL.md` then `bun run skills:sync`, `docs/explanation/roadmap-seed-issues.md` (IP/task links already present — confirm)
  - Blocked by: Task 2.1, Task 4.1, Task 5.1
  - Docs: changelog fragment; skill; upgrade note if the next version file exists
  - Skills: `update-docs`, `update-agent-docs`
  - Acceptance: publish job includes `create-terreno-app`; changelog fragment `category: Added`; skill Phase 2 says to run `create-terreno-app` first; `bun run skills:sync` updates generated skill copies
