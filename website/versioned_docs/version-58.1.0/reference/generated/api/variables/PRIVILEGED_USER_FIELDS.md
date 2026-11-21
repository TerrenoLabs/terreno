> `const` **PRIVILEGED\_USER\_FIELDS**: readonly \[`"admin"`, `"roles"`, `"organizationIds"`, `"emailVerified"`, `"tokenEpoch"`\]

User fields that confer authority or skip security gates. Self-service requests
(anonymous signup, `PATCH /me`) must never set them, or any caller could grant
themselves admin, an RBAC role, a verified email, or a reset epoch. Elevate users
through the admin API or `access.roles.assign` instead.
