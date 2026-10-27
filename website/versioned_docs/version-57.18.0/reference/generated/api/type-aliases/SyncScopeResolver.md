> **SyncScopeResolver** = (`doc`) => `string`

Custom scope resolver: given a document, return its scope value (e.g. a workspace id).
The stream key becomes `{collection}|custom:{value}`.

## Parameters

### doc

`Record`\<`string`, `unknown`\>

## Returns

`string`
