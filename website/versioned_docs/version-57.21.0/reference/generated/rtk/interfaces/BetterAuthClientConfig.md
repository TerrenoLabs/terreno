Configuration options for the Better Auth client.

## Type Parameters

### Features

`Features` *extends* [`BetterAuthClientFeatures`](BetterAuthClientFeatures.md) = [`BetterAuthClientFeatures`](BetterAuthClientFeatures.md)

## Properties

### baseURL

> **baseURL**: `string`

Base URL of the auth server (e.g., "http://localhost:3000").

***

### bearerStorage?

> `optional` **bearerStorage?**: [`BetterAuthBearerStorage`](BetterAuthBearerStorage.md)

Where `webAuth: "bearer"` keeps the token, under the key `${storagePrefix}_bearer_token`.
Pass `window.sessionStorage` on shared devices so the token ends with the browser session.

#### Default

```ts
window.localStorage
```

***

### features?

> `optional` **features?**: `Features`

Client plugins for the Better Auth features the server enables. Omit it and the client is
exactly what it was before features existed.

#### Example

```typescript
createBetterAuthClient({
  baseURL,
  features: {multiSession: true, passkey: true, twoFactor: {onTwoFactorRedirect}},
  scheme: "myapp",
});
```

***

### scheme

> **scheme**: `string`

App URL scheme for deep linking (e.g., "terreno").

***

### storagePrefix?

> `optional` **storagePrefix?**: `string`

Storage key prefix for auth tokens.

#### Default

```ts
"terreno"
```

***

### webAuth?

> `optional` **webAuth?**: [`BetterAuthWebAuth`](../type-aliases/BetterAuthWebAuth.md)

How the web client authenticates to the auth server. Native ignores it: the Expo plugin
already keeps the session without browser cookies.

- `"cookie"` (default): the browser sends Better Auth's HttpOnly session cookie. Use it
  when the frontend and API share a site.
- `"bearer"`: the client stores the `set-auth-token` header from the server's bearer
  plugin, sends `Authorization: Bearer` on every Better Auth call, and sends no cookies
  (`credentials: "omit"`). Use it when the frontend and API are on different sites, where
  browsers block or partition third-party cookies.

#### Default

```ts
"cookie"
```
