Configuration options for Better Auth integration.

## Properties

### accountLinking?

> `optional` **accountLinking?**: [`BetterAuthAccountLinkingConfig`](BetterAuthAccountLinkingConfig.md)

Account linking policy for same-email sign-ins. Maps to Better Auth's
`account.accountLinking`. Unset keeps Better Auth's default (`verified-email`).

***

### appleOAuth?

> `optional` **appleOAuth?**: [`BetterAuthAppleSecretProvider`](BetterAuthAppleSecretProvider.md) \| [`BetterAuthAppleKeyProvider`](BetterAuthAppleKeyProvider.md)

Apple OAuth provider configuration: either a pre-made client secret or the Sign in with
Apple key, from which Terreno signs the client secret at startup.

***

### authMailTemplates?

> `optional` **authMailTemplates?**: `Partial`\<`Record`\<[`BetterAuthMailTemplateId`](../type-aliases/BetterAuthMailTemplateId.md), [`BetterAuthMailTemplate`](BetterAuthMailTemplate.md)\>\>

Optional per-app subject/text/html overrides for auth mail, including the `security*`
notification templates `AccountSecurityApp` sends.

***

### basePath?

> `optional` **basePath?**: `string`

Base path for Better Auth routes.

#### Default

```ts
"/api/auth"
```

***

### baseURL?

> `optional` **baseURL?**: `string`

Base URL for the auth server.
If not provided, falls back to BETTER_AUTH_URL environment variable.

***

### crossDomainCookies?

> `optional` **crossDomainCookies?**: `boolean`

Allow credential cookies when the frontend and API are hosted on different sites.
Enables `SameSite=None; Secure` cookie attributes. Keep disabled for local HTTP.

***

### disableRateLimit?

> `optional` **disableRateLimit?**: `boolean`

Disable Better Auth's built-in IP limiter. Use only on throwaway in-process
seed apps — production `BetterAuthApp` instances keep the default (on in
`NODE_ENV=production`).

***

### enabled

> **enabled**: `boolean`

Whether Better Auth is enabled for this server.

***

### githubOAuth?

> `optional` **githubOAuth?**: [`BetterAuthOAuthProvider`](BetterAuthOAuthProvider.md)

GitHub OAuth provider configuration.

***

### googleOAuth?

> `optional` **googleOAuth?**: [`BetterAuthOAuthProvider`](BetterAuthOAuthProvider.md)

Google OAuth provider configuration.

***

### lastLoginMethod?

> `optional` **lastLoginMethod?**: `boolean`

Remember the method each user last signed in with, in a cookie and on the Better Auth user
(`lastLoginMethod`). Off by default.

***

### multiSession?

> `optional` **multiSession?**: [`BetterAuthMultiSessionConfig`](BetterAuthMultiSessionConfig.md)

Several signed-in accounts per device. Unset by default.

***

### nativeApps?

> `optional` **nativeApps?**: `boolean`

Register the `@better-auth/expo` server plugin so native apps can sign in with social
providers through the system browser. Off by default.

***

### oauthHandoff?

> `optional` **oauthHandoff?**: [`BetterAuthOAuthHandoffConfig`](BetterAuthOAuthHandoffConfig.md)

Hands a one-time token to web apps that sign in with a social or generic OAuth provider
from another site, so they can use the bearer scheme without cookies. Unset by default.

Start the sign-in with a top-level navigation to
`GET {basePath}/oauth-handoff/start?provider=<id>&callbackURL=<url>` (optional
`errorCallbackURL`), not with `POST /sign-in/social` from fetch. The start endpoint sets the
OAuth state cookie first-party on the API's origin and redirects to the provider, so the
cookie comes back on the callback even when the browser blocks third-party cookies. It works
for social and generic OAuth providers. It answers 400, with no redirect, unless
`callbackURL` (and `errorCallbackURL`, when given) is an absolute URL on one of `webOrigins`
that `trustedOrigins` also allows, and unless the request is a page navigation. The URL's
query is kept as it is. When the provider is unknown or cannot start, it redirects to
`errorCallbackURL` (or `callbackURL`) with `error=provider_not_found` or
`error=sign_in_failed`. It does not take `scopes`, `loginHint`, `requestSignUp`, or
`newUserCallbackURL`, so a provider with `disableImplicitSignUp` cannot sign up new users
through it. Better Auth's limiter allows three starts per ten seconds per IP.

When set, Terreno adds Better Auth's `oneTimeToken` plugin (three-minute, single-use tokens,
stored hashed, which clients cannot mint) and an after-hook on `/callback/:id`. When that
callback creates a session and redirects to a listed path on one of `webOrigins`, the
redirect `Location` gets `ott=<token>` in its URL fragment. The web app exchanges it once
with `POST {basePath}/one-time-token/verify`, which answers with the session and the
`set-auth-token` header.

No other redirect gets a token: paths outside `callbackPaths`, app schemes (`exp://`,
`terreno://`), relative paths, the API's own origin, and origins that only `trustedOrigins`
allows (including wildcard patterns) are left as they are. The start endpoint refuses a
`callbackURL` outside `callbackPaths` too; `errorCallbackURL` may be any path on a web
origin, since an error redirect never carries a token. Each web origin must also be in
`trustedOrigins`, or both the start endpoint and `POST /sign-in/social` refuse it as a
`callbackURL`.

