> **RequestCredential** = `"jwt"` \| `"better-auth-session"` \| `"mcp-service-token"` \| `"oauth"`

How the caller authenticated. Permission functions and hooks read it through
[getCurrentRequestContext](../functions/getCurrentRequestContext.md) to tell a user's own session apart from a delegated agent
credential (an `mcp_` service token or an MCP OAuth access token).

- `jwt`: a Terreno JWT bearer (REST or `/mcp`).
- `better-auth-session`: a Better Auth session cookie or bearer.
- `mcp-service-token`: a personal `mcp_` service token on `/mcp`.
- `oauth`: an MCP OAuth access token on `/mcp`.
