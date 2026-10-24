# Set up Terreno MCP

Configure both Terreno servers: the hosted server supplies documentation and generators; the local
stdio server inspects the app, database, logs, Metro, and Redux state.

Install Bun 1.4 or newer to enable the local server's built-in WebView browser automation.

## Cursor

Add `.cursor/mcp.json` at the app repository root:

```json
{
  "mcpServers": {
    "terreno": {
      "type": "http",
      "url": "https://mcp.terreno.flourish.health/mcp"
    },
    "terreno-local": {
      "command": "bunx",
      "args": ["terreno-mcp-local"]
    }
  }
}
```

## Claude Code

Use the same project-scoped `.mcp.json`, or register the servers from the repository root:

```bash
claude mcp add --transport http terreno https://mcp.terreno.flourish.health/mcp
claude mcp add terreno-local -- bunx terreno-mcp-local
```

## Configure local discovery

Run the local server from the app root. It discovers bootstrap apps with `backend/` and `frontend/`,
and this monorepo's `example-backend/` logs. Set these variables only when discovery needs help:

| Variable | Use |
| --- | --- |
| `TERRENO_PROJECT_ROOT` | Absolute app/monorepo root |
| `TERRENO_METRO_URL` | Metro origin when the frontend script does not expose `--port` |
| `MONGO_URI` | MongoDB used by `database_schema` and read-only `database_query` |
| `TERRENO_MCP_EVAL=1` | Explicitly enable `evaluate`, `navigate`, and SyncDB state changes |
| `BUN_CHROME_PATH` | Chrome/Chromium/Edge binary when Bun cannot auto-discover one |

Backend and browser JSONL normally live under `<backend cwd>/.terreno/logs/`. Keep Metro running to
collect Metro `/events` and app console output over CDP. Hermes accepts one debugger connection, so
close React Native DevTools if the local MCP reports that CDP is unavailable.

## Verify

Restart the editor's MCP clients, then ask it to call `application_info`. Confirm the result lists
the app's installed `@terreno/*` versions. Next call `read_logs` with
`{"sources":["backend","browser"]}`; an empty `entries` array is valid before the app logs anything.
Call `browser` with `{"action":"open","url":"http://localhost:8082"}`, then `{"action":"snapshot"}`
to confirm the agent can inspect the running web app. Finish with `{"action":"close"}`.
If the app creates a SyncDB client with `debug: true`, call
`get_syncdb_state` and confirm it returns the client name, status, collections,
outbox, conflicts, cursors, and debug events.

The CLI exposes the same local tools without MCP:

```bash
terreno info
terreno logs --sources backend,browser
```
