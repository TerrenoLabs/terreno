# Expose an MCP server safely

Put a Terreno backend's `POST /mcp` on the public internet with OAuth 2.1 for interactive clients, service tokens for static-key clients, and a Cloudflare Tunnel in front, so no inbound port is open on the host. The admin console stays behind Cloudflare Access.

This guide fits any Terreno backend with MCP tools. It is written for the single-binary MCP server from the `bootstrap-mcp-server` skill, which serves `/mcp` and the admin console (including its OAuth consent screen at `/console/oauth/consent`) from one origin.

## Prerequisites

- A Terreno backend with at least one MCP tool ([Expose MCP tools](expose-mcp-tools.md))
- A domain on Cloudflare, for example `example.com`, and `cloudflared` on the host that runs the backend
- A hostname for the server, for example `mcp.example.com`

## What is public and what is not

| Path | Who calls it | Exposure |
| --- | --- | --- |
| `POST /mcp` | MCP clients | Public. Every request needs a Bearer credential. |
| `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server` | MCP clients during discovery | Public |
| `/oauth/authorize`, `/oauth/token`, `/oauth/register`, `/oauth/revoke` | MCP clients and the user's browser | Public, rate limited |
| `/console` (including `/console/oauth/consent`), `/api/auth` | Operators, and any user approving an OAuth connection (they sign in and approve in the console) | Behind Cloudflare Access when every OAuth approver is in the Access policy; otherwise public, guarded by Better Auth and the `admin` check |
| `/admin` | The console's admin API | Behind Cloudflare Access when `/console` is |
| `/health` | Uptime checks | Public |

MCP clients cannot complete a Cloudflare Access login, so the first three rows must bypass Access. Everything else does not need to.

## 1. Pick the credential for each client

