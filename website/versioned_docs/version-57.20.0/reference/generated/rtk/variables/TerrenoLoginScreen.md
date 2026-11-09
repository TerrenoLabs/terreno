> `const` **TerrenoLoginScreen**: `FC`\<[`TerrenoLoginScreenProps`](../interfaces/TerrenoLoginScreenProps.md)\>

Renders the right step: a spinner while a live session is checked (a valid one calls
`onSignedIn` and never shows the form), the login screen, or the inline two-factor challenge.
See "Drop-in login screen" in docs/how-to/configure-better-auth.md.

## Example

```tsx
<TerrenoLoginScreen
  client={authClient}
  error={useLocalSearchParams<{error?: string}>().error}
  onSignUpPress={() => router.push("/signup")}
  onSignedIn={async () => {
    await betterAuth.syncSession(store.dispatch);
    router.replace("/");
  }}
  rememberedAccounts={rememberedAccounts}
/>
```
