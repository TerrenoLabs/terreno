# Enable MCP OAuth for a JWT app

Let Claude.ai custom connectors, ChatGPT apps, and other remote MCP clients connect to your app's `POST /mcp` through OAuth 2.1, when your app signs users in with Terreno JWTs. Terreno runs the authorization server; your app hosts one consent screen.

Use [a service token](connect-mcp-service-token.md) instead for clients that take a static Bearer key (Perplexity, Cursor, Claude Code).

## Prerequisites

- A `TerrenoApp` backend with at least one MCP tool ([Expose MCP tools](expose-mcp-tools.md))
- A public https origin for the API, for example `https://api.example.com`
- A signed-in page in your app that can call the API with the user's JWT

## 1. Turn on `mcpOAuth`

```typescript
new TerrenoApp({
  userModel: User,
  mcpOAuth: {
    allowedRedirectHosts: ["claude.ai", "chatgpt.com"],
    consentUrl: "https://app.example.com/oauth/consent",
    enabled: true,
    issuer: "https://api.example.com",
  },
});
```

- `issuer` is the API's public origin, with no path. Every discovery URL and endpoint is built from it, so it must be the origin clients reach.
- `consentUrl` is the page from step 2.
- `allowedRedirectHosts` limits where clients may send codes. Claude.ai redirects to `claude.ai`, ChatGPT to `chatgpt.com`. Use `*.example.com` for subdomains, and add `localhost` only if you want local clients with loopback `http://` redirects.

Booting with an issuer that has a path, a consent URL that is not a URL, or no redirect hosts throws. Full option list: [API reference → MCP OAuth](../reference/api.md#mcp-oauth).

## 2. Host the consent screen

The client sends the user's browser to `/oauth/authorize`. Terreno checks the client, redirect URI, and PKCE, stores a pending request, and redirects to `consentUrl?request=<id>`. Your page:

1. Makes sure the user is signed in (send them through login and back if not, keeping `request`).
2. Loads the request to show who is asking:

   ```http
   GET /oauth/authorize/<request>
   Authorization: Bearer <user JWT>
   ```

   Response: `{data: {clientName, redirectHost, scope, expiresAt, …}}`. Show the client name and redirect host so the user can spot a client they did not start.

3. Posts the decision with the same JWT, then sends the browser to the returned URL:

   ```http
   POST /oauth/authorize/<request>/approve   # or /deny
   Authorization: Bearer <user JWT>
   ```

   ```typescript
   const {data} = await approve(requestId);
   window.location.assign(data.redirectUrl);
   ```

The three endpoints are in OpenAPI (`getMcpOAuthRequest`, `approveMcpOAuthRequest`, `denyMcpOAuthRequest`), so `bun run sdk` generates hooks for them. A request expires after 10 minutes (400 `Authorization request expired`), and a decided request cannot be decided again (409). The endpoints refuse `mcp_` and OAuth bearers, so an agent cannot approve itself.

## 3. Connect a client

Give the client the MCP URL, `https://api.example.com/mcp`. It discovers the rest:

1. `POST /mcp` without credentials returns `401` with `WWW-Authenticate: Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp"`.
2. The client reads that document, then `/.well-known/oauth-authorization-server`.
3. It registers itself at `/oauth/register`, runs the browser flow through your consent screen, and exchanges the code at `/oauth/token` for an access token (`mcpat_…`, one hour) and a refresh token (`mcprt_…`, 30 days).

For Claude.ai: **Settings → Connectors → Add custom connector**, paste the MCP URL, and connect. For ChatGPT: create a connector with the MCP URL and choose OAuth.

## 4. Check it

```bash
curl -i -X POST https://api.example.com/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# HTTP/1.1 401 … WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"

curl https://api.example.com/.well-known/oauth-authorization-server
```

## What changes on `/mcp`

- Every request that cannot be authenticated, including `initialize` and `tools/list`, gets the 401 challenge. A rejected credential adds `error="invalid_token"` so clients refresh.
- JWTs, Better Auth sessions, and `mcp_` service tokens keep working.
- Tools see the approving user. `getCurrentRequestContext()?.credential` is `"oauth"`, so permission code can treat an agent's token differently from the user's own session (for example, no admin bypass). See [Request credential](../reference/api.md#request-credential).

## Revoking access

- The client revokes with `POST /oauth/revoke`. Revoking a refresh token ends the whole chain.
- Disabling the user stops their tokens at the next call.
- Server-side, revoke everything a user granted with `McpOAuthToken.updateMany({userId, revokedAt: {$exists: false}}, {$set: {revokedAt: DateTime.now().toJSDate()}})`.

Refresh tokens rotate on every use. If an old refresh token comes back, Terreno assumes it leaked and revokes every token issued from that approval; the user reconnects the client.

## Security notes

- Only public clients with PKCE `S256` are supported. `plain` PKCE and client secrets are rejected.
- Tokens, codes, and refresh tokens are stored as SHA-256 hashes.
- Registration, authorize, token, and revoke count against the `auth` [rate-limit](rate-limiting.md) bucket. Turn rate limiting on in production, since registration is unauthenticated.
- If a browser-based client (such as the MCP Inspector) runs discovery from another origin, allow that origin in `corsOrigin`.
