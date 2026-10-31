> **useLoginController**(`__namedParameters`): [`LoginController`](../interfaces/LoginController.md)

Drives a login screen from a Better Auth client. See "Drop-in login screen" in
docs/how-to/configure-better-auth.md.

## Parameters

### \_\_namedParameters

[`UseLoginControllerOptions`](../interfaces/UseLoginControllerOptions.md)

## Returns

[`LoginController`](../interfaces/LoginController.md)

## Example

```tsx
const login = useLoginController({
  client: authClient,
  onSignedIn: async () => {
    await betterAuth.syncSession(dispatch);
    router.replace("/");
  },
  rememberedAccounts,
});
return <LoginScreen fields={fields} {...login.screenProps} />;
```
