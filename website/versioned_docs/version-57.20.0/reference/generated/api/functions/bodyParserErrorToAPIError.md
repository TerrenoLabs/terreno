> **bodyParserErrorToAPIError**(`err`): [`APIError`](../classes/APIError.md) \| `null`

Converts a body-parser client error (malformed JSON, oversized body, unsupported charset) into
an APIError with the parser's 4xx status. Returns null for anything else, including parser
errors body-parser marks as not exposable (server faults).

## Parameters

### err

`Error`

## Returns

[`APIError`](../classes/APIError.md) \| `null`
