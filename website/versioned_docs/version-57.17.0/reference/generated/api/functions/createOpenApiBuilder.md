> **createOpenApiBuilder**(`options`): [`OpenApiMiddlewareBuilder`](../classes/OpenApiMiddlewareBuilder.md)

Creates a new OpenAPI middleware builder.

This is the recommended entry point for creating custom OpenAPI middleware.
It returns a fluent builder that allows you to chain configuration methods.

## Parameters

### options

`Partial`\<[`ModelRouterOptions`](../interfaces/ModelRouterOptions.md)\<`unknown`\>\>

Router options containing the OpenAPI configuration

## Returns

[`OpenApiMiddlewareBuilder`](../classes/OpenApiMiddlewareBuilder.md)

A new OpenApiMiddlewareBuilder instance

## Example

```typescript
import {createOpenApiBuilder} from "./openApiBuilder";

const statsMiddleware = createOpenApiBuilder(options)
  .withTags(["analytics"])
  .withSummary("Get usage statistics")
  .withQueryParameter("startDate", {type: "string", format: "date"})
  .withQueryParameter("endDate", {type: "string", format: "date"})
  .withResponse<{totalUsers: number; activeUsers: number}>(200, {
    totalUsers: {type: "number", description: "Total registered users"},
    activeUsers: {type: "number", description: "Users active in period"},
  })
  .build();

router.get("/analytics/stats", statsMiddleware, getStatsHandler);
```
