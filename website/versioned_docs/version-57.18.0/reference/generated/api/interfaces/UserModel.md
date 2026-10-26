## Extends

- `Model`\<[`User`](User.md)\>

## Constructors

### Constructor

> **new UserModel**\<`DocType`\>(`doc?`, `fields?`, `options?`): `Document`\<`unknown`, \{ \}, [`User`](User.md), \{ \}, `DefaultSchemaOptions`\> & [`User`](User.md) & `Required`\<\{ \}\> & `object`

#### Parameters

##### doc?

`DocType`

##### fields?

`any`

##### options?

`AnyObject`

#### Returns

`Document`\<`unknown`, \{ \}, [`User`](User.md), \{ \}, `DefaultSchemaOptions`\> & [`User`](User.md) & `Required`\<\{ \}\> & `object`

#### Inherited from

`Model<User>.constructor`

## Properties

### createAnonymousUser?

> `optional` **createAnonymousUser?**: (`id?`) => `Promise`\<[`User`](User.md)\>

#### Parameters

##### id?

`string`

#### Returns

`Promise`\<[`User`](User.md)\>

***

### postCreate?

> `optional` **postCreate?**: (`body`) => `Promise`\<`void`\>

#### Parameters

##### body

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<`void`\>

## Methods

### createStrategy()

> **createStrategy**(): `Strategy`

#### Returns

`Strategy`

***

### deserializeUser()

> **deserializeUser**(): (`username`, `cb`) => `void`

#### Returns

(`username`, `cb`) => `void`

***

### findByUsername()

> **findByUsername**(`username`, `findOpts`): `Query`\<[`User`](User.md) \| `null`, [`User`](User.md)\>

#### Parameters

##### username

`string`

##### findOpts

`boolean` \| \{ `selectHashSaltFields?`: `boolean`; \}

#### Returns

`Query`\<[`User`](User.md) \| `null`, [`User`](User.md)\>

***

### serializeUser()

> **serializeUser**(): (`user`, `cb`) => `void`

#### Returns

(`user`, `cb`) => `void`
