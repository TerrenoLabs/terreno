## Extends

- `Model`\<[`BackgroundTaskDocument`](BackgroundTaskDocument.md), `Record`\<`string`, `never`\>, [`BackgroundTaskMethods`](BackgroundTaskMethods.md)\>.[`BackgroundTaskStatics`](BackgroundTaskStatics.md)

## Constructors

### Constructor

> **new BackgroundTaskModel**\<`DocType`\>(`doc?`, `fields?`, `options?`): `Document`\<`unknown`, `Record`\<`string`, `never`\>, [`BackgroundTaskDocument`](BackgroundTaskDocument.md), \{ \}, `DefaultSchemaOptions`\> & `Omit`\<[`BackgroundTaskDocument`](BackgroundTaskDocument.md) & `Required`\<\{ \}\> & `object`, `"id"` \| keyof BackgroundTaskMethods\> & `HydratedDocumentOverrides`\<[`BackgroundTaskMethods`](BackgroundTaskMethods.md) & `object`\>

#### Parameters

##### doc?

`DocType`

##### fields?

`any`

##### options?

`AnyObject`

#### Returns

`Document`\<`unknown`, `Record`\<`string`, `never`\>, [`BackgroundTaskDocument`](BackgroundTaskDocument.md), \{ \}, `DefaultSchemaOptions`\> & `Omit`\<[`BackgroundTaskDocument`](BackgroundTaskDocument.md) & `Required`\<\{ \}\> & `object`, `"id"` \| keyof BackgroundTaskMethods\> & `HydratedDocumentOverrides`\<[`BackgroundTaskMethods`](BackgroundTaskMethods.md) & `object`\>

#### Inherited from

`Model<BackgroundTaskDocument, Record<string, never>, BackgroundTaskMethods>.constructor`

## Properties

### checkCancellation

> **checkCancellation**: (`taskId`) => `Promise`\<`void`\>

#### Parameters

##### taskId

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`BackgroundTaskStatics`](BackgroundTaskStatics.md).[`checkCancellation`](BackgroundTaskStatics.md#checkcancellation)
