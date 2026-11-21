# Manage MCP from the admin panel

Add admin screens for an app's MCP server: service tokens, OAuth clients, OAuth connections, a request log, and a tool registry with on/off switches. Add a one-click "sign out of MCP everywhere" script for a user.

## Prerequisites

- A `TerrenoApp` backend with at least one MCP tool ([Expose MCP tools](expose-mcp-tools.md))
- `AdminApp` from `@terreno/admin-backend` and an admin UI (`@terreno/admin-spa` or `@terreno/admin-frontend`)
- Service tokens or MCP OAuth turned on if you want those screens to show data ([service tokens](connect-mcp-service-token.md), [MCP OAuth](enable-mcp-oauth.md))

## 1. Turn on the request log and tool registry

Both are off by default.

```typescript
new TerrenoApp({
  userModel: User,
  mcpRequestLog: {enabled: true, retentionDays: 30},
  mcpToolSettings: true,
  // mcpServiceTokens, mcpOAuth, ...
});
```

- The request log stores one row per `tools/call`: tool, user, credential type, service token or OAuth client, duration, outcome, and the error class when the tool threw. It never stores tool arguments, results, or error messages, so it is safe for apps that handle personal data. Rows are deleted after `retentionDays`.
- The tool registry records every tool at startup. An admin can switch a tool off; it then disappears from `tools/list` and `tools/call` rejects it, for every user and client. The process that saved the switch applies it on the next request; other server instances apply it within 5 seconds. If the settings read fails, the server keeps the last switches it read, and refuses MCP requests when it has none.

## 2. Register the screens and script

```typescript
import {AdminApp, mcpAdminModels, mcpAdminScripts} from "@terreno/admin-backend";

new AdminApp({
  models: [...appAdminModels, ...mcpAdminModels({requestLog: true, toolSettings: true})],
  scripts: [...appScripts, ...mcpAdminScripts()],
});
```

Set `requestLog` and `toolSettings` to match the `TerrenoApp` options from step 1. Both default to `false`, like the server options: a request log screen with logging off stays empty, and tool switches with `mcpToolSettings` off do nothing.

With RBAC (`AdminApp({accessControl})`), add the statements and grant them to the roles that run MCP:

```typescript
import {mcpAdminStatements} from "@terreno/admin-backend";

export const appStatements = {...terrenoStatements, ...mcpAdminStatements, /* ... */};
```

## 3. Use the screens

The admin sidebar shows an **MCP** group:

| Screen | Use it to |
| --- | --- |
| MCP service tokens | See each user's `mcp_` keys and when they were last used. Delete revokes a key. |
| MCP OAuth clients | See registered connectors (Claude.ai, ChatGPT, headless clients) and their redirect URLs. Delete removes the client and revokes everything issued to it. |
| MCP OAuth connections | See who approved which client and when. Each row is one token pair; rows with the same `familyId` are one connection. Delete revokes that connection. |
| MCP request log | See recent tool calls by tool, user, client, outcome, and duration. Filter by user or client to see which clients a user has connected recently. |
| MCP tools | Switch a tool off or on. Only `enabled` can be changed. `registered: false` means the running server no longer has that tool. |

MCP over HTTP is stateless, so there is no list of open connections. "Who is connected" means recent activity in the request log plus active rows in the token and connection screens.

## 4. Sign a user out of MCP everywhere

Run the `mcp-sign-out-everywhere` script from **Scripts** with `user` set to the user's id or email. Run it as a dry run first: it reports how many OAuth connections and service tokens it would revoke. The wet run revokes them all; the user's clients must reconnect.

To end every MCP credential and every app session at once, reset the user's password or revoke their sessions instead. That bumps `tokenEpoch`, which ends OAuth grants and service tokens on their next use.

## Check it

1. Call a tool with a service token, then open **MCP request log**: a row shows the tool, `outcome: ok`, and the token.
2. Switch that tool off in **MCP tools** and run `tools/list` again: the tool is gone.
3. Delete the token's row in **MCP service tokens** and call the tool again: the token no longer authenticates (401 with MCP OAuth on, otherwise the tool refuses an anonymous caller).

## Related

- [Expose an MCP server safely](expose-mcp-server-safely.md)
- [Enable MCP OAuth](enable-mcp-oauth.md)
- [admin-backend reference: MCP screens](../reference/admin-backend.md#mcp-screens)
- [api reference: MCP request log and tool settings](../reference/api.md#mcp-request-log-and-tool-settings)
