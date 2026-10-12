# Implementation Plan: The AI Development Loop (Boost)

**Status:** Approved — key decisions recorded (2026-07-29)
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1014
**Priority:** High
**Effort:** Big batch
**Owner:** unassigned
**Created:** 2026-07-27
**Program:** [OSS launch](oss-launch-program.md)
**Depends on:** PR [#802](https://github.com/TerrenoLabs/terreno/pull/802) merging (assumed). **Reconciled 2026-10-12:** #802 and #869 were both closed unmerged, but their substance is on `master` through later PRs (CDP log tools, Metro sessions, the browser-log route, `@terreno/syncdb`, and `get_syncdb_state`; mainly #1128). Read "merged #802" in this plan as "current `master`".
**RTK deprecation flag:** **Partial** — `get_rtk_state` and `installTerrenoDevConsoleLogger` are RTK-named surfaces that must be renamed or relocated now that `@terreno/syncdb` exists (the #869 substance). Both are on `master`, so the marked tasks are no longer blocked on unmerged PRs.

## Goal

Turn Terreno's AI-native pillar from a claim into a documented, demonstrable loop. The machinery exists on `master`: an agent can search current docs, generate conventional code, run the app, read merged logs from four sources, see the last error with a stack, inspect client state, and drive navigation. What does not exist is any document that explains this as a single workflow, so nobody outside the team knows it is there.

This IP writes the story and closes the gaps that become obvious once the story is written down.

## Non-Goals

- Building new MCP tools beyond renames and small gap-fillers.
- Re-implementing UI automation — #802 deliberately composes `expo-mcp`, Playwright MCP, and Maestro rather than building tap/screenshot tooling. (Fact check 2026-10-12: `master` has since added a web-only `browser` tool to `terreno-mcp-local`, built on Bun's WebView, with `snapshot` and `screenshot` actions. Native simulator interaction still comes from `expo-mcp`.)
- The tutorial itself (that is [`docs-tutorials-ai-first`](docs-tutorials-ai-first.md), which depends on this IP's reference content).
- Langfuse/observability for AI features inside consumer apps (that is `terreno-langfuse-integration.md`).

## Blocking questions

**Recorded 2026-07-29** (defaults accepted).

| # | Question | Decision |
|---|----------|----------|
| AI1 | Replace `get_rtk_state` | **A** — `get_client_state` with a `layer` field |
| AI2 | `installTerrenoDevConsoleLogger` location | **B** — move to `@terreno/syncdb`, re-export from rtk during support window |
| AI3 | Document `evaluate` publicly? | **A** — yes, with `TERRENO_MCP_EVAL=1` gate |
| AI4 | Compose `expo-mcp` + Playwright MCP? | **A** — yes, with configuration |
| AI5 | Hosted MCP auth / rate limiting | **B** — rate limiting by IP before public launch |
| AI6 | MCP URL (→ P4) | **`https://mcp.terreno.app`** |

## Architecture

### The loop, named

```mermaid
flowchart LR
  ASK["1. Ask<br/>terreno_search_docs<br/>terreno_get_component_docs"]
  GEN["2. Generate<br/>terreno_generate_model / _route / _screen<br/>terreno_validate_model_schema"]
  RUN["3. Run<br/>bun run backend:dev<br/>expo start"]
  OBS["4. Observe<br/>read_logs (backend/app/metro/browser)<br/>last_error<br/>get_client_state"]
  FIX["5. Fix<br/>navigate + browser screenshot<br/>regenerate typed client"]
  ASK --> GEN --> RUN --> OBS --> FIX
  FIX -->|"iterate"| ASK
```

The claim worth making is narrow and true: **the agent sees what the app actually did, not a description of it.** Everything else in the *tool* story is table stakes that other frameworks can match.

### Tool layer versus process layer

This loop is only half the AI story, and documenting it alone undersells it. The other half is the `/terreno-*` SDLC pipeline shipped in `plugins/terreno-planning/` — plan, implement test-first, verify in a fresh context, submit with evidence, own the review loop. [`agentic-sdlc-plugin`](agentic-sdlc-plugin.md) owns publishing and documenting it.

| Layer | Answers | Delivered by |
|-------|---------|--------------|
| **Tool** | What can the agent see and do? | MCP servers: docs search, codegen, merged logs, client state, navigation |
| **Process** | In what order should the agent work, and who checks it? | `/terreno-*`: question-first planning, TDD, fresh-context independent review, evidence gates, reactive review loop |

Every document produced by this IP must name both and explain that they compose: the pipeline's implement stage uses the loop's tools, and the loop's tools are most useful when driven by the pipeline's sequencing. `docs/explanation/ai-development-loop.md` and `docs/explanation/agentic-sdlc.md` are companion pages and must cross-link.

### Tool surface (reconciled with master, 2026-10-12)

Every name below is registered in source. The hosted server (`terreno-mcp`, `mcp-server/src/index.ts`) registers tools from `mcp-server/src/tools.ts` and `mcp-server/src/bootstrap.ts`. The local stdio server (`terreno-mcp-local`, `mcp-server/src/local/`) registers tools only, from `mcp-server/src/local/localTools.ts`. Full input schemas and every environment variable, with the file that reads it, are in the Task 1.1 evidence (`.terreno/pipeline/ai-dev-loop-boost-evidence/inventory.md`).

| Tool | Server | Purpose |
|------|--------|---------|
| `terreno_search_docs` | hosted | BM25 search over the docs corpus, multi-query, optional `packages` and lockstep `version` |
| `terreno_get_component_docs` | hosted | Full props table for a `@terreno/ui` component, optional `version` |
| `terreno_get_upgrade_guide` | hosted | Concatenated upgrade notes for a version range |
| `terreno_search_update_notes` / `terreno_get_update_note` / `terreno_ask_update_help` | hosted | Search, fetch, and question bundled upgrade notes, plus help-API announcements when `TERRENO_HELP_API_URL` is set |
| `terreno_bootstrap_ai_rules` | hosted | Agent rule files for Cursor, Windsurf, Claude Code, and Copilot. App scaffolding moved to `bunx create-terreno-app`, and `terreno_bootstrap_app` no longer exists. |
| `terreno_generate_model` / `terreno_generate_route` / `terreno_generate_screen` / `terreno_generate_form_fields` | hosted | Codegen |
| `terreno_validate_model_schema` / `terreno_validate_ui_blocks` | hosted | Convention and block-document validation |
| `terreno_install_admin` | hosted | Admin panel integration snippets |
| `application_info` | local | `@terreno/*` and toolchain versions |
| `database_schema` / `database_query` | local | Mongo introspection with a read-only allowlist, using `MONGO_URI` or `backend/.env` |
| `read_logs` | local | Merged logs from `backend` (JSONL), `browser` (JSONL), `metro` (`/events`), and `app` (Hermes console over CDP) |
| `last_error` | local | Raw JSONL line of the newest error-level entry across the same four sources. A stack is included only when the entry carries one. |
| `get_rtk_state` | local | Redux auth and RTK Query cache inspection (in-process or CDP). It is not gated. This is the tool that AI1 renames to `get_client_state`; `get_client_state` does not exist yet. |
| `get_syncdb_state` / `syncdb_snapshot` / `syncdb_action` | local | SyncDB inspection, snapshots, and actions. `syncdb_action` is gated by `TERRENO_MCP_EVAL=1`. |
| `evaluate` / `navigate` | local | CDP `Runtime.evaluate` and expo-router navigation, both gated by `TERRENO_MCP_EVAL=1` |
| `browser` | local | Headless web driving through Bun 1.4 WebView: open, click, type, snapshot, and screenshot. Only its `evaluate` action is gated by `TERRENO_MCP_EVAL=1`. |

Prompts (hosted only): `terreno_bootstrap`, `terreno_create_crud_feature`, `terreno_create_api_endpoint`, `terreno_create_ui_component`, `terreno_create_form_screen`, `terreno_add_authentication`, `terreno_style_guide`, `terreno_migrate_to_terreno_app`, `terreno_upgrade`. Resources (hosted only): `terreno://docs/{overview,api,ui,syncdb,rtk,patterns}`, plus `terreno://docs/ui/components` and one `terreno://docs/ui/components/<slug>` per component.

### Gaps that surface once the story is written

1. **Naming**: `get_rtk_state` is named after a package being deprecated (AI1). It reads Redux only. SyncDB state has its own tool (`get_syncdb_state`), so `get_client_state` must decide whether to reuse that bridge or report the SyncDB layer itself.
2. **Discovery**: `docs/how-to/set-up-terreno-mcp.md` now exists. It is linked from `docs/README.md`, `docs/how-to/README.md`, `docs/reference/mcp-server.md`, and the `terreno://docs/overview` resource, but not from the root `README.md` or `docs/tutorials/README.md`. `create-terreno-app` writes `terreno-local` into `.cursor/mcp.json` but does not point at the guide.
3. **Hermes single-connection contention**: opening React Native DevTools steals the CDP connection the log tools need. `master` connects lazily and holds the socket for the life of the MCP process; there is no release. On close it reports `CDP disconnected` and reconnects on the next call. Status reaches the agent in `read_logs`' `connection` field (`CDP: …; Metro events: …`). Users need to know the symptom.
4. **Setup guide is incomplete and inconsistent**: `docs/how-to/set-up-terreno-mcp.md` covers Cursor and Claude Code for both servers. It uses `https://mcp.terreno.flourish.health/mcp`, while `create-terreno-app` and the root README use `https://mcp.terreno.app` (AI6). It also omits `expo-mcp` and Playwright MCP.
5. **Hosted server has no rate limiting** (AI5), which is a launch risk. Neither `mcp-server/src/index.ts` nor the `mcp_service` Cloud Run module in `terraform/main.tf` limits requests, and the service allows unauthenticated access. `@terreno/api`'s opt-in `rateLimit` does not apply, because the hosted server uses `createMcpExpressApp`, not `TerrenoApp`.
6. **Composition is undocumented**: `create-terreno-app` writes `expo` (`https://mcp.expo.dev/mcp`) and `playwright` (`@playwright/mcp`) entries into `.cursor/mcp.json` (`create-terreno-app/src/generate.ts`), but no doc explains them (AI4).
7. **Reference drift**: `docs/reference/mcp-server.md` has no sections for `application_info`, `database_schema`, `database_query`, `read_logs`, `last_error`, `get_rtk_state`, `evaluate`, `navigate`, or the three update-note tools. Its env table omits `TERRENO_HELP_API_URL`, `TERRENO_HELP_API_TOKEN`, `MONGO_URI`, `TERRENO_LOG_FILE`, and the Sentry variables. `mcp-server/README.md` omits `terreno_validate_ui_blocks` and lists only the SyncDB local tools.

### Documentation to produce

| Document | Purpose |
|----------|---------|
| `docs/explanation/ai-development-loop.md` | The five-stage loop, why it is different, what the agent can and cannot see |
| `docs/how-to/set-up-terreno-mcp.md` | Per-editor configuration for both Terreno servers plus composed servers. This page already exists on `master`, so update it rather than create it. |
| `docs/how-to/debug-with-mcp.md` | Using `read_logs`, `last_error`, `get_client_state`, `navigate` on a real failure. This page already exists on `master` and covers `get_rtk_state` and the SyncDB tools; update it. |
| `docs/reference/mcp-server.md` | Updated with the complete tool surface on `master` and every environment variable |
| `docs/explanation/agent-guidelines.md` | How per-package `.ai/` guidelines and `.rulesync/` rules reach an agent, and how consumers extend them |

Companion page owned elsewhere: `docs/explanation/agentic-sdlc.md` (the process layer) from [`agentic-sdlc-plugin`](agentic-sdlc-plugin.md). Neither page should duplicate the other; each links the other as the missing half.

## Models / APIs

No new models. `POST /__terreno/browser-logs` (dev-only, `api/src/browserLogsRoute.ts`) needs documenting, including its production-disabled behavior and the `TERRENO_BROWSER_LOGS` override. Facts on `master`:

- Only `TerrenoApp` registers the route, not legacy `setupServer`.
- By default it is on only when `NODE_ENV === "development"`. An unset `NODE_ENV` leaves it off unless `TERRENO_BROWSER_LOGS=true`.
- It is never registered in `production`, so requests there get a 404.
- It returns 403 to clients that are neither loopback nor authenticated.

## Notifications

None.

## UI

None. `installTerrenoDevConsoleLogger` is invisible instrumentation.

## Phases

1. **Reconcile with `master`** (#802 and #869 closed unmerged; their substance landed through later PRs): verify the actual tool names, parameters, and environment variables.
2. **Reference completeness** — update `docs/reference/mcp-server.md` to the real surface.
3. **The loop explainer** — `ai-development-loop.md`.
4. **Setup and debug how-tos** — including composed servers.
5. **Gap fixes** — the `get_client_state` rename (`@terreno/syncdb` is on `master`), logger relocation, hosted rate limiting, discovery paths.
6. **Agent guidelines explainer** — how guidelines reach agents and how consumers extend them.

## Feature Flags & Migrations

- `TERRENO_MCP_EVAL=1` (or `true`) gates `evaluate`, `navigate`, `syncdb_action`, and the `browser` tool's `evaluate` action. It does not gate `get_rtk_state`, `get_syncdb_state`, or `syncdb_snapshot`, which read app state over CDP with fixed expressions. The `.cursor/mcp.json` that `create-terreno-app` generates never sets it.
- `TERRENO_BROWSER_LOGS` and `NODE_ENV` gate the browser-log route (`api/src/browserLogsRoute.ts`). By default it is on only when `NODE_ENV=development`.
- `TERRENO_LOG_FILE` and `NODE_ENV` gate the backend JSONL file that `read_logs` reads (`api/src/logger.ts`). By default it is on whenever `NODE_ENV !== "production"`.
- Renaming `get_rtk_state` to `get_client_state` is a breaking MCP tool change: keep the old name as an alias for one release with a deprecation note in its description.

## Not Included / Future Work

- Semantic/vector docs search (BM25 is the v1 answer).
- CDP multiplexing proxy for the Hermes single-connection limit (the fallback plan in #802 if contention proves painful).
- Terreno-authored simulator automation.
- MCP tools generated for consumer app APIs (`model-router-mcp.md`).

## Files to Create / Modify

**Create**

- `docs/explanation/ai-development-loop.md`
- `docs/explanation/agent-guidelines.md`

**Modify**

- `docs/how-to/set-up-terreno-mcp.md`, `docs/how-to/debug-with-mcp.md` (both already on `master`)
- `docs/reference/mcp-server.md`, `mcp-server/README.md`
- `mcp-server/src/local/tools/runtime.ts` (tool rename + alias)
- `mcp-server/src/local/localTools.ts` (tool registration)
- `mcp-server/src/index.ts` (rate limiting)
- `rtk/src/devConsoleLogger.ts` → `syncdb/src/devConsoleLogger.ts` (with re-export)
- `docs/reference/environment-variables.md`
- `README.md` (MCP section links the new how-to)

## Task List

See [`docs/tasks/ai-dev-loop-boost.md`](../tasks/ai-dev-loop-boost.md).

## Acceptance Criteria

- [ ] `docs/reference/mcp-server.md` lists every tool, prompt, and resource on both servers, matching the merged code, and every environment variable that affects them.
- [ ] `docs/explanation/ai-development-loop.md` explains the five stages and states precisely what an agent can and cannot observe.
- [ ] `docs/explanation/ai-development-loop.md` distinguishes the tool layer from the process layer, and cross-links `docs/explanation/agentic-sdlc.md` as the other half of the AI story.
- [ ] `docs/how-to/set-up-terreno-mcp.md` gives working configuration for at least Cursor and Claude Code, covering both Terreno servers, and explains when to add `expo-mcp` and Playwright MCP.
- [ ] `docs/how-to/debug-with-mcp.md` walks a real failure from symptom to fix using `last_error` and `read_logs`, with real tool output.
- [ ] The Hermes single-CDP-connection limitation is documented with its symptom and the workaround.
- [ ] `evaluate` and `navigate` are documented with the `TERRENO_MCP_EVAL` gate and the security reasoning for it.
- [ ] `get_client_state` exists, works against both store types, reports which layer it found, and `get_rtk_state` remains as a deprecated alias for one release.
- [ ] `installTerrenoDevConsoleLogger` is exported from the supported client package with a re-export from `@terreno/rtk` for the support window.
- [ ] The hosted MCP server enforces rate limiting, with the limit documented and a clear error response when exceeded.
- [ ] `POST /__terreno/browser-logs` is documented including that it 404s in production.
- [ ] A bootstrapped app's generated `mcp.json` matches the setup how-to exactly.
- [ ] `bun run mcp:build`, `bun run lint`, `bun run compile`, and `bun run rules:check` all pass.
