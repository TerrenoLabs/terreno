A refused built-in consent attempt (for lockout) or a used TOTP step (for replay).

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

### expiresAt

> **expiresAt**: `Date`

***

### key

> **key**: `string`

***

### kind

> **kind**: [`McpOAuthConsentAttemptKind`](../type-aliases/McpOAuthConsentAttemptKind.md)

***

### step?

> `optional` **step?**: `number`

***

### updated

> **updated**: `Date`
