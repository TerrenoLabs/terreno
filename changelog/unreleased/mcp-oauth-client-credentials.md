---
category: Added
---

`@terreno/api` MCP OAuth accepts `grant_type=client_credentials` for a confidential client created with `McpOAuthClient.issueConfidential`. The helper binds the client to a user, stores the secret as a SHA-256 hash, and returns the secret once. The token endpoint accepts `client_secret_basic` or `client_secret_post`, whichever method the client was created with, and returns an `mcpat_` access token with no refresh token. The token acts as that user (`credential: "oauth"`). Revoking or deleting the client ends every token it holds. Dynamic client registration stays public-only. Discovery advertises `client_credentials`, `client_secret_basic`, and `client_secret_post`.
