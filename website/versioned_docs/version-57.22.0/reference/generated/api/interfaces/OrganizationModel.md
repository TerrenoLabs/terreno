## Extends

- `Model`\<[`OrganizationDocument`](OrganizationDocument.md), `object`, [`OrganizationMethods`](../type-aliases/OrganizationMethods.md)\>.[`OrganizationStatics`](OrganizationStatics.md)

## Constructors

### Constructor

> **new OrganizationModel**\<`DocType`\>(`doc?`, `fields?`, `options?`): `Document`\<`unknown`, `object`, [`OrganizationDocument`](OrganizationDocument.md), \{ \}, `DefaultSchemaOptions`\> & [`OrganizationDocument`](OrganizationDocument.md) & `Required`\<\{ \}\> & `object` & `object`

#### Parameters

##### doc?

`DocType`

##### fields?

`any`

##### options?

`AnyObject`

#### Returns

`Document`\<`unknown`, `object`, [`OrganizationDocument`](OrganizationDocument.md), \{ \}, `DefaultSchemaOptions`\> & [`OrganizationDocument`](OrganizationDocument.md) & `Required`\<\{ \}\> & `object` & `object`

#### Inherited from

`mongoose.Model<OrganizationDocument, object, OrganizationMethods>.constructor`

## Methods

### findExactlyOne()

> **findExactlyOne**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`OrganizationDocument`](OrganizationDocument.md)\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`OrganizationDocument`](OrganizationDocument.md)\>

#### Inherited from

[`OrganizationStatics`](OrganizationStatics.md).[`findExactlyOne`](OrganizationStatics.md#findexactlyone)

***

### findOneOrNone()

> **findOneOrNone**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`OrganizationDocument`](OrganizationDocument.md) \| `null`\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`OrganizationDocument`](OrganizationDocument.md) \| `null`\>

#### Inherited from

[`OrganizationStatics`](OrganizationStatics.md).[`findOneOrNone`](OrganizationStatics.md#findoneornone)
