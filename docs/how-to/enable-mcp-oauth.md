# Enable MCP OAuth for a JWT app

Let Claude.ai custom connectors, ChatGPT apps, and other remote MCP clients connect to your app's `POST /mcp` through OAuth 2.1. Terreno runs the authorization server; your app hosts one consent screen. The prebuilt `TerrenoOAuthConsentScreen` approves with a Better Auth session; a JWT-only app builds its own page and approves with the user's JWT. An app with its own session sets `req.user` first. See [Apps without a Terreno JWT](#apps-without-a-terreno-jwt).

Use [a service token](connect-mcp-service-token.md) when the client can only hold a static Bearer key (Perplexity, Cursor, Claude Code). For a headless client that can perform a token request, use [client credentials](#headless-clients-client-credentials) instead.

## Prerequisites

- A `TerrenoApp` backend with at least one MCP tool ([Expose MCP tools](expose-mcp-tools.md))
- A public https origin for the API, for example `https://api.example.com`
- A consent page in your app that can call the API as the signed-in user (step 2)

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

  A loopback redirect (`localhost`, `127.0.0.1`, or `[::1]`) matches any port. Register one URI, for example `http://127.0.0.1:33418/callback`, and a native client can send `http://127.0.0.1:<ephemeral>/callback` with the same scheme, host, path, and query. The authorization code is sent to the port the client used. `localhost` and `127.0.0.1` do not match each other. Every other redirect URI must match exactly. There is no per-client opt-out. Another process on that host can listen on a different port and receive the code. PKCE `S256` is what stops that process from exchanging it.

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

- **Claude's published identity (CIMD).** Claude.ai's recommended connector option sends a URL as `client_id`: a Client ID Metadata Document that Anthropic hosts, listing Claude's redirect URIs. List the documents you accept, and a user can add your app by URL with no client to create and no registration endpoint.

  ```typescript
  mcpOAuth: {
    clientIdMetadataDocuments: {
      allowedClientIds: [
        "https://claude.ai/oauth/mcp-oauth-client-metadata", // Claude.ai connectors
        "https://claude.ai/oauth/claude-code-client-metadata", // Claude Code
      ],
    },
    consentUrl: "https://app.example.com/oauth/consent",
    enabled: true,
    issuer: "https://api.example.com",
  },
  ```

  The metadata then has `client_id_metadata_document_supported: true`. Claude picks CIMD only when that flag is set and `token_endpoint_auth_methods_supported` lists `none`, which Terreno always lists. On `/oauth/authorize`, an allowlisted id is fetched from that exact URL with no redirects followed, a 5 second timeout, and a 16 KiB cap. The document's `client_id` must equal the URL, and `redirect_uris` must be a non-empty array of https or loopback http URLs. A good document is cached for 10 minutes; a failure is not cached. It is stored as a public `McpOAuthClient` whose `clientId` is the URL, so the token, refresh, and revocation flows treat it like any other client. The Claude Code document's `http://localhost/callback` matches any port, like other loopback redirects. Any other URL `client_id` gets `400 Unknown client_id` and is never fetched: the allowlist is what stops the server being pointed at an arbitrary host. `McpOAuthClient.revoke("https://claude.ai/oauth/mcp-oauth-client-metadata")` ends its tokens, and the client stays revoked: later authorize requests get a 400.

### Choose grants

`grants` decides what a client can do once the user approves it. The consent screen shows one checkbox per grant, and `/mcp` enforces the grants on every tool. Without `grants`, the default `mcp` scope is accepted and not enforced.

| Value | Scopes | What the user sees |
| --- | --- | --- |
| `"readOnly"` | `mcp:read` | **Read your data** |
| `"readWrite"` | `mcp:read`, `mcp:write` | **Read your data** and **Change your data** |
| `McpOAuthGrant[]` | your own | your `label` and `description` per grant |

```typescript
mcpOAuth: {
  consentUrl: "https://app.example.com/oauth/consent",
  enabled: true,
  grants: "readWrite",
  issuer: "https://api.example.com",
},
```

A custom grant is `{scope, label, description?, access: "read" | "write"}`, for example `{scope: "todos", label: "Manage todos", access: "write"}`. Scopes cannot contain spaces or repeat.

Every tool is a `read` or a `write` tool:

| Tool | Access |
| --- | --- |
| modelRouter `list`, `read` | `read` |
| modelRouter `create`, `update`, `delete` | `write` |
| Action with `method: "GET"` | `read` |
| Any other action | `write` |
| `registerMCPTool` | `access` you pass, default `"write"` |

A token sees, and can call, a `read` tool when any of its grants has `read` or `write` access, so write implies read. It can use a `write` tool only with a `write` grant. A user who unchecks **Change your data** gets a token that sees only the read tools.

To require one specific grant for a tool, give the tool a `scope`: `mcp: {scopes: {delete: "todos:admin"}}` on modelRouter, `mcp: {name, scope}` on an action, or `registerMCPTool({..., scope})`. Such a tool needs exactly that scope, whatever the token's access level.

```typescript
registerMCPTool({
  access: "read", // without it the tool is "write" and read-only grants never see it
  description: "Look up an order by number",
  handler,
  name: "orders_lookup",
  zodSchema,
});
```

Grants limit only OAuth tokens (`mcpat_`). JWTs, Better Auth sessions, and `mcp_` service tokens still see every tool their user can call.

Switching an app that already has connected clients to `grants`:

- Live tokens with the old `mcp` scope match no grant and see no tools. Users reconnect their clients.
- Confidential clients stored with `scope: "mcp"` get `invalid_scope` at `/oauth/token`. Update their stored `scope`.
- `registerMCPTool` tools default to `write`. Add `access: "read"` to every read-only lookup, or read-only grants never see it.

Booting with an issuer that has a path, a consent URL that is not a URL, registration on with no redirect hosts, both `grants` and `scopesSupported`, an empty or unknown `grants` value, a duplicate scope, or a scope with a space throws. Full option list: [API reference → MCP OAuth](../reference/api.md#mcp-oauth).

## 2. Host the consent screen

The prebuilt screen signs users in through Better Auth. A JWT-only app uses [Build your own consent page](#build-your-own-consent-page) instead, and an app with its own session also reads [Apps without a Terreno JWT](#apps-without-a-terreno-jwt).

Mount `TerrenoOAuthConsentScreen` from `@terreno/syncdb/auth` at the route `consentUrl` points to. Signed out, it shows `TerrenoLoginScreen` with your `loginProps`; after sign-in it shows the client, the redirect host, a checkbox per grant, and **Approve** and **Deny**. It reads `?request=` from the URL and sends the browser back to the client when the user decides.

```tsx
// app/oauth/consent.tsx
import {TerrenoOAuthConsentScreen} from "@terreno/syncdb/auth";
import type React from "react";

import {betterAuthClient, rememberedAccounts} from "@/lib/betterAuth";

const OAuthConsent: React.FC = () => (
  <TerrenoOAuthConsentScreen
    loginProps={{
      client: betterAuthClient,
      methods: {providers: ["google"]},
      rememberedAccounts,
    }}
  />
);

export default OAuthConsent;
```

- Render it inside `SessionProvider` and an `ApiClientProvider` whose client sends the user's credentials.
- Let the route through your layout's signed-out redirect. The screen signs the user in itself.
- `loginProps.methods` (`{providers?, emailPassword?, passkey?}`) only narrows the sign-in methods the server already offers. Turning on Google, Apple, or GitHub is server config: `googleOAuth`, `appleOAuth`, or `githubOAuth` in `BetterAuthConfig`. A provider listed in `methods` but not configured on the server shows no button.
- Social sign-in returns to the same URL, `?request=` included, unless `loginProps.callbackURL` says otherwise.
- **Bearer mode** (web app and API on different sites): add the consent path to `oauthHandoff.callbackPaths`, for example `["/login", "/oauth/consent"]`. The handoff checks only the path, so `?request=` passes through. The consent page is then a handoff return page: it must run `completeBetterAuthOAuthHandoff` before anything reads the session, and must not redirect first. See [Social sign-in in bearer mode](configure-better-auth.md#social-sign-in-in-bearer-mode). Without the path, social sign-in on the consent screen fails with a 400.

Props and error copy: [syncdb reference → MCP OAuth consent](../reference/syncdb.md#mcp-oauth-consent).

If the backend serves `@terreno/admin-spa` (`AdminSpaServeApp`), it already has a consent page: set `consentUrl` to `${issuer}/console/oauth/consent` (use your `basePath` if it is not `/console`). It uses the Better Auth session cookie and approves every requested grant, with no checkboxes. See [admin-spa reference](../reference/admin-spa.md#mcp-oauth-consent-route).

### Limit who can approve

By default any signed-in user can approve a connection. For an app with one owner, or where connectors should need an admin, set `consent`:

```typescript
mcpOAuth: {
  consent: {requireAdmin: true, requireTwoFactor: true},
  consentUrl: "https://app.example.com/oauth/consent",
  enabled: true,
  issuer: "https://api.example.com",
},
```

- `requireAdmin`: only users with `admin: true` can approve.
- `requireTwoFactor`: only users whose Better Auth account has two-factor turned on can approve. It needs a registered `BetterAuthApp` whose config sets `twoFactor`, or the app throws at boot.

A user who fails either check gets `403` from `POST /oauth/authorize/:request/approve`, and the request stays pending, so an approver who is allowed can still decide it. Anyone signed in can still deny. These checks look at who the user is. They do not ask for a second factor at approval time.

### Build your own consent page

The client sends the user's browser to `/oauth/authorize`. Terreno checks the client, redirect URI, PKCE, and scope, stores a pending request, and redirects to `consentUrl?request=<id>`. Your page:

1. Makes sure the user is signed in (send them through login and back if not, keeping `request`).
2. Loads the request to show who is asking:

   ```http
   GET /oauth/authorize/<request>
   Authorization: Bearer <user JWT>
   ```

   Response: `{data: {clientName, redirectHost, scope, grants, expiresAt, …}}`. `grants` is one `{scope, label, description, access}` per requested scope. Show the client name and redirect host so the user can spot a client they did not start, and a checkbox per grant.

3. Posts the decision with the same credentials, then sends the browser to the returned URL:

   ```http
   POST /oauth/authorize/<request>/approve   # or /deny
   Authorization: Bearer <user JWT>
   Content-Type: application/json

   {"scope": "mcp:read"}
   ```

   `scope` is optional: omit it to approve everything requested, or send a space-separated subset. An empty subset is 400 `Choose at least one permission`; a scope the client did not request is 400 `Scope was not requested`.

   ```typescript
   const {data} = await approve(requestId);
   window.location.assign(data.redirectUrl);
   ```

The three endpoints are in OpenAPI (`getMcpOAuthRequest`, `approveMcpOAuthRequest`, `denyMcpOAuthRequest`), so `bun run sdk` generates hooks for them. A request expires after 10 minutes (400 `Authorization request expired`), and a decided request cannot be decided again (409). The endpoints refuse `mcp_` and OAuth bearers, so an agent cannot approve itself.

### Apps without a Terreno JWT

`authenticateMiddleware()` calls `next()` when `req.user` is already set, so the consent routes do not require a JWT or a Better Auth session. Set the approving user in `addMiddleware`, which runs before these routes. Limit that to the consent paths. `GET /oauth/authorize` stays the unauthenticated redirect that starts the flow.

The user object needs `_id`. Approve issues the grant to that id and records that user's `tokenEpoch`. `userForThisRequest` must resolve a session the app has already verified, such as a signed session cookie. Do not set `req.user` from an unverified header or query parameter. That user becomes the subject of the grant.

```typescript
new TerrenoApp({userModel: User, mcpOAuth: {consentUrl, enabled: true, issuer}})
  .addMiddleware(async (req, _res, next) => {
    if (!req.path.startsWith("/oauth/authorize/")) {
      next();
      return;
    }
    const user = await userForThisRequest(req);
    if (user) {
      req.user = user;
    }
    next();
  });
```

Call `GET /oauth/authorize/<request>` and `POST .../approve` or `.../deny` with no `Authorization` header. `mcp_` and `mcpat_` bearers are still rejected on those routes.

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
# Form-encode the id and secret before base64. A raw colon join breaks when either value contains '%' or ':'.
AUTH=$(node -e 'const [id, secret] = process.argv.slice(1); process.stdout.write(Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64"))' "$CLIENT_ID" "$CLIENT_SECRET")
curl -X POST https://api.example.com/oauth/token \
  -H "Authorization: Basic $AUTH" \
  -d grant_type=client_credentials
```

The response is an `mcpat_…` access token and no refresh token. Its scope is the client's stored `scope` limited to the scopes the server supports, or every supported scope when the client stores none. A client whose stored scopes are all unsupported, such as `mcp` after the app switches to `grants`, gets `invalid_scope`. It acts as `userId`, with `credential: "oauth"`. Disabling that user, or bumping `tokenEpoch`, ends the token the same way it ends an authorization-code token. `McpOAuthClient.revoke(clientId)` ends every token that client holds, and a revoked client cannot start a new authorization or token grant. `deleteOne`, `findOneAndDelete`, and `deleteMany` do the same. `bulkWrite` skips those hooks, so use `revoke` when a bulk write removes clients.

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
- With `grants` set, an OAuth token's `tools/list` holds only the tools its grants allow, and calling any other tool fails as an unknown tool. See [Choose grants](#choose-grants). Without `grants`, a token can call every tool its user can; apps on `scopesSupported` enforce their own scopes with `requireOAuthScope(scope)` in permissions. The granted scopes are in `getCurrentRequestContext()?.oauthScopes`.

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

To put `/mcp` on the public internet behind a Cloudflare Tunnel, see [Expose an MCP server safely](expose-mcp-server-safely.md).