| Client | Credential | Guide |
| --- | --- | --- |
| Claude.ai custom connectors, ChatGPT connectors | OAuth 2.1 access token (`mcpat_…`) | [Enable MCP OAuth](enable-mcp-oauth.md) |
| Perplexity, Cursor, Claude Code, MCP Inspector | Service token (`mcp_…`) | [Connect an MCP client with a service token](connect-mcp-service-token.md) |
| A headless service you run | OAuth client credentials | [Enable MCP OAuth](enable-mcp-oauth.md#headless-clients-client-credentials) |

Every credential acts as one user and gets that user's MCP permissions. Mint service tokens for the person who uses them, not for an admin account.

## 2. Configure the backend for a public origin

```typescript
const publicUrl = "https://mcp.example.com";

new TerrenoApp({
  userModel: User,
  mcpServiceTokens: {enabled: true, publicMcpUrl: publicUrl},
  mcpOAuth: {
    allowedRedirectHosts: ["claude.ai", "chatgpt.com"],
    consentUrl: `${publicUrl}/console/oauth/consent`,
    dynamicClientRegistration: true,
    enabled: true,
    issuer: publicUrl,
  },
  rateLimit: {store: "memory", trustProxy: "loopback"}, // cloudflared on the same host
});
```

- `issuer` must be the exact origin clients reach. Discovery documents, the `WWW-Authenticate` challenge, and token audiences are built from it. If it says `http://localhost:4000`, every remote client fails discovery.
- Keep `allowedRedirectHosts` to the clients you support. With dynamic client registration on, anyone can register a client, and this list is what stops a registered client from sending authorization codes to a host you did not choose.
- Turn rate limiting on. Registration and token requests are unauthenticated.
- Set `trustProxy` for the proxy in front of the app. With `cloudflared` on the same host, every request arrives from `127.0.0.1`; `"loopback"` tells Express to read the client address from `X-Forwarded-For` instead. Confirm with one request that `req.ip` is your public address. Without it, every visitor shares one rate-limit bucket.
- Set `BETTER_AUTH_URL` to the same public origin so console sign-in cookies are issued for it.

## 3. Create a named tunnel

Use a named tunnel. A quick tunnel (`cloudflared tunnel --url …`) gets a new `trycloudflare.com` hostname on every run, so the `issuer`, the discovery documents, and every client registered against the old hostname break. Cloudflare documents quick tunnels as a testing tool.

```bash
cloudflared tunnel login
cloudflared tunnel create mcp
cloudflared tunnel route dns mcp mcp.example.com
```

Write `~/.cloudflared/config.yml`:

```yaml
tunnel: mcp
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: mcp.example.com
    service: http://127.0.0.1:4000
  - service: http_status:404
```

Run it as a service (`sudo cloudflared service install`), and check:

```bash
curl -s https://mcp.example.com/health
curl -si -X POST https://mcp.example.com/mcp | grep -i www-authenticate
```

The second command prints `WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"`. If the URL in it is not your public hostname, fix `issuer`.

## 4. Close the direct path

The tunnel makes an outbound connection, so the backend needs no inbound port. Block the backend port (4000 above) at the host firewall so the only way in is through Cloudflare, where Access and Cloudflare's own protections apply. Do not port-forward it from a router.

## 5. Put the console behind Cloudflare Access

In Cloudflare Zero Trust, add a **self-hosted** Access application for `mcp.example.com` with these paths, and an Allow policy for your operators' emails or identity-provider group:

- `/console`
- `/admin`
- `/api/auth`

That works only when every user who approves an OAuth connection is in the policy, because approving needs the console's consent screen, its sign-in page, and Better Auth. When people outside the policy connect clients too, leave `/console` and `/api/auth` out of the Access application and rely on Better Auth sign-in and the `admin` check. You can still keep `/admin` behind Access, since only operators (who are in the policy) call it.

Do not add `/mcp`, `/.well-known`, or the other `/oauth/*` paths. An Access application on the bare hostname covers them too, so scope it to paths.

Access is a second layer, not a replacement: the admin routes still require `admin: true`, and the console still requires a Better Auth session.

## 6. Connect a client and check it

1. Claude.ai: **Settings → Connectors → Add custom connector**, paste `https://mcp.example.com/mcp`, connect, approve on the consent page.
2. If you registered `mcpAdminModels()` ([Manage MCP from the admin panel](manage-mcp-in-admin.md)), open **MCP OAuth clients** and **MCP OAuth connections** in the console and confirm the new client and connection.
3. Static-key client: mint a token with `POST /mcp/service-tokens` (signed in as that user), then run `tools/list` with `Authorization: Bearer mcp_…`.

## Revoking access

- One service token: delete it on **MCP service tokens**, or the owner calls `DELETE /mcp/service-tokens/<id>`.
- Every MCP credential one user holds: run the `mcp-sign-out-everywhere` admin script.
- One OAuth connection: delete it on **MCP OAuth connections**, or have the client call `/oauth/revoke`.
- Everything a user holds: disable the user, or reset their password or revoke their sessions (both bump `tokenEpoch`). Their OAuth grants and service tokens stop working on the next request. See [Enable MCP OAuth](enable-mcp-oauth.md#revoking-access).
- Cut all traffic at once: stop the tunnel (`sudo systemctl stop cloudflared`).

## Security checklist

- [ ] `issuer` and `BETTER_AUTH_URL` equal the tunnel hostname
- [ ] Named tunnel, not a quick tunnel
- [ ] Backend port closed to inbound traffic
- [ ] `rateLimit` on, with `trustProxy` set so `req.ip` is the visitor, not the proxy
- [ ] `allowedRedirectHosts` lists only supported clients
- [ ] Access covers `/console` and `/api/auth` only when every OAuth approver is in the policy (`/admin` can always be covered), and never `/mcp`, `/.well-known`, or `/oauth/*`
- [ ] MCP tools expose only the methods each model needs (`mcp: {methods: ["list", "read"]}` unless writes are intended)
- [ ] Credentials are minted per person, never shared from an admin account

## Related

- [Enable MCP OAuth for a JWT app](enable-mcp-oauth.md)
- [Connect an MCP client with a service token](connect-mcp-service-token.md)
- [Expose MCP tools](expose-mcp-tools.md)
- [Manage MCP from the admin panel](manage-mcp-in-admin.md)
- [Rate limiting](rate-limiting.md)
