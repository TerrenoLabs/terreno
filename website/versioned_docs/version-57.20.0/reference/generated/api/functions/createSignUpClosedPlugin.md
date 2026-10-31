> **createSignUpClosedPlugin**(): `BetterAuthPlugin`

The plugin `createBetterAuth` adds after `config.plugins` when `signUp.mode` is `closed`.
Its init runs after every other plugin's, so it reaches the social providers Better Auth
built from `socialProviders` and the ones `genericOAuth` registered, and marks each one so a
sign-in for an unknown email fails with `signup_disabled`. It sets the top-level
`disableSignUp` (read by the ID-token sign-in path), `options.disableSignUp` (read by the
OAuth callback and the OAuth proxy), and `disableImplicitSignUp`; a client's
`requestSignUp: true` cannot undo `disableSignUp`.

## Returns

`BetterAuthPlugin`
