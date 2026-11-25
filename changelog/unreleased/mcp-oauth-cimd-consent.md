---
category: Added
---

- `@terreno/api` MCP OAuth accepts Client ID Metadata Documents, so a Claude.ai connector can use "Use Claude's published identity" with no client to create. List the accepted ids in `mcpOAuth.clientIdMetadataDocuments.allowedClientIds` (for example `https://claude.ai/oauth/mcp-oauth-client-metadata`). `/oauth/authorize` fetches an allowlisted id's document with no redirects, a 5 second timeout, and a 16 KiB cap, caches it for 10 minutes, and stores it as a public `McpOAuthClient` (`McpOAuthClient.upsertFromMetadataDocument`). The metadata then has `client_id_metadata_document_supported: true`. A revoked metadata-document client stays revoked, and no other URL is ever fetched.
- `mcpOAuth.consent.mode: "builtin"` serves a consent page from the API at `/oauth/consent/:request`. It asks for email, password, and an authenticator code on every approval, checks them against Better Auth in-process without creating a session, refuses a reused code, and locks consent for an email after five failures in 15 minutes (`McpOAuthConsentAttempt`). `consentUrl` is optional in this mode. It needs a `BetterAuthApp` whose config sets `twoFactor`.
- `mcpOAuth.consent.requireAdmin` and `requireTwoFactor` limit who may approve a connection. The JSON approve endpoint answers 403 to anyone else and leaves the request pending; the built-in page shows an error.
- `GET /oauth/authorize/:request` and the approve endpoint now refuse a client revoked after authorize with 400 `The client was revoked`.
