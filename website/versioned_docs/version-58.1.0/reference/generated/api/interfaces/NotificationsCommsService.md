## Properties

### sendMail

> **sendMail**: (`message`, `options?`) => `Promise`\<`unknown`\>

#### Parameters

##### message

###### html?

`string`

###### subject

`string`

###### text?

`string`

###### to

`string`

##### options?

###### userId?

`string`

#### Returns

`Promise`\<`unknown`\>

***

### sendPushToUser

> **sendPushToUser**: (`message`) => `Promise`\<`unknown`[]\>

#### Parameters

##### message

###### body

`string`

###### title

`string`

###### userId

`string`

#### Returns

`Promise`\<`unknown`[]\>

***

### sendSms

> **sendSms**: (`message`, `options?`) => `Promise`\<`unknown`\>

#### Parameters

##### message

###### body

`string`

###### to

`string`

##### options?

###### userId?

`string`

#### Returns

`Promise`\<`unknown`\>
