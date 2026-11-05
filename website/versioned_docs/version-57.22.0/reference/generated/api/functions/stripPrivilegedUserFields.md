> **stripPrivilegedUserFields**(`body`, `context`): `Record`\<`string`, `unknown`\>

Removes [SELF\_SERVICE\_BLOCKED\_USER\_FIELDS](../variables/SELF_SERVICE_BLOCKED_USER_FIELDS.md) from a self-service body, including dotted
paths into them (`roles.0`). Fields are dropped rather than rejected so clients that echo a
whole user object back still succeed.

## Parameters

### body

`Record`\<`string`, `unknown`\>

### context

`string`

## Returns

`Record`\<`string`, `unknown`\>
