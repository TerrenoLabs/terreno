> **useAuthMethods**(`authClient`, `__namedParameters?`): [`UseAuthMethodsResult`](../interfaces/UseAuthMethodsResult.md)

Loads the server's enabled sign-in methods once per client.

## Parameters

### authClient

[`AuthMethodsClient`](../interfaces/AuthMethodsClient.md)

### \_\_namedParameters?

[`UseAuthMethodsOptions`](../interfaces/UseAuthMethodsOptions.md) = `{}`

## Returns

[`UseAuthMethodsResult`](../interfaces/UseAuthMethodsResult.md)

## Example

```tsx
const {methods, isLoading} = useAuthMethods(authClient);
const providers = isLoading ? [] : (methods?.providers ?? []);
```
