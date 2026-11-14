export const HELP_TEXT = `Usage: terreno <command> [options]

The Terreno CLI wraps docs search, generators, bootstrap, local project tools,
and OpenAPI REST calls for Terreno apps. Every MCP tool is reachable here, so an
agent with a shell needs no MCP configuration.

Commands:
  docs search <query...>          Search Terreno documentation
  docs component <Name>           Print @terreno/ui component props
  docs upgrade --from --to        Print lockstep upgrade notes
  docs notes <search|get|ask>     Search, read, or ask about update notes

  generate syncdb                 Generate typed syncdb hooks from OpenAPI
  generate sdk                    Generate typed request hooks (apiSdk.ts) from OpenAPI
  generate rest-cli               Scaffold an app CLI from OpenAPI
  generate model                  Generate a Mongoose model
  generate route                  Generate a modelRouter module
  generate screen                 Generate a @terreno/ui screen
  generate form                   Generate form fields
  generate admin                  Print admin-panel install snippets

  bootstrap app                   Write a full-stack Terreno app
  bootstrap rules                 Write AI editor rules

  validate schema --file          Check a Mongoose schema against conventions
  validate blocks --file          Check an agent UI block document

  api list                        List REST operations from an OpenAPI spec
  api call <operationId>          Invoke one OpenAPI operation
  api request <METHOD> <path>     Invoke by HTTP method and path
  login / logout                  Sign in and save a token for terreno api

  info                            Print local @terreno/* versions
  logs                            Merge backend, browser, Metro, and app logs
  state                           Inspect the live SyncDB client (entities, outbox, conflicts)
  eval                            Evaluate JavaScript through Metro CDP
  navigate                        Navigate the Expo app through Metro CDP
  web [url]                       Drive the web app with Bun.WebView (one sequence)
  browser <action>                Drive the web app one step at a time (keeps the page open)
  syncdb action <action>          Change the live SyncDB client (flush, reconcile, mutate, ...)
  syncdb snapshot <action>        Capture, list, get, compare, or delete SyncDB snapshots
  storage <read|write>            Read or write the app's dev AsyncStorage registry
  dev <list|run>                  List or run app-registered dev commands
  dispatch <type>                 Dispatch a dev client action
  db schema                       List Mongo collections
  db query                        Run a read-only Mongo query

  tool list                       List every MCP tool (local and hosted)
  tool schema <name>              Print one tool's input schema
  tool call <name> --args <json>  Call any MCP tool by name
  session <start|stop|status>     Background process that keeps browser and snapshot state

Global options:
  --json                          Machine-readable output where supported
  --help, -h                      Show this help
  --version, -v                   Print CLI version

REST auth:
  --token / TERRENO_TOKEN         Bearer token
  --base-url / TERRENO_API_URL    Override spec servers[0].url
  --header "Name: value"          Extra headers (repeatable)

Examples:
  terreno docs search modelRouter --packages api
  terreno generate syncdb --schema http://localhost:4000/openapi.json --out store/syncDbSdk.ts
  terreno generate sdk --schema http://localhost:4000/openapi.json --out store/apiSdk.ts
  terreno api list --schema http://localhost:4000/openapi.json
  terreno api call todo_list --schema ./openapi.json --param limit=10
  terreno generate rest-cli --schema ./openapi.json --out ./tools/app-cli --name myapp
  terreno web http://localhost:8082 --snapshot --screenshot /opt/cursor/artifacts/app.png
  terreno browser open http://localhost:8082 && terreno browser snapshot
  terreno syncdb snapshot capture && terreno syncdb action flush
  terreno login --email test@example.com --password testpassword123
  terreno tool call read_logs --args '{"level":"error"}'
`;

