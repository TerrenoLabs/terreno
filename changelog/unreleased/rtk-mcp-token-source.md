---
category: Added
---

- `useMCPTools` takes a `tokenSource` option. The MCP transport reads its `Authorization: Bearer` token from that source, else the one registered with `setTokenSource`, else the built-in JWT source, before every MCP request instead of capturing one token per fetch. When the source has no token as a fetch starts, the hook connects without authentication, as JWT apps do today.
