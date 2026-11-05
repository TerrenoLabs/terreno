---
name: debug-with-mcp
description: >-
  Standard way to debug and drive Terreno apps: use terreno-mcp-local (and
  hosted terreno for docs) instead of guessing from code or pasted logs. Invoke
  for any bug, 500/403, wrong data, crashes, empty screens, sync/offline issues,
  auth/storage problems, or verifying a fix on web or native. Use
  debug-syncdb-with-mcp when the failure is SyncDB outbox/conflicts/cursors
  only.
---
# Debug Terreno apps with MCP

**Default path:** reproduce on a running dev stack → observe with **`terreno-local`**
tools → edit code → act with gated tools → observe again until logs and state match
expectations. Do not ask the user to paste server logs when MCP can read them.

Architecture and limits: [`docs/explanation/ai-development-loop.md`](../../docs/explanation/ai-development-loop.md).
Symptom → tool table and walkthrough: [`docs/how-to/debug-with-mcp.md`](../../docs/how-to/debug-with-mcp.md).
Setup: [`docs/how-to/set-up-terreno-mcp.md`](../../docs/how-to/set-up-terreno-mcp.md).
Tool reference: [`docs/reference/mcp-server.md`](../../docs/reference/mcp-server.md).
SyncDB-only deep dive: invoke **`debug-syncdb-with-mcp`**.

## 0. Preconditions (stop if missing)

1. Workspace root is the Terreno app or monorepo root (`TERRENO_PROJECT_ROOT` if needed).
2. **`terreno-local`** MCP server is enabled in the editor (see `.cursor/mcp.json` /
   `.mcp.json`; generated apps include it).
3. **Backend dev server** is running; Mongo reachable; seeded user if reproducing auth flows.
4. **Frontend** running (`expo start` / `bun run frontend:web` / app on device with Metro).
5. For native **`app`**, **`network`**, **`navigate`**, **`evaluate`**: Hermes target attached
   to Metro (not a release build). On **web**, use **`browser`** + **`browser`** log source,
   not `app`.
6. SyncDB collection bugs: client created with **`debug: true`** before
   `get_syncdb_state` / `syncdb_action`.

Done when `read_logs` `connection` or `application_info` shows the expected project root
and live sources you need.

## 1. Observe (reads — no opt-in)

Run tools in this order unless the symptom table in the how-to says otherwise:

| Step | Tool | Purpose |
| --- | --- | --- |
| A | `last_error` | Fast pointer; backend stack lives in `message` for API errors |
| B | `read_logs` | Merged tail — use `sources`, `level`, `since` to narrow |
| C | `get_client_state` | RTK auth/cache + SyncDB summary |
| D | `database_query` | Server truth for the document the UI shows wrong |
| E | `read_logs` `sources: ["network"]` | Wrong URL/status on device; redacted headers |
| F | `read_logs` `sources: ["native"]` | Platform logs when Hermes console is empty |

**Sources:** `backend`, `browser`, `metro`, `app`, `network`, `native` (default merge omits
`native`). **`level: "error"`** is exact — 403 backend lines are often **`warn`**, not
`last_error`.

Done when you can name: failing request or route, error line(s), and client vs server mismatch.

## 2. Hypothesize and fix in the editor

Change code using hosted **`terreno_search_docs`** / **`terreno_get_component_docs`** when
APIs are unfamiliar. Regenerate OpenAPI SDK after backend route changes (`bun run sdk` in
the frontend package).

## 3. Act (state-changing — requires `TERRENO_MCP_EVAL=1`)

Set **`TERRENO_MCP_EVAL=1`** on the **MCP server process** (not only the app). Restart
`terreno-local` after changing it. Never set it in generated app env by default.

| Goal | Prefer | Avoid |
| --- | --- | --- |
| Repro web flow | `browser` open → click/type → `snapshot` / `screenshot` | Raw Playwright unless MCP unavailable |
| Repro native route | `navigate` `{path}` | Manual device instructions only |
| Redux/session nudge | `dispatch_client_action` `{type, payload?}` | `evaluate` for a one-line dispatch |
| AsyncStorage inspect | `read_local_storage` | `evaluate` reading storage |
| Dev-only app hook | `list_dev_commands` → `invoke_dev_command` | Hard-coded evaluate snippets |
| SyncDB repair | `syncdb_action` (see **debug-syncdb-with-mcp**) | Direct TinyBase edits |
| Arbitrary JS | `evaluate` / `browser` evaluate | When a fixed tool exists |

**Collection CRUD** in the running app: **`syncdb_action` `mutate`**, not RTK Query hooks
and not `dispatch_client_action`.

## 4. Verify the fix

1. Re-run the user path (`browser` or `navigate` + interaction).
2. `read_logs` with `since` set to just before the repro; confirm no new errors.
3. `get_client_state` or `database_query` confirms the expected data.
4. For UI work, still run **`verify-ui-changes`** (screenshots/video for the PR).

Done when observation tools show the new behavior without new errors — not when the edit
merely compiles.

## Hard rules

- Do **not** use `curl`, `axios`, or ad-hoc scripts to inspect app state when
  `database_query`, `get_client_state`, or `read_logs` apply.
- Do **not** skip MCP and ask for log paste when the dev stack is running and MCP is
  configured.
- Do **not** leave `TERRENO_MCP_EVAL=1` on by default in shared or production MCP configs.
- **Hosted `terreno`** = docs and generators; **`terreno-local`** = this app's runtime.

## Completion checklist

- [ ] Symptom reproduced with stack running
- [ ] `last_error` / `read_logs` / state tools used (named sources)
- [ ] Root cause tied to a log line, query result, or state diff
- [ ] Fix verified with the same observe tools (and `verify-ui-changes` if UI)
