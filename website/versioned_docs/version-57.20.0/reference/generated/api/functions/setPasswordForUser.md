> **setPasswordForUser**(`user`, `password`, `timeoutMs?`, `audit?`): `Promise`\<`void`\>

Sets a password on a passport-local-mongoose user document, returning a Promise regardless of
whether the installed version of `setPassword` is callback- or promise-based. Newer versions
return a promise while older ones only invoke the callback; this helper normalizes both and
rejects after `timeoutMs` (default 15s) if neither settles. Call `user.save()` afterwards to
persist the new hash/salt.

Rejects synchronously (before touching `setPassword`) when `password` exceeds
[MAX\_PASSWORD\_LENGTH](../variables/MAX_PASSWORD_LENGTH.md) characters. When `audit.adminId` is provided (an admin-initiated
password change), logs a `logger.info` audit line with the admin id, target user id, and
timestamp — NEVER the password itself.

## Parameters

### user

[`HasSetPassword`](../interfaces/HasSetPassword.md)

### password

`string`

### timeoutMs?

`number` = `15_000`

### audit?

[`SetPasswordAuditContext`](../interfaces/SetPasswordAuditContext.md)

## Returns

`Promise`\<`void`\>
