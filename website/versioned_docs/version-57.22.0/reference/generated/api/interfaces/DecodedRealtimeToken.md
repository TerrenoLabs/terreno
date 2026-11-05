## Properties

### admin?

> `optional` **admin?**: `boolean`

***

### authKind?

> `optional` **authKind?**: `"jwt"` \| `"better-auth"`

Which validator in the chain authenticated this socket (D1: the periodic
re-validation sweep uses this to pick the matching cheap re-check — local JWT
expiry verification vs. a Better Auth session lookup). Undefined for handshakes
that predate this field (never actually observable at runtime — set by every
validator — but kept optional so structural test doubles compile without it).

***

### exp?

> `optional` **exp?**: `number`

JWT `exp` claim (seconds since epoch) — present for the legacy JWT validator only.

***

### id?

> `optional` **id?**: `string`

***

### isAnonymous?

> `optional` **isAnonymous?**: `boolean`

***

### iss?

> `optional` **iss?**: `string`

JWT `iss` claim — present for the legacy JWT validator only.
