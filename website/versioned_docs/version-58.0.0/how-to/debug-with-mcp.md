# Debug a Terreno app with MCP

Use the local MCP server (`terreno-mcp-local`) to go from a symptom to a verified fix without
pasting logs into the chat. This guide follows one real failure from start to finish, then lists
what each tool does. Every tool output below was copied unchanged from a real run against
`example-backend` and `example-frontend` on web.

## Which tool for which symptom

| Symptom | Start with | Then |
|---------|------------|------|
| API returns 500 | `last_error` with `sources: ["backend"]`. The stack is inside `message`. | `read_logs` with `sources: ["backend"]` and `since` to see the requests around it. |
| API returns 403 (or another 4xx) | `read_logs` with `sources: ["backend"]` and `level: "warn"`. Every `APIError` under 500 is logged at `warn` as `ForbiddenError(403): <title> — <detail>`, so `last_error` does not show it. | `database_query` to compare the document's `ownerId` with the user in the log line. |
| App crashes on a screen | Web: `last_error` with `sources: ["browser"]`. An uncaught error carries a separate `stack` field. A render error caught by an error boundary has no `stack`; its `message` names the component instead (see [A screen crashes on web](#a-screen-crashes-on-web)). Native: `last_error` with `sources: ["app"]`. | Native: `navigate` to the screen and call `last_error` again. Web: the `browser` tool. |
| Data looks wrong | `database_query` to read what the server stored. | `get_client_state` (RTK cache) or `get_syncdb_state` (SyncDB) to compare the client's copy. |
| Screen renders empty | `get_client_state` or `get_syncdb_state` on native. On web, `browser` with `snapshot`. | `read_logs` with `sources: ["backend"]` to check that the list request ran and returned 200. |
| Bundler fails | The terminal that runs `expo start`. The `metro` source is always empty under Expo CLI 57: the `/events` socket connects but Expo never sends on it. | On native, `read_logs` with `sources: ["app"]` once the app loads again. |

`level` matches one level exactly. `level: "error"` does not include `warn`.

## Walkthrough: a malformed request body returns 500

The run used the example backend on port 4200 with `NODE_ENV=development`, the web app on port
8282, and the seeded user `test@example.com`. The MCP server was started with
`TERRENO_PROJECT_ROOT` set to the repository and `TERRENO_METRO_URL=http://localhost:8282`.

### 1. See the symptom

A client sent a JSON body with a typo (`fals`). The server answered 500. A malformed body is the
client's mistake, so it should be a 400 that says what is wrong.

```text
$ curl -s -i -b cookies.txt -X POST localhost:4200/todos -H 'Content-Type: application/json' --data '{"title": "Buy milk", "completed": fals}'
HTTP/1.1 500 Internal Server Error
X-Powered-By: Express
X-Request-ID: 5ccfb98c-f592-42ce-9503-415c0c75f32f
Vary: Origin
Access-Control-Allow-Credentials: true
Content-Type: application/json; charset=utf-8
Content-Length: 46
Date: Mon, 12 Oct 2026 02:45:16 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":500,"title":"Internal server error"}
```

### 2. Locate it with `last_error`

```json
{"name":"last_error","arguments":{"sources":["backend","browser"]}}
```

```json
{"level":"error","message":"Fallthrough error: SyntaxError: JSON Parse error: Unexpected identifier \"fals\"\nSyntaxError: JSON Parse error: Unexpected identifier \"fals\"\n    at <parse> (:0)\n    at parse (unknown)\n    at parse (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/body-parser/lib/types/json.js:91:21)\n    at <anonymous> (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/body-parser/lib/read.js:162:18)\n    at runInAsyncScope (node:async_hooks:207:23)\n    at invokeCallback (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/raw-body/index.js:238:16)\n    at done (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/raw-body/index.js:227:7)\n    at onEnd (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/raw-body/index.js:287:7)\n    at emit (node:events:97:22)\n    at endReadableNT (internal:streams/readable:901:50)\n    at processTicksAndRejections (native:7:39)","requestId":"5ccfb98c-f592-42ce-9503-415c0c75f32f","terrenoRequestLog":{"requestId":"5ccfb98c-f592-42ce-9503-415c0c75f32f","userId":null},"timestamp":"2026-10-12T02:45:16.902Z"}
```

What this tells you:

- `requestId` matches the `X-Request-ID` header from step 1, so this is the same request.
- `Fallthrough error` comes from `apiFallthroughErrorMiddleware`. That handler only sees errors
  that `apiErrorMiddleware` could not turn into an `APIError`, and it always answers 500.
- The top frame is `body-parser/lib/types/json.js`. The body failed to parse before any route ran.
- `userId` is `null` even though the request sent a session cookie. Authentication runs after body
  parsing, so the request never got that far.

### 3. Read the surrounding context with `read_logs`

Filter to the backend and start from a time just before the failure. A valid request for the same
route was sent afterwards to compare.

```json
{"name":"read_logs","arguments":{"sources":["backend"],"since":"2026-10-12T02:45:02.876Z","entries":20}}
```

```json
{
  "connection": "CDP: not connected; Metro events: not connected",
  "entries": [
    {
      "level": "error",
      "message": "Fallthrough error: SyntaxError: JSON Parse error: Unexpected identifier \"fals\"\nSyntaxError: JSON Parse error: Unexpected identifier \"fals\"\n    at <parse> (:0)\n    at parse (unknown)\n    at parse (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/body-parser/lib/types/json.js:91:21)\n    at <anonymous> (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/body-parser/lib/read.js:162:18)\n    at runInAsyncScope (node:async_hooks:207:23)\n    at invokeCallback (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/raw-body/index.js:238:16)\n    at done (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/raw-body/index.js:227:7)\n    at onEnd (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/raw-body/index.js:287:7)\n    at emit (node:events:97:22)\n    at endReadableNT (internal:streams/readable:901:50)\n    at processTicksAndRejections (native:7:39)",
      "raw": "{\"level\":\"error\",\"message\":\"Fallthrough error: SyntaxError: JSON Parse error: Unexpected identifier \\\"fals\\\"\\nSyntaxError: JSON Parse error: Unexpected identifier \\\"fals\\\"\\n    at <parse> (:0)\\n    at parse (unknown)\\n    at parse (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/body-parser/lib/types/json.js:91:21)\\n    at <anonymous> (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/body-parser/lib/read.js:162:18)\\n    at runInAsyncScope (node:async_hooks:207:23)\\n    at invokeCallback (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/raw-body/index.js:238:16)\\n    at done (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/raw-body/index.js:227:7)\\n    at onEnd (/workspace/.claude/worktrees/agent-a4ec9221d12c64054/node_modules/raw-body/index.js:287:7)\\n    at emit (node:events:97:22)\\n    at endReadableNT (internal:streams/readable:901:50)\\n    at processTicksAndRejections (native:7:39)\",\"requestId\":\"5ccfb98c-f592-42ce-9503-415c0c75f32f\",\"terrenoRequestLog\":{\"requestId\":\"5ccfb98c-f592-42ce-9503-415c0c75f32f\",\"userId\":null},\"timestamp\":\"2026-10-12T02:45:16.902Z\"}",
      "source": "backend",
      "timestamp": "2026-10-12T02:45:16.902Z"
    },
    {
      "level": "debug",
      "message": "POST <- /todos <User:6acc4989b98fcbeba02df577> Body: {\"title\":\"Buy milk\",\"completed\":false}",
      "raw": "{\"level\":\"debug\",\"message\":\"POST <- /todos <User:6acc4989b98fcbeba02df577> Body: {\\\"title\\\":\\\"Buy milk\\\",\\\"completed\\\":false}\",\"requestId\":\"91b0a231-17d7-42ef-8794-570410c99fc7\",\"sessionId\":\"6acc49aed7ff6fef9a4a80c9\",\"terrenoRequestLog\":{\"requestId\":\"91b0a231-17d7-42ef-8794-570410c99fc7\",\"userId\":\"6acc4989b98fcbeba02df577\"},\"timestamp\":\"2026-10-12T02:45:26.017Z\",\"userId\":\"6acc4989b98fcbeba02df577\"}",
      "source": "backend",
      "timestamp": "2026-10-12T02:45:26.017Z"
    },
    {
      "level": "info",
      "message": "[comms:mail] recipients=1 subjectLength=10",
      "raw": "{\"level\":\"info\",\"message\":\"[comms:mail] recipients=1 subjectLength=10\",\"requestId\":\"91b0a231-17d7-42ef-8794-570410c99fc7\",\"sessionId\":\"6acc49aed7ff6fef9a4a80c9\",\"terrenoRequestLog\":{\"requestId\":\"91b0a231-17d7-42ef-8794-570410c99fc7\",\"userId\":\"6acc4989b98fcbeba02df577\"},\"timestamp\":\"2026-10-12T02:45:26.101Z\",\"userId\":\"6acc4989b98fcbeba02df577\"}",
      "source": "backend",
      "timestamp": "2026-10-12T02:45:26.101Z"
    },
    {
      "level": "debug",
      "message": "POST -> /todos 201 108.791011ms",
      "raw": "{\"level\":\"debug\",\"message\":\"POST -> /todos 201 108.791011ms\",\"requestId\":\"91b0a231-17d7-42ef-8794-570410c99fc7\",\"sessionId\":\"6acc49aed7ff6fef9a4a80c9\",\"terrenoRequestLog\":{\"requestId\":\"91b0a231-17d7-42ef-8794-570410c99fc7\",\"userId\":\"6acc4989b98fcbeba02df577\"},\"timestamp\":\"2026-10-12T02:45:26.126Z\",\"userId\":\"6acc4989b98fcbeba02df577\"}",
      "source": "backend",
      "timestamp": "2026-10-12T02:45:26.126Z"
    }
  ],
  "projectRoot": "/workspace/.claude/worktrees/agent-a4ec9221d12c64054"
}
```

The valid request logs `POST <- /todos` with the user and `POST -> /todos 201`. The malformed one
has neither line, only the error. That confirms it never reached request logging, auth, or the
`/todos` router. The fix belongs in the app-level error handling, not in the todo route.

`raw` is the log line exactly as the backend wrote it. `connection` reports the Metro and Hermes
sources; it does not affect `backend` entries.

### 4. Check the data with `database_query`

Did the failed request write anything?

```json
{"name":"database_query","arguments":{"collection":"todos","operation":"find","filter":{"title":"Buy milk"},"limit":5}}
```

```json
{
  "collection": "todos",
  "count": 1,
  "rows": [
    {
      "_id": "6acc49c6d7ff6fef9a4a80ca",
      "completed": false,
      "ownerId": "6acc4989b98fcbeba02df577",
      "tags": [],
      "title": "Buy milk",
      "updated": "2026-10-12T02:45:26.060Z",
      "created": "2026-10-12T02:45:26.060Z",
      "deleted": false,
      "_syncPrevStream": null,
      "_syncSeq": 3,
      "__v": 0
    }
  ]
}
```

One row, created at `02:45:26` by the valid request. The malformed request at `02:45:16` wrote
nothing, so there is no bad data to clean up.

### 5. Check the client with `get_client_state`

```json
{"name":"get_client_state","arguments":{"slice":"rtk"}}
```

On web this returns `layer: "none"`:

```json
{
  "connection": "CDP: Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?); Metro events: not connected",
  "hint": "No client data layer found. For RTK Query, call `registerTerrenoDevStore(store)` from @terreno/rtk in __DEV__. For SyncDB, create the client with `createSyncDb({debug: true})`. Keep the app running; when the MCP process cannot see the app heap, start Metro so CDP can reach Hermes (see `connection`).",
  "layer": "none",
  "reasons": {
    "rtk": "Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?)",
    "syncdb": "Error: Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?)\nCDP: Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?); Metro events: not connected"
  }
}
```

`get_client_state` reads the client through Hermes over CDP. A web page runs in the browser, not
Hermes, so there is no target even though the store is registered. To check client state on web,
use the `browser` tool (step 8). On iOS or Android, run a development build attached to Metro and
the same call returns the RTK or SyncDB state.

This failure is server-side, so the client check only confirms there is nothing to fix there.

### 6. Fix it

`apiErrorMiddleware` already converts Mongoose validation and cast errors to `APIError`s. It now
also converts body-parser client errors through a new `bodyParserErrorToAPIError` helper in
`api/src/errors.ts`:

```typescript
const apiError = isAPIError(err)
  ? err
  : (mongooseErrorToAPIError(err) ?? bodyParserErrorToAPIError(err));
```

The helper keeps the parser's own 4xx status and message. A malformed body becomes 400
`Malformed request body`, an oversized body 413 `Request body too large`, and an unsupported
charset 415 `Unsupported request body encoding`. Errors body-parser marks as server faults still
fall through to 500. Regression tests in `api/src/errors.test.ts` build an app with the same
middleware order as `TerrenoApp` and fail without the change:

```bash
cd api && bun test src/errors.test.ts
```

Rebuild `@terreno/api` (`bun run compile`) and restart the backend. Check that the old process
has exited first. In this run, the first restart printed
`Server start failed: Error: Failed to start server. Is port 4200 in use?` and the old server kept
answering 500.

### 7. Re-run the symptom

Same request against the restarted backend:

```text
$ curl -s -i -b cookies.txt -X POST localhost:4200/todos -H 'Content-Type: application/json' --data '{"title": "Buy milk", "completed": fals}'
HTTP/1.1 400 Bad Request
X-Powered-By: Express
X-Request-ID: b81e4036-1243-4b0d-a3b4-9e2ec9807664
Vary: Origin
Access-Control-Allow-Credentials: true
Content-Type: application/json; charset=utf-8
Content-Length: 143
Date: Mon, 12 Oct 2026 02:47:11 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":400,"title":"Malformed request body","detail":"JSON Parse error: Unexpected identifier \"fals\"","disableExternalErrorTracking":true}
```

`last_error` has no `since` argument, so it keeps returning the newest error even after a fix. To
prove nothing new failed, ask `read_logs` for error-level backend entries since the restart:

```json
{"name":"read_logs","arguments":{"sources":["backend"],"level":"error","since":"2026-10-12T02:47:10.183Z"}}
```

```json
{
  "connection": "CDP: Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?); Metro events: connected ws://localhost:8282/events",
  "entries": [],
  "projectRoot": "/workspace/.claude/worktrees/agent-a4ec9221d12c64054"
}
```

The request is now logged at `warn` as
`BadRequestError(400): Malformed request body — JSON Parse error: Unexpected identifier "fals"`,
followed by the parser's stack. Query with `level: "warn"` to see it.

### 8. Confirm in the running app

`navigate` drives Expo Router through Hermes, so it has no target on web:

```json
{"name":"navigate","arguments":{"path":"/"}}
```

```json
{
  "error": "Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?)",
  "status": "CDP: Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?); Metro events: not connected"
}
```

On web, use the local `browser` tool instead (it needs `TERRENO_MCP_EVAL=1` for `evaluate`). Open
the app and log in:

```json
{"name":"browser","arguments":{"action":"open","url":"http://localhost:8282/login","width":1280,"height":800}}
{"name":"browser","arguments":{"action":"type","selector":"#login-screen-email-input","text":"test@example.com"}}
{"name":"browser","arguments":{"action":"type","selector":"#login-screen-password-input","text":"testpassword123"}}
{"name":"browser","arguments":{"action":"click","selector":"[data-testid=\"login-screen-submit-button\"]"}}
```

Each step returns the page state, for example the click:

```json
{
  "action": "click",
  "ok": true,
  "selector": "[data-testid=\"login-screen-submit-button\"]",
  "title": "",
  "url": "http://localhost:8282/login"
}
```

On a user's first login, the example app shows one-time Terms of Service and Privacy Policy
consent forms before the Todos screen. The Terms form needs a drawn signature, which `browser`
cannot draw. For a scripted run, sign in with `POST /api/auth/sign-in/email`, list the forms with
`GET /consents/pending`, and accept each one with `POST /consents/respond` and the body
`{"consentFormId": "<id>", "agreed": true, "locale": "en", "signature": "<data URL>"}`. Then
`reload` the page.

Send the same malformed body from the page, the way a web client would:

```json
{"name":"browser","arguments":{"action":"evaluate","code":"fetch(\"http://localhost:4200/todos\", {method: \"POST\", credentials: \"include\", headers: {\"Content-Type\": \"application/json\"}, body: \"{\\\"title\\\": \\\"Buy milk\\\", \\\"completed\\\": fals}\"}).then(async (r) => ({status: r.status, body: await r.json()}))"}}
```

```json
{
  "action": "evaluate",
  "ok": true,
  "result": {
    "status": 400,
    "body": {
      "status": 400,
      "title": "Malformed request body",
      "detail": "JSON Parse error: Unexpected identifier \"fals\"",
      "disableExternalErrorTracking": true
    }
  },
  "title": "",
  "url": "http://localhost:8282/"
}
```

Then take a screenshot of the todo list:

```json
{"name":"browser","arguments":{"action":"screenshot","output":".terreno/pipeline/screens/todos-after-fix.png"}}
```

```json
{
  "action": "screenshot",
  "ok": true,
  "output": "/workspace/.claude/worktrees/agent-a4ec9221d12c64054/.terreno/pipeline/screens/todos-after-fix.png",
  "title": "",
  "url": "http://localhost:8282/"
}
```

The screenshot shows My Todos with `3 todos · 3 remaining · 0 completed`: the seeded todos plus the
single `Buy milk`, with no extra row from the rejected requests. A final `read_logs` for
backend errors since the restart still returned `"entries": []`. The fix is verified.

## A screen crashes on web

A second run used the same setup on ports 4400 and 8482. A new priority badge on each todo row
read `data.priority.toUpperCase()`, and todos created before the field existed have no
`priority`. The Todos screen showed `Something went wrong` with
`Cannot read properties of undefined (reading 'toUpperCase')`.

```json
{"name":"last_error","arguments":{"sources":["backend","browser"]}}
```

```json
{"level":"error","message":"%o\n\n%s\n\n%s\n TypeError: Cannot read properties of undefined (reading 'toUpperCase') The above error occurred in the <SyncTodoItem> component. React will try to recreate this component tree from scratch using the error boundary you provided, Try.","source":"browser","timestamp":"2026-10-12T03:30:28.321+00:00"}
```

React caught the error in an error boundary and reported it with `console.error`, so:

- There is no `stack` field. Only uncaught errors carry one.
- The message starts with React's unformatted `%o` and `%s` placeholders. Read past them.
- The component is named: `<SyncTodoItem>`. Search the code for it and for the property in the
  error, here `toUpperCase`.

`database_query` with `{"priority": {"$exists": false}}` on `todos` returned three rows, which
confirmed that the data, not the server, triggers the crash. `read_logs` with
`sources: ["backend"]` and `level: "error"` returned no entries. Restoring the guard
(`data.priority ? <Badge …/> : null`) fixed it. `navigate` returned the same
`No debuggable Hermes/React Native target` error as in step 8, so the check used `browser`:
`open`, `scroll` to a todo row, then `screenshot`. The row with a priority showed its badge, and the
rows without one rendered.

A later `last_error` may return an unrelated older error, because it has no `since`. Use
`read_logs` with `level: "error"` and `since` set to the time of the fix instead.

## Tool reference

### Read errors and logs

```json
{"name":"last_error","arguments":{"sources":["backend","browser","metro","app"]}}
```

`last_error` returns the newest error-level entry from the selected sources.

```json
{
  "name": "read_logs",
  "arguments": {
    "entries": 100,
    "level": "error",
    "since": "2026-10-12T02:45:02.876Z",
    "sources": ["backend", "browser", "metro", "app"]
  }
}
```

`backend` and `browser` read durable JSONL files under `.terreno/logs/`. `metro` and `app` read
in-memory rings filled from Metro `/events` and Hermes CDP. `connection` explains when a live
source is unavailable.

CLI equivalents:

```bash
terreno logs last-error --sources backend,browser,metro,app
terreno logs --entries 100 --level error --sources backend,browser,metro,app
```

### Inspect client state

Client state lives in `@terreno/syncdb`: synced collections in the local store, and the session in
`SessionProvider`. There is no Redux store to inspect (the `get_rtk_state` tool and
`terreno state --slice` were removed with `@terreno/rtk` in Terreno 58). Use the SyncDB tools in
the next step for data, and `read_logs` / `last_error` above for failed request-client calls.

CLI equivalent of `get_syncdb_state`:

Sensitive fields whose names include `password`, `token`, `secret`, `authorization`, or `cookie` are
returned as `[REDACTED]` in MCP summaries; use them to inspect state, never to retrieve credentials.


The CLI equivalent is:

```bash
terreno state --collection todos
```

### Inspect and change SyncDB state

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
TERRENO_MCP_EVAL=1 bunx -p @terreno/mcp terreno-mcp-local
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

### Drive the web app

The local `browser` tool uses Bun 1.4's built-in WebView:

```json
{"name":"browser","arguments":{"action":"open","url":"http://localhost:8082"}}
{"name":"browser","arguments":{"action":"wait","timeout":1000}}
{"name":"browser","arguments":{"action":"click","selector":"[data-testid=save]"}}
{"name":"browser","arguments":{"action":"snapshot"}}
{"name":"browser","arguments":{"action":"screenshot","output":"/opt/cursor/artifacts/save-result.png"}}
{"name":"browser","arguments":{"action":"close"}}
```

The session persists between MCP calls. `snapshot` returns visible text and up to 200 interactive
elements so the agent can choose selectors and verify state without image guessing. `wait` sleeps
for `timeout` milliseconds; it does not wait for a selector. `screenshot` saves the viewport, and
its `output` must be under the project root or `/opt/cursor/artifacts`. `evaluate` requires
`TERRENO_MCP_EVAL=1`.
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

### Verify a native fix in the running app

Navigation and arbitrary evaluation are disabled by default. Opt in only for local debugging:

```bash
TERRENO_MCP_EVAL=1 bunx -p @terreno/mcp terreno-mcp-local
```

Then call `navigate` with `{"path":"/profile"}` or run:

```bash
TERRENO_MCP_EVAL=1 terreno navigate /profile
```

Confirm the target screen renders, then call `read_logs` with `level: "error"` and `since` set to
the navigation time. A successful fix returns no entries.

## Connection problems

- Upgrade to Bun 1.4 or newer when `Bun.WebView requires Bun 1.4 or newer` appears.
- Set `BUN_CHROME_PATH` if WebView cannot discover Chrome, Chromium, or Edge on Linux or Windows.
- Set `TERRENO_PROJECT_ROOT` if logs or package versions come from the wrong directory.
- Set `TERRENO_METRO_URL` if Metro is not on the frontend script's `--port`.
- Close React Native DevTools when Hermes reports another debugger connection.
- Use only `backend,browser` sources when Metro is intentionally stopped.
- Expect `No debuggable Hermes/React Native target` from `get_client_state`, `navigate`, and
  `evaluate` on web. Those tools need an iOS or Android build attached to Metro.
