Admin switch and registry entry for one MCP tool. A tool with no row is enabled.

## Extends

- `Document`

## Properties

### \_id

> **\_id**: `ObjectId`

This documents _id.

#### Overrides

`mongoose.Document._id`

***

### created

> **created**: `Date`

***

### description?

> `optional` **description?**: `string`

***

### enabled

> **enabled**: `boolean`

***

### lastRegisteredAt?

> `optional` **lastRegisteredAt?**: `Date`

***

### name

> **name**: `string`

***

### registered

> **registered**: `boolean`

False when the running server no longer registers this tool.

***

### source

> **source**: [`McpToolSource`](../type-aliases/McpToolSource.md)

***

### updated

> **updated**: `Date`
