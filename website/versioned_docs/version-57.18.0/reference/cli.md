# @terreno/cli

Install: `bun add -g @terreno/cli` then run `terreno --help`.

The `terreno` binary is the operator CLI for Terreno apps. It wraps documentation search, codegen (syncdb SDK, RTK OpenAPI SDK, Mongoose models, routes, screens, forms, admin install notes), app bootstrap, local project tools from `@terreno/mcp`, and **OpenAPI-driven REST calls**.

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
| `generate syncdb` | Typed syncdb hooks from OpenAPI (`--schema`, `--out`, `--collections`, `--config`, `--no-format`) |
| `generate sdk` | Run `@rtk-query/codegen-openapi` with `--config` |
| `generate rest-cli` | Scaffold a bun CLI from OpenAPI (`--schema`, `--out`, `--name`, `--base-url`) |
| `generate model` | Mongoose model (`--name`, `--field name:Type:required`, `--owner`, `--soft-delete`) |
| `generate route` | `modelRouter` module (`--model-name`, `--route-path`, `--owner-filtered`, `--query-fields`, `--sort`) |
| `generate screen` | UI screen (`--name`, `--type list\|detail\|form\|empty`) |
| `generate form` | Form fields (`--field name:type:required:label=Label`) |
| `generate admin` | Admin install snippets (`--model Model:/path:Display:field,field`) |
| `bootstrap app` | Full-stack app files (`--name`, `--display-name`, `--dir`, `--description`, `--mcp-url`) |
| `bootstrap rules` | Editor AI rules only (`--packages api,ui`) |
| `validate schema --file` | Check a Mongoose schema against conventions |
| `api list` | List operations from `--schema` or `TERRENO_OPENAPI` |
| `api call <operationId>` | Invoke by OpenAPI operation id |
| `api request <METHOD> <path>` | Invoke by method + path template |
| `info` | Local `@terreno/*` versions (via MCP local tools) |
| `logs` | Merge backend/browser JSONL, Metro events, and app CDP console (`--entries`, `--level`, `--since`, `--sources`; `last-error`) |
| `state` | Inspect Better Auth (via `auth` alias or `betterAuth`) or RTK Query state (`--slice`, `--query`) through the dev store or Metro CDP |
| `eval` | Evaluate JavaScript in the app runtime through Metro CDP (`--code`; requires `TERRENO_MCP_EVAL=1`) |
| `navigate` | Navigate Expo Router through Metro CDP (requires `TERRENO_MCP_EVAL=1`) |
| `web [url]` | Automate the web app with Bun 1.4 `Bun.WebView`; ordered `--action` JSON, `--snapshot`, and `--screenshot` |
| `db schema` | Mongo collections (`--collection-filter`, `--summary`) |
| `db query` | Read-only Mongo (`--collection`, `--operation`, `--filter`, `--pipeline`, `--field`, `--limit`) |

Global flags: `--json`, `--help` / `-h`, `--version` / `-v`.

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
| `--token` / `TERRENO_TOKEN` | Bearer token |
| `--base-url` / `TERRENO_API_URL` | Override `servers[0].url` |
| `--header "Name: value"` | Extra headers (repeatable) |
| `--param name=value` | Path or query parameter |
| `--body` / `--body-file` | JSON body |

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
