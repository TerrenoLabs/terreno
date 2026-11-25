Static methods added by configurationPlugin to the Mongoose model.

## Extended by

- [`ConfigurationModel`](ConfigurationModel.md)

## Type Parameters

### T

`T` *extends* `object`

## Methods

### getConfig()

#### Call Signature

> **getConfig**(): `Promise`\<`T` & `Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\>\>

Get the full singleton configuration document.

##### Returns

`Promise`\<`T` & `Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\>\>

#### Call Signature

> **getConfig**\<`P`\>(`key`): `Promise`\<[`PathValue`](../type-aliases/PathValue.md)\<`T`, `P`\>\>

Get a specific value by dot-notation key.

##### Type Parameters

###### P

`P` *extends* `string`

##### Parameters

###### key

`P`

##### Returns

`Promise`\<[`PathValue`](../type-aliases/PathValue.md)\<`T`, `P`\>\>

***

### getSecretFields()

> **getSecretFields**(): [`SecretFieldMeta`](SecretFieldMeta.md)[]

Get secret field metadata discovered from the schema.

#### Returns

[`SecretFieldMeta`](SecretFieldMeta.md)[]

***

### resolveSecrets()

> **resolveSecrets**(`provider?`): `Promise`\<`Map`\<`string`, `string`\>\>

Resolve all secret field values from a provider.
Uses the provider passed here, or falls back to the one configured in the plugin options.
Returns an **in-memory** map of path -> value for programmatic use (startup
self-checks, request-time resolution).

This method never persists resolved values. Secret material must never be
written to the configuration document.

#### Parameters

##### provider?

[`SecretProvider`](SecretProvider.md)

#### Returns

`Promise`\<`Map`\<`string`, `string`\>\>

***

### updateConfig()

> **updateConfig**(`updates`): `Promise`\<`T` & `Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\>\>

Update the singleton configuration document.

The patch is flattened into MongoDB dotted paths and applied with
`findOneAndUpdate({$set})`. This preserves sibling fields inside nested
subdocuments when a partial nested patch is supplied, and tolerates legacy /
out-of-schema fields already persisted on the document (unlike a full
`doc.save()`, which throws under `strict: "throw"`).

#### Parameters

##### updates

[`DeepPartial`](../type-aliases/DeepPartial.md)\<`T`\>

#### Returns

`Promise`\<`T` & `Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\>\>
