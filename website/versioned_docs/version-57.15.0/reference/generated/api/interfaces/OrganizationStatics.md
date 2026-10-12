## Extends

- [`FindExactlyOnePlugin`](FindExactlyOnePlugin.md)\<[`OrganizationDocument`](OrganizationDocument.md)\>.[`FindOneOrNonePlugin`](FindOneOrNonePlugin.md)\<[`OrganizationDocument`](OrganizationDocument.md)\>

## Extended by

- [`OrganizationModel`](OrganizationModel.md)

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

[`FindExactlyOnePlugin`](FindExactlyOnePlugin.md).[`findExactlyOne`](FindExactlyOnePlugin.md#findexactlyone)

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

[`FindOneOrNonePlugin`](FindOneOrNonePlugin.md).[`findOneOrNone`](FindOneOrNonePlugin.md#findoneornone)
