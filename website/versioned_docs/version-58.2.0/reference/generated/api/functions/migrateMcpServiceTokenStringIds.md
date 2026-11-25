> **migrateMcpServiceTokenStringIds**(`ctx`): `Promise`\<[`McpServiceTokenStringIdsResult`](../interfaces/McpServiceTokenStringIdsResult.md)\>

Re-key every ObjectId McpServiceToken row to its hex string. Returns how many rows were
converted; a dry run converts nothing and reports how many are pending.

## Parameters

### ctx

[`MigrationContext`](../interfaces/MigrationContext.md)

## Returns

`Promise`\<[`McpServiceTokenStringIdsResult`](../interfaces/McpServiceTokenStringIdsResult.md)\>
