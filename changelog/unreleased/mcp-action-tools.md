---
category: Added
---

modelRouter actions can opt into MCP with `mcp: {name, description?}`. The action becomes a tool on `/mcp` that takes `{id, ...body}` (instance) or the body alone (collection), runs the action's own permission chain including RBAC `access`, and gets `req.isMCPRequest === true`. Actions also accept `unwrapResponse: true` to send the handler's return value as the REST body instead of `{data: …}`. See [modelRouter actions → MCP tools](docs/explanation/model-router-actions.md#mcp-tools).
