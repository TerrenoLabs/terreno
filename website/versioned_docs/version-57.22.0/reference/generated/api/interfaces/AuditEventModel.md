## Extends

- `Model`\<[`AuditEventDocument`](AuditEventDocument.md), `object`, `AuditEventMethods`\>.`AuditEventStatics`

## Constructors

### Constructor

> **new AuditEventModel**\<`DocType`\>(`doc?`, `fields?`, `options?`): `Document`\<`unknown`, `object`, [`AuditEventDocument`](AuditEventDocument.md), \{ \}, `DefaultSchemaOptions`\> & [`AuditEventDocument`](AuditEventDocument.md) & `Required`\<\{ \}\> & `object` & `object`

#### Parameters

##### doc?

`DocType`

##### fields?

`any`

##### options?

`AnyObject`

#### Returns

`Document`\<`unknown`, `object`, [`AuditEventDocument`](AuditEventDocument.md), \{ \}, `DefaultSchemaOptions`\> & [`AuditEventDocument`](AuditEventDocument.md) & `Required`\<\{ \}\> & `object` & `object`

#### Inherited from

`mongoose.Model<AuditEventDocument, object, AuditEventMethods>.constructor`

## Methods

### findExactlyOne()

> **findExactlyOne**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`AuditEventDocument`](AuditEventDocument.md)\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`AuditEventDocument`](AuditEventDocument.md)\>

#### Inherited from

`AuditEventStatics.findExactlyOne`

***

### findOneOrNone()

> **findOneOrNone**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`AuditEventDocument`](AuditEventDocument.md) \| `null`\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`AuditEventDocument`](AuditEventDocument.md) \| `null`\>

#### Inherited from

`AuditEventStatics.findOneOrNone`
