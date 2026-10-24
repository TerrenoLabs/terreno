> **createModelValidators**\<`T`\>(`model`, `options?`): `object`

Creates validation middleware for use with modelRouter.
Returns an object with middleware for each operation type.

## Type Parameters

### T

`T`

## Parameters

### model

`Model`\<`T`\>

The Mongoose model

### options?

[`ModelRouterValidationOptions`](../interfaces/ModelRouterValidationOptions.md)

Configuration options

## Returns

`object`

Object with create and update validation middleware

### create

> **create**: (`req`, `res`, `next`) => `void`

#### Parameters

##### req

`Request`

##### res

`Response`

##### next

`NextFunction`

#### Returns

`void`

### update

> **update**: (`req`, `res`, `next`) => `void`

#### Parameters

##### req

`Request`

##### res

`Response`

##### next

`NextFunction`

#### Returns

`void`
