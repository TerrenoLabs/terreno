> **executeDelete**\<`T`\>(`__namedParameters`): `Promise`\<[`ExecutorResult`](../interfaces/ExecutorResult.md)\<`T`\>\>

Delete a document through the same pipeline as `DELETE /:id`: method-level and object-level
permissions, doc loading (404), `preDelete`, soft delete (`deleted = true` + save when the
schema has a Boolean `deleted` path, else `doc.deleteOne()`), and `postDelete`. Throws
APIErrors with the same statuses/titles as the REST handler.

## Type Parameters

### T

`T`

## Parameters

### \_\_namedParameters

#### existingDoc?

`Document`\<`unknown`, `unknown`, `unknown`, `Record`\<`string`, `any`\>, \{ \}\> & `T` & `object`

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

## Returns

`Promise`\<[`ExecutorResult`](../interfaces/ExecutorResult.md)\<`T`\>\>
