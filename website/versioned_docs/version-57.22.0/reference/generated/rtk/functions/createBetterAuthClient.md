> **createBetterAuthClient**\<`Features`\>(`config`): [`BetterAuthClientFor`](../type-aliases/BetterAuthClientFor.md)\<`Features`\>

Creates a Better Auth client configured for Expo/React Native.

Pass `webAuth: "bearer"` when the web frontend and the API are on different sites: the web
client then authenticates with a stored bearer token instead of cookies. Read that token
elsewhere with `getBetterAuthBearerToken`.

Pass `features` to add the client plugins for the Better Auth features the server enables.
Each one adds a typed namespace: `client.twoFactor`, `client.passkey`, `client.multiSession`,
`client.oneTimeToken`, and `client.getLastUsedLoginMethod`.

## Type Parameters

### Features

`Features` *extends* [`BetterAuthClientFeatures`](../interfaces/BetterAuthClientFeatures.md) = [`BetterAuthClientFeatures`](../interfaces/BetterAuthClientFeatures.md)

## Parameters

### config

[`BetterAuthClientConfig`](../interfaces/BetterAuthClientConfig.md)\<`Features`\>

## Returns

[`BetterAuthClientFor`](../type-aliases/BetterAuthClientFor.md)\<`Features`\>

## Example

```typescript
const authClient = createBetterAuthClient({
  baseURL: "http://localhost:3000",
  features: {passkey: true, twoFactor: {onTwoFactorRedirect: () => router.push("/2fa")}},
  scheme: "terreno",
});

// Use for social login
await authClient.signIn.social({
  provider: "google",
});

// Get current session
const session = await authClient.getSession();

// Feature namespaces are typed
await authClient.twoFactor.enable({password});
```
