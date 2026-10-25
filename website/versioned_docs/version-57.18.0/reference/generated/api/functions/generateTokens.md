> **generateTokens**(`user`, `authOptions?`, `options?`): `Promise`\<\{ `refreshToken`: `null`; `sessionId?`: `undefined`; `token`: `null`; \} \| \{ `refreshToken`: `string` \| `undefined`; `sessionId`: `string`; `token`: `string`; \}\>

Generates both an access token (JWT) and a refresh token for a given user.

This function:
- Signs the user's `_id` into a short-lived JWT (`token`)
  and a long-lived refresh token (`refreshToken`).
- Supports custom expiration logic
  and payload customization via `AuthOptions`.
- Reads token secrets, issuer,
  and default expirations from environment variables.
- Returns `{ token, refreshToken }`,
  or `{ token: null, refreshToken: null }` if the user is missing.

It is exported to allow external implementations (such as OAuth integrations or other
authentication providers) to reuse and customize the same token generation logic.
This ensures consistent and secure token issuance across different authentication flows.

## Parameters

### user

`unknown`

### authOptions?

[`AuthOptions`](../interfaces/AuthOptions.md)

### options?

[`GenerateTokensOptions`](../interfaces/GenerateTokensOptions.md) = `{}`

## Returns

`Promise`\<\{ `refreshToken`: `null`; `sessionId?`: `undefined`; `token`: `null`; \} \| \{ `refreshToken`: `string` \| `undefined`; `sessionId`: `string`; `token`: `string`; \}\>
