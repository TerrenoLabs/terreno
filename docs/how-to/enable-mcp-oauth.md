# Enable MCP OAuth for a JWT app

Let Claude.ai custom connectors, ChatGPT apps, and other remote MCP clients connect to your app's `POST /mcp` through OAuth 2.1, when your app signs users in with Terreno JWTs. Terreno runs the authorization server; your app hosts one consent screen.

Use [a service token](connect-mcp-service-token.md) when the client can only hold a static Bearer key (Perplexity, Cursor, Claude Code). For a headless client that can perform a token request, use [client credentials](#headless-clients-client-credentials) instead.

## Prerequisites

- A `TerrenoApp` backend with at least one MCP tool ([Expose MCP tools](expose-mcp-tools.md))
- A public https origin for the API, for example `https://api.example.com`
- A signed-in page in your app that can call the API with the user's JWT

## 1. Turn on `mcpOAuth`

MCP OAuth is off until you set `enabled: true`. Without it the app has no `/oauth/*` routes, no `.well-known/oauth-*` documents, and no OAuth challenge on `/mcp`.

```typescript
new TerrenoApp({
  userModel: User,
  mcpOAuth: {
    consentUrl: "https://app.example.com/oauth/consent",
    enabled: true,
    issuer: "https://api.example.com",
  },
});
```

- `issuer` is the API's public origin, with no path. Every discovery URL and endpoint is built from it, so it must be the origin clients reach.
- `consentUrl` is the page from step 2.

### Choose how clients get a `client_id`

Dynamic client registration (`POST /oauth/register`) is a separate opt-in and stays off by default. The endpoint is unauthenticated: anyone who can reach your API can create a client with any name and a redirect on an allowed host. The consent screen is then the only thing between that client and a user's grant, so a convincing name is enough to phish an approval.

- **Registration off (default).** Create each client yourself and give its `client_id` to the client (Claude.ai custom connectors accept one under advanced settings). `/oauth/register` returns 404 and the metadata has no `registration_endpoint`.

  ```typescript
  import {McpOAuthClient} from "@terreno/api";

  await McpOAuthClient.create({
    clientId: "claude-connector",
    clientName: "Claude",
    grantTypes: ["authorization_code", "refresh_token"],
    redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    responseTypes: ["code"],
  });
  ```

  A loopback redirect (`localhost`, `127.0.0.1`, or `[::1]`) matches any port. Register one URI, for example `http://127.0.0.1:33418/callback`, and a native client can send `http://127.0.0.1:<ephemeral>/callback` with the same scheme, host, path, and query. The authorization code is sent to the port the client used. `localhost` and `127.0.0.1` do not match each other. Every other redirect URI must match exactly.

- **Registration on.** Turn it on only when clients you cannot pre-register must connect. Set `dynamicClientRegistration: true` and list `allowedRedirectHosts`, which limits where a registered client may send codes. Claude.ai redirects to `claude.ai`, ChatGPT to `chatgpt.com`. Use `*.example.com` for subdomains, and add `localhost` only if you want local clients with loopback `http://` redirects. Keep rate limiting on.

  ```typescript
  mcpOAuth: {
    allowedRedirectHosts: ["claude.ai", "chatgpt.com"],
    consentUrl: "https://app.example.com/oauth/consent",
    dynamicClientRegistration: true,
    enabled: true,
    issuer: "https://api.example.com",
  },
  ```

Booting with an issuer that has a path, a consent URL that is not a URL, or registration on with no redirect hosts throws. Full option list: [API reference → MCP OAuth](../reference/api.md#mcp-oauth).

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
3. It uses the `client_id` you gave it, or registers itself at `/oauth/register` when `dynamicClientRegistration` is on, then runs the browser flow through your consent screen, and exchanges the code at `/oauth/token` for an access token (`mcpat_…`, one hour) and a refresh token (`mcprt_…`, 30 days).

For Claude.ai: **Settings → Connectors → Add custom connector**, paste the MCP URL, and connect. For ChatGPT: create a connector with the MCP URL and choose OAuth.

## Headless clients (client credentials)

A sandbox or another server has no browser, so it cannot run the authorization-code flow. Create a confidential client bound to a service-account user. The helper returns the secret once. Store it, then exchange it at `POST /oauth/token`. Dynamic registration stays public-only and still rejects client secrets.

```typescript
import {McpOAuthClient} from "@terreno/api";

const {client, clientSecret} = await McpOAuthClient.issueConfidential({
  clientName: "Sandbox agent",
  tokenEndpointAuthMethod: "client_secret_basic", // or "client_secret_post"
  userId: serviceAccount._id,
});
```

`client_secret_basic` sends `Authorization: Basic` with the form-encoded `client_id:client_secret`. `client_secret_post` sends `client_id` and `client_secret` in the form body. The client must use the method it was created with.

```bash
curl -X POST https://api.example.com/oauth/token \
  -H "Authorization: Basic $(printf '%s' "$CLIENT_ID:$CLIENT_SECRET" | base64)" \
  -d grant_type=client_credentials
```

The response is an `mcpat_…` access token and no refresh token. It acts as `userId`, with `credential: "oauth"`. Disabling that user, or bumping `tokenEpoch`, ends the token the same way it ends an authorization-code token. `McpOAuthClient.revoke(clientId)` ends every token that client holds, and a revoked client cannot start a new authorization or token grant. `deleteOne`, `findOneAndDelete`, and `deleteMany` do the same. `bulkWrite` skips those hooks, so use `revoke` when a bulk write removes clients.

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
- Scopes are not enforced for you. A token can call every tool its user can, whatever scope it was granted. If `scopesSupported` lists scopes with different meanings (for example `["read", "write"]`), add `requireOAuthScope("write")` to the permissions of the methods and actions that need it. The granted scopes are in `getCurrentRequestContext()?.oauthScopes`.

## Revoking access

- The client revokes with `POST /oauth/revoke`. Revoking a refresh token ends the whole chain.
- Disabling the user stops their tokens at the next call.
- A password reset, Better Auth password change, or session revocation (anything that bumps `tokenEpoch`) ends every grant approved before it: the next `/mcp` call, refresh, or code exchange fails and the chain is revoked. The user reconnects the client.
- Server-side, revoke everything a user granted with `McpOAuthToken.updateMany({userId, revokedAt: {$exists: false}}, {$set: {revokedAt: DateTime.now().toJSDate()}})`.

Refresh tokens rotate on every use. If an old refresh token comes back, Terreno assumes it leaked and revokes every token issued from that approval; the user reconnects the client. The revoke is final: Terreno records the revoked approval, so a refresh or code exchange that was already in flight cannot issue a new token for it.

## Security notes

- Public clients use PKCE `S256` only. `plain` PKCE is rejected. Confidential clients use `client_credentials` with `client_secret_basic` or `client_secret_post`. `private_key_jwt` is not supported. Dynamic registration cannot create a confidential client.
- Tokens, codes, and refresh tokens are stored as SHA-256 hashes.
- Registration, authorize, token, and revoke count against the `auth` [rate-limit](rate-limiting.md) bucket. Turn rate limiting on in production, since registration is unauthenticated.
- If a browser-based client (such as the MCP Inspector) runs discovery from another origin, allow that origin in `corsOrigin`.
