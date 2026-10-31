# @terreno/mcp

MCP servers that give coding agents Terreno docs, code generators, and live app diagnostics — part of
Terreno, the batteries-included TypeScript framework for universal apps.

## Features

### Resources

Documentation resources accessible via MCP:

- `terreno://docs/overview` - Overview of the Terreno monorepo
- `terreno://docs/api` - @terreno/api documentation
- `terreno://docs/ui` - @terreno/ui documentation
- `terreno://docs/syncdb` - @terreno/syncdb documentation
- `terreno://docs/patterns` - Common patterns and best practices

### Tools

Code generation tools:

- `terreno_search_docs` - Search bundled Terreno documentation (call before guessing APIs). Optional `version` selects a retained docs snapshot; omit for current `next` docs.
- `terreno_get_component_docs` - Full `@terreno/ui` props table for one component
- `terreno_get_upgrade_guide` - Lockstep upgrade notes between two `@terreno/*` versions
- `terreno_search_update_notes` - Search bundled upgrade markdown and optional backend announcement help API
- `terreno_get_update_note` - Fetch one full update note by id (`upgrade:<semver>` or `announcement:<mongoId>`)
- `terreno_ask_update_help` - Ask a natural-language question; returns ranked matches with full update bodies
- `terreno_bootstrap_ai_rules` - Scaffold AI assistant rules files for Cursor, Claude Code, etc.
- `terreno_generate_model` - Generate a Mongoose model with proper Terreno conventions
- `terreno_generate_route` - Generate a modelRouter route configuration
- `terreno_generate_screen` - Generate a React Native screen component
- `terreno_generate_form_fields` - Generate form field components
- `terreno_validate_model_schema` - Validate a Mongoose schema follows conventions
- `terreno_install_admin` - Generate admin panel integration files and instructions

Local runtime tools (`terreno-mcp-local`):

- `get_syncdb_state` - Inspect live SyncDB entities, outbox, conflicts, cursors,
  streams, repair markers, status, and debugger events
- `syncdb_snapshot` - Capture, list, read, compare, and delete SyncDB snapshots
- `syncdb_action` - Mutate/edit local state, flush, reconcile/resync,
  resolve/retry, toggle offline mode, clear events, and merge snapshots

Create the SyncDB client with `debug: true`. State changes require
`TERRENO_MCP_EVAL=1`; reads and snapshots do not.

### Prompts

Code generation prompts:

- `terreno_bootstrap` - Prompt workflow for scaffolding a new Terreno application
- `terreno_create_crud_feature` - Generate complete CRUD feature (model, routes, screens)
- `terreno_create_api_endpoint` - Generate custom API endpoint with OpenAPI docs
- `terreno_create_ui_component` - Generate reusable UI component
- `terreno_create_form_screen` - Generate form screen with validation
- `terreno_add_authentication` - Generate authentication setup
- `terreno_migrate_to_terreno_app` - Migrate from setupServer to TerrenoApp pattern
- `terreno_style_guide` - Get the Terreno code style guide
- `terreno_upgrade` - Lockstep Terreno upgrade workflow

## Install

The hosted server needs no install: point your editor at `https://mcp.terreno.app/mcp` (MCP
Streamable HTTP). Install the package in your app for the local stdio server:

```bash
bun add -d @terreno/mcp
```

The local server needs Bun 1.4 or newer for its `browser` tool.

## Quick start

Add both servers to `.cursor/mcp.json` (or `.mcp.json` for Claude Code) at the app repository root:

```json
{
  "mcpServers": {
    "terreno": {"type": "http", "url": "https://mcp.terreno.app/mcp"},
    "terreno-local": {"command": "bunx", "args": ["terreno-mcp-local"]}
  }
}
```

Restart the editor, then ask the agent to call `terreno_search_docs` or `application_info`.

## What's included

- Hosted `terreno-mcp` tools (14): `terreno_bootstrap_ai_rules`, `terreno_search_docs`,
  `terreno_get_component_docs`, `terreno_get_upgrade_guide`, `terreno_search_update_notes`,
  `terreno_get_update_note`, `terreno_ask_update_help`, `terreno_generate_model`,
  `terreno_generate_route`, `terreno_generate_screen`, `terreno_generate_form_fields`,
  `terreno_validate_model_schema`, `terreno_validate_ui_blocks`, `terreno_install_admin`
- Local `terreno-mcp-local` tools (11): `application_info`, `database_schema`, `database_query`,
  `read_logs`, `last_error`, `get_syncdb_state`, `syncdb_snapshot`, `syncdb_action`, `evaluate`,
  `navigate`, `browser`
- Nine workflow prompts (`terreno_bootstrap`, `terreno_create_crud_feature`, `terreno_upgrade`, and
  more) and `terreno://docs/*` documentation resources on the hosted server
- Code generators return text with a target path; the agent writes the files
- Rate limiting: the hosted server allows 120 requests per 60 seconds per client IP by default and
  answers `429` with `Retry-After` beyond that
- `TERRENO_MCP_EVAL` gate: `evaluate`, `navigate`, `syncdb_action`, and the `browser` `evaluate`
  action run only when the local server's environment sets `TERRENO_MCP_EVAL=1` (or `true`)

## Documentation

- Reference (every tool, parameter, and environment variable): [docs/reference/mcp-server.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/mcp-server.md)
- How-to: [Set up Terreno MCP](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/set-up-terreno-mcp.md)
- How-to: [Debug a Terreno app with MCP](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/debug-with-mcp.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
