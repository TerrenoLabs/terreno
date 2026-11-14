# @terreno/cli

Install: `bun add -g @terreno/cli` then run `terreno --help`.

The `terreno` binary is the operator CLI for Terreno apps. It wraps documentation search, codegen (syncdb collection SDK, typed API request SDK, Mongoose models, routes, screens, forms, admin install notes), app bootstrap, local project tools from `@terreno/mcp`, and **OpenAPI-driven REST calls**.

**Agents: use the CLI.** Every tool on the hosted `terreno` and local `terreno-local` MCP servers
is a `terreno` command that calls the same handler, so a shell is enough: no MCP configuration,
no editor. The tool-to-command table is in
[MCP server reference](mcp-server.md#cli-equivalents); the debugging workflow is
[Debug a Terreno app with MCP](../how-to/debug-with-mcp.md).

Generate an app-specific CLI from your backend spec:

```bash
terreno generate rest-cli --schema http://localhost:4000/openapi.json --out ./tools/app-cli --name myapp
```

## Commands

| Command | What it does |
| --- | --- |
| `docs search <query>` | Search Terreno docs (`--packages api,ui`, `--token-limit`) |
| `docs component <Name>` | Print `@terreno/ui` component props |
| `docs upgrade --from --to` | Lockstep upgrade notes |
| `docs notes search <query>` | Search update notes: bundled upgrade notes, plus announcements when `TERRENO_HELP_API_URL` is set (`--source auto\|bundled\|announcement`, `--limit`, `--include-archived`) |
| `docs notes get <id>` | Full text of one update note, for example `upgrade:57.3.0` |
| `docs notes ask <question>` | Ranked excerpts that answer a question about what changed (`--limit`) |
| `generate syncdb` | Typed syncdb hooks from OpenAPI (`--schema`, `--out`, `--collections`, `--config`, `--no-format`) |
| `generate sdk` | Typed request hooks (`apiSdk.ts`) for every non-synced route via the syncdb codegen (`--schema`, `--out`, `--config`, `--no-format`); same output as `terreno-syncdb-codegen --api-out`. A legacy RTK `--config openapi-config.ts` alone is rejected |
| `generate rest-cli` | Scaffold a bun CLI from OpenAPI (`--schema`, `--out`, `--name`, `--base-url`) |
| `generate model` | Mongoose model (`--name`, `--field name:Type:required`, `--owner`, `--soft-delete`) |
| `generate route` | `modelRouter` module (`--model-name`, `--route-path`, `--owner-filtered`, `--query-fields`, `--sort`) |
| `generate screen` | UI screen (`--name`, `--type list\|detail\|form\|empty`) |
| `generate form` | Form fields (`--field name:type:required:label=Label`) |
| `generate admin` | Admin install snippets (`--model Model:/path:Display:field,field`) |
| `bootstrap app` | Full-stack app files (`--name`, `--display-name`, `--dir`, `--description`, `--mcp-url`, `--terreno-path <checkout>`) |
| `bootstrap rules` | Editor AI rules only (`--packages api,ui`) |
| `validate schema --file` | Check a Mongoose schema against conventions |
| `validate blocks --file` | Check a whole-reply YAML or JSON agent UI block document; same report and exit code as `terreno-blocks validate` (exit 1 when invalid; `--json` gives `ok: false`) |
| `api list` | List operations from `--schema` or `TERRENO_OPENAPI` |
| `api call <operationId>` | Invoke by OpenAPI operation id |
| `api request <METHOD> <path>` | Invoke by method + path template |
| `login` | Sign in and save a token for `api` (`--email`, `--password`, `--base-url`, `--auth-path`, `--print-token`, `--no-save`) |
| `logout` | Remove the saved token |
| `info` | Local `@terreno/*` versions (via MCP local tools) |
| `logs` | Merge backend/browser JSONL, Metro events, and app CDP console (`--entries`, `--level`, `--since`, `--sources`; `last-error`) |
| `state` | Inspect the live SyncDB client (`get_syncdb_state`): status, entities, outbox, conflicts, cursors, streams, debug events (`--collection`, `--entity-id`, `--limit`, `--name`, `--no-events`). Needs `createSyncDb({debug: true})`. The Terreno 57 `--slice` / `--query` Redux flags were removed in 58 and now exit 1 |
| `syncdb state` | Same as `state` |
| `syncdb action <action>` | Change the live SyncDB client (`syncdb_action`): `mutate`, `setLocalEntity`, `deleteLocalEntity`, `flush`, `reconcile`, `forceResync`, `resolveConflict`, `retryFailed`, `goOffline`, `goOnline`, `clearDebug`, `mergeSnapshot`. Requires `TERRENO_MCP_EVAL=1` |
| `syncdb snapshot <action>` | `capture`, `list`, `get <id>`, `compare --snapshot-id --other-snapshot-id`, `delete <id>` (`syncdb_snapshot`). Captures live in the CLI session |
| `storage read` | Dev AsyncStorage keys registered with `registerTerrenoDevStorage()` (`--keys a,b`, `--prefix`) |
| `storage write` | Write one key (`--key`, `--value`; requires `TERRENO_MCP_EVAL=1`) |
| `dev list` | Dev commands registered with `registerTerrenoDevCommand()` |
| `dev run <name>` | Invoke one (`--args <json>`; requires `TERRENO_MCP_EVAL=1`) |
| `dispatch <type>` | Dispatch a dev client action (`--payload <json>`; requires `TERRENO_MCP_EVAL=1`) |
| `eval` | Evaluate JavaScript in the app runtime through Metro CDP (`--code`; requires `TERRENO_MCP_EVAL=1`) |
| `navigate` | Navigate Expo Router through Metro CDP (requires `TERRENO_MCP_EVAL=1`) |
| `web [url]` | Automate the web app with Bun 1.4 `Bun.WebView` in one process; ordered `--action` JSON, `--snapshot`, and `--screenshot` |
| `browser <action>` | Drive one web page across commands: `open [url]`, `click`, `type`, `press`, `scroll`, `evaluate`, `snapshot`, `screenshot`, `back`, `forward`, `reload`, `wait`, `close`. The page lives in the CLI session |
| `db schema` | Mongo collections (`--collection-filter`, `--summary`) |
| `db query` | Read-only Mongo (`--collection`, `--operation`, `--filter`, `--pipeline`, `--field`, `--limit`) |
| `tool list` | Every MCP tool, local and hosted, with its server (`--local`, `--hosted`; `--json` adds input schemas) |
| `tool schema <name>` | One tool's description and input schema |
| `tool call <name>` | Call any MCP tool by name (`--args <json>` or `--args-file <path>`) |
| `session start\|stop\|status` | The background process that keeps browser and snapshot state (`--idle-minutes`, default 30; `0` never idles out) |

Global flags: `--json`, `--help` / `-h`, `--version` / `-v`.

Use `bootstrap app --terreno-path <checkout>` for unpublished Terreno versions. Run
`bun run compile` in that checkout first. The command packs the app's Terreno dependencies
and their transitive Terreno dependencies into `vendor/terreno`, then sets relative `file:`
dependencies and overrides in both app manifests. JSON and text output list the linked packages;
the generated files do not record the checkout path. The generated Dockerfile copies only
`backend/`, so it cannot install `file:` dependencies from `vendor/` without being changed.

## Any MCP tool by name

`terreno tool` reaches every tool the MCP servers define, including one added after this page
was written. Arguments are the JSON object the MCP tool takes.

```bash
terreno tool list
terreno tool schema syncdb_action
terreno tool call read_logs --args '{"level":"error","sources":["backend"]}'
terreno tool call terreno_search_docs --args '{"queries":["modelRouter permissions"]}'
```

## CLI session

A command is one process, so anything it holds is gone when it exits. Two kinds of state need to
outlive a command: the open browser page and SyncDB snapshots. They live in a **CLI session**: a
background `terreno` process for the project that listens on a loopback port and requires a
token.

- `terreno browser` and `terreno syncdb snapshot` start the session when none is running and say
  so on stderr. `terreno session start` starts it explicitly.
- While a session runs, every local command (`logs`, `state`, `db`, `navigate`, ...) goes through
  it, so they share its one Hermes debugger connection.
- `terreno web` always runs in its own process and never touches the session's page.
- `TERRENO_MCP_EVAL` is read from each command's own environment and sent with the call. A
  gated tool runs only when the command that asked for it opted in, whatever the session was
  started with. The session runs one call at a time.
- Two commands that start at once share one session: a lock file lets only one of them spawn it.
  `terreno session stop` also ends a session process that is alive but no longer answering.
- It exits after 30 idle minutes, or on `terreno session stop`. Snapshots and the open page are
  gone when it exits.

State is under `.terreno/cli/` at the project root (`TERRENO_PROJECT_ROOT`, or the nearest
directory with `backend/` + `frontend/`): `session.json` (port, pid, token), `session.lock`
(held only while a session starts), `session.log`, and
`auth.json` from `terreno login`. The directory gets its own `.gitignore` that ignores everything
in it, and the JSON files are mode `600`.

## Step-by-step web driving

Use `terreno browser` when the next step depends on what the page shows:

```bash
terreno browser open http://localhost:8082
terreno browser snapshot
terreno browser type --selector 'input[name=email]' --text test@example.com
terreno browser press --key Enter
terreno browser screenshot --output /opt/cursor/artifacts/login.png
terreno browser close
```

Options: `--selector`, `--text`, `--key`, `--modifiers Shift,Control,Alt,Meta`, `--output`,
`--code` (for `evaluate`; requires `TERRENO_MCP_EVAL=1` in the session), `--x` / `--y`,
`--timeout`, and for `open`: `--width`, `--height`, `--data-dir`. `open` defaults to
`TERRENO_WEB_URL`, then `http://localhost:8082`. The path rules match `web`.

## Web app automation

Run an interaction sequence and save proof from the final rendered state:

```bash
terreno web http://localhost:8082 \
  --action '{"action":"click","selector":"#login"}' \
  --action '{"action":"type","selector":"input[name=email]","text":"test@example.com"}' \
  --action '{"action":"press","key":"Enter"}' \
  --snapshot \
  --screenshot /opt/cursor/artifacts/login.png
```

The command requires Bun 1.4 or newer and uses its built-in headless `Bun.WebView`; Chrome,
Chromium, or Edge must be installed on Linux and Windows. Actions run in argument order with
native trusted input. Supported actions are `click`, `type`, `press`, `scroll`, `evaluate`,
`snapshot`, `screenshot`, `back`, `forward`, `reload`, and `wait`. Use `--actions-file <path>` for a
JSON array, `--width` / `--height` for the viewport, `--wait` to change the initial 1000 ms
client-render delay, and `--data-dir` to persist cookies and browser storage. The URL defaults to
`TERRENO_WEB_URL`, then `http://localhost:8082`. The CLI manages `open` and `close` around the
sequence. Set `TERRENO_MCP_EVAL=1` before using an `evaluate` action. Screenshot paths must stay
under the project root or `/opt/cursor/artifacts`; browser data must stay under the project root.

## REST auth

| Flag / env | Purpose |
| --- | --- |
| `--token` / `TERRENO_TOKEN` | Bearer token. Without either, `api` sends the token saved by `terreno login` when the API origin matches |
| `--base-url` / `TERRENO_API_URL` | Override `servers[0].url`. When the spec lists no servers and `--schema` is an `http(s)` URL, `terreno api` uses that URL's origin |
| `--header "Name: value"` | Extra headers (repeatable) |
| `--param name=value` | Path or query parameter |
| `--body` / `--body-file` | JSON body |

### Log in

```bash
terreno login --email test@example.com --password testpassword123 --base-url http://localhost:4000
terreno api call todo_list --schema http://localhost:4000/openapi.json
```

`login` posts to Better Auth (`<base-url>/api/auth/sign-in/email`; change the path with
`--auth-path`) and falls back to the JWT route `/auth/login`. It saves the token to
`.terreno/cli/auth.json` with the API origin it came from; `api` sends it only to that origin.
`TERRENO_EMAIL` and `TERRENO_PASSWORD` replace the flags and keep the password out of shell
history. `--print-token` prints the token for `TERRENO_TOKEN=...`, `--no-save` skips the file,
and `terreno logout` deletes it. Generated app CLIs (`generate rest-cli`) do not read the saved
token; pass `--token`.

Library entry for generated app CLIs:

```ts
import {runAppRestCli} from "@terreno/cli";

await runAppRestCli({
  argv: process.argv.slice(2),
  binName: "myapp",
  specText: openApiJson,
  title: "My API",
});
```

See [Generate a REST CLI from OpenAPI](../how-to/generate-a-rest-cli.md).
