# Task List: The AI Development Loop (Boost)

See: [`docs/implementationPlans/ai-dev-loop-boost.md`](../implementationPlans/ai-dev-loop-boost.md)

**RTK deprecation flag:** **Partial.** Tasks marked `[RTK]` rename `get_rtk_state` and relocate `installTerrenoDevConsoleLogger`; they require PR #869 merged in addition to PR #802. Unmarked tasks require only #802.

## Instructions for the implementing agent

- **Phase 1 gates everything.** PR #802 was in draft when this IP was written. Verify every tool name, parameter, and environment variable against the merged source in `mcp-server/src/local/` and `mcp-server/src/tools.ts` before documenting anything.
- Every tool output shown in documentation must be real output from a real run, not a plausible-looking example.
- Do not add new MCP tools. This IP documents and renames; it does not expand the surface.
- Run `bun run mcp:build`, `bun run lint`, and `bun run compile` before each commit. Run `bun run rules:check` after touching `.rulesync/`.

## Phase 1: Reconcile with merged #802

- [ ] **Task 1.1**: Inventory the actual MCP surface
  - Description: Read `mcp-server/src/tools.ts`, `mcp-server/src/prompts.ts`, `mcp-server/src/resources.ts`, `mcp-server/src/local/localTools.ts`, and every file under `mcp-server/src/local/tools/`. Produce a table of every tool with its exact name, input schema, and which server hosts it. Separately list every environment variable the servers read (`TERRENO_MCP_EVAL`, `TERRENO_METRO_URL`, `TERRENO_PROJECT_ROOT`, `TERRENO_LOG_FILE`, `TERRENO_BROWSER_LOGS`, and any others found). Compare against the tool table in the IP and correct the IP where it is wrong. Put the deltas in the PR body.
  - Files: `docs/implementationPlans/ai-dev-loop-boost.md`
  - Depends on: PR #802 merged
  - Acceptance: every tool in the corrected table is greppable in the source; every environment variable cites its reading file; the PR body lists what differed from the pre-merge IP.

- [ ] **Task 1.2**: Verify the log pipeline end to end
  - Description: Start the example backend and frontend, then exercise each `read_logs` source and record real output: `backend` (winston JSONL file transport), `app` (console output over Metro CDP), `metro` (bundler events), and `browser` (POST fallback). Deliberately break something to produce an error and confirm `last_error` returns it with a stack. Note which sources required extra setup and what happens when Metro is not running. Save the real outputs for use in the documentation tasks.
  - Files: none (findings recorded for later tasks)
  - Depends on: Task 1.1
  - Acceptance: all four sources produced output, or any that did not is documented with the reason; `last_error` output captured verbatim including a stack trace.

- [ ] **Task 1.3**: Reproduce the Hermes CDP contention symptom
  - Description: With `read_logs` connected and streaming `app` source entries, open React Native DevTools (press `j` in Metro) and observe what happens to the log tool. Record the exact status message or failure the tool reports. Then close DevTools and confirm whether the tool recovers automatically. This becomes the documented symptom and workaround.
  - Files: none (findings recorded for later tasks)
  - Depends on: Task 1.2
  - Acceptance: the symptom is recorded verbatim; recovery behavior (automatic or requiring a retry) is confirmed by observation.

## Phase 2: Reference completeness

- [ ] **Task 2.1**: Update `docs/reference/mcp-server.md`
  - Description: Rewrite the tool sections to match the Task 1.1 inventory exactly. Split clearly into "Hosted server (`terreno-mcp`)" and "Local server (`terreno-mcp-local`)" sections. For each tool: name, purpose, input schema table, example call, and example output. Add an "Environment variables" section listing every variable from Task 1.1 with its effect and default. Add a "What the local server can and cannot see" section — it reads `package.json`/lockfiles, connects to Mongo via the consumer's `.env`, tails log files, and attaches over CDP; it never imports consumer code. Document the Hermes limitation from Task 1.3. Update the hosted URL per IP question AI6 if the domain decision has been made.
  - Files: `docs/reference/mcp-server.md`
  - Depends on: Task 1.1, Task 1.3
  - Acceptance: tool list matches the inventory one-to-one; every environment variable documented; the can/cannot-see section is present; the Hermes symptom is quoted from Task 1.3.

- [ ] **Task 2.2**: Sync `mcp-server/README.md`
  - Description: Bring the package README's tool list in line with the reference page (it is known to omit `terreno_search_docs`, `terreno_get_component_docs`, and `terreno_get_upgrade_guide`). Keep the README short — the six-section template from [`docs-reference-coverage`](../implementationPlans/docs-reference-coverage.md) — and link the reference page for full detail.
  - Files: `mcp-server/README.md`
  - Depends on: Task 2.1
  - Acceptance: the README and reference page list identical tool sets; the README follows the standard template; all links absolute.

