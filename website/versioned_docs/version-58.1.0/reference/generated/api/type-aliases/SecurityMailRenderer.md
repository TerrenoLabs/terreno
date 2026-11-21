> **SecurityMailRenderer** = (`options`) => [`SecurityMailTemplate`](../interfaces/SecurityMailTemplate.md)

A renderer for security notification templates (`@terreno/comms` `renderAuthMail` fits).

## Parameters

### options

#### data

`Record`\<`string`, `string`\>

#### publicAppUrl

`string`

#### templateId

[`SecurityMailTemplateId`](SecurityMailTemplateId.md)

#### templates?

`Partial`\<`Record`\<[`SecurityMailTemplateId`](SecurityMailTemplateId.md), [`SecurityMailTemplate`](../interfaces/SecurityMailTemplate.md)\>\>

## Returns

[`SecurityMailTemplate`](../interfaces/SecurityMailTemplate.md)
