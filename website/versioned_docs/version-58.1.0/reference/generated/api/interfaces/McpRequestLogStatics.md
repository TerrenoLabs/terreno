## Extends

- [`FindExactlyOnePlugin`](FindExactlyOnePlugin.md)\<[`McpRequestLogDocument`](McpRequestLogDocument.md)\>
- [`FindOneOrNonePlugin`](FindOneOrNonePlugin.md)\<[`McpRequestLogDocument`](McpRequestLogDocument.md)\>

## Methods

### findExactlyOne()

> **findExactlyOne**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpRequestLogDocument`](McpRequestLogDocument.md)\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpRequestLogDocument`](McpRequestLogDocument.md)\>

#### Inherited from

[`FindExactlyOnePlugin`](FindExactlyOnePlugin.md).[`findExactlyOne`](FindExactlyOnePlugin.md#findexactlyone)

***

### findOneOrNone()

> **findOneOrNone**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpRequestLogDocument`](McpRequestLogDocument.md) \| `null`\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpRequestLogDocument`](McpRequestLogDocument.md) \| `null`\>

#### Inherited from

[`FindOneOrNonePlugin`](FindOneOrNonePlugin.md).[`findOneOrNone`](FindOneOrNonePlugin.md#findoneornone)