- [ ] **Task 2.3**: Document the browser-log route
  - Description: Add `POST /__terreno/browser-logs` to `docs/reference/api.md` (or the appropriate reference page) documenting: that it is registered only when `NODE_ENV !== "production"`, that it 404s in production, the `TERRENO_BROWSER_LOGS=false` override, the JSONL file it appends to, and the payload shape. Verify all of this against `api/src/browserLogsRoute.ts` in the merged tree.
  - Files: `docs/reference/api.md`, `docs/reference/environment-variables.md`
  - Depends on: Task 1.1
  - Acceptance: every behavior claimed matches `api/src/browserLogsRoute.ts`; the production 404 behavior is stated; the env var appears in the environment reference.

## Phase 3: The loop explainer

- [ ] **Task 3.1**: Write `docs/explanation/ai-development-loop.md`
  - Description: Explainer covering the five stages (Ask, Generate, Run, Observe, Fix) with the mermaid diagram from the IP. For each stage, name the tools involved and what they contribute. Then a "Tool layer versus process layer" section using the table from the IP, stating that this page covers the tool layer and that the `/terreno-*` SDLC pipeline is the process layer, with a link to `docs/explanation/agentic-sdlc.md` — do not duplicate that page's content. Then a "What makes this different" section built on one narrow, defensible claim: the agent observes what the app actually did rather than a description of it. Then a "What the agent cannot see" section — production logs, native crash reports outside the dev loop, anything requiring a physical device not attached to a dev server, and the Hermes single-connection limitation. Then a "How this composes" section covering `expo-mcp` for simulator interaction, Playwright MCP for web, and Maestro for durable E2E flows, with the division of labor. No commands — this is conceptual.
  - Files: `docs/explanation/ai-development-loop.md` (new), `docs/explanation/README.md`
  - Depends on: Task 2.1
  - Acceptance: all five stages present with real tool names from the inventory; the tool/process table is present and links the companion page; the cannot-see section has at least four honest limitations; no shell commands; listed in the explanation index.

- [ ] **Task 3.2**: Write `docs/explanation/agent-guidelines.md`
  - Description: Explainer on how conventions reach an agent: the hosted server's docs resources and search, per-package `.ai/guidelines/` shipped in npm tarballs (verify whether #802 Phase 2 shipped this before documenting it — if not, describe only what exists and note the rest as planned), `terreno_bootstrap_ai_rules` for generating editor-specific rule files, and the `.rulesync/` source-of-truth pattern with its generated targets. Add a section for consumers on extending the generated rules with their own project conventions without losing them on regeneration.
  - Files: `docs/explanation/agent-guidelines.md` (new), `docs/explanation/README.md`
  - Depends on: Task 1.1
  - Acceptance: every mechanism described is verified present in the merged tree, with anything unshipped clearly labeled as planned; the consumer-extension section gives a concrete pattern.

## Phase 4: Setup and debug how-tos

- [ ] **Task 4.1**: Write `docs/how-to/set-up-terreno-mcp.md`
  - Description: Per-editor setup for both Terreno servers. Cover at minimum Cursor (`.cursor/mcp.json`) and Claude Code, with the exact JSON for each including the hosted HTTP entry and the `bunx terreno-mcp-local` stdio entry. Then: what `terreno-mcp-local` needs to work (project root discovery and the `TERRENO_PROJECT_ROOT` override, a reachable `MONGO_URI`, the backend log file, Metro running for app logs); an optional section on adding `expo-mcp` and Playwright MCP with the division of labor from Task 3.1; and a verification section — ask the agent to call `application_info` and confirm it reports the project's `@terreno/*` versions. Compare the JSON against what `terreno_bootstrap_app` actually generates and make them identical.
  - Files: `docs/how-to/set-up-terreno-mcp.md` (new), `docs/how-to/README.md`
  - Depends on: Task 2.1
  - Acceptance: configuration for at least two editors, each verified by actually loading it; the JSON matches bootstrap output byte-for-byte in structure; the `application_info` verification step works.

- [ ] **Task 4.2**: Write `docs/how-to/debug-with-mcp.md`
  - Description: Task-focused guide using the real failure and real outputs captured in Task 1.2. Structure: the symptom; `last_error` to locate it; `read_logs` with source filtering to see the surrounding context; `database_query` to check the data; `get_client_state` to check the client; `navigate` plus a screenshot from the composed server to confirm the fix. Include a "which tool for which symptom" table (app crashes on a screen; API returns 403; data looks wrong; screen renders empty; bundler fails). Use verbatim tool output.
  - Files: `docs/how-to/debug-with-mcp.md` (new), `docs/how-to/README.md`
  - Depends on: Task 1.2, Task 4.1
  - Acceptance: all tool outputs are verbatim from Task 1.2; the symptom-to-tool table has at least five rows; the walkthrough ends with a verified fix.

