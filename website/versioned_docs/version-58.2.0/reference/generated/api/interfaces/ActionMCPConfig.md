Exposes an action as an MCP tool on `/mcp`.

## Properties

### description?

> `optional` **description?**: `string`

Tool description shown to the model. Defaults to the action's description or summary.

***

### name

> **name**: `string`

MCP tool name, unique across every tool the app exposes (e.g. `todos_bulk_complete`).

***

### scope?

> `optional` **scope?**: `string`

OAuth scope a token must hold to see and call this tool. Only enforced when
`mcpOAuth.grants` is set. Without it, a GET action is a `read` tool and any other a `write`
tool.
