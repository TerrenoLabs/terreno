> **buildSecurityMailData**(`__namedParameters`): `Record`\<`string`, `string`\>

The placeholder values for one event. Only fixed phrases, the time, the app URL, a known
provider name, and (with `includeOrgName`) the organization name: nothing user-chosen, no
tokens, and no admin identity.

## Parameters

### \_\_namedParameters

#### event

[`SecurityActionEvent`](../interfaces/SecurityActionEvent.md)

#### includeOrgName?

`boolean` = `false`

#### publicAppUrl?

`string`

## Returns

`Record`\<`string`, `string`\>
