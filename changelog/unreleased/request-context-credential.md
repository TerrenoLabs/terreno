---
category: Added
---

`getCurrentRequestContext()?.credential` records how the caller authenticated: `"jwt"`, `"better-auth-session"`, `"mcp-service-token"`, or `"oauth"`. Permission functions and hooks can use it to keep broad access (such as an admin bypass) to the user's own session and away from delegated agent tokens. `extractAuthFromHeaders` returns the same `{user, credential}` pair for MCP mounts. See [Request credential](docs/reference/api.md#request-credential).
