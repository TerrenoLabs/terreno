## Extends

- `Omit`\<[`SeedRunOptions`](SeedRunOptions.md), `"dryRun"` \| `"force"` \| `"mode"` \| `"only"`\>

## Properties

### allowProductionReset?

> `optional` **allowProductionReset?**: `boolean` \| (() => `boolean` \| `Promise`\<`boolean`\>)

#### Inherited from

[`SeedRunOptions`](SeedRunOptions.md).[`allowProductionReset`](SeedRunOptions.md#allowproductionreset)

***

### argv?

> `optional` **argv?**: `string`[]

***

### connect?

> `optional` **connect?**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`SeedRunOptions`](SeedRunOptions.md).[`connect`](SeedRunOptions.md#connect)

***

### disconnect?

> `optional` **disconnect?**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`SeedRunOptions`](SeedRunOptions.md).[`disconnect`](SeedRunOptions.md#disconnect)

***

### log?

> `optional` **log?**: [`ScopedLogger`](ScopedLogger.md)

#### Inherited from

[`SeedRunOptions`](SeedRunOptions.md).[`log`](SeedRunOptions.md#log)

***

### name

> **name**: `string`

#### Inherited from

[`SeedRunOptions`](SeedRunOptions.md).[`name`](SeedRunOptions.md#name)

***

### steps

> **steps**: [`SeedStep`](SeedStep.md)[]

#### Inherited from

[`SeedRunOptions`](SeedRunOptions.md).[`steps`](SeedRunOptions.md#steps)
