## Extends

- [`FindExactlyOnePlugin`](FindExactlyOnePlugin.md)\<[`MembershipDocument`](MembershipDocument.md)\>.[`FindOneOrNonePlugin`](FindOneOrNonePlugin.md)\<[`MembershipDocument`](MembershipDocument.md)\>

## Extended by

- [`MembershipModel`](MembershipModel.md)

## Properties

### findActiveForUser

> **findActiveForUser**: (`this`, `userId`) => `Promise`\<[`MembershipDocument`](MembershipDocument.md)[]\>

#### Parameters

##### this

[`MembershipModel`](MembershipModel.md)

##### userId

`string` \| `ObjectId`

#### Returns

`Promise`\<[`MembershipDocument`](MembershipDocument.md)[]\>

***

### isMember

> **isMember**: (`this`, `userId`, `organizationId`) => `Promise`\<`boolean`\>

#### Parameters

##### this

[`MembershipModel`](MembershipModel.md)

##### userId

`string` \| `ObjectId`

##### organizationId

`string` \| `ObjectId`

#### Returns

`Promise`\<`boolean`\>

***

### isOrgAdmin

> **isOrgAdmin**: (`this`, `userId`, `organizationId`) => `Promise`\<`boolean`\>

#### Parameters

##### this

[`MembershipModel`](MembershipModel.md)

##### userId

`string` \| `ObjectId`

##### organizationId

`string` \| `ObjectId`

#### Returns

`Promise`\<`boolean`\>

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

[`FindExactlyOnePlugin`](FindExactlyOnePlugin.md).[`findExactlyOne`](FindExactlyOnePlugin.md#findexactlyone)

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

[`FindOneOrNonePlugin`](FindOneOrNonePlugin.md).[`findOneOrNone`](FindOneOrNonePlugin.md#findoneornone)
