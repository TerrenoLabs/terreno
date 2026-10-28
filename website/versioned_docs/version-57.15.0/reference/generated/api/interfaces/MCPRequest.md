Express-shaped request handed to modelRouter lifecycle hooks and response handlers
during an MCP tool call. Built by `createMCPRequest` as a stub: only `user`
and `body` are populated. `headers`, `query`, and `params` are always empty
objects — MCP does not forward HTTP request fields.

## Properties

### body

> **body**: [`MCPToolArgs`](../type-aliases/MCPToolArgs.md)

***

### headers

> **headers**: `Record`\<`string`, `string`\>

Always `{}` on MCP paths — not forwarded from HTTP.

***

### isMCPRequest

> **isMCPRequest**: `true`

Lets hooks detect an MCP tool call rather than an HTTP request.

***

### method

> **method**: `"MCP"`

***

### params

> **params**: `Record`\<`string`, `string`\>

***

### query

> **query**: `Record`\<`string`, `unknown`\>

***

### user?

> `optional` **user?**: [`User`](User.md)
