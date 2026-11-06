Options for configuring GitHub OAuth authentication

## Properties

### allowAccountLinking?

> `optional` **allowAccountLinking?**: `boolean`

Whether to allow linking GitHub to existing accounts.
If true, authenticated users can link their GitHub account.
Defaults to true.

***

### allowedReturnTo?

> `optional` **allowedReturnTo?**: `string`[]

Redirect targets allowed for the `returnTo` query parameter of `GET /auth/github`. Each entry
is an exact http(s) origin (`https://app.example.com`) or an exact custom-scheme authority
(`myapp://auth`). A `returnTo` that matches no entry is rejected with 400. When this is
unset or empty, `returnTo` is ignored and the callback always returns JSON.

***

### callbackURL

> **callbackURL**: `string`

Callback URL for GitHub OAuth (e.g., https://yourapp.com/auth/github/callback)

***

### clientId

> **clientId**: `string`

GitHub OAuth Client ID

***

### clientSecret

> **clientSecret**: `string`

GitHub OAuth Client Secret

***

### findOrCreateUser?

> `optional` **findOrCreateUser?**: (`profile`, `accessToken`, `refreshToken`, `existingUser?`) => `Promise`\<`unknown`\>

Custom function to handle user creation or lookup from GitHub profile.
If not provided, a default implementation will be used.
`existingUser` is the user who started `GET /auth/github/link`, read from the verified
OAuth state; it is never taken from a session or token on the callback request.

#### Parameters

##### profile

`Profile`

##### accessToken

`string`

##### refreshToken

`string`

##### existingUser?

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<`unknown`\>

***

### scope?

> `optional` **scope?**: `string`[]

OAuth scopes to request from GitHub. Defaults to ["user:email"]
