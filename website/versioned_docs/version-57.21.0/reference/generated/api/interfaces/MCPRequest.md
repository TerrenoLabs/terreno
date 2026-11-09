Express-shaped request handed to modelRouter lifecycle hooks, response handlers, and
action handlers during an MCP tool call. Built by `createMCPRequest` as a stub: `user` and
`body` are populated, and action tools also fill `params.id` (instance actions) and `query`
(GET actions). `headers` is always empty — MCP does not forward HTTP request fields.

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
