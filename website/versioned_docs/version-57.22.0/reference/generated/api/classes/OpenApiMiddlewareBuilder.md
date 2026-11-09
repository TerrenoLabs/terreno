A fluent builder for constructing OpenAPI middleware.

This class provides a chainable API for defining OpenAPI documentation
for Express routes. It supports defining tags, summaries, descriptions,
request bodies, responses, and parameters.

The builder pattern allows for flexible, readable configuration that
produces middleware compatible with the express-openapi-validator library.

## Example

```typescript
const middleware = new OpenApiMiddlewareBuilder(options)
  .withTags(["users"])
  .withSummary("Create a new user")
  .withRequestBody<{name: string; email: string}>({
    name: {type: "string", required: true},
    email: {type: "string", format: "email", required: true},
  })
  .withResponse<{id: string; name: string}>(201, {
    id: {type: "string"},
    name: {type: "string"},
  })
  .build();
```

## Constructors

### Constructor

> **new OpenApiMiddlewareBuilder**(`options`): `OpenApiMiddlewareBuilder`

Creates a new OpenApiMiddlewareBuilder instance.

#### Parameters

##### options

`Partial`\<[`ModelRouterOptions`](../interfaces/ModelRouterOptions.md)\<`unknown`\>\>

Router options containing the OpenAPI path configuration

#### Returns

`OpenApiMiddlewareBuilder`

## Methods

### build()

> **build**(): `RequestHandler`

Builds and returns the OpenAPI middleware.

This method finalizes the configuration and returns Express middleware
that integrates with the OpenAPI documentation system. If no OpenAPI
path is configured in options, returns a no-op middleware.

If validation was enabled via `withValidation()`, body and query
validators are composed into the same RequestHandler (they still run
in order: OpenAPI docs, then body, then query).

Default error responses (400, 401, 403, 404, 405) are automatically
merged with the configured responses.

#### Returns

`RequestHandler`

Express middleware for OpenAPI documentation and optional validation

#### Example

```typescript
const middleware = builder
  .withTags(["users"])
  .withResponse(200, {id: {type: "string"}})
  .build();

router.get("/users/:id", middleware, getUserHandler);
```

***

### buildWithSchemas()

> **buildWithSchemas**(): [`OpenApiBuildResult`](../interfaces/OpenApiBuildResult.md)

Builds and returns the OpenAPI middleware along with schemas.

This method is useful when you want to use asyncHandler's integrated
validation instead of separate validation middleware.

#### Returns

[`OpenApiBuildResult`](../interfaces/OpenApiBuildResult.md)

Object containing middleware and schemas

#### Example

```typescript
const {middleware, bodySchema} = createOpenApiBuilder(options)
  .withRequestBody<{name: string}>({name: {type: "string", required: true}})
  .buildWithSchemas();

router.post("/users", middleware, asyncHandler(async (req, res) => {
  // handler code
}, {bodySchema, validate: true}));
```

***

### withArrayResponse()

> **withArrayResponse**\<`T`\>(`statusCode`, `itemSchema`, `options?`): `this`

Adds an array response definition to the OpenAPI operation.

Use this method when the response is an array of objects rather
than a single object.

#### Type Parameters

##### T

`T` *extends* `Record`\<`string`, `unknown`\>

Type representing the structure of each array item

#### Parameters

##### statusCode

`number`

HTTP status code for this response

##### itemSchema

\{ \[K in string \| number \| symbol\]: OpenApiSchemaProperty \}

Schema for each item in the response array

##### options?

Optional configuration for the response

###### description?

`string`

Description of the response (default: "Success")

###### mediaType?

`string`

Media type for the response (default: "application/json")

#### Returns

`this`

The builder instance for chaining

#### Example

```typescript
builder.withArrayResponse<{id: string; name: string}>(200, {
  id: {type: "string"},
  name: {type: "string"},
}, {description: "List of users"});
```

***

### withDescription()

> **withDescription**(`description`): `this`

Sets the description for the OpenAPI operation.

The description provides detailed information about the operation,
including usage notes, examples, and caveats.

#### Parameters

##### description

`string`

Detailed description of the operation

#### Returns

`this`

The builder instance for chaining

#### Example

```typescript
builder.withDescription("Retrieves a user by their unique identifier. Returns 404 if not found.");
```

***

### withOperationId()

> **withOperationId**(`operationId`): `this`

Sets an explicit `operationId` for the OpenAPI operation.

The `operationId` is a unique string used to identify an operation. Client and SDK
generators (e.g. RTK Query codegen) derive generated function and hook names from it,
so setting it keeps generated names stable and readable for routes whose URL path would
otherwise produce unwieldy names (e.g. deeply nested routes). It must be unique across
the whole OpenAPI document.

#### Parameters

##### operationId

`string`

Unique operation identifier (e.g. "getUserStats")

#### Returns

`this`

The builder instance for chaining

#### Example

```typescript
builder.withOperationId("getUserStats");
```

