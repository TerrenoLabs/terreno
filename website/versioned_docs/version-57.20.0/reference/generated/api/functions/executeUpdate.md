> **executeUpdate**\<`T`\>(`__namedParameters`): `Promise`\<[`ExecutorResult`](../interfaces/ExecutorResult.md)\<`T`\>\>

Update a document through the same pipeline as `PATCH /:id`: method-level and object-level
permissions, doc loading (404), `transformer.transform`, `_updatedAt` stripping,
`preUpdate`, the optional concurrency check, `doc.set` + `doc.save` (Mongoose validation),
population, and `postUpdate`. Throws APIErrors with the same statuses/titles as the REST
handler; concurrency conflicts throw `ExecutorConflictError` (409) carrying the server doc.

## Type Parameters

### T

`T`

## Parameters

### \_\_namedParameters

#### body

`unknown`

#### concurrencyCheck?

[`ExecutorConcurrencyCheck`](../type-aliases/ExecutorConcurrencyCheck.md)

#### existingDoc?

[`ExecutorDoc`](../type-aliases/ExecutorDoc.md)\<`T`\>

Pre-loaded document, used by the REST handler where permissionMiddleware already loaded
and authorized it (avoids a second fetch). Permission checks still run either way.

#### id

`string`

#### model

`Model`\<`T`\>

#### options

[`ModelRouterOptions`](../interfaces/ModelRouterOptions.md)\<`T`\>

#### req?

`Request`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>

The real Express request when called over HTTP; hooks receive a `{user}` stub otherwise.

#### skipPermissionChecks?

`boolean`

When true, skip modelRouter permission checks (admin-window sync mutations).

#### skipPostHooks?

`boolean`

C5 (FIX 6): see `executeCreate`'s `skipPostHooks` doc comment.

#### user?

[`User`](../interfaces/User.md)

#### writeModelName?

`string`

Name used for User-role stripping after hooks. Defaults to `model.modelName`.
MCP passes the registry `modelName` because compiled mongoose names can differ.

## Returns

`Promise`\<[`ExecutorResult`](../interfaces/ExecutorResult.md)\<`T`\>\>
