This is the main configuration.

## Type Parameters

### T

`T`

the base document type. This should not include Mongoose models, just the types of the object.

## Properties

### access?

> `optional` **access?**: [`ModelRouterAccessOptions`](ModelRouterAccessOptions.md)

RBAC access configuration for this router. Requires `accessControl` on the same options object
or injected by TerrenoApp at build time.

***

### accessControl?

> `optional` **accessControl?**: [`AnyTerrenoAccess`](../type-aliases/AnyTerrenoAccess.md)

TerrenoAccess instance used to evaluate `access` permissions.

***

### admin?

> `optional` **admin?**: [`AdminConfig`](AdminConfig.md)

Optional admin panel metadata for this model. Consumed by AdminApp when aggregating
`/admin/config` and for server-side field scrubbing / realtime change events.

***

### allowAnonymous?

> `optional` **allowAnonymous?**: `boolean`

Allow anonymous users to access the resource.
Defaults to false.

***

### audit?

> `optional` **audit?**: [`ModelRouterAuditConfig`](../type-aliases/ModelRouterAuditConfig.md)

When true or `{redact}`, persist an `AuditEvent` after successful HTTP
create/update/delete. Requires `AuditApp`. Extra `redact` names merge with
the default secret segments (`password`, `hash`, `salt`, `token`, `secret`,
`refreshToken`).

***

### collectionActions?

> `optional` **collectionActions?**: `Record`\<`string`, [`CollectionActionConfig`](CollectionActionConfig.md)\<`unknown`, `unknown`, `unknown`\>\>

Named collection-scoped operations at `/:actionName` (GET or POST).

***

### defaultLimit?

> `optional` **defaultLimit?**: `number`

Default limit applied to list queries if not specified by the user. Defaults to 100.

***

### defaultQueryParams?

> `optional` **defaultQueryParams?**: `Record`\<`string`, `unknown`\>

Default queries to provide to Mongo before any user queries or transforms happen when making
list queries. Accepts any Mongoose-style queries, and runs for all user types.
   defaultQueryParams: {hidden: false} // By default, don't show objects with hidden=true
These can be overridden by the user if not disallowed by queryFilter.

***

### endpoints?

> `optional` **endpoints?**: (`router`, `options?`) => `void`

Custom route setup function. Receives the router and optionally the full options (including openApi).

#### Parameters

##### router

`Router`

##### options?

`Partial`\<`ModelRouterOptions`\<`T`\>\>

#### Returns

`void`

***

### instanceActions?

> `optional` **instanceActions?**: `Record`\<`string`, [`InstanceActionConfig`](InstanceActionConfig.md)\<`T`, `unknown`, `unknown`, `unknown`\>\>

Named instance-scoped operations at `/:id/:actionName` (GET or POST).

***

### maxLimit?

> `optional` **maxLimit?**: `number`

Maximum query limit the user can request. Defaults to 500, and is the lowest of the limit
query, max limit,
 or 500.

***

### mcp?

> `optional` **mcp?**: [`MCPConfig`](MCPConfig.md)

MCP (Model Context Protocol) configuration. When provided, registers this model's
CRUD operations as MCP tools that can be called by LLMs.

Tools are auto-generated based on the methods specified (default: ['list', 'read']).
Auth, permissions, population, and filtering all work the same as REST.

#### Example

```typescript
modelRouter("/todos", Todo, {
  mcp: {
    methods: ['list', 'read', 'create'],
    excludeFields: ['internalNote'],
    maxLimit: 25,
  },
});
```

***

### openApi?

> `optional` **openApi?**: [`OpenApiMiddleware`](OpenApiMiddleware.md)

The OpenAPI generator for this server. This is used to generate the OpenAPI documentation.

***

### openApiExtraModelProperties?

> `optional` **openApiExtraModelProperties?**: `Record`\<`string`, `unknown`\>

