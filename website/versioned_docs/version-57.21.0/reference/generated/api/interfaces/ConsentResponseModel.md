## Extends

- `Model`\<[`ConsentResponseDocument`](ConsentResponseDocument.md), `object`, [`ConsentResponseMethods`](ConsentResponseMethods.md)\>.[`ConsentResponseStatics`](ConsentResponseStatics.md)

## Constructors

### Constructor

> **new ConsentResponseModel**\<`DocType`\>(`doc?`, `fields?`, `options?`): `Document`\<`unknown`, `object`, [`ConsentResponseDocument`](ConsentResponseDocument.md), \{ \}, `DefaultSchemaOptions`\> & `Omit`\<[`ConsentResponseDocument`](ConsentResponseDocument.md) & `Required`\<\{ \}\> & `object`, `never`\> & `HydratedDocumentOverrides`\<[`ConsentResponseMethods`](ConsentResponseMethods.md)\>

#### Parameters

##### doc?

`DocType`

##### fields?

`any`

##### options?

`AnyObject`

#### Returns

`Document`\<`unknown`, `object`, [`ConsentResponseDocument`](ConsentResponseDocument.md), \{ \}, `DefaultSchemaOptions`\> & `Omit`\<[`ConsentResponseDocument`](ConsentResponseDocument.md) & `Required`\<\{ \}\> & `object`, `never`\> & `HydratedDocumentOverrides`\<[`ConsentResponseMethods`](ConsentResponseMethods.md)\>

#### Inherited from

`mongoose.Model<ConsentResponseDocument, object, ConsentResponseMethods>.constructor`

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

[`ConsentResponseStatics`](ConsentResponseStatics.md).[`findExactlyOne`](ConsentResponseStatics.md#findexactlyone)

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

[`ConsentResponseStatics`](ConsentResponseStatics.md).[`findOneOrNone`](ConsentResponseStatics.md#findoneornone)
