# @terreno/mcp

Published npm package for the Terreno Model Context Protocol (MCP) servers. The monorepo directory
is `mcp-server/`. The package ships two servers with separate tool sets:

| Server | npm bin | Entry | Transport | Registers |
|--------|---------|-------|-----------|-----------|
| Hosted `terreno-mcp` | `terreno-mcp` → `dist/index.js` | `src/index.ts`, `src/httpApp.ts` | Streamable HTTP, stateless | 14 tools, 9 prompts, documentation resources |
| Local `terreno-mcp-local` | `terreno-mcp-local` → `dist/local/index.js` | `src/local/index.ts`, `src/local/localServer.ts` | stdio | 13 tools (no prompts, no resources) |

The hosted server gives an agent documentation search, upgrade notes, and code generators. It never
sees your project. The local server runs inside your project and reads its packages, database, logs,
Metro, and running app.

For editor configuration, see [Set up Terreno MCP](../how-to/set-up-terreno-mcp.md). For the
end-to-end diagnostic workflow, see [Debug a Terreno app with MCP](../how-to/debug-with-mcp.md).

Both HTTP MCP surfaces (`@terreno/mcp` and the `modelRouter` endpoint in `@terreno/api`) use the MCP
TypeScript SDK v2 and speak the stateless `2026-07-28` protocol revision. The HTTP handlers retain
the SDK's stateless legacy fallback for 2025-era clients. `terreno-mcp-local` uses v2 `serveStdio`
with `legacy: "serve"`, which negotiates the connection era and pins one server instance for that
connection.

## Table of Contents

