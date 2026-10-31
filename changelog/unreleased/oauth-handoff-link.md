---
category: Added
---

- `@terreno/api`: with `oauthHandoff`, a bearer-mode web client on another site can link a
  social or generic OAuth provider to the signed-in user. `POST {basePath}/oauth-handoff/link-intent`
  (bearer- or cookie-authenticated, `{provider, callbackURL, errorCallbackURL?}`) returns
  `{token, startURL}`: a single-use, three-minute link token, stored hashed and bound to the
  caller's session. Both URLs must be absolute pages on one of `oauthHandoff.webOrigins` that
  `trustedOrigins` allows (400 otherwise); `callbackPaths` do not apply, since no token travels
  on a link's return. The intent answers 403 `LINKING_DISABLED` when account linking is off. The web app posts the token
  from a hidden form to `POST {basePath}/oauth-handoff/link-start`, which refuses a missing, `null`, or
  foreign `Origin` with 403 (so web origins must not serve `Referrer-Policy: no-referrer` or
  `same-origin`), then uses the token up (400 with no
  redirect when it is unknown, used, or expired), sets only the OAuth state cookie, first-party on the
  API's origin, and redirects to the provider. The provider callback links the account and
  redirects to `callbackURL` with no one-time token, since no session is created. A session
  revoked after the intent comes back with `error=session_expired`. Both routes are in the auth
  rate-limit bucket, and Better Auth's limiter allows three of each per ten seconds per IP.
- `@terreno/syncdb/auth`: new `linkSocialWithHandoff({client, provider, callbackURL, errorCallbackURL?})`.
  On web in bearer mode it posts the intent and submits the hidden form; in cookie mode and on
  native it calls `client.linkSocial`. It resolves `{error}` (`null` once the browser is on its
  way to the provider). New type `BetterAuthLinkClient`.
