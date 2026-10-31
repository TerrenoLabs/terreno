## Extended by

- [`TerrenoLoginScreenProps`](TerrenoLoginScreenProps.md)

## Properties

### callbackURL?

> `optional` **callbackURL?**: `string`

Where a social sign-in returns. In bearer mode it must be one of the server's
`oauthHandoff.callbackPaths`, and should be this login screen's route, so the controller sees
the new session and records the method.

***

### client

> **client**: [`LoginControllerClientInput`](../type-aliases/LoginControllerClientInput.md)

A client from `createBetterAuthClient`, ideally with the features the server enables.

***

### error?

> `optional` **error?**: `string` \| `string`[] \| `null`

The `?error=` this page was opened with after an OAuth return. Never displayed as is.

***

### errorCallbackURL?

> `optional` **errorCallbackURL?**: `string`

Where a failed social sign-in returns with `?error=`. Defaults to `callbackURL`.

***

### getBearerToken?

> `optional` **getBearerToken?**: () => `string` \| `null`

Overrides how the bearer token is read in bearer mode (for custom clients).

#### Returns

`string` \| `null`

***

### initialEmail?

> `optional` **initialEmail?**: `string`

The email the form starts with.

***

### initialTrustDevice?

> `optional` **initialTrustDevice?**: `boolean`

Whether "Trust this device" starts checked on the inline challenge. Defaults to checked for
an authenticator code. Pass `false` to start unchecked.

***

### onForgotPasswordPress?

> `optional` **onForgotPasswordPress?**: () => `void`

Shown as the forgot-password link.

#### Returns

`void`

***

### onSignedIn

> **onSignedIn**: (`event`) => `void` \| `Promise`\<`void`\>

Called once a session exists: after a sign-in here, or at once when a live session is found
on mount. Sync the session into Redux and navigate here.

#### Parameters

##### event

[`LoginSignedInEvent`](LoginSignedInEvent.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### onSignUpPress?

> `optional` **onSignUpPress?**: () => `void`

Shown as the sign-up link while the server's sign-up is open.

#### Returns

`void`

***

### onTwoFactorRequired?

> `optional` **onTwoFactorRequired?**: (`event`) => `void`

Called when a sign-in needs a second factor, to route to the app's own challenge screen.
Leave unset to get `step: "twoFactor"` and the inline challenge (`twoFactor`). Do not also set
`features.twoFactor.onTwoFactorRedirect` on the client, or both run.

#### Parameters

##### event

[`LoginTwoFactorRequiredEvent`](LoginTwoFactorRequiredEvent.md)

#### Returns

`void`

***

### passkeyAutofill?

> `optional` **passkeyAutofill?**: `boolean`

On web, offer saved passkeys in the email field's autofill (conditional mediation) when the
server has passkeys on and the browser supports it.

#### Default

```ts
true
```

***

### providerLabels?

> `optional` **providerLabels?**: `Record`\<`string`, `string`\>

Button labels for providers without a brand, such as `{"mock-oidc": "Mock OIDC"}`.

***

### rememberedAccounts

> **rememberedAccounts**: [`RememberedAccountsStore`](RememberedAccountsStore.md)

The app's store from `createRememberedAccountsStore`.

***

### rememberIdentity?

> `optional` **rememberIdentity?**: `boolean`

Pass `false` to record only the method after a sign-in, whatever the store allows. Otherwise
the user's name, email and avatar go to the store, which keeps them only when it was created
with `rememberIdentity: true`.

***

### skipWhenSignedIn?

> `optional` **skipWhenSignedIn?**: `boolean`

Call `onSignedIn` without showing the screen when a session is already live. Pass `false` on
an "add another account" route, where the signed-in sessions become "Continue" cards.

#### Default

```ts
true
```

***

### webAuth?

> `optional` **webAuth?**: [`BetterAuthWebAuth`](../type-aliases/BetterAuthWebAuth.md)

Overrides the mode `createBetterAuthClient` recorded for `client` (for custom clients).
