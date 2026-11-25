> **formatLogContextSuffix**(`fields`): `string`

Builds the ` key=value ...` suffix appended to console/file log lines after the message.
Request-scoped fields come from AsyncLocalStorage via Winston metadata; `terrenoLabels` and
`terrenoLogPrefix` come from [createScopedLogger](createScopedLogger.md). Nested `terrenoRequestLog`
(`requestId` + `userId` including `null` when anonymous) is attached on the Winston info
object for structured transports only, not repeated in this suffix.

## Parameters

### fields

[`LogContextFields`](../interfaces/LogContextFields.md)

## Returns

`string`