The handoff is for bearer clients only. A handed-off callback redirect carries no session
cookie for the API's origin, and verify drops every Set-Cookie it would send (the session
cookies and any a plugin adds there), so a cookie-mode app gets no session from it.

Linking a provider to the signed-in user takes two steps, because the link must also start
from a top-level navigation and a bearer cannot ride along on one:
- `POST {basePath}/oauth-handoff/link-intent`, authenticated with the bearer (or a cookie
  session), body `{provider, callbackURL, errorCallbackURL?}`, answers
  `{token, startURL}`. Both URLs must be absolute and on one of `webOrigins` that
  `trustedOrigins` allows; `callbackPaths` do not apply, since no token travels on a link's
  return (400 otherwise; Better Auth's own origin check answers 403 first for an untrusted
  one). It answers 403
  `LINKING_DISABLED` when account linking is off. The token is single-use, expires in three
  minutes, and is stored hashed in the verification table (`terreno-link-intent:<hash>`),
  bound to the caller's session.
- `POST {basePath}/oauth-handoff/link-start`, a form post (`token=<token>`) the web app
  submits as a page navigation, so the token never appears in a URL. It answers 400 when
  `Sec-Fetch-Dest` is set and is not `document`, and 403 when `Origin` is missing, `null`, or
  not one of `webOrigins`; neither uses the token. The web origins must therefore not serve
  `Referrer-Policy: no-referrer` or `same-origin`, which make the form's `Origin` `null`. It then uses the token up (400 with no redirect
  when it is unknown, used, or expired), runs Better Auth's link flow as the token's
  session, sets only the OAuth state cookie, and redirects to the provider.
  A link that cannot start redirects to `errorCallbackURL` (or `callbackURL`) with
  `error=session_expired` (the session was revoked after the intent),
  `error=provider_not_found`, or `error=link_failed`.

The provider callback links the account and redirects to `callbackURL` without a token,
since no session is created. Better Auth's limiter allows three link intents and three link
starts per ten seconds per IP.

***

### oauthProxy?

> `optional` **oauthProxy?**: [`BetterAuthOAuthProxyConfig`](BetterAuthOAuthProxyConfig.md)

Proxy OAuth callbacks from the stable deploy to preview deploys. Unset by default.

***

### options?

> `optional` **options?**: `object`

Any other Better Auth option, deep-merged over the options Terreno builds from this
config (for example `emailAndPassword.requireEmailVerification`,
`emailAndPassword.password.{hash, verify}`, or `databaseHooks`). Arrays replace Terreno's
rather than merging by index. An explicit value wins (an `undefined` value is ignored),
including over Terreno's security defaults: the `database` adapter, `emailAndPassword.revokeSessionsOnPasswordReset`, and
`session.cookieCache`. Set the base path with `basePath` and plugins with `plugins`.

***

### passkey?

> `optional` **passkey?**: [`BetterAuthPasskeyConfig`](BetterAuthPasskeyConfig.md)

Passkey sign-in and registration. Unset by default.

***

### plugins?

> `optional` **plugins?**: `BetterAuthPlugin`[]

Better Auth plugins, appended after Terreno's `bearer()`, methods and feature plugins. Their endpoints mount
under `basePath`. They are not added to the `auth.api` type.

***

### publicAppUrl?

> `optional` **publicAppUrl?**: `string`

Public web/app origin used in password-reset and verification links.

***

### renderAuthMail?

> `optional` **renderAuthMail?**: (`options`) => `object`

Render reset/verify mail. Pass `@terreno/comms` `renderAuthMail` so JWT and
Better Auth send identical templates. Security notifications do not use it; see
`AccountSecurityApp` `notifications.render`.

#### Parameters

##### options

###### publicAppUrl

`string`

###### templateId

`"resetPassword"` \| `"verifyEmail"`

###### templates?

`Partial`\<`Record`\<`"resetPassword"` \| `"verifyEmail"`, \{ `html?`: `string`; `subject`: `string`; `text?`: `string`; \}\>\>

###### token

`string`

#### Returns

`object`

##### html?

> `optional` **html?**: `string`

##### subject

> **subject**: `string`

##### text?

> `optional` **text?**: `string`

***

### secret?

> `optional` **secret?**: `string`

Secret key for Better Auth session encryption.
If not provided, falls back to BETTER_AUTH_SECRET environment variable.

***

### sendMail?

> `optional` **sendMail?**: (`message`) => `Promise`\<`void`\>

Deliver auth mail. Typically `getCommsService().sendMail`.

#### Parameters

##### message

###### html?

`string`

###### sensitive?

`boolean`

###### subject

`string`

###### text

`string`

###### to

`string`

#### Returns

`Promise`\<`void`\>

***

### signUp?

> `optional` **signUp?**: [`BetterAuthSignUpConfig`](BetterAuthSignUpConfig.md)

Open or closed sign-up. Defaults to `{mode: "open"}`.

***

### trustedOrigins?

> `optional` **trustedOrigins?**: `string`[]

Trusted origins for CORS and redirect validation.
Include your app's deep link schemes (e.g., "terreno://", "exp://").

***

### twoFactor?

> `optional` **twoFactor?**: [`BetterAuthTwoFactorConfig`](BetterAuthTwoFactorConfig.md)

Two-factor authentication. Unset by default.
