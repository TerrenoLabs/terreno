One permission an MCP OAuth client can be granted. The consent screen shows its `label` and
`description`; the server enforces its `access` level on every tool the token calls.

## Properties

### access

> **access**: [`McpOAuthGrantAccess`](../type-aliases/McpOAuthGrantAccess.md)

`read` allows read-only tools; `write` allows every tool, since write implies read.

***

### description?

> `optional` **description?**: `string`

Longer explanation shown under the label.

***

### label

> **label**: `string`

Short name the consent screen shows next to the grant's checkbox.

***

### scope

> **scope**: `string`

OAuth scope value. No spaces, since scopes are space-delimited on the wire.
