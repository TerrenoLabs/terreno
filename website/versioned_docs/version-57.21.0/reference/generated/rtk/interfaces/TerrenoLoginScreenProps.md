## Extends

- [`UseLoginControllerOptions`](UseLoginControllerOptions.md)

## Properties

### callbackURL?

> `optional` **callbackURL?**: `string`

Where a social sign-in returns. In bearer mode it must be one of the server's
`oauthHandoff.callbackPaths`, and should be this login screen's route, so the controller sees
the new session and records the method.

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`callbackURL`](UseLoginControllerOptions.md#callbackurl)

***

### client

> **client**: [`LoginControllerClientInput`](../type-aliases/LoginControllerClientInput.md)

A client from `createBetterAuthClient`, ideally with the features the server enables.

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`client`](UseLoginControllerOptions.md#client)

***

### error?

> `optional` **error?**: `string` \| `string`[] \| `null`

The `?error=` this page was opened with after an OAuth return. Never displayed as is.

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`error`](UseLoginControllerOptions.md#error)

***

### errorCallbackURL?

> `optional` **errorCallbackURL?**: `string`

Where a failed social sign-in returns with `?error=`. Defaults to `callbackURL`.

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`errorCallbackURL`](UseLoginControllerOptions.md#errorcallbackurl)

***

### fields?

> `optional` **fields?**: `LoginFieldConfig`[]

Form fields; their values reach `signIn.email` as `email` and `password`. Left out when the
server has email and password sign-in off.

***

### forgotPasswordText?

> `optional` **forgotPasswordText?**: `string`

***

### getBearerToken?

> `optional` **getBearerToken?**: () => `string` \| `null`

Overrides how the bearer token is read in bearer mode (for custom clients).

#### Returns

`string` \| `null`

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`getBearerToken`](UseLoginControllerOptions.md#getbearertoken)

***

### initialEmail?

> `optional` **initialEmail?**: `string`

The email the form starts with.

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`initialEmail`](UseLoginControllerOptions.md#initialemail)

***

### initialTrustDevice?

> `optional` **initialTrustDevice?**: `boolean`

Whether "Trust this device" starts checked on the inline challenge. Defaults to checked for
an authenticator code. Pass `false` to start unchecked.

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`initialTrustDevice`](UseLoginControllerOptions.md#initialtrustdevice)

***

### lastUsedLabel?

> `optional` **lastUsedLabel?**: `string`

***

### logo?

> `optional` **logo?**: `ReactNode`

Logo shown above the login form and the two-factor challenge.

***

### onForgotPasswordPress?

> `optional` **onForgotPasswordPress?**: () => `void`

Shown as the forgot-password link.

#### Returns

`void`

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`onForgotPasswordPress`](UseLoginControllerOptions.md#onforgotpasswordpress)

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

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`onSignedIn`](UseLoginControllerOptions.md#onsignedin)

***

### onSignUpPress?

> `optional` **onSignUpPress?**: () => `void`

Shown as the sign-up link while the server's sign-up is open.

#### Returns

`void`

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`onSignUpPress`](UseLoginControllerOptions.md#onsignuppress)

***

### onStepChange?

> `optional` **onStepChange?**: (`step`) => `void`

Called with each step the screen moves to (`checking`, `login`, `twoFactor`, `signedIn`).
An app that already holds a session can use `login` to leave the route, for example when
the live-session check failed.

#### Parameters

##### step

[`LoginControllerStep`](../type-aliases/LoginControllerStep.md)

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

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`onTwoFactorRequired`](UseLoginControllerOptions.md#ontwofactorrequired)

***

### passkeyAutofill?

> `optional` **passkeyAutofill?**: `boolean`

On web, offer saved passkeys in the email field's autofill (conditional mediation) when the
server has passkeys on and the browser supports it.

#### Default

```ts
true
```

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`passkeyAutofill`](UseLoginControllerOptions.md#passkeyautofill)

***

### passkeyButtonText?

> `optional` **passkeyButtonText?**: `string`

***

### providerLabels?

> `optional` **providerLabels?**: `Record`\<`string`, `string`\>

Button labels for providers without a brand, such as `{"mock-oidc": "Mock OIDC"}`.

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`providerLabels`](UseLoginControllerOptions.md#providerlabels)

***

### rememberedAccounts

> **rememberedAccounts**: [`RememberedAccountsStore`](RememberedAccountsStore.md)

The app's store from `createRememberedAccountsStore`.

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`rememberedAccounts`](UseLoginControllerOptions.md#rememberedaccounts)

***

### rememberIdentity?

> `optional` **rememberIdentity?**: `boolean`

Pass `false` to record only the method after a sign-in, whatever the store allows. Otherwise
the user's name, email and avatar go to the store, which keeps them only when it was created
with `rememberIdentity: true`.

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`rememberIdentity`](UseLoginControllerOptions.md#rememberidentity)

***

### signUpLinkText?

> `optional` **signUpLinkText?**: `string`

***

### skipWhenSignedIn?

> `optional` **skipWhenSignedIn?**: `boolean`

Call `onSignedIn` without showing the screen when a session is already live. Pass `false` on
an "add another account" route, where the signed-in sessions become "Continue" cards.

#### Default

```ts
true
```

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`skipWhenSignedIn`](UseLoginControllerOptions.md#skipwhensignedin)

***

### testID?

> `optional` **testID?**: `string`

Root testID of the login screen. The checking spinner is `${testID}-checking`; the inline
challenge keeps `TwoFactorChallengeScreen`'s own `two-factor-challenge`.

#### Default

```ts
"login-screen"
```

***

### title?

> `optional` **title?**: `string`

Heading of the login form.

***

### trustDeviceDays?

> `optional` **trustDeviceDays?**: `number`

Shows "Don't ask again on this device for N days" on the inline two-factor challenge. Match
the server's `twoFactor.trustDeviceDays`; leave unset to hide it.

***

### webAuth?

> `optional` **webAuth?**: [`BetterAuthWebAuth`](../type-aliases/BetterAuthWebAuth.md)

Overrides the mode `createBetterAuthClient` recorded for `client` (for custom clients).

#### Inherited from

[`UseLoginControllerOptions`](UseLoginControllerOptions.md).[`webAuth`](UseLoginControllerOptions.md#webauth)
