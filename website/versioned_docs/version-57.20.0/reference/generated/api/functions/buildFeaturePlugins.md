> **buildFeaturePlugins**(`config`, `baseURL?`): `BetterAuthPlugin`[]

Builds the Better Auth plugins for every configured auth feature, in a fixed order. Features
are opt-in: a config with none of the fields returns an empty list. `baseURL` is the resolved
server URL (it defaults to `config.baseURL`), which `oauthProxy` compares with `productionURL`.

## Parameters

### config

[`BetterAuthConfig`](../interfaces/BetterAuthConfig.md)

### baseURL?

`string` \| `undefined`

## Returns

`BetterAuthPlugin`[]
