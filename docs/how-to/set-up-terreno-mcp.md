# Set up Terreno MCP

Connect your editor to both Terreno MCP servers:

- **`terreno`** (hosted, Streamable HTTP) supplies documentation search and code generators.
- **`terreno-local`** (stdio, runs in your repository) reads the app's packages, database, logs,
  Metro, and client state.

Apps made with `create-terreno-app` already contain both configurations. Use this guide to check
them, to add them to an older app, or to fix a server that does not connect.

Prerequisites: Bun 1.4 or newer. The local server's bin is `#!/usr/bin/env bun`, and its `browser`
tool needs Bun 1.4.

## 1. Configure Cursor

Create `.cursor/mcp.json` at the app repository root. This is the file `create-terreno-app` writes:

```json
{
  "mcpServers": {
    "expo": {
      "type": "http",
      "url": "https://mcp.expo.dev/mcp"
    },
    "playwright": {
      "args": [
        "-y",
        "@playwright/mcp@0.0.76"
      ],
      "command": "npx"
    },
    "terreno": {
      "type": "http",
      "url": "https://mcp.terreno.app/mcp"
    },
    "terreno-local": {
      "args": [
        "-p",
        "@terreno/mcp",
        "terreno-mcp-local"
      ],
      "command": "bunx"
    }
  }
}
```

