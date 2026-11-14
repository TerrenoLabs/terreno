---
name: debug-with-mcp
description: >-
  Standard way to debug and drive Terreno apps: use the terreno CLI (or the same
  tools over terreno-mcp-local) instead of guessing from code or pasted logs. Invoke for any bug,
  500/403, wrong data, crashes, empty screens, sync/offline issues, auth/storage
  problems, or verifying a fix on web or native. Use debug-syncdb-with-mcp when the
  failure is SyncDB outbox/conflicts/cursors only.
---
# Debug Terreno apps with MCP

**Default path:** reproduce on a running dev stack → observe → edit code → act with gated
tools → observe again until logs and state match expectations. Do not ask the user to paste
server logs when the tools can read them.

**Use the `terreno` CLI.** Every tool below is a `terreno` command that runs from any shell
with no MCP configuration: subagents, CI, and sandboxes included. The **`terreno-local`** MCP
server exposes the same handlers under the MCP tool names; use it when the editor already has
it loaded. Each table gives both. `terreno tool list` prints every tool, and
`terreno tool call <name> --args '<json>'` calls one that has no dedicated command yet.
Add `--json` for machine-readable output. CLI reference:
[`docs/reference/cli.md`](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/cli.md).

Architecture and limits: [`docs/explanation/ai-development-loop.md`](https://github.com/TerrenoLabs/terreno/blob/master/docs/explanation/ai-development-loop.md).
Symptom → tool table and walkthrough: [`docs/how-to/debug-with-mcp.md`](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/debug-with-mcp.md).
Setup: [`docs/how-to/set-up-terreno-mcp.md`](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/set-up-terreno-mcp.md).
Tool reference: [`docs/reference/mcp-server.md`](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/mcp-server.md).
SyncDB-only deep dive: invoke **`debug-syncdb-with-mcp`**.

## 0. Preconditions (stop if missing)

1. Workspace root is the Terreno app or monorepo root (`TERRENO_PROJECT_ROOT` if needed).
2. `terreno --help` works (`bun add -g @terreno/cli`, or `bunx @terreno/cli`). MCP is
   optional: **`terreno-local`** in `.cursor/mcp.json` / `.mcp.json` serves the same tools.
3. **Backend dev server** is running; Mongo reachable; seeded user if reproducing auth flows.
4. **Frontend** running (`expo start` / `bun run frontend:web` / app on device with Metro).
5. For native **`app`**, **`network`**, **`navigate`**, **`evaluate`**: Hermes target attached
   to Metro (not a release build). On **web**, use **`terreno browser`** + the **`browser`**
   log source, not `app`.
6. SyncDB collection bugs: client created with **`debug: true`** before
   `terreno state` / `terreno syncdb action`.

Done when `terreno info` (`application_info`) shows the expected project root and
`terreno logs` shows the live sources you need.

## 1. Observe (reads — no opt-in)

Run these in order unless the symptom table in the how-to says otherwise:

| Step | CLI | MCP tool | Purpose |
| --- | --- | --- | --- |
| A | `terreno logs last-error` | `last_error` | Fast pointer; backend stack lives in `message` for API errors |
| B | `terreno logs --level error --since <ISO>` | `read_logs` | Merged tail — use `--sources`, `--level`, `--since` to narrow |
| C | `terreno state --collection <name>` | `get_syncdb_state` | The client's copy: entities, outbox, conflicts, cursors |
| D | `terreno db query --collection <name> --filter '<json>'` | `database_query` | Server truth for the document the UI shows wrong |
| E | `terreno logs --sources network` | `read_logs` `sources: ["network"]` | Wrong URL/status on device; redacted headers |
| F | `terreno logs --sources native` | `read_logs` `sources: ["native"]` | Platform logs when Hermes console is empty |
| G | `terreno storage read --prefix <p>` | `read_local_storage` | Session or preference keys the app registered |

**Sources:** `backend`, `browser`, `metro`, `app`, `network`, `native` (default merge omits
`native`). **`level: "error"`** is exact — 403 backend lines are often **`warn`**, not
`last_error`.

Done when you can name: failing request or route, error line(s), and client vs server mismatch.

## 2. Hypothesize and fix in the editor

Look up unfamiliar APIs with `terreno docs search <query>` and
`terreno docs component <Name>` (MCP: `terreno_search_docs`, `terreno_get_component_docs`). Regenerate OpenAPI SDK after backend route changes (`bun run sdk` in
the frontend package).

## 3. Act (state-changing — requires `TERRENO_MCP_EVAL=1`)

Set **`TERRENO_MCP_EVAL=1`** on the process that runs the tool: the shell for the CLI
(`TERRENO_MCP_EVAL=1 terreno navigate /profile`), or the MCP server process, restarted, for
`terreno-local`. A running CLI session keeps the environment it started with, so start it
with the variable set: `TERRENO_MCP_EVAL=1 terreno session start`. Never set it in generated
app env by default.

| Goal | CLI | MCP tool | Avoid |
| --- | --- | --- | --- |
| Repro web flow, step by step | `terreno browser open <url>` → `click` / `type` → `snapshot` / `screenshot` | `browser` | Raw Playwright unless the tool cannot do it |
| Repro web flow, one shot | `terreno web <url> --action '<json>' --snapshot --screenshot <path>` | `browser` | — |
| Repro native route | `terreno navigate <path>` | `navigate` | Manual device instructions only |
| Dev client action | `terreno dispatch <type> --payload '<json>'` | `dispatch_client_action` | `eval` for a one-line dispatch |
| AsyncStorage write | `terreno storage write --key <k> --value <v>` | `write_local_storage` | `eval` writing storage |
| Dev-only app hook | `terreno dev list` → `terreno dev run <name> --args '<json>'` | `list_dev_commands` → `invoke_dev_command` | Hard-coded eval snippets |
| SyncDB repair | `terreno syncdb action <action>` (see **debug-syncdb-with-mcp**) | `syncdb_action` | Direct TinyBase edits |
| Call the API as a user | `terreno login` → `terreno api call <operationId>` | — | `curl` with a hand-copied token |
| Arbitrary JS | `terreno eval --code '<js>'` | `evaluate` | When a fixed tool exists |

`terreno browser` and `terreno syncdb snapshot` keep state between commands in a background
**CLI session** that they start themselves. `terreno session status` shows it;
`terreno session stop` ends it (it also exits after 30 idle minutes).

**Collection CRUD** in the running app: **`terreno syncdb action mutate`**
(`syncdb_action` `mutate`), not `terreno dispatch`.

## 4. Verify the fix

1. Re-run the user path (`terreno browser` or `terreno navigate` + interaction).
2. `terreno logs --since <ISO just before the repro>`; confirm no new errors.
3. `terreno state` or `terreno db query` confirms the expected data.
4. For UI work, still run **`verify-ui-changes`** (screenshots/video for the PR).

Done when observation tools show the new behavior without new errors — not when the edit
merely compiles.

## Hard rules

- Do **not** use `curl`, `axios`, or ad-hoc scripts to inspect app state when
  `terreno db query`, `terreno state`, or `terreno logs` apply.
- Do **not** ask for a log paste when the dev stack is running: the CLI needs no setup.
- Do **not** stop because MCP is not configured. Use the CLI.
- Do **not** leave `TERRENO_MCP_EVAL=1` on by default in shared shells or MCP configs.
- Over MCP, **hosted `terreno`** = docs and generators; **`terreno-local`** = this app's
  runtime. The `terreno` CLI covers both.

## Completion checklist

- [ ] Symptom reproduced with stack running
- [ ] `terreno logs` / `terreno state` / `terreno db query` used (named sources)
- [ ] Root cause tied to a log line, query result, or state diff
- [ ] Fix verified with the same observe tools (and `verify-ui-changes` if UI)
