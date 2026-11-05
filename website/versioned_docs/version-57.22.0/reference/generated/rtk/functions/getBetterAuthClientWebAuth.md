> **getBetterAuthClientWebAuth**(`client`): `object`

How a client `createBetterAuthClient` made authenticates on web, and, in bearer mode, the token
it holds. Returns `{webAuth: "cookie", bearerToken: null}` on native (the Expo plugin keeps the
session there), in cookie mode, and for a client this factory did not make. Makes no request.

## Parameters

### client

`object`

## Returns

`object`

### bearerToken

> **bearerToken**: `string` \| `null`

### webAuth

> **webAuth**: [`BetterAuthWebAuth`](../type-aliases/BetterAuthWebAuth.md)

## Example

```typescript
const {webAuth, bearerToken} = getBetterAuthClientWebAuth(authClient);
```
