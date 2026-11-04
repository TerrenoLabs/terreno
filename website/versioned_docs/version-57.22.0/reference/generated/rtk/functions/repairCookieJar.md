> **repairCookieJar**(`stored`): `string` \| `null`

Drops cookie-jar entries that `@better-auth/expo` cannot read.

The plugin keeps its jar as `{[name]: {value, expires}}` and reads it with
`Object.entries(jar).reduce((acc, [name, cookie]) => cookie.expires ? ... )`. That property
access throws on any entry whose value is not an object, and it runs inside the plugin's
`init()` hook, ahead of *every* native request. One malformed entry therefore makes all
requests throw before a socket is opened - sign-in included, so the app can never write a
good jar over the bad one and stays permanently unable to reach the API. Discarding the
unreadable entries degrades to "signed out", which signing in again recovers from.

## Parameters

### stored

`string` \| `null`

## Returns

`string` \| `null`
