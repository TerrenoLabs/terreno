Defines a response in an OpenAPI operation.

Responses include a description and optionally content with a schema
for the response body.

## Example

```typescript
const successResponse: OpenApiResponse = {
  description: "Successfully retrieved user",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          id: {type: "string"},
          name: {type: "string"},
        },
      },
    },
  },
};
```

## Properties

### content?

> `optional` **content?**: `object`

Content definitions keyed by media type

#### Index Signature

\[`mediaType`: `string`\]: `object`

***

### description

> **description**: `string`

Human-readable description of the response
