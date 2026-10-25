---
category: Added
---

`TerrenoApp` `mcpOAuth` turns on an OAuth 2.1 authorization server for `/mcp`, so Claude.ai connectors and ChatGPT apps can connect to apps that sign in with Terreno JWTs. It serves RFC 9728 and RFC 8414 discovery, dynamic client registration (public clients, redirect hosts allowlisted), the authorization-code flow with PKCE S256 and an app-hosted consent screen, rotating refresh tokens with reuse detection, and revocation. With it on, `/mcp` answers unauthenticated requests with a `401` `WWW-Authenticate` challenge. See [Enable MCP OAuth for a JWT app](docs/how-to/enable-mcp-oauth.md).
