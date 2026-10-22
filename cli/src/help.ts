export const HELP_TEXT = `Usage: terreno <command> [options]

The Terreno CLI wraps docs search, generators, bootstrap, local project tools,
and OpenAPI REST calls for Terreno apps.

Commands:
  docs search <query...>          Search Terreno documentation
  docs component <Name>           Print @terreno/ui component props
  docs upgrade --from --to        Print lockstep upgrade notes

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

  api list                        List REST operations from an OpenAPI spec
  api call <operationId>          Invoke one OpenAPI operation
  api request <METHOD> <path>     Invoke by HTTP method and path

  info                            Print local @terreno/* versions
  logs                            Merge backend, browser, Metro, and app logs
  state                           Inspect the live SyncDB client (entities, outbox, conflicts)
  eval                            Evaluate JavaScript through Metro CDP
  navigate                        Navigate the Expo app through Metro CDP
  web [url]                       Drive the web app with Bun.WebView
  db schema                       List Mongo collections
  db query                        Run a read-only Mongo query

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
  --packages api,ui,syncdb     Guideline packages for rules
`,
    db: `Usage: terreno db <schema|query> [options]

  schema [--collection-filter <substr>] [--summary]
  query --collection <name> --operation find|aggregate|countDocuments|distinct
        [--filter <json>] [--pipeline <json>] [--field <name>] [--limit <n>]
`,
    docs: `Usage: terreno docs <search|component|upgrade>

  search <query...> [--packages api,ui] [--token-limit 3000]
  component <Name>
  upgrade --from <semver> --to <semver>
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
    logs: `Usage: terreno logs [--entries 80] [--level error] [--since <ISO>] [--sources backend,browser,metro,app]

  last-error [--sources backend,browser,metro,app]
`,
    navigate: `Usage: terreno navigate <path>

Requires TERRENO_MCP_EVAL=1. Navigates an Expo Router app through Metro CDP.
`,
    state: `Usage: terreno state [--collection <name>] [--entity-id <id>] [--limit <n>] [--name <client>] [--no-events]

Reads a live SyncDB client created with createSyncDb({debug: true}) through the local MCP
get_syncdb_state tool (in-process registry or Metro CDP): status, entities, outbox, conflicts,
cursors, streams, and debug events. Sensitive fields are redacted. Snapshots and actions live in
the terreno-mcp-local tools syncdb_snapshot and syncdb_action.
`,
    validate: `Usage: terreno validate schema --file <path>
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