export const commandHelp = (command: string): string => {
  const sections: Record<string, string> = {
    api: `Usage: terreno api <list|call|request> [options]

  list                         Print operation ids, methods, and paths
  call <operationId>           Invoke by OpenAPI operationId
  request <METHOD> <path>      Invoke by method + path template

Options:
  --schema <url|path>          OpenAPI document (or TERRENO_OPENAPI)
  --base-url <url>             API origin
  --token <token>              Bearer token
  --header <Name: value>       Extra header (repeatable)
  --param <name=value>         Path or query parameter (repeatable)
  --body <json>                JSON request body
  --body-file <path>           JSON body from file
  --json                       Print raw JSON only
`,
    bootstrap: `Usage: terreno bootstrap <app|rules> --name <kebab> --display-name <title> [--dir <path>]

  app     Write frontend + backend + rules + MCP config
  rules   Write editor rules only

Options:
  --description <text>
  --mcp-url <url>
  --terreno-path <checkout>    Pack compiled checkout packages for unpublished Terreno versions (app only)
  --packages api,ui,syncdb     Guideline packages for rules
`,
    browser: `Usage: terreno browser <action> [url] [options]

Drives one web page across commands. The page lives in the CLI session, which this command
starts when none is running (stop it with terreno session stop).

Actions: open, click, type, press, scroll, evaluate, snapshot, screenshot, back, forward,
reload, wait, close.

Options:
  --selector <css>              Target for click, type, or scroll
  --text <text>                 Text inserted by type
  --key <name>                  Key for press; --modifiers Shift,Control,Alt,Meta
  --output <path>               Screenshot path (.png, .jpg, .webp)
  --code <javascript>           Expression for evaluate (requires TERRENO_MCP_EVAL=1)
  --x / --y <pixels>            Scroll deltas
  --timeout <milliseconds>      Selector wait, or the wait action's duration
  --width / --height <pixels>   Viewport for open
  --data-dir <path>             Persist cookies and browser storage for open

Examples:
  terreno browser open http://localhost:8082
  terreno browser snapshot
  terreno browser click --selector '[data-testid="login-submit-button"]'
  terreno browser screenshot --output /opt/cursor/artifacts/login.png
  terreno browser close
`,
    db: `Usage: terreno db <schema|query> [options]

  schema [--collection-filter <substr>] [--summary]
  query --collection <name> --operation find|aggregate|countDocuments|distinct
        [--filter <json>] [--pipeline <json>] [--field <name>] [--limit <n>]
`,
    dev: `Usage: terreno dev <list|run>

  list                         Dev commands registered with registerTerrenoDevCommand()
  run <name> [--args <json>]   Invoke one (requires TERRENO_MCP_EVAL=1)
`,
    dispatch: `Usage: terreno dispatch <type> [--payload <json>]

Dispatches a dev client action registered with registerTerrenoDevClientDispatch.
Requires TERRENO_MCP_EVAL=1. Use terreno syncdb action for synced collection writes.
`,
    docs: `Usage: terreno docs <search|component|upgrade|notes>

  search <query...> [--packages api,ui] [--token-limit 3000]
  component <Name>
  upgrade --from <semver> --to <semver>
  notes search <query...> [--source auto|bundled|announcement] [--limit 10] [--include-archived]
  notes get <id>               e.g. upgrade:57.3.0
  notes ask <question...> [--limit 5]
`,
    eval: `Usage: terreno eval --code <javascript>

Requires TERRENO_MCP_EVAL=1. Evaluates JavaScript in the app runtime through Metro CDP.
`,
    generate: `Usage: terreno generate <target> [options]

  syncdb --schema <url|path> --out <file> [--collections a,b] [--config <json>] [--no-format]
  sdk --schema <url|path> --out <file> [--config <json>] [--no-format]
  rest-cli --schema <url|path> --out <dir> --name <bin> [--base-url <url>]
  model --name Todo --field title:String:required [--owner] [--soft-delete] [--out file]
  route --model-name Todo --route-path /todos [--owner-filtered] [--sort -created] [--out file]
  screen --name TodoList --type list|detail|form|empty [--model-name Todo] [--out file]
  form --field title:text:required [--out file]
  admin --model Todo:/todos:Todos:title,completed
`,
    info: `Usage: terreno info

Prints the project root and the @terreno/*, Expo, React Native, and Mongoose versions in use.
`,
    login: `Usage: terreno login --email <email> --password <password> [options]

Signs in with Better Auth (falls back to JWT /auth/login) and saves the token under
.terreno/cli/ in the project. terreno api sends it when no --token or TERRENO_TOKEN is set
and the API origin matches. terreno logout removes it.

Options:
  --base-url <url>             API origin (default TERRENO_API_URL, then http://localhost:4000)
  --auth-path <path>           Better Auth base path (default /api/auth)
  --print-token                Print the token (for TERRENO_TOKEN=...)
  --no-save                    Do not write the token to disk

TERRENO_EMAIL and TERRENO_PASSWORD replace the flags and keep the password out of shell history.
`,
    logs: `Usage: terreno logs [--entries 80] [--level error] [--since <ISO>] [--sources backend,browser,metro,app]

  last-error [--sources backend,browser,metro,app]
`,
    navigate: `Usage: terreno navigate <path>

Requires TERRENO_MCP_EVAL=1. Navigates an Expo Router app through Metro CDP.
`,
    session: `Usage: terreno session <start|stop|status> [--idle-minutes 30]

A session is a background process for this project that keeps what a single command cannot:
the open browser page (terreno browser), SyncDB snapshots (terreno syncdb snapshot), and the
one Hermes debugger connection. While it runs, every local command goes through it.
terreno browser and terreno syncdb snapshot start it for you. It exits after 30 idle minutes;
--idle-minutes 0 keeps it until terreno session stop.
`,
    state: `Usage: terreno state [--collection <name>] [--entity-id <id>] [--limit <n>] [--name <client>] [--no-events]

Reads a live SyncDB client created with createSyncDb({debug: true}) through the local MCP
get_syncdb_state tool (in-process registry or Metro CDP): status, entities, outbox, conflicts,
cursors, streams, and debug events. Sensitive fields are redacted. Change the client with
terreno syncdb action and capture or compare it with terreno syncdb snapshot.
`,
    storage: `Usage: terreno storage <read|write>

  read [--keys a,b] [--prefix p]     Keys registered through registerTerrenoDevStorage()
  write --key <key> --value <string> Requires TERRENO_MCP_EVAL=1
`,
    syncdb: `Usage: terreno syncdb <state|action|snapshot>

  state [--collection <name>] [--entity-id <id>] [--limit <n>] [--name <client>] [--no-events]

  action <mutate|setLocalEntity|deleteLocalEntity|flush|reconcile|forceResync|resolveConflict|
          retryFailed|goOffline|goOnline|clearDebug|mergeSnapshot>
         [--collection <name>] [--id <id>] [--data <json>] [--operation create|update|delete]
         [--deleted] [--seq <n>] [--stream <name>] [--mutation-id <id>] [--max-attempts <n>]
         [--strategy useServer|keepMine] [--entity-id <id>] [--snapshot-id <id>] [--name <client>]
         Requires TERRENO_MCP_EVAL=1.

  snapshot capture [--collection <name>] [--entity-id <id>] [--limit <n>] [--name <client>]
  snapshot list
  snapshot get <snapshotId>
  snapshot compare --snapshot-id <id> --other-snapshot-id <id>
  snapshot delete <snapshotId>
         Snapshots live in the CLI session's memory and are gone when it stops.

Needs a client created with createSyncDb({debug: true}).
`,
    tool: `Usage: terreno tool <list|schema|call>

  list [--local|--hosted] [--json]            Every MCP tool with its server
  schema <name>                               One tool's description and input schema
  call <name> [--args <json>|--args-file <path>]

Calls any terreno-mcp-local or hosted terreno tool by its MCP name. Use it for a tool that
has no dedicated command yet; arguments are the same JSON object the MCP tool takes.
`,
    validate: `Usage: terreno validate <schema|blocks> --file <path>

  schema   Check a Mongoose schema against Terreno conventions
  blocks   Check a whole-reply YAML or JSON agent UI block document
`,
    web: `Usage: terreno web [url] [options]

Drives the web app headlessly with Bun.WebView (Bun 1.4+). The URL defaults to
TERRENO_WEB_URL or http://localhost:8082.

Options:
  --action <json>               Ordered browser action; repeatable
  --actions-file <path>         JSON array of ordered browser actions
  --snapshot                    Return visible text and interactive elements
  --screenshot <path>           Save the final viewport as PNG, JPEG, or WebP
  --width <pixels>              Viewport width (default 1280)
  --height <pixels>             Viewport height (default 720)
  --wait <milliseconds>         Initial client-render wait (default 1000)
  --data-dir <path>             Persist cookies and browser storage

Actions: click, type, press, scroll, evaluate, snapshot, screenshot, back,
forward, reload, wait. Examples:
  --action '{"action":"click","selector":"button[type=submit]"}'
  --action '{"action":"type","selector":"#email","text":"user@example.com"}'
`,
  };
  return sections[command] ?? HELP_TEXT;
};
