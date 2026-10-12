Options for configuring GitHub OAuth authentication

## Properties

### allowAccountLinking?

> `optional` **allowAccountLinking?**: `boolean`

Whether to allow linking GitHub to existing accounts.
If true, authenticated users can link their GitHub account.
Defaults to true.

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
