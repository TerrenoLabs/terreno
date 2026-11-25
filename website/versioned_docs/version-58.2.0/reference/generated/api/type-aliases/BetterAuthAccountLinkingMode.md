> **BetterAuthAccountLinkingMode** = `"verified-email"` \| `"explicit"` \| `"never"`

How a sign-in with a new method relates to an existing account with the same email.
- `verified-email`: Better Auth links it when the provider reports a verified email (the
  Better Auth default).
- `explicit`: no implicit linking at sign-in; a signed-in user links the method themselves.
- `never`: account linking is off.
