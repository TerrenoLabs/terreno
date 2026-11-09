> `const` **USER\_CREDENTIAL\_FIELDS**: readonly \[`"hash"`, `"salt"`, `"attempts"`, `"last"`\]

passport-local-mongoose password and lockout fields. Only the password flows (reset,
`setPassword`-gated actions) write them, so RBAC user-model writes through modelRouter, sync,
MCP, and the admin panel drop them along with [PRIVILEGED\_USER\_FIELDS](PRIVILEGED_USER_FIELDS.md).
