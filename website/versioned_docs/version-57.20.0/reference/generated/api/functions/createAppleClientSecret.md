> **createAppleClientSecret**(`key`): `string`

Signs the ES256 client-secret JWT Sign in with Apple expects, valid for 180 days from now.
Uses `node:crypto` because `createBetterAuth` is synchronous.

## Parameters

### key

[`BetterAuthAppleKeyProvider`](../interfaces/BetterAuthAppleKeyProvider.md)

## Returns

`string`
