Metadata for one MCP tool call. Holds no tool arguments, results, or error text, since those
can carry personal data.

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

### credential?

> `optional` **credential?**: [`RequestCredential`](../type-aliases/RequestCredential.md)

***

### durationMs

> **durationMs**: `number`

***

### errorName?

> `optional` **errorName?**: `string`

Error class name for an `exception` outcome, such as `ForbiddenError`. Never the message.

***

### expiresAt

> **expiresAt**: `Date`

***

### oauthClientId?

> `optional` **oauthClientId?**: `string`

***

### oauthFamilyId?

> `optional` **oauthFamilyId?**: `string`

***

### outcome

> **outcome**: [`McpRequestLogOutcome`](../type-aliases/McpRequestLogOutcome.md)

***

### serviceTokenId?

> `optional` **serviceTokenId?**: `string`

***

### toolName

> **toolName**: `string`

***

### updated

> **updated**: `Date`

***

### userId?

> `optional` **userId?**: `ObjectId`
