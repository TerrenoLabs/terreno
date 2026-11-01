# @terreno/mcp

MCP servers that give coding agents Terreno docs, code generators, and live app diagnostics — part of
Terreno, the batteries-included TypeScript framework for universal apps.

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
- Local `terreno-mcp-local` tools (13): `application_info`, `database_schema`, `database_query`,
  `read_logs`, `last_error`, `get_client_state`, `get_rtk_state` (deprecated alias of
  `get_client_state`), `get_syncdb_state`, `syncdb_snapshot`, `syncdb_action`, `evaluate`,
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
