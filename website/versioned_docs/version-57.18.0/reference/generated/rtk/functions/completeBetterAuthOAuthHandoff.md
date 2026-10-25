> **completeBetterAuthOAuthHandoff**(`__namedParameters`): `Promise`\<`boolean`\>

Finishes a sign-in that `signInSocialWithHandoff` started, on the page the provider sent the
browser back to. Await it once at startup, before anything reads the session, before any code
acts on other query parameters, and before Sentry or analytics start.

When the URL has `#ott=<token>` and `?handoff=` equal to the nonce this tab stored, it removes
`ott`, `handoff` and the stored nonce (`history.replaceState`), then exchanges the token at
`POST {basePath}/one-time-token/verify`. Bearer mode stores the `set-auth-token` that comes
back. Other query and fragment parts are kept. A token without a matching nonce, or an `ott`
in the query (the server only uses the fragment), is removed from the URL and never sent. Native, cookie mode, and a page without `ott` make no request.

Resolves `true` only when a bearer token was stored, and never rejects. A return with
`?error=` (such as `provider_not_found` or `sign_in_failed`) resolves `false` and leaves the
error in the URL for the app to show. Calls made while one is running share its result.

## Parameters

### \_\_namedParameters

#### client

`ReactAuthClient`

## Returns

`Promise`\<`boolean`\>

## Example

```typescript
await completeBetterAuthOAuthHandoff({client: authClient});
await betterAuth.syncSession(store.dispatch);
```
