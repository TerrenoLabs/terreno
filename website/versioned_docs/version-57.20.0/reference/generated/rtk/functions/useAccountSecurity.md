> **useAccountSecurity**(`__namedParameters`): [`AccountSecurity`](../interfaces/AccountSecurity.md)

Drives an account security screen from a Better Auth client. See "Drop-in security screen" in
docs/how-to/configure-better-auth.md.

## Parameters

### \_\_namedParameters

[`UseAccountSecurityOptions`](../interfaces/UseAccountSecurityOptions.md)

## Returns

[`AccountSecurity`](../interfaces/AccountSecurity.md)

## Example

```tsx
const security = useAccountSecurity({client: authClient, callbackURL: "/security"});
return <AccountSecurityScreen {...security.screenProps} />;
```
