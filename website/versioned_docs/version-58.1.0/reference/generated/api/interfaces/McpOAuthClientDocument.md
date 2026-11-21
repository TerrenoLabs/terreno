A public authorization-code client, or a confidential `client_credentials` client bound to a
user. Public clients leave `tokenEndpointAuthMethod` unset.

## Extends

- `Document`

## Properties

### \_id

> **\_id**: `ObjectId`

This documents _id.

#### Overrides

`mongoose.Document._id`

***

### clientId

> **clientId**: `string`

***

### clientName?

> `optional` **clientName?**: `string`

***

### clientSecretHash?

> `optional` **clientSecretHash?**: `string`

SHA-256 hash of the client secret. Set only for confidential clients.

***

### created

> **created**: `Date`

***

### grantTypes

> **grantTypes**: `string`[]

***

### redirectUris

> **redirectUris**: `string`[]

***

### responseTypes

> **responseTypes**: `string`[]

***

### revokedAt?

> `optional` **revokedAt?**: `Date`

***

### scope?

> `optional` **scope?**: `string`

***

### tokenEndpointAuthMethod?

> `optional` **tokenEndpointAuthMethod?**: [`McpOAuthTokenEndpointAuthMethod`](../type-aliases/McpOAuthTokenEndpointAuthMethod.md)

***

### updated

> **updated**: `Date`

***

### userId?

> `optional` **userId?**: `ObjectId`

User a `client_credentials` token acts as.
