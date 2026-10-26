The small structural subset of a Mongoose model used by seed helpers.

## Constructors

### Constructor

> **new SeedModel**(): `SeedDocument`

#### Returns

`SeedDocument`

## Properties

### countDocuments

> **countDocuments**: (`filter`) => `PromiseLike`\<`number`\>

#### Parameters

##### filter

`Record`\<`string`, `unknown`\>

#### Returns

`PromiseLike`\<`number`\>

***

### deleteMany

> **deleteMany**: (`filter`) => `PromiseLike`\<`unknown`\>

#### Parameters

##### filter

`Record`\<`string`, `unknown`\>

#### Returns

`PromiseLike`\<`unknown`\>

***

### find

> **find**: (`filter`) => `object`

#### Parameters

##### filter

`Record`\<`string`, `unknown`\>

#### Returns

`object`

##### limit

> **limit**: (`limit`) => `PromiseLike`\<`SeedDocument`[]\>

###### Parameters

###### limit

`number`

###### Returns

`PromiseLike`\<`SeedDocument`[]\>

***

### modelName

> **modelName**: `string`
