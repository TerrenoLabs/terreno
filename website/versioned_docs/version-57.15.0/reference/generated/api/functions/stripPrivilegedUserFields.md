> **stripPrivilegedUserFields**(`body`, `context`): `Record`\<`string`, `unknown`\>

Removes [PRIVILEGED\_USER\_FIELDS](../variables/PRIVILEGED_USER_FIELDS.md) from a self-service body. Fields are dropped rather
than rejected so clients that echo a whole user object back still succeed.

## Parameters

### body

`Record`\<`string`, `unknown`\>

### context

`string`

## Returns

`Record`\<`string`, `unknown`\>
