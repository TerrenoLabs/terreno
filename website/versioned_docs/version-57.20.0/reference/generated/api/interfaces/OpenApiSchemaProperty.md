Defines a property within an OpenAPI schema.

This type represents the structure of individual properties in request bodies,
response objects, and nested schemas. It supports primitive types, arrays,
nested objects, and additional properties for map-like structures.

## Example

```typescript
// Simple string property
const nameProperty: OpenApiSchemaProperty = {
  type: "string",
  description: "User's full name",
};

// Array of objects
const itemsProperty: OpenApiSchemaProperty = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: {type: "string"},
      value: {type: "number"},
    },
  },
};

// Object with additional properties (map/dictionary)
const metadataProperty: OpenApiSchemaProperty = {
  type: "object",
  additionalProperties: {type: "string"},
};
```

## Properties

### additionalProperties?

> `optional` **additionalProperties?**: `boolean` \| `OpenApiSchemaProperty`

Schema for additional properties or boolean to allow/disallow them

***

### description?

> `optional` **description?**: `string`

Human-readable description of the property

***

### enum?

> `optional` **enum?**: `string`[]

Allowed values for string/number enums in query validation.

***

### escapedRegexLiteral?

> `optional` **escapedRegexLiteral?**: `boolean`

When true, string values must be escaped regex literals (query `$regex` operator).

***

### format?

> `optional` **format?**: `string`

Format hint for the type (e.g., "date-time", "email", "uri", "uuid")

***

### items?

> `optional` **items?**: `OpenApiSchemaProperty`

Schema for array items when type is "array"

***

### minItems?

> `optional` **minItems?**: `number`

Minimum array length when type is "array".

***

### oneOf?

> `optional` **oneOf?**: `OpenApiSchemaProperty`[]

JSON Schema oneOf for query operators (scalar or Mongo-style object).

***

### properties?

> `optional` **properties?**: `Record`\<`string`, `OpenApiSchemaProperty`\>

Nested properties when type is "object"

***

### required?

> `optional` **required?**: `boolean` \| `string`[]

Property-level required flag, or object-schema required key list for nested
operator shapes (`{$in: ...}`, `{$regex: ...}`).

***

### type?

> `optional` **type?**: `string`

The JSON Schema type (e.g., "string", "number", "boolean", "object", "array")
