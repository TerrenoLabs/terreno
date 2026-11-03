> **maskEmail**(`email`): `string` \| `undefined`

Masks an email for display on a shared device: the first character of the local part and of
the domain stay, the rest is hidden, and only the top-level domain is shown in full. Any
subdomains fold into the hidden part, and a one-letter local part looks like a long one.
`josh@mail.flourish.health` becomes `j***@m***.health`. Idempotent. Returns undefined for
anything that is not an email.

## Parameters

### email

`string`

## Returns

`string` \| `undefined`
