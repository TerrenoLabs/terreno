Defines a parameter in an OpenAPI operation.

Parameters can be passed via query string, path segments, or headers.
Path parameters are always required by OpenAPI specification.

## Example

```typescript
// Query parameter
const limitParam: OpenApiParameter = {
  in: "query",
  name: "limit",
  required: false,
  schema: {type: "number"},
  description: "Maximum number of results",
};

// Path parameter
const idParam: OpenApiParameter = {
  in: "path",
  name: "id",
  required: true,
  schema: {type: "string"},
  description: "Resource identifier",
};
```

## Properties

### description?

> `optional` **description?**: `string`

Human-readable description of the parameter

***

### in

> **in**: `"header"` \| `"path"` \| `"query"`

Location of the parameter

***

### name

> **name**: `string`

Name of the parameter

***

### required?

> `optional` **required?**: `boolean`

Whether the parameter is required (path params are always required)

***

### schema

> **schema**: [`OpenApiSchemaProperty`](OpenApiSchemaProperty.md)

Schema defining the parameter's type and format
