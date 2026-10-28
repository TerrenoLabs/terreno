> **normalizeApiError**(`error`, `context`): [`NormalizedApiError`](../interfaces/NormalizedApiError.md)

Normalizes an unknown thrown value from an external API call into a stable shape:
status code, human-readable messages, and a machine classification. Axios errors are
unwrapped (response body messages extracted); axios errors without a response are
classified as "network"; non-axios errors fall through to "unknown" with the error
message preserved.

Raw payload bodies are not carried on the normalized shape — only recognized message
fields are extracted, and plain-string bodies are truncated. Consumers whose services
put sensitive data inside those message fields should additionally use a redactError
hook.

## Parameters

### error

`unknown`

### context

#### apiName

`string`

#### operation

`string`

## Returns

[`NormalizedApiError`](../interfaces/NormalizedApiError.md)
