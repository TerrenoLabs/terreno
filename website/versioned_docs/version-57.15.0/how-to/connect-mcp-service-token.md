# Connect an MCP client with a service token

Mint a personal `mcp_…` Bearer key, then paste the MCP URL and key into Perplexity, Cursor, VS Code, or Claude Code.

This is the **static-key** path for the consumer app's `POST /mcp`. It is not the hosted `@terreno/mcp` codegen server. For exposing tools, see [Expose MCP tools](expose-mcp-tools.md). Interactive OAuth for remote clients is a separate plan ([app MCP server](../implementationPlans/app-mcp-server.md)); do not send these keys in a query string.

## 1. Enable the flag

```typescript
new TerrenoApp({
  userModel: User,
  mcpServiceTokens: {
    enabled: true,
    publicMcpUrl: process.env.PUBLIC_API_URL,
  },
});
```

`mcpServiceTokens: true` is the same as `{enabled: true}`. Off (omitted or `enabled: false`) does not mount `/mcp/service-tokens` and does not accept `mcp_` Bearer credentials on `/mcp`.

Pass `publicMcpUrl` so create responses include a copy-paste MCP URL (`…/mcp` is appended when missing). The example backend uses `PUBLIC_API_URL` or `BETTER_AUTH_URL`.

## 2. Mint a token (Settings)

1. Sign in to the example app.
2. Open **Profile** → **MCP connections** (`/settings/mcp`).
3. Enter a name (for example `Perplexity laptop`). Optionally set an expiry.
4. Tap **Create token**.
5. Copy the MCP URL, the full `mcp_…` secret, or the JSON snippet from the modal. The secret is shown **once**. Close the modal only after you have stored it in the client.

Cap is **10** active tokens per user. List rows show prefix (`mcp_` + eight hex characters), last used, and expiry — never the full secret.

## 3. Mint a token (curl)

Use a session or JWT. A service token cannot mint another token.

```bash
curl -X POST "$API/mcp/service-tokens" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"Perplexity"}'
```

Read `data.token` and `data.mcpUrl` from the JSON. List and revoke never return `token`. Do not log the secret.

## 4. Perplexity custom connector

| Field | Value |
| --- | --- |
| MCP Server URL | `https://api.example.com/mcp` (use `data.mcpUrl` from create) |
| Transport | Streamable HTTP |
| Authentication | API Key |
| API Key | full `mcp_…` string (Perplexity sends as Bearer) |

Perplexity probes with GET, then POSTs JSON-RPC. Send the same key on both.

GET does **not** authenticate. This server has no GET SSE stream, so `/mcp` answers `405` with `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."}}` whether or not the key is valid. That 405 is the expected probe — not a failed login.

POST `initialize` and `tools/list` are the unauthenticated catalog in the stateless handler. Identity is checked when a **tool runs** (`tools/call`). A missing or invalid `mcp_` key then returns `Permission denied: authentication required`.

## 5. Cursor, VS Code, Claude Code (JSON)

```json
{
  "mcpServers": {
    "my-app": {
      "url": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer mcp_<secret-shown-once>"
      }
    }
  }
}
```

Replace the URL with `data.mcpUrl` and the Bearer value with the one-time `data.token`.

## 6. Prove the key with curl

```bash
# Expected probe: JSON-RPC 405 "Method not allowed."
curl -X GET "$API/mcp" \
  -H "Authorization: Bearer mcp_…" \
  -H "Accept: application/json, text/event-stream"

# Catalog is unauthenticated. Identity is not proven here.
curl -X POST "$API/mcp" \
  -H "Authorization: Bearer mcp_…" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# Identity check: tools/call as the owning user. Use a tool name from tools/list.
curl -X POST "$API/mcp" \
  -H "Authorization: Bearer mcp_…" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"todos_list","arguments":{}}}'
```

A bogus key such as `mcp_deadbeef` on `tools/call` is denied. A valid key sees the same owner-scoped result as that user's REST session.

The token acts as the owning user on **MCP only**. It cannot mint or list tokens, and it is not valid on REST, sync, or admin routes.

## 7. Revoke

- **Owner:** Profile → MCP connections → **Revoke** on the row (`DELETE /mcp/service-tokens/:id`).
- **Admin:** Admin → MCP service tokens (`/admin/mcp-service-tokens`). Create and update are off. Delete sets `revokedAt`; it does not hard-delete the row.

Revoked and expired keys fail `tools/call` immediately. Disabled user accounts are refused the same way as over HTTP.
