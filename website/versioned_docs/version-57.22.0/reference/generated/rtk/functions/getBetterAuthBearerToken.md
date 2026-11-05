> **getBetterAuthBearerToken**(`__namedParameters?`): `string` \| `null`

Reads the bearer token that `createBetterAuthClient({webAuth: "bearer"})` stored, without a
network call. Pass the same `storagePrefix` and `bearerStorage` the client was created with.
Returns `null` when signed out or when no storage is available.

## Parameters

### \_\_namedParameters?

#### bearerStorage?

[`BetterAuthBearerStorage`](../interfaces/BetterAuthBearerStorage.md)

#### storagePrefix?

`string`

## Returns

`string` \| `null`

## Example

```typescript
const token = getBetterAuthBearerToken({storagePrefix: "myapp"});
```