***

### withPathParameter()

> **withPathParameter**(`name`, `schema`, `options?`): `this`

Adds a path parameter to the OpenAPI operation.

Path parameters are embedded in the URL path (e.g., `/users/:id`).
Path parameters are always required per OpenAPI specification.

#### Parameters

##### name

`string`

Name of the path parameter (must match the route parameter)

##### schema

[`OpenApiSchemaProperty`](../interfaces/OpenApiSchemaProperty.md)

Schema defining the parameter's type and format

##### options?

Optional configuration for the parameter

###### description?

`string`

Human-readable description of the parameter

#### Returns

`this`

The builder instance for chaining

#### Example

```typescript
builder.withPathParameter("id", {type: "string", format: "uuid"}, {
  description: "Unique identifier of the user",
});
```

***

### withQueryParameter()

> **withQueryParameter**(`name`, `schema`, `options?`): `this`

Adds a query parameter to the OpenAPI operation.

Query parameters are passed in the URL query string (e.g., `?limit=10`).

#### Parameters

##### name

`string`

Name of the query parameter

##### schema

[`OpenApiSchemaProperty`](../interfaces/OpenApiSchemaProperty.md)

Schema defining the parameter's type and format

##### options?

Optional configuration for the parameter

###### description?

`string`

Human-readable description of the parameter

###### required?

`boolean`

Whether the parameter is required (default: false)

#### Returns

`this`

The builder instance for chaining

#### Example

```typescript
builder.withQueryParameter("limit", {type: "number"}, {
  required: false,
  description: "Maximum number of results to return",
});
```

***

### withRequestBody()

> **withRequestBody**\<`T`\>(`schema`, `options?`): `this`

Sets the request body schema for the OpenAPI operation.

Properties marked with `required: true` will be added to the schema's
required array automatically.

#### Type Parameters

##### T

`T` *extends* `Record`\<`string`, `unknown`\>

Type representing the request body structure

#### Parameters

##### schema

\{ \[K in string \| number \| symbol\]: OpenApiSchemaProperty \}

Object mapping property names to their OpenAPI schema definitions

##### options?

Optional configuration for the request body

###### mediaType?

`string`

Media type for the request body (default: "application/json")

###### required?

`boolean`

Whether the request body itself is required (default: true)

#### Returns

`this`

The builder instance for chaining

#### Example

```typescript
builder.withRequestBody<{name: string; age: number}>({
  name: {type: "string", description: "User name", required: true},
  age: {type: "number", description: "User age"},
});
```

***

### withResponse()

> **withResponse**\<`T`\>(`statusCode`, `schema`, `options?`): `this`

Adds a response definition to the OpenAPI operation.

Can accept either an object schema or a simple string description
for responses without a body (e.g., 204 No Content).

#### Type Parameters

##### T

`T` *extends* `Record`\<`string`, `unknown`\>

Type representing the response body structure

#### Parameters

##### statusCode

`number`

HTTP status code for this response

##### schema

`string` \| \{ \[K in string \| number \| symbol\]: OpenApiSchemaProperty \}

Either an object schema or a description string

##### options?

Optional configuration for the response

###### description?

`string`

Description of the response (default: "Success")

###### mediaType?

`string`

Media type for the response (default: "application/json")

#### Returns

`this`

The builder instance for chaining

#### Example

```typescript
// Response with body
builder.withResponse<{id: string}>(200, {
  id: {type: "string", description: "Created resource ID"},
}, {description: "Resource created successfully"});

// Response without body
builder.withResponse(204, "No content");
```

***

### withSummary()

> **withSummary**(`summary`): `this`

Sets the summary for the OpenAPI operation.

The summary is a brief description shown in API documentation listings.

#### Parameters

##### summary

`string`

Short description of the operation

#### Returns

`this`

The builder instance for chaining

#### Example

```typescript
builder.withSummary("Get user by ID");
```

***

### withTags()

> **withTags**(`tags`): `this`

Sets the tags for the OpenAPI operation.

Tags are used to group operations in the API documentation.

#### Parameters

##### tags

`string`[]

Array of tag names

#### Returns

`this`

The builder instance for chaining

#### Example

```typescript
builder.withTags(["users", "authentication"]);
```

***

### withValidation()

> **withValidation**(`options?`): `this`

Enables runtime validation for this route.

When enabled, the built middleware will validate incoming requests
against the documented schema before the handler runs.

#### Parameters

##### options?

Optional configuration for validation

###### body?

`boolean`

Enable body validation (default: true if request body is defined)

###### enabled?

`boolean`

Override the global validation enabled setting

###### query?

`boolean`

Enable query parameter validation (default: true if query params are defined)

#### Returns

`this`

The builder instance for chaining

#### Example

```typescript
createOpenApiBuilder(options)
  .withRequestBody<{name: string}>({name: {type: "string", required: true}})
  .withValidation() // Enable validation
  .build();
```
