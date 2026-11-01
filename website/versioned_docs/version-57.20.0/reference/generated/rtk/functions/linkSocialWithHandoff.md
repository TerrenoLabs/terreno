> **linkSocialWithHandoff**(`__namedParameters`): `Promise`\<[`LinkSocialWithHandoffResult`](../interfaces/LinkSocialWithHandoffResult.md)\>

Links a social or generic OAuth provider to the signed-in user.

On web in bearer mode (`createBetterAuthClient({webAuth: "bearer"})`), a `POST /link-social`
fetch from another site cannot set Better Auth's OAuth state cookie on the API's origin. So
this posts `{provider, callbackURL, errorCallbackURL}` to the server's
`POST {basePath}/oauth-handoff/link-intent` with the bearer, then submits the single-use token
it returns in a hidden form (method POST) to `startURL`, which redirects the page to the
provider. The provider sends the page back to `callbackURL`, with no token: linking creates no
session. A failure after the form comes back to `errorCallbackURL` with `?error=`.

Both URLs are resolved against the current page and may be any page on one of the server's
`oauthHandoff.webOrigins` that its `trustedOrigins` allows. `oauthHandoff.callbackPaths` do not
apply, since no token travels on a link's return. `errorCallbackURL` defaults to
`callbackURL`. The page must not be served with `Referrer-Policy: no-referrer` or
`same-origin`: the form's `Origin` header is then `null`, and the server refuses the start.

In cookie mode and on native it calls `client.linkSocial` as before.

Resolves `{error: null}` once the browser is on its way (or `linkSocial` succeeded), and
`{error}` when the server refused, such as 403 `LINKING_DISABLED` when linking is off. It never
submits the form after a refusal.

## Parameters

### \_\_namedParameters

#### callbackURL

`string`

#### client

[`BetterAuthLinkClient`](../type-aliases/BetterAuthLinkClient.md)

#### errorCallbackURL?

`string`

#### provider

`string`

## Returns

`Promise`\<[`LinkSocialWithHandoffResult`](../interfaces/LinkSocialWithHandoffResult.md)\>

## Example

```typescript
const {error} = await linkSocialWithHandoff({
  callbackURL: "/settings/security",
  client: authClient,
  errorCallbackURL: "/settings/security",
  provider: "google",
});
```
