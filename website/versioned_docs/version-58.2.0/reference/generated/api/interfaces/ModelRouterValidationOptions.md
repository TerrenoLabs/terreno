Options for creating validation middleware for a modelRouter.

## Properties

### excludeFromCreate?

> `optional` **excludeFromCreate?**: `string`[]

Fields to exclude from create validation (e.g. fields injected by preCreate).

***

### excludeFromUpdate?

> `optional` **excludeFromUpdate?**: `string`[]

Fields to exclude from update validation (e.g. fields injected by preUpdate).

***

### onAdditionalPropertiesRemoved?

> `optional` **onAdditionalPropertiesRemoved?**: (`removedProperties`, `req`) => `void`

Callback fired when additional properties are removed from a request body.
Overrides the global onAdditionalPropertiesRemoved for this router.

#### Parameters

##### removedProperties

`string`[]

##### req

`Request`

#### Returns

`void`

***

### onError?

> `optional` **onError?**: (`errors`, `req`) => `void`

Custom error handler for validation failures.

#### Parameters

##### errors

`ErrorObject`\<`string`, `Record`\<`string`, `any`\>, `unknown`\>[]

##### req

`Request`

#### Returns

`void`

***

### validateCreate?

> `optional` **validateCreate?**: `boolean`

Enable validation for create (POST) requests.
Default: true (when validation is globally enabled)

***

### validateQuery?

> `optional` **validateQuery?**: `boolean`

Enable validation for query (GET list) requests.
Default: true (when validation is globally enabled)

***

### validateUpdate?

> `optional` **validateUpdate?**: `boolean`

Enable validation for update (PATCH) requests.
Default: true (when validation is globally enabled)
