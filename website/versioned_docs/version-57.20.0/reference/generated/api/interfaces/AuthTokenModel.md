## Extends

- `Model`\<[`AuthTokenDocument`](AuthTokenDocument.md), `object`, `AuthTokenMethods`\>.`AuthTokenStatics`

## Constructors

### Constructor

> **new AuthTokenModel**\<`DocType`\>(`doc?`, `fields?`, `options?`): `Document`\<`unknown`, `object`, [`AuthTokenDocument`](AuthTokenDocument.md), \{ \}, `DefaultSchemaOptions`\> & [`AuthTokenDocument`](AuthTokenDocument.md) & `Required`\<\{ \}\> & `object` & `object`

#### Parameters

##### doc?

`DocType`

##### fields?

`any`

##### options?

`AnyObject`

#### Returns

`Document`\<`unknown`, `object`, [`AuthTokenDocument`](AuthTokenDocument.md), \{ \}, `DefaultSchemaOptions`\> & [`AuthTokenDocument`](AuthTokenDocument.md) & `Required`\<\{ \}\> & `object` & `object`

#### Inherited from

`mongoose.Model<AuthTokenDocument, object, AuthTokenMethods>.constructor`

## Properties

### consume

> **consume**: (`this`, `token`, `type`) => `Promise`\<[`AuthTokenDocument`](AuthTokenDocument.md) \| `null`\>

#### Parameters

##### this

`AuthTokenModel`

##### token

`string`

##### type

[`AuthTokenType`](../type-aliases/AuthTokenType.md)

#### Returns

`Promise`\<[`AuthTokenDocument`](AuthTokenDocument.md) \| `null`\>

#### Inherited from

`AuthTokenStatics.consume`

***

### invalidateUnusedFor

> **invalidateUnusedFor**: (`this`, `user`, `type`) => `Promise`\<`void`\>

#### Parameters

##### this

`AuthTokenModel`

##### user

###### _id

\{ `toString`: `string`; \}

###### _id.toString

##### type

[`AuthTokenType`](../type-aliases/AuthTokenType.md)

#### Returns

`Promise`\<`void`\>

#### Inherited from

`AuthTokenStatics.invalidateUnusedFor`

***

### issueFor

> **issueFor**: (`this`, `user`, `type`) => `Promise`\<\{ `authToken`: [`AuthTokenDocument`](AuthTokenDocument.md); `token`: `string`; \}\>

#### Parameters

##### this

`AuthTokenModel`

##### user

###### _id

\{ `toString`: `string`; \}

###### _id.toString

##### type

[`AuthTokenType`](../type-aliases/AuthTokenType.md)

#### Returns

`Promise`\<\{ `authToken`: [`AuthTokenDocument`](AuthTokenDocument.md); `token`: `string`; \}\>

#### Inherited from

`AuthTokenStatics.issueFor`

## Methods

### findExactlyOne()

> **findExactlyOne**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`AuthTokenDocument`](AuthTokenDocument.md)\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`AuthTokenDocument`](AuthTokenDocument.md)\>

#### Inherited from

`AuthTokenStatics.findExactlyOne`

***

### findOneOrNone()

> **findOneOrNone**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`AuthTokenDocument`](AuthTokenDocument.md) \| `null`\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`AuthTokenDocument`](AuthTokenDocument.md) \| `null`\>

#### Inherited from

`AuthTokenStatics.findOneOrNone`