- [Hosted server (`terreno-mcp`)](#hosted-server-terreno-mcp)
  - [Endpoint](#endpoint)
  - [Hosted tools](#hosted-tools)
  - [Prompts](#prompts)
  - [Resources](#resources)
  - [Rate limiting](#rate-limiting)
- [Local server (`terreno-mcp-local`)](#local-server-terreno-mcp-local)
  - [Running the local server](#running-the-local-server)
  - [Local tools](#local-tools)
  - [`TERRENO_MCP_EVAL` gate](#terreno_mcp_eval-gate)
  - [Metro and CDP connection](#metro-and-cdp-connection)
  - [React Native DevTools and the `app` source](#react-native-devtools-and-the-app-source)
- [What the local server can and cannot see](#what-the-local-server-can-and-cannot-see)
- [Environment variables](#environment-variables)
- [Development](#development)
- [Architecture](#architecture)
- [Deployment](#deployment)

## Hosted server (`terreno-mcp`)

### Endpoint

| Item | Value |
|------|-------|
| URL | `https://mcp.terreno.app/mcp` |
| JSON-RPC routes | `ALL /mcp` and `POST /` (same handler, same rate-limit bucket) |
| Health check | `GET /` → `{"mcpEndpoint":"/mcp","service":"terreno-mcp","status":"ok"}` (never rate limited) |
| Sessions | None. Each request is independent; no `initialize` round trip is required. |
| Request headers | `Accept: application/json, text/event-stream` is required; without both types the server returns JSON-RPC error `-32000` `Not Acceptable: Client must accept both application/json and text/event-stream` |
| Response | An SSE stream of `event: message` frames (`responseMode: "auto"`) |
| Logging | Every `tools/call` and `prompts/get` is logged with its name and arguments (`logger.info`), and the server is wrapped with `Sentry.wrapMcpServerWithSentry`. Do not put secrets or PHI in tool arguments. |

`mcp.terreno.flourish.health` is the legacy hostname for the same service. Use
`https://mcp.terreno.flourish.health/mcp` while `mcp.terreno.app` does not resolve
(`getaddrinfo ENOTFOUND mcp.terreno.app`).

Editor entry (the Terreno servers `create-terreno-app` writes to `.cursor/mcp.json` and
`.mcp.json`; the full files are in [Set up Terreno MCP](../how-to/set-up-terreno-mcp.md)):

``````json
{
  "mcpServers": {
    "terreno": {"type": "http", "url": "https://mcp.terreno.app/mcp"},
    "terreno-local": {"command": "bunx", "args": ["-p", "@terreno/mcp", "terreno-mcp-local"]}
  }
}
``````

Raw HTTP call against a local build (`PORT=8799 bun dist/index.js`):

``````bash
curl -s -X POST http://127.0.0.1:8799/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"terreno_get_upgrade_guide","arguments":{"fromVersion":"57.14.0","toVersion":"57.14.0"}}}'
``````

``````text
event: message
data: {"result":{"content":[{"type":"text","text":"Recorded notes in 57.14.0 → 57.14.0: 57.14.0\n\n---\n\n# Upgrade to 57.14.0…"}]},"jsonrpc":"2.0","id":1}
``````

JSON-RPC methods: `tools/list`, `tools/call`, `prompts/list`, `prompts/get`, `resources/list`,
`resources/read`.

### Hosted tools

Code generators return text. They do not write files: the agent receives the code and a target path
and writes it. Scaffold a new app with [`create-terreno-app`](create-terreno-app.md)
(`bunx create-terreno-app`), not an MCP tool. Every tool returns one text content block.

| Tool | Purpose |
|------|---------|
| [`terreno_bootstrap_ai_rules`](#terreno_bootstrap_ai_rules) | Generate AI assistant rule files for an app |
| [`terreno_search_docs`](#terreno_search_docs) | Keyword search over bundled Terreno docs |
| [`terreno_get_component_docs`](#terreno_get_component_docs) | Props table for one `@terreno/ui` component |
| [`terreno_get_upgrade_guide`](#terreno_get_upgrade_guide) | Bundled upgrade notes between two versions |
| [`terreno_search_update_notes`](#terreno_search_update_notes) | Search upgrade notes and help-API announcements |
| [`terreno_get_update_note`](#terreno_get_update_note) | Full text of one update note |
| [`terreno_ask_update_help`](#terreno_ask_update_help) | Ranked update-note excerpts for a question |
| [`terreno_generate_model`](#terreno_generate_model) | Mongoose model source |
| [`terreno_generate_route`](#terreno_generate_route) | `modelRouter` route source |
| [`terreno_generate_screen`](#terreno_generate_screen) | React Native screen source |
| [`terreno_generate_form_fields`](#terreno_generate_form_fields) | `@terreno/ui` form field source |
| [`terreno_validate_model_schema`](#terreno_validate_model_schema) | Check schema source against Terreno conventions |
| [`terreno_validate_ui_blocks`](#terreno_validate_ui_blocks) | Validate a whole-reply UI block document |
| [`terreno_install_admin`](#terreno_install_admin) | Admin panel files and setup steps |

Example outputs below are real tool output, shortened with `…`.

#### terreno_bootstrap_ai_rules

Generate AI coding assistant rules (`AGENTS.md`, `CLAUDE.md`, `.rulesync/` sources, and
`rulesync.jsonc`). Guideline bodies come from each package's `.ai/guidelines/core.md`, copied into
this package at build time (`bun run sync-package-guidelines`). Defined in `src/bootstrap.ts`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appName` | string | yes | App name in kebab-case |
| `appDisplayName` | string | yes | Human-readable name |
| `description` | string | no | One-line app description |
| `packages` | string[] | no | Guideline packages to merge: `api`, `ui`, `rtk`, `syncdb`, `admin-backend`, `admin-frontend`, or the `@terreno/*` name. Omitted or no valid id means all six. |

``````json
{"name":"terreno_bootstrap_ai_rules","arguments":{"appName":"my-app","appDisplayName":"My App","packages":["api"]}}
``````

``````markdown
# Bootstrap AI Rules for My App

## Files to Create

The following AI coding assistant configuration files need to be created:

- `.rulesync/rules/00-root.md`
- `backend/AGENTS.md`
- `backend/CLAUDE.md`
- `frontend/AGENTS.md`
- `frontend/CLAUDE.md`
- `rulesync.jsonc`

## Instructions

1. **Create all the files listed above.** Each file's content is provided below.
…
3. **Before generating, move hand-written rules into `.rulesync/rules/`.** `rulesync generate` overwrites the root `CLAUDE.md`, `AGENTS.md`, and `.github/copilot-instructions.md` and deletes every file under `.claude/rules/`, `.cursor/rules/`, `.github/instructions/`, and `.agents/memories/` that it did not generate. …

4. **Delete the stale `.cursorrules`** that `create-terreno-app` wrote. …

5. **Generate the editor files with rulesync:**
   ```bash
   bunx rulesync@9 generate
   ```
…
``````

`rulesync.jsonc` targets `cursor`, `claudecode`, `copilot`, and `agentsmd`. The one
`root: true` rule in `00-root.md` covers all four. See
[Agent guidelines](../explanation/agent-guidelines.md#terreno_bootstrap_ai_rules) for the
generated editor files and how to add project rules.

#### terreno_search_docs

BM25-style keyword search over markdown bundled with the server: `docs/resources/*.md`, the Diátaxis
docs synced into `docs/versioned/`, and per-component excerpts from `ui-types-documentation.json`.
Call it before guessing a Terreno API.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `queries` | string[] | yes | One or more search phrases |
| `packages` | string[] | no | Filter by package id or scope, e.g. `["api", "@terreno/ui"]` |
| `tokenLimit` | number | no | Approximate markdown budget. Default 3000, clamped to 8000. |
| `version` | string | no | `@terreno/*` lockstep version (e.g. `57.2.0`). Omit for current `next` docs. |

An unmatched `version` falls back to the nearest retained snapshot (`website/versioned_docs/`,
copied into `docs/versioned/` at build), and the response says so. Range prefixes such as
`^57.2.0` are stripped. A non-array `queries` returns a usage message instead of results.

``````json
{"name":"terreno_search_docs","arguments":{"queries":["instanceActions"],"packages":["api"],"tokenLimit":300}}
``````

``````markdown
# Terreno documentation search results

Queries: "instanceActions"
Docs version: next
Package filter: api

## modelRouter actions
_Source: `versioned/next/reference/api.md` · Packages: api_
…
_…Truncated to approximate token budget (~300 tokens)._
``````

#### terreno_get_component_docs

Return the props table for one `@terreno/ui` component from `ui-types-documentation.json`, plus
related markdown excerpts.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `component` | string | yes | Exported component name, e.g. `Button` |
| `version` | string | no | Lockstep version. A retained snapshot returns that version's generated component page (MDX chrome stripped); otherwise current props are used and the fallback is noted. |

``````json
{"name":"terreno_get_component_docs","arguments":{"component":"Badge"}}
``````

``````markdown
# Badge

**Interface:** `BadgeProps`

## Props

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `color` | `"bold" | "subtle"` | No | For the "status" variant, whether the dot uses the bold (saturated) or …
…
``````

A build without `ui-types-documentation.json` returns:
`Component documentation is unavailable (ui-types-documentation.json not found). Run `bun run sync-ui-docs` in mcp-server before build.`

#### terreno_get_upgrade_guide

Return bundled lockstep upgrade notes between two versions. The response always lists which versions
in the range have notes and names the gaps, because an empty concatenation would read as "nothing
changed". Note format: `mcp-server/src/docs/upgrades/README.md`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fromVersion` | string | yes | Installed `@terreno/*` semver. Must be ≤ `toVersion`. |
| `toVersion` | string | yes | Target semver |

``````json
{"name":"terreno_get_upgrade_guide","arguments":{"fromVersion":"57.13.0","toVersion":"57.14.0"}}
``````

``````markdown
Recorded notes in 57.13.0 → 57.14.0: 57.14.0

---

# Upgrade to 57.14.0

# Upgrading to 57.14.0

**Action required:** No
**Affected packages:** @terreno/syncdb
…
``````

#### terreno_search_update_notes

Search bundled upgrade notes and, when `TERRENO_HELP_API_URL` is set, product announcements from a
Terreno backend help API. Returns JSON.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `queries` | string[] | no | Keyword phrases |
| `question` | string | no | Natural-language question, used as an extra phrase |
| `source` | `auto` \| `bundled` \| `announcement` | no | Default `auto` |
| `limit` | number | no | Default 10 |
| `includeArchived` | boolean | no | Include archived announcements |

``````json
{"name":"terreno_search_update_notes","arguments":{"queries":["rate limit"],"limit":2}}
``````

``````json
{
  "hits": [
    {
      "excerpt": "# Upgrading to 57.3.0 **Action required:** Yes **Affected packages:** @terreno/api, …",
      "id": "upgrade:57.3.0",
      "kind": "upgrade",
      "title": "Terreno 57.3.0 upgrade notes",
      "version": "57.3.0"
    },
    …
  ],
  "sources": [
    "bundled-upgrades"
  ]
}
``````

#### terreno_get_update_note

Return the full text of one update note as JSON (`body`, `id`, `kind`, `title`, `version`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | `upgrade:<semver>`, `announcement:<mongoId>`, or a bare upgrade semver |
| `includeArchived` | boolean | no | Allow archived announcements from the help API |

``````json
{"name":"terreno_get_update_note","arguments":{"id":"upgrade:57.14.0"}}
``````

``````json
{
  "body": "Recorded notes in 57.14.0 → 57.14.0: 57.14.0\n\n---\n\n# Upgrade to 57.14.0\n…",
  "id": "upgrade:57.14.0",
  "kind": "upgrade",
  "title": "Terreno 57.14.0 upgrade notes",
  "version": "57.14.0"
}
``````

#### terreno_ask_update_help

Answer a question with ranked update-note excerpts and the ids to fetch with
`terreno_get_update_note`. Returns text.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | yes | Question about what changed |
| `limit` | number | no | Default 5 |
| `includeArchived` | boolean | no | Include archived announcements |

``````json
{"name":"terreno_ask_update_help","arguments":{"question":"How do I enable rate limiting?","limit":2}}
``````

``````text
Question: How do I enable rate limiting?
Sources: bundled-upgrades

Top matches (call terreno_get_update_note with `id` for the full note):
- [upgrade] Terreno 57.3.0 upgrade notes (upgrade:57.3.0)
  # Upgrading to 57.3.0 **Action required:** Yes …
- [upgrade] Terreno 58.0.0 upgrade notes (upgrade:58.0.0)
  …
``````

#### terreno_generate_model

Generate a Mongoose model with `strict: "throw"`, virtuals in `toJSON`/`toObject`, and
`addDefaultPlugins`. Target path: `backend/src/models/<name>.ts`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Model name, PascalCase |
| `fields` | object[] | yes | Each `{name*, type*, required?, unique?, ref?, default?}`. `type`: `String`, `Number`, `Boolean`, `Date`, `ObjectId`, `Array`, `Mixed`. `default` is a string. |
| `hasOwner` | boolean | no | Add a required `ownerId` referencing `User` |
| `softDelete` | boolean | no | Enable soft delete |

``````json
{"name":"terreno_generate_model","arguments":{"name":"Product","fields":[{"name":"title","type":"String","required":true}],"hasOwner":true}}
``````

``````text
**IMPORTANT: Write this code to a file**

File path: `backend/src/models/product.ts`

After writing the file:
1. Export from `backend/src/models/index.ts`: `export * from "./product";`

---

import mongoose from "mongoose";
import { addDefaultPlugins } from "@terreno/api";
…
const productSchema = new mongoose.Schema<ProductDocument, ProductModel>(
  {
    title: { type: String, required: true, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
…
``````

#### terreno_generate_route

Generate a `modelRouter` route. Target path: `backend/src/api/<model>.ts`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `modelName` | string | yes | Model name, PascalCase |
| `routePath` | string | yes | API path, e.g. `/products` |
| `permissions` | object | no | `{create, list, read, update, delete}`, each `admin`, `any`, `authenticated`, `authOrReadOnly`, or `owner`. A missing or unknown value becomes `Permissions.IsAuthenticated`. |
| `queryFields` | string[] | no | Allowed query fields |
| `sort` | string | no | Default sort, e.g. `-created` |
| `ownerFiltered` | boolean | no | Add `OwnerQueryFilter` and an `ownerId`-setting `preCreate` |

``````json
{"name":"terreno_generate_route","arguments":{"modelName":"Product","routePath":"/products","permissions":{"list":"authenticated"}}}
``````

``````text
**IMPORTANT: Write this code to a file**

File path: `backend/src/api/product.ts`

After writing the file:
1. Export from `backend/src/api/index.ts`: `export * from "./product";`
2. Register in server setup: `addProductRoutes(router, options);`
3. Regenerate frontend SDK: `bun run sdk` in the frontend directory
…
``````

#### terreno_generate_screen

Generate a React Native screen with `@terreno/ui` components and generated RTK Query hooks. Target
path: `frontend/src/screens/<name>Screen.tsx`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Screen name, PascalCase |
| `type` | `list` \| `detail` \| `form` \| `empty` | yes | Screen kind |
| `modelName` | string | no | Model for data fetching |
| `fields` | string[] | no | Fields to display or edit |

``````json
{"name":"terreno_generate_screen","arguments":{"name":"ProductList","type":"list","modelName":"Product","fields":["title"]}}
``````

``````text
**IMPORTANT: Write this code to a file**

File path: `frontend/src/screens/ProductListScreen.tsx`
…
import { useGetProductsQuery } from "@/store/openApiSdk";

const ProductListScreen: React.FC = () => {
  const { data: products, isLoading, error, refetch } = useGetProductsQuery({});
…
``````

#### terreno_generate_form_fields

Generate `@terreno/ui` form fields and their state declarations. Fields use the real
`@terreno/ui` props (`title`, `value`, `onChange`, `errorText`); `password` renders
`TextField type="password"`, and `number` and date values are strings. A required field adds an
`errors` state and `errorText={errors.<name>}`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fields` | object[] | yes | Each `{name*, type*, label?, required?, options?}`. `type`: `text`, `email`, `password`, `number`, `textarea`, `select`, `boolean`, `date`, `datetime`. `options` is `[{label, value}]` for `select`. |

``````json
{"name":"terreno_generate_form_fields","arguments":{"fields":[{"name":"title","type":"text","required":true}]}}
``````

``````text
**IMPORTANT: Write this code to a file**

File path: `your form component file`
…
// State declarations (add to your component):
  const [title, setTitle] = useState("");
  …
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

// Form fields (add inside your component's return):
…
``````

#### terreno_validate_model_schema

Check schema source text against Terreno conventions and list issues and suggestions. The
model's `<Name>Document` type may be declared in the file or imported from the app's type files
(`src/modelInterfaces.ts`, `src/types/models/`); "Missing TypeScript interfaces" means neither.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `schema` | string | yes | Schema source code |

``````json
{"name":"terreno_validate_model_schema","arguments":{"schema":"const s = new mongoose.Schema({title: {type: String}});"}}
``````

``````text
Schema Validation Results:

Issues Found:
- Missing strict: 'throw' in schema options
- Missing toJSON virtuals configuration
- Missing default plugins
- Missing TypeScript interfaces

Suggestions:
…
``````

#### terreno_validate_ui_blocks

Validate one whole-reply YAML or JSON block document. The text is the report
`terreno-blocks validate` prints: one line per problem, `path  CODE  message — fix`. A valid document
with no warnings returns an empty string.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `document` | string | yes | The YAML or JSON document |

``````json
{"name":"terreno_validate_ui_blocks","arguments":{"document":"v: 1\nblocks:\n  - type: bogus\n"}}
``````

``````text
blocks[0].type.type  INVALID_ENUM  blocks[0].type is not a supported block. — Set type to heading, text, metric, …, list, or html.
``````

#### terreno_install_admin

Generate admin panel screen files and backend/frontend setup steps for `@terreno/admin-backend` and
`@terreno/admin-frontend`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `models` | object[] | yes | Each `{modelName*, routePath*, displayName*, listFields*}`; `listFields` is string[] |

``````json
{"name":"terreno_install_admin","arguments":{"models":[{"modelName":"Todo","routePath":"/todos","displayName":"Todos","listFields":["title"]}]}}
``````

``````markdown
# Install Admin Panel

## Files to Create

- `frontend/app/(tabs)/admin/index.tsx`
- `frontend/app/(tabs)/admin/[model].tsx`
- `frontend/app/(tabs)/admin/[model]/create.tsx`
- `frontend/app/(tabs)/admin/[model]/[id].tsx`

## Setup Instructions

### Step 1: Add `@terreno/admin-backend` to backend
…
``````

### Prompts

Multi-step workflow prompts, served by `prompts/list` and `prompts/get`. `terreno_bootstrap` is
defined in `src/bootstrap.ts`; the rest in `src/prompts.ts`. `*` marks a required argument. All
arguments are strings.

| Prompt | Arguments | Purpose |
|--------|-----------|---------|
| `terreno_bootstrap` | `appName*`, `appDisplayName*` | Run `bunx create-terreno-app`, then `terreno_bootstrap_ai_rules` |
| `terreno_create_crud_feature` | `name*`, `fields*` (`title:string,price:number`), `hasOwner` (`yes`/`no`) | Model, routes, and frontend screens |
| `terreno_create_api_endpoint` | `path*`, `method*`, `description*` | Custom endpoint with OpenAPI docs |
| `terreno_create_ui_component` | `name*`, `type*` (`display`, `interactive`, `form`, `layout`) | Reusable `@terreno/ui`-style component |
| `terreno_create_form_screen` | `name*`, `fields*` (`name:text,email:email`), `endpoint*` | Form screen with validation |
| `terreno_add_authentication` | `features` (`email,social,passwordReset`) | Login/signup screens and auth state |
| `terreno_style_guide` | none | Terreno code style guide |
| `terreno_migrate_to_terreno_app` | `serverFile` | Move from `setupServer` to `TerrenoApp` |
| `terreno_upgrade` | `targetVersion` (omit for latest stable) | Lockstep upgrade: read notes, bump `@terreno/*`, test, delegate Expo SDK steps to the upgrading-expo skill |

### Resources

Read-only markdown, loaded once at startup from `<docs root>/resources/` (see
`TERRENO_MCP_DOCS_DIR`). Restart the server to pick up changes.

| URI | Name | Source |
|-----|------|--------|
| `terreno://docs/overview` | Terreno Overview | `overview.md` |
| `terreno://docs/api` | @terreno/api Documentation | `api.md` |
| `terreno://docs/ui` | @terreno/ui Documentation | `ui.md` |
| `terreno://docs/syncdb` | @terreno/syncdb Documentation | `syncdb.md` |
| `terreno://docs/rtk` | @terreno/rtk Documentation (legacy) | `rtk.md` |
| `terreno://docs/patterns` | Terreno Patterns & Best Practices | `patterns.md` |
| `terreno://docs/ui/components` | @terreno/ui Component Reference | Generated from `ui-types-documentation.json` |
| `terreno://docs/ui/components/<slug>` | `<Component> Component` | One per component |

The two component rows exist only when `ui-types-documentation.json` is bundled.

### Rate limiting

The hosted server limits its JSON-RPC routes per client IP: `/mcp` (all methods) and `POST /` share
one bucket. The `GET /` health check is never limited. The local stdio server has no limit.

- **Default:** 120 requests per 60 seconds per client IP, a fixed window. Search, codegen, and docs
  calls are cheap per call (the search index is built once at startup), and an agent session makes
  a few dozen calls a minute, so the default leaves room for several agents behind one NAT while
  capping one abusive client at about 2 requests per second.
- **Configure:** `TERRENO_MCP_RATE_LIMIT_MAX` (`0` turns the limit off, for example in local
  development) and `TERRENO_MCP_RATE_LIMIT_WINDOW_MS`. An invalid value stops the server at startup
  rather than running unlimited.
- **Per instance:** counters live in memory on each Cloud Run instance. With `N` instances, one
  client can make up to `N` times the limit in a window if its requests land on different
  instances.
- **Client IP:** on Cloud Run the server trusts one proxy hop, so the client IP is the address the
  Google Front End appended to `X-Forwarded-For`. Entries a client writes into that header itself
  are ignored, so a forged header cannot switch buckets. Off Cloud Run no proxy is trusted and the
  socket address is used. Set `TERRENO_MCP_TRUST_PROXY_HOPS` when you add a proxy layer (for
  example `2` behind an external HTTPS load balancer).

A request over the limit gets HTTP `429` with `Retry-After`, `RateLimit`, and `RateLimit-Policy`
headers and a JSON-RPC error body. `id` echoes the request id when the body is a single request
with a string or number id; otherwise it is `null`.

``````json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32029,
    "message": "Rate limit exceeded: 120 requests per 60 seconds per client IP. Retry after 42s.",
    "data": {"limit": 120, "windowMs": 60000, "retryAfterSeconds": 42}
  },
  "id": 7
}
``````

`-32029` is in the JSON-RPC range reserved for implementation-defined server errors. Clients
should wait `retryAfterSeconds` (or `Retry-After`) before retrying.

## Local server (`terreno-mcp-local`)

### Running the local server

Run it from the app repository root with `bunx -p @terreno/mcp terreno-mcp-local`. The bin and the
package have different names, so `bunx` needs `-p` unless `@terreno/mcp` is already installed in
the project (as in this monorepo). The bin is
`#!/usr/bin/env bun`, so it needs Bun; the `browser` tool needs Bun 1.4 or newer. It registers tools
only.

Project root discovery (`src/local/projectRoot.ts`): `TERRENO_PROJECT_ROOT` when set. Otherwise it
walks up to 20 directories from the working directory to the first directory with a `package.json`
and both a backend workspace (`backend/` or `example-backend/`) and a frontend workspace
(`frontend/` or `example-frontend/`), or one of them plus a non-empty `workspaces` array. With no
match it uses the working directory. Bootstrap names win when both exist.

Errors: a refused or invalid call usually returns explanatory text. A thrown error (for example from
`browser`, or a database exception) becomes a JSON-RPC error with code `-32603` and the error
message. An unknown tool name returns the text `Unknown tool: <name>`.

### Local tools

All schemas set `additionalProperties: false`. Every tool returns one text block, JSON for most
tools. The server does not validate arguments against the schema: an unknown argument, such as
`projection` on `database_query`, is ignored, not rejected. Check a result against the parameter
table when it looks unfiltered.

| Tool | Purpose | Gated by `TERRENO_MCP_EVAL` |
|------|---------|------|
| [`application_info`](#application_info) | Workspace packages and key dependency versions | no |
| [`database_schema`](#database_schema) | Mongo collections, indexes, counts, model excerpts | no |
| [`database_query`](#database_query) | Read-only Mongo queries | no |
| [`read_logs`](#read_logs) | Merged backend, browser, Metro, and app log tail | no |
| [`last_error`](#last_error) | Newest error-level log entry | no |
| [`get_client_state`](#get_client_state) | RTK Query and SyncDB state of the running app | no |
| [`get_rtk_state`](#get_rtk_state) | Deprecated alias of `get_client_state` | no |
| [`get_syncdb_state`](#get_syncdb_state) | SyncDB client state | no |
| [`syncdb_snapshot`](#syncdb_snapshot) | Capture and compare SyncDB snapshots | no |
| [`syncdb_action`](#syncdb_action) | Change SyncDB client state | yes, every action |
| [`evaluate`](#evaluate) | Run JavaScript in the app runtime | yes |
| [`navigate`](#navigate) | Navigate the app with expo-router | yes |
| [`browser`](#browser) | Drive a headless WebView | only the `evaluate` action |

Example outputs below are real tool output, shortened with `…`. Where an output needs a running
Hermes app, which the capture environment did not have, the section says so and shows only the
call or the failure output.

#### application_info

Read the root `package.json` and the first backend (`backend/`, then `example-backend/`) and frontend
(`frontend/`, then `example-frontend/`) `package.json`. It reports `@terreno/*` dependencies and
`expo`, `react`, `react-native`, `mongoose`, `bun`, and `@types/bun` as declared (ranges such as
`^57.2.0`, `catalog:`, or `workspace:*`, not resolved versions). It checks that `bun.lock` exists but
does not parse it. Call it at the start of a session. No parameters.

``````json
{"name":"application_info","arguments":{}}
``````

``````markdown
# Application info

- **projectRoot**: `…`
- **root package**: @terreno/root @ 1.0.0
- **bun.lock present**: yes

## Backend workspace (example-backend/)
- **name**: @terreno/example-backend
- **version**: 1.0.0
- @terreno/admin-backend: workspace:*
…
- **mongoose**: catalog:

## Frontend workspace (example-frontend/)
…
- **react-native**: catalog:

## Lockfile
Workspace package versions are recorded under `workspaces` in `bun.lock`. Prefer installed semver over `latest` in generated code.
``````

#### database_schema

List live Mongo collections with `estimatedDocumentCount` and indexes, plus the first 80 lines of
each `backend/src/models/*.ts` file (except `index.ts`), read as text. Only `backend/` is scanned,
not `example-backend/`. Each call connects with Mongoose and disconnects at the end.

Mongo URI: `MONGO_URI` from the environment, else `MONGO_URI`, else `MONGODB_URI` parsed from
`<project root>/backend/.env`. `example-backend/.env` is not read.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `collectionFilter` | string | no | Case-insensitive substring filter on collection names |
| `summary` | boolean | no | Count model files instead of printing excerpts |

``````json
{"name":"database_schema","arguments":{"summary":true}}
``````

Output with no URI configured:

``````markdown
# Database schema

## Declared models (static scan of `backend/src/models/*.ts`)

_(No model files found.)_

## Live MongoDB

_Unavailable: set `MONGO_URI` in `backend/.env` or export `MONGO_URI` to include live collections._
``````

#### database_query

Run one read-only query. Each call opens its own connection and closes it afterwards; queries time
out after 10 seconds (`maxTimeMS`), and `aggregate` runs with `allowDiskUse: false`. Same URI
resolution as `database_schema`. Results are returned unredacted, so avoid collections that hold
credentials (Better Auth keeps password hashes in `account`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `collection` | string | yes | Collection name |
| `operation` | `find` \| `aggregate` \| `countDocuments` \| `distinct` | yes | Operation |
| `filter` | object | no | Query for `find`, `countDocuments`, `distinct`. Rejected anywhere it contains `$where`, `$function`, or `$accumulator`. |
| `pipeline` | object[] | no | Stages for `aggregate`. Rejected anywhere it contains `$out`, `$merge`, or `$function`. |
| `field` | string | for `distinct` | Field to collect |
| `limit` | number | no | Rows or distinct values returned. Default 50, clamped 1–200. |

Results: `find` and `aggregate` return `{collection, count, rows}`; `countDocuments` returns
`{collection, count}`; `distinct` returns `{collection, field, truncated, values}`.

``````json
{"name":"database_query","arguments":{"collection":"todos","operation":"aggregate","pipeline":[{"$group":{"_id":"$completed","count":{"$sum":1}}},{"$sort":{"_id":1}}]}}
``````

``````json
{
  "collection": "todos",
  "count": 1,
  "rows": [
    {
      "_id": false,
      "count": 2
    }
  ]
}
``````

``````json
{"name":"database_query","arguments":{"collection":"todos","operation":"aggregate","pipeline":[{"$out":"x"}]}}
``````

``````text
Pipeline rejected: `$out`, `$merge`, and `$function` are not allowed.
``````

``````json
{"name":"database_query","arguments":{"collection":"todos","operation":"find","filter":{"$where":"true"}}}
``````

``````text
Filter rejected: `$where`, `$function`, and `$accumulator` are not allowed.
``````

#### read_logs

Merge log entries from up to four sources, sort them by timestamp, and return the newest.

| Source | Reads | Written by | Notes |
|--------|-------|-----------|-------|
| `backend` | `app.log` in each existing `<root>/backend/.terreno/logs`, `<root>/example-backend/.terreno/logs`, `<root>/.terreno/logs` | `@terreno/api` logger JSONL transport (see `TERRENO_LOG_FILE`) at `<backend cwd>/.terreno/logs/app.log` | No `stack` field: `logger.error` stacks are inside `message` |
| `browser` | `browser.log` in the same directories | [`POST /__terreno/browser-logs`](api.md#development-browser-log-ingestion), fed by `installTerrenoDevConsoleLogger` from `@terreno/syncdb` | `console.error` entries carry no stack; uncaught errors carry `stack`. A render error caught by an error boundary is a `console.error` entry: no `stack`, unformatted `%o`/`%s` placeholders, and the component name in `message` |
| `metro` | In-memory ring (2000) from Metro's `ws://<metro>/events` | Metro dev server | Always empty with Expo CLI 57 (see [Metro and CDP connection](#metro-and-cdp-connection)) |
| `app` | In-memory ring (2000) of Hermes `Runtime.consoleAPICalled` over CDP | The running Hermes app | Needs a Hermes target; `stack` is a JSON string of the first 8 call frames; timestamps are receipt time |

The `metro` and `app` rings start filling on the first call that requests those sources and are
held for the life of the MCP process. Earlier output is not captured.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sources` | string[] | no | Any of `backend`, `browser`, `metro`, `app`. Default all four. |
| `entries` | number | no | Default 200, clamped 1–2000. Limits lines read per file and the merged result. |
| `level` | string | no | Exact, case-insensitive level match, e.g. `error` |
| `since` | string | no | ISO-8601 instant. Drops entries before it; entries without a parseable timestamp are kept. |

| Response field | Content |
|----------------|---------|
| `connection` | Always the CDP and Metro events status (see [Metro and CDP connection](#metro-and-cdp-connection)), even when `metro` and `app` were not requested |
| `entries` | Each `{level, message, raw, source, timestamp}`; `raw` is the line as written |
| `metroHint` | Connection details for the `metro` and `app` sources requested; absent when neither was requested |
| `projectRoot` | Resolved project root |

``````json
{"name":"read_logs","arguments":{"level":"error","entries":3}}
``````

``````json
{
  "connection": "CDP: Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?); Metro events: connected",
  "entries": [
    …,
    {
      "level": "error",
      "message": "Uncaught TypeError: Cannot read properties of undefined (reading 'profile')",
      "raw": "{\"level\":\"error\",\"message\":\"Uncaught TypeError: Cannot read properties of undefined (reading 'profile')\",\"source\":\"browser\",\"stack\":\"TypeError: Cannot read properties of undefined (reading 'profile')\\n    at brokenHandler (eval at evaluate (:303:30), <anonymous>:4:19)\\n    at eval (eval at evaluate (:303:30), <anonymous>:6:22)\",\"timestamp\":\"2026-10-12T00:24:58.867+00:00\"}",
      "source": "browser",
      "timestamp": "2026-10-12T00:24:58.867+00:00"
    },
    {
      "level": "error",
      "message": "Fallthrough error: SyntaxError: JSON Parse error: Unexpected identifier \"broken\"\nSyntaxError: JSON Parse error: Unexpected identifier \"broken\"\n    at <parse> (:0)\n…",
      "raw": "{\"level\":\"error\",\"message\":\"Fallthrough error: SyntaxError: …\",\"requestId\":\"2edcea24-66a8-40b6-821c-a62f57af91fc\",\"terrenoRequestLog\":{\"requestId\":\"2edcea24-66a8-40b6-821c-a62f57af91fc\",\"userId\":null},\"timestamp\":\"2026-10-12T00:25:13.380Z\"}",
      "source": "backend",
      "timestamp": "2026-10-12T00:25:13.380Z"
    }
  ],
  "metroHint": "connected | Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?)",
  "projectRoot": "/workspace"
}
``````

`app` source output, captured against a test device that speaks Metro's device protocol (not a real
Hermes runtime):

``````json
{
  "connection": "CDP: connected; Metro events: not connected",
  "entries": [
    …,
    {"level": "info", "message": "fake app tick #94", "source": "app", "timestamp": "2026-10-12T00:47:43.238Z", "raw": "…"},
    {"level": "error", "message": "fake app error #95", "source": "app", "timestamp": "2026-10-12T00:47:44.239Z", "raw": "{\"level\":\"error\",\"message\":\"fake app error #95\",\"source\":\"app\",\"stack\":\"[{\\\"columnNumber\\\":10,\\\"functionName\\\":\\\"tick\\\",\\\"lineNumber\\\":42,\\\"scriptId\\\":\\\"1\\\",\\\"url\\\":\\\"http://localhost:8082/index.bundle\\\"}]\",\"timestamp\":\"2026-10-12T00:47:44.239Z\"}"},
    …
  ],
  "metroHint": "connected",
  "projectRoot": "/workspace"
}
``````

#### last_error

Return the newest `error`-level entry across the selected sources. It reads the last 500 lines of
each file plus the `metro` and `app` rings. On a hit it returns the entry's `raw` line only: backend
lines have no `source` field, and no connection status is appended.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sources` | string[] | no | Any of `backend`, `browser`, `metro`, `app`. Default all four. |

``````json
{"name":"last_error","arguments":{"sources":["browser"]}}
``````

``````text
{"level":"error","message":"Uncaught TypeError: Cannot read properties of undefined (reading 'profile')","source":"browser","stack":"TypeError: Cannot read properties of undefined (reading 'profile')\n    at brokenHandler (eval at evaluate (:303:30), <anonymous>:4:19)\n    at eval (eval at evaluate (:303:30), <anonymous>:6:22)","timestamp":"2026-10-12T00:24:58.867+00:00"}
``````

With no error-level entry:

``````text
No recent error-level entries in selected sources (app). CDP: Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?); Metro events: connected
``````

#### get_client_state

Detect and read the running app's client data layer:

- RTK Query: the Redux store registered by `registerTerrenoDevStore(store)` from `@terreno/rtk`
  (`__DEV__` only) as `globalThis.__TERRENO_STORE__`.
- SyncDB: clients created with `createSyncDb({debug: true})`, registered on
  `globalThis.__TERRENO_SYNCDB__`.

It reads the in-process registries when the MCP process shares the app's heap; otherwise it runs a
fixed read-only expression in the app through CDP `Runtime.evaluate` (not gated, because the caller
cannot change the code). Keys matching `password`, `token`, `secret`, `authorization`, or `cookie`
(case-insensitive) are returned as `[REDACTED]`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `slice` | string | no | RTK: `auth` (Better Auth slice, else legacy `auth`), `betterAuth`, `rtk` or `terreno-rtk`, or any top-level state key. Omit for auth plus the RTK Query cache summary. |
| `query` | string | no | RTK: keep cache rows whose endpoint name or serialized args contain this substring (case-insensitive) |
| `name` | string | no | SyncDB client name. Default the first registered client. |
| `collection` | string | no | SyncDB collection filter |
| `entityId` | string | no | SyncDB entity id filter |
| `includeDebugEvents` | boolean | no | SyncDB: `false` returns debug stats without event bodies |
| `limit` | number | no | SyncDB entities per collection. Default 500, max 2000. |

Response: `{layer, rtk?, syncdb?}`. `layer` is `rtk`, `syncdb`, `syncdb+rtk` (both payloads
returned), or `none`. `rtk` holds `{auth, terrenoRtk: {queries, mutations}}` (rows are
`{args, endpoint, status}`) or the requested slice. `syncdb` holds the SyncDB inspect output. With
`layer: "none"` the response has `connection`, `hint`, and per-layer `reasons` instead.

``````json
{"name":"get_client_state","arguments":{}}
``````

Output with Metro running and no Hermes app attached (a populated response needs a running Hermes
app and is not shown):

``````json
{
  "connection": "CDP: Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?); Metro events: not connected",
  "hint": "No client data layer found. For RTK Query, call `registerTerrenoDevStore(store)` from @terreno/rtk in __DEV__. For SyncDB, create the client with `createSyncDb({debug: true})`. Keep the app running; when the MCP process cannot see the app heap, start Metro so CDP can reach Hermes (see `connection`).",
  "layer": "none",
  "reasons": {
    "rtk": "Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?)",
    "syncdb": "Error: Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?)\nCDP: …"
  }
}
``````

#### get_rtk_state

Deprecated alias of `get_client_state`, kept for one release. Same schema, same handler, same
`{layer, rtk?, syncdb?}` response.

#### get_syncdb_state

Read a SyncDB client registered by `createSyncDb({debug: true})`: status, entities (including
tombstones and pending metadata), decoded outbox, conflicts, cursors, streams, repair markers,
values, and debugger events. Same access path and redaction as `get_client_state`. Not gated.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | no | Client name. Default the first registered client. |
| `collection` | string | no | Collection filter |
| `entityId` | string | no | Entity id filter |
| `includeDebugEvents` | boolean | no | `false` returns debug stats without event bodies |
| `limit` | number | no | Entities per collection. Default 500, max 2000. |

``````json
{"name":"get_syncdb_state","arguments":{"collection":"todos"}}
``````

On success the text is the redacted inspect output as JSON. With no reachable client it is the
reason (shown without a Hermes app; a populated response is not shown):

``````text
Error: Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?)
CDP: Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?); Metro events: not connected
``````

#### syncdb_snapshot

Capture, list, read, compare, or delete SyncDB snapshots. Snapshots live in the MCP process memory
and are lost when it exits. A capture keeps the full mergeable TinyBase content privately for a later
`syncdb_action` `mergeSnapshot`; returned state is redacted. Not gated.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | `capture` \| `list` \| `get` \| `compare` \| `delete` | yes | Operation |
| `name`, `collection`, `entityId` | string | no | Capture filters, as in `get_syncdb_state` |
| `includeDebugEvents` | boolean | no | Capture option |
| `limit` | number | no | Capture option |
| `snapshotId` | string | for `get`, `compare`, `delete` | Snapshot id from `capture` or `list` |
| `otherSnapshotId` | string | for `compare` | Second snapshot. `compare` returns up to 200 path diffs. |

``````json
{"name":"syncdb_snapshot","arguments":{"action":"list"}}
``````

``````json
[]
``````

#### syncdb_action

Change a live SyncDB client, then return `{action, client, result, state}` with the redacted state
after the change. Every action requires `TERRENO_MCP_EVAL`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | yes | `mutate`, `setLocalEntity`, `deleteLocalEntity`, `flush`, `reconcile`, `forceResync`, `resolveConflict`, `retryFailed`, `goOffline`, `goOnline`, `clearDebug`, `mergeSnapshot` |
| `name` | string | no | Client name |
| `collection`, `id` | string | no | Target row for `mutate`, `setLocalEntity`, `deleteLocalEntity` |
| `operation` | `create` \| `update` \| `delete` | no | For `mutate` |
| `data` | object | no | Row data for `mutate`, `setLocalEntity` |
| `maxAttempts` | number | no | For `mutate` |
| `deleted` | boolean | no | For `setLocalEntity` |
| `seq` | number | no | For `setLocalEntity` |
| `stream` | string | no | For `setLocalEntity` |
| `mutationId` | string | no | For `resolveConflict` |
| `strategy` | `useServer` \| `keepMine` | no | For `resolveConflict` |
| `entityId` | string | no | For `retryFailed` |
| `snapshotId` | string | no | For `mergeSnapshot`; must belong to the same client |

``````json
{"name":"syncdb_action","arguments":{"action":"flush"}}
``````

Without the opt-in:

``````text
Refused: set `TERRENO_MCP_EVAL=1` to opt in to SyncDB state changes.
``````

#### evaluate

Run a JavaScript expression in the app's Hermes runtime with CDP `Runtime.evaluate`
(`awaitPromise`, `returnByValue`). Returns `{result, status}` or `{error, status}`, where `status` is
the connection status. Requires `TERRENO_MCP_EVAL`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | yes | Expression to evaluate |

``````json
{"name":"evaluate","arguments":{"code":"1 + 1"}}
``````

Without the opt-in (a successful call needs a Hermes app and is not shown):

``````text
Refused: set `TERRENO_MCP_EVAL=1` to opt in to `Runtime.evaluate` (arbitrary JS in the app runtime).
``````

#### navigate

Run a fixed snippet in the app that calls `require("expo-router").router.navigate(path)`, or
`push(path)` when `navigate` is missing. Returns `{result, status}` with `result` like
`{ok, method}`, or `{error, status}`. Requires `TERRENO_MCP_EVAL`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | expo-router path |

``````json
{"name":"navigate","arguments":{"path":"/settings"}}
``````

Without the opt-in (a successful call needs a Hermes app and is not shown):

``````text
Refused: set `TERRENO_MCP_EVAL=1` to opt in to CDP-driven navigation (runs a fixed expo-router snippet in the app).
``````

#### browser

Drive a headless page with Bun's built-in `Bun.WebView`: system WebKit on macOS; on Linux and
Windows, Chrome, Chromium, or Edge over the Chrome DevTools Protocol (set `BUN_CHROME_PATH` when Bun
cannot find one). One session per MCP process; calls are serialized. Use it to exercise a changed web
flow, then `snapshot` and `screenshot` as proof, then `close`.

| Action | Uses | Notes |
|--------|------|-------|
| `open` | `url` (required), `width` (1280), `height` (720), `dataDir` | `http:`/`https:` only. Closes any open session. Storage is ephemeral unless `dataDir`, which must be under the project root. |
| `click` | `selector` (required), `timeout` | `timeout` is the selector wait in ms |
| `type` | `text`, `selector`, `timeout` | Clicks `selector` first when given |
| `press` | `key` (required), `modifiers` | `modifiers`: `Shift`, `Control`, `Alt`, `Meta` |
| `scroll` | `selector` or `x`/`y` | Scrolls to `selector`, else by the pixel delta |
| `evaluate` | `code` (required) | Gated by `TERRENO_MCP_EVAL`; without it the call fails with JSON-RPC error `-32603` ``Refused: set `TERRENO_MCP_EVAL=1` to enable arbitrary JavaScript in the WebView.`` |
| `snapshot` | none | Up to 200 visible interactive elements with a usable `selector`, plus page text (20 000 chars). Password input values are `[REDACTED]`. |
| `screenshot` | `output` (required), `quality` | `.png`, `.jpg`/`.jpeg`, or `.webp` (other extensions write PNG). Path must be under the project root or `/opt/cursor/artifacts`. |
| `back`, `forward`, `reload` | none | History navigation |
| `wait` | `timeout` | Sleeps `timeout` ms (default 1000) |
| `close` | none | Ends the session |

Results are JSON with `action`, `ok`, and the page `title` and `url`, plus action-specific fields.
Calling any page action before `open` fails with `No browser session. Run the open action first.`

``````json
{"name":"browser","arguments":{"action":"open","url":"http://localhost:8082","width":1280,"height":720}}
{"name":"browser","arguments":{"action":"snapshot"}}
{"name":"browser","arguments":{"action":"screenshot","output":"artifacts/app.png"}}
{"name":"browser","arguments":{"action":"close"}}
``````

``````json
{
  "action": "open",
  "ok": true,
  "title": "",
  "url": "http://localhost:8082/"
}
``````

``````json
{
  "action": "snapshot",
  "ok": true,
  "snapshot": {
    "elements": [
      …,
      {
        "ariaLabel": "Text input field",
        "disabled": false,
        "name": null,
        "placeholder": "Password",
        "role": "input",
        "selector": "#login-screen-password-input",
        "text": "[REDACTED]",
        "type": "password"
      },
      …,
      {
        "ariaLabel": "Log In",
        "disabled": true,
        "name": null,
        "placeholder": null,
        "role": "button",
        "selector": "[data-testid=\"login-screen-submit-button\"]",
        "text": "Log In",
        "type": "button"
      },
      …
    ],
    "text": "Welcome Back\nEmail\nPassword\n\nLog In\nForgot password?\n…",
    "title": "",
    "url": "http://localhost:8082/login"
  }
}
``````

``````json
{
  "action": "screenshot",
  "ok": true,
  "output": "…/artifacts/app.png",
  "title": "",
  "url": "http://localhost:8082/"
}
``````

### `TERRENO_MCP_EVAL` gate

`evaluate`, `navigate`, `syncdb_action`, and the `browser` `evaluate` action run only when the local
server's environment has `TERRENO_MCP_EVAL=1` or `TERRENO_MCP_EVAL=true`. The variable is read on
every call; set it in the editor's server entry (`"env": {"TERRENO_MCP_EVAL": "1"}`).

| Gated | What it allows |
|-------|----------------|
| `evaluate` | Any JavaScript in the app's Hermes runtime |
| `navigate` | A fixed expo-router snippet in the app runtime |
| `syncdb_action` (all actions) | Writes to the app's local SyncDB store, outbox, and sync state |
| `browser` `evaluate` | Any JavaScript in the WebView page |

The gate exists because these calls run code with the app's full privileges: its session tokens and
secure storage, its network access as the signed-in user, and its local data. An agent can be steered
by text it reads, including log lines and database rows, so code execution in the app is a per-process
opt-in rather than a default.

Not gated: `get_client_state`, `get_rtk_state`, `get_syncdb_state`, and `syncdb_snapshot` also use
`Runtime.evaluate` when the app is in another process, but only with fixed read expressions built by
the server (caller values are JSON-encoded), and their output is redacted. `database_query` is
read-only by operation allowlist and operator checks. The other `browser` actions only interact with
the page as a user would.

### Metro and CDP connection

`read_logs` (`metro`, `app`), `last_error`, `get_client_state`, `get_syncdb_state`,
`syncdb_snapshot`, `syncdb_action`, `evaluate`, and `navigate` share one module-level session
(`src/local/metro/metroDevSession.ts`):

- **Metro URL:** `TERRENO_METRO_URL`, else `--port N` from the frontend workspace's `scripts.start`
  (or `scripts.web`), else `http://localhost:8082`.
- **Target:** `GET <metro>/json/list` (4 s timeout); the first target whose title contains `hermes`,
  else whose description contains `react native`, else the first with a `webSocketDebuggerUrl`. A
  web browser tab is not a target, so the `app` source and the CDP paths need a Hermes app (dev build
  or Expo Go) attached to Metro.
- **Origin:** the debugger socket sends `Origin: <scheme>//127.0.0.1:<Metro port>`.
  `@react-native/dev-middleware` rejects a socket without an Origin, and Expo CLI closes one whose
  host is not `127.0.0.1:<Metro port>`. A base URL that reaches Metro through a port-remapping tunnel,
  or a Metro whose server URL is overridden by `REACT_NATIVE_PACKAGER_HOSTNAME` or
  `EXPO_PACKAGER_PROXY_URL`, still fails Expo's check.
- **Lifetime:** connect lazily on first use, send `Runtime.enable`, then keep the socket for the life
  of the MCP process. Each CDP call times out after 8 s. After a close, the next call that needs the
  app reconnects, with no backoff.

The status appears as `CDP: <cdp status>; Metro events: <events status>` in `read_logs`
`connection`, in `last_error` misses, and in `get_client_state` `layer: "none"` responses.

| CDP status | Meaning |
|------------|---------|
| `not connected` | No call has needed the app yet |
| `connected to <title>` | This call opened a new socket |
| `connected` | This call reused the open socket |
| `Error: No debuggable Hermes/React Native target with webSocketDebuggerUrl (is the app running?)` | Metro answered, but no Hermes app is attached |
| `TypeError: Unable to connect. Is the computer able to access the url?` | Metro is not reachable (Bun's fetch error; the Metro URL is not included) |
| `Error: CDP websocket error: …` | The debugger socket upgrade failed |
| `CDP disconnected (code <code>: <reason>)` | Metro closed the socket; a `[NEW_DEBUGGER_OPENED]` reason adds a hint (see below) |
| `CDP socket not open after connect` | The socket closed during connect |

| Metro events status | Meaning |
|---------------------|---------|
| `not connected` | No call has requested the `metro` source |
| `connected ws://<host>/events` / `connected` | New / reused socket |
| `Error: Metro /events unreachable at ws://<host>/events` | Metro is not reachable |

The events status is not updated when the socket later closes, so a call that skips `metro` can
print a stale `connected`.

**`metro` source under Expo CLI 57:** the `/events` socket opens and reports `connected`, but
receives nothing. Expo CLI 57.0.24 (`createEventsSocket`) registers its connection handler on one
WebSocket server and serves `/events` from a second one with no handler, so no client is ever counted
and no event is broadcast. The `metro` source works only with a Metro whose `/events` broadcasts,
such as the React Native community CLI. Read bundler errors from the Metro terminal instead.

### React Native DevTools and the `app` source

React Native 0.86 (Terreno 57) reports `supportsMultipleDebuggers` for each app page. On a normal
`expo start`, React Native DevTools and `terreno-mcp-local` attach to the app at the same time, and
opening DevTools does not affect the `app` source.

When Metro allows one debugger per app (older React Native, or Expo running headless with
`EXPO_UNSTABLE_HEADLESS=1` or in a webcontainer), opening DevTools (`j` in Metro) disconnects the
MCP. A call that does not read the app then shows, verbatim:

``````text
CDP: CDP disconnected (code 1000: [NEW_DEBUGGER_OPENED] New debugger opened for the same app instance); another debugger (such as React Native DevTools) took the session, and the next call that reads the app reconnects and disconnects it
``````

The next call that reads the app (`read_logs` or `last_error` with `app`, or any CDP tool)
reconnects automatically without an error, reports `CDP: connected to <app> (<device>)`, and
disconnects DevTools, which shows `[NEW_DEBUGGER_OPENED] New debugger opened for the same app
instance`. App console output logged while DevTools held the connection is not in `read_logs`; the
first call after recovery may return only entries from before the gap.

Workaround: use one or the other. Close DevTools, then call `read_logs` with `sources: ["app"]`
twice: the first call reconnects, the second shows new entries. To keep DevTools open, stop calling
tools that read the app, or each call takes the connection back.

## What the local server can and cannot see

The local server inspects the project from the outside. It never imports or runs consumer code in its
own process: model files are read as text, and the app's runtime is reached only over Metro and CDP.

**Can see:**

| Surface | How |
|---------|-----|
| Package manifests | Root and backend/frontend workspace `package.json` files (declared ranges); `bun.lock` presence only |
| MongoDB | `MONGO_URI` from the environment or `backend/.env`; collections, indexes, counts, and read-only queries |
| Model source | First 80 lines of each `backend/src/models/*.ts`, as text |
| Backend and browser logs | `app.log` and `browser.log` JSONL under `.terreno/logs/` in `backend/`, `example-backend/`, or the root |
| Metro | `/json/list` targets and the `/events` socket |
| Running Hermes app | Console output, client state, SyncDB state over CDP; code execution and navigation with `TERRENO_MCP_EVAL` |
| Web app | Rendered page through the `browser` tool's own headless WebView |

**Cannot see:**

- Production or deployed environments: no remote logs, databases, or apps. Production backends do
  not write the JSONL log or accept browser logs.
- The web app's JavaScript heap or console through CDP. A browser tab is not a Metro debug target; use
  `browser`, `browser.log`, and the backend log instead.
- Native crash reports, device logs, or a device that is not attached to the dev server's Metro.
- App console output from before the first `app` read, or while another debugger held a
  single-debugger session.
- Metro bundler events under Expo CLI 57 (the `metro` source is empty).
- The resolved dependency tree: `application_info` reports declared ranges, not installed versions.
- `example-backend/.env` and `example-backend/src/models/` (database discovery reads `backend/` only).

## Environment variables

### Hosted server variables

| Variable | Default | Effect |
|----------|---------|--------|
| `PORT` | `8080` | HTTP listen port. Parsed with `parseInt`, so leading digits win (`80abc` is port 80); a value with no leading digits stops startup with `Invalid PORT value`. |
| `MCP_HOST`, then `HOST` | `0.0.0.0` | Listen host |
| `NODE_ENV` | unset | `production` disables console colors and warns at startup when `SENTRY_DSN` is unset |
| `SENTRY_DSN` | unset (Sentry disabled) | Sentry DSN |
| `APP_ENV` | `development` | Sentry `environment` |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Sentry trace sample rate (float) |
| `TERRENO_MCP_DOCS_DIR` | `<module dir>/docs` (`dist/docs`), else `docs/` next to the executable | Root for bundled resources, prompts' markdown, the search index, and upgrade notes |
| `TERRENO_HELP_API_URL` | unset | Terreno backend help API for announcements in the three update-note tools. Unset means bundled upgrade notes only. |
| `TERRENO_HELP_API_TOKEN` | unset | Bearer token for `TERRENO_HELP_API_URL` |
| `TERRENO_MCP_RATE_LIMIT_MAX` | `120` | JSON-RPC requests per client IP per window; `0` disables. Invalid values stop startup. See [Rate limiting](#rate-limiting). |
| `TERRENO_MCP_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in milliseconds (minimum 1) |
| `TERRENO_MCP_TRUST_PROXY_HOPS` | `1` when `K_SERVICE` is set, else `0` | Reverse-proxy hops trusted for the client IP in `X-Forwarded-For` |
| `K_SERVICE` | set by Cloud Run | Read only to choose the `TERRENO_MCP_TRUST_PROXY_HOPS` default |

### Local server variables

| Variable | Default | Effect |
|----------|---------|--------|
| `TERRENO_PROJECT_ROOT` | Discovered root (see [Running the local server](#running-the-local-server)) | Root for packages, database, logs, Metro URL, and browser paths |
| `TERRENO_METRO_URL` | `--port` from the frontend `start`/`web` script, else `http://localhost:8082` | Metro HTTP origin for `/json/list`, `/events`, and the debugger Origin's port |
| `TERRENO_MCP_EVAL` | disabled | `1` or `true` enables `evaluate`, `navigate`, `syncdb_action`, and `browser` `evaluate`. See [`TERRENO_MCP_EVAL` gate](#terreno_mcp_eval-gate). |
| `MONGO_URI` | `MONGO_URI`, then `MONGODB_URI`, from `<root>/backend/.env` | MongoDB for `database_schema` and `database_query` |
| `BUN_CHROME_PATH` | Bun auto-discovery | Chrome, Chromium, or Edge binary for `browser` on Linux and Windows (read by Bun, not Terreno) |

### App-side variables that feed the local server

| Variable | Read by | Default | Effect |
|----------|---------|---------|--------|
| `TERRENO_LOG_FILE` | `@terreno/api` logger | on when `NODE_ENV !== "production"` | Backend JSONL transport to `<cwd>/.terreno/logs/app.log` (5 MB × 3 files, level `debug`). `false`/`0` forces off, `true`/`1` forces on. A toggle, not a path. |
| `TERRENO_BROWSER_LOGS` | `@terreno/api` `TerrenoApp` | on only when `NODE_ENV === "development"` | Registers `POST /__terreno/browser-logs`, which appends to `<cwd>/.terreno/logs/browser.log`. `true`/`1` opts in outside development, `false`/`0` disables; production never registers it. See [Development browser-log ingestion](api.md#development-browser-log-ingestion). |
| `NODE_ENV` | `@terreno/api` | unset | Drives both defaults above |
| `TERRENO_DEV_CONSOLE_LOGGER_TEST` | `@terreno/syncdb` `installTerrenoDevConsoleLogger` | unset | Test-only: `true` lets the console logger install outside `__DEV__` |

The full cross-package list is in [Environment variables](environment-variables.md).

## Development

``````bash
# From the monorepo root
bun install
bun run mcp:build          # sync docs + tsc + copy docs into dist/

# From mcp-server/
bun run compile            # type-check only
bun run build              # full artifact (sync-ui-docs, sync-versioned-docs, sync-package-guidelines, tsc, copy docs)
bun run dev                # hosted server with watch
bun run start              # hosted server from dist/ (run build first)
bun run test               # bun test src/
bun run lint
``````

`bun run sync-package-guidelines` refreshes only the bundled package AI guidelines.

### Docker

Build from the repository root, as `scripts/ci/gcp-deploy.sh mcp-prod` does. The image needs the
monorepo (`api/`, `blocks/`, `ui/`, `docs/`, `website/versioned_docs/`):

``````bash
docker build --file mcp-server/Dockerfile -t terreno-mcp-server .
docker run --rm -p 8080:8080 terreno-mcp-server
``````

`mcp-server/src/docs/ui-types-documentation.json` and `mcp-server/src/docs/versioned/` are
git-ignored, so the builder stage generates them. `bun run --filter "@terreno/ui" types` writes the
TypeDoc JSON that `terreno_get_component_docs` reads. `sync-versioned-docs` and
`sync-package-guidelines` fill the `terreno_search_docs` corpus. Without that step the image served
the one-component test fixture (`No component named "Badge". Examples: Button`) and searched only
`resources/*.md`.

### Testing with MCP Inspector

``````bash
# Local server over stdio
bunx @modelcontextprotocol/inspector bun ./mcp-server/dist/local/index.js

# Hosted server: start it, then connect the Inspector with Streamable HTTP to http://localhost:8080/mcp
TERRENO_MCP_RATE_LIMIT_MAX=0 bun ./mcp-server/dist/index.js
bunx @modelcontextprotocol/inspector
``````

## Architecture

``````
mcp-server/
├── src/
│   ├── index.ts            # Hosted entry: reads env, starts the HTTP server
│   ├── httpApp.ts          # Express app: JSON-RPC handlers, routes, health check
│   ├── rateLimit.ts        # Per-IP JSON-RPC rate limit and trust-proxy config
│   ├── instrument.ts       # Sentry init
│   ├── tools.ts            # Hosted tools and dispatch
│   ├── bootstrap.ts        # terreno_bootstrap_ai_rules tool and terreno_bootstrap prompt
│   ├── prompts.ts          # Workflow prompts
│   ├── resources.ts        # Documentation resources
│   ├── docsRoot.ts         # Bundled docs root (TERRENO_MCP_DOCS_DIR)
│   ├── search/             # Docs search index
│   ├── help/               # Update-note search and help API client
│   ├── docs/               # Bundled markdown (resources, upgrades, guidelines)
│   └── local/
│       ├── index.ts        # Local entry (stdio)
│       ├── localServer.ts  # Server and tools/list, tools/call handlers
│       ├── localTools.ts   # Local tool schemas and dispatch
│       ├── projectRoot.ts  # Project root discovery
│       ├── logPaths.ts     # .terreno/logs discovery
│       ├── metro/          # Metro /events and CDP session
│       └── tools/          # Tool implementations
├── dist/                   # Compiled output
└── Dockerfile              # Hosted server image
``````

## Deployment

The hosted server runs as the `terreno-mcp` Cloud Run service. CircleCI's continuous-delivery
pipeline (`.circleci/config.yml`, triggered by changes under `mcp-server/`) builds and rolls the
image; Terraform owns the service's structure, and its hostname cutover is in
[infra/flourish/README.md](../../infra/flourish/README.md#hosted-mcp-hostname).
- Workload Identity Federation setup
