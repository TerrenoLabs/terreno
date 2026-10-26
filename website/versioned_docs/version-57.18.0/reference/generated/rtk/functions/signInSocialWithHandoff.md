> **signInSocialWithHandoff**(`__namedParameters`): `void`

Starts a social or generic OAuth sign-in for a web client in bearer mode. It stores a random
nonce in sessionStorage and navigates the whole page to the server's
`GET {basePath}/oauth-handoff/start`, with `handoff=<nonce>` added to `callbackURL` (and to
`errorCallbackURL`). A top-level navigation keeps Better Auth's OAuth state cookie
first-party on the API's origin. After the provider, the page comes back to `callbackURL`
with `#ott=<token>`, and `completeBetterAuthOAuthHandoff` exchanges it for the bearer.

`callbackURL` defaults to `/` on the current origin (pass the full path for an app served
under a sub-path). It is resolved against the current page, and its path must be one of the
server's `oauthHandoff.callbackPaths` (default `["/"]`) on one of its
`oauthHandoff.webOrigins`, or the server answers 400. `errorCallbackURL` defaults to
`callbackURL`; a failed start or callback comes back there with `?error=`. It is always sent,
because without one Better Auth sends callback errors to its own error page on the API.

Throws on native, in cookie mode, for a client `createBetterAuthClient` did not make, and
when sessionStorage cannot hold the nonce. Use `authClient.signIn.social` in those cases.

## Parameters

### \_\_namedParameters

#### callbackURL?

`string` = `"/"`

#### client

`ReactAuthClient`

#### errorCallbackURL?

`string`

#### provider

`string`

## Returns

`void`

## Example

```typescript
<SocialLoginButton
  provider="google"
  onPress={() => signInSocialWithHandoff({client: authClient, provider: "google"})}
/>
```
