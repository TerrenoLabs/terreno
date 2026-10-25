# Implementation Plan: create-terreno-app scaffolding CLI

**Status:** In progress — all tasks Roast PASS; next: Brew  
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1174  
**Branch:** `cursor/create-terreno-app-ip-54bd`  
**Owner:** unassigned  
**Created:** 2026-09-10  
**Program:** [B2B platform](b2b-platform-program.md) track D; [OSS launch](oss-launch-program.md) (zero-to-running DX)  
**Depends on:** [`deployment-foundation`](deployment-foundation.md) (Complete)  
**RTK deprecation flag:** **Partial** — scaffold output is Better Auth + `@terreno/syncdb`. Do not emit RTK Query collection CRUD.

## Goal

Ship a published **`create-terreno-app`** CLI that writes a running, deployable Terreno app to disk in one non-interactive command. `terreno_bootstrap_app` uses the **same generator**: local MCP writes when `targetDir` is set; hosted MCP never writes and returns a short CLI instruction plus the file dump.

When this is done, an operator or agent can:

1. Run `bunx create-terreno-app my-app --display-name "My App"` (or `npm create terreno-app`).
2. Get `my-app/backend` + `my-app/frontend` (syncdb, Better Auth, admin, seed script, `.env` / `.env.example`, consumer `Dockerfile`, CI workflows, MCP config).
3. Follow the printed README: replica-set MongoDB, `bun install`, `bun run seed`, `bun run sdk`, `bun run web`.
4. Sign in as `test@example.com` / `testpassword123`.
5. Deploy using existing how-tos; the scaffold Dockerfile and env examples match [deployment baseline](../explanation/deployment-baseline.md).

## Non-Goals

| Out | Why |
| --- | --- |
| GitHub template repo | Q1 — one generator; a template would drift |
| Snapshot / clone of `example-*` | Q2 — examples include consent and monorepo-only Docker |
| Interactive prompts | Q5 — agents need flags |
| `bun install`, Mongo, or seed inside the CLI | Q5 — write files only |
| Terraform / GCP / Vercel copy-paste into the tree | Q4 — README links to how-tos |
| `--no-admin` | parked; v1 matches current bootstrap (admin included) |
| Hosted MCP writing the server disk | Q3 — dump + CLI instruction only |
| Copying `example-backend/Dockerfile` | that image builds this monorepo, not a consumer app |

## Decisions

| ID | Question | Decision |
| --- | --- | --- |
| Q1 | Delivery vehicle | Unscoped npm CLI `create-terreno-app` in this monorepo (not a template repo) |
| Q2 | Generator source of truth | Extract `generateAllFiles` from `mcp-server/src/bootstrap.ts` into the CLI package; MCP imports it |
| Q3 | Hosted vs local MCP | Write when local + writable `targetDir`; otherwise CLI instructions + file dump |
| Q4 | Deployable in v1 | Consumer `Dockerfile` + `.env.example` + README links to deploy how-tos |
| Q5 | CLI UX | `bunx create-terreno-app my-app --display-name "My App"`; refuse non-empty dir; `--yes` derives display name; no prompts; no install/seed |
| Q6 | Package name | Unscoped `create-terreno-app` (`npm create terreno-app` / `bunx create-terreno-app`) |
| Q7 | MCP write path | Optional `targetDir`; write only if set and allowed; else dump |
| Q8 | Generated `@terreno/*` versions | Pin `^<create-terreno-app version>` (lockstep with published `@terreno/*`) |

### Recorded assumptions (implementation detail)

- Workspace directory: `create-terreno-app/` at the repo root (same pattern as `mcp-server/`).
- One package: bin + exported `generateAllFiles` / `writeScaffold`. MCP depends on `create-terreno-app` via `workspace:*`.
- Version pin: read `create-terreno-app/package.json` `version` (lockstep with other packages at release). Generated deps use `^${version}`, not `"latest"`.
- Target layout: `<dir>/{backend,frontend,.github,README.md,Dockerfile,…}` matching today’s bootstrap file list, plus deploy files from Q4.
- Env files: write gitignored `backend/.env` and `frontend/.env` with local-dev defaults **and** committed `.env.example` siblings (issue asked for env files; Q4 asked for examples).
- Dockerfile: **consumer** backend image (`oven/bun:1-slim` or `oven/bun:1`, bind `0.0.0.0`, `PORT` from env, health on `/health`). Not the monorepo `example-backend/Dockerfile`.
- Non-empty: refuse if the target exists and contains anything other than `.git` / `.gitignore`.
- Hosted write guard: `terreno-mcp-local` sets `TERRENO_MCP_WRITE_SCAFFOLD=1`. HTTP hosted MCP never sets it and **ignores** `targetDir` even if passed.
- `targetDir` must be an absolute path; local MCP resolves and writes `join(targetDir, appName)` only if that path is empty as above. Do not write `/` or home without an explicit `appName` subdirectory.
- Publish: add `create-terreno-app` to tag publish (GitHub workflow + CircleCI `publish-package`) as an unscoped package. Changelog lockstep sentence gains this package.
- npm name `create-terreno-app` must be available under the publishing npm user; if publish fails on name claim, that is an **access** blocker, not a redesign.

## Architecture

