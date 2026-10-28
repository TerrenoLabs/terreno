Options for the request body validator middleware.

## Properties

### enabled?

> `optional` **enabled?**: `boolean`

Override the global validateRequests setting for this specific route.

***

### excludeFields?

> `optional` **excludeFields?**: `string`[]

Fields to exclude from validation (e.g. fields set by preCreate hooks).
Excluded fields are removed from both the schema properties and the required array.

***

### onAdditionalPropertiesRemoved?

> `optional` **onAdditionalPropertiesRemoved?**: (`removedProperties`, `req`) => `void`

Callback fired when additional properties are removed.
Overrides the global onAdditionalPropertiesRemoved for this route.

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

Custom error handler for this specific route.

#### Parameters

##### errors

`ErrorObject`\<`string`, `Record`\<`string`, `any`\>, `unknown`\>[]

##### req

`Request`

#### Returns

`void`

***

### partial?

> `optional` **partial?**: `boolean`

When true, skip schema-level `required` (PATCH / partial update bodies).
Present fields are still type-checked.

***

### required?

> `optional` **required?**: `string`[]

List of required field names.
