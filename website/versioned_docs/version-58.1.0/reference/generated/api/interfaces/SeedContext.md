## Properties

### changes

> **changes**: [`SeedChangeResult`](SeedChangeResult.md)[]

***

### deleteMany

> **deleteMany**: (`model`, `filter?`) => `Promise`\<[`SeedChangeResult`](SeedChangeResult.md)\>

#### Parameters

##### model

[`SeedModel`](SeedModel.md)

##### filter?

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<[`SeedChangeResult`](SeedChangeResult.md)\>

***

### dryRun

> **dryRun**: `boolean`

***

### mode

> **mode**: [`SeedMode`](../type-aliases/SeedMode.md)

***

### upsert

> **upsert**: \<`TValues`\>(`model`, `key`, `values`) => `Promise`\<[`SeedChangeResult`](SeedChangeResult.md)\>

#### Type Parameters

##### TValues

`TValues` *extends* `object`

#### Parameters

##### model

[`SeedModel`](SeedModel.md)

##### key

`Record`\<`string`, `unknown`\>

##### values

`TValues`

#### Returns

`Promise`\<[`SeedChangeResult`](SeedChangeResult.md)\>
