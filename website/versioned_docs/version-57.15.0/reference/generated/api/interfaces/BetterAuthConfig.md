Configuration options for Better Auth integration.

## Properties

### appleOAuth?

> `optional` **appleOAuth?**: [`BetterAuthOAuthProvider`](BetterAuthOAuthProvider.md)

Apple OAuth provider configuration.

***

### authMailTemplates?

> `optional` **authMailTemplates?**: `Partial`\<`Record`\<`"resetPassword"` \| `"verifyEmail"`, \{ `html?`: `string`; `subject`: `string`; `text?`: `string`; \}\>\>

Optional per-app subject/text/html overrides for auth mail.

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

### publicAppUrl?

> `optional` **publicAppUrl?**: `string`

Public web/app origin used in password-reset and verification links.

***

### renderAuthMail?

> `optional` **renderAuthMail?**: (`options`) => `object`

Render reset/verify mail. Pass `@terreno/comms` `renderAuthMail` so JWT and
Better Auth send identical templates.

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

###### subject

`string`

###### text

`string`

###### to

`string`

#### Returns

`Promise`\<`void`\>

***

### trustedOrigins?

> `optional` **trustedOrigins?**: `string`[]

Trusted origins for CORS and redirect validation.
Include your app's deep link schemes (e.g., "terreno://", "exp://").
