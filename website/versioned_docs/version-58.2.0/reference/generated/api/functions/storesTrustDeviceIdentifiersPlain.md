> **storesTrustDeviceIdentifiersPlain**(`storeIdentifier`): `boolean`

Whether Better Auth stores trusted-device identifiers as written (the default). With a hashed
`verification.storeIdentifier` the prefix is gone, so rows can only be matched by user id.

## Parameters

### storeIdentifier

[`VerificationStoreIdentifier`](../type-aliases/VerificationStoreIdentifier.md) \| `undefined`

## Returns

`boolean`
