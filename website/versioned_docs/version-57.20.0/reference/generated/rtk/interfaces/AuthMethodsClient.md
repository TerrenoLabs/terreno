The part of a Better Auth client `useAuthMethods` calls. The client from
`createBetterAuthClient` satisfies it, so the request carries the client's bearer token or
cookies and resolves against its base URL and base path.

## Extended by

- [`AccountSecurityClient`](AccountSecurityClient.md)
- [`LoginControllerClient`](LoginControllerClient.md)

## Properties

### $fetch

> **$fetch**: (`path`, `options?`) => `Promise`\<\{ `data`: `unknown`; `error`: `unknown`; \}\>

#### Parameters

##### path

`string`

##### options?

###### method?

`"GET"`

#### Returns

`Promise`\<\{ `data`: `unknown`; `error`: `unknown`; \}\>
