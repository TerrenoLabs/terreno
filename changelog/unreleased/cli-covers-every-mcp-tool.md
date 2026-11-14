---
category: Added
---

- **@terreno/cli:** every MCP tool is now a `terreno` command, so an agent with a shell needs no MCP configuration. New commands: `terreno syncdb action` and `terreno syncdb snapshot`, `terreno storage read|write`, `terreno dev list|run`, `terreno dispatch`, `terreno docs notes search|get|ask`, and `terreno validate blocks`. `terreno tool list|schema|call` reaches any tool by its MCP name.
- **@terreno/cli:** `terreno browser <action>` drives one web page across separate commands. The page and SyncDB snapshots live in a background CLI session (`terreno session start|stop|status`) that those commands start themselves.
- **@terreno/cli:** `terreno login` signs in with Better Auth or JWT and saves a token that `terreno api` sends to the same API origin. `terreno logout` removes it.
- **@terreno/mcp:** new exports `@terreno/mcp/project-root` (`resolveTerrenoProjectRoot`) and `@terreno/mcp/local-tool-names` (`LOCAL_TOOL_NAMES`), and `checkUiBlocks` on `@terreno/mcp/tools`, which reports whether a block document is valid along with the `terreno-blocks validate` text.
