---
category: Added
---

`TerrenoApp` `mcpOAuth: {enabled: true}` turns on an OAuth 2.1 authorization server for `/mcp`, so Claude.ai connectors and ChatGPT apps can connect to apps that sign in with Terreno JWTs. It is off by default. It serves RFC 9728 and RFC 8414 discovery, the authorization-code flow with PKCE S256 and an app-hosted consent screen, rotating refresh tokens with reuse detection, and revocation. Revoking a token family writes an `McpOAuthRevokedFamily` tombstone that `McpOAuthToken.issue` honors, so concurrent refreshes and code replays cannot leave a live token. Dynamic client registration (public clients, redirect hosts allowlisted) is a separate opt-in, `dynamicClientRegistration: true`; without it, the app creates `McpOAuthClient` documents itself. With `mcpOAuth` on, `/mcp` answers unauthenticated requests with a `401` `WWW-Authenticate` challenge. See [Enable MCP OAuth for a JWT app](docs/how-to/enable-mcp-oauth.md).
