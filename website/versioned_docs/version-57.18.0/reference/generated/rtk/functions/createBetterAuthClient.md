> **createBetterAuthClient**(`config`): `ReactAuthClient`\<\{ `baseURL`: `string`; `fetchOptions?`: `object` & `object`; `plugins`: `BetterAuthClientPlugin`[]; \}\>

Creates a Better Auth client configured for Expo/React Native.

Pass `webAuth: "bearer"` when the web frontend and the API are on different sites: the web
client then authenticates with a stored bearer token instead of cookies. Read that token
elsewhere with `getBetterAuthBearerToken`.

## Parameters

### config

[`BetterAuthClientConfig`](../interfaces/BetterAuthClientConfig.md)

## Returns

`ReactAuthClient`\<\{ `baseURL`: `string`; `fetchOptions?`: `object` & `object`; `plugins`: `BetterAuthClientPlugin`[]; \}\>

## Example

```typescript
const authClient = createBetterAuthClient({
  baseURL: "http://localhost:3000",
  scheme: "terreno",
});

// Use for social login
await authClient.signIn.social({
  provider: "google",
});

// Get current session
const session = await authClient.getSession();
```
