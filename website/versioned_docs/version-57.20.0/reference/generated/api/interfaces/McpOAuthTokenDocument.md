One issued access/refresh token pair. Rotation chains pairs together by `familyId`.

## Extends

- `Document`

## Properties

### \_id

> **\_id**: `ObjectId`

This documents _id.

#### Overrides

`mongoose.Document._id`

***

### accessExpiresAt

> **accessExpiresAt**: `Date`

***

### accessTokenHash

> **accessTokenHash**: `string`

***

### clientId

> **clientId**: `string`

***

### created

> **created**: `Date`

***

### familyId

> **familyId**: `string`

***

### hasRefreshToken?

> `optional` **hasRefreshToken?**: `boolean`

False for an access-only `client_credentials` token. The stored refresh hash is then of a
discarded secret and must not be exchanged.

***

### refreshExpiresAt

> **refreshExpiresAt**: `Date`

***

### refreshTokenHash

> **refreshTokenHash**: `string`

***

### resource?

> `optional` **resource?**: `string`

***

### revokedAt?

> `optional` **revokedAt?**: `Date`

***

### rotatedAt?

> `optional` **rotatedAt?**: `Date`

***

### scope?

> `optional` **scope?**: `string`

***

### tokenEpoch?

> `optional` **tokenEpoch?**: `number`

***

### updated

> **updated**: `Date`

***

### userId

> **userId**: `ObjectId`
