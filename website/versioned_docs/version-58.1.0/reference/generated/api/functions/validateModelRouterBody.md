> **validateModelRouterBody**\<`T`\>(`__namedParameters`): `Record`\<`string`, `unknown`\>

Validates one create or update body exactly as `POST /` or `PATCH /:id` validate theirs
(OpenAPI schema, coercion, additional-property removal), returning the cleaned body or
throwing the same 400. A no-op until validation is enabled globally or on the router.

## Type Parameters

### T

`T`

## Parameters

### \_\_namedParameters

#### body

`Record`\<`string`, `unknown`\>

#### method

`"create"` \| `"update"`

#### model

`ModelLike`\<`T`\>

#### options

[`ModelRouterOptions`](../interfaces/ModelRouterOptions.md)\<`T`\>

#### req?

`Request`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>

## Returns

`Record`\<`string`, `unknown`\>
