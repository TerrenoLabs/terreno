## Extends

- [`MigrationModule`](MigrationModule.md)

## Properties

### checksum

> **checksum**: `string`

***

### down?

> `optional` **down?**: (`ctx`) => `Promise`\<`void`\>

#### Parameters

##### ctx

[`MigrationContext`](MigrationContext.md)

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`MigrationModule`](MigrationModule.md).[`down`](MigrationModule.md#down)

***

### id

> **id**: `string`

#### Inherited from

[`MigrationModule`](MigrationModule.md).[`id`](MigrationModule.md#id)

***

### schemaAfter?

> `optional` **schemaAfter?**: `unknown`

#### Inherited from

[`MigrationModule`](MigrationModule.md).[`schemaAfter`](MigrationModule.md#schemaafter)

***

### up

> **up**: (`ctx`) => `Promise`\<`void`\>

#### Parameters

##### ctx

[`MigrationContext`](MigrationContext.md)

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`MigrationModule`](MigrationModule.md).[`up`](MigrationModule.md#up)
