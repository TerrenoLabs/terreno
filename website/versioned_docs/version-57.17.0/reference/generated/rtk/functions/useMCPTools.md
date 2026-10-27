> **useMCPTools**(`options?`): [`UseMCPToolsResult`](../interfaces/UseMCPToolsResult.md)

Hook that discovers available MCP tools from the backend.
Uses the official MCP client so protocol negotiation, the per-request 2026-07-28
metadata envelope, required routing headers, response parsing, and list caching stay
aligned with the specification.

## Parameters

### options?

[`UseMCPToolsOptions`](../interfaces/UseMCPToolsOptions.md) = `{}`

## Returns

[`UseMCPToolsResult`](../interfaces/UseMCPToolsResult.md)