Overwrite parts of the model properties for the OpenAPI generator.
This will be merged with the generated configuration.
This is useful if you add custom properties to the model during serialize, for example,
that you want to be documented and typed in the SDK.

***

### openApiOverwrite?

> `optional` **openApiOverwrite?**: `object`

Overwrite parts of the configuration for the OpenAPI generator.
This will be merged with the generated configuration.

#### create?

> `optional` **create?**: `Record`\<`string`, `unknown`\>

#### delete?

> `optional` **delete?**: `Record`\<`string`, `unknown`\>

#### get?

> `optional` **get?**: `Record`\<`string`, `unknown`\>

#### list?

> `optional` **list?**: `Record`\<`string`, `unknown`\>

#### update?

> `optional` **update?**: `Record`\<`string`, `unknown`\>

***

### ~~permissions~~

> **permissions**: [`RESTPermissions`](RESTPermissions.md)\<`T`\>

A group of method-level (create/read/update/delete/list) permissions.
Determine if the user can perform the operation at all, and for read/update/delete methods,
whether the user can perform the operation on the object referenced.

#### Deprecated

Use `access` with `accessControl` instead. Still required as a type-level
fallback; `resolveModelRouterAccess` replaces these methods when `access` is set.

***

### populatePaths?

> `optional` **populatePaths?**: [`PopulatePath`](PopulatePath.md)[]

Manages Mongoose populations before returning from all methods (list, read, create, etc).
For each population:
 path: Accepts Mongoose-style populate strings for path. e.g. "user" or "users.userId"
   (for an array of subschemas with userId)
 fields: An array of strings to filter on the populated objects, following Mongoose's select
   rules. If each field starts a preceding "-", will act as a block list and only remove those
   fields. If each field does not start with a "-", will act as an allow list and only
   return those fields. Mixing allow and blocking is not supported. e.g. "-created updated"
   is an error.
 openApiComponent: If you have a component already registered,
   use that instead of autogenerating the types for the populated fields.

***

### postCreate?

> `optional` **postCreate?**: (`value`, `request`) => `void` \| `Promise`\<`void`\>

Hook that runs after the object is created but before the responseHandler serializes and
returned. This is a good spot to perform dependent changes to other models or performing async
tasks/side effects, such as sending a push notification.
Throw an APIError to return a 400 with an error message.

#### Parameters

##### value

`T`

##### request

`Request`

#### Returns

`void` \| `Promise`\<`void`\>

***

### postDelete?

> `optional` **postDelete?**: (`request`, `value`) => `void` \| `Promise`\<`void`\>

Hook that runs after the object is deleted. This is a good spot to perform dependent changes
to other models or performing async tasks/side effects, such as cascading object deletions.
Throw an APIError to return a 400 with an error message.

#### Parameters

##### request

`Request`

The Express request object.

##### value

`T`

The document that was deleted, after the soft update of deleted: true (type: T).

#### Returns

`void` \| `Promise`\<`void`\>

***

### postGet?

> `optional` **postGet?**: (`value`, `request`) => `Promise`\<`T`\> \| `undefined`

Hook that runs after the object is fetched but before it is serialized.
Returns a promise so that asynchronous actions can be included in the function.
Throw an APIError to return a 400 with an error message.
@deprecated: Use responseHandler instead.

#### Parameters

##### value

`T`

##### request

`Request`

#### Returns

`Promise`\<`T`\> \| `undefined`

***

### postList?

> `optional` **postList?**: (`value`, `request`) => `Promise`\<`Document`\<`unknown`, `unknown`, `unknown`, `Record`\<`string`, `any`\>, \{ \}\> & `T`[]\>

Hook that runs after the list of objects is fetched but before they are serialized.
Returns a promise so that asynchronous actions can be included in the function.
Throw an APIError to return a 400 with an error message.
@deprecated: Use responseHandler instead.

#### Parameters

##### value

`Document`\<`unknown`, `unknown`, `unknown`, `Record`\<`string`, `any`\>, \{ \}\> & `T`[]

