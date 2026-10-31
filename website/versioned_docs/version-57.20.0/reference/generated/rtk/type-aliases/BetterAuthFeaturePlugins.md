> **BetterAuthFeaturePlugins**\<`Features`\> = \[`...FeaturePlugin<Features, "twoFactor", ReturnType<typeof twoFactorClient>>`, `...FeaturePlugin<Features, "passkey", ReturnType<typeof passkeyClient>>`, `...FeaturePlugin<Features, "multiSession", ReturnType<typeof multiSessionClient>>`, `...FeaturePlugin<Features, "lastLoginMethod", ReturnType<typeof lastLoginMethodClient>>`, `...FeaturePlugin<Features, "oneTimeToken", ReturnType<typeof oneTimeTokenClient>>`\]

The typed client plugins for a `features` object, in the order `createBetterAuthClient`
registers them. Better Auth infers each namespace (`client.twoFactor`, `client.passkey`, ...)
from this tuple.

## Type Parameters

### Features

`Features` *extends* [`BetterAuthClientFeatures`](../interfaces/BetterAuthClientFeatures.md)
