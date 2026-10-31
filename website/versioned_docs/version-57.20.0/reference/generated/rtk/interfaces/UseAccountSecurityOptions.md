## Extended by

- [`TerrenoAccountSecurityScreenProps`](TerrenoAccountSecurityScreenProps.md)

## Properties

### callbackURL

> **callbackURL**: `string`

Where linking a provider returns: this security screen's route. In bearer mode it may be any
page on one of the server's `oauthHandoff.webOrigins`.

***

### client

> **client**: [`AccountSecurityClientInput`](../type-aliases/AccountSecurityClientInput.md)

A client from `createBetterAuthClient`, with the `passkey` and `twoFactor` features on.

***

### errorCallbackURL?

> `optional` **errorCallbackURL?**: `string`

Where a failed link returns with `?error=`. Defaults to `callbackURL`.

***

### linkError?

> `optional` **linkError?**: `string` \| `string`[] \| `null`

The `?error=` this page was opened with after a link returned. Never displayed as is.

***

### methods?

> `optional` **methods?**: [`BetterAuthMethods`](BetterAuthMethods.md)

The server's methods, when the app already loaded them with `useAuthMethods`. Otherwise the
hook loads them. They decide which cards show.

***

### minPasswordLength?

> `optional` **minPasswordLength?**: `number`

Minimum new-password length: the server's `minPasswordLength`. Defaults to Better Auth's 8.

***

### passkeySupported?

> `optional` **passkeySupported?**: `boolean`

Whether this device can create passkeys. Defaults to whether WebAuthn is available on web.

***

### providerLabels?

> `optional` **providerLabels?**: `Record`\<`string`, `string`\>

Labels for providers without a brand, such as `{"mock-oidc": "Mock OIDC"}`.
