> **createChallengeHeadersPlugin**(): `BetterAuthPlugin`

The Better Auth plugin behind cookie-free challenges. `buildFeaturePlugins` adds it after the
two-factor and passkey plugins whenever either is configured, so its after hook sees the
cookies their hooks set.

- Requests: on `{basePath}/two-factor/*`, `/passkey/*`, and `/sign-in/*` (where a trusted
  device is checked), the header's challenge cookies are merged into the Cookie header. This
  runs in `onRequest`, before endpoint hooks, so `bearer()` still adds the session cookie on
  top (a passkey registration needs both).
- Responses: when the request sent the header, the challenge cookies the response sets are
  copied into it, and it is added to `Access-Control-Expose-Headers` the way `bearer()`
  exposes `set-auth-token`. A sign-in that answers with a two-factor challenge loses the
  `set-auth-token` of the session two-factor deleted. Only values the response sets are
  copied, and only for requests that send the header, so a cookie-mode page whose own code
  never sends it keeps its challenge cookies httpOnly.

## Returns

`BetterAuthPlugin`
