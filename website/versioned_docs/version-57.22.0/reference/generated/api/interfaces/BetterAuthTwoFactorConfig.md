Time-based one-time-password two-factor authentication (Better Auth `twoFactor`).

## Properties

### backupCodes?

> `optional` **backupCodes?**: `object`

How many backup codes enrollment makes (default 10) and how long each is (default 10).

#### amount?

> `optional` **amount?**: `number`

#### length?

> `optional` **length?**: `number`

***

### issuer

> **issuer**: `string`

Issuer shown in authenticator apps, usually the app name.

***

### trustDeviceDays?

> `optional` **trustDeviceDays?**: `number`

Days a "trust this device" choice skips the second factor. Defaults to 30.
