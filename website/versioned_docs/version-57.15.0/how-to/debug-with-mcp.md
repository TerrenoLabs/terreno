# Debug a Terreno app with MCP

Start the backend and frontend, reproduce the failure once, then inspect the merged runtime evidence
instead of copying logs into the agent chat.

## 1. Read the latest error

Call the local MCP tool:

```json
{"name":"last_error","arguments":{"sources":["backend","browser","metro","app"]}}
```

It returns the newest error-level JSONL/CDP entry. Use `read_logs` when the failure needs surrounding
events:

```json
{
  "name": "read_logs",
  "arguments": {
    "entries": 100,
    "level": "error",
    "sources": ["backend", "browser", "metro", "app"]
  }
}
```

`backend` and `browser` read durable JSONL; `metro` and `app` read in-memory rings populated from
Metro `/events` and CDP. Connection status in the response explains when either live source is
unavailable.

CLI equivalents:

```bash
terreno logs last-error --sources backend,browser,metro,app
terreno logs --entries 100 --level error --sources backend,browser,metro,app
```

## 2. Inspect client state

Check authentication and non-synced RTK Query cache state:

```json
{"name":"get_rtk_state","arguments":{"slice":"rtk","query":"todos"}}
```

The tool reads `globalThis.__TERRENO_STORE__` registered by the app, using CDP when the MCP process
cannot access the app heap directly. `slice: "auth"` prefers the Better Auth slice and falls back to
legacy JWT auth; pass `betterAuth` to request that exact slice. The CLI equivalent is:

Sensitive fields whose names include `password`, `token`, `secret`, `authorization`, or `cookie` are
returned as `[REDACTED]`; use this summary to inspect cache state, never to retrieve credentials.

```bash
terreno state --slice rtk --query todos
```

## 3. Inspect and change SyncDB state

Create the app client with `debug: true`, then inspect the same state that powers
the SyncDB debugger:

```json
{"name":"get_syncdb_state","arguments":{"collection":"todos"}}
```

The result includes entities (including tombstones, seq/stream, and pending ids),
decoded outbox rows, conflicts, cursors, known streams, repair markers, aggregate
status, and debugger events. Sensitive fields are returned as `[REDACTED]`.

Capture state before and after reproduction, then compare it:

```json
{"name":"syncdb_snapshot","arguments":{"action":"capture"}}
{"name":"syncdb_snapshot","arguments":{"action":"capture"}}
{"name":"syncdb_snapshot","arguments":{"action":"compare","snapshotId":"syncdb-...-1","otherSnapshotId":"syncdb-...-2"}}
```

Snapshots live in the local MCP process. Each capture privately retains the
TinyBase mergeable content so `mergeSnapshot` can CRDT-merge it back later
without wiping newer local rows (later HLCs win, including deletes). `get` and
`compare` never return that merge payload. To restore a specific captured row,
use `setLocalEntity` from `syncdb_snapshot` `get`.

State changes require an explicit local opt-in:

```bash
TERRENO_MCP_EVAL=1 bunx terreno-mcp-local
```

Then use `syncdb_action`. Normal writes should use `mutate`; `flush` drains the
outbox, and `reconcile` catches up from server snapshots:

```json
{"name":"syncdb_action","arguments":{"action":"mutate","collection":"todos","operation":"update","id":"todo-1","data":{"completed":true}}}
{"name":"syncdb_action","arguments":{"action":"flush"}}
{"name":"syncdb_action","arguments":{"action":"reconcile"}}
```

Other actions are `forceResync`, `resolveConflict`, `retryFailed`, `goOffline`,
`goOnline`, `clearDebug`, `setLocalEntity`, `deleteLocalEntity`, and
`mergeSnapshot`. Direct local edits bypass server validation and outbox
semantics. `mergeSnapshot` CRDT-merges the captured TinyBase content into the
live store (later HLCs win) instead of replacing it. Capture a baseline first
and use these only for fault injection or repair.

## 4. Prove the web fix

Use Bun 1.4's built-in WebView through the local `browser` tool:

```json
{"name":"browser","arguments":{"action":"open","url":"http://localhost:8082"}}
{"name":"browser","arguments":{"action":"wait","timeout":1000}}
{"name":"browser","arguments":{"action":"click","selector":"[data-testid=save]"}}
{"name":"browser","arguments":{"action":"snapshot"}}
{"name":"browser","arguments":{"action":"screenshot","output":"/opt/cursor/artifacts/save-result.png"}}
{"name":"browser","arguments":{"action":"close"}}
```

The session persists between MCP calls. `snapshot` returns visible text and up to 200 interactive
elements so the agent can choose selectors and verify state without image guessing. `screenshot`
saves the viewport for the PR or walkthrough.
WebView console output is not added to `browser.log`; call `read_logs` alongside this flow when the
running app posts browser logs to the backend collector. The collector accepts local-loopback
traffic before login; devices or remote browsers must send the app's normal authentication.

The equivalent one-process CLI sequence is:

```bash
terreno web http://localhost:8082 \
  --action '{"action":"click","selector":"[data-testid=save]"}' \
  --snapshot \
  --screenshot /opt/cursor/artifacts/save-result.png
```

## 5. Verify the native fix in the running app

Navigation and arbitrary evaluation are disabled by default. Opt in only for local debugging:

```bash
TERRENO_MCP_EVAL=1 bunx terreno-mcp-local
```

Then call `navigate` with `{"path":"/profile"}` or run:

```bash
TERRENO_MCP_EVAL=1 terreno navigate /profile
```

Confirm the target screen renders, then call `last_error` again. A successful fix has no new
error-level entry after the navigation timestamp.

## Connection problems

- Upgrade to Bun 1.4 or newer when `Bun.WebView requires Bun 1.4 or newer` appears.
- Set `BUN_CHROME_PATH` if WebView cannot discover Chrome, Chromium, or Edge on Linux or Windows.
- Set `TERRENO_PROJECT_ROOT` if logs or package versions come from the wrong directory.
- Set `TERRENO_METRO_URL` if Metro is not on the frontend script's `--port`.
- Close React Native DevTools when Hermes reports another debugger connection.
- Use only `backend,browser` sources when Metro is intentionally stopped.
