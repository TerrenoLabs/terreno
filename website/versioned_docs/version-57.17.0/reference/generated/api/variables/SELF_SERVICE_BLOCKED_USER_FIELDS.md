> `const` **SELF\_SERVICE\_BLOCKED\_USER\_FIELDS**: readonly \[`"admin"`, `"roles"`, `"organizationIds"`, `"emailVerified"`, `"tokenEpoch"`, `"betterAuthId"`, `"githubId"`, `"githubUsername"`, `"githubProfileUrl"`, `"githubAvatarUrl"`, `"oauthProvider"`, `"hash"`, `"salt"`, `"attempts"`, `"last"`, `"disabled"`\]

Fields self-service requests (anonymous signup, `PATCH /me`) must never set: the
[PRIVILEGED\_USER\_FIELDS](PRIVILEGED_USER_FIELDS.md) plus the fields that bind an external credential to the row
(Better Auth id, GitHub link, OAuth provider), the passport-local-mongoose password and
lockout state, and the disabled flag. Only the Better Auth sync, GitHub link, and password
flows that own them write these. Kept apart from PRIVILEGED_USER_FIELDS so authorized admin
User writes through modelRouter, sync, MCP, and the admin panel can still manage the identity
and disabled fields (those writes still drop [USER\_CREDENTIAL\_FIELDS](USER_CREDENTIAL_FIELDS.md)).
