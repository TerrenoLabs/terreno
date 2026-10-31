## Extends

- `Model`\<[`ConsentFormDocument`](ConsentFormDocument.md), `object`, [`ConsentFormMethods`](../type-aliases/ConsentFormMethods.md)\>.[`ConsentFormStatics`](ConsentFormStatics.md)

## Constructors

### Constructor

> **new ConsentFormModel**\<`DocType`\>(`doc?`, `fields?`, `options?`): `Document`\<`unknown`, `object`, [`ConsentFormDocument`](ConsentFormDocument.md), \{ \}, `DefaultSchemaOptions`\> & [`ConsentFormDocument`](ConsentFormDocument.md) & `Required`\<\{ \}\> & `object` & `object`

#### Parameters

##### doc?

`DocType`

##### fields?

`any`

##### options?

`AnyObject`

#### Returns

`Document`\<`unknown`, `object`, [`ConsentFormDocument`](ConsentFormDocument.md), \{ \}, `DefaultSchemaOptions`\> & [`ConsentFormDocument`](ConsentFormDocument.md) & `Required`\<\{ \}\> & `object` & `object`

#### Inherited from

`mongoose.Model<ConsentFormDocument, object, ConsentFormMethods>.constructor`

## Methods

### findExactlyOne()

> **findExactlyOne**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`ConsentFormDocument`](ConsentFormDocument.md)\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`ConsentFormDocument`](ConsentFormDocument.md)\>

#### Inherited from

[`ConsentFormStatics`](ConsentFormStatics.md).[`findExactlyOne`](ConsentFormStatics.md#findexactlyone)

***

### findOneOrNone()

> **findOneOrNone**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`ConsentFormDocument`](ConsentFormDocument.md) \| `null`\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`ConsentFormDocument`](ConsentFormDocument.md) \| `null`\>

#### Inherited from

[`ConsentFormStatics`](ConsentFormStatics.md).[`findOneOrNone`](ConsentFormStatics.md#findoneornone)
