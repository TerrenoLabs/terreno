> **getAPIErrorBody**(`error`): `Record`\<`string`, `unknown`\>

Creates an APIError body to send to clients as JSON.

## Parameters

### error

[`APIError`](../classes/APIError.md)

## Returns

`Record`\<`string`, `unknown`\>

## Deprecated

Use `error.toJSON()` instead.
