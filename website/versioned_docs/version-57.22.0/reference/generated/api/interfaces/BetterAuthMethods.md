The body of `GET {basePath}/terreno/methods`.

## Properties

### accountLinking

> **accountLinking**: `object`

Linking behavior for same-email sign-ins with another method.

#### mode

> **mode**: [`BetterAuthAccountLinkingMode`](../type-aliases/BetterAuthAccountLinkingMode.md)

***

### emailPassword

> **emailPassword**: `boolean`

Email and password sign-in is enabled.

***

### multiSession

> **multiSession**: `boolean`

Several signed-in accounts per device (Better Auth's `multiSession` plugin is on).

***

### passkey

> **passkey**: `boolean`

Passkey sign-in (the `passkey` plugin is on).

***

### providers

> **providers**: `string`[]

Ids of every OAuth provider that can start a sign-in, sorted: social providers (`google`,
`github`, `apple`) and generic OAuth providers (such as `mock-oidc`). A generic provider
whose discovery failed at startup is left out.

***

### signUp

> **signUp**: `boolean`

New users can sign up with email and password (`false` under `signUp: {mode: "closed"}`).

***

### twoFactor

> **twoFactor**: `boolean`

Two-factor authentication (Better Auth's `twoFactor` plugin is on).
