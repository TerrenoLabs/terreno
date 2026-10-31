> **BetterAuthClientFor**\<`Features`\> = [`BetterAuthClientFeatures`](../interfaces/BetterAuthClientFeatures.md) *extends* `Features` ? [`BetterAuthClient`](BetterAuthClient.md) : [`BetterAuthClientWithFeatures`](BetterAuthClientWithFeatures.md)\<`Features`\>

The client createBetterAuthClient returns for a `features` type. When the features are not
known at compile time (no `features`, or a config typed as `BetterAuthClientConfig`), it is
`BetterAuthClient`, exactly the client it always returned. When they are written out, every
enabled feature's namespace is typed.

## Type Parameters

### Features

`Features` *extends* [`BetterAuthClientFeatures`](../interfaces/BetterAuthClientFeatures.md)
