> **createSessionApi**\<`ReducerPath`\>(`__namedParameters?`): `Api`\<`BaseQueryFn`\<`string` \| `FetchArgs`, `unknown`, `FetchBaseQueryError`, \{ \}, `FetchBaseQueryMeta`\>, \{ \}, `ReducerPath`, `never`, *typeof* `coreModuleName` \| *typeof* `reactHooksModuleName`\>

Creates an empty RTK Query API that authenticates with same-origin session cookies
instead of JWT bearer tokens. Response shaping matches emptyApi: list responses
(with `more`) are returned whole, and `{data}` envelopes are unwrapped.

## Type Parameters

### ReducerPath

`ReducerPath` *extends* `string` = `"terreno-session"`

## Parameters

### \_\_namedParameters?

`CreateSessionApiOptions`\<`ReducerPath`\> = `{}`

## Returns

`Api`\<`BaseQueryFn`\<`string` \| `FetchArgs`, `unknown`, `FetchBaseQueryError`, \{ \}, `FetchBaseQueryMeta`\>, \{ \}, `ReducerPath`, `never`, *typeof* `coreModuleName` \| *typeof* `reactHooksModuleName`\>
