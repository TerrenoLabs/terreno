## Extends

- [`FindExactlyOnePlugin`](FindExactlyOnePlugin.md)\<[`McpToolSettingDocument`](McpToolSettingDocument.md)\>
- [`FindOneOrNonePlugin`](FindOneOrNonePlugin.md)\<[`McpToolSettingDocument`](McpToolSettingDocument.md)\>

## Properties

### disabledNames

> **disabledNames**: (`this`) => `Promise`\<`Set`\<`string`\>\>

Names of tools an admin turned off.

#### Parameters

##### this

[`McpToolSettingModel`](../type-aliases/McpToolSettingModel.md)

#### Returns

`Promise`\<`Set`\<`string`\>\>

***

### syncRegistered

> **syncRegistered**: (`this`, `tools`) => `Promise`\<`void`\>

Upsert one row per registered tool and mark rows for tools that are gone.

#### Parameters

##### this

[`McpToolSettingModel`](../type-aliases/McpToolSettingModel.md)

##### tools

`object`[]

#### Returns

`Promise`\<`void`\>

## Methods

### findExactlyOne()

> **findExactlyOne**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpToolSettingDocument`](McpToolSettingDocument.md)\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpToolSettingDocument`](McpToolSettingDocument.md)\>

#### Inherited from

[`FindExactlyOnePlugin`](FindExactlyOnePlugin.md).[`findExactlyOne`](FindExactlyOnePlugin.md#findexactlyone)

***

### findOneOrNone()

> **findOneOrNone**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpToolSettingDocument`](McpToolSettingDocument.md) \| `null`\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpToolSettingDocument`](McpToolSettingDocument.md) \| `null`\>

#### Inherited from

[`FindOneOrNonePlugin`](FindOneOrNonePlugin.md).[`findOneOrNone`](FindOneOrNonePlugin.md#findoneornone)
