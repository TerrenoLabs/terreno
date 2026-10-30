---
category: Added
---

`@terreno/api` MCP OAuth consent routes accept a request that already has `req.user`. `authenticateMiddleware` skips JWT and Better Auth in that case. Set the approving user in `addMiddleware` on `/oauth/authorize/:request`, approve, and deny. The grant is issued to that user's `_id`. `mcp_` and `mcpat_` bearers are still refused.