##### request

`Request`

#### Returns

`Promise`\<`Document`\<`unknown`, `unknown`, `unknown`, `Record`\<`string`, `any`\>, \{ \}\> & `T`[]\>

***

### postUpdate?

> `optional` **postUpdate?**: (`value`, `cleanedBody`, `request`, `prevValue`) => `void` \| `Promise`\<`void`\>

Hook that runs after the object is updated but before the responseHandler serializes and
returned. This is a good spot to perform dependent changes to other models or perform async
tasks/side effects, such as sending a push notification.
Throw an APIError to return a 400 with an error message.

#### Parameters

##### value

`T`

The document after it has been updated (type: T).

##### cleanedBody

`Partial`\<`T`\>

The request body relative to the model update (type: Partial<T>).

##### request

`Request`

The Express request object.

##### prevValue

`T`

The entire document before it was updated (type: T).

#### Returns

`void` \| `Promise`\<`void`\>

***

### preCreate?

> `optional` **preCreate?**: (`value`, `request`) => `T` \| `Promise`\<`T`\> \| `null`

Hook that runs after `transformer.transform` but before the object is created.
Can update the body fields based on the request or the user.
Return null to return a generic 403 error. Throw an APIError to return a 400 with specific
error information.

#### Parameters

##### value

`Partial`\<`T`\> \| (`Partial`\<`T`\> \| `undefined`)[] \| `null` \| `undefined`

##### request

`Request`

#### Returns

`T` \| `Promise`\<`T`\> \| `null`

***

### preDelete?

> `optional` **preDelete?**: (`value`, `request`) => `T` \| `Promise`\<`T`\> \| `null`

Hook that runs after `transformer.transform` but before the object is deleted.
Return null to return a generic 403 error.
Throw an APIError to return a 400 with specific error information.

#### Parameters

##### value

`T`

The document to be deleted, before the soft update of deleted: true (type: T).

##### request

`Request`

The Express request object.

#### Returns

`T` \| `Promise`\<`T`\> \| `null`

***

### preUpdate?

> `optional` **preUpdate?**: (`value`, `request`) => `T` \| `Promise`\<`T`\> \| `null`

Hook that runs after `transformer.transform` but before changes are made for update operations.
Can update the body fields based on the request or the user.
Also applies to all array operations. Return null to return a generic 403 error.
Throw an APIError to return a 400 with specific error information.

#### Parameters

##### value

`Partial`\<`T`\>

The request body relative to the model update (type: Partial<T>). Note: this does not contain the entire document to be updated, only the fields being updated.

##### request

`Request`

The Express request object.

#### Returns

`T` \| `Promise`\<`T`\> \| `null`

***

### queryFields?

> `optional` **queryFields?**: `string`[]

A list of fields on the model that can be queried using standard comparisons for booleans,
strings, dates
   (as ISOStrings), and numbers.
For example:
 ?foo=true // boolean query
 ?foo=bar // string query
 ?foo=1 // number query
 ?foo=2022-07-23T02:34:07.118Z // date query (should first be encoded for query params, not shown here)
Note: `limit` and `page` are automatically supported and are reserved.

***

### queryFilter?

> `optional` **queryFilter?**: (`user?`, `query?`) => `Record`\<`string`, `unknown`\> \| `Promise`\<`Record`\<`string`, `unknown`\> \| `null`\> \| `null`

queryFilter is a function to parse the query params and see if the query should be allowed.
This can be used for permissioning to make sure less privileged users are not making
privileged queries. If a query should not be allowed,
return `null` from the function and an empty query result will be returned to the client
without an error. You can also throw an APIError to be explicit about the issues.
You can transform the given query params by returning different values.
If the query is acceptable as-is, return `query` as-is.

#### Parameters

##### user?

[`User`](User.md)

##### query?

`Record`\<`string`, `unknown`\>

#### Returns

