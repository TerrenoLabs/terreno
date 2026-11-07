## Extends

- `Document`\<`string`\>

## Properties

### \_id

> **\_id**: `string`

UUID for new rows; ObjectId hex for rows migrated by mcp-service-token-string-ids.

#### Overrides

`mongoose.Document._id`

***

### created

> **created**: `Date`

***

### deleted

> **deleted**: `boolean`

Always false: a delete revokes the token instead of tombstoning it.

***

### expiresAt?

> `optional` **expiresAt?**: `Date`

***

### lastUsedAt?

> `optional` **lastUsedAt?**: `Date`

***

### name

> **name**: `string`

***

### revokedAt?

> `optional` **revokedAt?**: `Date`

***

### tokenEpoch?

> `optional` **tokenEpoch?**: `number`

***

### tokenHash

> **tokenHash**: `string`

***

### tokenPrefix

> **tokenPrefix**: `string`

***

### updated

> **updated**: `Date`

***

### userId

> **userId**: `ObjectId`
