---
trigger: always_on
---
# @terreno/mcp

Model Context Protocol (MCP) server that provides tools, prompts, and resources for AI coding assistants to generate Terreno-compatible code. Built with Express and JSON-RPC 2.0.

## Commands

```bash
bun run compile          # Type-check only (tsc) — no doc bundling; used by the monorepo build
bun run build            # Full shippable artifact: sync docs + tsc + copy docs into dist/
bun run dev              # Development mode
bun run start            # Start the server (needs dist/docs — run `bun run build` first)
bun run lint             # Lint code
```

> `compile` is type-check only so the monorepo `bun run compile` stays fast and free of the
> `sync-versioned-docs` filesystem race under concurrent builds. `prepublishOnly` runs
> `bun run build` on every `npm publish` (GitHub Actions and CircleCI alike), so the
> published `@terreno/mcp` always bundles `dist/docs` (versioned + guidelines + ui-types).

## Architecture

### File Structure

```
src/
  index.ts               # Express HTTP server with JSON-RPC handlers
  tools.ts               # Code generation tools (models, routes, screens, forms)
  prompts.ts             # Multi-step workflow prompts (CRUD, auth, components)
  resources.ts           # Documentation resources loaded from markdown
```

## Available Tools

| Tool | Description |
|------|-------------|
| `terreno_bootstrap_ai_rules` | Scaffold AI assistant rules for Cursor, Claude Code, Copilot, etc. |
| `terreno_generate_model` | Creates Mongoose schemas with Terreno conventions (plugins, types, methods/statics) |
| `terreno_generate_route` | Creates modelRouter configurations with permission setup |
| `terreno_generate_screen` | Creates React Native screens (list, detail, form, empty types) |
| `terreno_generate_form_fields` | Generates form field components with validation |
| `terreno_validate_model_schema` | Validates schemas against Terreno conventions |
| `terreno_validate_ui_blocks` | Validates a whole-reply block document; same report as `terreno-blocks validate` |
| `terreno_install_admin` | Generates admin panel integration files and instructions |

Each tool returns generated code wrapped with file path instructions and additional setup steps.

The local stdio server also exposes runtime diagnostics (16 tools, defined in
`src/local/localTools.ts`). Prefer the **`debug-with-mcp`** skill for the standard
observe → fix → verify loop. For SyncDB-only issues use **`debug-syncdb-with-mcp`**. Tool
list: [`docs/reference/mcp-server.md`](../../../docs/reference/mcp-server.md).

Every local tool has a `terreno` CLI command that calls the same handler, so agents with a
shell need no MCP configuration. Prefer the CLI in docs, skills, and examples.

| Tool | CLI | Description |
|------|-----|-------------|
| `application_info` | `terreno info` | Project root and key dependency versions |
| `read_logs` / `last_error` | `terreno logs` / `terreno logs last-error` | Merged dev logs (backend, browser, metro, app, network, native) |
| `database_schema` / `database_query` | `terreno db schema` / `terreno db query` | Read-only Mongo |
| `get_syncdb_state` | `terreno state` | Read entities, outbox, conflicts, cursors, streams, repair markers, status, and debug events |
| `syncdb_snapshot` | `terreno syncdb snapshot` | Capture, list, read, compare, and delete in-memory snapshots |
| `syncdb_action` | `terreno syncdb action` | Mutate or directly edit local state, flush, reconcile/resync, resolve/retry, toggle offline, clear events, and merge snapshots |
| `dispatch_client_action` | `terreno dispatch` | Dev client action dispatch |
| `read_local_storage` / `write_local_storage` | `terreno storage read` / `write` | Dev AsyncStorage registry |
| `list_dev_commands` / `invoke_dev_command` | `terreno dev list` / `run` | App-registered dev command handlers |
| `navigate` / `evaluate` | `terreno navigate` / `terreno eval` | Drive the native runtime |
| `browser` | `terreno browser` (step by step) / `terreno web` (one sequence) | Drive the web app |

`get_client_state` and `get_rtk_state` were removed with Redux in Terreno 58; use
`get_syncdb_state`.

SyncDB state changes and other gated tools require `TERRENO_MCP_EVAL=1` on the process that
runs the tool. Read and snapshot operations remain available without that opt-in. Follow
`docs/how-to/debug-with-mcp.md`.

When you add a local tool, add its name to `LOCAL_TOOL_NAMES`
(`src/local/localToolNames.ts`), its CLI command, and its row in `COMMAND_FOR_TOOL`
(`cli/src/mcpParity.test.ts`). `localTools.test.ts` fails until the name is listed, and the
CLI test fails until the tool has a command.

## Available Prompts

| Prompt | Description |
|--------|-------------|
| `terreno_bootstrap` | Workflow for scaffolding a new Terreno application |
| `terreno_create_crud_feature` | Full CRUD generation: model + routes + screens |
| `terreno_create_api_endpoint` | Custom API endpoint with OpenAPI docs |
| `terreno_create_ui_component` | Reusable UI component (display, interactive, form, layout) |
| `terreno_create_form_screen` | Form screen with validation |
| `terreno_add_authentication` | Auth setup with feature selection |
| `terreno_migrate_to_terreno_app` | Migrate from setupServer to TerrenoApp pattern |
| `terreno_style_guide` | Code style guide from project markdown |

Prompts provide detailed requirements, example code patterns, and step-by-step setup instructions.

## Available Resources

- Terreno overview documentation
- @terreno/api documentation
- @terreno/ui documentation
- @terreno/syncdb documentation
- Patterns and best practices

Resources are loaded from markdown files with dynamic path resolution.

## Server

- Express-based HTTP server with JSON-RPC 2.0 protocol
- Handles: ListResources, ReadResource, ListTools, CallTool, ListPrompts, GetPrompt
- Configurable port and host via environment variables
- Health check endpoint at root

## Adding a New Tool

```typescript
// In src/tools.ts
{
  name: "terreno_my_tool",
  description: "What it does",
  inputSchema: {
    type: "object",
    properties: {
      name: {type: "string", description: "Resource name"},
    },
    required: ["name"],
  },
  handler: (args) => {
    return {content: [{type: "text", text: generatedCode}]};
  },
}
```

## Conventions

- Use TypeScript with ES modules
- Prefer const arrow functions
- Named exports preferred
- Use `logger.info/warn/error/debug` for permanent logs
