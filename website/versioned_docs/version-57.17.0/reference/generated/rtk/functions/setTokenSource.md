> **setTokenSource**(`source`): `void`

Registers the token source every `@terreno/rtk` consumer reads by default. Pass the same
`AuthProvider` the app builds for syncdb (for example
`betterAuthAdapter(betterAuthClient)`), once at startup. Until an app registers one, rtk uses
the legacy JWT tokens in storage. Pass `undefined` to go back to that default.

## Parameters

### source

`AuthProvider` \| `undefined`

## Returns

`void`
