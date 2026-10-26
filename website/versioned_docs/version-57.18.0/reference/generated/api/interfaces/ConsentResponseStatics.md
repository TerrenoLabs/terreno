## Extends

- [`FindExactlyOnePlugin`](FindExactlyOnePlugin.md)\<[`ConsentResponseDocument`](ConsentResponseDocument.md)\>.[`FindOneOrNonePlugin`](FindOneOrNonePlugin.md)\<[`ConsentResponseDocument`](ConsentResponseDocument.md)\>

## Extended by

- [`ConsentResponseModel`](ConsentResponseModel.md)

## Methods

### findExactlyOne()

> **findExactlyOne**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`ConsentResponseDocument`](ConsentResponseDocument.md)\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`ConsentResponseDocument`](ConsentResponseDocument.md)\>

#### Inherited from

[`FindExactlyOnePlugin`](FindExactlyOnePlugin.md).[`findExactlyOne`](FindExactlyOnePlugin.md#findexactlyone)

***

### findOneOrNone()

> **findOneOrNone**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`ConsentResponseDocument`](ConsentResponseDocument.md) \| `null`\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`ConsentResponseDocument`](ConsentResponseDocument.md) \| `null`\>

#### Inherited from

[`FindOneOrNonePlugin`](FindOneOrNonePlugin.md).[`findOneOrNone`](FindOneOrNonePlugin.md#findoneornone)
