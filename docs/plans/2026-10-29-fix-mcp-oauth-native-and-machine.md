# Fix MCP OAuth: loopback ports and machine clients

Native MCP clients such as Claude Code bind an ephemeral loopback port, and `GET /oauth/authorize` rejects that redirect unless the port matches the registered URI exactly. Headless clients cannot use OAuth at all: the token endpoint only accepts `authorization_code` and `refresh_token` for public PKCE clients.

Selected: https://github.com/TerrenoLabs/terreno/issues/1655 https://github.com/TerrenoLabs/terreno/issues/1654 https://github.com/TerrenoLabs/terreno/issues/1653, resolved 2026-10-29T21:42:00Z

## Issues

| Issue | Title | Disposition | Root cause | Task |
| --- | --- | --- | --- | --- |
| #1655 | MCP OAuth: loopback redirect URIs should match any port | fix | `api/src/mcp/oauth.ts` authorize uses exact `redirectUris.includes` | T1 |
| #1653 | MCP OAuth has no machine grant | fix | token route and metadata only allow public authorization-code clients | T2 |
| #1654 | MCP OAuth consent endpoints require JWT/Better Auth | decide | consent routes use `authenticateMiddleware()`; three extension designs are open | none |

## E2E tests

None — proved by supertest HTTP tests in `api/src/mcp/oauth.test.ts`. The defects are authorization-server responses, not a browser or device flow.

## Regression cases

None — no hard-to-automate change.

## User guide

None — operator steps stay in `docs/how-to/enable-mcp-oauth.md`. No end-user guide page describes this flow.

## Tasks

- [x] **T1** — Accept any port on a registered loopback redirect URI (#1655)
  - Depends on: none
  - Files: `api/src/mcp/oauth.ts`, `api/src/mcp/oauth.test.ts`, `api/src/models/mcpOAuthClient.ts`, `docs/how-to/enable-mcp-oauth.md`, `docs/reference/api.md`, `changelog/unreleased/mcp-oauth-loopback-redirect.md`
  - Root cause: `api/src/mcp/oauth.ts` authorize requires `client.redirectUris.includes(redirectUri)`, so a registered `http://127.0.0.1:33418/callback` rejects `http://127.0.0.1:<other>/callback`
  - Proof: `api/src/mcp/oauth.test.ts` "sends the authorization code to the requested loopback port" fails on the base with `400 invalid_request` and passes on the branch with a redirect to that port
  - Closes: #1655

- [x] **T2** — Issue client_credentials access tokens for confidential MCP clients (#1653)
  - Depends on: T1
  - Files: `api/src/mcp/oauth.ts`, `api/src/mcp/oauthMetadata.ts`, `api/src/mcp/oauth.test.ts`, `api/src/models/mcpOAuthClient.ts`, `api/src/models/mcpOAuthToken.ts`, `api/src/types/mcpOAuth.ts`, `api/src/index.ts`, `docs/how-to/enable-mcp-oauth.md`, `docs/reference/api.md`, `changelog/unreleased/mcp-oauth-client-credentials.md`
  - Root cause: `SUPPORTED_GRANT_TYPES` and `/oauth/token` only accept authorization-code and refresh-token grants for public clients
  - Proof: `api/src/mcp/oauth.test.ts` "issues an access token for client_credentials and no refresh token" fails on the base with `unsupported_grant_type` and passes on the branch; `/mcp` calls succeed as the bound user
  - Closes: #1653

## Assumptions

- Loopback matching follows the issue: scheme, hostname, path, and query must match; the port is ignored. `localhost`, `127.0.0.1`, and `[::1]` do not match each other. No per-client opt-out.
- The redirect stored on the authorization request is the URI the client sent, so the code returns to the ephemeral port.
- `private_key_jwt` is deferred.
- The access token's `credential` stays `"oauth"`.
- Dynamic client registration stays public-only. Confidential clients are created with `McpOAuthClient.issueConfidential`, which returns the secret once.
- Both `client_secret_basic` and `client_secret_post` are accepted, and only the method stored on the client.
- Client credentials tokens have no refresh token. The document still stores a unique hash of a discarded secret so the existing unique index on `refreshTokenHash` keeps working, and `hasRefreshToken: false` makes that secret unusable for refresh.
- Revoking or deleting the client revokes every token family issued to it.
- The bound user's `disabled` flag and `tokenEpoch` apply the same way they do for authorization-code tokens.

## Open questions (recommendation assumed)

| Question | Recommendation | Why |
| --- | --- | --- |
| Should dynamic registration mint confidential clients? | No. Only `issueConfidential`. | Registration is unauthenticated. A public registration endpoint that mints secrets widens who can create a machine identity. |
| `credential: "oauth"` or `"oauth-client"`? | `"oauth"` | The issue allows either. `/mcp` already treats `mcpat_` tokens as `oauth`, including scope checks and epoch revocation. |

## Not fixed in this run

| Issue | Disposition | Next action |
| --- | --- | --- |
| #1654 | fixed (docs) | Documented the existing `req.user` short-circuit in `docs/how-to/enable-mcp-oauth.md` and `docs/reference/api.md`. `resolveConsentUser` and a built-in consent page stay out. |

## Sign-off

Status: approved 2026-10-29 (tap: #1655 #1653; #1654 excluded as decide)