- [ ] **Task 4.3**: Add discovery paths for the local server
  - Description: Nothing currently tells a developer that `terreno-mcp-local` exists. Add links to `docs/how-to/set-up-terreno-mcp.md` from: the README's MCP section, `docs/README.md` quick links, `docs/tutorials/README.md`, and the `terreno://docs/overview` MCP resource. Also confirm `terreno_bootstrap_app` output includes a comment or README line pointing at the setup guide.
  - Files: `README.md`, `docs/README.md`, `docs/tutorials/README.md`, `mcp-server/src/docs/resources/overview.md`, `mcp-server/src/docs/templates/bootstrap/**`
  - Depends on: Task 4.1
  - Acceptance: at least four discovery paths link the setup guide; bootstrap output references it; `bun run mcp:build` succeeds.

## Phase 5: Gap fixes

- [ ] **Task 5.1**: `[RTK]` Rename `get_rtk_state` to `get_client_state`
  - Description: Per IP question AI1, rename the tool to `get_client_state` and extend it to detect either store type, returning a field identifying which layer it found (RTK Query cache versus syncdb store). Keep `get_rtk_state` registered as an alias whose description marks it deprecated and names the replacement. Update the tool description to explain what it returns for each layer. Add tests covering: syncdb store present, RTK store present, neither present, and the alias resolving to the same handler.
  - Files: `mcp-server/src/local/tools/runtime.ts`, `mcp-server/src/local/localTools.ts`, tests under `mcp-server/src/local/`
  - Depends on: Task 1.1, PR #869 merged
  - Acceptance: both names work; the response identifies the detected layer; the alias description marks it deprecated; all four test cases pass; `bun run mcp:build` succeeds.

- [ ] **Task 5.2**: `[RTK]` Relocate the dev console logger
  - Description: Per IP question AI2, move `installTerrenoDevConsoleLogger` from `rtk/src/devConsoleLogger.ts` to the syncdb package, keeping a re-export from `@terreno/rtk` for the deprecation window so existing consumers are unaffected. Move its tests with it. Update the bootstrap `_layout` template and `example-frontend/app/_layout.tsx` to import from the new location. Add the re-export to the RTK deprecation notes.
  - Files: `syncdb/src/devConsoleLogger.ts` (moved), `rtk/src/devConsoleLogger.ts` (re-export), `rtk/src/index.ts`, `syncdb/src/index.ts`, `mcp-server/src/docs/templates/bootstrap/frontend/app/_layout.template.tsx`, `example-frontend/app/_layout.tsx`, tests
  - Depends on: Task 5.1
  - Acceptance: both import paths work; tests pass from the new location; `bun run compile` succeeds across the workspace; the example app still ships browser logs to the backend route (verify by producing a `console.error` and reading it back with `read_logs`).

- [ ] **Task 5.3**: Add rate limiting to the hosted MCP server
  - Description: Per IP question AI5 — a launch prerequisite. Add per-IP rate limiting to the hosted server's JSON-RPC endpoint. Choose limits appropriate to the workload (search and codegen are cheap per call; the index is built once at startup) and make them configurable by environment variable with a sensible default. Return a clear JSON-RPC error when exceeded, naming the limit and the retry window. Add tests for under-limit, at-limit, and over-limit behavior. Document the limit in `docs/reference/mcp-server.md`.
  - Files: `mcp-server/src/index.ts`, tests under `mcp-server/src/`, `docs/reference/mcp-server.md`, `docs/reference/environment-variables.md`
  - Depends on: Task 2.1
  - Acceptance: exceeding the limit returns a structured error naming the limit and retry window; the limit is configurable by environment variable; three test cases pass; the limit is documented.

- [ ] **Task 5.4**: Handle the MCP domain change
  - Description: If program question P4 / IP question AI6 was answered in favor of moving off `mcp.terreno.flourish.health`, update every occurrence of the URL: `README.md`, `docs/reference/mcp-server.md`, `mcp-server/README.md`, `mcp-server/src/**` defaults, bootstrap templates, and `infra/flourish/` deployment config. Keep the old hostname serving with a redirect or CNAME for at least one release and document the cutover. If the decision was to keep the current domain, make no change and record that.
  - Files: various (grep `rg -n "mcp\.terreno"`)
  - Depends on: Task 2.1
  - Acceptance: `rg -n "mcp\.terreno\.flourish\.health"` returns only intentional legacy references; a bootstrapped app's `mcp.json` uses the new URL; the cutover plan is documented; or the no-change decision is recorded in the PR body.

## Phase 6: Verification

- [ ] **Task 6.1**: Run the loop end to end and capture evidence
  - Description: In a fresh agent session with both MCP servers configured per `docs/how-to/set-up-terreno-mcp.md`, complete a full loop: ask for a small feature, let the agent generate it, run the app, introduce a bug, use `last_error` and `read_logs` to find it, fix it, and verify with `navigate` plus a screenshot. Capture the transcript highlights and screenshots to `/opt/cursor/artifacts/`. Fix any documentation gap the run exposed.
  - Files: any documentation needing correction
  - Depends on: Task 4.2, Task 5.1, Task 5.3
  - Acceptance: the full loop completed in one session using only the public docs; artifacts captured showing the `last_error` output and the verified fix; every gap fixed.
