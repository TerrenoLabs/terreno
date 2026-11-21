> **createValidator**(`options`): (`req`, `res`, `next`) => `void`

Creates a combined validation middleware for both body and query parameters.

## Parameters

### options

[`CreateValidatorOptions`](../interfaces/CreateValidatorOptions.md)

Configuration for what to validate

## Returns

Express middleware function

(`req`, `res`, `next`) => `void`

## Example

```typescript
router.post("/search", [
  openApiMiddleware,
  createValidator({
    body: {query: {type: "string", required: true}},
    query: {limit: {type: "number"}},
  }),
], handler);
```
