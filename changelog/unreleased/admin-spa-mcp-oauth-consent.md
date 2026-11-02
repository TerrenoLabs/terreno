---
category: Added
---

`@terreno/admin-spa` serves an MCP OAuth consent screen at `/console/oauth/consent`, so a backend with no product frontend can set `mcpOAuth.consentUrl` to `${issuer}/console/oauth/consent`. Any signed-in user can approve or deny a request with their Better Auth session; signed-out users sign in and return through the login screen's new `returnTo` parameter, which accepts only in-app paths.
