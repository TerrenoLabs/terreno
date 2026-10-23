---
category: Added
---

`LoginScreen` (`@terreno/ui`) gains optional props for returning users: `lastUsedMethod` badges the
method this device used last and moves a provider or passkey above the form; `currentSessions` and
`rememberedAccounts` render one-tap "Continue" cards (`onContinue`, `onForget`); `onPasskeyPress`
adds a "Sign in with a passkey" button and `passkeyAutofill` asks web browsers to offer saved
passkeys in the email field; `notice` shows guidance such as an `account_not_linked` hint; and
`genericProviders` renders providers without a branded button (for example a generic OIDC
provider). `OAuthButtons` accepts `genericProviders`, `lastUsed`, and `dividerPosition`. Without the
new props the screen renders exactly as before. A method or provider id that matches an
`Object.prototype` key (`__proto__`, `constructor`) is named by its id, and the new
`getSocialProviderName(providerId)` returns a branded provider's name or `undefined`.
