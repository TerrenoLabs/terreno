> **extractBearerToken**(`header`): `string` \| `undefined`

The credential from an `Authorization: Bearer <token>` header, or undefined. Parsed with string
operations rather than a regex so a long run of whitespace cannot cause polynomial backtracking.

## Parameters

### header

`string` \| `undefined`

## Returns

`string` \| `undefined`
