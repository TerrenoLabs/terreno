---
category: Added
---

The hosted Terreno MCP server rate limits JSON-RPC calls per client IP (default 120 requests per 60 seconds). Excess calls get HTTP 429 with a JSON-RPC error naming the limit and retry window. Configure with `TERRENO_MCP_RATE_LIMIT_MAX` (`0` disables), `TERRENO_MCP_RATE_LIMIT_WINDOW_MS`, and `TERRENO_MCP_TRUST_PROXY_HOPS`.
