## Extends

- `Model`\<[`McpServiceTokenDocument`](McpServiceTokenDocument.md), `object`, `McpServiceTokenMethods`\>.[`McpServiceTokenStatics`](McpServiceTokenStatics.md)

## Constructors

### Constructor

> **new McpServiceTokenModel**\<`DocType`\>(`doc?`, `fields?`, `options?`): `Document`\<`unknown`, `object`, [`McpServiceTokenDocument`](McpServiceTokenDocument.md), \{ \}, `DefaultSchemaOptions`\> & `Omit`\<[`McpServiceTokenDocument`](McpServiceTokenDocument.md) & `Required`\<\{ \}\> & `object`, `"id"` \| `"deleteOne"`\> & `HydratedDocumentOverrides`\<`McpServiceTokenMethods` & `object`\>

#### Parameters

##### doc?

`DocType`

##### fields?

`any`

##### options?

`AnyObject`

#### Returns

`Document`\<`unknown`, `object`, [`McpServiceTokenDocument`](McpServiceTokenDocument.md), \{ \}, `DefaultSchemaOptions`\> & `Omit`\<[`McpServiceTokenDocument`](McpServiceTokenDocument.md) & `Required`\<\{ \}\> & `object`, `"id"` \| `"deleteOne"`\> & `HydratedDocumentOverrides`\<`McpServiceTokenMethods` & `object`\>

#### Inherited from

`mongoose.Model<McpServiceTokenDocument, object, McpServiceTokenMethods>.constructor`

## Properties

### countActiveForUser

> **countActiveForUser**: (`this`, `userId`) => `Promise`\<`number`\>

#### Parameters

##### this

`McpServiceTokenModel`

##### userId

`ObjectId`

#### Returns

`Promise`\<`number`\>

#### Inherited from

[`McpServiceTokenStatics`](McpServiceTokenStatics.md).[`countActiveForUser`](McpServiceTokenStatics.md#countactiveforuser)

***

### issueFor

> **issueFor**: (`this`, `user`, `options`) => `Promise`\<\{ `mcpServiceToken`: [`McpServiceTokenDocument`](McpServiceTokenDocument.md); `token`: `string`; \}\>

#### Parameters

##### this

`McpServiceTokenModel`

##### user

###### _id

\{ `toString`: `string`; \}

###### _id.toString

###### tokenEpoch?

`number`

##### options

[`McpServiceTokenIssueOptions`](McpServiceTokenIssueOptions.md)

#### Returns

`Promise`\<\{ `mcpServiceToken`: [`McpServiceTokenDocument`](McpServiceTokenDocument.md); `token`: `string`; \}\>

#### Inherited from

[`McpServiceTokenStatics`](McpServiceTokenStatics.md).[`issueFor`](McpServiceTokenStatics.md#issuefor)

***

### revokeForUser

> **revokeForUser**: (`this`, `user`, `tokenId`) => `Promise`\<[`McpServiceTokenDocument`](McpServiceTokenDocument.md) \| `null`\>

#### Parameters

##### this

`McpServiceTokenModel`

##### user

###### _id

\{ `toString`: `string`; \}

###### _id.toString

##### tokenId

`ObjectId`

#### Returns

`Promise`\<[`McpServiceTokenDocument`](McpServiceTokenDocument.md) \| `null`\>

#### Inherited from

[`McpServiceTokenStatics`](McpServiceTokenStatics.md).[`revokeForUser`](McpServiceTokenStatics.md#revokeforuser)

***

### revokeOutdatedForUser

> **revokeOutdatedForUser**: (`this`, `user`) => `Promise`\<`void`\>

#### Parameters

##### this

`McpServiceTokenModel`

##### user

###### _id

\{ `toString`: `string`; \}

###### _id.toString

###### tokenEpoch?

`number`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`McpServiceTokenStatics`](McpServiceTokenStatics.md).[`revokeOutdatedForUser`](McpServiceTokenStatics.md#revokeoutdatedforuser)

***

### verify

> **verify**: (`this`, `token`) => `Promise`\<[`McpServiceTokenDocument`](McpServiceTokenDocument.md) \| `null`\>

#### Parameters

##### this

`McpServiceTokenModel`

##### token

`string`

#### Returns

`Promise`\<[`McpServiceTokenDocument`](McpServiceTokenDocument.md) \| `null`\>

#### Inherited from

[`McpServiceTokenStatics`](McpServiceTokenStatics.md).[`verify`](McpServiceTokenStatics.md#verify)

## Methods

### findExactlyOne()

> **findExactlyOne**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpServiceTokenDocument`](McpServiceTokenDocument.md)\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpServiceTokenDocument`](McpServiceTokenDocument.md)\>

#### Inherited from

[`McpServiceTokenStatics`](McpServiceTokenStatics.md).[`findExactlyOne`](McpServiceTokenStatics.md#findexactlyone)

***

### findOneOrNone()

> **findOneOrNone**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpServiceTokenDocument`](McpServiceTokenDocument.md) \| `null`\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpServiceTokenDocument`](McpServiceTokenDocument.md) \| `null`\>

#### Inherited from

[`McpServiceTokenStatics`](McpServiceTokenStatics.md).[`findOneOrNone`](McpServiceTokenStatics.md#findoneornone)