`Record`\<`string`, `unknown`\> \| `Promise`\<`Record`\<`string`, `unknown`\> \| `null`\> \| `null`

***

### ~~realtime?~~

> `optional` **realtime?**: [`RealtimeConfig`](RealtimeConfig.md)

Enable real-time sync for this model via WebSocket events.
When configured, CRUD operations will emit events to connected clients
through the RealtimeApp plugin's change stream watcher.

Requires the RealtimeApp plugin to be registered with TerrenoApp.

#### Deprecated

Removed in Terreno 58. Use `sync` with
`@terreno/syncdb` instead. `RealtimeApp` remains required for sync sockets.
See docs/how-to/migrate-rtk-to-syncdb.md.

***

### responseHandler?

> `optional` **responseHandler?**: (`value`, `method`, `request`, `options`) => `Promise`\<[`JSONValue`](../type-aliases/JSONValue.md)\>

Serialize an object or list of objects before returning to the client.
This is a good spot to remove sensitive information from the object, such as passwords or API
keys. Throw an APIError to return a 400 with an error message.

#### Parameters

##### value

`Document`\<`unknown`, `unknown`, `unknown`, `Record`\<`string`, `any`\>, \{ \}\> & `T` \| `Document`\<`unknown`, `unknown`, `unknown`, `Record`\<`string`, `any`\>, \{ \}\> & `T`[]

##### method

`"read"` \| `"delete"` \| `"list"` \| `"create"` \| `"update"`

##### request

`Request`

##### options

`ModelRouterOptions`\<`T`\>

#### Returns

`Promise`\<[`JSONValue`](../type-aliases/JSONValue.md)\>

***

### sort?

> `optional` **sort?**: `string` \| \{\[`key`: `string`\]: `"ascending"` \| `"descending"`; \}

Default sort for list operations. Can be a single field, a space-seperated list of fields, or an object.
?sort=foo // single field: foo ascending
?sort=-foo // single field: foo descending
?sort=-foo bar // multi field: foo descending, bar ascending
?sort={foo: 'ascending', bar: 'descending'} // object: foo ascending, bar descending

Note: you should have an index field on these fields or Mongo may slow down considerably.

***

### sync?

> `optional` **sync?**: [`SyncConfig`](SyncConfig.md)

Enable local-first sync (@terreno/syncdb) for this model. Documents are scoped
into streams (owner/tenant/broadcast/custom) with monotonic per-stream cursors.
Set `sync.adminBroadcast: true` to also emit `sync:delta` to `{collection}|admin`
(default false; stored on the collection catalog at registration).

Requires the schema to use `isDeletedPlugin` (soft delete tombstones) and
`syncPlugin` (per-stream `_syncSeq` stamping) — validated at registration.
Only works with the three-argument form: modelRouter('/path', Model, options).

***

### ~~transformer?~~

> `optional` **transformer?**: [`TerrenoTransformer`](TerrenoTransformer.md)\<`T`\>

Transformers allow data to be transformed before actions are executed,
and serialized before being returned to the user.

Transformers can be used to throw out fields that the user should not be able to write to, such as the `admin` flag.
Serializers can be used to hide data from the client or change how it is presented. Serializers run after the data
has been changed or queried but before returning to the client.

#### Deprecated

Use preCreate/preUpdate/preDelete hooks instead of transformer.transform. Use serialize instead of
transformer.serialize.

***

### validation?

> `optional` **validation?**: `boolean` \| [`ModelRouterValidationOptions`](ModelRouterValidationOptions.md)

Enable runtime validation of request bodies against the OpenAPI schema.
When enabled, requests that don't match the documented schema will return 400 errors.

Can be set to:
- `true`: Enable validation for create and update operations
- `false`: Disable validation (default)
- Object with `validateCreate` and `validateUpdate` booleans for fine-grained control

Note: Global validation can be enabled via `configureOpenApiValidator()`.
This option overrides the global setting for this specific router.
