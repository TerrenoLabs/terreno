## Properties

### description?

> `optional` **description?**: `string`

Override auto-generated model description

***

### excludeFields?

> `optional` **excludeFields?**: `string`[]

Fields to hide from MCP tool schemas, responses, and create/update persist bodies.

A bare field name (`"hash"`) is removed at every depth of the response, including
inside arrays and populated refs, so a redacted name cannot leak through a nested
document. Use dot notation (`"metadata.secretKey"`) to remove one specific location.

***

### maxLimit?

> `optional` **maxLimit?**: `number`

Max items returned by list tool (default: 50)

***

### mcpResponseHandler?

> `optional` **mcpResponseHandler?**: (`value`, `method`, `user?`) => `Promise`\<[`JSONValue`](../type-aliases/JSONValue.md)\>

MCP-specific serialization (separate from REST responseHandler)

#### Parameters

##### value

`unknown`

##### method

[`MCPMethod`](../type-aliases/MCPMethod.md)

##### user?

[`User`](User.md)

#### Returns

`Promise`\<[`JSONValue`](../type-aliases/JSONValue.md)\>

***

### methods?

> `optional` **methods?**: [`MCPMethod`](../type-aliases/MCPMethod.md)[]

Which CRUD methods to expose as MCP tools. Default: ['list', 'read']

***

### toolPrefix?

> `optional` **toolPrefix?**: `string`

Override the tool name prefix. Tools are named `{prefix}_{method}`, e.g. `todos_list`.

Defaults to the lowercase model name run through a simple English pluralizer, which
gets common cases right (`Todo` -> `todos`, `Category` -> `categories`, `Status` ->
`statuses`) but not irregular nouns. Set this explicitly whenever the default reads
wrong, or to namespace tools that would otherwise collide.

#### Example

```typescript
mcp: {toolPrefix: "people"} // person_list -> people_list
```
