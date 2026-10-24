> `const` **USER\_IDENTITY\_FIELDS**: readonly \[`"email"`, `"disabled"`, `"betterAuthId"`, `"githubId"`, `"emailVerified"`\]

User fields that identify the account or control whether it can sign in. Changing them on
another user through generic RBAC user-model writes needs `user:updateIdentity` on top of
`user:update`; see [assertCanWriteUserIdentity](../functions/assertCanWriteUserIdentity.md).
