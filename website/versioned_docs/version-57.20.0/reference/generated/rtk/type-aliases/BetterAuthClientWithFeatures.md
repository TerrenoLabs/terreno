> **BetterAuthClientWithFeatures**\<`Features`\> = `ReactAuthClient`\<\{ `baseURL`: `string`; `fetchOptions?`: `BetterAuthFetchOptions`; `plugins`: [`BetterAuthFeaturePlugins`](BetterAuthFeaturePlugins.md)\<`Features`\>; \}\>

Type of the Better Auth client returned by createBetterAuthClient with `features`, such as
`BetterAuthClientWithFeatures<{twoFactor: true}>`. Every enabled feature's namespace is typed.

The expo plugin is left out of the type: it is typed only as a generic plugin (see
createBetterAuthClient), which would widen every namespace to `any`. It adds only `getCookie`.

## Type Parameters

### Features

`Features` *extends* [`BetterAuthClientFeatures`](../interfaces/BetterAuthClientFeatures.md)
