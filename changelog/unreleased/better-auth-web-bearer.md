---
category: Added
---

- `@terreno/syncdb/auth`: `createBetterAuthClient` takes `webAuth: "bearer"` for web apps whose frontend and API are on different sites. On web it stores the `set-auth-token` header from sign-in, sends `Authorization: Bearer` on every Better Auth call including `getSession`, and sends no cookies. `signOut()` clears the token before its request, and a successful `getSession` with no session clears it unless a newer token was stored meanwhile. The token lives in `localStorage` under `${storagePrefix}_bearer_token`, or in the `bearerStorage` you pass (for example `window.sessionStorage` on shared devices). The default stays `"cookie"`, and native is unchanged. The web origin must be in the server's Better Auth `trustedOrigins`. See [Frontend and API on different sites](docs/how-to/configure-better-auth.md#frontend-and-api-on-different-sites).
- `getBetterAuthBearerToken({storagePrefix?, bearerStorage?})` reads that stored token without a network call.
