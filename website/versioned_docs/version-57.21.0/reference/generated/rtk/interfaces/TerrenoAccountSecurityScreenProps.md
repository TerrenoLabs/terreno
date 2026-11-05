## Extends

- [`UseAccountSecurityOptions`](UseAccountSecurityOptions.md).`Pick`\<`AccountSecurityScreenProps`, `"title"` \| `"description"` \| `"header"` \| `"children"` \| `"withPage"` \| `"maxWidth"` \| `"testID"`\>

## Properties

### callbackURL

> **callbackURL**: `string`

Where linking a provider returns: this security screen's route. In bearer mode it may be any
page on one of the server's `oauthHandoff.webOrigins`.

#### Inherited from

[`UseAccountSecurityOptions`](UseAccountSecurityOptions.md).[`callbackURL`](UseAccountSecurityOptions.md#callbackurl)

***

### children?

> `optional` **children?**: `ReactNode`

Extra content after the cards, such as an app-specific card. Hidden with the cards while
loading or showing `error`.

#### Inherited from

`Pick.children`

***

### client

> **client**: [`AccountSecurityClientInput`](../type-aliases/AccountSecurityClientInput.md)

A client from `createBetterAuthClient`, with the `passkey` and `twoFactor` features on.

#### Inherited from

[`UseAccountSecurityOptions`](UseAccountSecurityOptions.md).[`client`](UseAccountSecurityOptions.md#client)

***

### description?

> `optional` **description?**: `string`

Text under the heading.

#### Inherited from

`Pick.description`

***

### errorCallbackURL?

> `optional` **errorCallbackURL?**: `string`

Where a failed link returns with `?error=`. Defaults to `callbackURL`.

#### Inherited from

[`UseAccountSecurityOptions`](UseAccountSecurityOptions.md).[`errorCallbackURL`](UseAccountSecurityOptions.md#errorcallbackurl)

***

### header?

> `optional` **header?**: `ReactNode`

Content under the heading and description and above the cards, such as the signed-in
user's name and email or a notice. Shown in every state.

#### Inherited from

`Pick.header`

***

### linkError?

> `optional` **linkError?**: `string` \| `string`[] \| `null`

The `?error=` this page was opened with after a link returned. Never displayed as is.

#### Inherited from

[`UseAccountSecurityOptions`](UseAccountSecurityOptions.md).[`linkError`](UseAccountSecurityOptions.md#linkerror)

***

### maxWidth?

> `optional` **maxWidth?**: `number`

The widest the content grows, in pixels. Cards stack in one column at any width.

#### Default

```ts
720
```

#### Inherited from

`Pick.maxWidth`

***

### methods?

> `optional` **methods?**: [`BetterAuthMethods`](BetterAuthMethods.md)

The server's methods, when the app already loaded them with `useAuthMethods`. Otherwise the
hook loads them. They decide which cards show.

#### Inherited from

[`UseAccountSecurityOptions`](UseAccountSecurityOptions.md).[`methods`](UseAccountSecurityOptions.md#methods)

***

### minPasswordLength?

> `optional` **minPasswordLength?**: `number`

Minimum new-password length: the server's `minPasswordLength`. Defaults to Better Auth's 8.

#### Inherited from

[`UseAccountSecurityOptions`](UseAccountSecurityOptions.md).[`minPasswordLength`](UseAccountSecurityOptions.md#minpasswordlength)

***

### passkeySupported?

> `optional` **passkeySupported?**: `boolean`

Whether this device can create passkeys. Defaults to whether WebAuthn is available on web.

#### Inherited from

[`UseAccountSecurityOptions`](UseAccountSecurityOptions.md).[`passkeySupported`](UseAccountSecurityOptions.md#passkeysupported)

***

### providerLabels?

> `optional` **providerLabels?**: `Record`\<`string`, `string`\>

Labels for providers without a brand, such as `{"mock-oidc": "Mock OIDC"}`.

#### Inherited from

[`UseAccountSecurityOptions`](UseAccountSecurityOptions.md).[`providerLabels`](UseAccountSecurityOptions.md#providerlabels)

***

### testID?

> `optional` **testID?**: `string`

Root testID; child testIDs are derived from it.

#### Default

```ts
"account-security-screen"
```

#### Inherited from

`Pick.testID`

***

### title?

> `optional` **title?**: `string`

Page heading.

#### Default

```ts
"Security"
```

#### Inherited from

`Pick.title`

***

### withPage?

> `optional` **withPage?**: `boolean`

Wraps the screen in a scrolling ui `Page`. Pass false when the screen sits inside your own
`Page`, `ScrollView` or tab layout, so scroll views do not nest.

#### Default

```ts
true
```

#### Inherited from

`Pick.withPage`
