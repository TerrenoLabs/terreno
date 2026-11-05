Better Auth client plugins `createBetterAuthClient` adds, matching the server features
`BetterAuthConfig` turns on. Each enabled feature adds its typed namespace to the client.

## Properties

### lastLoginMethod?

> `optional` **lastLoginMethod?**: `boolean`

`lastLoginMethodClient`: `client.getLastUsedLoginMethod()`,
`client.isLastUsedLoginMethod(method)` and `client.clearLastUsedLoginMethod()`. They read
the server's `last_used_login_method` cookie, so they return null on native and when the
API is on another site.

***

### multiSession?

> `optional` **multiSession?**: `boolean`

`multiSessionClient`: `client.multiSession.*` (listDeviceSessions, setActive, revoke).

***

### oneTimeToken?

> `optional` **oneTimeToken?**: `boolean`

`oneTimeTokenClient`: `client.oneTimeToken.generate` and `client.oneTimeToken.verify`.
The OAuth handoff verifies its token without this plugin.

***

### passkey?

> `optional` **passkey?**: `boolean`

`passkeyClient` from `@better-auth/passkey/client`: `client.passkey.*` (addPasskey,
listUserPasskeys, deletePasskey, updatePasskey) and `client.signIn.passkey`. WebAuthn needs
a browser, so passkey calls work on web only.

***

### twoFactor?

> `optional` **twoFactor?**: `boolean` \| [`BetterAuthTwoFactorFeature`](BetterAuthTwoFactorFeature.md)

`twoFactorClient`: `client.twoFactor.*` (enable, disable, getTotpUri, verifyTotp, sendOtp,
verifyOtp, generateBackupCodes, verifyBackupCode). Pass an object to set
`onTwoFactorRedirect`.
