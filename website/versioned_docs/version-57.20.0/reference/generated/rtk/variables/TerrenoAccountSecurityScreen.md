> `const` **TerrenoAccountSecurityScreen**: `FC`\<[`TerrenoAccountSecurityScreenProps`](../interfaces/TerrenoAccountSecurityScreenProps.md)\>

Renders the security screen for the signed-in user. See "Drop-in security screen" in
docs/how-to/configure-better-auth.md.

## Example

```tsx
<TerrenoAccountSecurityScreen
  callbackURL="/security"
  client={authClient}
  linkError={useLocalSearchParams<{error?: string}>().error}
/>
```
