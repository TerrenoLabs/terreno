Options for `features.twoFactor`.

## Properties

### onTwoFactorRedirect?

> `optional` **onTwoFactorRedirect?**: (`context`) => `void` \| `Promise`\<`void`\>

Called when a sign-in answers `twoFactorRedirect` instead of a session. Show the 2FA
challenge here; on native the challenge cookie is already stored when it runs.

#### Parameters

##### context

[`BetterAuthTwoFactorRedirectContext`](BetterAuthTwoFactorRedirectContext.md)

#### Returns

`void` \| `Promise`\<`void`\>
