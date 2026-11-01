> `const` **OrganizationQueryFilter**: (`_user?`, `_query?`) => `Record`\<`string`, `unknown`\> = `OrgQueryFilter`

Restricts list queries to the current request organization (`X-Organization-Id` or inferred
single org-admin membership). Does not read `User.organizationIds`.

## Parameters

### \_user?

[`User`](../interfaces/User.md)

### \_query?

`Record`\<`string`, `unknown`\>

## Returns

`Record`\<`string`, `unknown`\>
