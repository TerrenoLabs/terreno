> **errorDetail**(`error`): `string`

Extract the fullest human-readable text from an unknown error, for use as the `detail` of a
wrapper error. An `APIError`'s `message` is exactly its `title`, so `errorMessage` alone would
drop the per-occurrence text the caller put in `detail`.

## Parameters

### error

`unknown`

## Returns

`string`
