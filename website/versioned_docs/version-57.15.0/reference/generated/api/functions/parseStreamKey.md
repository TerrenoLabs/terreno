> **parseStreamKey**(`stream`): \{ `collectionTag`: `string`; `scopeKind`: `string`; `scopeValue`: `string` \| `null`; \} \| `null`

Parse a stream key into its collection tag and scope value. The value is everything
after the first `:` following the `|`-delimited collection tag, so custom values
containing `:` survive intact. Broadcast streams (`{tag}|all`) yield `scopeValue: null`.
Returns null when the key is not a valid stream key.

## Parameters

### stream

`string`

## Returns

\{ `collectionTag`: `string`; `scopeKind`: `string`; `scopeValue`: `string` \| `null`; \} \| `null`
