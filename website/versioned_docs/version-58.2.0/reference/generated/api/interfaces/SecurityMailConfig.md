The mail settings a notification reads when it is sent.

## Properties

### authMailTemplates?

> `optional` **authMailTemplates?**: `Partial`\<`Record`\<[`BetterAuthMailTemplateId`](../type-aliases/BetterAuthMailTemplateId.md), [`BetterAuthMailTemplate`](BetterAuthMailTemplate.md)\>\>

***

### publicAppUrl?

> `optional` **publicAppUrl?**: `string`

***

### sendMail?

> `optional` **sendMail?**: (`message`) => `Promise`\<`void`\>

#### Parameters

##### message

###### html?

`string`

###### sensitive?

`boolean`

###### subject

`string`

###### text

`string`

###### to

`string`

#### Returns

`Promise`\<`void`\>
