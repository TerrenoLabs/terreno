Defines the top-level schema for request bodies and responses.

This type represents complete object schemas used in OpenAPI operations,
typically for request bodies and response content.

## Example

```typescript
const userSchema: OpenApiSchema = {
  type: "object",
  properties: {
    id: {type: "string"},
    name: {type: "string"},
    email: {type: "string", format: "email"},
  },
  required: ["id", "name"],
};
```

## Indexable

> \[`key`: `string`\]: `unknown`

## Properties

### additionalProperties?

> `optional` **additionalProperties?**: `boolean` \| [`OpenApiSchemaProperty`](OpenApiSchemaProperty.md)

Schema for additional properties or boolean to allow/disallow them

***

### items?

> `optional` **items?**: [`OpenApiSchemaProperty`](OpenApiSchemaProperty.md)

Schema for array items when type is "array"

***

### properties?

> `optional` **properties?**: `Record`\<`string`, [`OpenApiSchemaProperty`](OpenApiSchemaProperty.md)\>

Property definitions for object types

***

### required?

> `optional` **required?**: `string`[]

List of required property names

***

### type

> **type**: `string`

The JSON Schema type (typically "object" or "array")