```
bunx create-terreno-app my-app --display-name "My App"
        │
        ▼
create-terreno-app (bin)
  parse flags → writeScaffold({appName, appDisplayName, targetDir})
        │
        ▼
generateAllFiles(args)  ◄──── terreno_bootstrap_app (MCP)
        │                         │
        │                         ├─ TERRENO_MCP_WRITE_SCAFFOLD=1 + targetDir
        │                         │     → writeScaffold (local)
        │                         └─ else → markdown: CLI command + file dump
        ▼
<dir>/backend + frontend + Dockerfile + .env(.example) + seed + CI + MCP config
```

Public seams Pick must test:

| Seam | Behavior |
| --- | --- |
| `create-terreno-app` bin | Writes files; exits non-zero on missing `appName`, missing display name without `--yes`, or non-empty target |
| `generateAllFiles` | Returns the file list; `@terreno/*` versions are `^` + package version; includes Dockerfile and `.env.example` |
| `writeScaffold` | Creates files on disk; does not run `bun install` |
| `handleBootstrapToolCall` | Dump path unchanged in shape (instructions mention CLI); write path creates files only when the env guard is set |

## Models / APIs / Notifications / UI

None. Scaffolded consumer apps keep the current bootstrap Todo + User + admin + Better Auth + syncdb shape.

## CLI contract

```bash
bunx create-terreno-app <appName> --display-name <string> [--description <string>] [--mcp-server-url <url>] [--yes]
npm create terreno-app <appName> -- --display-name <string>
```

| Flag | Required | Default |
| --- | --- | --- |
| `appName` (positional) | yes | — (kebab-case; used as directory and package names) |
| `--display-name` | unless `--yes` | derived from `appName` when `--yes` |
| `--description` | no | empty |
| `--mcp-server-url` | no | current bootstrap default |
| `--yes` | no | off |

Print next commands (install, Mongo replica set, seed, sdk, web) after a successful write. Do not execute them.

## MCP contract

`terreno_bootstrap_app` keeps `appName`, `appDisplayName`, `description`, `mcpServerUrl`, and adds:

| Param | Required | Role |
| --- | --- | --- |
| `targetDir` | no | Absolute directory that will contain `<appName>/` |

Write iff `targetDir` is set **and** `TERRENO_MCP_WRITE_SCAFFOLD=1`. Otherwise return the CLI one-liner plus the existing file dump (dump stays so hosted agents without shell can still materialize files).

`terreno_bootstrap_ai_rules` stays in `@terreno/mcp` (not this CLI).

## Phases

1. **Extract generator** — move file generation + existing bootstrap app tests into `create-terreno-app`; MCP imports the package; versions become `^<cli version>`.
2. **CLI writer** — bin, flags, `writeScaffold`, refuse non-empty, print next steps.
3. **Deploy files** — consumer Dockerfile, `.env.example`, README deploy section linking baseline + GCP/web how-tos.
4. **MCP delegate** — `targetDir` + write guard; dump mentions CLI; local write tests.
5. **Docs, publish, skills** — tutorial/how-to/reference, `build-terreno-app` Phase 2, workspace + publish jobs, changelog fragment.

## Feature Flags & Migrations

None. Additive package + MCP params. Existing dump-only MCP clients keep working.

## Not Included / Future Work

- GitHub template generated from the same `generateAllFiles`
- `--no-admin`, extra example slices, Windows-specific path docs
- Running install/seed from the CLI
- Provider-specific deploy folders

## Files to Create / Modify

| Path | Change |
| --- | --- |
| `create-terreno-app/` | New workspace package (src, tests, `package.json` bin, README) |
| `mcp-server/src/bootstrap.ts` | Thin: args + MCP write/dump; import generator |
| `mcp-server/src/__tests__/bootstrap.test.ts` | Dump + write-guard tests; generation assertions live in the CLI package |
| `mcp-server/package.json` | `create-terreno-app` workspace dependency |
| `package.json` | Workspace entry; optional root script |
| `.github/workflows/publish-on-tag.yml` + CircleCI publish | Publish unscoped `create-terreno-app` |
| `docs/tutorials/getting-started.md` | First path is the CLI; clone-examples remains secondary |
| `docs/how-to/create-a-terreno-app.md` | Flags, layout, run, deploy pointers |
| `docs/reference/mcp-server.md` | Delegate + `targetDir` |
| `docs/README.md`, `docs/how-to/README.md` | Index the how-to and package |
| `.rulesync/skills/build-terreno-app/SKILL.md` | Phase 2 uses the CLI (MCP dump is fallback) |
| `changelog/unreleased/create-terreno-app.md` | Added |
| `mcp-server/src/docs/upgrades/<next>.md` | If the release notes file for the next version exists, mention the CLI |

## Task List

[`docs/tasks/create-terreno-app.md`](../tasks/create-terreno-app.md)

## Acceptance Criteria

- [ ] `bunx create-terreno-app <tmp>/my-app --display-name "My App"` writes backend + frontend and exits 0
- [ ] Non-empty target exits non-zero and writes nothing
- [ ] Generated `@terreno/*` dependencies are `^` + the CLI package version, not `latest`
- [ ] Scaffold includes consumer `Dockerfile`, `.env.example`, seed script, and README deploy links
- [ ] `terreno_bootstrap_app` without write guard still returns markdown dump that names the CLI
- [ ] `terreno_bootstrap_app` with write guard + `targetDir` writes the same files as the CLI
- [ ] Hosted path cannot write even if `targetDir` is passed
- [ ] Docs: getting-started, create how-to, MCP reference, build-terreno-app skill
- [ ] Package is in the workspace and on the publish list
- [ ] Focused bun tests cover CLI, generator versions, MCP dump vs write
