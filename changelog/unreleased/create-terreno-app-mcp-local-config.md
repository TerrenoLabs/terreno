---
category: Fixed
---

`create-terreno-app` MCP configs now start `terreno-mcp-local` with `bunx -p @terreno/mcp terreno-mcp-local`. The old `bunx terreno-mcp-local` entry failed in generated apps because no npm package has that name. Generated apps also get a root `.mcp.json` for Claude Code with the same servers as `.cursor/mcp.json`. In an existing app, add `"-p", "@terreno/mcp"` before `"terreno-mcp-local"` in the `terreno-local` args; see `docs/how-to/set-up-terreno-mcp.md`.
