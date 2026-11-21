> **toPublicMcpServiceToken**(`doc`): `Record`\<`string`, `unknown`\>

Public shape of a stored MCP service token: every field except `tokenHash`, plus `id`.
Used for REST responses, sync snapshots, and sync deltas so the hash never leaves the server.

## Parameters

### doc

`Record`\<`string`, `unknown`\>

## Returns

`Record`\<`string`, `unknown`\>
