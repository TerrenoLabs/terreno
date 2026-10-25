> **executeCreate**\<`T`\>(`__namedParameters`): `Promise`\<[`ExecutorResult`](../interfaces/ExecutorResult.md)\<`T`\>\>

Create a document through the same pipeline as `POST /`: method-level permissions,
`transformer.transform`, `preCreate`, `Model.create` (Mongoose validation), population,
and `postCreate`. Throws APIErrors with the same statuses/titles as the REST handler.

## Type Parameters

### T

`T`

## Parameters

### \_\_namedParameters

#### body

`unknown`

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

C5 (FIX 6): when true, skip the built-in `postCreate` call — the caller
(the sync mutation handler) runs it manually AFTER finalizing the
idempotency ledger `applied`, so a post-hook throw can never make a
committed write look like a failure. REST handlers never set this.

#### user?

[`User`](../interfaces/User.md)

#### writeModelName?

`string`

Name used for User-role stripping after hooks. Defaults to `model.modelName`.
MCP passes the registry `modelName` because compiled mongoose names can differ.

## Returns

`Promise`\<[`ExecutorResult`](../interfaces/ExecutorResult.md)\<`T`\>\>