Only `terreno` and `terreno-local` are required. `expo` and `playwright` are optional; see
[step 5](#5-optional-add-expo-mcp-and-playwright-mcp).

Keep `-p @terreno/mcp` in the `terreno-local` args. The bin is named `terreno-mcp-local`, but the
npm package is `@terreno/mcp`. Without `-p`, `bunx` looks for an npm package named
`terreno-mcp-local`, gets a 404, and the server never starts.

Open the app repository root as the Cursor workspace. Then open Cursor's MCP settings and confirm
each server is enabled and lists its tools. If `terreno-local` reports the wrong project root, set
`TERRENO_PROJECT_ROOT` in its entry (step 4).

## 2. Configure Claude Code

Claude Code reads project servers from `.mcp.json` at the repository root. `create-terreno-app`
writes the same content there as in `.cursor/mcp.json`, so the two files are byte-for-byte
identical:

```json
{
  "mcpServers": {
    "expo": {
      "type": "http",
      "url": "https://mcp.expo.dev/mcp"
    },
    "playwright": {
      "args": [
        "-y",
        "@playwright/mcp@0.0.76"
      ],
      "command": "npx"
    },
    "terreno": {
      "type": "http",
      "url": "https://mcp.terreno.app/mcp"
    },
    "terreno-local": {
      "args": [
        "-p",
        "@terreno/mcp",
        "terreno-mcp-local"
      ],
      "command": "bunx"
    }
  }
}
```

Run `claude` from the repository root. On the first run, Claude Code asks you to approve the
project's servers. Approve them. Then check the servers:

```bash
claude mcp list
```

A server you have not approved yet is listed as `⏸ Pending approval`. After approval, each server
reports `✔ Connected`.

To register the two Terreno servers without editing the file, run these commands from the
repository root. `--scope project` writes the servers to `.mcp.json`:

```bash
claude mcp add --scope project --transport http terreno https://mcp.terreno.app/mcp
claude mcp add --scope project terreno-local -- bunx -p @terreno/mcp terreno-mcp-local
```

## 3. Check the hosted endpoint

The hosted server's URL is `https://mcp.terreno.app/mcp`. It speaks MCP Streamable HTTP
(`"type": "http"`). `POST /` is accepted as an alias, but configure the `/mcp` path. Requests must
send `Accept: application/json, text/event-stream`; MCP clients do this for you.
`create-terreno-app` writes this URL into `.cursor/mcp.json` and `.mcp.json`. Use
`--mcp-server-url` to point a new app at a different deployment.

Check that the host answers:

```bash
curl -s https://mcp.terreno.app/
```

A working host returns `{"mcpEndpoint":"/mcp","service":"terreno-mcp","status":"ok"}`. If the
command prints `Could not resolve host: mcp.terreno.app`, or the editor reports
`getaddrinfo ENOTFOUND mcp.terreno.app`, that hostname does not resolve yet. Until it does, set the
`terreno` URL to `https://mcp.terreno.flourish.health/mcp` in `.cursor/mcp.json` and `.mcp.json`. It
serves the same service and tools.

### Moving off `mcp.terreno.flourish.health`

Earlier docs and scaffolds used `https://mcp.terreno.flourish.health/mcp`. That hostname serves the
same Cloud Run service and keeps working for at least one release after the release that announces
`mcp.terreno.app`. Replace the old URL in `.cursor/mcp.json`, `.mcp.json`, and any
`claude mcp add` registration:

For a project `.mcp.json`, edit the `url` in the file. For a registration you added with
`claude mcp add` outside the project file, re-add it in the same scope:

```bash
claude mcp remove --scope local terreno
claude mcp add --scope local --transport http terreno https://mcp.terreno.app/mcp
```

The operator cutover (domain mapping, DNS, retiring the old hostname) is in the
[terraform README](https://github.com/TerrenoLabs/terreno/blob/master/terraform/README.md#hosted-mcp-hostname).

## 4. Give the local server what it needs

`terreno-local` starts without any of the items below, but each tool reads only what it can find.
The full rules are in the
[local server reference](../reference/mcp-server.md#local-server-terreno-mcp-local).

| Need | What to do |
| --- | --- |
| Project root | Start the editor in the app repository root. The server walks up from its working directory looking for a `package.json` with `backend/` and `frontend/` workspaces, and otherwise uses the working directory itself. Apps from `create-terreno-app` have no root `package.json`, so the walk-up never matches from a subfolder: start the editor at the app root or set `TERRENO_PROJECT_ROOT`. |
| A reachable MongoDB | Put `MONGO_URI` in `backend/.env` (`create-terreno-app` does this) or export it. `database_schema` and `database_query` use it. |
| Backend log file | Run the backend with `bun run dev`. Outside production the `@terreno/api` logger writes `backend/.terreno/logs/app.log`, which `read_logs` and `last_error` read. |
| Metro for app logs | Keep `bun run web` (or `start`, `ios`, `android`) running in `frontend/`. The server reads Metro on the script's `--port` (8082 in generated apps). Set `TERRENO_METRO_URL` for another origin. |

Set environment variables for the server in its config entry with `env`. For example, to point the
server at a root and allow the gated tools:

```json
"terreno-local": {
  "args": [
    "-p",
    "@terreno/mcp",
    "terreno-mcp-local"
  ],
  "command": "bunx",
  "env": {
    "TERRENO_MCP_EVAL": "1",
    "TERRENO_PROJECT_ROOT": "/absolute/path/to/my-app"
  }
}
```

`TERRENO_MCP_EVAL=1` enables `evaluate`, `navigate`, and SyncDB state changes; leave it out unless
you need them. Every variable is listed under
[Environment variables](../reference/mcp-server.md#environment-variables).

Hermes accepts one debugger connection. Close React Native DevTools if the local server reports
that CDP is unavailable.

## 5. Optional: add expo-mcp and Playwright MCP

`create-terreno-app` adds two more servers next to the Terreno ones. Keep them when you want the
agent to drive the app, or delete their entries from both files:

- **`expo`** (`https://mcp.expo.dev/mcp`) takes screenshots and taps in the iOS simulator or
  Android emulator. It asks you to sign in with your Expo account the first time it connects. Its
  simulator tools also need the `expo-mcp` dev package in the app
  (`cd frontend && bunx expo install expo-mcp --dev`) and a dev server started with
  `EXPO_UNSTABLE_MCP_SERVER=1`, which the generated frontend scripts already set. See
  [Expo MCP Server](https://docs.expo.dev/eas/ai/mcp/).
- **`playwright`** (`npx -y @playwright/mcp@0.0.76`) drives the web app in a full browser. The
  version is pinned so `npx` does not resolve a moving `@latest`.

These servers interact with the app. Terreno's servers observe what the app did behind the screen.
Read [How this composes](../explanation/ai-development-loop.md#how-this-composes) for the division
of labor, including when a flow should become a Maestro test.

## 6. Verify

1. Restart the editor's MCP clients.
2. Ask the agent: "Call the `application_info` tool from `terreno-local`."
3. Confirm the result lists your app's `@terreno/*` packages. For an app generated with
   `create-terreno-app` and no `bun install` yet, the result is (project root shortened):

   ```markdown
   # Application info

   - **projectRoot**: `…/setup-check`
   - **root package**: (none) @ ?
   - **bun.lock present**: no

   ## Backend workspace (backend/)
   - **name**: @setup-check/backend
   - **version**: 1.0.0
   - @terreno/admin-backend: ^57.14.0
   - @terreno/api: ^57.14.0
   - @terreno/api-health: ^57.14.0
   - **mongoose**: 9.7.4
   - **@types/bun**: ^1.4.0

   ## Frontend workspace (frontend/)
   - **name**: @setup-check/frontend
   - **version**: 1.0.0
   - @terreno/admin-frontend: ^57.14.0
   - @terreno/rtk: ^57.14.0
   - @terreno/syncdb: ^57.14.0
   - @terreno/ui: ^57.14.0
   - **expo**: ~57.0.14
   - **react**: 19.2.3
   - **react-native**: 0.86.2
   - **@types/bun**: ^1.4.0
   ```

   The versions are the ranges declared in each `package.json`, not resolved versions. If
   `projectRoot` is not your app, set `TERRENO_PROJECT_ROOT` (step 4).
4. Ask the agent to call `terreno_search_docs` from `terreno` with any query. A list of doc results
   confirms the hosted server.

With the backend and frontend running, check the runtime tools too:

- Call `read_logs` with `{"sources":["backend","browser"]}`. An empty `entries` array is valid
  before the app logs anything. A `create-terreno-app` app sends web console errors and warnings
  to the backend with `installTerrenoDevConsoleLogger({baseUrl})` in `frontend/app/_layout.tsx`.
  Its `backend/.env` sets `NODE_ENV=development`, which the backend needs to accept them. In
  another app, add the same call at startup and run the backend with `NODE_ENV=development` or
  `TERRENO_BROWSER_LOGS=true`.
- Call `browser` with `{"action":"open","url":"http://localhost:8082"}`, then
  `{"action":"snapshot"}`, to confirm the agent can inspect the web app. Finish with
  `{"action":"close"}`.
- If the app creates its SyncDB client with `debug: true`, call `get_syncdb_state` and confirm it
  returns the client name, status, collections, outbox, conflicts, cursors, and debug events.

The CLI exposes the same local tools without MCP:

```bash
terreno info
terreno logs --sources backend,browser
```

## Related

- [MCP server reference](../reference/mcp-server.md): every tool, variable, and discovery rule
- [Debug a Terreno app with MCP](debug-with-mcp.md): the loop on a real failure
- [AI development loop](../explanation/ai-development-loop.md): how the servers fit together
