## Extends

- `Model`\<[`MembershipDocument`](MembershipDocument.md), `object`, [`MembershipMethods`](../type-aliases/MembershipMethods.md)\>.[`MembershipStatics`](MembershipStatics.md)

## Constructors

### Constructor

> **new MembershipModel**\<`DocType`\>(`doc?`, `fields?`, `options?`): `Document`\<`unknown`, `object`, [`MembershipDocument`](MembershipDocument.md), \{ \}, `DefaultSchemaOptions`\> & [`MembershipDocument`](MembershipDocument.md) & `Required`\<\{ \}\> & `object` & `object`

#### Parameters

##### doc?

`DocType`

##### fields?

`any`

##### options?

`AnyObject`

#### Returns

`Document`\<`unknown`, `object`, [`MembershipDocument`](MembershipDocument.md), \{ \}, `DefaultSchemaOptions`\> & [`MembershipDocument`](MembershipDocument.md) & `Required`\<\{ \}\> & `object` & `object`

#### Inherited from

`mongoose.Model<MembershipDocument, object, MembershipMethods>.constructor`

## Properties

### findActiveForUser

> **findActiveForUser**: (`this`, `userId`) => `Promise`\<[`MembershipDocument`](MembershipDocument.md)[]\>

#### Parameters

##### this

`MembershipModel`

##### userId

`string` \| `ObjectId`

#### Returns

`Promise`\<[`MembershipDocument`](MembershipDocument.md)[]\>

#### Inherited from

[`MembershipStatics`](MembershipStatics.md).[`findActiveForUser`](MembershipStatics.md#findactiveforuser)

***

### isMember

> **isMember**: (`this`, `userId`, `organizationId`) => `Promise`\<`boolean`\>

#### Parameters

##### this

`MembershipModel`

##### userId

`string` \| `ObjectId`

##### organizationId

`string` \| `ObjectId`

#### Returns

`Promise`\<`boolean`\>

#### Inherited from

[`MembershipStatics`](MembershipStatics.md).[`isMember`](MembershipStatics.md#ismember)

***

### isOrgAdmin

> **isOrgAdmin**: (`this`, `userId`, `organizationId`) => `Promise`\<`boolean`\>

#### Parameters

##### this

`MembershipModel`

##### userId

`string` \| `ObjectId`

##### organizationId

`string` \| `ObjectId`

#### Returns

`Promise`\<`boolean`\>

#### Inherited from

[`MembershipStatics`](MembershipStatics.md).[`isOrgAdmin`](MembershipStatics.md#isorgadmin)

## Methods

### findExactlyOne()

> **findExactlyOne**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`MembershipDocument`](MembershipDocument.md)\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`MembershipDocument`](MembershipDocument.md)\>

#### Inherited from

[`MembershipStatics`](MembershipStatics.md).[`findExactlyOne`](MembershipStatics.md#findexactlyone)

***

### findOneOrNone()

> **findOneOrNone**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`MembershipDocument`](MembershipDocument.md) \| `null`\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`MembershipDocument`](MembershipDocument.md) \| `null`\>

#### Inherited from

[`MembershipStatics`](MembershipStatics.md).[`findOneOrNone`](MembershipStatics.md#findoneornone)
